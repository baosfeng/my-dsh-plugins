/** 开关行（布尔配置项）。 */
function SwitchRow({ label, hint, on, onChange }: SwitchRowProps) {
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
      onKeyDown: (event: any) => {
        if (event !== null && (event.key === 'Enter' || event.key === ' ')) {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          onChange(!on)
        }
      },
    }),
  )
}

/** 输入行（文本/数字配置项）。 */
function TextRow({ label, hint, value, onChange, type }: TextRowProps) {
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
      onChange: (event: any) => onChange(event.target.value),
    }),
  )
}

/** 下拉行（枚举配置项）。 */
function SelectRow({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint: string
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
}) {
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
        onChange: (event: any) => onChange(event.target.value),
      },
      options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label())),
    ),
  )
}

/** 音量滑杆行（0~1，issue #71：音量走 localStorage，不走 server config）。 */
function VolumeRow({ label, hint, value, onChange }: VolumeRowProps) {
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
      onChange: (event: any) => onChange(Number(event.target.value)),
    }),
    createElement('div', { className: 'dsh-my-notify-range-value' }, Math.round(value * 100) + '%'),
  )
}

/** 选项显示名（未知值原样回显）。 */
function optionTextOf(options: SelectOption[], value: string): string {
  const hit = options.find((option) => option.value === value)
  return hit !== undefined ? hit.label() : value
}

/** 客户端默认配置（「恢复默认」用；与服务端 defaults 对齐）。 */
function defaultConfig(): NotifyConfig {
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

/** 权限态（浏览器 Notification.permission）。 */
function permissionBadge(): { text: string; kind: string } {
  try {
    if (typeof Notification === 'undefined') return { text: strings.permDefault(), kind: 'warn' }
    if (Notification.permission === 'granted') return { text: strings.permGranted(), kind: 'ok' }
    if (Notification.permission === 'denied') return { text: strings.permDenied(), kind: 'err' }
    return { text: strings.permDefault(), kind: 'warn' }
  } catch {
    return { text: strings.permDefault(), kind: 'warn' }
  }
}

/** 配置对象的安全取值（缺失回退默认值）。 */
function configOf(draft: NotifyConfig | null): NotifyConfig {
  return draft !== null && draft !== undefined ? draft : defaultConfig()
}

/** 进面板时用 server 配置播种本地运行时开关（只写缺失键）。 */
function syncPrefsFromConfig(config: NotifyConfig): void {
  seedRuntimePrefs(config)
}
