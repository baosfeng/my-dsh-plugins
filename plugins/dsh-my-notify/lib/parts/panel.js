'use strict'
const PANEL_EVENTS = ['ask', 'approval', 'end', 'subagentEnd', 'remote']
function NotifyPanel(props) {
  const [active, setActive] = useState('ask')
  const [drawer, setDrawer] = useState(null)
  const [groups, setGroups] = useState([])
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState('idle')
  const [attempt, setAttempt] = useState(0)
  const [target, setTarget] = useState('body')
  const [caret, setCaret] = useState(0)
  const [varsOpen, setVarsOpen] = useState(false)
  const template = messageOf(props.draft.messages, active)
  useVariables(setGroups)
  usePreview(
    { messages: props.draft.messages, card: props.feishuCard },
    active,
    template,
    attempt,
    setPreview,
    setStatus,
  )
  const insert = makePanelInsert(props, active, template, target, caret, setCaret)
  const notice = previewNoticeOf(status)
  const view = { active, template, groups, preview, status, notice, target, caret, varsOpen, attempt }
  const actions = { setActive, setDrawer, setVarsOpen, setTarget, setCaret, setAttempt, insert }
  return createElement(
    'div',
    { className: 'dsh-my-notify-panel' },
    panelHead(props, () => setDrawer('channel')),
    panelTabs(active, (key) => {
      setActive(key)
      setCaret(0)
      setVarsOpen(false)
    }),
    panelMain(props, view, actions),
    panelFoot(props),
    createElement(PanelDrawer, {
      open: drawer,
      onOpen: setDrawer,
      onClose: () => setDrawer(null),
      draft: props.draft,
      patch: props.patch,
      volume: props.volume,
      onVolumeChange: props.onVolumeChange,
      apiToken: props.apiToken,
      onTest: props.onTest,
    }),
  )
}
function panelMain(props, view, actions) {
  return createElement(
    'main',
    { className: 'dsh-my-notify-p-grid' },
    createElement(PanelCompose, {
      active: view.active,
      template: view.template,
      enabled: panelEventEnabled(props.draft, view.active),
      onToggle: (on) => {
        if (view.active !== 'remote') props.patch(view.active, on)
      },
      onPatch: (next) => panelPatchMessage(props.draft, props.patch, view.active, next),
      onReset: () => panelPatchMessage(props.draft, props.patch, view.active, defaultMessageFor(view.active)),
      groups: view.groups,
      varsOpen: view.varsOpen,
      onToggleVars: () => actions.setVarsOpen(!view.varsOpen),
      onInsert: actions.insert,
      onTarget: (nextTarget, at) => {
        actions.setTarget(nextTarget)
        actions.setCaret(at)
      },
      draft: props.draft,
      patch: props.patch,
      onOpenChannel: () => actions.setDrawer('channel'),
    }),
    createElement(PanelPreview, {
      preview: view.preview,
      status: view.status,
      notice: view.notice,
      onRetry: () => actions.setAttempt(view.attempt + 1),
      card: props.feishuCard,
      hasChannel: props.hasFeishuCard,
      onPatchCard: props.onPatchFeishuCard,
    }),
  )
}
function panelHead(props, onOpenMore) {
  const channels = panelChannelCount(props.draft)
  return createElement(
    'header',
    { className: 'dsh-my-notify-p-head' },
    createElement(
      'div',
      null,
      createElement('p', { className: 'dsh-my-notify-p-kicker' }, strings.panelKicker()),
      createElement('h1', { className: 'dsh-my-notify-p-title' }, strings.panelTitle()),
      createElement('p', { className: 'dsh-my-notify-p-lede' }, strings.panelLede()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-p-head-side' },
      createElement('p', { className: 'dsh-my-notify-p-meta' }, strings.panelMeta(PANEL_EVENTS.length, channels)),
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-notify-p-ghost', 'aria-haspopup': 'dialog', onClick: onOpenMore },
        strings.panelMore(),
      ),
    ),
  )
}
function panelTabs(active, onPick) {
  return createElement(
    'nav',
    { className: 'dsh-my-notify-p-tabs', role: 'tablist', 'aria-label': strings.panelTitle() },
    PANEL_EVENTS.map((key) =>
      createElement(
        'button',
        {
          key,
          type: 'button',
          role: 'tab',
          className: 'dsh-my-notify-p-tab',
          'aria-selected': String(key === active),
          onClick: () => onPick(key),
        },
        panelEventLabel(key),
      ),
    ),
  )
}
function panelFoot(props) {
  const kind = props.error ? 'error' : props.dirty ? 'idle' : props.saved ? 'ok' : 'idle'
  const text = props.error ? strings.saveFailed() : props.dirty ? strings.dirty() : props.saved ? strings.saved() : ''
  return createElement(
    'footer',
    { className: 'dsh-my-notify-p-actions' },
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-p-reset', onClick: props.onReset },
      strings.panelResetCopy(),
    ),
    createElement('p', { className: 'dsh-my-notify-p-status', 'data-kind': kind, 'aria-live': 'polite' }, text),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-p-btn dsh-my-notify-p-btn-primary', onClick: props.save },
      strings.panelSave(),
    ),
  )
}
function panelPatchMessage(draft, patch, key, template) {
  const messages = { ...(draft.messages ?? defaultMessages()) }
  messages[key] = template
  patch('messages', messages)
}
function panelEventEnabled(draft, key) {
  if (key === 'remote') return true
  return draft[key] === true
}
function panelChannelCount(draft) {
  const list = Array.isArray(draft.webhooks) ? draft.webhooks : []
  return list.filter((webhook) => webhook.enabled !== false).length
}
function makePanelInsert(props, active, template, target, caret, setCaret) {
  return (name) => {
    const field = target === 'title' ? template.title : template.body
    const next = insertVar(field, caret, name)
    panelPatchMessage(
      props.draft,
      props.patch,
      active,
      target === 'title' ? { title: next.value, body: template.body } : { title: template.title, body: next.value },
    )
    setCaret(next.caret)
    if (typeof window === 'undefined') return
    window.setTimeout(() => {
      const id = target === 'title' ? 'dsh-my-notify-title' : 'dsh-my-notify-body'
      const node = document.getElementById(id)
      if (node !== null && typeof node.setSelectionRange === 'function') {
        node.focus()
        node.setSelectionRange(next.caret, next.caret)
      }
    }, 0)
  }
}
