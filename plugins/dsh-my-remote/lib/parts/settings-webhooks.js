// ── 出站 webhook 列表编辑器（issue #385）──────────────────────────────────
// 交互与样式照搬 dsh-my-notify 的出站 webhook 设置（同一套类名结构与按钮排布），
// 便于两处面板看起来是一套；字段集合按本插件的数据模型收敛为
// name / url / events / enabled（无 channel / secret / 模板；headers 不暴露，
// 由 host 半按名称继承保留）。
//
// 破坏性操作（删除）走**内联二次确认**：UI 规范要求破坏性操作二次确认、禁原生
// confirm()；确认态才出现「确认删除」，取消回到常规按钮。
//
// 本文件是 part 片段（构建期拼接进 __ModuleLoader__ factory 作用域），无 import/export。

/** 单条 webhook 显示行：名称 / URL · 事件 + 启用开关 + 编辑 / 删除。 */
function MyRemoteWebhookRow(props) {
  const enabled = props.webhook.enabled !== false
  const toggle = createElement('div', {
    className: 'dsh-my-remote-toggle',
    'data-on': String(enabled),
    role: 'switch',
    'aria-checked': String(enabled),
    'aria-label': MY_REMOTE_STRINGS.webhookEnabled(),
    onClick: () => props.onToggle(!enabled),
  })
  return createElement(
    'div',
    { className: 'dsh-my-remote-row' },
    createElement(
      'div',
      { className: 'dsh-my-remote-info' },
      createElement('div', { className: 'dsh-my-remote-label' }, props.webhook.name),
      createElement(
        'div',
        { className: 'dsh-my-remote-hint' },
        `${props.webhook.url} · ${myRemoteEventsLabel(props.webhook.events)}`,
      ),
    ),
    createElement('div', { className: 'dsh-my-remote-actions' }, toggle, myRemoteRowButtons(props)),
  )
}

/** 行尾按钮：常规态（编辑 / 删除）或确认态（确认删除 / 取消）。 */
function myRemoteRowButtons(props) {
  if (props.confirming) {
    return [
      createElement(
        'button',
        {
          key: 'confirm',
          'data-role': 'webhook-confirm-delete',
          className: 'dsh-my-remote-btn dsh-my-remote-btn-danger',
          onClick: props.onConfirm,
        },
        MY_REMOTE_STRINGS.webhookConfirmDelete(),
      ),
      createElement(
        'button',
        {
          key: 'cancel',
          'data-role': 'webhook-cancel-delete',
          className: 'dsh-my-remote-btn',
          onClick: props.onCancel,
        },
        MY_REMOTE_STRINGS.webhookCancel(),
      ),
    ]
  }
  return [
    createElement(
      'button',
      { key: 'edit', 'data-role': 'webhook-edit', className: 'dsh-my-remote-btn', onClick: props.onEdit },
      MY_REMOTE_STRINGS.webhookEdit(),
    ),
    createElement(
      'button',
      { key: 'delete', 'data-role': 'webhook-delete', className: 'dsh-my-remote-btn', onClick: props.onDelete },
      MY_REMOTE_STRINGS.webhookDelete(),
    ),
  ]
}

