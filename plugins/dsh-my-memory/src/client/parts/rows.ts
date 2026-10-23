// ── rows: 行级子部件（记忆条目行 / 提示词行 / 元数据行）──────────────────
// client 片段为 script 模式，无 import/export，靠命名避免重名；拼接顺序见
// scripts/build.mjs 的 pieces。这里只放**单行渲染**的通用子部件，供
// view-rows.ts / prompts.ts 共用。

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

/** 描述即展开开关：整段内容可点击，展开后显示全文（原型的信息层级）。 */
function MemoryRowDesc({
  shown,
  isExpanded,
  onToggle,
}: {
  shown: string
  isExpanded: boolean
  onToggle: () => void
}): ReactNode {
  return createElement(
    'button',
    {
      className: `dsh-my-memory-desc${isExpanded ? ' dsh-my-memory-desc-open' : ''}`,
      type: 'button',
      'aria-label': isExpanded ? strings.collapse() : strings.expand(),
      onClick: onToggle,
    },
    shown,
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

/** 演进历史列表（详情区）：无历史时给占位。 */
function HistoryList({ item }: { item: MemoryItemWithMeta }): ReactNode {
  const history = Array.isArray(item.history) ? item.history : []
  return createElement(
    'div',
    { className: 'dsh-my-memory-detail-block' },
    createElement('div', { className: 'dsh-my-memory-detail-label' }, strings.historyLabel()),
    history.length === 0
      ? createElement('span', { className: 'dsh-my-memory-detail-empty' }, strings.noHistory())
      : createElement(
          'ul',
          { className: 'dsh-my-memory-history' },
          history.map((entry, index) =>
            createElement(
              'li',
              { key: `${entry.at}-${index}` },
              `${strings.historyEntry(entry.action)} · ${relativeTime(entry.at)}`,
            ),
          ),
        ),
  )
}

/** 记忆条目元数据行：分类徽标 + 置信度点 + 矛盾标记 + 更新时间。
 *  来源会话与演进历史移入展开详情（原型的信息层级）。 */
function MetadataRow({ item }: { item: MemoryItemWithMeta }): ReactNode {
  const confidence =
    typeof item.confidence === 'number' && Number.isFinite(item.confidence) && item.confidence >= 0
      ? Math.min(5, Math.round(item.confidence))
      : null
  return createElement(
    'div',
    { className: 'dsh-my-memory-meta' },
    createElement('span', { className: 'dsh-my-memory-ct-badge' }, strings.categoryLabel(item.category)),
    confidence === null
      ? null
      : createElement(
          'span',
          { className: 'dsh-my-memory-conf', 'aria-label': strings.confidenceLabel(confidence) },
          [1, 2, 3, 4, 5].map((n) => createElement('i', { key: n, className: n <= confidence ? 'on' : '' })),
          createElement('b', null, `${confidence}/5`),
        ),
    item.status === 'conflict-pending'
      ? createElement('span', { className: 'dsh-my-memory-conflict-badge' }, strings.statusConflict())
      : null,
    createElement(
      'span',
      { className: 'dsh-my-memory-meta-time' },
      `${strings.updatedPrefix()}${relativeTime(item.updatedAt)}`,
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
    createElement('span', { className: 'dsh-my-memory-prompt-count' }, strings.promptCount(count)),
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

/** 提示词行操作组（上移 / 下移 / 编辑 / 删除）。 */
function PromptRowActions({
  id,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: {
  id: string
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onDelete: () => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-actions' },
    createElement(
      IconButton,
      {
        className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-up',
        label: strings.promptMoveUp() + ' ' + id,
        onClick: onMoveUp,
      },
      icon.chevronDown(14),
    ),
    createElement(
      IconButton,
      { className: 'dsh-my-memory-iconbtn', label: strings.promptMoveDown() + ' ' + id, onClick: onMoveDown },
      icon.chevronDown(14),
    ),
    createElement(
      IconButton,
      { className: 'dsh-my-memory-iconbtn', label: strings.edit() + ' ' + id, onClick: onEdit },
      icon.pencil(14),
    ),
    createElement(
      IconButton,
      {
        className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-danger',
        label: strings.delete() + ' ' + id,
        onClick: onDelete,
      },
      icon.trash(14),
    ),
  )
}

/** 启停开关（点击翻转 enabled）：原型一致的 30×18 胶囊开关。 */
function PromptToggle({ item, busy, onToggle }: { item: PromptItem; busy: boolean; onToggle: () => void }): ReactNode {
  const enabled = item.enabled === true
  return createElement(
    'button',
    {
      className: `dsh-my-memory-switch${enabled ? ' is-on' : ''}`,
      role: 'switch',
      'aria-checked': enabled,
      'aria-label': (enabled ? strings.promptToggleOff() : strings.promptToggleOn()) + ' ' + item.id,
      disabled: busy,
      onClick: onToggle,
    },
    createElement('span', { className: 'dsh-my-memory-switch-dot' }),
  )
}

// 导出给其他 part 文件使用
