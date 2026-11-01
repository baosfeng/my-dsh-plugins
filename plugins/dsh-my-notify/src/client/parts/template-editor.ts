/** 占位符文本（模板语法 {{name}}，与 server 端 template.ts 一致）。 */
function varToken(name: string): string {
  return '{{' + name + '}}'
}

/** 在 text 的 caret 处插入变量：返回新文本与新光标位（caret 越界自动收敛）。 */
function insertVar(text: string, caret: number, name: string): { value: string; caret: number } {
  const source = typeof text === 'string' ? text : ''
  const token = varToken(name)
  const at = Number.isFinite(caret) ? Math.min(Math.max(0, Math.trunc(caret)), source.length) : source.length
  return { value: source.slice(0, at) + token + source.slice(at), caret: at + token.length }
}

/** 变量目录规整：兼容 [{group,label,items}] 与 {groups:[…]} 两种外壳（失败回退空数组）。 */
/** 单个变量条目规整（兼容 description / desc 与 example / sample）。 */
function normalizeVarItem(item: unknown): VarItem | null {
  if (item === null || typeof item !== 'object') return null
  const raw = item as Record<string, any>
  const name = typeof raw.name === 'string' ? raw.name : ''
  if (name === '') return null
  const description =
    typeof raw.description === 'string' ? raw.description : typeof raw.desc === 'string' ? raw.desc : name
  const example = typeof raw.example === 'string' ? raw.example : typeof raw.sample === 'string' ? raw.sample : ''
  return { name, description, example }
}

/** 单个分组规整（空分组丢弃）。 */
function normalizeVarGroup(raw: unknown): VarGroup | null {
  if (raw === null || typeof raw !== 'object') return null
  const group = raw as Record<string, any>
  const rawItems = Array.isArray(group.items) ? group.items : Array.isArray(group.vars) ? group.vars : []
  const items = rawItems.map(normalizeVarItem).filter((item: VarItem | null) => item !== null) as VarItem[]
  if (items.length === 0) return null
  return {
    group: typeof group.group === 'string' ? group.group : typeof group.name === 'string' ? group.name : '',
    label: typeof group.label === 'string' ? group.label : '',
    items,
  }
}

/** 变量目录规整：兼容 [{group,label,items}] 与 {groups:[…]} 两种外壳（失败回退空数组）。 */
function normalizeVarGroups(value: unknown): VarGroup[] {
  const source = value as Record<string, any> | null
  const list = Array.isArray(value) ? value : source !== null && source !== undefined ? source.groups : undefined
  if (!Array.isArray(list)) return []
  return list.map(normalizeVarGroup).filter((item: VarGroup | null) => item !== null) as VarGroup[]
}

/** 变量总数（变量库标题右侧计数）。 */
function varCountOf(groups: VarGroup[]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0)
}

/** 变量库（按分组渲染；点击把 {{name}} 插入到当前编辑框的光标处）。 */
function VariableLibrary(props: { groups: VarGroup[]; onInsert: (name: string) => void }) {
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

/** 模板编辑（标题 / 正文 / 变量库插入到光标处）。 */
function templateEditor(ctx: any) {
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
        onChange: (event: any) => {
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
        onChange: (event: any) => {
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
