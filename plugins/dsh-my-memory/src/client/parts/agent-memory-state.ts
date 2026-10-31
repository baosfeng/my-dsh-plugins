// ── agent 记忆面板的状态（issue #502）────────────────────────────────
// 与 prompts-state 同构：把「加载 / 分组折叠 / 编辑 / 草稿 / 保存 / 删除确认 /
// 晋升」从 view.ts 里析出，守住 apply 与 view 的函数行数门禁。

/** 面板状态与动作（直接摊平给 AgentMemoryPanel 的 props）。 */
interface AgentMemoryState {
  /** 分组（全局一份 + 每个项目一份；服务端已按「全局 → 最近写入」排好）。 */
  groups: AgentMemoryGroup[]
  /** 已归档条目（只读展示 + 恢复）。 */
  archived: AgentMemoryEntry[]
  /** 跨项目晋升建议（面板顶部）。 */
  suggestions: PromoteSuggestion[]
  /** 已展开的分组 id 集合。 */
  expanded: Set<string>
  loading: boolean
  error: boolean
  /** 晋升失败的可读原因（'' = 没有）。 */
  promoteError: string
  editing: string
  draft: string
  /** 待确认删除的文件名（'' = 无）。 */
  pendingDelete: string
  /** 待确认晋升的建议文本（'' = 无）。 */
  pendingPromote: string
  onEdit: (name: string) => void
  onDraft: (value: string) => void
  onCancel: () => void
  onSave: () => void
  onDeleteAsk: (name: string) => void
  onDeleteConfirm: (name: string) => void
  onDeleteCancel: () => void
  onRestore: (name: string) => void
  onToggleGroup: (id: string) => void
  onPromoteAsk: (text: string) => void
  onPromoteConfirm: () => void
  onPromoteCancel: () => void
}

/** 面板的动作集合（钩子只负责把它们和状态拼在一起）。 */
type AgentMemoryActions = Pick<
  AgentMemoryState,
  | 'onEdit'
  | 'onDraft'
  | 'onCancel'
  | 'onSave'
  | 'onDeleteAsk'
  | 'onDeleteConfirm'
  | 'onDeleteCancel'
  | 'onRestore'
  | 'onToggleGroup'
  | 'onPromoteAsk'
  | 'onPromoteConfirm'
  | 'onPromoteCancel'
>

/** 面板状态设置器（加载 / 落盘动作按需取用）。 */
interface AgentSetters {
  setPayload: (value: AgentMemoryPayload) => void
  setExpanded: (value: Set<string>) => void
  setLoading: (value: boolean) => void
  setError: (value: boolean) => void
  setEditing: (value: string) => void
  setDraft: (value: string) => void
  setPendingDelete: (value: string) => void
  setPendingPromote: (value: string) => void
}

/** 一次落盘动作成功后要更新的面板状态（删除 / 晋升共用）。 */
interface AgentSettle {
  setPendingDelete: (value: string) => void
  setPendingPromote: (value: string) => void
  setPayload: (value: AgentMemoryPayload) => void
  setError: (value: boolean) => void
  setPromoteError: (value: string) => void
  setEditing: (value: string) => void
  setDraft: (value: string) => void
}

/** 分组里的全部活跃条目（编辑 / 删除要按文件名回查正文）。 */
function activeEntriesOf(groups: AgentMemoryGroup[]): AgentMemoryEntry[] {
  return groups.flatMap((group) => group.entries)
}

/** 按文件名在任一分组里找一条（删除确认层 / 编辑态回查用）。 */
function findAgentEntry(groups: AgentMemoryGroup[], name: string): AgentMemoryEntry | undefined {
  for (const group of groups) {
    const hit = group.entries.find((entry) => entry.name === name)
    if (hit !== undefined) return hit
  }
  return undefined
}

/** 默认展开：全局 + 最近写入的项目（服务端已把最近写入的项目排在第一个）。 */
function defaultExpandedOf(groups: AgentMemoryGroup[]): Set<string> {
  const ids = groups.filter((group) => group.kind === 'global').map((group) => group.id)
  const recent = groups.find((group) => group.kind === 'project')
  if (recent !== undefined) ids.push(recent.id)
  return new Set(ids)
}

/** 恢复一条已归档记忆（服务端搬回原位 + 清归档标记），返回最新载荷。 */
function restoreAgentMemory(name: string): Promise<AgentMemoryPayload> {
  return writeAgentMemory({ action: 'restore', name })
}

/** 进入编辑态：把该文件当前正文载入草稿（write 是整份覆盖，必须先拿到原文）。 */
function beginAgentEdit(
  groups: AgentMemoryGroup[],
  name: string,
  setEditing: (value: string) => void,
  setDraft: (value: string) => void,
): void {
  const target = findAgentEntry(groups, name)
  setEditing(name)
  setDraft(target === undefined ? '' : target.content)
}

