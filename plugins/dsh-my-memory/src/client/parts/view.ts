// ── view: Memory settings tab ─────────────────────────────────────────
// 跨 part 引用（strings/utils/api/view-rows/candidates）由拼接作用域解析，
// 无需 require——浏览器 ModuleLoader 不支持 factory 内相对路径 require。

/** 记忆数据类型 */
interface MemoryData {
  global: Required<MemoryValue>
  project: Required<MemoryValue>
}

/** 编辑状态 */
interface EditingState {
  scope: string
  id: string
  desc: string
}

/** 确认状态 */
interface ConfirmingState {
  kind: 'add' | 'update' | 'delete'
  scope: string
  id?: string
  desc?: string
}

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

function mergeScope(data: MemoryData, scope: string, value: Required<MemoryValue>): MemoryData {
  return scope === 'global' ? { ...data, global: value } : { ...data, project: value }
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
  const run = (cwd: string) => refreshWith(fetchAll, cwd)
  const refreshCandidates = () => {
    setCandidateBusy(false)
    loadCandidates()
  }
  return { load: run, refresh: run, loadCandidates, refreshCandidates }
}

/** 候选确认 / 拒弃处理器（issue #78）：写入/丢弃都要用户显式动作（服务端强制 confirmed），成功后刷新候选与分区。 */
function createCandidateHandlers({
  candidateBusy,
  setCandidateBusy,
  setSaved,
  setError,
  actions,
  pathInput,
}: {
  candidateBusy: boolean
  setCandidateBusy: React.Dispatch<React.SetStateAction<boolean>>
  setSaved: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<'load' | 'save' | null>>
  actions: ReturnType<typeof createActions>
  pathInput: string
}) {
  const busy = () => {
    if (candidateBusy) return true
    setCandidateBusy(true)
    return false
  }
  const settle = () => setCandidateBusy(false)
  const refreshScope = (value: MemoryValue, pathInput: string) => {
    actions.loadCandidates()
    if (value?.scope === 'project' && value?.cwd !== '') actions.load(value.cwd)
    else actions.refresh(pathInput)
  }
  const onConfirmCandidate = (id: string) => {
    if (busy()) return
    confirmCandidate(id)
      .then((value) => {
        settle()
        setSaved(true)
        refreshScope(value, pathInput)
      })
      .catch(() => {
        settle()
        setError('save')
      })
  }
  const onDismissCandidate = (id: string) => {
    if (busy()) return
    dismissCandidate(id)
      .then(() => {
        settle()
        actions.loadCandidates()
      })
      .catch(() => {
        settle()
        setError('save')
      })
  }
  return { onConfirmCandidate, onDismissCandidate }
}

function MemoryView(): ReactNode {
  const [data, setData] = useState<MemoryData | null>(null)
  const [pathInput, setPathInput] = useState('')
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
  const [candidates, setCandidates] = useState<MemoryItem[]>([])
  const [candidateBusy, setCandidateBusy] = useState(false)
  const actions = createActions({ setData, setLoading, setError, setSaved, setCandidates, setCandidateBusy })

  useEffect(() => {
    // 面板打开拉取引导配置（issue #105；失败回落默认值），再解析 cwd 加载记忆（issue #104）。
    fetchConfig()
      .then((value) => setEntryLimit(value.maxEntryLength))
      .catch(() => {})
    fetchSessionCwd(currentSessionId()).then((cwd) => actions.load(cwd))
    actions.loadCandidates()
  }, [])

  const commit = createCommitHandler({ data, setData, setSaved, setError, setDrafts, setEditing, setConfirming })
  const { onConfirmCandidate, onDismissCandidate } = createCandidateHandlers({
    candidateBusy,
    setCandidateBusy,
    setSaved,
    setError,
    actions,
    pathInput,
  })
  return renderRoot({
    data,
    loading,
    error,
    pathInput,
    saved,
    drafts,
    editing,
    confirming,
    expanded,
    sortOrder,
    entryLimit,
    candidates,
    candidateBusy,
    actions,
    setDrafts,
    setEditing,
    setExpanded,
    setSortOrder,
    setConfirming,
    setPathInput,
    commit,
    onConfirmCandidate,
    onDismissCandidate,
  })
}

