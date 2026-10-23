// ── view-rows: row / composer / confirm modal widgets for the Memory tab ──
// 条目卡片、空状态、排序开关、新增输入区（自适应高度 textarea）与确认弹层。
// 纯渲染组件，共用 view 工厂作用域内的 strings/icon/ui/utils。

/** 排序开关：原型式小按钮（最新 / 最旧优先）。 */
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
    'button',
    {
      className: 'dsh-my-memory-sort',
      type: 'button',
      'aria-label': `${strings.sortLabel()} ${scope}`,
      onClick: () => onSort(scope),
    },
    icon.chevronDown(14),
    order === 'desc' ? strings.sortNewest() : strings.sortOldest(),
  )
}

/** 空状态：无条目时的引导（hint 优先，如无项目会话时提示打开项目会话）。 */
function EmptyState({ hint }: { hint?: string }): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-empty' },
    createElement(
      'span',
      { className: 'dsh-my-memory-empty-body' },
      createElement('span', { className: 'dsh-my-memory-empty-main' }, strings.empty()),
      createElement('span', { className: 'dsh-my-memory-empty-hint' }, hint ?? strings.emptyHint()),
    ),
  )
}

/** 自适应高度 textarea：内容变高时按 scrollHeight 抬升，封顶 180px。
 *  node 环境（测试渲染）没有 DOM，直接跳过。 */
