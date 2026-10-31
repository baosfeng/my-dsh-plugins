// ── agent 记忆面板（issue #502）：第四个 tab ─────────────────────────
// 与现有三 tab 的关系：**完全独立的数据源与语义**。
//  - 全局记忆/项目记忆：用户确认后写入，条目卡片视图；
//  - agent 记忆：agent 自主写入，**文件视图**——正文原样展示，
//    元数据（创建时间/最后读取/读取次数）来自 index.json，agent 看不到
//    但**用户必须看得到**，这是「给用户了解原因」的唯一落点。
// 跨 part 引用（createElement/strings/utils/icon/IconButton/ui）由拼接作用域解析。

/** 面板上的一份 agent 记忆（正文 + 元数据）。 */
interface AgentMemoryEntry {
  name: string
  content: string
  createdAt: number
  updatedAt: number
  lastReadAt: number
  readCount: number
  archived: boolean
}

/**
 * 记忆文件的作用域：根级（user.md / feedback.md / MEMORY.md）= 全局，
 * `projects/<id>/…` = 项目。
 *
 * 这是用户能看见「为什么这条会出现在这里」的唯一线索——项目相关的规则被
 * agent 写进全局层时，徽标会把错位直接暴露出来。
 */
function agentMemoryScopeOf(name: string): 'global' | 'project' {
  return name.startsWith('projects/') ? 'project' : 'global'
}

/** 作用域徽标。 */
function AgentMemoryScope({ name }: { name: string }): ReactNode {
  const scope = agentMemoryScopeOf(name)
  return createElement(
    'span',
    { className: `dsh-my-memory-agent-scope is-${scope}` },
    scope === 'project' ? strings.agentMemoryScopeProject() : strings.agentMemoryScopeGlobal(),
  )
}

/** 一份记忆的元数据行（时间 + 读取次数 + 归档标记）。 */
function AgentMemoryMeta({ entry }: { entry: AgentMemoryEntry }): ReactNode {
  const created = entry.createdAt > 0 ? relativeTime(entry.createdAt) : strings.agentMemoryNever()
  const lastRead = entry.lastReadAt > 0 ? relativeTime(entry.lastReadAt) : strings.agentMemoryNever()
  const parts = [strings.agentMemoryCreated(created), strings.agentMemoryRead(entry.readCount, lastRead)]
  if (entry.archived) parts.push(strings.agentMemoryArchived())
  return createElement('p', { className: 'dsh-my-memory-agent-meta' }, parts.join(' · '))
}

/**
 * 卡片头部：文件名 + 作用域徽标 + 行内操作。
 *
 * 操作按钮**必须**走设计系统里那一套 `.dsh-my-memory-iconbtn`（与全局记忆 /
 * 项目记忆 / 提示词三个 tab 的行内操作完全一致）。此前这里用 `dsh-my-memory-btn`
 * ——一个 styles.ts 里不存在的类名，按钮静默退化成浏览器默认样式。
 * 编辑态下头部不再显示操作：编辑器底部已有「保存 / 取消」，两处并存就会出现
 * 两个「取消」。
 */
function AgentMemoryHead({
  entry,
  editing,
  onEdit,
  onDelete,
}: {
  entry: AgentMemoryEntry
  editing: boolean
  onEdit: () => void
  onDelete: () => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-agent-head' },
    createElement(
      'span',
      { className: 'dsh-my-memory-agent-title' },
      createElement('code', { className: 'dsh-my-memory-agent-name' }, entry.name),
      createElement(AgentMemoryScope, { name: entry.name }),
    ),
    editing
      ? null
      : createElement(
          'div',
          { className: 'dsh-my-memory-actions' },
          createElement(
            IconButton,
            {
              className: 'dsh-my-memory-iconbtn',
              label: `${strings.agentMemoryEdit()} ${entry.name}`,
              onClick: onEdit,
            },
            icon.pencil(14),
          ),
          createElement(
            IconButton,
            {
              className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-danger',
              label: `${strings.agentMemoryDelete()} ${entry.name}`,
              onClick: onDelete,
            },
            icon.trash(14),
          ),
        ),
  )
}

/** 编辑态：多行等宽输入框 + 保存 / 取消（与 MemoryRowEdit 同一套按钮样式）。 */
function AgentMemoryEditor({
  draft,
  onDraft,
  onCancel,
  onSave,
}: {
  draft: string
  onDraft: (value: string) => void
  onCancel: () => void
  onSave: () => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-agent-editing' },
    createElement('textarea', {
      className: 'dsh-my-memory-agent-editor',
      value: draft,
      rows: 8,
      'aria-label': strings.agentMemoryEdit(),
      onChange: (event: { target: { value: string } }) => onDraft(event.target.value),
    }),
    createElement(
      'div',
      { className: 'dsh-my-memory-agent-save' },
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-memory-btn-save', onClick: onSave },
        icon.check(14),
        strings.agentMemorySave(),
      ),
      createElement(
        ui.Button,
        {
          variant: 'ghost',
          size: 'sm',
          onClick: onCancel,
          icon: createElement(ui.IconCloseOutline16),
        },
        strings.agentMemoryCancel(),
      ),
    ),
  )
}

