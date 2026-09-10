/**
 * dsh-task-reliability — event listeners.
 *
 * 依赖 util/store/text/repeat/verify/constants。注册 5 类事件监听（重试
 * waterfall、turn-stopping 继续+打断、会话校验、llm/stream 包装、自主决策拦截）。
 * 所有回调均接收 shared（index.js 构建）。
 */
import { sleep, userMessage } from './util.js'
import { activeTaskOf, finishTask, addQuestion, registerTask } from './store.js'
import { askNoteOf, raceAskAnswer } from './ask.js'
import { isTopLevelAgent } from './text.js'
import { wrapStreamForLoop } from './repeat.js'
import { loopNotify, detectNoProgress, recordToolLoop, repeatStateOf } from './loop.js'
import { runVerification } from './verify.js'
import { markAgentError, rescueAfterError, rescueTurn } from './rescue.js'
import { PLUGIN_EVENTS } from './emit.js'
import {
  AUTOPILOT_DENY_REASON,
  DIRECT_CONTINUE_TEXT,
  REPEAT_BREAK_TEXT,
  RETRY_MAX_DELAY_MS,
  RATE_WINDOW_MS,
} from './constants.js'
import type {
  AgentLike,
  AnyObject,
  DshContext,
  ExecLike,
  GoalsService,
  NextFn,
  RepeatKind,
  RepeatState,
  RequestErrorPayload,
  RetryBucket,
  SharedContext,
  Task,
} from './types.js'
// ── 状态辅助 ───────────────────────────────────────────────────────────────

/** 请求级重试计数（按会话 + 时间窗）。 */
function retryBudget(sessionId: string, shared: SharedContext): RetryBucket {
  const now = Date.now()
  const bucket = shared.retryBuckets.get(sessionId)
  if (bucket === undefined || now - bucket.windowStart > 60000) {
    const next = { windowStart: now, count: 0 }
    shared.retryBuckets.set(sessionId, next)
    return next
  }
  return bucket
}

/** 全局动作速率限制。 */
function rateAllowed(shared: SharedContext): boolean {
  const now = Date.now()
  while (shared.actionLog.length > 0 && now - shared.actionLog[0] > RATE_WINDOW_MS) shared.actionLog.shift()
  if (shared.actionLog.length >= shared.options.rateMaxActions) return false
  shared.actionLog.push(now)
  return true
}

/** 会话自主决策判定：会话级显式开关优先，否则取全局模式。 */
function autopilotFor(sessionId: string, shared: SharedContext): boolean {
  if (shared.store.mode.sessionAutopilot[sessionId] === true) return true
  if (shared.store.mode.sessionAutopilot[sessionId] === false) return false
  return shared.store.mode.autopilot || shared.options.autopilot
}

function signalAborted(signal: { aborted?: boolean } | undefined): boolean {
  return signal !== undefined && signal !== null && signal.aborted === true
}

// ── 自动跟踪 ───────────────────────────────────────────────────────────────

function goalObjective(ctx: DshContext, agent: AgentLike): string {
  try {
    const goals = ctx.get<GoalsService>('goals')
    const view = goals?.get?.(agent)
    if (view !== undefined && view !== null && typeof view === 'object') {
      if (typeof view.objective === 'string' && view.objective !== '') return view.objective
    }
  } catch {
    // ignore
  }
  return ''
}

/** 自动跟踪：会话存在活动 goal 时保守登记。 */
function maybeAutoTrack(agent: AgentLike, shared: SharedContext): void {
  if (!shared.store.mode.tracking) return
  if (activeTaskOf(shared.store, agent.id) !== undefined) return
  const objective = goalObjective(shared.ctx, agent)
  if (objective === '') return
  const result = registerTask(shared.store, {
    sessionId: agent.id,
    description: objective,
    mode: shared.store.mode.verify ? 'verify' : 'direct',
    source: 'auto',
  })
  if (result.ok) shared.save()
}

