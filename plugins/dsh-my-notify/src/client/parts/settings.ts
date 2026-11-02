// ── 设置页外壳：加载配置 → 简版面板 → 保存 ─────────────────────────────
//
// 席位：settings.plugins.tab 的内容区（宿主设置弹层内，约 860×700）。
// 主界面只保留「事件 → 文案 → 飞书卡片 → 送达」；渠道 / 呈现 / 高级进
// 右侧「更多设置」抽屉，默认不占主屏。

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
  const [volume, setVolume] = useState(() => prefVolume())
  useNotifyConfig({ setConfig, setDraft, setLoading, setError, setVolume })
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
    setConfig,
    setDraft,
    saved,
    setSaved,
    error,
    setError,
    volume,
    setVolume,
  })
}

/** 配置就绪后的面板装配（飞书卡片取第一条 interactive 渠道）。 */
function NotifySettingsLoaded(props: {
  config: NotifyConfig
  draft: NotifyConfig
  setConfig: (v: NotifyConfig) => void
  setDraft: (v: NotifyConfig) => void
  saved: boolean
  setSaved: SetBool
  error: boolean
  setError: SetBool
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
  const webhooks = Array.isArray(current.webhooks) ? current.webhooks : []
  const feishuIndex = webhooks.findIndex((webhook) => webhook.channel === 'feishu' && webhook.msgType === 'interactive')
  const feishuCard = feishuIndex >= 0 ? cardOf(webhooks[feishuIndex]) : defaultCard()
  const panelProps: NotifyPanelProps = {
    draft: current,
    patch,
    save: () =>
      saveConfig(current, props.setSaved, props.setError, () => {
        // 保存成功即把「已保存基线」推进到当前 draft：dirty 归零，后续再改才重新变脏
        props.setConfig(current)
        invalidateRuntimeConfig()
      }),
    saved: props.saved,
    error: props.error,
    dirty: JSON.stringify(current) !== JSON.stringify(props.config),
    volume: props.volume,
    onVolumeChange: props.setVolume,
    apiToken: typeof current.apiToken === 'string' ? current.apiToken : '',
    feishuCard,
    hasFeishuCard: feishuIndex >= 0,
    onPatchFeishuCard: (card: CardConfig) => {
      if (feishuIndex < 0) return
      const next = webhooks.slice()
      next[feishuIndex] = { ...next[feishuIndex], card }
      patch('webhooks', next)
    },
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
      // 只重置文案与询问模式，保留渠道 / 呈现 / 高级配置（避免误删 webhook）
      props.setDraft({ ...current, messages: defaultMessages(), askMode: 'full' })
      props.setSaved(false)
    },
  }
  return createElement(NotifyPanel, panelProps)
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
          { name: 'settings.plugins.tab', id: 'notify-settings', order: 91, label: () => strings.panelTabLabel() },
          NotifySettingsView,
        ),
      ),
    'dsh-my-notify: settings tab registration',
  )
}