/** 一份记忆的完整卡片：文件名 + 元数据 + 正文（纯文本，等宽）。 */
function AgentMemoryCard({
  entry,
  editing,
  draft,
  onEdit,
  onDraft,
  onCancel,
  onSave,
  onDelete,
}: {
  entry: AgentMemoryEntry
  editing: boolean
  draft: string
  onEdit: () => void
  onDraft: (value: string) => void
  onCancel: () => void
  onSave: () => void
  onDelete: () => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-agent-card' },
    createElement(AgentMemoryHead, { entry, editing, onEdit, onDelete }),
    createElement(AgentMemoryMeta, { entry }),
    editing
      ? createElement(AgentMemoryEditor, { draft, onDraft, onCancel, onSave })
      : createElement('pre', { className: 'dsh-my-memory-agent-body' }, entry.content),
  )
}

/** 归档区：已归档的记忆只读展示（不可编辑、不在主列表），可一键恢复。 */
function AgentMemoryArchive({
  entries,
  onRestore,
}: {
  entries: AgentMemoryEntry[]
  onRestore: (name: string) => void
}): ReactNode {
  return createElement(
    'details',
    { className: 'dsh-my-memory-agent-archive' },
    createElement('summary', null, strings.agentMemoryArchiveTitle(entries.length)),
    entries.map((entry) =>
      createElement(
        'div',
        { key: entry.name, className: 'dsh-my-memory-agent-card is-archived' },
        createElement(
          'div',
          { className: 'dsh-my-memory-agent-head' },
          createElement(
            'span',
            { className: 'dsh-my-memory-agent-title' },
            createElement('code', { className: 'dsh-my-memory-agent-name' }, entry.name),
            createElement(AgentMemoryScope, { name: entry.name }),
          ),
          createElement(
            'div',
            { className: 'dsh-my-memory-actions' },
            createElement(
              ui.Button,
              { variant: 'ghost', size: 'sm', onClick: () => onRestore(entry.name) },
              strings.agentMemoryRestore(),
            ),
          ),
        ),
        createElement(AgentMemoryMeta, { entry }),
        createElement('pre', { className: 'dsh-my-memory-agent-body' }, entry.content),
      ),
    ),
  )
}

/** 空态提示（agent 还没写过记忆是常态，不是错误）。 */
function AgentMemoryEmpty(): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-empty' },
    createElement('p', null, strings.agentMemoryEmpty()),
    createElement('p', { className: 'dsh-my-memory-empty-hint' }, strings.agentMemoryEmptyHint()),
  )
}

/** 删除确认层（复用 ask 范式卡片）：agent 记忆是长期数据，误删不可恢复。 */
function AgentMemoryDeleteConfirm({
  entry,
  onCancel,
  onConfirm,
}: {
  entry: AgentMemoryEntry
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-overlay', role: 'presentation' },
    createElement(AskConfirmCard, {
      variant: 'delete',
      title: strings.agentMemoryDeleteTitle(),
      scope: agentMemoryScopeOf(entry.name),
      category: '',
      content: entry.content,
      showSummary: false,
      note: strings.agentMemoryDeleteNote(),
      allowLabel: strings.confirmDeleteBtn(),
      onAllow: onConfirm,
      onReject: onCancel,
    }),
  )
}

/** 第四个 tab 的整体视图：说明 + 提示 + 卡片列表 + 归档区 + 删除确认层。 */
function AgentMemoryPanel({
  entries,
  loading,
  error,
  editing,
  draft,
  pendingDelete,
  onEdit,
  onDraft,
  onCancel,
  onSave,
  onDeleteAsk,
  onDeleteConfirm,
  onDeleteCancel,
  onRestore,
}: {
  entries: AgentMemoryEntry[]
  loading: boolean
  error: boolean
  editing: string
  draft: string
  pendingDelete: string
  onEdit: (name: string) => void
  onDraft: (value: string) => void
  onCancel: () => void
  onSave: () => void
  onDeleteAsk: (name: string) => void
  onDeleteConfirm: (name: string) => void
  onDeleteCancel: () => void
  onRestore: (name: string) => void
}): ReactNode {
  const active = entries.filter((entry) => !entry.archived)
  const archived = entries.filter((entry) => entry.archived)
  const pending = entries.find((entry) => entry.name === pendingDelete)
  const cards = active.map((entry) =>
    createElement(AgentMemoryCard, {
      key: entry.name,
      entry,
      editing: editing === entry.name,
      draft,
      onEdit: () => onEdit(entry.name),
      onDraft,
      onCancel,
      onSave,
      onDelete: () => onDeleteAsk(entry.name),
    }),
  )
  return createElement(
    'section',
    { className: 'dsh-my-memory-section' },
    createElement('p', { className: 'dsh-my-memory-note' }, strings.agentMemoryNote()),
    loading ? createElement('p', { className: 'dsh-my-memory-note' }, strings.loading()) : null,
    error ? createElement('p', { className: 'dsh-my-memory-error' }, strings.loadError()) : null,
    cards.length === 0 && !loading && !error ? createElement(AgentMemoryEmpty, null) : null,
    cards.length > 0 ? createElement('div', { className: 'dsh-my-memory-list' }, cards) : null,
    archived.length > 0 ? createElement(AgentMemoryArchive, { entries: archived, onRestore }) : null,
    pending === undefined
      ? null
      : createElement(AgentMemoryDeleteConfirm, {
          entry: pending,
          onCancel: onDeleteCancel,
          onConfirm: () => onDeleteConfirm(pending.name),
        }),
  )
}
