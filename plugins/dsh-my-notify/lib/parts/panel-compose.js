'use strict'
const PANEL_EVENT_VARS = {
  end: ['session.title', 'session.durationText', 'tokens.text', 'event.time'],
  ask: ['session.title', 'ask.summary', 'event.time'],
  approval: ['session.title', 'approval.reason', 'tool.name', 'event.time'],
  subagentEnd: ['session.title', 'session.durationText', 'event.note', 'event.time'],
  remote: ['session.title', 'event.note', 'event.time'],
}
function panelEventLabel(key) {
  if (key === 'ask') return strings.kindAsk()
  if (key === 'approval') return strings.kindApproval()
  if (key === 'subagentEnd') return strings.panelSubagentEnd()
  if (key === 'remote') return strings.panelRemote()
  return strings.eventEnd()
}
const PANEL_VAR_LABELS = {
  'session.title': '会话标题',
  'session.project': '项目',
  'session.durationText': '耗时',
  'session.url': '链接',
  'tokens.text': 'Token',
  'event.time': '时间',
  'event.note': '备注',
  'ask.summary': '提问',
  'ask.question': '完整提问',
  'approval.reason': '审批',
  'tool.name': '工具',
}
function panelVarLabel(item) {
  const fixed = PANEL_VAR_LABELS[item.name]
  if (fixed !== undefined) return fixed
  const base = typeof item.description === 'string' && item.description !== '' ? item.description : item.name
  const cut = base.split(/[（(·,，]/)[0].trim()
  return cut.length > 8 ? cut.slice(0, 8) : cut
}
const PANEL_FILL_VARS = [
  'session.project',
  'session.durationText',
  'tokens.text',
  'event.note',
  'approval.reason',
  'tool.name',
  'session.url',
]
function panelPickVars(groups, active) {
  const all = []
  for (const group of groups) for (const item of group.items) all.push(item)
  const picked = []
  const add = (name) => {
    if (picked.length >= 6) return
    const hit = all.find((item) => item.name === name)
    if (hit !== undefined && !picked.includes(hit)) picked.push(hit)
  }
  for (const name of PANEL_EVENT_VARS[active] ?? []) add(name)
  for (const name of PANEL_FILL_VARS) add(name)
  for (const item of all) {
    if (picked.length >= 6) break
    if (!picked.includes(item)) picked.push(item)
  }
  return picked.slice(0, 6)
}
function PanelCompose(props) {
  return createElement(
    'section',
    { className: 'dsh-my-notify-p-compose', 'aria-label': panelEventLabel(props.active) },
    panelComposeHead(props),
    panelComposeFields(props),
    panelVarRow(props),
    props.varsOpen ? panelVarSheet(props) : null,
    panelDelivery(props),
    props.active === 'ask' ? panelAskMode(props) : null,
  )
}
function panelComposeHead(props) {
  const staticRemote = props.active === 'remote'
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-compose-head' },
    createElement(
      'div',
      null,
      createElement('h2', { className: 'dsh-my-notify-p-event' }, panelEventLabel(props.active)),
      createElement('p', { className: 'dsh-my-notify-p-event-sub' }, strings.panelEventDesc(props.active)),
    ),
    staticRemote
      ? createElement(
          'span',
          { className: 'dsh-my-notify-p-switch', 'data-static': 'true' },
          strings.panelEventAlways(),
        )
      : createElement(
          'label',
          { className: 'dsh-my-notify-p-switch' },
          createElement('span', null, strings.panelEventNotify()),
          createElement('input', {
            type: 'checkbox',
            checked: props.enabled,
            'aria-label': strings.panelEventNotify(),
            onChange: (event) => props.onToggle(event.target.checked),
          }),
          createElement('i'),
        ),
  )
}
function panelComposeFields(props) {
  return [
    createElement(
      'div',
      { key: 'title', className: 'dsh-my-notify-p-field' },
      createElement(
        'div',
        { className: 'dsh-my-notify-p-label-row' },
        createElement(
          'label',
          { className: 'dsh-my-notify-p-label', htmlFor: 'dsh-my-notify-title' },
          strings.tplTitle(),
        ),
      ),
      createElement('input', {
        id: 'dsh-my-notify-title',
        className: 'dsh-my-notify-p-input',
        type: 'text',
        value: props.template.title,
        spellCheck: false,
        'aria-label': strings.tplTitle(),
        onFocus: (event) => props.onTarget('title', event.target.selectionStart ?? 0),
        onSelect: (event) => props.onTarget('title', event.target.selectionStart ?? 0),
        onChange: (event) => {
          props.onTarget('title', event.target.selectionStart ?? event.target.value.length)
          props.onPatch({ title: event.target.value, body: props.template.body })
        },
      }),
    ),
    createElement(
      'div',
      { key: 'body', className: 'dsh-my-notify-p-field' },
      createElement(
        'div',
        { className: 'dsh-my-notify-p-label-row' },
        createElement(
          'label',
          { className: 'dsh-my-notify-p-label', htmlFor: 'dsh-my-notify-body' },
          strings.tplBody(),
        ),
        createElement('span', { className: 'dsh-my-notify-p-hint' }, strings.panelTemplateHint()),
      ),
      createElement('textarea', {
        id: 'dsh-my-notify-body',
        className: 'dsh-my-notify-p-textarea',
        value: props.template.body,
        spellCheck: false,
        'aria-label': strings.tplBody(),
        onFocus: (event) => props.onTarget('body', event.target.selectionStart ?? 0),
        onSelect: (event) => props.onTarget('body', event.target.selectionStart ?? 0),
        onChange: (event) => {
          props.onTarget('body', event.target.selectionStart ?? event.target.value.length)
          props.onPatch({ title: props.template.title, body: event.target.value })
        },
      }),
    ),
  ]
}
function panelVarRow(props) {
  const picked = panelPickVars(props.groups, props.active)
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-vars' },
    createElement('span', { className: 'dsh-my-notify-p-vars-label' }, strings.panelInsert()),
    picked.length === 0
      ? createElement('span', { className: 'dsh-my-notify-p-hint' }, strings.panelNoVars())
      : picked.map((item) =>
          createElement(
            'button',
            {
              key: item.name,
              type: 'button',
              className: 'dsh-my-notify-p-var',
              title: '{{' + item.name + '}} · ' + item.description,
              onClick: () => props.onInsert(item.name),
            },
            panelVarLabel(item),
          ),
        ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-p-var-more', onClick: props.onToggleVars },
      props.varsOpen ? strings.panelClose() : strings.panelAllVars(),
    ),
  )
}
function panelVarSheet(props) {
  return createElement(
    'div',
    { key: 'sheet', className: 'dsh-my-notify-p-var-sheet' },
    createElement(VariableLibrary, { groups: props.groups, onInsert: props.onInsert }),
  )
}
function panelDelivery(props) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-delivery' },
    createElement(
      'div',
      { className: 'dsh-my-notify-p-delivery-head' },
      createElement('span', { className: 'dsh-my-notify-p-label' }, strings.panelDelivery()),
      createElement('span', { className: 'dsh-my-notify-p-hint' }, strings.panelDeliveryHint()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-p-chips' },
      panelFeishuChip(props),
      panelPrefChip(props, 'system', strings.panelSystem(), strings.panelSystemHint(), LS.notify, 'system'),
      panelPrefChip(props, 'toast', strings.panelToast(), strings.panelToastHint(), LS.toast, 'toast'),
      panelPrefChip(props, 'sound', strings.panelSound(), strings.panelSoundHint(), LS.sound, 'sound'),
    ),
  )
}
function panelFeishuChip(props) {
  const configured = panelFeishuConfigured(props.draft)
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-notify-p-chip',
      'aria-pressed': String(configured),
      'aria-haspopup': 'dialog',
      title: configured ? strings.panelFeishuOn() : strings.panelFeishuOff(),
      onClick: props.onOpenChannel,
    },
    createElement('i'),
    strings.panelFeishu(),
  )
}
function panelFeishuConfigured(draft) {
  const list = Array.isArray(draft.webhooks) ? draft.webhooks : []
  return list.some((webhook) => webhook.channel === 'feishu')
}
function panelPrefChip(props, key, label, hint, lsKey, configKey) {
  const config = props.draft[configKey] ?? defaultConfig()[configKey] ?? { enabled: true }
  const on = prefOn(lsKey, config.enabled !== false)
  const toggle = () => {
    const next = !on
    props.patch(configKey, { ...config, enabled: next })
    writePref(lsKey, next)
  }
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-notify-p-chip',
      'aria-pressed': String(on),
      title: hint,
      onClick: toggle,
    },
    createElement('i'),
    label,
  )
}
function panelAskMode(props) {
  const mode = props.draft.askMode === 'summary' ? 'summary' : 'full'
  const options = [
    { value: 'full', label: strings.askModeFull() },
    { value: 'summary', label: strings.askModeSummary() },
  ]
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-ask' },
    createElement('span', { className: 'dsh-my-notify-p-label' }, strings.askModeTitle()),
    createElement(
      'div',
      { className: 'dsh-my-notify-p-ask-row' },
      options.map((option) =>
        createElement(
          'button',
          {
            key: option.value,
            type: 'button',
            className: 'dsh-my-notify-p-seg',
            'aria-selected': String(option.value === mode),
            onClick: () => props.patch('askMode', option.value),
          },
          option.label,
        ),
      ),
    ),
  )
}