/** 根视图渲染（保持 MemoryView 简洁；全部状态经 props 传入）。 */
function renderRoot({
  data,
  loading,
  error,
  pathInput,
  saved,
  drafts,
  editing,
  confirming,
  expanded,
  sortOrder,
  entryLimit,
  candidates,
  candidateBusy,
  actions,
  setDrafts,
  setEditing,
  setExpanded,
  setSortOrder,
  setConfirming,
  setPathInput,
  commit,
  onConfirmCandidate,
  onDismissCandidate,
}: {
  data: MemoryData | null
  loading: boolean
  error: 'load' | 'save' | null
  pathInput: string
  saved: boolean
  drafts: { global: string; project: string }
  editing: EditingState | null
  confirming: ConfirmingState | null
  expanded: Set<string>
  sortOrder: { global: 'desc' | 'asc'; project: 'desc' | 'asc' }
  entryLimit: number
  candidates: MemoryItem[]
  candidateBusy: boolean
  actions: ReturnType<typeof createActions>
  setDrafts: React.Dispatch<React.SetStateAction<{ global: string; project: string }>>
  setEditing: React.Dispatch<React.SetStateAction<EditingState | null>>
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>
  setSortOrder: React.Dispatch<React.SetStateAction<{ global: 'desc' | 'asc'; project: 'desc' | 'asc' }>>
  setConfirming: React.Dispatch<React.SetStateAction<ConfirmingState | null>>
  setPathInput: React.Dispatch<React.SetStateAction<string>>
  commit: (confirm: ConfirmingState) => void
  onConfirmCandidate: (id: string) => void
  onDismissCandidate: (id: string) => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-root' },
    createElement(Toolbar, { pathInput, onInput: setPathInput, onLoad: actions.load, onRefresh: actions.refresh }),
    error === null ? null : createElement(ErrorBanner, { kind: error, onRetry: () => actions.load(pathInput) }),
    loading
      ? createElement(
          'div',
          { className: 'dsh-my-memory-status dsh-my-memory-loading' },
          createElement('span', { className: 'dsh-my-memory-spinner' }),
          strings.loading(),
        )
      : data === null
        ? null
        : createElement(Sections, {
            data,
            saved,
            drafts,
            editing,
            confirming,
            expanded,
            sortOrder,
            entryLimit,
            candidates,
            candidateBusy,
            onDraft: (scope: string, value: string) => setDrafts({ ...drafts, [scope]: value }),
            onEdit: (scope: string, id: string, desc: string) => setEditing({ scope, id, desc }),
            onEditDesc: (value: string) => setEditing({ ...editing!, desc: value }),
            onCancelEdit: () => setEditing(null),
            onConfirm: (confirm: ConfirmingState) => setConfirming(confirm),
            onCancelConfirm: () => setConfirming(null),
            onToggle: (key: string) =>
              setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
              }),
            onSort: (scope: string) =>
              setSortOrder((prev) => ({
                ...prev,
                [scope]: prev[scope as keyof typeof prev] === 'desc' ? 'asc' : 'desc',
              })),
            onCommit: commit,
            onConfirmCandidate,
            onDismissCandidate,
          }),
  )
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
          className: 'dsh-my-memory-btn-retry',
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
      cwd: confirm.scope === 'project' ? data.project.cwd : '',
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

/** Two scopes side by side (global + project), plus pending candidates (issue #78). */
function Sections({
  data,
  saved,
  drafts,
  editing,
  confirming,
  expanded,
  sortOrder,
  entryLimit,
  candidates,
  candidateBusy,
  onDraft,
  onEdit,
  onEditDesc,
  onCancelEdit,
  onConfirm,
  onCancelConfirm,
  onToggle,
  onSort,
  onCommit,
  onConfirmCandidate,
  onDismissCandidate,
}: {
  data: MemoryData
  saved: boolean
  drafts: { global: string; project: string }
  editing: EditingState | null
  confirming: ConfirmingState | null
  expanded: Set<string>
  sortOrder: { global: 'desc' | 'asc'; project: 'desc' | 'asc' }
  entryLimit: number
  candidates: MemoryItem[]
  candidateBusy: boolean
  onDraft: (scope: string, value: string) => void
  onEdit: (scope: string, id: string, desc: string) => void
  onEditDesc: (value: string) => void
  onCancelEdit: () => void
  onConfirm: (confirm: ConfirmingState) => void
  onCancelConfirm: () => void
  onToggle: (key: string) => void
  onSort: (scope: string) => void
  onCommit: (confirm: ConfirmingState) => void
  onConfirmCandidate: (id: string) => void
  onDismissCandidate: (id: string) => void
}): ReactNode {
  const blockProps = {
    drafts,
    editing,
    confirming,
    expanded,
    sortOrder,
    entryLimit,
    onDraft,
    onEdit,
    onEditDesc,
    onCancelEdit,
    onConfirm,
    onCancelConfirm,
    onToggle,
    onSort,
    onCommit,
  }
  return createElement(
    'div',
    { className: 'dsh-my-memory-sections' },
    createElement(SectionBlock, {
      scope: 'global',
      title: strings.globalSection(),
      note: strings.globalNote(),
      data: data.global,
      ...blockProps,
    }),
    createElement(SectionBlock, {
      scope: 'project',
      title: strings.projectSection(),
      note: strings.projectNote(),
      data: data.project,
      ...blockProps,
    }),
    createElement(CandidatesBlock, {
      candidates,
      busy: candidateBusy,
      onConfirmCandidate,
      onDismissCandidate,
    }),
    saved
      ? createElement('div', { className: 'dsh-my-memory-status dsh-my-memory-saved' }, icon.check(14), strings.saved())
      : null,
  )
}

