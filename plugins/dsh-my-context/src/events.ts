/**
 * dsh-my-context — event listeners.
 *
 * 只读观察 DSH 会话事件并统计上下文（不改变流程）：
 *  - `session/event` (session, event)：处理 request/header（system+tools
 *    估算）、request/context（模型/上下文窗口）、user/message（user/inject
 *    构成）、assistant/message（assistant 构成 + 真实 usage 记录请求）、
 *    tool/result（tool 构成）、turn/start（轮内计数重置）；
 *  - `agent/pre-step` (payload, next)：预算拦截点——超限时 warn 记录告警
 *    透传 next()，deny 返回 { kind: 'reject' } 结束本轮（blocked）。
 *
 * ⚠️ waterfall 契约：agent/pre-step 监听器必须先 await next() 拿到下游
 * 决策再决定是否覆盖；warn 模式一律原样返回下游决策。绝不吞掉 next()。
 */
import { estimateMessage, estimateSystem, estimateTools, isEmptyMessage } from './meter.js'
import { checkBudget } from './budget.js'
import { overflowLevel, isOverflowing } from './overflow.js'
import type { DshContext } from './types.js'

/** Store 类型定义 */
export interface StoreType {
  updateHeader: (sessionId: string, header: Record<string, unknown>) => void
  updateContext: (sessionId: string, info: Record<string, unknown>) => void
  addMessage: (sessionId: string, category: string, tokens: number) => void
  recordRequest: (sessionId: string, request: Record<string, unknown>) => void
  startTurn: (sessionId: string, turn: number) => void
  recordAlert: (sessionId: string, alert: Record<string, unknown>) => void
  recordOverflow: (sessionId: string, overflow: Record<string, unknown>) => void
  session: (sessionId: string) => Record<string, unknown> | undefined
  sessions: () => Array<Record<string, unknown>>
  dispose: () => void
  [key: string]: unknown // 允许索引访问
}

/** 告警冷却（同一会话同一 scope 的重复告警间隔，防刷屏）。 */
const ALERT_COOLDOWN_MS = 60000

/** 注册全部上下文监听；返回 disposer 数组（全部经 ctx.on 注册）。 */
export function attachContextListeners(
  ctx: DshContext,
  store: StoreType,
  options: {
    current: { perTurn: number; perSession: number; mode: 'warn' | 'deny' }
    overflow: { warnThreshold: number; alertThreshold: number }
  },
): Array<() => void> {
  const cooldown = new Map<string, number>()
  const overflowCooldown = new Map<string, number>()
  return [
    ctx.on('session/event', (...args: unknown[]) => {
      const [session, event] = args
      handleSessionEvent(session, event, store)
    }),
    ctx.on('agent/pre-step', (...args: unknown[]) => {
      const [payload, next] = args
      return handlePreStep(payload, next as () => Promise<unknown>, store, options, cooldown, overflowCooldown)
    }),
  ]
}

/** session/event → 上下文统计（只读观察，无返回值）。 */
function handleSessionEvent(session: unknown, event: unknown, store: StoreType): void {
  const sessionId = (session as Record<string, unknown>)?.id
  if (typeof sessionId !== 'string' || sessionId === '') return
  const handler = EVENT_HANDLERS[(event as Record<string, unknown>)?.type as string]
  if (handler !== undefined) handler(store, sessionId, (event as Record<string, unknown>)?.data)
}

/** 事件类型 → 处理器映射（switch 替代，控制复杂度）。 */
const EVENT_HANDLERS: Record<string, (store: StoreType, sessionId: string, data: unknown) => void> = {
  'request/header': (store, sessionId, data) => handleHeader(store, sessionId, data),
  'request/context': (store, sessionId, data) =>
    store.updateContext(sessionId, {
      model: (data as Record<string, unknown>)?.model,
      provider: (data as Record<string, unknown>)?.provider,
      contextWindow: (data as Record<string, unknown>)?.contextWindow,
    }),
  'user/message': (store, sessionId, data) =>
    store.addMessage(
      sessionId,
      isInjection((data as Record<string, unknown>)?.source) ? 'inject' : 'user',
      estimateMessage(data),
    ),
  'assistant/message': (store, sessionId, data) => handleAssistant(store, sessionId, data),
  'tool/result': (store, sessionId, data) =>
    store.addMessage(sessionId, 'tool', estimateMessage((data as Record<string, unknown>)?.message)),
  'turn/start': (store, sessionId, data) =>
    store.startTurn(sessionId, (data as Record<string, unknown>)?.turn as number),
}

