// ── view: Memory settings tab（三个 tab：全局记忆 / 项目记忆 / 全局提示词）──
// 跨 part 引用（strings/utils/api/view-rows/rows/prompts）由拼接作用域解析，
// 无需 require——浏览器 ModuleLoader 不支持 factory 内相对路径 require。

/** 记忆数据类型 */
interface MemoryData {
  global: Required<MemoryValue>
  project: Required<MemoryValue>
}

/** 当前 tab。 */
type TabId = 'global' | 'project' | 'prompts' | 'agent'

/** Load both scopes: global always; project only when a cwd is given. */
function fetchAll(cwd: string): Promise<MemoryData> {
  const projectCwd = cwd.trim()
  const globalP = fetchMemory('global', '')
  const projectP =
    projectCwd === ''
      ? Promise.resolve({ scope: 'project', cwd: '', projectRoot: '', items: [] })
      : fetchMemory('project', projectCwd)
  return Promise.all([globalP, projectP]).then(([global, project]) => ({ global, project }))
}

/** 同一 cwd 的在飞请求（模块级：跨渲染共享，面板重复挂载/重渲染不会重复请求记忆端点）。 */
const inflightMemory = new Map<string, Promise<MemoryData>>()

/** 取一次记忆；同 cwd 已有在飞请求则复用（幂等读）。 */
function fetchMemoryOnce(cwd: string): Promise<MemoryData> {
  const existing = inflightMemory.get(cwd)
  if (existing !== undefined) return existing
  const promise = fetchAll(cwd)
  inflightMemory.set(cwd, promise)
  const clear = (): void => {
    if (inflightMemory.get(cwd) === promise) inflightMemory.delete(cwd)
  }
  promise.then(clear).catch(clear)
  return promise
}

function mergeScope(data: MemoryData, scope: string, value: Required<MemoryValue>): MemoryData {
  return scope === 'global' ? { ...data, global: value } : { ...data, project: value }
}

/** 根视图 props（状态 + 动作；渲染逻辑抽到 renderMemoryRoot，守住函数行数门禁）。 */
interface MemoryRootProps {
  tab: TabId
  agent: AgentMemoryState
  data: MemoryData | null
  loading: boolean
  error: 'load' | 'save' | null
  saved: boolean
  drafts: { global: string; project: string }
  editing: EditingState | null
  confirming: ConfirmingState | null
  expanded: Set<string>
  sortOrder: { global: 'desc' | 'asc'; project: 'desc' | 'asc' }
  entryLimit: number
  promptsProps: Parameters<typeof PromptsBlock>[0]
  commit: (confirm: ConfirmingState) => void
  reload: () => void
  setTab: (next: TabId) => void
  setDrafts: React.Dispatch<React.SetStateAction<{ global: string; project: string }>>
  setEditing: React.Dispatch<React.SetStateAction<EditingState | null>>
  setConfirming: React.Dispatch<React.SetStateAction<ConfirmingState | null>>
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>
  setSortOrder: React.Dispatch<React.SetStateAction<{ global: 'desc' | 'asc'; project: 'desc' | 'asc' }>>
}

function MemoryView(): ReactNode {
  const [tab, setTab] = useState<TabId>('global')
  const [data, setData] = useState<MemoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'load' | 'save' | null>(null)
  const [saved, setSaved] = useState(false)
  const [drafts, setDrafts] = useState({ global: '', project: '' })
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [confirming, setConfirming] = useState<ConfirmingState | null>(null)
  const [expanded, setExpanded] = useState(() => new Set<string>())
  const [sortOrder, setSortOrder] = useState<{ global: 'desc' | 'asc'; project: 'desc' | 'asc' }>({
    global: 'desc',
    project: 'desc',
  })
  const [entryLimit, setEntryLimit] = useState(DEFAULT_ENTRY_LIMIT)
  const actions = createActions({ setData, setLoading, setError, setSaved })
  // 提示词数据（独立端点）：计数用于 tab 徽标，列表在提示词 tab 内渲染。
  const promptsProps = usePromptsBlockProps()
  // agent 记忆（issue #502）：独立端点，独立写入语义（无需 confirmed）。
  const agent = useAgentMemoryState()

  // 空依赖数组 = 只在挂载时拉一次配置 / 会话 cwd / 记忆。会话 cwd 决定项目
  // 记忆是否自动加载（issue #104）；面板不再有路径输入。
  useEffect(() => {
    fetchConfig()
      .then((value) => setEntryLimit(value.maxEntryLength))
      .catch(() => {})
    fetchSessionCwd(currentSessionId()).then((cwd) => actions.load(cwd))
  }, [])

  const commit = createCommitHandler({ data, setData, setSaved, setError, setDrafts, setEditing, setConfirming })
  return renderMemoryRoot({
    tab,
    agent,
    data,
    loading,
    error,
    saved,
    drafts,
    editing,
    confirming,
    expanded,
    sortOrder,
    entryLimit,
    promptsProps,
    commit,
    reload: () => actions.load(''),
    setTab: (next: TabId) => {
      setTab(next)
      setEditing(null)
      setConfirming(null)
    },
    setDrafts,
    setEditing,
    setConfirming,
    setExpanded,
    setSortOrder,
  })
}