/** One scope's section: 区块标题 / 徽标 / 排序开关 / 列表 / 新增栏 / 确认面板。 */
function SectionBlock({
  scope,
  title,
  note,
  data,
  drafts,
  editing,
  confirming,
  expanded,
  sortOrder,
  entryLimit,
  onDraft,
  onEdit,
  onEditDesc,
  onCancelEdit,
  onConfirm,
  onCancelConfirm,
  onToggle,
  onSort,
  onCommit,
}: {
  scope: string
  title: string
  note: string
  data: Required<MemoryValue>
  drafts: { global: string; project: string }
  editing: EditingState | null
  confirming: ConfirmingState | null
  expanded: Set<string>
  sortOrder: { global: 'desc' | 'asc'; project: 'desc' | 'asc' }
  entryLimit: number
  onDraft: (scope: string, value: string) => void
  onEdit: (scope: string, id: string, desc: string) => void
  onEditDesc: (value: string) => void
  onCancelEdit: () => void
  onConfirm: (confirm: ConfirmingState) => void
  onCancelConfirm: () => void
  onToggle: (key: string) => void
  onSort: (scope: string) => void
  onCommit: (confirm: ConfirmingState) => void
}): ReactNode {
  const isProject = scope === 'project'
  // 徽标：数量（标题已含 scope 标签）；项目加载后附带项目根路径信息。
  const badge =
    scope === 'global'
      ? strings.countOnly(data.items.length)
      : data.cwd !== ''
        ? strings.projectBadge(data.projectRoot, data.items.length)
        : strings.countOnly(data.items.length)
  const order = sortOrder[scope as keyof typeof sortOrder]
  const items = sortMemories(data.items, order)
  const rows = buildRows(items, scope, editing, onEdit, onEditDesc, onCancelEdit, onConfirm, expanded, onToggle)
  // 空状态：无会话项目时提示输入项目根路径（issue #104），否则提示新增（issue #110 视觉统一）。
  const emptyHint = isProject && data.cwd === '' ? strings.projectEmptyHint() : undefined
  return createElement(
    'div',
    { className: `dsh-my-memory-section${isProject ? ' dsh-my-memory-section-project' : ''}` },
    createElement(
      'div',
      { className: 'dsh-my-memory-section-head' },
      createElement('span', { className: 'dsh-my-memory-section-title' }, title),
      createElement(ui.Pill, { className: 'dsh-my-memory-badge' }, badge),
      createElement(SortToggle, { scope, order, onSort }),
    ),
    createElement('div', { className: 'dsh-my-memory-note' }, note),
    rows.length === 0 ? createElement(EmptyState, { hint: emptyHint }) : rows,
    createElement(AddBar, {
      scope,
      value: drafts[scope as keyof typeof drafts],
      entryLimit,
      onChange: (value: string) => onDraft(scope, value),
      onAdd: () => onConfirm({ kind: 'add', scope, desc: drafts[scope as keyof typeof drafts] }),
    }),
    confirming !== null && confirming.scope === scope
      ? createElement(ConfirmPanel, {
          confirm: confirming,
          entryLimit,
          onCancel: onCancelConfirm,
          onOk: () => onCommit(confirming),
        })
      : null,
  )
}

// 导出给 apply.ts 使用
