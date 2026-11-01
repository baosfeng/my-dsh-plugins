'use strict'
const LS = {
  notify: 'dsh-notify:notify',
  sound: 'dsh-notify:sound',
  toast: 'dsh-notify:toast',
  volume: 'dsh-notify:volume',
  tone: 'dsh-notify:tone',
}
function prefTone() {
  try {
    const raw = window.localStorage.getItem(LS.tone)
    if (raw === 'drop' || raw === 'deep' || raw === 'chime') return raw
  } catch {
    void 0
  }
  return 'chime'
}
function prefOn(key, def) {
  try {
    const v = window.localStorage.getItem(key)
    if (v === null) return def
    return v === '1'
  } catch {
    return def
  }
}
function writePref(key, on) {
  try {
    window.localStorage.setItem(key, on ? '1' : '0')
  } catch {
    void 0
  }
}
function writePrefNum(key, value) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    void 0
  }
}
function prefNum(key, fallback) {
  const def = Number.isFinite(fallback) && fallback >= 0 && fallback <= 1 ? fallback : 0.6
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return def
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 0 && value <= 1) return value
  } catch {
    void 0
  }
  return def
}
function readPrefRaw(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return undefined
  }
}
function seedPref(key, on) {
  if (readPrefRaw(key) === null) writePref(key, on)
}
function seedPrefNum(key, value) {
  if (readPrefRaw(key) === null) writePrefNum(key, value)
}
function prefVolume() {
  try {
    const raw = window.localStorage.getItem(LS.volume)
    if (raw === null) return 0.6
    const v = Number(raw)
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v
  } catch {
    void 0
  }
  return 0.6
}
