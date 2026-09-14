/**
 * dsh-my-notify — SSE 客户端集合 + 通知构造 + 同类去重窗口 + 心跳。
 *
 * createNoticeBus 创建共享通知总线：所有订阅客户端（Set）、去重记录
 * （Map）与心跳定时器都归总线所有；emitNotice 构造通知帧并广播。
 * 内部函数均取显式 state，避免超长闭包工厂。
 */

import type { NoticeBus, NoticeFrame, NotifyOptions, QuietHours, SseClient, TokenUsage } from './types.js'

/** 通知总线内部状态。 */
interface NoticeBusState {
  clients: Set<SseClient>
  recent: Map<string, number>
  heartbeatTimer: ReturnType<typeof setInterval> | null
}

/** 创建通知总线：持有客户端集合、去重窗口与心跳定时器。 */
export function createNoticeBus(options: NotifyOptions): NoticeBus {
  const state: NoticeBusState = {
    clients: new Set(), // { response }
    recent: new Map(), // `${kind}:${sessionId ?? ''}` -> lastPushTime
    heartbeatTimer: null,
  }
  return {
    clients: state.clients,
    emitNotice: (notice: NoticeFrame) => emitNotice(state, options, notice),
    startHeartbeat: () => startHeartbeat(state),
    stopHeartbeat: () => stopHeartbeat(state),
  }
}

/** 广播一条通知到所有已订阅客户端（逐条容忍失败，失败即摘除）。 */
function broadcast(state: NoticeBusState, notice: NoticeFrame): void {
  const payload = `data: ${JSON.stringify(notice)}\n\n`
  for (const client of [...state.clients]) {
    try {
      client.response.write(payload)
    } catch {
      state.clients.delete(client)
      try {
        client.response.destroy()
      } catch {
        /* ignore */
      }
    }
  }
}

/** 构造通知并广播（同类同会话在去重窗口内只推一次）。 */
function emitNotice(state: NoticeBusState, options: NotifyOptions, notice: NoticeFrame): void {
  const key = `${notice.kind}:${notice.sessionId ?? ''}`
  const now = Date.now()
  if (state.recent.has(key) && now - state.recent.get(key)! < options.dedupeMs) return
  evictStale(state, options, now)
  state.recent.set(key, now)
  broadcast(state, noticeFrame(notice, now))
}

/** 淘汰过期去重条目，避免 Map 无限增长。 */
function evictStale(state: NoticeBusState, options: NotifyOptions, now: number): void {
  if (state.recent.size <= 128) return
  for (const [k, t] of state.recent) {
    if (now - t >= options.dedupeMs) state.recent.delete(k)
  }
}

/** 构造 SSE 通知帧（字段规整，缺失回退空串；agentType 默认 top）。 */
function noticeFrame(notice: NoticeFrame, now: number): NoticeFrame {
  return {
    type: 'notice' as unknown as NoticeFrame['kind'],
    kind: notice.kind,
    sessionId: str(notice.sessionId),
    title: str(notice.title),
    note: str(notice.note),
    toolName: str(notice.toolName),
    agentType: notice.agentType === 'subagent' ? 'subagent' : 'top',
    time: now,
    tokens: normalizeTokens(notice.tokens),
    duration: numOrNull(notice.duration),
    sessionUrl: str(notice.sessionUrl),
    question: str(notice.question),
    questions: Array.isArray(notice.questions) ? notice.questions : [],
  } as NoticeFrame & { type: string }
}

/** 字符串字段规整：缺失/非字符串回退空串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 数值字段规整：非数字/非有限回退 null。 */
function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** token 计量规整：{ input, output, total } 均为非负数字；缺失/非法 → null。 */
function normalizeTokens(tokens: unknown): TokenUsage | null {
  if (tokens === null || typeof tokens !== 'object') return null
  const t = tokens as Record<string, unknown>
  const input = numberOrZero(t.input)
  const output = numberOrZero(t.output)
  const total = numberOrZero(t.total)
  if (input === 0 && output === 0 && total === 0) return null
  return { input, output, total }
}

/** 非负数值，非法回退 0。 */
function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 启动 SSE 心跳（空闲连接保活；仅首次启动，幂等）。 */
function startHeartbeat(state: NoticeBusState): void {
  if (state.heartbeatTimer !== null) return
  state.heartbeatTimer = setInterval(() => {
    for (const c of [...state.clients]) {
      try {
        c.response.write(': ping\n\n')
      } catch {
        state.clients.delete(c)
      }
    }
  }, 25_000)
}

/** 停止心跳（幂等；卸载时调用）。 */
function stopHeartbeat(state: NoticeBusState): void {
  if (state.heartbeatTimer !== null) {
    clearInterval(state.heartbeatTimer)
    state.heartbeatTimer = null
  }
}

// ── 免打扰时间段（quiet hours）─────────────────────────────────────────────

/**
 * 判断当前时间是否在免打扰时段内（支持跨午夜）。
 *
 * 逻辑：
 *  - quietHours 未启用 → false（不免打扰）
 *  - start <= end（如 "08:00"-"18:00"）→ 当前分钟在 [start, end) 内即为免打扰
 *  - start >  end（如 "23:00"-"08:00"，跨午夜）→ 当前分钟 >= start 或 < end 即为免打扰
 *
 * @example
 *   isQuietNow({ enabled: true, start: '23:00', end: '08:00' }) // 23:15 → true
 *   isQuietNow({ enabled: true, start: '23:00', end: '08:00' }) // 12:00 → false
 *   isQuietNow({ enabled: false, start: '23:00', end: '08:00' }) // 23:15 → false
 */
export function isQuietNow(quietHours: QuietHours, now: Date = new Date()): boolean {
  if (!quietHours.enabled) return false
  const current = now.getHours() * 60 + now.getMinutes()
  const start = parseHHmm(quietHours.start)
  const end = parseHHmm(quietHours.end)
  if (start === -1 || end === -1) return false // 非法时间串不拦截
  if (start === end) return false // 空区间：start === end 无免打扰
  if (start < end) {
    // 同日区间：[start, end)
    return current >= start && current < end
  }
  // 跨午夜：[start, 24:00) ∪ [00:00, end)
  return current >= start || current < end
}

/** "HH:mm" → 分钟数（0-1439）；非法返回 -1。 */
function parseHHmm(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value)
  if (!m) return -1
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return -1
  return h * 60 + min
}