// ── 2. 模型超时/请求失败自动重试 ─────────────────────────────────────────

async function handleRequestError(
  payload: RequestErrorPayload | undefined,
  next: NextFn,
  shared: SharedContext,
): Promise<unknown> {
  const code = payload?.failure?.code
  if (typeof code !== 'string' || !shared.options.retryableCodes.has(code)) return next()
  const agent = payload?.agent
  if (agent === undefined || agent === null) return next()
  const bucket = retryBudget(agent.id, shared)
  if (bucket.count >= shared.options.retryMax) return next()
  bucket.count += 1
  if (await retryWait(payload, bucket, shared)) return next()
  logRetry(shared, agent.id, code, bucket.count)
  return { kind: 'retry' }
}

function logRetry(shared: SharedContext, sessionId: string, code: string, attempt: number): void {
  shared.ctx.logger?.info?.(
    `[dsh-task-reliability] 请求失败自动重试（sessionId=${sessionId}，错误码=${code}，第 ${attempt}/${shared.options.retryMax} 次）`,
  )
}

/** 指数退避等待：中途 abort 则放弃本次重试。 */
async function retryWait(
  payload: RequestErrorPayload | undefined,
  bucket: RetryBucket,
  shared: SharedContext,
): Promise<boolean> {
  const signal = payload?.signal
  const delay = Math.min(shared.options.retryBaseMs * 2 ** (bucket.count - 1), RETRY_MAX_DELAY_MS)
  if (signalAborted(signal)) return true
  await sleep(delay)
  return signalAborted(signal)
}

// ── 3+5. 任务自动继续 + 思考重复打断（turn-stopping） ────────────────────

function shouldSteer(task: Task | undefined, repeat: RepeatState | undefined): boolean {
  if (task !== undefined) return true
  return repeat !== undefined && repeat.count > 0 && !repeat.gaveUp
}

/**
 * 循环打断（reason/tool/progress）优先于任务继续（避免指令混杂）。
 * 采用一次性消费：只在「刚检测到循环」（pendingBreak 非空）时注入打断指令，
 * 避免在后续回合反复注入同一打断。命中返回 true（占用本次 turn-stopping）。
 *
 * issue #153：pendingBreak 绑定命中回合（pendingBreakTurn，turn-stopping 开头
 * 已推进 turnSeq，命中回合 = turnSeq - 1）；跨回合残留自动失效清理，不注入——
 * 解决「回合 A 命中循环 → 回合 B 无工具调用也注入提示」的误报。
 */
function repeatBreak(repeat: RepeatState | undefined, agent: AgentLike, shared: SharedContext): boolean {
  if (repeat === undefined || repeat.count === 0 || repeat.gaveUp) return false
  const kind = repeat.pendingBreak
  if (kind === null) return false
  if (repeat.pendingBreakTurn !== repeat.turnSeq - 1) {
    repeat.pendingBreak = null
    repeat.pendingBreakTurn = null
    return false
  }
  agent.steer(userMessage(REPEAT_BREAK_TEXT(repeat.count, kind)))
  void loopNotify(shared, kind, agent.id)
  shared.ctx.logger?.info?.(
    `[dsh-task-reliability] 循环打断已注入（sessionId=${agent.id}，类型=${kind}，第 ${repeat.count} 次）`,
  )
  shared.emit(PLUGIN_EVENTS.INTERVENTION, {
    sessionId: agent.id,
    action: 'repeat-break',
    reason: kind,
    count: repeat.count,
  })
  repeat.pendingBreak = null
  repeat.pendingBreakTurn = null
  return true
}

