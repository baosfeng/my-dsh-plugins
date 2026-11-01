'use strict'
const EVENT_KEYS = ['end', 'ask', 'approval', 'subagentEnd', 'remote']
function eventDotOf(key) {
  if (key === 'end') return 'ok'
  if (key === 'ask') return 'warn'
  if (key === 'approval') return 'err'
  return ''
}
function defaultMessages() {
  const base = (body) => ({ title: '{{session.title}}', body })
  return {
    end: base('{{event.note}}'),
    ask: base('{{ask.summary}}'),
    approval: base('{{approval.reason}}'),
    subagentEnd: base('{{event.note}}'),
    remote: base('{{event.note}}'),
  }
}
function messageOf(messages, key) {
  const defaults = defaultMessages()
  const fallback = defaults[key] ?? defaults.end
  const item = messages !== undefined && messages !== null ? messages[key] : undefined
  if (item === null || typeof item !== 'object') return { title: fallback.title, body: fallback.body }
  return {
    title: typeof item.title === 'string' && item.title !== '' ? item.title : fallback.title,
    body: typeof item.body === 'string' && item.body !== '' ? item.body : fallback.body,
  }
}
function previewPayload(kind, messages, card, channel) {
  const template = messageOf(messages, kind)
  const payload = {
    kind,
    channel: typeof channel === 'string' && channel !== '' ? channel : 'feishu',
    titleTemplate: template.title,
    bodyTemplate: template.body,
  }
  if (card !== undefined && card !== null) payload.card = card
  return payload
}
function requestPreview(payload) {
  if (typeof fetch !== 'function') return Promise.resolve(null)
  return fetch('/notify/api/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => res.json())
    .then((body) => (body !== null && body !== undefined && body.ok === true ? body.value : null))
    .catch(() => null)
}
function createPreviewScheduler(run, delayMs) {
  const delay = typeof delayMs === 'number' && Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 300
  let timer = null
  return {
    schedule(payload) {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        run(payload)
      }, delay)
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
function optionLabelOf(options, value) {
  const hit = options.find((option) => option.value === value)
  return hit !== undefined ? hit.label() : value
}
function previewNoticeOf(status) {
  if (status === 'error') return { text: strings.previewFailed(), retry: true, kind: 'error' }
  if (status === 'loading') return { text: strings.previewLoading(), retry: false, kind: 'status' }
  if (status === 'ready') return { text: '', retry: false, kind: 'none' }
  return { text: strings.previewEmpty(), retry: false, kind: 'status' }
}
function previewFormOptions() {
  return [
    { value: 'sys', label: () => strings.formSys() },
    { value: 'toast', label: () => strings.formToast() },
    { value: 'feishu', label: () => strings.formFeishu() },
    { value: 'wecom', label: () => strings.formWecom() },
    { value: 'ding', label: () => strings.formDing() },
  ]
}
function plainTextOf(text) {
  return String(text ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
}
function renderPreviewFrame(form, preview) {
  if (preview === null) return ''
  const title = cardTitleOf(preview.card)
  const text = typeof preview.text === 'string' ? preview.text : ''
  if (form === 'feishu') return renderFeishuCardHtml(preview.card)
  const time = preview.vars !== undefined && preview.vars.time !== undefined ? preview.vars.time : ''
  if (form === 'sys') {
    return (
      '<div class="dsh-my-notify-pv-sys"><span class="dsh-my-notify-pv-sys-ico">D</span>' +
      '<div><div class="dsh-my-notify-pv-sys-title">' +
      escapeHtml(title) +
      '</div><div class="dsh-my-notify-pv-sys-body">' +
      escapeHtml(plainTextOf(text)) +
      '</div></div><span class="dsh-my-notify-pv-sys-time">' +
      escapeHtml(time) +
      '</span></div>'
    )
  }
  if (form === 'toast') {
    return (
      '<div class="dsh-my-notify-pv-toast"><span class="dsh-my-notify-pv-toast-bar"></span>' +
      '<div><div class="dsh-my-notify-pv-sys-title">' +
      escapeHtml(title) +
      '</div><div class="dsh-my-notify-pv-sys-body">' +
      escapeHtml(plainTextOf(text)) +
      '</div></div></div>'
    )
  }
  const brand = form === 'wecom' ? 'wecom' : 'ding'
  const label = brand === 'wecom' ? strings.channelWecom() : strings.channelDingtalk()
  return (
    '<div class="dsh-my-notify-pv-wx" data-brand="' +
    brand +
    '">' +
    '<div class="dsh-my-notify-pv-wx-hd"><i></i>' +
    escapeHtml(label) +
    '</div><div class="dsh-my-notify-pv-wx-bd">' +
    escapeHtml(plainTextOf(text)) +
    '</div></div>'
  )
}
