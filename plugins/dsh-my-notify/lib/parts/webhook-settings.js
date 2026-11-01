'use strict'
const WEBHOOK_STYLES = `.dsh-my-notify-ch-list{display:flex;flex-direction:column;gap:6px}.dsh-my-notify-ch-card{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}.dsh-my-notify-ch-card:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-my-notify-ch-mark{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;flex:none;font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-accent)}.dsh-my-notify-ch-mark[data-brand="wecom"]{background:var(--dsw-alias-state-success-primary)}.dsh-my-notify-ch-mark[data-brand="dingtalk"]{background:var(--dsw-alias-state-warn-primary)}.dsh-my-notify-ch-mark[data-brand="generic"]{background:var(--dsw-alias-label-tertiary)}.dsh-my-notify-ch-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.dsh-my-notify-ch-name{display:flex;align-items:center;gap:6px;font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}.dsh-my-notify-ch-sub{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}.dsh-my-notify-ch-evs{display:flex;flex-wrap:wrap;gap:4px}.dsh-my-notify-ch-chip{height:18px;padding:0 6px;border-radius:4px;display:inline-flex;align-items:center;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg)}.dsh-my-notify-ch-ctl{display:flex;align-items:center;gap:8px;flex:none}.dsh-my-notify-drawer{position:fixed;inset:0;z-index:3200;display:flex;justify-content:flex-end}.dsh-my-notify-drawer-scrim{position:absolute;inset:0;background:color-mix(in srgb, var(--dsw-alias-label-primary) 28%, transparent)}.dsh-my-notify-drawer-panel{position:relative;display:flex;flex-direction:column;width:min(560px,100%);height:100%;overflow:auto;background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv2)}.dsh-my-notify-drawer-hd{display:flex;align-items:center;gap:8px;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l2);position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);z-index:1}.dsh-my-notify-drawer-bd{display:flex;flex-direction:column;gap:10px;padding:12px}.dsh-my-notify-drawer-ft{display:flex;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--dsw-alias-border-l2);position:sticky;bottom:0;background:var(--dsw-alias-bg-layer-1)}.dsh-my-notify-webhook-editor{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}.dsh-my-notify-webhook-field{display:flex;flex-direction:column;gap:4px;min-width:0}.dsh-my-notify-webhook-field-label{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}.dsh-my-notify-webhook-input{width:100%;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}.dsh-my-notify-webhook-select{height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}.dsh-my-notify-webhook-events{display:flex;flex-wrap:wrap;gap:6px}.dsh-my-notify-webhook-event{display:flex;align-items:center;gap:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}.dsh-my-notify-chip{height:24px;padding:0 8px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}.dsh-my-notify-chip[aria-pressed="true"]{border-color:var(--dsw-alias-accent);color:var(--dsw-alias-accent);background:color-mix(in srgb, var(--dsw-alias-accent) 10%, transparent)}.dsh-my-notify-inp-group{display:flex;align-items:center;gap:6px}.dsh-my-notify-inp-group input{flex:1;min-width:0}.dsh-my-notify-design{display:flex;flex-direction:column;gap:10px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dsh-my-notify-design-hd{display:flex;align-items:center;gap:8px}.dsh-my-notify-design-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.dsh-my-notify-swatches{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.dsh-my-notify-swatch{width:20px;height:20px;padding:0;border-radius:50%;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-label-tertiary)}.dsh-my-notify-swatch i{display:block;width:100%;height:100%;border-radius:50%}.dsh-my-notify-swatch[data-c="green"] i{background:var(--dsw-alias-state-success-primary)}.dsh-my-notify-swatch[data-c="blue"] i{background:var(--dsw-alias-accent)}.dsh-my-notify-swatch[data-c="orange"] i{background:var(--dsw-alias-state-warn-primary)}.dsh-my-notify-swatch[data-c="grey"] i{background:var(--dsw-alias-label-tertiary)}.dsh-my-notify-swatch[aria-pressed="true"]{border-color:var(--dsw-alias-label-primary);border-width:2px}.dsh-my-notify-cbx{display:inline-flex;align-items:center;gap:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}.dsh-my-notify-dz-fields{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px}.dsh-my-notify-fail-list{display:flex;flex-direction:column;gap:4px}.dsh-my-notify-fail-row{display:grid;grid-template-columns:80px 60px minmax(0,1fr) 56px;align-items:center;gap:8px;padding:4px 0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}.dsh-my-notify-fail-row[data-head="true"]{color:var(--dsw-alias-label-tertiary)}.dsh-my-notify-fail-time{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}.dsh-my-notify-fail-err{color:var(--dsw-alias-state-error-primary);word-break:break-word}
`
const CHANNEL_OPTIONS = [
  { value: 'wecom', label: () => strings.channelWecom() },
  { value: 'feishu', label: () => strings.channelFeishu() },
  { value: 'dingtalk', label: () => strings.channelDingtalk() },
  { value: 'generic', label: () => strings.channelGeneric() },
]
const EVENT_OPTIONS = [
  { value: 'end', label: () => strings.eventEnd() },
  { value: 'ask', label: () => strings.eventAsk() },
  { value: 'approval', label: () => strings.eventApproval() },
  { value: 'subagentEnd', label: () => strings.eventSubagentEnd() },
  { value: 'remote', label: () => strings.eventRemote() },
]
function emptyWebhook() {
  return {
    name: '',
    channel: 'wecom',
    url: '',
    secret: '',
    events: ['end', 'ask', 'approval'],
    enabled: true,
    msgType: 'text',
    template: '',
    titleTemplate: '',
    bodyTemplate: '',
    card: defaultCard(),
    retry: { attempts: 3, backoffMs: 1000 },
  }
}
function channelLabel(channel) {
  const option = CHANNEL_OPTIONS.find((o) => o.value === channel)
  return option !== undefined ? option.label() : channel
}
function brandMarkOf(channel) {
  if (channel === 'feishu') return '飞'
  if (channel === 'wecom') return '企'
  if (channel === 'dingtalk') return '钉'
  return '通'
}
function eventsLabel(events) {
  if (!Array.isArray(events) || events.length === 0) return strings.eventAll()
  return events
    .map((event) => {
      const option = EVENT_OPTIONS.find((o) => o.value === event)
      return option !== undefined ? option.label() : event
    })
    .join(' / ')
}
function msgTypeOptions(channel) {
  if (channel === 'feishu') {
    return [
      { value: 'text', label: () => strings.msgTypeText() },
      { value: 'post', label: () => strings.msgTypePost() },
      { value: 'interactive', label: () => strings.msgTypeInteractive() },
    ]
  }
  return [
    { value: 'text', label: () => strings.msgTypeText() },
    { value: 'markdown', label: () => strings.msgTypeMarkdown() },
    { value: 'post', label: () => strings.msgTypePost() },
  ]
}
function msgTypeLabel(channel, msgType) {
  const option = msgTypeOptions(channel).find((o) => o.value === msgType)
  return option !== undefined ? option.label() : msgType
}
function WebhookRow({ webhook, onEdit, onDelete, onToggle }) {
  const enabled = webhook.enabled !== false
  const events = Array.isArray(webhook.events) ? webhook.events : []
  return createElement(
    'div',
    {
      className: 'dsh-my-notify-webhook-row dsh-my-notify-ch-card',
      role: 'button',
      tabIndex: 0,
      onClick: onEdit,
      onKeyDown: (event) => {
        if (event !== null && (event.key === 'Enter' || event.key === ' ')) {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          onEdit()
        }
      },
    },
    createElement(
      'span',
      { className: 'dsh-my-notify-ch-mark', 'data-brand': webhook.channel },
      brandMarkOf(webhook.channel),
    ),
    createElement(
      'span',
      { className: 'dsh-my-notify-ch-main' },
      createElement(
        'span',
        { className: 'dsh-my-notify-ch-name' },
        createElement('span', { className: 'dsh-my-notify-label' }, webhook.name),
        createElement(
          'span',
          { className: 'dsh-my-notify-badge', 'data-kind': 'accent' },
          msgTypeLabel(webhook.channel, webhook.msgType),
        ),
      ),
      createElement(
        'span',
        { className: 'dsh-my-notify-ch-sub dsh-my-notify-hint' },
        channelLabel(webhook.channel) + ' · ' + eventsLabel(events),
      ),
      createElement(
        'span',
        { className: 'dsh-my-notify-ch-evs' },
        (events.length > 0 ? events : ['end', 'ask', 'approval', 'remote']).map((event) =>
          createElement('span', { key: event, className: 'dsh-my-notify-ch-chip' }, eventLabelOf(event)),
        ),
      ),
    ),
    webhookRowControls({ webhook, enabled, onToggle }),
  )
}
function webhookRowControls({ webhook, enabled, onToggle }) {
  return createElement(
    'span',
    { className: 'dsh-my-notify-ch-ctl' },
    createElement(
      'span',
      { className: 'dsh-my-notify-badge', 'data-kind': enabled ? 'ok' : undefined },
      enabled ? strings.channelEnabled() : strings.channelDisabled(),
    ),
    createElement('div', {
      className: 'dsh-my-notify-toggle',
      'data-on': String(enabled),
      role: 'switch',
      'aria-checked': String(enabled),
      'aria-label': webhook.name,
      tabIndex: 0,
      onClick: (event) => {
        if (event !== null && typeof event.stopPropagation === 'function') event.stopPropagation()
        onToggle(!enabled)
      },
    }),
  )
}
function FailureRow({ failure, onRetry }) {
  const time = new Date(failure.time).toLocaleString()
  return createElement(
    'div',
    { className: 'dsh-my-notify-fail-row' },
    createElement('span', { className: 'dsh-my-notify-fail-time dsh-my-notify-webhook-failure-time' }, time),
    createElement('span', null, channelLabel(failure.channel)),
    createElement(
      'span',
      { className: 'dsh-my-notify-fail-err dsh-my-notify-webhook-failure-msg' },
      failure.error + ' · ' + strings.retryAttemptsUsed(failure.attempts),
    ),
    onRetry !== undefined
      ? createElement(
          'button',
          { type: 'button', className: 'dsh-my-notify-btn', onClick: onRetry },
          strings.webhookEdit(),
        )
      : createElement('span'),
  )
}
function WebhookSection({ webhooks, failures, onPatchWebhooks, apiToken }) {
  const list = Array.isArray(webhooks) ? webhooks : []
  const [editing, setEditing] = useState(-1)
  const [editorDraft, setEditorDraft] = useState(null)
  const startAdd = () => {
    setEditorDraft(emptyWebhook())
    setEditing(list.length)
  }
  const startEdit = (index) => {
    setEditorDraft({ ...list[index], card: cardOf(list[index]) })
    setEditing(index)
  }
  const saveEditor = () => {
    const next = [...list]
    if (editing >= next.length) next.push(editorDraft)
    else next[editing] = editorDraft
    onPatchWebhooks(next)
    setEditing(-1)
    setEditorDraft(null)
  }
  const removeAt = (index) => {
    onPatchWebhooks(list.filter((_, i) => i !== index))
    setEditing(-1)
    setEditorDraft(null)
  }
  const toggleAt = (index, enabled) => {
    onPatchWebhooks(list.map((webhook, i) => (i === index ? { ...webhook, enabled } : webhook)))
  }
  const testSend = (done) => {
    if (typeof fetch !== 'function') {
      done(false)
      return
    }
    fetch('/notify/api/trigger', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-notify-token': typeof apiToken === 'string' ? apiToken : '' },
      body: JSON.stringify({ title: strings.channelTestSend(), body: editorDraft !== null ? editorDraft.name : '' }),
    })
      .then((res) => res.json())
      .then((body) => done(body !== null && body !== undefined && body.ok === true))
      .catch(() => done(false))
  }
  return createElement(
    'div',
    { className: 'dsh-my-notify-section', role: 'tabpanel', 'aria-label': strings.paneChannel() },
    webhookList({ list, onEdit: startEdit, onToggle: toggleAt }),
    list.length === 0 ? createElement('div', { className: 'dsh-my-notify-hint' }, strings.channelNoWebhooks()) : null,
    createElement(
      'div',
      { className: 'dsh-my-notify-actions' },
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-notify-btn', onClick: startAdd },
        strings.webhookAdd(),
      ),
    ),
    webhookDrawer({ editing, editorDraft, setEditorDraft, saveEditor, removeAt, testSend }),
    webhookFailuresBlock(failures),
  )
}
function webhookList(props) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-ch-list' },
    props.list.map((webhook, index) =>
      createElement(WebhookRow, {
        key: index,
        webhook,
        onEdit: () => props.onEdit(index),
        onDelete: () => {},
        onToggle: (enabled) => props.onToggle(index, enabled),
      }),
    ),
  )
}
function webhookFailuresBlock(failures) {
  const title = createElement('div', { className: 'dsh-my-notify-section-title' }, strings.webhookFailures())
  if (failures === undefined || failures.length === 0) {
    return [title, createElement('div', { className: 'dsh-my-notify-hint' }, strings.webhookNoFailures())]
  }
  return [
    title,
    createElement(
      'div',
      { className: 'dsh-my-notify-fail-list' },
      failures.map((failure, index) => createElement(FailureRow, { key: index, failure })),
    ),
  ]
}
function webhookDrawer(ctx) {
  const { editing, editorDraft, setEditorDraft, saveEditor, removeAt, testSend } = ctx
  if (editing < 0 || editorDraft === null) return null
  return createElement(WebhookEditor, {
    draft: editorDraft,
    onChange: setEditorDraft,
    onSave: saveEditor,
    onCancel: () => {
      setEditorDraft(null)
      return removeAt(-1)
    },
    onDelete: () => removeAt(editing),
    onTest: testSend,
  })
}
