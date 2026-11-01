/**
 * dsh-my-notify — 高级配置的默认值与 fail-open 规整（sound / toast /
 * system / messages / 渠道模板 / 卡片 / 重试）。
 *
 * 统一约束：
 *  - **坏字段回退默认值**：类型不符、越界、非法枚举一律替换为默认值，而不是
 *    整体拒绝——配置读的是 cordis.patch.yml 与 JSON 文件，手写错误不应让
 *    推送路径抛错或整条通知消失；
 *  - **不吞掉合法字段**：一次 payload 里坏一个字段只影响该字段，其余照常生效；
 *  - 全部纯函数，无 IO，便于单测。
 */
import type { CardConfig, MessagesConfig, RetryConfig, SoundConfig, SystemConfig, ToastConfig } from '../types.js'

/** 允许的提示音预设（与 client 实播音色一致）。 */
const SOUND_PRESETS = ['chime', 'drop', 'deep'] as const

/** 提示音默认值（默认开启 chime：通知到即响；与 client 面板显示/实播一致）。 */
const DEFAULT_SOUND: SoundConfig = { enabled: true, preset: 'chime', volume: 0.6 }

/** 页面 toast 默认值（默认开启，右上角 4 秒，最多 3 条）。 */
const DEFAULT_TOAST: ToastConfig = { enabled: true, durationMs: 4000, position: 'top-right', maxStack: 3 }

/** 系统通知默认值（默认开启，不常驻）。 */
const DEFAULT_SYSTEM: SystemConfig = { enabled: true, requireInteraction: false }

/** toast 允许的位置枚举。 */
const TOAST_POSITIONS = new Set<ToastConfig['position']>([
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
  'top',
  'bottom',
])

/** 卡片允许的 schema 版本。 */
const SCHEMA_VERSIONS = new Set(['2.0', '1.0'])

/** 规整对象型配置：非对象回退空对象（调用方再填默认值）。 */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** 布尔取值：非布尔回退默认。 */
function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 数值取值：非有限或越界回退默认。 */
function pickNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** 字符串取值：非字符串 / 空串回退默认。 */
function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

/** 字符串数组规整：非数组回退默认；元素去空白、去空项、去重、限长。 */
function pickStringList(value: unknown, fallback: string[], limit: number): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (text === '' || seen.has(text)) continue
    seen.add(text)
    result.push(text)
    if (result.length >= limit) break
  }
  return result
}

/**
 * 规整提示音配置（坏字段逐个回退默认值）。
 *
 * @example
 *   normalizeSound({ enabled: 'yes', volume: 5 })
 *   // → { enabled: true, preset: 'default', volume: 1 }
 */
export function normalizeSound(value: unknown): SoundConfig {
  const v = asRecord(value)
  return {
    enabled: pickBool(v.enabled, DEFAULT_SOUND.enabled),
    preset:
      typeof v.preset === 'string' && (SOUND_PRESETS as readonly string[]).includes(v.preset)
        ? v.preset
        : DEFAULT_SOUND.preset,
    volume: pickNumber(v.volume, DEFAULT_SOUND.volume, 0, 1),
  }
}

/**
 * 规整页面 toast 配置（位置枚举非法回退 top-right；maxStack 1-10）。
 *
 * @example
 *   normalizeToast({ position: 'middle', maxStack: 99 })
 *   // → { enabled: true, durationMs: 4000, position: 'top-right', maxStack: 10 }
 */
export function normalizeToast(value: unknown): ToastConfig {
  const v = asRecord(value)
  const position =
    typeof v.position === 'string' && TOAST_POSITIONS.has(v.position as ToastConfig['position'])
      ? (v.position as ToastConfig['position'])
      : DEFAULT_TOAST.position
  return {
    enabled: pickBool(v.enabled, DEFAULT_TOAST.enabled),
    durationMs: Math.round(pickNumber(v.durationMs, DEFAULT_TOAST.durationMs, 1000, 60_000)),
    position,
    maxStack: Math.round(pickNumber(v.maxStack, DEFAULT_TOAST.maxStack, 1, 10)),
  }
}

/**
 * 规整系统通知配置（坏字段回退默认值）。
 *
 * @example
 *   normalizeSystem({ requireInteraction: 'yes' })
 *   // → { enabled: true, requireInteraction: false }
 */
export function normalizeSystem(value: unknown): SystemConfig {
  const v = asRecord(value)
  return {
    enabled: pickBool(v.enabled, DEFAULT_SYSTEM.enabled),
    requireInteraction: pickBool(v.requireInteraction, DEFAULT_SYSTEM.requireInteraction),
  }
}

/**
 * 规整飞书卡片配置（accentByKind 默认 true；fields 去空白、限 10 项）。
 *
 * @example
 *   normalizeCard({ schemaVersion: '3.0', mentionOpenIds: ['ou_1', '', 'ou_1'] })
 *   // → { schemaVersion: '2.0', template: '', fields: [], buttonText: '', mentionOpenIds: ['ou_1'], mentionAll: false, accentByKind: true }
 */
export function normalizeCard(value: unknown): CardConfig {
  const v = asRecord(value)
  const schemaVersion =
    typeof v.schemaVersion === 'string' && SCHEMA_VERSIONS.has(v.schemaVersion)
      ? (v.schemaVersion as CardConfig['schemaVersion'])
      : '2.0'
  return {
    schemaVersion,
    template: typeof v.template === 'string' ? v.template : '',
    fields: pickStringList(v.fields, [], 10),
    buttonText: typeof v.buttonText === 'string' ? v.buttonText : '',
    mentionOpenIds: pickStringList(v.mentionOpenIds, [], 20),
    mentionAll: pickBool(v.mentionAll, false),
    accentByKind: pickBool(v.accentByKind, true),
  }
}

/**
 * 规整推送重试配置（attempts 0-10，backoffMs 100-60000）。
 *
 * @example
 *   normalizeRetry({ attempts: 99, backoffMs: 10 })
 *   // → { attempts: 10, backoffMs: 100 }
 */
export function normalizeRetry(value: unknown): RetryConfig {
  const v = asRecord(value)
  return {
    attempts: Math.round(pickNumber(v.attempts, 3, 0, 10)),
    backoffMs: Math.round(pickNumber(v.backoffMs, 1000, 100, 60_000)),
  }
}

/**
 * 规整 messages（结构非法时返回空对象，由 resolveMessages 统一填默认值）。
 *
 * @example
 *   normalizeMessages({ end: { title: '结束' }, ask: 'oops' })
 *   // → { end: { title: '结束' } }
 */
export function normalizeMessages(value: unknown): MessagesConfig {
  const v = asRecord(value)
  const result: MessagesConfig = {}
  for (const key of ['end', 'ask', 'approval', 'subagentEnd', 'remote'] as const) {
    const item = asRecord(v[key])
    const entry: { title?: string; body?: string } = {}
    if (typeof item.title === 'string' && item.title.trim() !== '') entry.title = item.title
    if (typeof item.body === 'string' && item.body.trim() !== '') entry.body = item.body
    if (entry.title !== undefined || entry.body !== undefined) result[key] = entry
  }
  return result
}
