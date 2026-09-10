// ── 设置页视图（issue #27 配置可视化，官方 slots 扩展点）────────────

/** 设置页开关行（与任务页 Switch 同款 toggle 外观，行样式走 dtr-settings-*）。 */
function SettingsSwitchRow({ label, hint, on, onChange }): ElementLike {
  return createElement(
    'div',
    { className: 'dtr-settings-row' },
    createElement(
      'div',
      { className: 'dtr-settings-info' },
      createElement('div', { className: 'dtr-settings-label' }, label),
      createElement('div', { className: 'dtr-settings-hint' }, hint),
    ),
    createElement('div', {
      className: 'dtr-toggle',
      'data-on': String(on),
      role: 'switch',
      'aria-checked': String(on),
      onClick: () => onChange(!on),
    }),
  )
}

/** 设置页文本/数字输入行（numeric 行把输入转成 Number 再入草稿）。 */
function SettingsTextRow({ label, hint, value, onChange, type }): ElementLike {
  return createElement(
    'div',
    { className: 'dtr-settings-row' },
    createElement(
      'div',
      { className: 'dtr-settings-info' },
      createElement('div', { className: 'dtr-settings-label' }, label),
      createElement('div', { className: 'dtr-settings-hint' }, hint),
    ),
    createElement('input', {
      className: 'dtr-settings-input',
      type: type ?? 'text',
      value,
      onChange: (event) => onChange(event.target.value),
    }),
  )
}

/** 设置页表单字段数据（label/hint/key/fallback/类型），驱动渲染。 */
const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    title: () => strings.settingsRetry(),
    rows: [
      {
        label: () => strings.settingsRetryMax(),
        hint: () => strings.settingsRetryMaxHint(),
        key: 'retryMax',
        fallback: 3,
        numeric: true,
      },
      {
        label: () => strings.settingsRetryBaseMs(),
        hint: () => strings.settingsRetryBaseMsHint(),
        key: 'retryBaseMs',
        fallback: 1000,
        numeric: true,
      },
      {
        label: () => strings.settingsRetryableCodes(),
        hint: () => strings.settingsRetryableCodesHint(),
        key: 'retryableCodesText',
        fallback: '',
      },
    ],
  },
  {
    title: () => strings.settingsLoop(),
    rows: [
      {
        label: () => strings.settingsMaxLoop(),
        hint: () => strings.settingsMaxLoopHint(),
        key: 'maxLoop',
        fallback: 8,
        numeric: true,
      },
      {
        label: () => strings.settingsMaxVerify(),
        hint: () => strings.settingsMaxVerifyHint(),
        key: 'maxVerify',
        fallback: 3,
        numeric: true,
      },
      {
        label: () => strings.settingsSteerCooldownMs(),
        hint: () => strings.settingsSteerCooldownMsHint(),
        key: 'steerCooldownMs',
        fallback: 8000,
        numeric: true,
      },
      {
        label: () => strings.settingsAskTimeoutMs(),
        hint: () => strings.settingsAskTimeoutMsHint(),
        key: 'askTimeoutMs',
        fallback: 1800000,
        numeric: true,
      },
    ],
  },
  {
    title: () => strings.settingsPersist(),
    rows: [
      {
        label: () => strings.settingsSaveDebounceMs(),
        hint: () => strings.settingsSaveDebounceMsHint(),
        key: 'saveDebounceMs',
        fallback: 500,
        numeric: true,
      },
      {
        label: () => strings.settingsResumeGraceMs(),
        hint: () => strings.settingsResumeGraceMsHint(),
        key: 'resumeGraceMs',
        fallback: 2000,
        numeric: true,
      },
      {
        label: () => strings.settingsRateMaxActions(),
        hint: () => strings.settingsRateMaxActionsHint(),
        key: 'rateMaxActions',
        fallback: 12,
        numeric: true,
      },
    ],
  },
  {
    title: () => strings.settingsWatchdog(),
    rows: [
      {
        label: () => strings.settingsWatchdogIntervalMs(),
        hint: () => strings.settingsWatchdogIntervalMsHint(),
        key: 'watchdogIntervalMs',
        fallback: 300000,
        numeric: true,
      },
      {
        label: () => strings.settingsStallTimeoutMs(),
        hint: () => strings.settingsStallTimeoutMsHint(),
        key: 'stallTimeoutMs',
        fallback: 600000,
        numeric: true,
      },
    ],
  },
  {
    title: () => strings.settingsSecurity(),
    rows: [
      {
        label: () => strings.settingsAutopilot(),
        hint: () => strings.settingsAutopilotHint(),
        key: 'autopilot',
        fallback: false,
        switch: true,
      },
      {
        label: () => strings.settingsAutopilotGraceMs(),
        hint: () => strings.settingsAutopilotGraceMsHint(),
        key: 'autopilotGraceMs',
        fallback: 20000,
        numeric: true,
      },
      {
        label: () => strings.settingsApiToken(),
        hint: () => strings.settingsApiTokenHint(),
        key: 'apiToken',
        fallback: '',
      },
    ],
  },
  {
    title: () => strings.settingsRescue(),
    rows: [
      {
        label: () => strings.settingsRescueOnTruncation(),
        hint: () => strings.settingsRescueOnTruncationHint(),
        key: 'rescueOnTruncation',
        fallback: true,
        switch: true,
      },
      {
        label: () => strings.settingsRescueMaxPerSession(),
        hint: () => strings.settingsRescueMaxPerSessionHint(),
        key: 'rescueMaxPerSession',
        fallback: 2,
        numeric: true,
      },
      {
        label: () => strings.settingsRescueCooldownMs(),
        hint: () => strings.settingsRescueCooldownMsHint(),
        key: 'rescueCooldownMs',
        fallback: 30000,
        numeric: true,
      },
    ],
  },
]

