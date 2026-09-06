/**
 * dsh-my-remote — 事件层：DSH 生命周期事件的监听与拦截。
 *
 *  - agent/status idle → end 事件（会话结束，推送到外部通道 + 清理注册表）
 *  - tools/execute 命中 ask_user_question → ask 事件（推送）+ 等待远程回答：
 *    Promise.race([next(), 远程回答, 超时])，远程回答到达时短路返回
 *    `{ value: { answers } }` 注入 DSH 工具结果；本机回答透传 next()。
 *  - approval/request → approval 事件（推送）+ 等待远程批准：
 *    Promise.race([next(), 远程决议, abort, 超时])，远程返回
 *    'allowed-once' / 'rejected' 短路；本机/取消透传。
 *
 * 安全语义（fail-closed）：
 *  - 会话结束（idle）时未决议的 ask/approval 由注册表 settle 为过期/
 *    rejected（ask 返回 deny，approval 返回 'rejected'）。
 *  - approval 可配超时（approvalTimeoutMs > 0 时超时 fail-closed rejected）。
 *  - ask 可配超时（askTimeoutMs > 0 时返回空 answers，由模型自行决策，
 *    与 task-reliability 的 ask 超时语义一致）。
 *  - 只处理顶层会话（子代理不做远程控制），复用 notify 的黑名单化判定。
 */
import { askQuestionsOf } from './session.js'

/** race 哨兵：ask 超时。 */
const ASK_TIMEOUT = Symbol('ask-timeout')
/** race 哨兵：approval 超时。 */
const APPROVAL_TIMEOUT = Symbol('approval-timeout')
/** race 哨兵：approval 请求被 abort（用户取消/会话中断）。 */
const ABORTED = Symbol('aborted')

/** 合法的 approval outcome（与 DSH 契约一致；'allowed-once' 是唯一批准）。 */
const OUTCOMES = new Set(['allowed-once', 'rejected', 'cancelled', 'unavailable'])

/** 注册三类监听（按 options 开关），返回 disposer 数组。 */
export function attachEvents(ctx, shared) {
  const disposers = []
  if (shared.options.end) disposers.push(attachEndListener(ctx, shared))
  if (shared.options.ask) disposers.push(attachAskInterceptor(ctx, shared))
  if (shared.options.approval) disposers.push(attachApprovalInterceptor(ctx, shared))
  return disposers
}

// ── end 监听 ──────────────────────────────────────────────────────────────

/** agent/status idle → end 事件 + 清理该会话注册表（fail-closed）。 */
function attachEndListener(ctx, shared) {
  return ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || agent === undefined || agent === null) return
    shared.askRegistry.cleanSession(agent.id)
    shared.approvalRegistry.cleanSession(agent.id)
    if (shared.isTopLevelAgent(agent)) {
      shared.channels.dispatch(buildEndEvent(shared, agent))
      shared.logger?.info(`[dsh-my-remote] 会话结束事件已下行（sessionId=${agent.id}）`)
    }
  })
}

/** 构造 end 事件帧（外部通道消费）。 */
function buildEndEvent(shared, agent) {
  return {
    kind: 'end',
    sessionId: agent?.id ?? '',
    title: shared.titleOf(shared.ctx, agent),
    time: Date.now(),
  }
}

// ── ask 拦截（tools/execute race 远程回答）────────────────────────────────

/**
 * 包装 tools/execute：ask_user_question 时推送事件并在注册表等待远程回答；
 * 远程回答短路返回 `{ value: { answers } }`（注入 DSH 工具结果，agent 据此
 * 继续执行）；本机回答透传 next()。
 */
function attachAskInterceptor(ctx, shared) {
  return ctx.on('tools/execute', async (exec, next) => {
    const agent = askTarget(exec, shared)
    if (agent === null) return next()
    const sessionId = agent.id
    const questions = askQuestionsOf(exec.arguments)
    const entry = shared.askRegistry.register(sessionId, questions, exec.arguments)
    if (entry === undefined) return next()
    shared.channels.dispatch(buildAskEvent(shared, agent, questions))
    shared.logger?.info(`[dsh-my-remote] ask 事件已下行（sessionId=${sessionId}，问题数=${questions.length}）`)
    const races = [next(), entry.waitFor.then(() => entry)]
    if (shared.options.askTimeoutMs > 0) {
      races.push(sleep(shared.options.askTimeoutMs).then(() => ASK_TIMEOUT))
    }
    const result = await Promise.race(races)
    if (result === entry) return remoteAskResult(shared, sessionId, entry)
    if (result === ASK_TIMEOUT) {
      shared.askRegistry.cleanSession(sessionId)
      shared.logger?.warn(
        `[dsh-my-remote] ask 等待远程回答超时（sessionId=${sessionId}，超时=${shared.options.askTimeoutMs}ms，返回空回答由模型自行决策）`,
      )
      return { value: { answers: [] } }
    }
    shared.askRegistry.cleanSession(sessionId)
    return result
  })
}

