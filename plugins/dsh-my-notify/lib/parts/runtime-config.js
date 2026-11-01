'use strict'
const DEFAULT_TOAST_CONFIG = { enabled: true, durationMs: 4000, position: 'bottom-right', maxStack: 3 }
const TOAST_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top', 'bottom']
const DEFAULT_SYSTEM_CONFIG = { enabled: true, requireInteraction: false }
let toastConfigCache = null
let soundEnabledCache = null
let soundVolumeCache = null
let systemConfigCache = null
let toastConfigRequested = false
function invalidateRuntimeConfig() {
  toastConfigCache = null
  soundEnabledCache = null
  soundVolumeCache = null
  systemConfigCache = null
  toastConfigRequested = false
}
function toastPositionOf(source) {
  const position = source.position
  return typeof position === 'string' && TOAST_POSITIONS.indexOf(position) >= 0
    ? position
    : DEFAULT_TOAST_CONFIG.position
}
function toastNumberIn(source, key, fallback, min) {
  const value = Number(source[key])
  if (!Number.isFinite(value) || value < min) return fallback
  return Math.round(value)
}
function toastConfigOf(config) {
  const raw = config !== null && config !== undefined ? config.toast : undefined
  const source = raw !== null && raw !== undefined && typeof raw === 'object' ? raw : {}
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
function systemConfigOf(config) {
  const system = config !== null && config !== undefined ? config.system : undefined
  if (system === null || system === undefined || typeof system !== 'object') return { ...DEFAULT_SYSTEM_CONFIG }
  return {
    enabled: system.enabled !== false,
    requireInteraction: system.requireInteraction === true,
  }
}
function soundVolumeOf(config) {
  const sound = config !== null && config !== undefined ? config.sound : undefined
  const volume = sound !== null && sound !== undefined && typeof sound === 'object' ? Number(sound.volume) : Number.NaN
  return Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 0.6
}
function seedRuntimePrefs(config) {
  seedPref(LS.notify, systemConfigOf(config).enabled)
  seedPref(LS.sound, soundEnabledOf(config))
  seedPref(LS.toast, toastConfigOf(config).enabled)
  seedPrefNum(LS.volume, soundVolumeOf(config))
}
function applyRuntimeConfig(config) {
  toastConfigCache = toastConfigOf(config)
  soundEnabledCache = soundEnabledOf(config)
  soundVolumeCache = soundVolumeOf(config)
  systemConfigCache = systemConfigOf(config)
  seedRuntimePrefs(config)
}
function loadRuntimeConfig() {
  if (toastConfigRequested || toastConfigCache !== null) return
  if (typeof fetch !== 'function') return
  toastConfigRequested = true
  fetch('/notify/api/config')
    .then((res) => res.json())
    .then((body) => {
      if (body !== null && body !== undefined && body.ok === true) applyRuntimeConfig(body.value)
    })
    .catch(() => {})
}
function toastConfigNow() {
  return toastConfigCache !== null ? toastConfigCache : DEFAULT_TOAST_CONFIG
}
function soundEnabledOf(config) {
  const sound = config !== null && config !== undefined ? config.sound : undefined
  if (sound === null || sound === undefined || typeof sound !== 'object') return true
  return sound.enabled !== false
}
function soundEnabledNow() {
  return soundEnabledCache !== null ? soundEnabledCache : true
}
function soundVolumeNow() {
  return soundVolumeCache !== null ? soundVolumeCache : 0.6
}
function systemConfigNow() {
  return systemConfigCache !== null ? systemConfigCache : DEFAULT_SYSTEM_CONFIG
}
