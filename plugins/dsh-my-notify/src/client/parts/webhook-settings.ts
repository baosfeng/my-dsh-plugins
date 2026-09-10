// ── 出站 Webhook 设置（issue #92）：列表 + 编辑表单 + 失败记录 ──────
const WEBHOOK_STYLES: string = `
.dsh-my-notify-webhook-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-notify-webhook-editor{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-notify-webhook-field{display:flex;flex-direction:column;gap:4px}
.dsh-my-notify-webhook-field-label{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dsh-my-notify-webhook-input{height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-webhook-select{height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-webhook-events{display:flex;flex-wrap:wrap;gap:6px}
.dsh-my-notify-webhook-event{display:flex;align-items:center;gap:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-webhook-failures{display:flex;flex-direction:column;gap:4px}
.dsh-my-notify-webhook-failure{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-notify-webhook-failure-time{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-notify-webhook-failure-msg{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`

const CHANNEL_OPTIONS: SelectOption[] = [
  { value: 'wecom', label: () => strings.channelWecom() },
  { value: 'feishu', label: () => strings.channelFeishu() },
  { value: 'dingtalk', label: () => strings.channelDingtalk() },
  { value: 'generic', label: () => strings.channelGeneric() },
]

const EVENT_OPTIONS: SelectOption[] = [
  { value: 'end', label: () => strings.eventEnd() },
  { value: 'ask', label: () => strings.eventAsk() },
  { value: 'approval', label: () => strings.eventApproval() },
  { value: 'remote', label: () => strings.eventRemote() },
]

/** 空 webhook 模板（添加时使用）。 */
function emptyWebhook(): WebhookEntry {
  return {
    name: '',
    channel: 'wecom',
    url: '',
    secret: '',
    events: ['end', 'ask', 'approval'],
    enabled: true,
    msgType: 'text',
    template: '',
  }
}

/** 渠道中文标签。 */
function channelLabel(channel: string): string {
  const option = CHANNEL_OPTIONS.find((o) => o.value === channel)
  return option !== undefined ? option.label() : channel
}

/** 事件选择中文标签（空数组 = 全部）。 */
function eventsLabel(events: string[]): string {
  if (!Array.isArray(events) || events.length === 0) return strings.eventAll()
  return events
    .map((event) => {
      const option = EVENT_OPTIONS.find((o) => o.value === event)
      return option !== undefined ? option.label() : event
    })
    .join(' / ')
}

/** 消息类型选项（按渠道：wecom/dingtalk → text/markdown，feishu → text/post）。 */
function msgTypeOptions(channel: string): SelectOption[] {
  if (channel === 'feishu') {
    return [
      { value: 'text', label: () => strings.msgTypeText() },
      { value: 'post', label: () => strings.msgTypePost() },
    ]
  }
  return [
    { value: 'text', label: () => strings.msgTypeText() },
    { value: 'markdown', label: () => strings.msgTypeMarkdown() },
  ]
}

/** 单条 webhook 显示行：名称/渠道/事件 + 启用开关 + 编辑/删除。 */
function WebhookRow({ webhook, onEdit, onDelete, onToggle }: WebhookRowProps) {
  const enabled = webhook.enabled !== false
  return createElement(
    'div',
    { className: 'dsh-my-notify-webhook-row' },
    createElement(
      'div',
      { className: 'dsh-my-notify-info' },
      createElement('div', { className: 'dsh-my-notify-label' }, webhook.name),
      createElement(
        'div',
        { className: 'dsh-my-notify-hint' },
        `${channelLabel(webhook.channel)} · ${eventsLabel(webhook.events)}`,
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-actions' },
      createElement('div', {
        className: 'dsh-my-notify-toggle',
        'data-on': String(enabled),
        role: 'switch',
        'aria-checked': String(enabled),
        onClick: () => onToggle(!enabled),
      }),
      createElement('button', { className: 'dsh-my-notify-btn', onClick: onEdit }, strings.webhookEdit()),
      createElement('button', { className: 'dsh-my-notify-btn', onClick: onDelete }, strings.webhookDelete()),
    ),
  )
}

/** 编辑表单字段容器（label + control）。 */
function editorField(label: string, control: unknown): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-notify-webhook-field' },
    createElement('div', { className: 'dsh-my-notify-webhook-field-label' }, label),
    control,
  )
}

/** 文本输入控件。 */
function textInput(value: string, placeholder: string, onChange: (v: string) => void): unknown {
  return createElement('input', {
    className: 'dsh-my-notify-webhook-input',
    value,
    placeholder,
    onChange: (event) => onChange(event.target.value),
  })
}

/** 下拉选择控件。 */
function selectInput(value: string, options: SelectOption[], onChange: (v: string) => void): unknown {
  return createElement(
    'select',
    { className: 'dsh-my-notify-webhook-select', value, onChange: (event) => onChange(event.target.value) },
    options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label())),
  )
}

