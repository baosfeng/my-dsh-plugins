// ── 设置页外壳（通知工作台）：顶栏 + 四视图 + 分区装配 ─────────────────
//
// 席位：settings.plugins.tab 的内容区（宿主设置弹层内，约 860×700）。
// 四视图：文案（工作台）/ 渠道（列表 + 详情）/ 呈现（卡片组）/ 高级（卡片组）。
// 状态条固定「通知权限 / 已保存 / 未保存 / 恢复默认 / 保存」。

/** 视图定义（顺序即 tab 顺序）。 */
const VIEWS: SelectOption[] = [
  { value: 'copy', label: () => strings.viewCopy() },
  { value: 'channel', label: () => strings.viewChannel() },
  { value: 'present', label: () => strings.viewPresent() },
  { value: 'secure', label: () => strings.viewSecure() },
]

/** 顶栏：标题 + 视图分段 + 状态徽标 + 主操作。 */
function workbenchToolbar(props: SettingsFormProps, perm: { text: string; kind: string }) {
  return createElement(
    'header',
    { className: 'dsh-my-notify-tool' },
    createElement('h1', null, strings.settingsTitle()),
    createElement(
      'div',
      { className: 'dsh-my-notify-views', role: 'tablist', 'aria-label': strings.navLabel() },
      VIEWS.map((option) =>
        createElement(
          'button',
          {
            key: option.value,
            type: 'button',
            className: 'dsh-my-notify-view',
            role: 'tab',
            'aria-selected': String(option.value === props.pane),
            onClick: () => props.onPane(option.value),
          },
          option.label(),
        ),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-actions' },
      createElement('span', { className: 'dsh-my-notify-badge', 'data-kind': perm.kind }, perm.text),
      props.saved
        ? createElement('span', { className: 'dsh-my-notify-badge', 'data-kind': 'ok' }, strings.saved())
        : null,
      props.dirty
        ? createElement('span', { className: 'dsh-my-notify-badge', 'data-kind': 'warn' }, strings.dirty())
        : null,
      props.error ? createElement('span', { className: 'dsh-my-notify-error' }, strings.saveFailed()) : null,
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onReset },
        strings.resetDefaults(),
      ),
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-notify-btn dsh-my-notify-btn-primary', onClick: props.save },
        strings.save(),
      ),
    ),
  )
}

/** 文案视图（工作台三列 + 预览带）。 */
function copyView(props: SettingsFormProps) {
  const enabledOf = (key: string): boolean => {
    if (key === 'subagentEnd') return props.draft.subagentEnd === true
    if (key === 'remote') return true
    return (props.draft as any)[key] === true
  }
  const onToggleEvent = (key: string, on: boolean): void => {
    if (key === 'remote') return
    props.patch(key, on)
  }
  return createElement(CopyEditorPane, {
    messages: props.draft.messages,
    card: props.feishuCard,
    enabledOf,
    onToggleEvent,
    askMode: props.draft.askMode === 'summary' ? 'summary' : 'full',
    onAskMode: (mode: string) => props.patch('askMode', mode),
    saveError: props.error,
    onRetrySave: props.save,
    onPatchMessage: (key: string, template: MessageTemplate) => {
      const messages = { ...(props.draft.messages ?? defaultMessages()) } as any
      messages[key] = template
      props.patch('messages', messages)
    },
  })
}

/** 渠道视图（列表 + 详情）。 */
function channelView(props: SettingsFormProps) {
  return createElement(WebhookSection, {
    webhooks: props.draft.webhooks ?? [],
    failures: props.failures,
    apiToken: props.apiToken,
    onPatchWebhooks: (next: WebhookEntry[]) => props.patch('webhooks', next),
  })
}

/** 当前视图内容。 */
function workbenchBody(props: SettingsFormProps) {
  if (props.pane === 'channel') return channelView(props)
  if (props.pane === 'present') return renderPresentPane(props.draft, props.patch, props.volume, props.onVolumeChange)
  if (props.pane === 'secure') return renderSecurePane(props.draft, props.patch, props.apiToken, props.onTest)
  return copyView(props)
}

/** 设置表单渲染：顶栏 + 当前视图。 */
function renderSettingsForm(props: SettingsFormProps) {
  const perm = permissionBadge()
  return createElement(
    'div',
    { className: 'dsh-my-notify-settings' },
    workbenchToolbar(props, perm),
    workbenchBody(props),
  )
}

/** 保存配置（PUT /notify/api/config），成功/失败更新状态。 */
function saveConfig(draft: NotifyConfig, setSaved: SetBool, setError: SetBool, onSaved?: () => void): void {
  setSaved(false)
  setError(false)
  fetch('/notify/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('save failed')
      setSaved(true)
      // 保存后失效 client 端运行时缓存：toast 位置 / 时长与提示音开关立即生效
      if (typeof onSaved === 'function') onSaved()
    })
    .catch(() => setError(true))
}