/** 渲染根视图：tab 栏 + 当前 tab 内容 + 状态行 + 居中确认弹层。 */
function renderMemoryRoot(props: MemoryRootProps): ReactNode {
  const counts = {
    global: props.data === null ? 0 : props.data.global.items.length,
    project: props.data === null ? 0 : props.data.project.items.length,
    agent: activeEntriesOf(props.agent.groups).length,
    prompts: props.promptsProps.items.length,
  }
  return createElement(
    'div',
    { className: 'dsh-my-memory-root' },
    createElement(TabBar, { tab: props.tab, counts, onTab: props.setTab }),
    createElement(
      'div',
      { className: 'dsh-my-memory-body' },
      props.error === null ? null : createElement(ErrorBanner, { kind: props.error, onRetry: props.reload }),
      renderTabContent(props),
      props.saved
        ? createElement(
            'div',
            { className: 'dsh-my-memory-status dsh-my-memory-saved' },
            icon.check(14),
            strings.saved(),
          )
        : null,
    ),
    props.confirming === null
      ? null
      : createElement(ConfirmPanel, {
          confirm: props.confirming,
          entryLimit: props.entryLimit,
          onCancel: () => props.setConfirming(null),
          onOk: () => props.commit(props.confirming as ConfirmingState),
        }),
  )
}

/** 当前 tab 的内容：加载态 / 记忆分区 / 提示词 tab。 */
function renderTabContent(props: MemoryRootProps): ReactNode {
  if (props.loading) {
    return createElement(
      'div',
      { className: 'dsh-my-memory-status dsh-my-memory-loading' },
      createElement('span', { className: 'dsh-my-memory-spinner' }),
      strings.loading(),
    )
  }
  if (props.tab === 'agent') return createElement(AgentMemoryPanel, { ...props.agent })
  if (props.data === null) return null
  if (props.tab === 'prompts') return createElement(PromptsTab, props.promptsProps)
  const scope: 'global' | 'project' = props.tab === 'project' ? 'project' : 'global'
  return createElement(ScopePanel, {
    scope,
    data: scope === 'global' ? props.data.global : props.data.project,
    draft: props.drafts[scope],
    order: props.sortOrder[scope],
    editing: props.editing,
    expanded: props.expanded,
    entryLimit: props.entryLimit,
    onDraft: (value: string) => props.setDrafts({ ...props.drafts, [scope]: value }),
    onEdit: (scopeName: string, id: string, desc: string) => props.setEditing({ scope: scopeName, id, desc }),
    onEditDesc: (value: string) => props.setEditing(props.editing === null ? null : { ...props.editing, desc: value }),
    onCancelEdit: () => props.setEditing(null),
    onConfirm: (confirm: ConfirmingState) => props.setConfirming(confirm),
    onToggle: (key: string) =>
      props.setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }),
    onSort: (scopeName: string) =>
      props.setSortOrder((prev) => ({
        ...prev,
        [scopeName]: prev[scopeName as keyof typeof prev] === 'desc' ? 'asc' : 'desc',
      })),
  })
}

/** 三个 tab 的分段控件（计数徽标直接标在 tab 上）。 */
function TabBar({
  tab,
  counts,
  onTab,
}: {
  tab: TabId
  counts: { global: number; project: number; prompts: number; agent: number }
  onTab: (next: TabId) => void
}): ReactNode {
  const tabs: Array<{ id: TabId; label: string; count: number }> = [
    { id: 'global', label: strings.globalSection(), count: counts.global },
    { id: 'project', label: strings.projectSection(), count: counts.project },
    { id: 'prompts', label: strings.promptsSection(), count: counts.prompts },
    { id: 'agent', label: strings.agentMemorySection(), count: counts.agent },
  ]
  return createElement(
    'div',
    { className: 'dsh-my-memory-tabs', role: 'tablist', 'aria-label': strings.title() },
    tabs.map((item) =>
      createElement(
        'button',
        {
          key: item.id,
          role: 'tab',
          className: `dsh-my-memory-tab${tab === item.id ? ' is-active' : ''}`,
          'aria-selected': tab === item.id,
          'aria-label': item.label,
          onClick: () => onTab(item.id),
        },
        item.label,
        createElement('span', { className: 'dsh-my-memory-tab-count' }, item.count),
      ),
    ),
  )
}