/** 对一次命中的循环做计数/上限处理并注入分级打断指令；若达上限放弃则返回 false。 */
function escalateLoop(repeat: RepeatState, shared: SharedContext, agent: AgentLike, kind: RepeatKind): boolean {
  repeat.count += 1
  repeat.lastKind = kind
  if (repeat.count > shared.options.repeatMaxPerSession) {
    repeat.gaveUp = true
    repeat.notified = false
    shared.ctx.logger?.warn?.(
      `[dsh-task-reliability] 循环打断达上限放弃（sessionId=${agent.id}，类型=${kind}，上限=${shared.options.repeatMaxPerSession}）`,
    )
    shared.emit(PLUGIN_EVENTS.INTERVENTION, {
      sessionId: agent.id,
      action: 'loop-give-up',
      reason: kind,
      count: repeat.count,
      max: shared.options.repeatMaxPerSession,
    })
    return false
  }
  agent.steer(userMessage(REPEAT_BREAK_TEXT(repeat.count, kind)))
  void loopNotify(shared, kind, agent.id)
  shared.ctx.logger?.info?.(
    `[dsh-task-reliability] 循环升级打断已注入（sessionId=${agent.id}，类型=${kind}，第 ${repeat.count} 次）`,
  )
  shared.emit(PLUGIN_EVENTS.INTERVENTION, {
    sessionId: agent.id,
    action: 'loop-escalate',
    reason: kind,
    count: repeat.count,
  })
  return true
}

function atLoopLimit(task: Task, shared: SharedContext): boolean {
  if (task.loopCount < shared.options.maxLoop) return false
  finishTask(shared.store, task.id, 'failed')
  shared.save()
  shared.ctx.logger?.warn?.(
    `[dsh-task-reliability] 任务循环达上限标记失败（taskId=${task.id}，上限=${shared.options.maxLoop}）`,
  )
  shared.emit(PLUGIN_EVENTS.INTERVENTION, {
    sessionId: task.sessionId,
    action: 'loop-limit',
    reason: 'max-loop',
    taskId: task.id,
    loopCount: task.loopCount,
  })
  return true
}

function steerContinue(task: Task, agent: AgentLike, shared: SharedContext): void {
  agent.steer(userMessage(DIRECT_CONTINUE_TEXT(task.description)))
  task.loopCount += 1
  task.lastSteerAt = Date.now()
  task.updatedAt = Date.now()
  shared.save()
  shared.ctx.logger?.info?.(
    `[dsh-task-reliability] 任务自动继续已注入（taskId=${task.id}，sessionId=${agent.id}，第 ${task.loopCount} 次）`,
  )
  shared.emit(PLUGIN_EVENTS.INTERVENTION, {
    sessionId: task.sessionId,
    action: 'steer-continue',
    reason: 'turn-stopping',
    taskId: task.id,
    loopCount: task.loopCount,
  })
}

/** 无进展命中即注入打断指令；无需继续时返回 false。 */
function noProgressBreak(
  task: Task | undefined,
  repeat: RepeatState | undefined,
  agent: AgentLike,
  shared: SharedContext,
): boolean {
  if (task === undefined) return false
  if (!detectNoProgress(repeat, shared.options)) return false
  return escalateLoop(repeat as RepeatState, shared, agent, 'progress')
}

/** 常规任务继续：冷却/上限/verify 模式不继续。 */
function continueTask(task: Task, agent: AgentLike, shared: SharedContext): boolean {
  if (Date.now() - task.lastSteerAt < shared.options.steerCooldownMs) return false
  if (atLoopLimit(task, shared)) return false
  if (task.mode === 'verify') return false
  steerContinue(task, agent, shared)
  return true
}

async function handleTurnStopping(
  agent: AgentLike,
  signal: { aborted?: boolean } | undefined,
  shared: SharedContext,
): Promise<void> {
  if (!isTopLevelAgent(agent)) return
  const repeat = shared.repeatStates.get(agent.id)
  // issue #153：回合边界推进——turn-stopping 是回合结束事件，递增回合序号，
  // 使上一回合产生的 pendingBreak 在后续回合消费时校验失效（跨回合不注入）。
  if (repeat !== undefined) repeat.turnSeq += 1
  if (signalAborted(signal)) return
  const task = activeTaskOf(shared.store, agent.id)
  if (!shouldSteer(task, repeat)) {
    // 无任务无循环：普通对话截断救场（issue #147，受开关/上限/冷却约束）。
    rescueTurn(agent, shared)
    return
  }
  if (!rateAllowed(shared)) return
  // 1. 思考/工具循环打断优先（立即中断后自动继续由打断指令驱动）。
  if (repeatBreak(repeat, agent, shared)) return
  // 2. 无进展循环（仅当存在活动任务；命中即注入打断指令继续）。
  if (noProgressBreak(task, repeat, agent, shared)) return
  if (task === undefined) return
  continueTask(task, agent, shared)
}