/** 渲染单个设置行（switch 或 text/number 输入）。 */
function settingsRow(
  row: SettingsRow,
  draft: SettingsDraft,
  patch: (key: string, value: unknown) => void,
  num: (key: string) => (value: string) => void,
): ElementLike {
  if (row.switch === true) {
    return createElement(SettingsSwitchRow, {
      label: row.label(),
      hint: row.hint(),
      on: draft[row.key] === true,
      onChange: (v) => patch(row.key, v),
    })
  }
  return createElement(SettingsTextRow, {
    label: row.label(),
    hint: row.hint(),
    value: String(draft[row.key] ?? row.fallback),
    type: row.numeric === true ? 'number' : 'text',
    onChange: row.numeric === true ? num(row.key) : (v) => patch(row.key, v),
  })
}

/** 渲染设置分组（标题 + 字段行）。 */
function settingsSection(
  section: SettingsSection,
  draft: SettingsDraft,
  patch: (key: string, value: unknown) => void,
  num: (key: string) => (value: string) => void,
): ElementLike {
  return createElement(
    'div',
    { className: 'dtr-settings-section' },
    createElement('div', { className: 'dtr-settings-title' }, section.title()),
    ...section.rows.map((row) => settingsRow(row, draft, patch, num)),
  )
}

/** 设置页主视图：加载当前配置 → 表单编辑 → 保存（PUT /task-reliability/api/config）。 */
function TaskReliabilitySettingsView(): ElementLike {
  const [config, setConfig] = useState<SettingsConfig | null>(null)
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/task-reliability/api/config')
      .then((res) => res.json())
      .then((body) => {
        if (body === null || body.ok !== true) throw new Error('bad config response')
        setConfig(body.value)
        setDraft({ ...body.value, retryableCodesText: (body.value.retryableCodes ?? []).join(', ') })
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
        setError(true)
      })
  }, [])

  const save = () => {
    setSaved(false)
    setError(false)
    const payload = {
      ...draft,
      retryableCodes: String(draft.retryableCodesText ?? '')
        .split(',')
        .map((code) => code.trim())
        .filter((code) => code !== ''),
    }
    delete payload.retryableCodesText
    fetch('/task-reliability/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((res) => res.json())
      .then((body) => {
        if (body === null || body.ok !== true) throw new Error('save failed')
        setSaved(true)
      })
      .catch(() => setError(true))
  }

  if (loading) {
    return createElement(
      'div',
      { className: 'dtr-settings' },
      createElement('div', { className: 'dtr-settings-status' }, strings.loading()),
    )
  }
  if (config === null) {
    return createElement(
      'div',
      { className: 'dtr-settings' },
      createElement('div', { className: 'dtr-settings-error' }, strings.loadError()),
    )
  }
  const patch = (key: string, value: unknown) => setDraft({ ...draft, [key]: value })
  const num = (key: string) => (value: string) => patch(key, Number(value))
  return createElement(
    'div',
    { className: 'dtr-settings' },
    ...SETTINGS_SECTIONS.map((section) => settingsSection(section, draft, patch, num)),
    createElement(
      'div',
      { className: 'dtr-settings-actions' },
      createElement('button', { className: 'dtr-btn', onClick: save }, strings.save()),
      saved ? createElement('span', { className: 'dtr-settings-saved' }, strings.saved()) : null,
      error ? createElement('span', { className: 'dtr-settings-error' }, strings.saveFailed()) : null,
    ),
  )
}

/** 设置页 tab 注册（官方 slots 扩展点；服务缺省时静默跳过）。 */
function attachSettingsTab(ctx: ClientContext): void {
  // strict=false：首屏加载时 slots 服务（由 @deepseek-ai/dsh-client-ui-renderer
  // 提供）的提供者 fiber 尚未 active，cordis 的 ctx.get(name, strict = true)
  // 在 strict 模式下会返回 undefined，注册代码会静默 return（设置页看不到
  // tab，HMR 重载后才出现）；取到实例即可——注册本身由 slots.inject 等待
  // 槽位声明，实际渲染发生在之后，安全。
  const slots = ctx.get('slots', false) as SlotsService | undefined
  if (slots === undefined) return
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-task-reliability-settings', 'styles')
    style.textContent = SETTINGS_STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode !== null) style.parentNode.removeChild(style)
    }
  }, 'dsh-task-reliability: settings styles')
  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'task-reliability-settings',
            order: 92,
            label: () => strings.settingsTitle(),
          },
          TaskReliabilitySettingsView,
        ),
      ),
    'dsh-task-reliability: settings tab registration',
  )
}
