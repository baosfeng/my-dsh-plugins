/**
 * dsh-my-context — context overflow warnings (pure functions).
 *
 * 上下文溢出预警：把**当前上下文长度**（最近一次请求的 prompt =
 * input + cacheRead + cacheWrite）与 contextWindow 比对，得到用量比例与
 * 分级（normal / warn / alert / critical）。
 *
 * ⚠️ 口径（issue #1xx 修复）：不能使用会话历史累计 usage——cacheRead
 * 每轮重复累加（KV 缓存命中占 prompt 大头），会把"上下文占用"虚高到
 * 数倍于窗口。溢出预警关心的是"当前上下文还差多少到窗口上限"。
 *    - warnThreshold（默认 0.8）  → level 'warn'     （进度条变色，面板可见）
 *    - alertThreshold（默认 0.9） → level 'alert'    （面板告警 + 可选推送）
 *    - CRITICAL_THRESHOLD（固定 0.95） → level 'critical'（建议开启新会话）
 * 命中阈值时由 events.js 记录溢出预警事件（时间/用量/阈值），面板可查。
 *
 * 纯函数、无副作用、可单测。
 */

/** 固定临界阈值：≥95% 建议开启新会话（不可配置）。 */
export const CRITICAL_THRESHOLD = 0.95

/** 阈值配置校验：非法值回退默认（0.8/0.9），夹到 [0,1]。 */
export function normalizeOverflowConfig(config: unknown): {
  warnThreshold: number
  alertThreshold: number
} {
  const source = config !== null && typeof config === 'object' ? (config as Record<string, unknown>) : {}
  return {
    warnThreshold: ratioOf(source.warnThreshold, 0.8),
    alertThreshold: ratioOf(source.alertThreshold, 0.9),
  }
}

/**
 * 溢出分级：返回 { ratio, used, window, level, threshold }。
 *  - used = **当前上下文长度**（最近一次请求的 prompt token 数，非历史累计）；
 *  - window = contextWindow（<=0 时 ratio=0、level normal）；
 *  - level 为 'normal'|'warn'|'alert'|'critical'；threshold 为命中的阈值
 *    （warn→warnThreshold / alert→alertThreshold / critical→CRITICAL_THRESHOLD）。
 */
export function overflowLevel(
  contextLength: unknown,
  contextWindow: unknown,
  config: unknown,
): {
  ratio: number
  used: number
  window: number
  level: 'normal' | 'warn' | 'alert' | 'critical'
  threshold: number
} {
  const overflow = normalizeOverflowConfig(config)
  const used =
    typeof contextLength === 'number' && Number.isFinite(contextLength) && contextLength > 0 ? contextLength : 0
  const window = typeof contextWindow === 'number' && contextWindow > 0 ? contextWindow : 0
  if (window <= 0) return { ratio: 0, used, window: 0, level: 'normal', threshold: 0 }
  const ratio = used / window
  if (ratio >= CRITICAL_THRESHOLD) return { ratio, used, window, level: 'critical', threshold: CRITICAL_THRESHOLD }
  if (ratio >= overflow.alertThreshold)
    return { ratio, used, window, level: 'alert', threshold: overflow.alertThreshold }
  if (ratio >= overflow.warnThreshold) return { ratio, used, window, level: 'warn', threshold: overflow.warnThreshold }
  return { ratio, used, window, level: 'normal', threshold: 0 }
}

/** 是否达到预警级别（warn/alert/critical，非 normal）。 */
export function isOverflowing(level: string): boolean {
  return level === 'warn' || level === 'alert' || level === 'critical'
}

/** 非负有限比例，夹到 [0,1]。 */
function ratioOf(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