/** ask 拦截守卫：非 ask 工具 / 无 agent / 非顶层 → null（透传 next）。 */
function askTarget(exec, shared) {
  if (exec === undefined || exec === null || exec.name !== 'ask_user_question') return null
  const agent = exec.agent
  if (agent === undefined || agent === null || !shared.isTopLevelAgent(agent)) return null
  return agent
}

/** 远程回答结果：会话已结束（expired）则 deny，否则注入回答。 */
function remoteAskResult(shared, sessionId, entry) {
  shared.askRegistry.cleanSession(sessionId)
  if (entry.answer?.expired) {
    return { kind: 'deny', reason: 'session ended before the remote answer arrived' }
  }
  const answers = Array.isArray(entry.answer) ? entry.answer : []
  return { value: { answers } }
}

/** 构造 ask 事件帧（外部通道消费；questions 已结构化）。 */
function buildAskEvent(shared, agent, questions) {
  return {
    kind: 'ask',
    sessionId: agent?.id ?? '',
    title: shared.titleOf(shared.ctx, agent),
    questions,
    time: Date.now(),
  }
}

// ── approval 拦截（approval/request race 远程批准）────────────────────────

/**
 * 包装 approval/request：推送事件并在注册表等待远程决议；远程返回
 * 'allowed-once'/'rejected' 短路；本机 UI / abort / 超时透传或 fail-closed。
 */
function attachApprovalInterceptor(ctx, shared) {
  return ctx.on('approval/request', async (req, next) => {
    const agent = approvalTarget(req, shared)
    if (agent === null) return next()
    const sessionId = agent.id
    const entry = shared.approvalRegistry.register(sessionId, req)
    if (entry === undefined) return next()
    shared.channels.dispatch(buildApprovalEvent(shared, agent, req))
    shared.logger?.info(
      `[dsh-my-remote] approval 事件已下行（sessionId=${sessionId}，tool=${typeof req.toolName === 'string' ? req.toolName : ''}）`,
    )
    const raceRunners = approvalRaceRunners(shared, req, sessionId, entry, next)
    const result = await Promise.race(raceRunners)
    return approvalRaceResult(shared, sessionId, entry, result)
  })
}

/** approval 拦截守卫：非 approval / 无 agent / 非顶层 → null（透传 next）。 */
function approvalTarget(req, shared) {
  if (req === undefined || req === null) return null
  const agent = req.agent
  if (agent === undefined || agent === null || !shared.isTopLevelAgent(agent)) return null
  return agent
}

/** 组装 race 参与方：本机 next + 远程决议 + abort + 可配超时。 */
function approvalRaceRunners(shared, req, sessionId, entry, next) {
  const races = [next(), entry.waitFor.then(() => entry)]
  if (req.signal !== undefined && req.signal !== null) races.push(abortSignal(req.signal))
  if (shared.options.approvalTimeoutMs > 0) {
    races.push(sleep(shared.options.approvalTimeoutMs).then(() => APPROVAL_TIMEOUT))
  }
  return races
}

/** race 结果判定：远程决议 → outcome；超时 → fail-closed rejected；其余透传。 */
function approvalRaceResult(shared, sessionId, entry, result) {
  if (result === entry) {
    const outcome = sanitizeOutcome(entry.outcome)
    shared.approvalRegistry.cleanSession(sessionId)
    return outcome
  }
  shared.approvalRegistry.cleanSession(sessionId)
  if (result === APPROVAL_TIMEOUT) {
    shared.logger?.warn(
      `[dsh-my-remote] approval 等待远程批准超时（sessionId=${sessionId}，超时=${shared.options.approvalTimeoutMs}ms，fail-closed 拒绝）`,
    )
    return 'rejected'
  }
  return result === ABORTED ? 'cancelled' : result
}

/** 构造 approval 事件帧（外部通道消费）。 */
function buildApprovalEvent(shared, agent, req) {
  return {
    kind: 'approval',
    sessionId: agent?.id ?? '',
    title: shared.titleOf(shared.ctx, agent),
    reason: typeof req.reason === 'string' ? req.reason : '',
    toolName: typeof req.toolName === 'string' ? req.toolName : '',
    time: Date.now(),
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

/** outcome 白名单：非法值回退 fail-closed 'rejected'（防外部注入非法决议）。 */
function sanitizeOutcome(outcome) {
  return OUTCOMES.has(outcome) ? outcome : 'rejected'
}

/** sleep promise（不影响事件循环的其他任务）。 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** aborted 信号 → ABORTED 哨兵 promise（已 aborted 立即 resolve）。 */
function abortSignal(signal) {
  if (signal.aborted) return Promise.resolve(ABORTED)
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(ABORTED), { once: true })
  })
}
