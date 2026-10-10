// ── prompts: 全局提示词的设置分区（issue #465）────────────────────────────
// 与记忆分区并列但完全隔离：独立数据源（/my-memory/api/prompts）、独立状态、
// 独立确认面板。交互：新增 / 编辑 / 删除 / 启用停用 / 上移下移（写回 order）；
// **不做拖拽**（零依赖、可测）。删除走红色二次确认，保存走绿色。

/** 提示词条目类型 */
interface PromptItem {
  id: string
  title: string
  text: string
  enabled: boolean
  order: number
  builtin?: string
}

/** 提示词编辑态（标题 + 正文一起编辑） */
interface PromptEditing {
  id: string
  title: string
  text: string
}

/** 提示词确认态 */
interface PromptConfirming {
  kind: 'add' | 'update' | 'delete'
  id?: string
  title?: string
  text?: string
}

/** 稳定的 React key。 */
function promptKey(id: string): string {
  return 'prompt/' + id
}

/** 一条提示词卡片：启停 + 标题（+ 内置徽标）+ 正文 + 排序/编辑/删除。 */
function PromptRow({
  item,
  isEditing,
  busy,
  onToggle,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: {
  item: PromptItem
  isEditing: boolean
  busy: boolean
  onToggle: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onDelete: () => void
}): ReactNode {
  const head = createElement(
    'div',
    { className: 'dsh-my-memory-row-head' },
    createElement(PromptToggle, { item, busy, onToggle }),
    createElement('span', { className: 'dsh-my-memory-prompt-title' }, item.title),
    item.builtin === undefined
      ? null
      : createElement('span', { className: 'dsh-my-memory-ct-badge' }, strings.promptBuiltin()),
    createElement(
      'div',
      { className: 'dsh-my-memory-actions' },
      createElement(
        IconButton,
        {
          className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-up',
          label: strings.promptMoveUp() + ' ' + item.id,
          onClick: onMoveUp,
        },
        icon.chevronDown(14),
      ),
      createElement(
        IconButton,
        { className: 'dsh-my-memory-iconbtn', label: strings.promptMoveDown() + ' ' + item.id, onClick: onMoveDown },
        icon.chevronDown(14),
      ),
      createElement(
        IconButton,
        { className: 'dsh-my-memory-iconbtn', label: strings.edit() + ' ' + item.id, onClick: onEdit },
        icon.pencil(14),
      ),
      createElement(
        IconButton,
        {
          className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-danger',
          label: strings.delete() + ' ' + item.id,
          onClick: onDelete,
        },
        icon.trash(14),
      ),
    ),
  )
  return createElement(
    'div',
    {
      className:
        'dsh-my-memory-row dsh-my-memory-prompt-row' + (item.enabled === true ? '' : ' dsh-my-memory-prompt-row-off'),
    },
    head,
    createElement('div', { className: 'dsh-my-memory-prompt-text' }, item.text),
  )
}

/** 新增栏：标题 + 正文（textarea）+ 新增按钮。 */
function PromptAddBar({
  draft,
  busy,
  onDraft,
  onAdd,
}: {
  draft: { title: string; text: string }
  busy: boolean
  onDraft: (patch: { title?: string; text?: string }) => void
  onAdd: () => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-addbar-wrap dsh-my-memory-prompt-addbar' },
    createElement(ui.Input, {
      className: 'dsh-my-memory-add-input',
      placeholder: strings.promptsAddPlaceholder(),
      'aria-label': strings.promptsAddInputAria(),
      value: draft.title,
      onChange: (event: { target: { value: string } }) => onDraft({ title: event.target.value }),
    }),
    createElement('textarea', {
      className: 'dsh-my-memory-prompt-textarea',
      placeholder: strings.promptsTextPlaceholder(),
      'aria-label': strings.promptsTextInputAria(),
      value: draft.text,
      onChange: (event: { target: { value: string } }) => onDraft({ text: event.target.value }),
    }),
    createElement(
      'button',
      { className: 'dsh-my-memory-btn-save', disabled: busy, 'aria-label': strings.add(), onClick: onAdd },
      icon.plus(14),
      strings.add(),
    ),
  )
}

/** 一条提示词：编辑态走编辑器，否则走卡片（纯渲染，无状态）。 */
function PromptEntry({
  item,
  editing,
  busy,
  onToggle,
  onMove,
  onEdit,
  onEditTitle,
  onEditText,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  item: PromptItem
  editing: PromptEditing | null
  busy: boolean
  onToggle: () => void
  onMove: (direction: 'up' | 'down') => void
  onEdit: () => void
  onEditTitle: (value: string) => void
  onEditText: (value: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: () => void
}): ReactNode {
  if (editing !== null && editing.id === item.id) {
    return createElement(PromptRowEdit, {
      key: promptKey(item.id),
      editing,
      onTitle: onEditTitle,
      onText: onEditText,
      onSave: onSaveEdit,
      onCancel: onCancelEdit,
    })
  }
  return createElement(PromptRow, {
    key: promptKey(item.id),
    item,
    isEditing: false,
    busy,
    onToggle,
    onMoveUp: () => onMove('up'),
    onMoveDown: () => onMove('down'),
    onEdit,
    onDelete,
  })
}

/** 列表主体：无条目时给引导空状态，否则渲染条目（纯渲染，无状态）。 */
function PromptEntryList({
  items,
  editing,
  busy,
  onToggle,
  onMove,
  onEdit,
  onEditTitle,
  onEditText,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  items: PromptItem[]
  editing: PromptEditing | null
  busy: boolean
  onToggle: (id: string) => void
  onMove: (id: string, direction: 'up' | 'down') => void
  onEdit: (item: PromptItem) => void
  onEditTitle: (value: string) => void
  onEditText: (value: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: (item: PromptItem) => void
}): ReactNode {
  if (items.length === 0) {
    return createElement(
      'div',
      { className: 'dsh-my-memory-empty' },
      strings.promptsEmpty(),
      '·',
      strings.promptsEmptyHint(),
    )
  }
  return items.map((item) =>
    createElement(PromptEntry, {
      key: promptKey(item.id),
      item,
      editing,
      busy,
      onToggle: () => onToggle(item.id),
      onMove: (direction: 'up' | 'down') => onMove(item.id, direction),
      onEdit: () => onEdit(item),
      onEditTitle,
      onEditText,
      onCancelEdit,
      onSaveEdit,
      onDelete: () => onDelete(item),
    }),
  )
}

/** 全局提示词分区（列表 + 新增栏 + 确认面板）。 */
function PromptsBlock({
  items,
  busy,
  editing,
  confirming,
  draft,
  onToggle,
  onMove,
  onEdit,
  onEditTitle,
  onEditText,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onDraft,
  onAdd,
  onConfirm,
  onCancelConfirm,
  onCommit,
}: {
  items: PromptItem[]
  busy: boolean
  editing: PromptEditing | null
  confirming: PromptConfirming | null
  draft: { title: string; text: string }
  onToggle: (id: string) => void
  onMove: (id: string, direction: 'up' | 'down') => void
  onEdit: (item: PromptItem) => void
  onEditTitle: (value: string) => void
  onEditText: (value: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: (item: PromptItem) => void
  onDraft: (patch: { title?: string; text?: string }) => void
  onAdd: () => void
  onConfirm: (confirm: PromptConfirming) => void
  onCancelConfirm: () => void
  onCommit: (confirm: PromptConfirming) => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-section dsh-my-memory-section-prompts' },
    createElement(PromptsSectionHead, { count: items.length }),
    createElement('div', { className: 'dsh-my-memory-note' }, strings.promptsNote()),
    createElement(PromptEntryList, {
      items,
      editing,
      busy,
      onToggle,
      onMove,
      onEdit,
      onEditTitle,
      onEditText,
      onCancelEdit,
      onSaveEdit,
      onDelete,
    }),
    createElement(PromptAddBar, { draft, busy, onDraft, onAdd }),
    createElement(PromptConfirmPanel, { confirming, busy, onCommit, onCancelConfirm }),
  )
}

/** 提示词确认面板（与记忆分区共用 ask 范式卡：删除红 / 保存绿）。
 *  拆成独立组件：单函数行数与圈复杂度都守门禁，且确认语义与列表渲染解耦。 */
function PromptConfirmPanel({
  confirming,
  busy,
  onCommit,
  onCancelConfirm,
}: {
  confirming: PromptConfirming | null
  busy: boolean
  onCommit: (confirm: PromptConfirming) => void
  onCancelConfirm: () => void
}): ReactNode {
  if (confirming === null) return null
  const isDelete = confirming.kind === 'delete'
  return createElement(AskConfirmCard, {
    variant: isDelete ? 'delete' : 'save',
    title: isDelete
      ? strings.confirmDeletePrompt()
      : confirming.kind === 'update'
        ? strings.confirmUpdatePrompt()
        : strings.confirmAddPrompt(),
    scope: '',
    category: '',
    content: (confirming.title ?? '') + (confirming.text === undefined ? '' : '\n' + confirming.text),
    note: strings.promptHint(),
    allowLabel: isDelete ? strings.confirmDeleteBtn() : strings.confirmSave(),
    disabled: busy,
    onAllow: () => onCommit(confirming),
    onReject: onCancelConfirm,
  })
}

/** 目标条目的当前启用态（toggle 需要翻转值；找不到时按「未启用」处理）。 */
function enabledOf(items: PromptItem[], id: string): boolean {
  const item = items.find((entry) => entry.id === id)
  return item !== undefined && item.enabled === true
}

/** 确认面板 → 写操作载荷（add / update / delete）。 */
function confirmPayload(confirm: PromptConfirming): Parameters<typeof writePrompt>[0] {
  if (confirm.kind === 'delete') return { action: 'delete', id: confirm.id }
  if (confirm.kind === 'update') {
    return { action: 'update', id: confirm.id, title: confirm.title, text: confirm.text }
  }
  return { action: 'add', title: confirm.title ?? '', text: confirm.text ?? '' }
}

// 导出给其他 part 文件使用
