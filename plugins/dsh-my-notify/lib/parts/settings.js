'use strict'
const VIEWS = [
  { value: 'copy', label: () => strings.viewCopy() },
  { value: 'channel', label: () => strings.viewChannel() },
  { value: 'present', label: () => strings.viewPresent() },
  { value: 'secure', label: () => strings.viewSecure() },
]
function workbenchToolbar(props, perm) {
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
function copyView(props) {
  const enabledOf = (key) => {
    if (key === 'subagentEnd') return props.draft.subagentEnd === true
    if (key === 'remote') return true
    return props.draft[key] === true
  }
  const onToggleEvent = (key, on) => {
    if (key === 'remote') return
    props.patch(key, on)
  }
  return createElement(CopyEditorPane, {
    messages: props.draft.messages,
    card: props.feishuCard,
    enabledOf,
    onToggleEvent,
    askMode: props.draft.askMode === 'summary' ? 'summary' : 'full',
    onAskMode: (mode) => props.patch('askMode', mode),
    saveError: props.error,
    onRetrySave: props.save,
    onPatchMessage: (key, template) => {
      const messages = { ...(props.draft.messages ?? defaultMessages()) }
      messages[key] = template
      props.patch('messages', messages)
    },
  })
}
function channelView(props) {
  return createElement(WebhookSection, {
    webhooks: props.draft.webhooks ?? [],
    failures: props.failures,
    apiToken: props.apiToken,
    onPatchWebhooks: (next) => props.patch('webhooks', next),
  })
}
function workbenchBody(props) {
  if (props.pane === 'channel') return channelView(props)
  if (props.pane === 'present') return renderPresentPane(props.draft, props.patch, props.volume, props.onVolumeChange)
  if (props.pane === 'secure') return renderSecurePane(props.draft, props.patch, props.apiToken, props.onTest)
  return copyView(props)
}
function renderSettingsForm(props) {
  const perm = permissionBadge()
  return createElement(
    'div',
    { className: 'dsh-my-notify-settings' },
    workbenchToolbar(props, perm),
    workbenchBody(props),
  )
}
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
function useNotifyFailures(setFailures) {
  useEffect(() => {
    fetch('/notify/api/webhooks')
      .then((res) => res.json())
      .then((body) => {
        if (body === null || body.ok !== true) throw new Error('bad webhooks response')
        setFailures(body.value.failures ?? [])
      })
      .catch(() => {})
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
  const [pane, setPane] = useState('copy')
  const [failures, setFailures] = useState([])
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
function NotifySettingsLoaded(props) {
  const current = configOf(props.draft)
  const patch = (key, value) => {
    if (key === '__import__') {
      props.setDraft({ ...current, ...value })
      return
    }
    props.setDraft({ ...current, [key]: value })
  }
  const feishuCard = (current.webhooks ?? []).find((w) => w.channel === 'feishu' && w.msgType === 'interactive')
  const formProps = {
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
      props.setDraft(defaultConfig())
      props.setSaved(false)
    },
  }
  return renderSettingsForm(formProps)
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
          { name: 'settings.plugins.tab', id: 'notify-settings', order: 91, label: () => strings.settingsTitle() },
          NotifySettingsView,
        ),
      ),
    'dsh-my-notify: settings tab registration',
  )
}
