'use strict'
function varToken(name) {
  return '{{' + name + '}}'
}
function insertVar(text, caret, name) {
  const source = typeof text === 'string' ? text : ''
  const token = varToken(name)
  const at = Number.isFinite(caret) ? Math.min(Math.max(0, Math.trunc(caret)), source.length) : source.length
  return { value: source.slice(0, at) + token + source.slice(at), caret: at + token.length }
}
function normalizeVarItem(item) {
  if (item === null || typeof item !== 'object') return null
  const raw = item
  const name = typeof raw.name === 'string' ? raw.name : ''
  if (name === '') return null
  const description =
    typeof raw.description === 'string' ? raw.description : typeof raw.desc === 'string' ? raw.desc : name
  const example = typeof raw.example === 'string' ? raw.example : typeof raw.sample === 'string' ? raw.sample : ''
  return { name, description, example }
}
function normalizeVarGroup(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const group = raw
  const rawItems = Array.isArray(group.items) ? group.items : Array.isArray(group.vars) ? group.vars : []
  const items = rawItems.map(normalizeVarItem).filter((item) => item !== null)
  if (items.length === 0) return null
  return {
    group: typeof group.group === 'string' ? group.group : typeof group.name === 'string' ? group.name : '',
    label: typeof group.label === 'string' ? group.label : '',
    items,
  }
}
function normalizeVarGroups(value) {
  const source = value
  const list = Array.isArray(value) ? value : source !== null && source !== undefined ? source.groups : undefined
  if (!Array.isArray(list)) return []
  return list.map(normalizeVarGroup).filter((item) => item !== null)
}
function varCountOf(groups) {
  return groups.reduce((sum, group) => sum + group.items.length, 0)
}
function VariableLibrary(props) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-vars', role: 'group', 'aria-label': strings.varLibrary() },
    props.groups.map((group) =>
      createElement(
        'div',
        { key: group.group, className: 'dsh-my-notify-vargroup' },
        createElement('div', { className: 'dsh-my-notify-vargroup-title' }, group.label),
        createElement(
          'div',
          { className: 'dsh-my-notify-varlist' },
          group.items.map((item) =>
            createElement(
              'button',
              {
                key: item.name,
                type: 'button',
                className: 'dsh-my-notify-vitem',
                title: item.example !== '' ? item.description + ' · ' + item.example : item.description,
                'aria-label': strings.varInsertDesc() + ' ' + item.name,
                onClick: () => props.onInsert(item.name),
              },
              item.name,
              createElement('em', null, item.description),
            ),
          ),
        ),
      ),
    ),
  )
}
function templateEditor(ctx) {
  const { active, template, resetTemplate, insert, groups, patch, setTarget, setCaret } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-editor' },
    { className: 'dsh-my-notify-editor' },
    createElement(
      'div',
      { className: 'dsh-my-notify-editor-hd' },
      createElement('b', null, eventLabelOf(active)),
      createElement('span', { className: 'dsh-my-notify-badge' }, active),
      createElement('span', { className: 'dsh-my-notify-grow' }),
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-notify-btn', onClick: resetTemplate },
        strings.resetDefaults(),
      ),
    ),
    createElement(
      'label',
      { className: 'dsh-my-notify-field' },
      createElement(
        'span',
        { className: 'dsh-my-notify-field-label' },
        strings.tplTitle(),
        createElement('span', { className: 'dsh-my-notify-field-count' }, template.title.length + ' / 52'),
      ),
      createElement('input', {
        className: 'dsh-my-notify-input-full',
        value: template.title,
        'aria-label': strings.tplTitle(),
        onFocus: () => setTarget('title'),
        onChange: (event) => {
          setTarget('title')
          setCaret(event.target.selectionStart ?? event.target.value.length)
          patch({ title: event.target.value, body: template.body })
        },
      }),
    ),
    createElement(
      'label',
      { className: 'dsh-my-notify-field' },
      createElement(
        'span',
        { className: 'dsh-my-notify-field-label' },
        strings.tplBody(),
        createElement('span', { className: 'dsh-my-notify-field-count' }, template.body.length + ' / 180'),
      ),
      createElement('textarea', {
        className: 'dsh-my-notify-textarea',
        value: template.body,
        'aria-label': strings.tplBody(),
        onFocus: () => setTarget('body'),
        onChange: (event) => {
          setTarget('body')
          setCaret(event.target.selectionStart ?? event.target.value.length)
          patch({ title: template.title, body: event.target.value })
        },
      }),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-field-label' },
      strings.varLibrary(),
      createElement('span', { className: 'dsh-my-notify-field-count' }, strings.varCount(varCountOf(groups))),
    ),
    createElement(VariableLibrary, { groups, onInsert: insert }),
  )
}
