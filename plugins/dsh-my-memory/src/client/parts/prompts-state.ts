// ── prompts-state / view-state: 分区状态工厂（issue #465）────────────────
// 从 view.ts 抽出（文件行数门禁 ≤400 的基线约束）：
//  - 全局提示词的模块级状态 + 发布/订阅 + `usePromptsBlockProps`（在根视图里调用）；
//  - 记忆分区的数据动作工厂 `createActions`（与状态机同源，随视图一起抽出）。
// 全部依赖拼接作用域里的 strings/api/fetch*（无 import/export）。

// ── 模块级提示词状态（发布/订阅）──────────────────────────────────────────
// 状态放在模块作用域而非组件 state：本仓库 client 端的测试驱动器每帧重建元素，
// 组件内自持 state 在跨帧断言下不稳定；模块级状态 + 订阅通知在真机与测试下语义
// 完全一致，且天然保证「提示词只有一份真相」（与记忆视图的 data 同样唯一）。
let promptState: {
  items: PromptItem[]
  busy: boolean
  editing: PromptEditing | null
  confirming: PromptConfirming | null
  draft: { title: string; text: string }
} = { items: [], busy: false, editing: null, confirming: null, draft: { title: '', text: '' } }

/** 订阅者（每个分区实例一个 setState）。 */
const promptListeners = new Set<(next: typeof promptState) => void>()
let promptLoaded = false

/** 更新状态并通知订阅者。 */
function setPromptState(patch: Partial<typeof promptState>): void {
  promptState = { ...promptState, ...patch }
  for (const listener of promptListeners) listener(promptState)
}

/** 写操作（click / 确认路径共用）：串行 busy，成功后用服务端回传的列表覆盖。 */
function runPromptWrite(payload: Parameters<typeof writePrompt>[0]): Promise<void> {
  if (promptState.busy) return Promise.resolve()
  setPromptState({ busy: true })
  return writePrompt(payload)
    .then((value) => {
      const patch: Partial<typeof promptState> = { items: value.items }
      if (payload.action === 'add') patch.draft = { title: '', text: '' }
      setPromptState({ ...patch, editing: null, confirming: null })
    })
    .catch(() => {})
    .then(() => setPromptState({ busy: false }))
}

/** 提示词分区 props 的构造入口（在根视图里作为一等 hook 调用）。
 *  状态住在根视图，不放在被渲染的子树里：本仓库 client 端是「每帧重建元素」模型，
 *  子树里自持状态的组件在测试驱动器下会拿到新的 hook 槽位（真机 React 靠位置复用
 *  实例，不受影响）——放在根视图既与记忆视图的状态机同构，也保证行为可断言。 */
function usePromptsBlockProps(): Parameters<typeof PromptsBlock>[0] {
  const [state, setState] = useState(promptState)
  useEffect(() => {
    const listener = (next: typeof promptState): void => setState(next)
    promptListeners.add(listener)
    if (!promptLoaded) {
      promptLoaded = true
      fetchPrompts()
        .then((items) => setPromptState({ items }))
        .catch(() => setPromptState({ items: [] }))
    }
    return () => {
      promptListeners.delete(listener)
    }
  }, [])
  return {
    items: state.items,
    busy: state.busy,
    editing: state.editing,
    confirming: state.confirming,
    draft: state.draft,
    onToggle: (id: string) => runPromptWrite({ action: 'toggle', id, enabled: !enabledOf(state.items, id) }),
    onMove: (id: string, direction: 'up' | 'down') => runPromptWrite({ action: 'reorder', id, direction }),
    onEdit: (item: PromptItem) => setPromptState({ editing: { id: item.id, title: item.title, text: item.text } }),
    onEditTitle: (value: string) =>
      setPromptState({ editing: state.editing === null ? null : { ...state.editing, title: value } }),
    onEditText: (value: string) =>
      setPromptState({ editing: state.editing === null ? null : { ...state.editing, text: value } }),
    onCancelEdit: () => setPromptState({ editing: null }),
    onSaveEdit: () =>
      setPromptState({
        confirming:
          state.editing === null
            ? null
            : { kind: 'update', id: state.editing.id, title: state.editing.title, text: state.editing.text },
      }),
    onDelete: (item: PromptItem) => setPromptState({ confirming: { kind: 'delete', id: item.id, title: item.title } }),
    onDraft: (patch: { title?: string; text?: string }) => setPromptState({ draft: { ...state.draft, ...patch } }),
    onAdd: () => setPromptState({ confirming: { kind: 'add', title: state.draft.title, text: state.draft.text } }),
    onConfirm: (confirm: PromptConfirming) => setPromptState({ confirming: confirm }),
    onCancelConfirm: () => setPromptState({ confirming: null }),
    onCommit: (confirm: PromptConfirming) => {
      void runPromptWrite(confirmPayload(confirm))
    },
  }
}

/** Data actions bound to the state setters; error: null | 'load' | 'save'. */
function createActions({
  setData,
  setLoading,
  setError,
  setSaved,
  setCandidates,
  setCandidateBusy,
}: {
  setData: React.Dispatch<React.SetStateAction<MemoryData | null>>
  setLoading: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<'load' | 'save' | null>>
  setSaved: React.Dispatch<React.SetStateAction<boolean>>
  setCandidates: React.Dispatch<React.SetStateAction<MemoryItem[]>>
  setCandidateBusy: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const applyValue = (value: MemoryData) => {
    setData(value)
    setLoading(false)
  }
  const refreshWith = (fetcher: (cwd: string) => Promise<MemoryData>, cwd: string) => {
    setLoading(true)
    setError(null)
    setSaved(false)
    fetcher(cwd)
      .then(applyValue)
      .catch(() => {
        setLoading(false)
        setError('load')
      })
  }
  const loadCandidates = () => {
    fetchCandidates()
      .then((items) => setCandidates(items))
      .catch(() => setCandidates([]))
  }
  const run = (cwd: string) => refreshWith(fetchMemoryOnce, cwd)
  const refreshCandidates = () => {
    setCandidateBusy(false)
    loadCandidates()
  }
  return { load: run, refresh: run, loadCandidates, refreshCandidates }
}