// ── 4. 会话结束后完成度校验（verify 模式） ───────────────────────────────

async function handleStatus(agent: AgentLike, status: string | undefined, shared: SharedContext): Promise<unknown> {
  if (status !== 'idle') return
  if (!isTopLevelAgent(agent)) return
  maybeAutoTrack(agent, shared)
  const task = activeTaskOf(shared.store, agent.id)
  if (task === undefined) {
    // 无任务：回合 error 结束的事后救场（issue #147）。
    rescueAfterError(agent, shared)
    return
  }
  if (task.mode !== 'verify') return
  if (task.verifyCount >= shared.options.maxVerify) {
    finishTask(shared.store, task.id, 'failed')
    shared.save()
    shared.ctx.logger?.warn?.(
      `[dsh-task-reliability] 校验次数达上限标记任务失败（taskId=${task.id}，上限=${shared.options.maxVerify}）`,
    )
    shared.emit(PLUGIN_EVENTS.VERIFY, {
      sessionId: task.sessionId,
      action: 'verify-limit',
      reason: 'max-verify',
      taskId: task.id,
      verifyCount: task.verifyCount,
    })
    return
  }
  if (Date.now() - task.lastSteerAt < shared.options.steerCooldownMs) return
  task.status = 'checking'
  task.updatedAt = Date.now()
  shared.save()
  shared.ctx.logger?.info?.(
    `[dsh-task-reliability] 完成度校验触发（taskId=${task.id}，sessionId=${agent.id}，第 ${task.verifyCount + 1} 次）`,
  )
  return runVerification(shared.ctx, shared.store, task, agent, shared.save, shared.emit)
}

// ── 5. 思考重复检测（llm/stream 包装） ───────────────────────────────────

/**
 * 包装 `llm/stream`：返回包装后的流。
 *
 * 必须保持为**同步函数**：cordis waterfall 不 await listener 的返回值，
 * `next()` 同步返回流；若这里是 async function，waterfall 拿到的就是
 * `Promise<流>`——`for await` 消费方尚可容忍（自动展开 Promise），但
 * vision-toolkit 等适配器用 `yield*` 委托流，`yield*` 不接受 Promise，
 * 会抛 `yield* (intermediate value) is not async iterable`。
 */
function handleStream(options: AnyObject | undefined, next: NextFn, shared: SharedContext): unknown {
  const sessionId = typeof options?.sessionId === 'string' ? options.sessionId : ''
  if (sessionId === '') return next()
  const stream = next()
  return wrapStreamForLoop(stream, repeatStateOf(sessionId, shared), shared.options)
}

// ── 7. 自主决策：拦截 ask（deny，不调 next）；收集待确认问题 ─────────────

/**
 * 拦截 `tools/pre-execute` 的 ask_user_question（autopilot 模式）。
 *
 * issue #79：默认（autopilotGraceMs > 0）不再立即 deny——ask 先正常展示给
 * 用户，延迟决策（缓冲超时后 deny 语义）在 `tools/execute` 的
 * handleToolExecute 中完成；仅当 autopilotGraceMs = 0（显式禁用缓冲）时
 * 保持旧行为：立即 deny + 记录待确认。
 */
