// ── agent 记忆面板的状态（issue #502）────────────────────────────────
// 与 prompts-state 同构：把「加载 / 编辑 / 草稿 / 保存 / 删除确认」从 view.ts 里
// 析出，守住 apply 与 view 的函数行数门禁。

/** 面板状态与动作（直接摊平给 AgentMemoryPanel 的 props）。 */
interface AgentMemoryState {
  entries: AgentMemoryEntry[]
  loading: boolean
  error: boolean
  editing: string
  draft: string
  /** 待确认删除的文件名（'' = 无）。 */
  pendingDelete: string
  onEdit: (name: string) => void
  onDraft: (value: string) => void
  onCancel: () => void
  onSave: () => void
  onDeleteAsk: (name: string) => void
  onDeleteConfirm: (name: string) => void
  onDeleteCancel: () => void
  onRestore: (name: string) => void
}

/** 恢复一条已归档记忆（服务端搬回原位 + 清归档标记），返回最新列表。 */
function restoreAgentMemory(name: string): Promise<AgentMemoryEntry[]> {
  return writeAgentMemory({ action: 'restore', name })
}

/** 进入编辑态：把该文件当前正文载入草稿（write 是整份覆盖，必须先拿到原文）。 */
function beginAgentEdit(
  entries: AgentMemoryEntry[],
  name: string,
  setEditing: (value: string) => void,
  setDraft: (value: string) => void,
): void {
  const target = entries.find((entry) => entry.name === name)
  setEditing(name)
  setDraft(target === undefined ? '' : target.content)
}

/** 确认层通过后真正落盘删除，并用服务端回传的最新列表刷新（失败只标错，不吞掉）。 */
function commitAgentDelete(
  name: string,
  editing: string,
  settle: {
    setPendingDelete: (value: string) => void
    setEntries: (value: AgentMemoryEntry[]) => void
    setError: (value: boolean) => void
    setEditing: (value: string) => void
    setDraft: (value: string) => void
  },
): void {
  settle.setPendingDelete('')
  writeAgentMemory({ action: 'delete', name })
    .then((next) => {
      settle.setEntries(next)
      if (editing === name) {
        settle.setEditing('')
        settle.setDraft('')
      }
    })
    .catch(() => settle.setError(true))
}

/** agent 记忆 tab 的状态钩子（挂载即拉一次；写后直接用回传结果刷新）。 */
function useAgentMemoryState(): AgentMemoryState {
  const [entries, setEntries] = useState<AgentMemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [editing, setEditing] = useState('')
  const [draft, setDraft] = useState('')
  const [pendingDelete, setPendingDelete] = useState('')

  const reload = (): void => {
    setLoading(true)
    setError(false)
    fetchAgentMemory()
      .then(setEntries)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  // 空依赖 = 只在挂载时拉一次；agent 改了文件后下次打开面板即最新。
  useEffect(reload, [])

  const save = (): void => {
    const target = entries.find((entry) => entry.name === editing)
    if (target === undefined) return
    writeAgentMemory({ action: 'write', name: editing, content: draft })
      .then((next) => {
        setEntries(next)
        setEditing('')
        setDraft('')
      })
      .catch(() => setError(true))
  }

  return {
    entries,
    loading,
    error,
    editing,
    draft,
    pendingDelete,
    onEdit: (name: string) => beginAgentEdit(entries, name, setEditing, setDraft),
    onDraft: setDraft,
    onCancel: () => {
      setEditing('')
      setDraft('')
    },
    onSave: save,
    onDeleteAsk: setPendingDelete,
    onDeleteConfirm: (name: string) =>
      commitAgentDelete(name, editing, { setPendingDelete, setEntries, setError, setEditing, setDraft }),
    onDeleteCancel: () => setPendingDelete(''),
    onRestore: (name: string) => {
      restoreAgentMemory(name)
        .then(setEntries)
        .catch(() => setError(true))
    },
  }
}
