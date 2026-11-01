'use strict'
function renderPresentPane(draft, patch, volume, onVolumeChange) {
  const toast = draft.toast ?? defaultConfig().toast
  const sound = draft.sound ?? defaultConfig().sound
  const system = draft.system ?? defaultConfig().system
  const quiet = draft.quietHours ?? { enabled: false, start: '23:00', end: '08:00' }
  const perm = permissionBadge()
  const patchToast = (key, value) => patch('toast', { ...toast, [key]: value })
  const patchSound = (key, value) => patch('sound', { ...sound, [key]: value })
  const patchSystem = (key, value) => patch('system', { ...system, [key]: value })
  const patchQuiet = (key, value) => patch('quietHours', { ...quiet, [key]: value })
  const { positions, durations, stacks, tones } = presentOptions()
  const ctx = {
    system,
    patchSystem,
    perm,
    toast,
    patchToast,
    positions,
    durations,
    stacks,
    sound,
    patchSound,
    tones,
    quiet,
    patchQuiet,
    draft,
    patch,
    volume,
    onVolumeChange,
  }
  return createElement(
    'div',
    { className: 'dsh-my-notify-pane', role: 'tabpanel', 'aria-label': strings.panePresent() },
    createElement(
      'div',
      { className: 'dsh-my-notify-pane-hd' },
      createElement('h2', null, strings.panePresent()),
      createElement('span', { className: 'dsh-my-notify-hint' }, strings.presentHint()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-grid2' },
      presentSystemCard(ctx),
      presentToastCard(ctx),
      presentSoundCard(ctx),
      presentQuietCard(ctx),
      presentSelfCheckCard(ctx),
    ),
  )
}
function presentSystemCard(ctx) {
  const { system, patchSystem, perm } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.systemTitle()),
      createElement('span', { className: 'dsh-my-notify-badge', 'data-kind': perm.kind }, perm.text),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(SwitchRow, {
        label: strings.systemEnable(),
        hint: strings.systemEnableHint(),
        on: prefOn(LS.notify, system.enabled !== false),
        onChange: (v) => {
          patchSystem('enabled', v)
          writePref(LS.notify, v)
        },
      }),
      createElement(SwitchRow, {
        label: strings.systemPersist(),
        hint: strings.systemPersistHint(),
        on: system.requireInteraction === true,
        onChange: (v) => patchSystem('requireInteraction', v),
      }),
    ),
  )
}
function presentToastCard(ctx) {
  const { toast, patchToast, positions, durations, stacks } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.toastTitle2()),
      createElement('span', { className: 'dsh-my-notify-hint' }, strings.toastEnableHint()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(SwitchRow, {
        label: strings.toastTitle2(),
        hint: strings.toastEnableHint(),
        on: prefOn(LS.toast, toast.enabled !== false),
        onChange: (v) => {
          patchToast('enabled', v)
          writePref(LS.toast, v)
        },
      }),
      createElement(SelectRow, {
        label: strings.toastPosition(),
        hint: strings.toastEnableHint(),
        value: toast.position,
        options: positions,
        onChange: (v) => patchToast('position', v),
      }),
      createElement(SelectRow, {
        label: strings.toastDuration(),
        hint: strings.ms(),
        value: String(toast.durationMs),
        options: durations,
        onChange: (v) => patchToast('durationMs', Number(v)),
      }),
      createElement(SelectRow, {
        label: strings.toastMaxStack(),
        hint: strings.toastHoverPause(),
        value: String(toast.maxStack),
        options: stacks,
        onChange: (v) => patchToast('maxStack', Number(v)),
      }),
    ),
  )
}
function presentSoundCard(ctx) {
  const { sound, patchSound, tones, onVolumeChange } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.soundTitle()),
      createElement('span', { className: 'dsh-my-notify-badge' }, optionTextOf(tones, sound.preset)),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(SwitchRow, {
        label: strings.soundEnable(),
        hint: strings.soundEnableHint(),
        on: prefOn(LS.sound, sound.enabled !== false),
        onChange: (v) => {
          patchSound('enabled', v)
          writePref(LS.sound, v)
        },
      }),
      soundToneRow({ sound, patchSound, tones }),
      createElement(VolumeRow, {
        label: strings.settingsVolume(),
        hint: strings.settingsVolumeHint(),
        value: prefNum(LS.volume, sound.volume),
        onChange: (v) => {
          patchSound('volume', v)
          writePrefNum(LS.volume, v)
          onVolumeChange(v)
        },
      }),
    ),
  )
}
function presentQuietCard(ctx) {
  const { quiet, patchQuiet, draft, patch } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.quietDedupeTitle()),
      createElement(
        'span',
        {
          className: 'dsh-my-notify-badge',
          'data-kind': quiet.enabled === true ? 'warn' : 'ok',
        },
        quiet.enabled === true ? strings.settingsQuietHoursEnabled() : strings.channelDisabled(),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(SwitchRow, {
        label: strings.quietEnable(),
        hint: strings.quietEnableHint(),
        on: quiet.enabled === true,
        onChange: (v) => patchQuiet('enabled', v),
      }),
      createElement(
        'div',
        { className: 'dsh-my-notify-grid2' },
        createElement(TextRow, {
          label: strings.quietStart(),
          hint: '23:00',
          value: quiet.start,
          type: 'time',
          onChange: (v) => patchQuiet('start', v),
        }),
        createElement(TextRow, {
          label: strings.quietEnd(),
          hint: '08:00',
          value: quiet.end,
          type: 'time',
          onChange: (v) => patchQuiet('end', v),
        }),
      ),
      createElement('div', { className: 'dsh-my-notify-divider' }),
      createElement(TextRow, {
        label: strings.dedupeWindow(),
        hint: strings.dedupeWindowHint(),
        value: String(draft.dedupeMs ?? 3000),
        type: 'number',
        onChange: (v) => patch('dedupeMs', Number(v) || 0),
      }),
    ),
  )
}
function presentSelfCheckCard(ctx) {
  const { perm } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.permSelfCheck()),
      createElement('span', { className: 'dsh-my-notify-badge', 'data-kind': perm.kind }, perm.text),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement('div', { className: 'dsh-my-notify-status-line' }, strings.systemTitle() + ' · ' + perm.text),
      createElement('div', { className: 'dsh-my-notify-status-line' }, strings.soundAvailable()),
      createElement('div', { className: 'dsh-my-notify-status-line' }, strings.toastHoverPause()),
    ),
  )
}
function presentOptions() {
  const positions = [
    { value: 'top-right', label: () => strings.posTopRight() },
    { value: 'top-left', label: () => strings.posTopLeft() },
    { value: 'bottom-right', label: () => strings.posBottomRight() },
    { value: 'bottom-left', label: () => strings.posBottomLeft() },
    { value: 'top', label: () => strings.posTop() },
    { value: 'bottom', label: () => strings.posBottom() },
  ]
  const durations = [
    { value: '3000', label: () => strings.dur3s() },
    { value: '5000', label: () => strings.dur5s() },
    { value: '8000', label: () => strings.dur8s() },
  ]
  const stacks = [
    { value: '1', label: () => strings.stack1() },
    { value: '3', label: () => strings.stack3() },
    { value: '5', label: () => strings.stack5() },
  ]
  const tones = [
    { value: 'chime', label: () => strings.toneChime() },
    { value: 'drop', label: () => strings.toneDrop() },
    { value: 'deep', label: () => strings.toneDeep() },
  ]
  return { positions, durations, stacks, tones }
}
function soundToneRow(props) {
  const { sound, patchSound, tones } = props
  return createElement(
    'div',
    { className: 'dsh-my-notify-form-row' },
    createElement('span', { className: 'dsh-my-notify-label' }, strings.soundTone()),
    createElement(
      'select',
      {
        className: 'dsh-my-notify-webhook-select',
        value: sound.preset,
        'aria-label': strings.soundTone(),
        onChange: (event) => {
          patchSound('preset', event.target.value)
          try {
            window.localStorage.setItem(LS.tone, event.target.value)
          } catch {
            void 0
          }
        },
      },
      tones.map((option) => createElement('option', { key: option.value, value: option.value }, option.label())),
    ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn', onClick: () => beep(sound.preset) },
      strings.soundTest(),
    ),
  )
}