/** 记忆分区 props（类型抽到函数外，避免内联签名撑大函数行数）。 */
interface ScopePanelProps {
  scope: string
  data: Required<MemoryValue>
  draft: string
  order: 'desc' | 'asc'
  editing: EditingState | null
  expanded: Set<string>
  entryLimit: number
  onDraft: (value: string) => void
  onEdit: (scope: string, id: string, desc: string) => void
  onEditDesc: (value: string) => void
  onCancelEdit: () => void
  onConfirm: (confirm: ConfirmingState) => void
  onToggle: (key: string) => void
  onSort: (scope: string) => void
}

/** 一个记忆分区（全局或项目）：说明行 + 排序 + 列表 + 新增输入区。 */
function ScopePanel(props: ScopePanelProps): ReactNode {
  const { scope, data, draft, order, entryLimit } = props
  const isProject = scope === 'project'
  const items = sortMemories(data.items, order)
  const rows = buildRows(
    items,
    scope,
    props.editing,
    props.onEdit,
    props.onEditDesc,
    props.onCancelEdit,
    props.onConfirm,
    props.expanded,
    props.onToggle,
    entryLimit,
  )
  const emptyHint = isProject && data.cwd === '' ? strings.projectEmptyHint() : undefined
  return createElement(
    'section',
    { className: `dsh-my-memory-section${isProject ? ' dsh-my-memory-section-project' : ''}` },
    createElement(
      'div',
      { className: 'dsh-my-memory-note-row' },
      createElement('p', { className: 'dsh-my-memory-note' }, isProject ? strings.projectNote() : strings.globalNote()),
      createElement(SortToggle, { scope, order, onSort: props.onSort }),
    ),
    rows.length === 0
      ? createElement(EmptyState, { hint: emptyHint })
      : createElement('div', { className: 'dsh-my-memory-list' }, rows),
    createElement(AddBar, {
      scope,
      value: draft,
      entryLimit,
      onChange: props.onDraft,
      onAdd: () => props.onConfirm({ kind: 'add', scope, desc: draft, category: 'fact' }),
    }),
  )
}

/** 提示词 tab：独立数据源，与记忆状态机零耦合。 */
function PromptsTab(props: Parameters<typeof PromptsBlock>[0]): ReactNode {
  return createElement(PromptsBlock, props)
}

/** Load-failure banner with a retry entry; write-failure banner without. */
function ErrorBanner({ kind, onRetry }: { kind: 'load' | 'save'; onRetry: () => void }): ReactNode {
  if (kind === 'load') {
    return createElement(
      'div',
      { className: 'dsh-my-memory-error' },
      strings.loadError(),
      createElement(
        ui.Button,
        {
          variant: 'outline',
          size: 'sm',
          onClick: onRetry,
          icon: createElement(ui.IconRefreshOutline14),
        },
        strings.retry(),
      ),
    )
  }
  return kind === 'save' ? createElement('div', { className: 'dsh-my-memory-error' }, strings.saveFailed()) : null
}

/** One confirmed write (add / update / delete) → POST + refresh the scope. */
function createCommitHandler({
  data,
  setData,
  setSaved,
  setError,
  setDrafts,
  setEditing,
  setConfirming,
}: {
  data: MemoryData | null
  setData: React.Dispatch<React.SetStateAction<MemoryData | null>>
  setSaved: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<'load' | 'save' | null>>
  setDrafts: React.Dispatch<React.SetStateAction<{ global: string; project: string }>>
  setEditing: React.Dispatch<React.SetStateAction<EditingState | null>>
  setConfirming: React.Dispatch<React.SetStateAction<ConfirmingState | null>>
}) {
  return (confirm: ConfirmingState) => {
    setSaved(false)
    setError(null)
    writeMemory({
      action: confirm.kind,
      scope: confirm.scope,
      cwd: confirm.scope === 'project' && data !== null ? data.project.cwd : '',
      id: confirm.id,
      desc: confirm.desc,
    })
      .then((value) => {
        setSaved(true)
        setDrafts((d) => ({ ...d, [confirm.scope]: '' }))
        setEditing(null)
        setConfirming(null)
        setData((d) => mergeScope(d, confirm.scope, value))
      })
      .catch(() => setError('save'))
  }
}

// 导出给 apply.ts 使用
