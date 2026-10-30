// ── agent 记忆面板（issue #502）：第四个 tab ─────────────────────────
// 与现有三 tab 的关系：**完全独立的数据源与语义**。
//  - 全局记忆/项目记忆：用户确认后写入，条目卡片视图；
//  - agent 记忆：agent 自主写入，**文件视图**——正文原样展示，
//    元数据（创建时间/最后读取/读取次数）来自 index.json，agent 看不到
//    但**用户必须看得到**，这是「给用户了解原因」的唯一落点。
// 跨 part 引用（createElement/strings/utils）由拼接作用域解析。

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

/** 一份记忆的元数据行（时间 + 读取次数 + 归档标记）。 */
function AgentMemoryMeta({ entry }: { entry: AgentMemoryEntry }): ReactNode {
  const created = entry.createdAt > 0 ? relativeTime(entry.createdAt) : strings.agentMemoryNever()
  const lastRead = entry.lastReadAt > 0 ? relativeTime(entry.lastReadAt) : strings.agentMemoryNever()
  const parts = [strings.agentMemoryCreated(created), strings.agentMemoryRead(entry.readCount, lastRead)]
  if (entry.archived) parts.push(strings.agentMemoryArchived())
  return createElement('p', { className: 'dsh-my-memory-agent-meta' }, parts.join(' · '))
}

/** 卡片头部：文件名 + 编辑 / 删除按钮。 */
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
    createElement('code', { className: 'dsh-my-memory-agent-name' }, entry.name),
    createElement('span', { className: 'dsh-my-memory-agent-actions' }, [
      createElement(
        'button',
        { key: 'edit', type: 'button', className: 'dsh-my-memory-btn', disabled: entry.archived, onClick: onEdit },
        editing ? strings.agentMemoryCancel() : strings.agentMemoryEdit(),
      ),
      createElement(
        'button',
        { key: 'delete', type: 'button', className: 'dsh-my-memory-btn dsh-my-memory-btn-danger', onClick: onDelete },
        strings.agentMemoryDelete(),
      ),
    ]),
  )
}

/** 编辑态：多行等宽输入框 + 保存 / 取消。 */
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
      onChange: (event: { target: { value: string } }) => onDraft(event.target.value),
    }),
    createElement(
      'div',
      { className: 'dsh-my-memory-agent-save' },
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-memory-btn', onClick: onCancel },
        strings.agentMemoryCancel(),
      ),
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-memory-btn dsh-my-memory-btn-primary', onClick: onSave },
        strings.agentMemorySave(),
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
          createElement('code', { className: 'dsh-my-memory-agent-name' }, entry.name),
          createElement('span', { className: 'dsh-my-memory-agent-actions' }, [
            createElement(
              'button',
              {
                key: 'restore',
                type: 'button',
                className: 'dsh-my-memory-btn',
                onClick: () => onRestore(entry.name),
              },
              strings.agentMemoryRestore(),
            ),
          ]),
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

/** 第四个 tab 的整体视图：说明 + 提示 + 卡片列表 + 归档区。 */
function AgentMemoryPanel({
  entries,
  loading,
  error,
  editing,
  draft,
  onEdit,
  onDraft,
  onCancel,
  onSave,
  onDelete,
  onRestore,
}: {
  entries: AgentMemoryEntry[]
  loading: boolean
  error: boolean
  editing: string
  draft: string
  onEdit: (name: string) => void
  onDraft: (value: string) => void
  onCancel: () => void
  onSave: () => void
  onDelete: (name: string) => void
  onRestore: (name: string) => void
}): ReactNode {
  const active = entries.filter((entry) => !entry.archived)
  const archived = entries.filter((entry) => entry.archived)
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
      onDelete: () => onDelete(entry.name),
    }),
  )
  return createElement(
    'section',
    { className: 'dsh-my-memory-section dsh-my-memory-agent' },
    createElement('p', { className: 'dsh-my-memory-note' }, strings.agentMemoryNote()),
    loading ? createElement('p', { className: 'dsh-my-memory-note' }, strings.loading()) : null,
    error ? createElement('p', { className: 'dsh-my-memory-error' }, strings.loadError()) : null,
    cards.length === 0 && !loading && !error ? createElement(AgentMemoryEmpty, null) : null,
    cards.length > 0 ? createElement('div', { className: 'dsh-my-memory-list' }, cards) : null,
    archived.length > 0 ? createElement(AgentMemoryArchive, { entries: archived, onRestore }) : null,
  )
}
