/**
 * dsh-my-guard — 高严重级告警通知（issue #88）。
 *
 * 高严重级告警（deny 拦截 / 密钥泄露 / 提示注入 high 等）经 dsh-my-notify
 * 推送通知（可选集成）：通过 notify 的 loopback 触发接口
 * `POST /notify/api/trigger`（可选 x-notify-token），由 notify 的 SSE
 * 通道广播到浏览器。同类型告警冷却（防刷屏）。
 *
 * 纯函数 + createNotifier：
 *  - isHighSeverity / cooldownKeyOf / buildPayload / cooldownDue — 可单测；
 *  - createNotifier({ options, baseUrl, token, send, now }) — 通知器：
 *    notifyEnabled 关闭 / 非 high / 无 baseUrl / 冷却中 → 跳过（返回原因）；
 *    否则构造 payload 经 send 异步推送，成功后更新冷却时间戳。
 *  - 默认 send 用全局 fetch 请求 loopback 触发接口；测试注入 mock send/now。
 */
import type { Alert, GuardOptions, NotifyResult, Notifier } from './types.js'

const HIGH = 'high'

/** 是否高严重级（决定是否推送）。 */
export function isHighSeverity(alert: unknown): boolean {
  return alert !== null && typeof alert === 'object' && (alert as Record<string, unknown>).severity === HIGH
}

/** 冷却键：按告警类型（同类型告警冷却，防刷屏）。 */
export function cooldownKeyOf(alert: unknown): string {
  const obj = alert as Record<string, unknown> | null | undefined
  const type = obj?.type
  return typeof type === 'string' && type !== '' ? type : 'other'
}

/** 构造 notify trigger payload（sessionId / title / body）。 */
export function buildPayload(alert: unknown): { sessionId: string; title: string; body: string } {
  const obj = alert as Record<string, unknown> | null | undefined
  const message = typeof obj?.message === 'string' ? obj.message : ''
  return {
    sessionId: typeof obj?.sessionId === 'string' ? obj.sessionId : '',
    title: `安全告警：${message}`,
    body: message,
  }
}

/** 冷却是否已到期（无记录视为到期）。 */
export function cooldownDue(lastAt: number | undefined | null, now: number, cooldownMs: number): boolean {
  if (lastAt === undefined || lastAt === null) return true
  return now - lastAt >= cooldownMs
}

/** 构造通知器。send 缺省走 fetch；now 缺省 Date.now（测试可注入）。 */
export function createNotifier({
  options,
  baseUrl,
  token,
  send,
  now,
}: {
  options: GuardOptions
  baseUrl: string
  token: string
  send?: (baseUrl: string, payload: Record<string, string>, token: string) => Promise<void>
  now?: () => number
}): Notifier {
  const lastSentAt = new Map<string, number>()
  const clock = typeof now === 'function' ? now : Date.now
  const dispatch = typeof send === 'function' ? send : defaultSend
  return {
    notify(alert: Alert): NotifyResult {
      if (options?.notifyEnabled !== true) return { sent: false, reason: 'disabled' }
      if (!isHighSeverity(alert)) return { sent: false, reason: 'not-high' }
      if (typeof baseUrl !== 'string' || baseUrl === '') return { sent: false, reason: 'no-base-url' }
      const key = cooldownKeyOf(alert)
      const nowMs = clock()
      if (!cooldownDue(lastSentAt.get(key), nowMs, options.notifyCooldownMs)) {
        return { sent: false, reason: 'cooldown' }
      }
      const payload = buildPayload(alert)
      void Promise.resolve(dispatch(baseUrl, payload as Record<string, string>, token)).catch(() => {})
      lastSentAt.set(key, nowMs)
      return { sent: true }
    },
    /** 冷却状态（测试断言：某类型的 lastSentAt / 是否被冷却）。 */
    state(): Record<string, number> {
      const map: Record<string, number> = {}
      for (const [key, value] of lastSentAt) map[key] = value
      return map
    },
  }
}

/** 默认推送：loopback 请求 notify 触发接口（可选 token）。 */
async function defaultSend(baseUrl: string, payload: Record<string, string>, token: string): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (typeof token === 'string' && token !== '') headers['x-notify-token'] = token
  await fetch(`${baseUrl}/notify/api/trigger`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
}
