'use strict'
function varHintOf(item) {
  const example = item.example !== '' ? ' · 例：' + item.example : ''
  return item.name + ' — ' + item.description + example
}
function filterVarGroups(groups, query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
  if (q === '') return groups
  const out = []
  for (const group of groups) {
    const items = group.items.filter(
      (item) => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
    )
    if (items.length > 0) out.push({ group: group.group, label: group.label, items })
  }
  return out
}
function variableTreeBody(props) {
  const [query, setQuery] = useState('')
  const visible = filterVarGroups(props.groups, query)
  return [
    createElement('input', {
      className: 'dsh-my-notify-varq',
      value: query,
      placeholder: strings.varSearchPlaceholder(),
      'aria-label': strings.varSearch(),
      onChange: (event) => setQuery(event.target.value),
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
function VariableTree(props) {
  return createElement(
    'aside',
    { className: 'dsh-my-notify-col dsh-my-notify-col-vars', 'aria-label': strings.varTree() },
    createElement('div', { className: 'dsh-my-notify-col-hd' }, strings.varTree()),
    createElement('div', { className: 'dsh-my-notify-vars' }, variableTreeBody(props)),
  )
}
function VarDrawer(props) {
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
