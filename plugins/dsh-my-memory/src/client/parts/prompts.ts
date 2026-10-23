// ── prompts: 全局提示词的设置 tab（issue #465）────────────────────────────
// 与记忆 tab 并列但完全隔离：独立数据源（/my-memory/api/prompts）、独立状态、
// 独立确认面板。交互：新增 / 编辑 / 删除 / 启用停用 / 上移下移（写回 order）；
// **不做拖拽**（零依赖、可测）。删除走红色二次确认，保存走绿色。

/** 提示词正文上限（与宿主默认 maxPromptLength 一致；仅用于输入计数提示）。 */
const PROMPT_TEXT_LIMIT: number = 1000

/** 提示词确认态 */
interface PromptConfirming {
  kind: 'add' | 'update' | 'delete'
  id?: string
  title?: string
  text?: string
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
    item.enabled === true
      ? null
      : createElement('span', { className: 'dsh-my-memory-ct-badge' }, strings.promptDisabled()),
    createElement(PromptRowActions, { id: item.id, onMoveUp, onMoveDown, onEdit, onDelete }),
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

/** 新增栏：标题 + 正文（自适应 textarea）+ 字数 + 新增按钮。 */
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
  const over = draft.text.length > PROMPT_TEXT_LIMIT
  return createElement(
    'div',
    { className: 'dsh-my-memory-composer' },
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
      rows: 2,
      value: draft.text,
      onChange: (event: { target: { value: string } }) => onDraft({ text: event.target.value }),
      onInput: (event: { target: unknown }) => autoGrowTextarea(event.target),
    }),
    over
      ? createElement(
          'div',
          { className: 'dsh-my-memory-entry-hint' },
          strings.entryTooLongHint(draft.text.length, PROMPT_TEXT_LIMIT),
        )
      : null,
    createElement(
      'div',
      { className: 'dsh-my-memory-composer-foot' },
      createElement(
        'span',
        { className: 'dsh-my-memory-composer-hint' },
        createElement('span', { className: 'dsh-my-memory-count' }, `${draft.text.length} / ${PROMPT_TEXT_LIMIT}`),
        ' · ',
        strings.promptHint(),
      ),
      createElement(
        'button',
        {
          className: 'dsh-my-memory-btn-add',
          disabled: busy || draft.title.trim() === '' || draft.text.trim() === '',
          'aria-label': strings.add(),
          onClick: onAdd,
        },
        icon.plus(14),
        strings.add(),
      ),
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
      key: 'prompt/' + item.id,
      editing,
      onTitle: onEditTitle,
      onText: onEditText,
      onSave: onSaveEdit,
      onCancel: onCancelEdit,
    })
  }
  return createElement(PromptRow, {
    key: 'prompt/' + item.id,
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
      createElement(
        'span',
        { className: 'dsh-my-memory-empty-body' },
        createElement('span', { className: 'dsh-my-memory-empty-main' }, strings.promptsEmpty()),
        createElement('span', { className: 'dsh-my-memory-empty-hint' }, strings.promptsEmptyHint()),
      ),
    )
  }
  return items.map((item) =>
    createElement(PromptEntry, {
      key: 'prompt/' + item.id,
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

/** 全局提示词 tab（列表 + 新增栏 + 确认弹层）。 */
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
    createElement(
      'div',
      { className: 'dsh-my-memory-prompt-list' },
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
    ),
    createElement(PromptAddBar, { draft, busy, onDraft, onAdd }),
    createElement(PromptConfirmPanel, { confirming, busy, onCommit, onCancelConfirm }),
  )
}

/** 提示词确认弹层（与记忆分区共用 ask 范式卡：删除红 / 保存绿）。 */
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
  return createElement(
    'div',
    { className: 'dsh-my-memory-overlay', role: 'presentation' },
    createElement(AskConfirmCard, {
      variant: isDelete ? 'delete' : 'save',
      title: isDelete
        ? strings.confirmDeletePrompt()
        : confirming.kind === 'update'
          ? strings.confirmUpdatePrompt()
          : strings.confirmAddPrompt(),
      scope: 'prompts',
      category: '',
      content: (confirming.title ?? '') + (confirming.text === undefined ? '' : '\n' + confirming.text),
      note: strings.promptHint(),
      allowLabel: isDelete ? strings.confirmDeleteBtn() : strings.confirmSave(),
      disabled: busy,
      onAllow: () => onCommit(confirming),
      onReject: onCancelConfirm,
    }),
  )
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
