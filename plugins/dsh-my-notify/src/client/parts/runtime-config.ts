/** toast 默认配置（server 未返回 / 拉取失败时使用；与 notify/config.ts 的 DEFAULT_TOAST 对齐）。 */
const DEFAULT_TOAST_CONFIG = { enabled: true, durationMs: 4000, position: 'bottom-right', maxStack: 3 }

/** toast 允许的位置（与服务端枚举一致）。 */
const TOAST_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top', 'bottom']

/** 系统通知默认配置（与服务端 DEFAULT_SYSTEM 对齐）。 */
const DEFAULT_SYSTEM_CONFIG = { enabled: true, requireInteraction: false }

/** 模块级配置缓存（拉取一次，避免每条通知都打一次 config 接口）。 */
let toastConfigCache: { enabled: boolean; durationMs: number; position: string; maxStack: number } | null = null

let soundEnabledCache: boolean | null = null

let soundVolumeCache: number | null = null

let systemConfigCache: { enabled: boolean; requireInteraction: boolean } | null = null

let toastConfigRequested = false

/** 保存配置后失效缓存：下一次通知 / 下一次 toast 立即读到新值（无需刷新页面）。 */
function invalidateRuntimeConfig(): void {
  toastConfigCache = null
  soundEnabledCache = null
  soundVolumeCache = null
  systemConfigCache = null
  toastConfigRequested = false
}

/** toast 位置（非法 / 缺失回退默认）。 */
function toastPositionOf(source: Record<string, unknown>): string {
  const position = source.position
  return typeof position === 'string' && TOAST_POSITIONS.indexOf(position) >= 0
    ? position
    : DEFAULT_TOAST_CONFIG.position
}

/** toast 数值字段（非有限 / 越界回退默认，按整数取值）。 */
function toastNumberIn(source: Record<string, unknown>, key: string, fallback: number, min: number): number {
  const value = Number(source[key])
  if (!Number.isFinite(value) || value < min) return fallback
  return Math.round(value)
}

/** 从 server 配置里取 toast 设置（坏字段逐个回退默认值，绝不抛错）。 */
function toastConfigOf(config: unknown): { enabled: boolean; durationMs: number; position: string; maxStack: number } {
  const raw = config !== null && config !== undefined ? (config as Record<string, any>).toast : undefined
  const source: Record<string, unknown> = raw !== null && raw !== undefined && typeof raw === 'object' ? raw : {}
  return {
    enabled: source.enabled !== false,
    durationMs: Math.min(
      60_000,
      Math.max(1000, toastNumberIn(source, 'durationMs', DEFAULT_TOAST_CONFIG.durationMs, 1000)),
    ),
    position: toastPositionOf(source),
    maxStack: Math.min(10, toastNumberIn(source, 'maxStack', DEFAULT_TOAST_CONFIG.maxStack, 1)),
  }
}

/** 从 server 配置里取系统通知设置（常驻 / 启用；坏值回退默认）。 */
function systemConfigOf(config: any): { enabled: boolean; requireInteraction: boolean } {
  const system = config !== null && config !== undefined ? config.system : undefined
  if (system === null || system === undefined || typeof system !== 'object') return { ...DEFAULT_SYSTEM_CONFIG }
  return {
    enabled: system.enabled !== false,
    requireInteraction: system.requireInteraction === true,
  }
}

/** 从 server 配置里取提示音音量（0~1；坏值回退 0.6）。 */
function soundVolumeOf(config: any): number {
  const sound = config !== null && config !== undefined ? config.sound : undefined
  const volume = sound !== null && sound !== undefined && typeof sound === 'object' ? Number(sound.volume) : Number.NaN
  return Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 0.6
}

/**
 * 启动时把 server 配置播种到 localStorage（只写缺失的键，已有现场选择不覆盖）。
 *
 * 为什么：所有运行时 gate 统一读本地键（stream 弹窗 / beep / toast），
 * server 配置是持久化真相——不播种会出现「新浏览器 + 服务端关着却照弹照响」。
 */
function seedRuntimePrefs(config: any): void {
  seedPref(LS.notify, systemConfigOf(config).enabled)
  seedPref(LS.sound, soundEnabledOf(config))
  seedPref(LS.toast, toastConfigOf(config).enabled)
  seedPrefNum(LS.volume, soundVolumeOf(config))
}

/** 应用一份配置（拉取与单测共用）：写缓存 + 播种本地键。 */
function applyRuntimeConfig(config: any): void {
  toastConfigCache = toastConfigOf(config)
  soundEnabledCache = soundEnabledOf(config)
  soundVolumeCache = soundVolumeOf(config)
  systemConfigCache = systemConfigOf(config)
  seedRuntimePrefs(config)
}

/** 拉取一次运行时配置（非浏览器 / 请求失败时保持默认值，不打断通知路径）。 */
function loadRuntimeConfig(): void {
  if (toastConfigRequested || toastConfigCache !== null) return
  if (typeof fetch !== 'function') return
  toastConfigRequested = true
  fetch('/notify/api/config')
    .then((res) => res.json())
    .then((body) => {
      if (body !== null && body !== undefined && body.ok === true) applyRuntimeConfig(body.value)
    })
    .catch(() => {
      // 配置是增强信息：拉取失败时沿用默认值（toast 位置/时长、常驻、音量）
    })
}

/** 当前生效的 toast 配置（缓存 → 默认值）。 */
function toastConfigNow(): { enabled: boolean; durationMs: number; position: string; maxStack: number } {
  return toastConfigCache !== null ? toastConfigCache : DEFAULT_TOAST_CONFIG
}

/** 从 server 配置里取「提示音是否启用」（运行时 gate 的默认值；坏值回退 true）。 */
function soundEnabledOf(config: any): boolean {
  const sound = config !== null && config !== undefined ? config.sound : undefined
  if (sound === null || sound === undefined || typeof sound !== 'object') return true
  return sound.enabled !== false
}

/** 当前生效的提示音启用态（缓存 → 默认 true；gate 仍以本地键为准）。 */
function soundEnabledNow(): boolean {
  return soundEnabledCache !== null ? soundEnabledCache : true
}

/** 当前生效的提示音音量（缓存 → 默认 0.6；本地键缺失时的回退值）。 */
function soundVolumeNow(): number {
  return soundVolumeCache !== null ? soundVolumeCache : 0.6
}

/** 当前生效的系统通知配置（缓存 → 默认值）。 */
function systemConfigNow(): { enabled: boolean; requireInteraction: boolean } {
  return systemConfigCache !== null ? systemConfigCache : DEFAULT_SYSTEM_CONFIG
}
