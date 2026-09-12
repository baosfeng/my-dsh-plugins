// ── view-rows: row/entry widgets for the Memory tab ─────────────────────
// 拆分自 view.part.js（issue #110 视觉重设计）：条目卡片、空状态、排序开关、
// 新增栏与确认面板。纯渲染组件，共用 view 工厂作用域内的 strings/icon/utils。

/** 排序开关：按更新时间切换最新/最旧优先（每分区独立）。官方 Pill 承载
 *  （issue #143 试点）：active 表示当前排序方向，点击切换。 */
function SortToggle({
  scope,
  order,
  onSort,
}: {
  scope: string
  order: 'desc' | 'asc'
  onSort: (scope: string) => void
}): ReactNode {
  return createElement(
    ui.Pill,
    {
      className: 'dsh-my-memory-sort',
      active: order === 'desc',
      'aria-label': `${strings.sortLabel()} ${scope}`,
      onClick: () => onSort(scope),
    },
    createElement(ui.IconChevronDownOutline14),
    order === 'desc' ? strings.sortNewest() : strings.sortOldest(),
  )
}

/** 空状态：无条目时的引导（hint 优先，如无会话项目提示输入项目根路径）。 */
function EmptyState({ hint }: { hint?: string }): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-empty' },
    createElement('span', { className: 'dsh-my-memory-empty-icon' }, icon.file(16)),
    createElement(
      'div',
      { className: 'dsh-my-memory-empty-body' },
      createElement('span', { className: 'dsh-my-memory-empty-main' }, strings.empty()),
      createElement('span', { className: 'dsh-my-memory-empty-hint' }, hint ?? strings.emptyHint()),
    ),
  )
}

/** 新增条目的输入 + 保存按钮；超长时给出精简提示（issue #105）。
 *  输入用官方 Input（issue #143 试点）；保存按钮保留自研（语义绿）。 */
function AddBar({
  scope,
  value,
  onChange,
  onAdd,
  entryLimit,
}: {
  scope: string
  value: string
  onChange: (value: string) => void
  onAdd: () => void
  entryLimit: number
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-addbar-wrap' },
    createElement(
      'div',
      { className: 'dsh-my-memory-addbar' },
      createElement(ui.Input, {
        className: 'dsh-my-memory-add-input',
        placeholder: strings.addPlaceholder(),
        'aria-label': strings.addInputAria(scope),
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      }),
      createElement(
        'button',
        {
          className: 'dsh-my-memory-btn-save',
          'aria-label': `${strings.add()} ${scope}`,
          onClick: onAdd,
        },
        icon.plus(14),
        strings.add(),
      ),
    ),
    isOverEntryLimit(value, entryLimit)
      ? createElement(
          'div',
          { className: 'dsh-my-memory-entry-hint' },
          strings.entryTooLongHint(value.length, entryLimit),
        )
      : null,
  )
}

/** 记忆条目编辑状态 */
interface EditingState {
  scope: string
  id: string
  desc: string
}

/** 确认状态 */
interface ConfirmingState {
  kind: 'add' | 'update' | 'delete'
  scope: string
  id?: string
  desc?: string
}

/** 记忆条目类型 */
interface MemoryItem {
  id: string
  desc: string
  category?: string
  confidence?: number
  updatedAt?: number
  createdAt?: number
  history?: Array<{ action: string; at: number }>
  status?: string
  source?: { sessionId?: string }
}

