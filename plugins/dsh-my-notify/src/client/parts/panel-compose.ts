/** 简版面板：事件编辑区（标题 / 正文 / 变量 / 送达 / askMode）。 */

interface PanelComposeProps {
  active: string
  template: MessageTemplate
  enabled: boolean
  onToggle: (on: boolean) => void
  onPatch: (template: MessageTemplate) => void
  onReset: () => void
  groups: VarGroup[]
  varsOpen: boolean
  onToggleVars: () => void
  onInsert: (name: string) => void
  onTarget: (target: string, caret: number) => void
  draft: NotifyConfig
  patch: PatchFn
  onOpenChannel: () => void
}

/** 每个事件最常用的变量（缺失时用变量库补齐）。 */
const PANEL_EVENT_VARS: Record<string, string[]> = {
  end: ['session.title', 'session.durationText', 'tokens.text', 'event.time'],
  ask: ['session.title', 'ask.summary', 'event.time'],
  approval: ['session.title', 'approval.reason', 'tool.name', 'event.time'],
  subagentEnd: ['session.title', 'session.durationText', 'event.note', 'event.time'],
  remote: ['session.title', 'event.note', 'event.time'],
}

/** 事件显示名（与真实触发事件一一对应）。 */
function panelEventLabel(key: string): string {
  if (key === 'ask') return strings.kindAsk()
  if (key === 'approval') return strings.kindApproval()
  if (key === 'subagentEnd') return strings.panelSubagentEnd()
  if (key === 'remote') return strings.panelRemote()
  return strings.eventEnd()
}

/** 常用变量的短标签（比描述更好扫读；未列入的仍走描述截断）。 */
const PANEL_VAR_LABELS: Record<string, string> = {
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

/** 变量 chip 的短标签（优先常用表，其次描述首个停顿前短语）。 */
function panelVarLabel(item: VarItem): string {
  const fixed = PANEL_VAR_LABELS[item.name]
  if (fixed !== undefined) return fixed
  const base = typeof item.description === 'string' && item.description !== '' ? item.description : item.name
  const cut = base.split(/[（(·,，]/)[0].trim()
  return cut.length > 8 ? cut.slice(0, 8) : cut
}

/** 补齐用变量（比变量库顺序更贴近日常：项目 / 耗时 / token / 摘要 / 审批 / 工具 / 链接）。 */
const PANEL_FILL_VARS = [
  'session.project',
  'session.durationText',
  'tokens.text',
  'event.note',
  'approval.reason',
  'tool.name',
  'session.url',
]

/** 当前事件的推荐变量：优先事件表，其次常用补齐表，最后才按变量库顺序兜底。 */
function panelPickVars(groups: VarGroup[], active: string): VarItem[] {
  const all: VarItem[] = []
  for (const group of groups) for (const item of group.items) all.push(item)
  const picked: VarItem[] = []
  const add = (name: string): void => {
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

/** 事件编辑区（单列，右侧留给飞书卡片预览）。 */
function PanelCompose(props: PanelComposeProps) {
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

/** 标题行：事件名 + 该事件是否发送（remote 恒开，给静态说明）。 */
function panelComposeHead(props: PanelComposeProps) {
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
            onChange: (event: any) => props.onToggle(event.target.checked),
          }),
          createElement('i'),
        ),
  )
}

/** 标题 / 正文两个字段（受控；记录光标位置供变量插入）。 */
function panelComposeFields(props: PanelComposeProps) {
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
        onFocus: (event: any) => props.onTarget('title', event.target.selectionStart ?? 0),
        onSelect: (event: any) => props.onTarget('title', event.target.selectionStart ?? 0),
        onChange: (event: any) => {
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
        onFocus: (event: any) => props.onTarget('body', event.target.selectionStart ?? 0),
        onSelect: (event: any) => props.onTarget('body', event.target.selectionStart ?? 0),
        onChange: (event: any) => {
          props.onTarget('body', event.target.selectionStart ?? event.target.value.length)
          props.onPatch({ title: props.template.title, body: event.target.value })
        },
      }),
    ),
  ]
}

/** 变量行：常用变量 chip + 全部变量入口。 */
function panelVarRow(props: PanelComposeProps) {
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

/** 全部变量面板（复用已有变量库；点击插入到最近编辑的字段）。 */
function panelVarSheet(props: PanelComposeProps) {
  return createElement(
    'div',
    { key: 'sheet', className: 'dsh-my-notify-p-var-sheet' },
    createElement(VariableLibrary, { groups: props.groups, onInsert: props.onInsert }),
  )
}

/** 送达：飞书（打开渠道配置）+ 系统通知 / 页面提示 / 提示音（即时切换）。 */
function panelDelivery(props: PanelComposeProps) {
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

/** 飞书 chip：已配置即点亮，点击进入渠道配置。 */
function panelFeishuChip(props: PanelComposeProps) {
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

/** 飞书渠道是否已配置（任一飞书 webhook 存在即视为已配置）。 */
function panelFeishuConfigured(draft: NotifyConfig): boolean {
  const list = Array.isArray(draft.webhooks) ? draft.webhooks : []
  return list.some((webhook) => webhook.channel === 'feishu')
}

/** 本地呈现开关 chip：同时写 config 与 localStorage（运行时 gate 立即生效）。 */
function panelPrefChip(
  props: PanelComposeProps,
  key: string,
  label: string,
  hint: string,
  lsKey: string,
  configKey: string,
) {
  const config = (props.draft as any)[configKey] ?? (defaultConfig() as any)[configKey] ?? { enabled: true }
  const on = prefOn(lsKey, config.enabled !== false)
  const toggle = (): void => {
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

/** 询问呈现（仅 ask 事件）：完整问题 / 仅摘要。 */
function panelAskMode(props: PanelComposeProps) {
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