/** 编辑表单：名称/渠道/URL/secret/事件多选/消息类型 + 保存/取消。 */
function WebhookEditor({ draft, onChange, onSave, onCancel }: WebhookEditorProps) {
  const patch = (key, value) => onChange({ ...draft, [key]: value })
  const toggleEvent = (event) => {
    const events = draft.events.includes(event) ? draft.events.filter((e) => e !== event) : [...draft.events, event]
    patch('events', events)
  }
  return createElement(
    'div',
    { className: 'dsh-my-notify-webhook-editor' },
    editorField(
      strings.webhookName(),
      textInput(draft.name, strings.webhookNamePlaceholder(), (v) => patch('name', v)),
    ),
    editorField(
      strings.webhookChannel(),
      selectInput(draft.channel, CHANNEL_OPTIONS, (v) => patch('channel', v)),
    ),
    editorField(
      strings.webhookUrl(),
      textInput(draft.url, strings.webhookUrlPlaceholder(), (v) => patch('url', v)),
    ),
    editorField(
      strings.webhookSecret(),
      textInput(draft.secret, strings.webhookSecretPlaceholder(), (v) => patch('secret', v)),
    ),
    editorField(
      strings.webhookEvents(),
      createElement(
        'div',
        { className: 'dsh-my-notify-webhook-events' },
        EVENT_OPTIONS.map((option) =>
          createElement(
            'label',
            { key: option.value, className: 'dsh-my-notify-webhook-event' },
            createElement('input', {
              type: 'checkbox',
              checked: draft.events.includes(option.value),
              onChange: () => toggleEvent(option.value),
            }),
            option.label(),
          ),
        ),
      ),
    ),
    editorField(
      strings.webhookMsgType(),
      selectInput(draft.msgType, msgTypeOptions(draft.channel), (v) => patch('msgType', v)),
    ),
    editorField(
      strings.webhookTemplate(),
      createElement('textarea', {
        className: 'dsh-my-notify-webhook-input',
        style: { height: 'auto', minHeight: '56px', resize: 'vertical', padding: '6px 8px' },
        value: draft.template ?? '',
        placeholder: strings.webhookTemplatePlaceholder(),
        onChange: (event) => patch('template', event.target.value),
      }),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-actions' },
      createElement('button', { className: 'dsh-my-notify-btn', onClick: onSave }, strings.webhookSave()),
      createElement('button', { className: 'dsh-my-notify-btn', onClick: onCancel }, strings.webhookCancel()),
    ),
  )
}

/** 失败记录条目。 */
function FailureRow({ failure }: { failure: WebhookFailure }) {
  const time = new Date(failure.time).toLocaleString()
  return createElement(
    'div',
    { className: 'dsh-my-notify-webhook-failure' },
    createElement(
      'div',
      { className: 'dsh-my-notify-webhook-failure-time' },
      `${time} · ${failure.webhookName}（${channelLabel(failure.channel)}）· ${failure.attempts} 次尝试`,
    ),
    createElement('div', { className: 'dsh-my-notify-webhook-failure-msg' }, failure.error),
  )
}

/** 出站 Webhook 区块：列表 + 添加/编辑 + 失败记录。 */
function WebhookSection({ webhooks, failures, onPatchWebhooks }: WebhookSectionProps) {
  const [editing, setEditing] = useState<number>(-1)
  const [editorDraft, setEditorDraft] = useState<WebhookEntry | null>(null)
  const startAdd = () => {
    setEditorDraft(emptyWebhook())
    setEditing(webhooks.length)
  }
  const startEdit = (index) => {
    setEditorDraft({ ...webhooks[index] })
    setEditing(index)
  }
  const saveEditor = () => {
    const next = [...webhooks]
    if (editing >= next.length) next.push(editorDraft)
    else next[editing] = editorDraft
    onPatchWebhooks(next)
    setEditing(-1)
  }
  const removeAt = (index) => onPatchWebhooks(webhooks.filter((_, i) => i !== index))
  const toggleAt = (index, enabled) => {
    const next = webhooks.map((webhook, i) => (i === index ? { ...webhook, enabled } : webhook))
    onPatchWebhooks(next)
  }
  return createElement(
    'div',
    { className: 'dsh-my-notify-section' },
    createElement('div', { className: 'dsh-my-notify-section-title' }, strings.settingsWebhooks()),
    (webhooks ?? []).map((webhook, index) =>
      createElement(WebhookRow, {
        key: `${index}-${webhook.name}`,
        webhook,
        onEdit: () => startEdit(index),
        onDelete: () => removeAt(index),
        onToggle: (enabled) => toggleAt(index, enabled),
      }),
    ),
    editing >= 0
      ? createElement(WebhookEditor, {
          draft: editorDraft,
          onChange: setEditorDraft,
          onSave: saveEditor,
          onCancel: () => setEditing(-1),
        })
      : null,
    createElement(
      'div',
      { className: 'dsh-my-notify-actions' },
      createElement('button', { className: 'dsh-my-notify-btn', onClick: startAdd }, strings.webhookAdd()),
    ),
    createElement('div', { className: 'dsh-my-notify-section-title' }, strings.webhookFailures()),
    failures !== undefined && failures.length > 0
      ? createElement(
          'div',
          { className: 'dsh-my-notify-webhook-failures' },
          failures.map((failure, index) => createElement(FailureRow, { key: index, failure })),
        )
      : createElement('div', { className: 'dsh-my-notify-hint' }, strings.webhookNoFailures()),
  )
}