async function handlePreExecute(exec: ExecLike | undefined, next: NextFn, shared: SharedContext): Promise<unknown> {
  if (exec === undefined || exec === null || exec.name !== 'ask_user_question') return next()
  const agent = exec.agent
  if (!isTopLevelAgent(agent)) return next()
  if (!autopilotFor(agent.id, shared)) return next()
  if (shared.options.autopilotGraceMs > 0) return next()
  addQuestion(shared.store, agent.id, askNoteOf(exec.arguments))
  shared.save()
  shared.ctx.logger?.info?.(`[dsh-task-reliability] 自主决策拦截 ask（sessionId=${agent.id}，deny 并记录待确认）`)
  shared.emit(PLUGIN_EVENTS.ASK_DECISION, {
    sessionId: agent.id,
    action: 'ask-deny',
    reason: 'autopilot',
    question: askNoteOf(exec.arguments),
  })
  return { kind: 'deny', reason: AUTOPILOT_DENY_REASON }
}

/**
 * 包装 `tools/execute`：ask_user_question 启动空闲计时器竞速（issue #145
 * 修复 Promise.race 的回答丢失：竞速中回答优先、超时后迟到回答不静默丢弃），
 * 超时后记录待确认问题 + 注入继续指令 + 返回模拟回答，任务不挂起；用户
 * 回答时真实结果透传。
 *
 * issue #79：autopilot 模式下用 `autopilotGraceMs`（默认 20s）作为缓冲期
 * 超时——缓冲期内用户可正常回答（透传），超时后才自动决策（记录待确认 +
 * 注入「用户不在线，自行决策」指令 + 返回空回答由模型自行决策，语义与
 * pre-execute deny 一致）；非 autopilot 模式沿用 `askTimeoutMs` 超时。
 */
async function handleToolExecute(exec: ExecLike | undefined, next: NextFn, shared: SharedContext): Promise<unknown> {
  if (exec === undefined || exec === null) return next()
  const agent = exec.agent
  if (!isTopLevelAgent(agent)) return next()
  const sessionId = agent.id
  // 工具调用序列循环检测：命中立即抛错中断回合（与 reasoning 循环一致）。
  if (recordToolLoop(sessionId, exec, shared)) {
    void loopNotify(shared, 'tool', sessionId)
    const count = repeatStateOf(sessionId, shared).count
    shared.ctx.logger?.warn?.(
      `[dsh-task-reliability] 工具循环检测命中（sessionId=${sessionId}，工具=${exec.name}，第 ${count} 次，中断回合）`,
    )
    const error = new Error(`tool loop detected (count=${count})`) as Error & { code: string }
    shared.emit(PLUGIN_EVENTS.INTERVENTION, {
      sessionId,
      action: 'tool-loop',
      reason: 'tool-sequence',
      count,
      tool: String(exec.name ?? ''),
    })
    error.code = 'TOOL_LOOP'
    throw error
  }
  if (exec.name !== 'ask_user_question') return next()
  const autopilot = autopilotFor(sessionId, shared)
  const timeoutMs = autopilot ? shared.options.autopilotGraceMs : shared.options.askTimeoutMs
  if (timeoutMs <= 0) return next()
  return raceAskAnswer(exec, next, timeoutMs, autopilot, shared)
}

// ── 注册 ───────────────────────────────────────────────────────────────────
/** 注册全部事件监听（每个事件一个 handler，全部经 shared 共享状态）。 */
export function registerListeners(ctx: DshContext, shared: SharedContext): void {
  ctx.on('agent/request-error', (payload, next) => handleRequestError(payload, next, shared))
  ctx.on('agent/turn-stopping', ({ agent, signal }) => handleTurnStopping(agent, signal, shared))
  ctx.on('agent/status', ({ agent, status }) => handleStatus(agent, status, shared))
  ctx.on('agent/error', ({ agent }) => markAgentError(agent, shared))
  ctx.on('llm/stream', (options, next) => handleStream(options, next, shared))
  ctx.on('tools/pre-execute', (exec, next) => handlePreExecute(exec, next, shared))
  ctx.on('tools/execute', (exec, next) => handleToolExecute(exec, next, shared))
}
