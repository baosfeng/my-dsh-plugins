'use strict'
function SwitchRow({ label, hint, on, onChange }) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-row' },
    createElement(
      'div',
      { className: 'dsh-my-notify-info' },
      createElement('div', { className: 'dsh-my-notify-label' }, label),
      createElement('div', { className: 'dsh-my-notify-hint' }, hint),
    ),
    createElement('div', {
      className: 'dsh-my-notify-toggle',
      'data-on': String(on),
      role: 'switch',
      'aria-checked': String(on),
      'aria-label': label,
      tabIndex: 0,
      onClick: () => onChange(!on),
      onKeyDown: (event) => {
        if (event !== null && (event.key === 'Enter' || event.key === ' ')) {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          onChange(!on)
        }
      },
    }),
  )
}
function TextRow({ label, hint, value, onChange, type }) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-row' },
    createElement(
      'div',
      { className: 'dsh-my-notify-info' },
      createElement('div', { className: 'dsh-my-notify-label' }, label),
      createElement('div', { className: 'dsh-my-notify-hint' }, hint),
    ),
    createElement('input', {
      className: 'dsh-my-notify-input',
      type: type ?? 'text',
      value,
      'aria-label': label,
      onChange: (event) => onChange(event.target.value),
    }),
  )
}
function SelectRow({ label, hint, value, options, onChange }) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-row' },
    createElement(
      'div',
      { className: 'dsh-my-notify-info' },
      createElement('div', { className: 'dsh-my-notify-label' }, label),
      createElement('div', { className: 'dsh-my-notify-hint' }, hint),
    ),
    createElement(
      'select',
      {
        className: 'dsh-my-notify-webhook-select',
        value,
        'aria-label': label,
        onChange: (event) => onChange(event.target.value),
      },
      options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label())),
    ),
  )
}
function VolumeRow({ label, hint, value, onChange }) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-row' },
    createElement(
      'div',
      { className: 'dsh-my-notify-info' },
      createElement('div', { className: 'dsh-my-notify-label' }, label),
      createElement('div', { className: 'dsh-my-notify-hint' }, hint),
    ),
    createElement('input', {
      className: 'dsh-my-notify-range',
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
      value: String(value),
      'aria-label': label,
      onChange: (event) => onChange(Number(event.target.value)),
    }),
    createElement('div', { className: 'dsh-my-notify-range-value' }, Math.round(value * 100) + '%'),
  )
}
function optionTextOf(options, value) {
  const hit = options.find((option) => option.value === value)
  return hit !== undefined ? hit.label() : value
}
function defaultConfig() {
  return {
    end: true,
    ask: true,
    approval: true,
    subagentEnd: false,
    askMode: 'full',
    apiToken: '',
    webBaseUrl: '',
    dedupeMs: 3000,
    webhooks: [],
    quietHours: { enabled: false, start: '23:00', end: '08:00' },
    sound: { enabled: true, preset: 'chime', volume: 0.6 },
    toast: { enabled: true, durationMs: 4000, position: 'bottom-right', maxStack: 3 },
    system: { enabled: true, requireInteraction: false },
    messages: defaultMessages(),
  }
}
function permissionBadge() {
  try {
    if (typeof Notification === 'undefined') return { text: strings.permDefault(), kind: 'warn' }
    if (Notification.permission === 'granted') return { text: strings.permGranted(), kind: 'ok' }
    if (Notification.permission === 'denied') return { text: strings.permDenied(), kind: 'err' }
    return { text: strings.permDefault(), kind: 'warn' }
  } catch {
    return { text: strings.permDefault(), kind: 'warn' }
  }
}
function configOf(draft) {
  return draft !== null && draft !== undefined ? draft : defaultConfig()
}
function syncPrefsFromConfig(config) {
  seedRuntimePrefs(config)
}