function buildRows(
  items: MemoryItem[],
  scope: string,
  editing: EditingState | null,
  onEdit: (scope: string, id: string, desc: string) => void,
  onEditDesc: (value: string) => void,
  onCancelEdit: () => void,
  onConfirm: (confirm: ConfirmingState) => void,
  expanded: Set<string>,
  onToggle: (key: string) => void,
): ReactNode[] {
  return items.map((item) => {
    const isEditing = editing !== null && editing.scope === scope && editing.id === item.id
    const key = `${scope}/${item.id}`
    return createElement(MemoryRow, {
      key,
      item,
      isEditing,
      isExpanded: expanded.has(key),
      editingDesc: isEditing ? editing.desc : '',
      onEdit: () => onEdit(scope, item.id, item.desc),
      onEditDesc,
      onCancelEdit,
      onSaveEdit: () => onConfirm({ kind: 'update', scope, id: item.id, desc: editing.desc }),
      onDelete: () => onConfirm({ kind: 'delete', scope, id: item.id, desc: item.desc }),
      onToggle: () => onToggle(key),
    })
  })
}

function IconButton({
  className,
  label,
  onClick,
  children,
}: {
  className: string
  label: string
  onClick: () => void
  children: ReactNode
}): ReactNode {
  return createElement('button', { className, 'aria-label': label, onClick }, children)
}

/** 编辑态：输入 + 保存/取消，保留卡片底与操作/内容分离。输入用官方
 *  Input、取消用官方 Button（issue #143 试点）；保存保留自研（语义绿）。 */