function autoGrowTextarea(target: unknown): void {
  const el = target as { style?: { height: string }; scrollHeight?: number } | null
  if (el === null || typeof el !== 'object' || el.style === undefined || typeof el.scrollHeight !== 'number') return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

/** 新增条目的输入区：多行自适应 textarea + 字数计数 + 超长提示 + 新增按钮。 */
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
  const over = isOverEntryLimit(value, entryLimit)
  return createElement(
    'div',
    { className: 'dsh-my-memory-composer' },
    createElement('textarea', {
      className: 'dsh-my-memory-composer-input',
      rows: 2,
      placeholder: strings.addPlaceholder(),
      'aria-label': strings.addInputAria(scope),
      value,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      onInput: (event: { target: unknown }) => autoGrowTextarea(event.target),
      onKeyDown: (event: { key: string; shiftKey?: boolean; preventDefault?: () => void }) => {
        if (event.key === 'Enter' && event.shiftKey !== true) {
          event.preventDefault?.()
          if (value.trim() !== '') onAdd()
        }
      },
    }),
    over
      ? createElement(
          'div',
          { className: 'dsh-my-memory-entry-hint' },
          strings.entryTooLongHint(value.length, entryLimit),
        )
      : null,
    createElement(
      'div',
      { className: 'dsh-my-memory-composer-foot' },
      createElement(
        'span',
        { className: 'dsh-my-memory-composer-hint' },
        createElement('span', { className: 'dsh-my-memory-count' }, `${value.length} / ${entryLimit}`),
        ' · ',
        strings.confirmHint(),
      ),
      createElement(
        'button',
        {
          className: 'dsh-my-memory-btn-add',
          'aria-label': `${strings.add()} ${scope}`,
          disabled: value.trim() === '',
          onClick: onAdd,
        },
        icon.plus(14),
        strings.add(),
      ),
    ),
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
  category?: string
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
  entryLimit: number,
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
      onSaveEdit: () => onConfirm({ kind: 'update', scope, id: item.id, desc: editing.desc, category: item.category }),
      onDelete: () => onConfirm({ kind: 'delete', scope, id: item.id, desc: item.desc, category: item.category }),
      onToggle: () => onToggle(key),
      entryLimit,
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

/** 编辑态：多行自适应输入 + 保存/取消（保存前仍需确认）。 */
function MemoryRowEdit({
  editingDesc,
  onEditDesc,
  onSaveEdit,
  onCancelEdit,
  entryLimit,
}: {
  editingDesc: string
  onEditDesc: (value: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  entryLimit: number
}): ReactNode {
  const over = isOverEntryLimit(editingDesc, entryLimit)
  return createElement(
    'div',
    { className: 'dsh-my-memory-row dsh-my-memory-row-editing' },
    createElement('textarea', {
      className: 'dsh-my-memory-composer-input',
      rows: 2,
      value: editingDesc,
      'aria-label': strings.edit(),
      onChange: (event: { target: { value: string } }) => onEditDesc(event.target.value),
      onInput: (event: { target: unknown }) => autoGrowTextarea(event.target),
    }),
    over
      ? createElement(
          'div',
          { className: 'dsh-my-memory-entry-hint' },
          strings.entryTooLongHint(editingDesc.length, entryLimit),
        )
      : null,
    createElement(
      'div',
      { className: 'dsh-my-memory-composer-foot' },
      createElement(
        'span',
        { className: 'dsh-my-memory-composer-hint' },
        createElement('span', { className: 'dsh-my-memory-count' }, `${editingDesc.length} / ${entryLimit}`),
        ' · ',
        strings.confirmHint(),
      ),
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
    ),
  )
}

/** 一条记忆卡片：描述（概要/展开）+ 操作图标组 + 元数据（分类/置信度/
 *  冲突/演进历史）+ 更新时间。 */
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
  entryLimit,
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
  entryLimit: number
}): ReactNode {
  if (isEditing) {
    return createElement(MemoryRowEdit, { editingDesc, onEditDesc, onSaveEdit, onCancelEdit, entryLimit })
  }
  const cut = truncateText(item.desc)
  return createElement(
    'div',
    { className: 'dsh-my-memory-row' },
    createElement(
      'div',
      { className: 'dsh-my-memory-row-head' },
      createElement(MemoryRowDesc, {
        shown: isExpanded ? item.desc : cut.text,
        isExpanded,
        onToggle,
      }),
      createElement(MemoryRowActions, { id: item.id, onEdit, onDelete }),
    ),
    createElement(MetadataRow, { item }),
    isExpanded ? createElement(MemoryDetail, { item }) : null,
  )
}

/** 展开详情：矛盾提示 + 来源会话/分类/置信度 + 演进历史（原型的信息层级）。 */
function MemoryDetail({ item }: { item: MemoryItem }): ReactNode {
  const confidence =
    typeof item.confidence === 'number' && Number.isFinite(item.confidence)
      ? Math.min(5, Math.round(item.confidence))
      : 1
  return createElement(
    'div',
    { className: 'dsh-my-memory-detail' },
    item.status === 'conflict-pending'
      ? createElement('div', { className: 'dsh-my-memory-conflict-note' }, strings.conflictNote())
      : null,
    createElement(
      'div',
      { className: 'dsh-my-memory-detail-grid' },
      createElement(
        'div',
        null,
        createElement('div', { className: 'dsh-my-memory-detail-label' }, strings.sourceLabel()),
        createElement(
          'div',
          { className: 'dsh-my-memory-detail-value' },
          item.source?.sessionId ? strings.sourceAgentLabel(item.source.sessionId) : '—',
        ),
      ),
      createElement(
        'div',
        null,
        createElement('div', { className: 'dsh-my-memory-detail-label' }, strings.askCategoryLabel()),
        createElement('div', { className: 'dsh-my-memory-detail-value' }, strings.categoryLabel(item.category)),
      ),
      createElement(
        'div',
        null,
        createElement('div', { className: 'dsh-my-memory-detail-label' }, strings.confidenceLabel(confidence)),
        createElement('div', { className: 'dsh-my-memory-detail-value' }, `${confidence}/5`),
      ),
    ),
    createElement(HistoryList, { item }),
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

/** 确认面板标题文案（按 kind 取；未知 kind 回落删除文案）。 */
const CONFIRM_TEXTS: Record<string, () => string> = {
  add: () => strings.confirmAdd(),
  update: () => strings.confirmUpdate(),
  delete: () => strings.confirmDelete(),
}

/** 记忆写操作确认：居中弹层 + 共用 ask 范式卡（保存绿 / 删除红）。 */
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
  return createElement(
    'div',
    { className: 'dsh-my-memory-overlay', role: 'presentation' },
    createElement(AskConfirmCard, {
      variant: isDelete ? 'delete' : 'save',
      title: CONFIRM_TEXTS[confirm.kind](),
      scope: confirm.scope,
      category: confirm.category ?? '',
      content: confirm.desc ?? '',
      showSummary: !isDelete && isOverEntryLimit(confirm.desc, entryLimit),
      note: strings.confirmHint(),
      allowLabel: isDelete ? strings.confirmDeleteBtn() : strings.confirmSave(),
      showOptions: false,
      onAllow: onOk,
      onReject: onCancel,
    }),
  )
}

// 导出给其他 part 文件使用
