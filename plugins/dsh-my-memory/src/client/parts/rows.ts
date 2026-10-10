// ── rows: 行级子部件（记忆条目行 / 提示词行）────────────────────────────
// 与「候选条目」语义（candidates.ts）解耦：这里只放**单行渲染**的通用子部件，
// 供 view-rows.ts / candidates.ts / prompts.ts 共用（client 片段为 script 模式，
// 无 import/export，靠命名避免重名；拼接顺序见 scripts/build.mjs 的 pieces）。

/** 记忆条目类型（含元数据，供行级子部件使用）。 */
interface MemoryItemWithMeta {
  id: string
  desc: string
  category?: string
  confidence?: number
  updatedAt?: number
  history?: Array<{ action: string; at: number }>
  status?: string
  /** 来源会话（issue #209）：agent 自动保存的条目带 sessionId，手动新增为空。 */
  source?: { sessionId?: string }
}

/** 描述 + 截断/展开开关（cut 由调用方算好，避免重复截断）。 */
function MemoryRowDesc({
  shown,
  truncated,
  isExpanded,
  onToggle,
}: {
  shown: string
  truncated: boolean
  isExpanded: boolean
  onToggle: () => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-row-desc-wrap' },
    createElement('span', { className: 'dsh-my-memory-desc' }, shown),
    truncated
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
  )
}

/** 条目操作图标组（编辑 / 删除）。 */
function MemoryRowActions({
  id,
  onEdit,
  onDelete,
}: {
  id: string
  onEdit: () => void
  onDelete: () => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-actions' },
    createElement(
      IconButton,
      { className: 'dsh-my-memory-iconbtn', label: `${strings.edit()} ${id}`, onClick: onEdit },
      icon.pencil(14),
    ),
    createElement(
      IconButton,
      {
        className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-danger',
        label: `${strings.delete()} ${id}`,
        onClick: onDelete,
      },
      icon.trash(14),
    ),
  )
}

/** 提示词条目类型（与 prompts.ts 的同名接口声明合并；client 片段共享作用域）。 */
interface PromptItem {
  id: string
  title: string
  text: string
  enabled: boolean
  order: number
  builtin?: string
}

/** 提示词编辑态（与 prompts.ts 的同名接口声明合并）。 */
interface PromptEditing {
  id: string
  title: string
  text: string
}

/** 分区标题行（标题 + 条数徽标）。 */
function PromptsSectionHead({ count }: { count: number }): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-section-head' },
    createElement('span', { className: 'dsh-my-memory-section-title' }, strings.promptsSection()),
    createElement(ui.Pill, { className: 'dsh-my-memory-badge' }, strings.promptCount(count)),
  )
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

// 导出给其他 part 文件使用