/** request/header：system prompt + tools 估算 + 模型路由。 */
function handleHeader(store: StoreType, sessionId: string, data: unknown): void {
  const header = (data as Record<string, unknown>)?.header as Record<string, unknown>
  if (header === null || typeof header !== 'object') return
  const system = typeof header.system === 'string' ? header.system : ''
  const tools = Array.isArray(header.tools) ? header.tools : []
  store.updateHeader(sessionId, {
    system,
    tools,
    systemTokens: estimateSystem(system),
    toolsTokens: estimateTools(tools),
    model: (header.config as Record<string, unknown>)?.model,
    provider: (header.config as Record<string, unknown>)?.provider,
  })
}

/** assistant/message：assistant 构成 + 真实 usage 记录请求。 */
function handleAssistant(store: StoreType, sessionId: string, data: unknown): void {
  const message = (data as Record<string, unknown>)?.message
  if (!isEmptyMessage(message)) store.addMessage(sessionId, 'assistant', estimateMessage(message))
  if (
    (data as Record<string, unknown>)?.usage !== null &&
    typeof (data as Record<string, unknown>)?.usage === 'object'
  ) {
    store.recordRequest(sessionId, {
      turn: (data as Record<string, unknown>).turn,
      step: (data as Record<string, unknown>).step,
      usage: (data as Record<string, unknown>).usage,
    })
  }
}

/** agent/pre-step：预算检查 → warn 告警 / deny 拦截；溢出预警（不阻塞）。 */
async function handlePreStep(
  payload: unknown,
  next: () => Promise<unknown>,
  store: StoreType,
  options: {
    current: { perTurn: number; perSession: number; mode: 'warn' | 'deny' }
    overflow: { warnThreshold: number; alertThreshold: number }
  },
  cooldown: Map<string, number>,
  overflowCooldown: Map<string, number>,
): Promise<unknown> {
  const sessionId = ((payload as Record<string, unknown>)?.agent as Record<string, unknown>)?.id as string
  if (typeof sessionId !== 'string' || sessionId === '') return next()
  const session = store.session(sessionId) as Record<string, unknown> | undefined
  if (session === undefined) return next()
  recordOverflowIfNeeded(store, session, options, overflowCooldown)
  const decision = checkBudget(
    session.usage as Record<string, unknown>,
    session.turnUsage as Record<string, unknown>,
    options.current,
  )
  if (decision.ok) return next()
  const blocked = options.current.mode === 'deny'
  if (withinCooldown(cooldown, sessionId, decision.scope)) {
    return blocked ? { kind: 'reject' } : next()
  }
  cooldown.set(`${sessionId}:${decision.scope}`, Date.now())
  store.recordAlert(sessionId, {
    kind: 'budget',
    scope: decision.scope,
    limit: decision.limit,
    used: decision.used,
    mode: options.current.mode,
    blocked,
  })
  return blocked ? { kind: 'reject' } : next()
}

/** 溢出分级命中预警级别时记录预警事件（同一会话同一级别 60s 冷却）。 */
function recordOverflowIfNeeded(
  store: StoreType,
  session: Record<string, unknown>,
  options: {
    current: { perTurn: number; perSession: number; mode: 'warn' | 'deny' }
    overflow: { warnThreshold: number; alertThreshold: number }
  },
  cooldown: Map<string, number>,
): void {
  // 口径 = 当前上下文长度（最近一次请求 prompt），而非历史累计 usage：
  // 累计 usage 中 cacheRead 每轮重复累加，会把占用虚高到数倍于窗口。
  const outcome = overflowLevel(session.lastPromptTokens, session.contextWindow, options.overflow)
  if (!isOverflowing(outcome.level)) return
  const scope = `overflow:${outcome.level}`
  if (withinCooldown(cooldown, session.sessionId as string, scope)) return
  cooldown.set(`${session.sessionId}:${scope}`, Date.now())
  store.recordOverflow(session.sessionId as string, {
    kind: 'overflow',
    level: outcome.level,
    ratio: outcome.ratio,
    used: outcome.used,
    window: outcome.window,
    threshold: outcome.threshold,
  })
}

/** 告警冷却判定：冷却期内返回 true（不重复记录）。 */
function withinCooldown(cooldown: Map<string, number>, sessionId: string, scope: string): boolean {
  const last = cooldown.get(`${sessionId}:${scope}`)
  return typeof last === 'number' && Date.now() - last < ALERT_COOLDOWN_MS
}

/** 注入判定：source.kind 非 'user' 或带 form 的注入来源。 */
export function isInjection(source: unknown): boolean {
  return (
    source !== null &&
    typeof source === 'object' &&
    ((typeof (source as Record<string, unknown>).kind === 'string' &&
      (source as Record<string, unknown>).kind !== '' &&
      (source as Record<string, unknown>).kind !== 'user') ||
      typeof (source as Record<string, unknown>).form === 'string')
  )
}
