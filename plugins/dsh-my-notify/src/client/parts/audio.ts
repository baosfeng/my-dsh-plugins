// ── 提示音（Web Audio 合成短促滴声）────────────────────────────────
let audioCtx: AudioContext | null = null

function baseAudio(): AudioContext | null {
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

/** 音色预设：chime = 清脆单音（历史行为）；drop = 柔和水滴（两声下行）；deep = 低沉提示（低八度长音）。 */
function toneSpecs(preset: string): { wave: OscillatorType; notes: number[]; gap: number; length: number } {
  if (preset === 'drop') return { wave: 'sine', notes: [1040, 780], gap: 0.11, length: 0.2 }
  if (preset === 'deep') return { wave: 'triangle', notes: [320], gap: 0, length: 0.36 }
  return { wave: 'sine', notes: [880], gap: 0, length: 0.22 }
}

function beep(preset?: string): void {
  const ac = baseAudio()
  if (ac === null) return
  const resume = typeof ac.resume === 'function' ? ac.resume() : Promise.resolve()
  void Promise.resolve(resume)
    .then(() => {
      // 运行时 gate 统一读本地键（启动时已用服务端 sound.enabled 播种缺失键）
      if (!prefOn(LS.sound, true)) return
      // 音量：本地键优先，缺失回退服务端 config.sound.volume（面板滑杆两处同时写）
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
    .catch(() => {
      // autoplay policy / audio hardware: sound is best-effort
    })
}

/** 浏览器自动播放策略：首次用户交互后解锁 AudioContext。 */
function armAudioUnlock(): () => void {
  if (typeof document === 'undefined') return () => {}
  const unlock = () => {
    try {
      const ac = baseAudio()
      if (ac !== null && typeof ac.resume === 'function') void ac.resume()
    } catch {
      // ignore
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
