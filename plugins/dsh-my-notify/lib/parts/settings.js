'use strict'
function saveConfig(draft, setSaved, setError, onSaved) {
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
      if (typeof onSaved === 'function') onSaved()
    })
    .catch(() => setError(true))
}
function useNotifyConfig(state) {
  useEffect(() => {
    fetch('/notify/api/config')
      .then((res) => res.json())
      .then((body) => {
        if (body === null || body.ok !== true) throw new Error('bad config response')
        state.setConfig(body.value)
        state.setDraft(body.value)
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
function parseSamplePayload(sample) {
  try {
    const parsed = JSON.parse(sample)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
function NotifySettingsView() {
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
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
function NotifySettingsLoaded(props) {
  const current = configOf(props.draft)
  const patch = (key, value) => {
    if (key === '__import__') {
      props.setDraft({ ...current, ...value })
      return
    }
    props.setDraft({ ...current, [key]: value })
  }
  const webhooks = Array.isArray(current.webhooks) ? current.webhooks : []
  const feishuIndex = webhooks.findIndex((webhook) => webhook.channel === 'feishu' && webhook.msgType === 'interactive')
  const feishuCard = feishuIndex >= 0 ? cardOf(webhooks[feishuIndex]) : defaultCard()
  const panelProps = {
    draft: current,
    patch,
    save: () =>
      saveConfig(current, props.setSaved, props.setError, () => {
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
    onPatchFeishuCard: (card) => {
      if (feishuIndex < 0) return
      const next = webhooks.slice()
      next[feishuIndex] = { ...next[feishuIndex], card }
      patch('webhooks', next)
    },
    onTest: (kind, sample, done) => {
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
      props.setDraft({ ...current, messages: defaultMessages(), askMode: 'full' })
      props.setSaved(false)
    },
  }
  return createElement(NotifyPanel, panelProps)
}
function attachSettingsTab(ctx) {
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