/** 加载配置（首屏 GET /notify/api/config → draft + 播种本地开关）。 */
function useNotifyConfig(state: {
  setConfig: (v: NotifyConfig | null) => void
  setDraft: (v: NotifyConfig | null) => void
  setLoading: (v: boolean) => void
  setError: SetBool
  setVolume: (v: number) => void
}) {
  useEffect(() => {
    fetch('/notify/api/config')
      .then((res) => res.json())
      .then((body) => {
        if (body === null || body.ok !== true) throw new Error('bad config response')
        state.setConfig(body.value)
        state.setDraft(body.value)
        // 播种本地运行时开关 + 音量：首次进面板后 server 配置与 localStorage 一致
        syncPrefsFromConfig(body.value)
        state.setVolume(prefNum(LS.volume, prefVolume()))
        state.setLoading(false)
      })
      .catch(() => {
        state.setLoading(false)
        state.setError(true)
      })
  }, [])
}

/** 加载出站 webhook 失败记录（只读增强，失败时保持空列表）。 */
function useNotifyFailures(setFailures: (list: WebhookFailure[]) => void) {
  useEffect(() => {
    fetch('/notify/api/webhooks')
      .then((res) => res.json())
      .then((body) => {
        if (body === null || body.ok !== true) throw new Error('bad webhooks response')
        setFailures(body.value.failures ?? [])
      })
      .catch(() => {
        // 失败记录是只读增强：请求失败时区块保持空列表
      })
  }, [])
}

/** 解析远程触发样例 JSON（非法输入回退空对象，绝不抛错）。 */
function parseSamplePayload(sample: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(sample)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 设置页主视图：加载 → 装配 → 保存。 */
function NotifySettingsView() {
  const [config, setConfig] = useState<NotifyConfig | null>(null)
  const [draft, setDraft] = useState<NotifyConfig | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pane, setPane] = useState<string>('copy')
  const [failures, setFailures] = useState<WebhookFailure[]>([])
  const [volume, setVolume] = useState(() => prefVolume())
  useNotifyConfig({ setConfig, setDraft, setLoading, setError, setVolume })
  useNotifyFailures(setFailures)
  if (loading) {
    return createElement(
      'div',
      { className: 'dsh-my-notify-settings' },
      createElement('div', { className: 'dsh-my-notify-status' }, strings.loading()),
    )
  }
  if (config === null || draft === null) {
    return createElement(
      'div',
      { className: 'dsh-my-notify-settings' },
      createElement('div', { className: 'dsh-my-notify-errbox' }, strings.loadError()),
    )
  }
  return createElement(NotifySettingsLoaded, {
    config,
    draft,
    setDraft,
    saved,
    setSaved,
    error,
    setError,
    pane,
    setPane,
    failures,
    volume,
    setVolume,
  })
}

/** 配置就绪后的面板装配。 */
function NotifySettingsLoaded(props: {
  config: NotifyConfig
  draft: NotifyConfig
  setDraft: (v: NotifyConfig) => void
  saved: boolean
  setSaved: SetBool
  error: boolean
  setError: SetBool
  pane: string
  setPane: (pane: string) => void
  failures: WebhookFailure[]
  volume: number
  setVolume: (v: number) => void
}) {
  const current = configOf(props.draft)
  const patch = (key: string, value: any) => {
    if (key === '__import__') {
      props.setDraft({ ...current, ...value })
      return
    }
    props.setDraft({ ...current, [key]: value })
  }
  const feishuCard = (current.webhooks ?? []).find((w) => w.channel === 'feishu' && w.msgType === 'interactive')
  const formProps: SettingsFormProps = {
    draft: current,
    patch,
    pane: props.pane,
    onPane: props.setPane,
    save: () => saveConfig(current, props.setSaved, props.setError, invalidateRuntimeConfig),
    saved: props.saved,
    error: props.error,
    dirty: JSON.stringify(current) !== JSON.stringify(props.config),
    volume: props.volume,
    onVolumeChange: props.setVolume,
    failures: props.failures,
    apiToken: typeof current.apiToken === 'string' ? current.apiToken : '',
    feishuCard: feishuCard !== undefined ? cardOf(feishuCard) : defaultCard(),
    onTest: (kind: string, sample: string, done: (ok: boolean, reason?: string) => void) => {
      fetch('/notify/api/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-notify-token': current.apiToken ?? '' },
        body: JSON.stringify({ ...parseSamplePayload(sample), kind }),
      })
        .then((res) => res.json())
        .then((body) => done(body !== null && body !== undefined && body.ok === true))
        .catch(() => done(false, strings.secureRemoteFail()))
    },
    onReset: () => {
      props.setDraft(defaultConfig())
      props.setSaved(false)
    },
  }
  return renderSettingsForm(formProps)
}

/** 设置页 tab 注册（官方 slots 扩展点；服务缺省时静默跳过）。 */
function attachSettingsTab(ctx: ClientContext): void {
  // strict=false：首屏加载时 slots 服务（provider fiber 尚未 active）取到实例即可
  const slots = ctx.get('slots', false)
  if (slots === undefined) return
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-my-notify-settings', 'styles')
    style.textContent = SETTINGS_STYLES + CARD_PREVIEW_STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode !== null) style.parentNode.removeChild(style)
    }
  }, 'dsh-my-notify: settings styles')
  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          { name: 'settings.plugins.tab', id: 'notify-settings', order: 91, label: () => strings.settingsTitle() },
          NotifySettingsView,
        ),
      ),
    'dsh-my-notify: settings tab registration',
  )
}
