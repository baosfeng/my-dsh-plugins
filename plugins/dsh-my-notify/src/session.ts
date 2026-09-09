/**
 * dsh-my-notify — 会话信息 helper。
 *
 * 从 agent/session 结构提取通知所需信息：顶层会话判定、会话标题
 * （sessionTitle 快照 → cwd 末段 → 空串）、ask 问题摘要。全部为纯函数，
 * 尽力而为——任何失败都降级为安全默认值，绝不打断通知路径。
 */

import type { Agent, DshContext, SessionTitleService, SessionTitleSnapshot } from './types.js'

/**
 * 顶层会话判定（黑名单化）：只有明确无任何子代理标记的会话才视为顶层。
 *
 * 子代理标记分三层（任一命中即子代理，避免被误判为顶层绕过 `subagentEnd`）：
 *  - 持久化 header：`origin === 'subagent'`、`delegationDepth > 0`；
 *  - 运行时 `agent.options.subagentDepth > 0`：DSH 官方所有子代理形态
 *    （subagent / subagent_fork / workflow worker / ralph worker）创建时都
 *    经 dsh-subagent 服务设置该字段，即使 header 未持久化 origin /
 *    delegationDepth（fork 继承、工作流 worker 等漏网形态）也能识别；
 *  - 持久化 header `parentSession`（父会话派生标记）：workflow/ralph worker
 *    等经 fork-in-process 派生的子会话即使漏写 origin/delegationDepth 也
 *    携带父会话 id，据其识别为派生会话而非顶层（issue #112）。
 *
 * 结构不完整（无 session/header）无法确认 → 保守视为子代理，不通知。
 */
export function isTopLevelAgent(agent: unknown): boolean {
  if (agent === null || typeof agent !== 'object') return false
  const a = agent as Agent
  const header = a.session?.header
  if (header === undefined || header === null) return false
  return !hasSubagentMarker(header, a.options)
}

/** 任一子代理标记命中即子代理（header 持久化标记 + 运行时深度 + 派生父会话）。 */
function hasSubagentMarker(
  header: { origin?: string; delegationDepth?: number; parentSession?: string },
  options?: { subagentDepth?: number },
): boolean {
  if (header.origin === 'subagent') return true
  if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0) return true
  if (typeof options?.subagentDepth === 'number' && options.subagentDepth > 0) return true
  return typeof header.parentSession === 'string' && header.parentSession !== ''
}

/** 子代理通知标题：前缀「子代理」+ 会话标题/短 id（尽力而为，绝不空串）。 */
export function subagentTitleOf(ctx: DshContext, agent: unknown): string {
  const base = titleOf(ctx, agent)
  const a = agent as Agent | undefined
  const id = typeof a?.id === 'string' ? a.id : ''
  const short = id.length > 8 ? id.slice(0, 8) : id
  const label = base !== '' ? base : short
  return label !== '' ? `子代理 ${label}` : '子代理'
}

/** 会话标题：优先 sessionTitle 快照，回退 cwd 末段，再回退空串（由 client 显示短 id）。 */
export function titleOf(ctx: DshContext, agent: unknown): string {
  try {
    const a = agent as Agent | undefined
    const session = a?.session
    const snapshotTitle = titleSnapshot(ctx, session)
    if (snapshotTitle !== '') return snapshotTitle
    return cwdName(session)
  } catch {
    // title is best-effort; never let lookup break the notice path
    return ''
  }
}

/** sessionTitle 快照标题（失败或缺失返回空串；异常向上传播由 titleOf 兜底）。 */
function titleSnapshot(ctx: DshContext, session: unknown): string {
  // 可选服务必须经 ctx.get 读取（未注入时直接属性访问在 Cordis 上不可靠）
  const titleService = ctx.get ? (ctx.get('sessionTitle') as SessionTitleService | undefined) : undefined
  const snapshot: SessionTitleSnapshot | undefined = titleService?.get?.(session)
  if (snapshot !== undefined && snapshot !== null && typeof snapshot.title === 'string' && snapshot.title !== '') {
    return snapshot.title
  }
  return ''
}

/** cwd 末段作为标题回退（去尾斜杠；无 cwd 返回空串）。 */
function cwdName(session: unknown): string {
  const s = session as { header?: { cwd?: string } } | undefined
  const cwd = s?.header?.cwd
  if (typeof cwd === 'string' && cwd !== '') {
    const norm = cwd.replace(/\/+$/, '')
    const idx = norm.lastIndexOf('/')
    const name = idx === -1 ? norm : norm.slice(idx + 1)
    if (name !== '') return name
  }
  return ''
}

/** ask 参数摘要：取第一个问题的 header/question 首行（尽力而为）。 */
export function askNoteOf(argumentsValue: unknown): string {
  try {
    const args = argumentsValue as { questions?: unknown[] } | undefined
    const questions = args?.questions
    if (!Array.isArray(questions) || questions.length === 0) return ''
    return noteOfFirstQuestion(questions[0])
  } catch {
    // ignore
  }
  return ''
}

/** 第一个问题的摘要：header 优先，否则 question 首行（截断 80 字符）。 */
function noteOfFirstQuestion(first: unknown): string {
  if (first === null || typeof first !== 'object') return ''
  const f = first as { header?: string; question?: string }
  if (typeof f.header === 'string' && f.header !== '') return f.header
  if (typeof f.question === 'string' && f.question !== '') {
    const line = f.question.split('\n')[0]!
    return line.length > 80 ? `${line.slice(0, 80)}…` : line
  }
  return ''
}

/** 完整问题列表：每个问题用 header 优先，否则完整 question（不截断，多问题全部）。 */
export function askQuestionsOf(argumentsValue: unknown): string[] {
  const args = argumentsValue as { questions?: unknown[] } | undefined
  const questions = args?.questions
  if (!Array.isArray(questions) || questions.length === 0) return []
  return questions.map(fullQuestionOf).filter((q) => q !== '')
}

/** 完整问题文本：多问题用「问题 N：…」序号连接（空列表返回空串）。 */
export function askFullNoteOf(argumentsValue: unknown): string {
  const list = askQuestionsOf(argumentsValue)
  if (list.length === 0) return ''
  const numbered = list.map((q, idx) => `问题 ${idx + 1}：${q}`)
  return numbered.join('\n')
}

/** 单个问题的完整文本：header 优先，回退完整 question（不做任何截断）。 */
function fullQuestionOf(question: unknown): string {
  if (question === null || typeof question !== 'object') return ''
  const q = question as { header?: string; question?: string }
  if (typeof q.header === 'string' && q.header !== '') return q.header
  if (typeof q.question === 'string' && q.question !== '') return q.question
  return ''
}