/** webhook 编辑表单：名称 / URL / 事件多选 + 确定 / 取消。 */
function MyRemoteWebhookEditor(props) {
  const draft = props.draft
  const events = draft.events ?? []
  const toggleEvent = (kind) => {
    const next = events.includes(kind) ? events.filter((item) => item !== kind) : [...events, kind]
    props.onChange({ ...draft, events: next })
  }
  return createElement(
    'div',
    { className: 'dsh-my-remote-webhook-editor' },
    myRemoteField(
      MY_REMOTE_STRINGS.webhookName(),
      myRemoteInput(draft.name, MY_REMOTE_STRINGS.webhookNamePlaceholder(), (v) =>
        props.onChange({ ...draft, name: v }),
      ),
    ),
    myRemoteField(
      MY_REMOTE_STRINGS.webhookUrl(),
      myRemoteInput(draft.url, 'https://…', (v) => props.onChange({ ...draft, url: v })),
    ),
    myRemoteField(MY_REMOTE_STRINGS.webhookEvents(), myRemoteEventPickers(events, toggleEvent)),
    createElement(
      'div',
      { className: 'dsh-my-remote-actions' },
      createElement(
        'button',
        { 'data-role': 'webhook-save', className: 'dsh-my-remote-btn', onClick: props.onSave },
        MY_REMOTE_STRINGS.webhookSave(),
      ),
      createElement(
        'button',
        { 'data-role': 'webhook-cancel', className: 'dsh-my-remote-btn', onClick: props.onCancel },
        MY_REMOTE_STRINGS.webhookCancel(),
      ),
    ),
    createElement('div', { className: 'dsh-my-remote-hint' }, MY_REMOTE_STRINGS.webhookHeadersNote()),
  )
}

/** 事件多选（不选 = 全部事件）。 */
function myRemoteEventPickers(events, toggleEvent) {
  return createElement(
    'div',
    { className: 'dsh-my-remote-webhook-events' },
    MY_REMOTE_EVENTS.map((kind) =>
      createElement(
        'label',
        { key: kind, className: 'dsh-my-remote-webhook-event' },
        createElement('input', { type: 'checkbox', checked: events.includes(kind), onChange: () => toggleEvent(kind) }),
        myRemoteEventLabel(kind),
      ),
    ),
  )
}

/** 出站 webhook 区块：列表 + 添加 / 编辑 / 删除。 */
function MyRemoteWebhookSection(props) {
  const webhooks = props.webhooks
  const [editing, setEditing] = useState(-1)
  const [draft, setDraft] = useState(null)
  const [confirming, setConfirming] = useState(-1)
  const closeEditor = () => {
    setEditing(-1)
    setDraft(null)
  }
  const startAdd = () => {
    setDraft(myRemoteEmptyWebhook())
    setEditing(webhooks.length)
  }
  const startEdit = (index) => {
    setDraft({ ...webhooks[index] })
    setEditing(index)
  }
  const saveEditor = () => {
    if (draft === null) return
    const next = [...webhooks]
    if (editing >= next.length) next.push(draft)
    else next[editing] = draft
    props.onChange(next)
    closeEditor()
  }
  const removeAt = (index) => {
    props.onChange(webhooks.filter((_, i) => i !== index))
    setConfirming(-1)
  }
  const toggleAt = (index, enabled) => {
    props.onChange(webhooks.map((webhook, i) => (i === index ? { ...webhook, enabled } : webhook)))
  }
  return createElement(
    'div',
    { className: 'dsh-my-remote-section' },
    createElement('div', { className: 'dsh-my-remote-section-title' }, MY_REMOTE_STRINGS.webhookSection()),
    webhooks.length === 0
      ? createElement('div', { className: 'dsh-my-remote-hint' }, MY_REMOTE_STRINGS.webhookEmpty())
      : null,
    webhooks.map((webhook, index) =>
      createElement(MyRemoteWebhookRow, {
        key: `${index}-${webhook.name}`,
        webhook,
        confirming: confirming === index,
        onEdit: () => startEdit(index),
        onDelete: () => setConfirming(index),
        onConfirm: () => removeAt(index),
        onCancel: () => setConfirming(-1),
        onToggle: (enabled) => toggleAt(index, enabled),
      }),
    ),
    editing >= 0 && draft !== null
      ? createElement(MyRemoteWebhookEditor, { draft, onChange: setDraft, onSave: saveEditor, onCancel: closeEditor })
      : null,
    createElement(
      'div',
      { className: 'dsh-my-remote-actions' },
      createElement(
        'button',
        { 'data-role': 'webhook-add', className: 'dsh-my-remote-btn', onClick: startAdd },
        MY_REMOTE_STRINGS.webhookAdd(),
      ),
    ),
  )
}
