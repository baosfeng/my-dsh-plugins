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
  /** 项目可读名（由服务端从 index.json 补齐），用于替代 hash id 展示。 */
  projectName?: string
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

/**
 * 卡片标题：项目文件显示「项目名 / 文件名」，其余保持原名。
 *
 * 用户看不懂 `projects/ba7b32df3d04/pitfalls.md` 是哪个仓库——实测他的库里
 * 两个项目各有一条「门禁假红」，靠 hash 根本分不清。
 */
function agentMemoryTitleOf(entry: AgentMemoryEntry): string {
  if (entry.projectName === undefined || !entry.name.startsWith('projects/')) return entry.name
  return entry.projectName + ' / ' + (entry.name.split('/')[2] ?? entry.name)
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
      createElement('code', { className: 'dsh-my-memory-agent-name', title: entry.name }, agentMemoryTitleOf(entry)),
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

/**
 * 一个分组里的卡片（编辑态 / 草稿 / 动作都来自面板状态）。
 *
 * 独立成函数而不是内联 map：否则 AgentMemoryPanel 会被卡片 props 撑过函数
 * 行数门禁，而且这层映射在分组视图里要复用。
 */
function agentMemoryCardsOf(group: AgentMemoryGroup, props: AgentMemoryState): ReactNode {
  return group.entries.map((entry) =>
    createElement(AgentMemoryCard, {
      key: entry.name,
      entry,
      editing: props.editing === entry.name,
      draft: props.draft,
      onEdit: () => props.onEdit(entry.name),
      onDraft: props.onDraft,
      onCancel: props.onCancel,
      onSave: props.onSave,
      onDelete: () => props.onDeleteAsk(entry.name),
    }),
  )
}

/** 第四个 tab 的整体视图：说明 + 晋升建议 + 分组卡片 + 归档区 + 两个确认层。 */
function AgentMemoryPanel(props: AgentMemoryState): ReactNode {
  const active = activeEntriesOf(props.groups).length
  const pendingDelete = findAgentEntry(props.groups, props.pendingDelete)
  const pendingPromote = props.suggestions.find((item) => item.text === props.pendingPromote)
  return createElement(
    'section',
    { className: 'dsh-my-memory-section' },
    createElement('p', { className: 'dsh-my-memory-note' }, strings.agentMemoryNote()),
    props.loading ? createElement('p', { className: 'dsh-my-memory-note' }, strings.loading()) : null,
    props.error ? createElement('p', { className: 'dsh-my-memory-error' }, strings.loadError()) : null,
    props.promoteError === '' ? null : createElement('p', { className: 'dsh-my-memory-error' }, props.promoteError),
    createElement(AgentMemorySuggests, { suggestions: props.suggestions, onPromote: props.onPromoteAsk }),
    active === 0 && !props.loading && !props.error ? createElement(AgentMemoryEmpty, null) : null,
    props.groups.map((group) =>
      createElement(AgentMemoryGroupBlock, {
        key: group.id,
        group,
        expanded: props.expanded.has(group.id),
        onToggle: () => props.onToggleGroup(group.id),
        renderCards: () => agentMemoryCardsOf(group, props),
      }),
    ),
    props.archived.length > 0
      ? createElement(AgentMemoryArchive, { entries: props.archived, onRestore: props.onRestore })
      : null,
    pendingDelete === undefined
      ? null
      : createElement(AgentMemoryDeleteConfirm, {
          entry: pendingDelete,
          onCancel: props.onDeleteCancel,
          onConfirm: () => props.onDeleteConfirm(pendingDelete.name),
        }),
    pendingPromote === undefined
      ? null
      : createElement(AgentMemoryPromoteConfirm, {
          suggestion: pendingPromote,
          onCancel: props.onPromoteCancel,
          onConfirm: props.onPromoteConfirm,
        }),
  )
}