function MemoryRowEdit({
  editingDesc,
  onEditDesc,
  onSaveEdit,
  onCancelEdit,
}: {
  editingDesc: string
  onEditDesc: (value: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-row dsh-my-memory-row-editing' },
    createElement(ui.Input, {
      className: 'dsh-my-memory-add-input',
      value: editingDesc,
      onChange: (event: { target: { value: string } }) => onEditDesc(event.target.value),
    }),
    createElement(
      'div',
      { className: 'dsh-my-memory-actions' },
      createElement(
        'button',
        { className: 'dsh-my-memory-btn-save', onClick: onSaveEdit },
        icon.check(14),
        strings.save(),
      ),
      createElement(
        ui.Button,
        {
          variant: 'ghost',
          size: 'sm',
          onClick: onCancelEdit,
          icon: createElement(ui.IconCloseOutline16),
        },
        strings.cancel(),
      ),
    ),
  )
}

/** 一条记忆卡片：描述（+截断/展开）+ 操作图标组 + 元数据（分类/置信度/
 *  冲突/演进历史，issue #78）+ 更新时间。 */
function MemoryRow({
  item,
  isEditing,
  isExpanded,
  editingDesc,
  onEdit,
  onEditDesc,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onToggle,
}: {
  item: MemoryItem
  isEditing: boolean
  isExpanded: boolean
  editingDesc: string
  onEdit: () => void
  onEditDesc: (value: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: () => void
  onToggle: () => void
}): ReactNode {
  if (isEditing) return createElement(MemoryRowEdit, { editingDesc, onEditDesc, onSaveEdit, onCancelEdit })
  const cut = truncateText(item.desc)
  const shown = isExpanded ? item.desc : cut.text
  return createElement(
    'div',
    { className: 'dsh-my-memory-row' },
    createElement(
      'div',
      { className: 'dsh-my-memory-row-head' },
      createElement(
        'div',
        { className: 'dsh-my-memory-row-desc-wrap' },
        createElement('span', { className: 'dsh-my-memory-desc' }, shown),
        cut.truncated
          ? createElement(
              'button',
              {
                className: `dsh-my-memory-expand${isExpanded ? ' dsh-my-memory-expand-open' : ''}`,
                'aria-label': isExpanded ? strings.collapse() : strings.expand(),
                onClick: onToggle,
              },
              icon.chevronDown(14),
              isExpanded ? strings.collapse() : strings.expand(),
            )
          : null,
      ),
      createElement(
        'div',
        { className: 'dsh-my-memory-actions' },
        createElement(
          IconButton,
          { className: 'dsh-my-memory-iconbtn', label: `${strings.edit()} ${item.id}`, onClick: onEdit },
          icon.pencil(14),
        ),
        createElement(
          IconButton,
          {
            className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-danger',
            label: `${strings.delete()} ${item.id}`,
            onClick: onDelete,
          },
          icon.trash(14),
        ),
      ),
    ),
    createElement(MetadataRow, { item, isExpanded, onToggle }),
  )
}

/** 概要预览行（issue #105）：add/update 内容超长时提示「完整内容保存 + 显示概要」。 */
function SummaryPreview({ desc }: { desc: string }): ReactNode {
  const summary = truncateText(desc, TRUNCATE_LEN)
  return createElement(
    'div',
    { className: 'dsh-my-memory-confirm-summary' },
    createElement('span', { className: 'dsh-my-memory-confirm-summary-label' }, strings.summaryPreview()),
    createElement('span', { className: 'dsh-my-memory-confirm-summary-text' }, summary.text),
  )
}

/** 自定义确认面板（ask 模式，非原生 confirm）：删除红、保存绿。
 *  issue #193：改用与工具侧共用同一份 ask 范式卡（AskConfirmCard：条带 +
 *  20px 大卡 + 范围选项行 + footer 动作区），两边形态一致。
 *  add/update 时若内容超长，显示概要预览（完整内容仍保存，issue #105）。 */
function ConfirmPanel({
  confirm,
  onCancel,
  onOk,
  entryLimit,
}: {
  confirm: ConfirmingState
  onCancel: () => void
  onOk: () => void
  entryLimit: number
}): ReactNode {
  const isDelete = confirm.kind === 'delete'
  return createElement(AskConfirmCard, {
    variant: isDelete ? 'delete' : 'save',
    title: CONFIRM_TEXTS[confirm.kind](),
    scope: confirm.scope,
    category: '',
    content: confirm.desc ?? '',
    showSummary: !isDelete && isOverEntryLimit(confirm.desc, entryLimit),
    note: strings.confirmHint(),
    allowLabel: isDelete ? strings.confirmDeleteBtn() : strings.confirmSave(),
    onAllow: onOk,
    onReject: onCancel,
  })
}

/** 确认面板标题文案（按 kind 取；未知 kind 回落删除文案）。 */
const CONFIRM_TEXTS: Record<string, () => string> = {
  add: () => strings.confirmAdd(),
  update: () => strings.confirmUpdate(),
  delete: () => strings.confirmDelete(),
}

/** Path input + load/refresh buttons + consent note. 路径输入用官方 Input、
 *  加载/刷新用官方 Button（size sm，issue #143 试点）。 */
function Toolbar({
  pathInput,
  onInput,
  onLoad,
  onRefresh,
}: {
  pathInput: string
  onInput: (value: string) => void
  onLoad: (path: string) => void
  onRefresh: (path: string) => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-toolbar' },
    createElement(
      'div',
      { className: 'dsh-my-memory-pathbar' },
      createElement(ui.Input, {
        className: 'dsh-my-memory-path-input',
        icon: createElement(ui.IconFolderOpenOutline16),
        placeholder: strings.projectHint(),
        'aria-label': strings.pathInputAria(),
        title: strings.pathInputAria(),
        value: pathInput,
        onChange: (event: { target: { value: string } }) => onInput(event.target.value),
        onKeyDown: (event: { key: string }) => {
          if (event.key === 'Enter') onLoad(pathInput)
        },
      }),
      createElement(
        ui.Button,
        {
          variant: 'outline',
          size: 'sm',
          'aria-label': strings.loadProject(),
          onClick: () => onLoad(pathInput),
          icon: createElement(ui.IconFolderOpenOutline16),
        },
        strings.loadProject(),
      ),
      createElement(
        ui.Button,
        {
          variant: 'outline',
          size: 'sm',
          'aria-label': strings.refresh(),
          onClick: () => onRefresh(pathInput),
          icon: createElement(ui.IconRefreshOutline14),
        },
        strings.refresh(),
      ),
    ),
    createElement('div', { className: 'dsh-my-memory-note' }, strings.confirmHint()),
  )
}

// 导出给其他 part 文件使用
