// ── agent 记忆面板的状态（issue #502）────────────────────────────────
// 与 prompts-state 同构：把「加载 / 编辑 / 草稿 / 保存」从 view.ts 里析出，
// 守住 apply 与 view 的函数行数门禁。

/** 面板状态与动作（直接摊平给 AgentMemoryPanel 的 props）。 */
interface AgentMemoryState {
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
}

/** agent 记忆 tab 的状态钩子（挂载即拉一次；写后直接用回传结果刷新）。 */
function useAgentMemoryState(): AgentMemoryState {
  const [entries, setEntries] = useState<AgentMemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [editing, setEditing] = useState('')
  const [draft, setDraft] = useState('')

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

  const remove = (name: string): void => {
    writeAgentMemory({ action: 'delete', name })
      .then((next) => {
        setEntries(next)
        if (editing === name) {
          setEditing('')
          setDraft('')
        }
      })
      .catch(() => setError(true))
  }

  return {
    entries,
    loading,
    error,
    editing,
    draft,
    onEdit: (name: string) => {
      const target = entries.find((entry) => entry.name === name)
      setEditing(name)
      setDraft(target === undefined ? '' : target.content)
    },
    onDraft: setDraft,
    onCancel: () => {
      setEditing('')
      setDraft('')
    },
    onSave: save,
    onDelete: remove,
  }
}
