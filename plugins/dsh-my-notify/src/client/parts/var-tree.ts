// ── 变量树（右列常驻 / 窄容器抽屉）：搜索 + 分组 chips + 悬停说明 ────────
//
// 数据来自 GET /notify/api/variables（VAR_GROUPS 已是分组结构）；
// 点击把 {{name}} 插到最近一次编辑框的光标处，悬停显示说明 / 示例。

/** 变量条目的悬停提示（说明 + 示例）。 */
function varHintOf(item: VarItem): string {
  const example = item.example !== '' ? ' · 例：' + item.example : ''
  return item.name + ' — ' + item.description + example
}

/** 变量搜索（按变量名与说明的包含匹配，大小写不敏感）。 */
function filterVarGroups(groups: VarGroup[], query: string): VarGroup[] {
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
  if (q === '') return groups
  const out: VarGroup[] = []
  for (const group of groups) {
    const items = group.items.filter(
      (item) => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
    )
    if (items.length > 0) out.push({ group: group.group, label: group.label, items })
  }
  return out
}

/** 变量树内容（搜索框 + 分组 chips）。 */
function variableTreeBody(props: { groups: VarGroup[]; onInsert: (name: string) => void }) {
  const [query, setQuery] = useState<string>('')
  const visible = filterVarGroups(props.groups, query)
  return [
    createElement('input', {
      className: 'dsh-my-notify-varq',
      value: query,
      placeholder: strings.varSearchPlaceholder(),
      'aria-label': strings.varSearch(),
      onChange: (event: any) => setQuery(event.target.value),
    }),
    visible.length === 0
      ? createElement('div', { className: 'dsh-my-notify-hint' }, strings.varNoMatch())
      : visible.map((group) =>
          createElement(
            'div',
            { key: group.group, className: 'dsh-my-notify-vgroup' },
            createElement('div', { className: 'dsh-my-notify-vgroup-hd' }, group.label),
            createElement(
              'div',
              { className: 'dsh-my-notify-vlist' },
              group.items.map((item) =>
                createElement(
                  'button',
                  {
                    key: item.name,
                    type: 'button',
                    className: 'dsh-my-notify-vchip',
                    title: varHintOf(item),
                    'aria-label': strings.varInsertDesc() + ' ' + item.name,
                    onClick: () => props.onInsert(item.name),
                  },
                  createElement('span', { className: 'dsh-my-notify-vname' }, item.name),
                  createElement('em', { className: 'dsh-my-notify-vdesc' }, item.description),
                ),
              ),
            ),
          ),
        ),
  ]
}

/** 右列常驻变量树。 */
function VariableTree(props: { groups: VarGroup[]; onInsert: (name: string) => void }) {
  return createElement(
    'aside',
    { className: 'dsh-my-notify-col dsh-my-notify-col-vars', 'aria-label': strings.varTree() },
    createElement('div', { className: 'dsh-my-notify-col-hd' }, strings.varTree()),
    createElement('div', { className: 'dsh-my-notify-vars' }, variableTreeBody(props)),
  )
}

/** 窄容器下的变量抽屉（点击 chip 后自动收起由父组件控制）。 */
function VarDrawer(props: { groups: VarGroup[]; onInsert: (name: string) => void; onClose: () => void }) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-drawer-vars', role: 'dialog', 'aria-label': strings.varTree() },
    createElement(
      'div',
      { className: 'dsh-my-notify-ed-hd' },
      createElement('b', null, strings.varTree()),
      createElement('span', { className: 'dsh-my-notify-grow' }),
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onClose },
        strings.close(),
      ),
    ),
    createElement('div', { className: 'dsh-my-notify-vars' }, variableTreeBody(props)),
  )
}
