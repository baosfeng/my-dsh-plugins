/**
 * dsh-task-reliability — 输出未完成自动救场（issue #147）。
 *
 * 依赖 text.js（lastAssistantText/isTopLevelAgent）、util.js（userMessage）
 * 与 constants.js（RESCUE_CONTINUE_TEXT）。普通对话（无活动任务、无循环）
 * 中回合因 max-tokens 截断 / 异常结束且输出不完整时，注入继续指令补完。
 *
 * 信号链（DSH 回合结束机制调研结论，详见 PR #147 描述）：
 *  - `agent/turn-stopping` payload 只有 { agent, turn, signal }，不含
 *    stopReason；turn/end 的权威 reason 在 turn-stopping 之后才写入日志。
 *  - max-tokens 截断的实时信号：`llm/stream` 的 finish chunk
 *    （FinishReason.kind === 'max-tokens'），由 repeat.js 的
 *    wrapStreamForLoop 捕获到会话级 repeatState.lastFinish（与 agent-loop
 *    判定 turnEnds 同源）。
 *  - error 不触发 turn-stopping（agent-loop 直接抛错）：由 `agent/error`
 *    事件标记（markAgentError），`agent/status` idle 时消费
 *    （rescueAfterError，followup 唤醒新回合）。
 *  - aborted：signal.aborted 已在 events.js 前置检查，永不救场。
 *
 * 判定矩阵（issue #147）：
 *  - 文本完整（围栏/表格/公式闭合、段落结尾完整）→ 不救场；
 *  - 未闭合围栏/表格/公式或半句 → 救场（受 rescueMaxPerSession +
 *    rescueCooldownMs 约束）；
 *  - 有活动任务 → 走既有 continueTask（events.js 分支，本模块不介入）；
 *  - 无任务无 todo 文本信号弱 → 不自动救场。
 *  - todo 清单存在 pending/in_progress 项是「任务进行中」信号：截断时
 *    即使文本完整也救场。
 */

import { lastAssistantText, isTopLevelAgent } from './text.js'
import { userMessage } from './util.js'
import { RESCUE_CONTINUE_TEXT } from './constants.js'

// ── 输出完整度启发式（纯规则，零成本）────────────────────────────────────

const SENTENCE_END = /[。！？；：.!?;:）)\]"'」』]$/
const LIST_MARK = /^\s*(?:[-*+]|\d+[.)]|\[[ xX]\])\s+/
const TABLE_SEPARATOR = /^\|?[\s:|-]+\|[\s:|-]+\|?$/

function lastNonEmptyLine(text) {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== '') return lines[i]
  }
  return ''
}

/** 表格未闭合判定：表头分隔行结尾，或含 | 的长行被截断（不以 | 结尾）。 */
function tableTruncated(lastLine) {
  if (!lastLine.includes('|')) return false
  if (lastLine.endsWith('|')) return TABLE_SEPARATOR.test(lastLine)
  return lastLine.length > 10
}

/** 半句判定：非列表项、无结尾标点、长度超过阈值。 */
function sentenceTruncated(lastLine) {
  if (LIST_MARK.test(lastLine)) return false
  if (SENTENCE_END.test(lastLine)) return false
  return lastLine.length > 30
}

/**
 * 输出完整度启发式：未闭合代码围栏 / 公式块 / 表格，或结尾停在半句
 * 视为「输出未完成」。保守设计（低误报）：完整表格行、列表项、短句、
 * 空文本均不判未完成。
 */
export function isOutputTruncated(text) {
  if (typeof text !== 'string' || text === '') return false
  if ((text.match(/```/g) ?? []).length % 2 === 1) return true
  if ((text.match(/\$\$/g) ?? []).length % 2 === 1) return true
  const lastLine = lastNonEmptyLine(text).trimEnd()
  if (lastLine === '') return false
  if (tableTruncated(lastLine)) return true
  return sentenceTruncated(lastLine)
}

/** 会话事件里最后一条 todo/write 快照是否存在未完成项（pending/in_progress）。 */
export function todoHasPending(events) {
  if (!Array.isArray(events)) return false
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event === null || typeof event !== 'object' || event.type !== 'todo/write') continue
    const todos = event.data?.todos
    if (!Array.isArray(todos)) return false
    return todos.some((todo) => todo?.status === 'pending' || todo?.status === 'in_progress')
  }
  return false
}

// ── 会话级 rescue 状态（内存态，不持久化）─────────────────────────────────

/** 惰性创建会话 rescue 状态（count 累计 + 上次救场时间）。 */
function rescueStateOf(sessionId, shared) {
  let state = shared.rescueStates.get(sessionId)
  if (state === undefined) {
    state = { count: 0, lastRescueAt: 0 }
    shared.rescueStates.set(sessionId, state)
  }
  return state
}

/** 救场许可：开关 + 每会话次数上限 + 冷却（防「截断→继续→再截断」死循环）。 */
function rescueAllowed(state, options, now = Date.now()) {
  if (options.rescueOnTruncation !== true) return false
  if (state.count >= options.rescueMaxPerSession) return false
  if (now - state.lastRescueAt < options.rescueCooldownMs) return false
  return true
}

/** 记录一次救场（计数 + 刷新冷却时间）。 */
function recordRescue(state, now = Date.now()) {
  state.count += 1
  state.lastRescueAt = now
}

// ── 决策与动作 ────────────────────────────────────────────────────────────

/**
 * turn-stopping 无任务救场（events.js 在无任务无循环时调用）：
 * 截断信号（lastFinish = max-tokens）或输出不完整启发式命中 → steer 注入
 * 补完指令。文本完整且无 todo pending 时不救场（截断撞自然结尾）。
 */
export function rescueTurn(agent, shared) {
  const state = rescueStateOf(agent.id, shared)
  if (!rescueAllowed(state, shared.options)) return
  const repeat = shared.repeatStates.get(agent.id)
  const truncated = repeat?.lastFinish?.kind === 'max-tokens'
  const incomplete = isOutputTruncated(lastAssistantText(agent.session))
  if (!incomplete && !(truncated && todoHasPending(agent.session?.events))) return
  try {
    agent.steer(userMessage(RESCUE_CONTINUE_TEXT))
  } catch {
    return
  }
  recordRescue(state)
}

/**
 * 回合 error 事后救场（events.js 在 status idle 且无任务时调用）：
 * 消费 agent/error 标记（一次性），输出不完整或 todo pending → followup
 * 唤醒新回合补完。error 不触发 turn-stopping，只能事后救场。
 */
export function rescueAfterError(agent, shared) {
  const markAt = shared.errorMarks.get(agent.id)
  if (markAt === undefined) return
  shared.errorMarks.delete(agent.id)
  const state = rescueStateOf(agent.id, shared)
  if (!rescueAllowed(state, shared.options)) return
  const incomplete = isOutputTruncated(lastAssistantText(agent.session))
  if (!incomplete && !todoHasPending(agent.session?.events)) return
  try {
    agent.followup(userMessage(RESCUE_CONTINUE_TEXT))
  } catch {
    return
  }
  recordRescue(state)
}

/** agent/error 监听：仅顶层会话标记（子代理错误不救场）。 */
export function markAgentError(agent, shared) {
  if (!isTopLevelAgent(agent)) return
  shared.errorMarks.set(agent.id, Date.now())
}