/** 挂载即拉一次：默认展开「全局 + 最近写入的项目」（用户手动的展开只在本次有效）。 */
function loadAgentMemory(set: AgentSetters): void {
  set.setLoading(true)
  set.setError(false)
  fetchAgentMemory()
    .then((next) => {
      set.setPayload(next)
      set.setExpanded(defaultExpandedOf(next.groups))
    })
    .catch(() => set.setError(true))
    .finally(() => set.setLoading(false))
}

/** 保存一个文件的正文（write 是整份覆盖）；成功清编辑态，失败只标错不吞掉。 */
function saveAgentMemory(
  groups: AgentMemoryGroup[],
  name: string,
  draft: string,
  settle: AgentSettle,
): void {
  if (findAgentEntry(groups, name) === undefined) return
  writeAgentMemory({ action: 'write', name, content: draft })
    .then((next) => {
      settle.setPayload(next)
      settle.setEditing('')
      settle.setDraft('')
    })
    .catch(() => settle.setError(true))
}

/** 确认层通过后真正落盘删除，并用服务端回传的最新载荷刷新。 */
function commitAgentDelete(name: string, editing: string, settle: AgentSettle): void {
  settle.setPendingDelete('')
  writeAgentMemory({ action: 'delete', name })
    .then((next) => {
      settle.setPayload(next)
      if (editing === name) {
        settle.setEditing('')
        settle.setDraft('')
      }
    })
    .catch(() => settle.setError(true))
}

/**
 * 确认层通过后执行晋升。
 *
 * 失败时必须把**服务端给的原因**（护栏拒绝 / 建议已过期 / 全局层写满）放到
 * 面板上：晋升是用户点过确认的动作，静默失败等于骗他「已经合并了」。
 */
function commitAgentPromote(text: string, settle: AgentSettle): void {
  settle.setPendingPromote('')
  settle.setPromoteError('')
  promoteAgentMemory(text)
    .then((next) => {
      settle.setPayload(next)
      settle.setEditing('')
      settle.setDraft('')
    })
    .catch((reason: Error) => settle.setPromoteError(reason.message))
}

/** 由设置器拼出落盘动作的回调集。 */
function settleOf(set: AgentSetters, setPromoteError: (value: string) => void): AgentSettle {
  return {
    setPendingDelete: set.setPendingDelete,
    setPendingPromote: set.setPendingPromote,
    setPayload: set.setPayload,
    setError: set.setError,
    setPromoteError,
    setEditing: set.setEditing,
    setDraft: set.setDraft,
  }
}

/** agent 记忆 tab 的状态钩子：状态 + 设置器拼成面板 props。 */
function useAgentMemoryState(): AgentMemoryState {
  const [payload, setPayload] = useState<AgentMemoryPayload>(emptyAgentMemoryPayload)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [promoteError, setPromoteError] = useState('')
  const [editing, setEditing] = useState('')
  const [draft, setDraft] = useState('')
  const [pendingDelete, setPendingDelete] = useState('')
  const [pendingPromote, setPendingPromote] = useState('')
  const set: AgentSetters = {
    setPayload,
    setExpanded,
    setLoading,
    setError,
    setEditing,
    setDraft,
    setPendingDelete,
    setPendingPromote,
  }
  const settle = settleOf(set, setPromoteError)
  const reload = (): void => loadAgentMemory(set)
  // 空依赖 = 只在挂载时拉一次；agent 改了文件后下次打开面板即最新。
  useEffect(reload, [])
  return {
    groups: payload.groups,
    archived: payload.archived,
    suggestions: payload.suggestions,
    expanded,
    loading,
    error,
    promoteError,
    editing,
    draft,
    pendingDelete,
    pendingPromote,
    onEdit: (name: string) => beginAgentEdit(payload.groups, name, setEditing, setDraft),
    onDraft: setDraft,
    onCancel: () => {
      setEditing('')
      setDraft('')
    },
    onSave: () => saveAgentMemory(payload.groups, editing, draft, settle),
    onDeleteAsk: setPendingDelete,
    onDeleteConfirm: (name: string) => commitAgentDelete(name, editing, settle),
    onDeleteCancel: () => setPendingDelete(''),
    onRestore: (name: string) => {
      restoreAgentMemory(name)
        .then(setPayload)
        .catch(() => setError(true))
    },
    onToggleGroup: (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    onPromoteAsk: setPendingPromote,
    onPromoteConfirm: () => commitAgentPromote(pendingPromote, settle),
    onPromoteCancel: () => setPendingPromote(''),
  }
}
