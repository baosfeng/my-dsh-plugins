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

/** 一条提示词的编辑态：标题输入 + 正文 textarea + 保存/取消。 */
function PromptRowEdit({
  editing,
  onTitle,
  onText,
  onSave,
  onCancel,
}: {
  editing: PromptEditing
  onTitle: (value: string) => void
  onText: (value: string) => void
  onSave: () => void
  onCancel: () => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-row dsh-my-memory-row-editing dsh-my-memory-prompt-row' },
    createElement(ui.Input, {
      className: 'dsh-my-memory-add-input',
      placeholder: strings.promptsAddPlaceholder(),
      'aria-label': strings.promptsAddInputAria(),
      value: editing.title,
      onChange: (event: { target: { value: string } }) => onTitle(event.target.value),
    }),
    createElement('textarea', {
      className: 'dsh-my-memory-prompt-textarea',
      placeholder: strings.promptsTextPlaceholder(),
      'aria-label': strings.promptsTextInputAria(),
      value: editing.text,
      onChange: (event: { target: { value: string } }) => onText(event.target.value),
    }),
    createElement(
      'div',
      { className: 'dsh-my-memory-actions' },
      createElement('button', { className: 'dsh-my-memory-btn-save', onClick: onSave }, icon.check(14), strings.save()),
      createElement(
        ui.Button,
        {
          variant: 'ghost',
          size: 'sm',
          onClick: onCancel,
          icon: createElement(ui.IconCloseOutline16),
        },
        strings.cancel(),
      ),
    ),
  )
}

/** 启停 Pill（点击翻转 enabled）。 */
function PromptToggle({ item, busy, onToggle }: { item: PromptItem; busy: boolean; onToggle: () => void }): ReactNode {
  return createElement(
    ui.Pill,
    {
      className: 'dsh-my-memory-prompt-toggle',
      active: item.enabled === true,
      disabled: busy,
      'aria-label': (item.enabled === true ? strings.promptToggleOff() : strings.promptToggleOn()) + ' ' + item.id,
      onClick: onToggle,
    },
    item.enabled === true ? strings.promptEnabled() : strings.promptDisabled(),
  )
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
  const rows = items.map((item) => {
    const isEditing = editing !== null && editing.id === item.id
    if (isEditing) {
      return createElement(PromptRowEdit, {
        key: promptKey(item.id),
        editing: editing,
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
      onToggle: () => onToggle(item.id),
      onMoveUp: () => onMove(item.id, 'up'),
      onMoveDown: () => onMove(item.id, 'down'),
      onEdit: () => onEdit(item),
      onDelete: () => onDelete(item),
    })
  })
  return createElement(
    'div',
    { className: 'dsh-my-memory-section dsh-my-memory-section-prompts' },
    createElement(
      'div',
      { className: 'dsh-my-memory-section-head' },
      createElement('span', { className: 'dsh-my-memory-section-title' }, strings.promptsSection()),
      createElement(ui.Pill, { className: 'dsh-my-memory-badge' }, strings.promptCount(items.length)),
    ),
    createElement('div', { className: 'dsh-my-memory-note' }, strings.promptsNote()),
    rows.length === 0
      ? createElement(
          'div',
          { className: 'dsh-my-memory-empty' },
          strings.promptsEmpty(),
          '·',
          strings.promptsEmptyHint(),
        )
      : rows,
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
