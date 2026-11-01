// ── 文案数据模型（与视觉无关的纯逻辑，从 v2 实现原样保留）──────────────
//
// 事件键、默认模板、模板取值、预览请求构造与去抖、预览状态机、五形态 HTML。
// 视觉层（工作台）只消费这些函数，不重复实现。

const EVENT_KEYS = ['end', 'ask', 'approval', 'subagentEnd', 'remote']
/** 事件圆点语义（与服务端卡片配色一致：end 绿 / ask 警告 / approval 错误）。 */
function eventDotOf(key) {
  if (key === 'end') return 'ok'
  if (key === 'ask') return 'warn'
  if (key === 'approval') return 'err'
  return ''
}
/** 默认文案（与 server 端 defaults.ts 的 DEFAULT_MESSAGES 逐字一致；用于「恢复默认」）。 */
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
/** 单条事件模板（缺失 / 空串回退默认值）。 */
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
/** 预览请求体：kind + 当前事件的标题 / 正文模板 + 卡片配置（飞书形态）。 */
function previewPayload(kind: string, messages: MessagesConfig | undefined, card?: CardConfig, channel?: string) {
  const template = messageOf(messages, kind)
  const payload: Record<string, unknown> = {
    kind,
    channel: typeof channel === 'string' && channel !== '' ? channel : 'feishu',
    titleTemplate: template.title,
    bodyTemplate: template.body,
  }
  if (card !== undefined && card !== null) payload.card = card
  return payload
}
/** 预览接口（POST /notify/api/preview）：失败 / 非浏览器环境返回 null，绝不抛错。 */
function requestPreview(payload: Record<string, unknown>): Promise<PreviewResult | null> {
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
/** 去抖调度器（默认 300ms）：连续改动只发最后一次请求。 */
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
/** 选项显示名（未知值原样回显）。 */
function optionLabelOf(options, value) {
  const hit = options.find((option) => option.value === value)
  return hit !== undefined ? hit.label() : value
}
/** 预览状态 → 提示（idle / loading / error 三态；ready 不需要提示）。 */
function previewNoticeOf(status) {
  if (status === 'error') return { text: strings.previewFailed(), retry: true, kind: 'error' }
  if (status === 'loading') return { text: strings.previewLoading(), retry: false, kind: 'status' }
  if (status === 'ready') return { text: '', retry: false, kind: 'none' }
  return { text: strings.previewEmpty(), retry: false, kind: 'status' }
}
/** 预览形态选项（五形态切换）。 */
function previewFormOptions() {
  return [
    { value: 'sys', label: () => strings.formSys() },
    { value: 'toast', label: () => strings.formToast() },
    { value: 'feishu', label: () => strings.formFeishu() },
    { value: 'wecom', label: () => strings.formWecom() },
    { value: 'ding', label: () => strings.formDing() },
  ]
}
/** 企微 / 钉钉形态：去掉 markdown 标记后按纯文本呈现。 */
function plainTextOf(text) {
  return String(text ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
}
/** 预览形态 → HTML（sys / toast / feishu / wecom / ding；preview 为空返回空串）。 */
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
/** 编辑动作（插入变量 / 恢复默认 / 写回模板）。 */
