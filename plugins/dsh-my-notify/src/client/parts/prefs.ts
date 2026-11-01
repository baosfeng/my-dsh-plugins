/** 本地偏好（localStorage 开关 / 数值 / 音色 / 音量）与事件标签。 */
const LS = {
  notify: 'dsh-notify:notify',
  sound: 'dsh-notify:sound',
  toast: 'dsh-notify:toast',
  volume: 'dsh-notify:volume',
  // 音色预设（v2 设置面板「试听」即时生效；默认清脆 = chime）
  tone: 'dsh-notify:tone',
}

/** 提示音音色：chime（清脆）/ drop（柔和水滴）/ deep（低沉）；非法值回退 chime。 */
function prefTone(): string {
  try {
    const raw = window.localStorage.getItem(LS.tone)
    if (raw === 'drop' || raw === 'deep' || raw === 'chime') return raw
  } catch {
    // 存储不可用：回退默认音色
    void 0
  }
  return 'chime'
}

function prefOn(key: string, def: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key)
    if (v === null) return def
    return v === '1'
  } catch {
    return def
  }
}

/** 写入本地布尔开关（存储不可用时静默降级为仅本次会话生效）。 */
function writePref(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // 存储不可用：仅本次会话生效
    void 0
  }
}

/** 写入本地数值开关（0~1 音量等；存储不可用时静默降级）。 */
function writePrefNum(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // 存储不可用：仅本次会话生效
    void 0
  }
}

/** 读本地数值（0~1；缺失 / 非法 / 越界回退 fallback）。 */
function prefNum(key: string, fallback: number): number {
  const def = Number.isFinite(fallback) && fallback >= 0 && fallback <= 1 ? fallback : 0.6
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return def
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 0 && value <= 1) return value
  } catch {
    // 存储不可用：回退服务端配置 / 默认值
    void 0
  }
  return def
}

/** 读原始本地键：null = 不存在，undefined = 存储不可用。 */
function readPrefRaw(key: string): string | null | undefined {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return undefined
  }
}

/** 仅当本地键不存在时写入（保留用户的现场选择）。 */
function seedPref(key: string, on: boolean): void {
  if (readPrefRaw(key) === null) writePref(key, on)
}

/** 仅当本地键不存在时写入数值（音量）。 */
function seedPrefNum(key: string, value: number): void {
  if (readPrefRaw(key) === null) writePrefNum(key, value)
}

/** 提示音音量（0~1，默认 0.6；issue #71：0.18 太小听不见）。 */
function prefVolume(): number {
  try {
    const raw = window.localStorage.getItem(LS.volume)
    if (raw === null) return 0.6
    const v = Number(raw)
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v
  } catch {
    // fall through to default
    void 0
  }
  return 0.6
}
