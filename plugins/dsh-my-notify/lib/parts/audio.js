'use strict'
let audioCtx = null
function baseAudio() {
  const AC = window.AudioContext || window.webkitAudioContext
  if (typeof AC !== 'function') return null
  if (audioCtx === null) {
    try {
      audioCtx = new AC()
    } catch {
      return null
    }
  }
  return audioCtx
}
function toneSpecs(preset) {
  if (preset === 'drop') return { wave: 'sine', notes: [1040, 780], gap: 0.11, length: 0.2 }
  if (preset === 'deep') return { wave: 'triangle', notes: [320], gap: 0, length: 0.36 }
  return { wave: 'sine', notes: [880], gap: 0, length: 0.22 }
}
function beep(preset) {
  const ac = baseAudio()
  if (ac === null) return
  const resume = typeof ac.resume === 'function' ? ac.resume() : Promise.resolve()
  void Promise.resolve(resume)
    .then(() => {
      if (!prefOn(LS.sound, true)) return
      const volume = prefNum(LS.volume, soundVolumeNow())
      const spec = toneSpecs(typeof preset === 'string' && preset !== '' ? preset : prefTone())
      spec.notes.forEach((frequency, index) => {
        const t0 = ac.currentTime + index * spec.gap
        const osc = ac.createOscillator()
        const gain = ac.createGain()
        osc.type = spec.wave
        osc.frequency.value = frequency
        gain.gain.setValueAtTime(0.0001, t0)
        gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.length)
        osc.connect(gain)
        gain.connect(ac.destination)
        osc.start(t0)
        osc.stop(t0 + spec.length + 0.02)
      })
    })
    .catch(() => {})
}
function armAudioUnlock() {
  if (typeof document === 'undefined') return () => {}
  const unlock = () => {
    try {
      const ac = baseAudio()
      if (ac !== null && typeof ac.resume === 'function') void ac.resume()
    } catch {
      void 0
    }
    document.removeEventListener('pointerdown', unlock)
    document.removeEventListener('keydown', unlock)
  }
  document.addEventListener('pointerdown', unlock, { passive: true })
  document.addEventListener('keydown', unlock)
  return () => {
    document.removeEventListener('pointerdown', unlock)
    document.removeEventListener('keydown', unlock)
  }
}
