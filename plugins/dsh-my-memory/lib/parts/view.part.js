// ── view: Memory settings tab ─────────────────────────────────────────
/** Load both scopes: global always; project only when a cwd is given. */
function fetchAll(cwd) {
  const projectCwd = cwd.trim()
  const globalP = fetchMemory('global', '')
  const projectP =
    projectCwd === ''
      ? Promise.resolve({ scope: 'project', cwd: '', projectRoot: '', items: [] })
      : fetchMemory('project', projectCwd)
  return Promise.all([globalP, projectP]).then(([global, project]) => ({ global, project }))
}

function mergeScope(data, scope, value) {
  return scope === 'global' ? { ...data, global: value } : { ...data, project: value }
}

/** Data actions bound to the state setters; error: null | 'load' | 'save'. */
function createActions({ setData, setLoading, setError, setSaved, setCandidates, setCandidateBusy }) {
  const applyValue = (value) => {
    setData(value)
    setLoading(false)
  }
  const refreshWith = (fetcher, cwd) => {
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
  const run = (cwd) => refreshWith(fetchAll, cwd)
  const refreshCandidates = () => {
    setCandidateBusy(false)
    loadCandidates()
  }
  return { load: run, refresh: run, loadCandidates, refreshCandidates }
}

/** 候选确认 / 拒弃处理器（issue #78）：写入/丢弃都要用户显式动作（服务端强制 confirmed），成功后刷新候选与分区。 */
function createCandidateHandlers({ candidateBusy, setCandidateBusy, setSaved, setError, actions, pathInput }) {
  const busy = () => {
    if (candidateBusy) return true
    setCandidateBusy(true)
    return false
  }
  const settle = () => setCandidateBusy(false)
  const refreshScope = (value, pathInput) => {
    actions.loadCandidates()
    if (value?.scope === 'project' && value?.cwd !== '') actions.load(value.cwd)
    else actions.refresh(pathInput)
  }
  const onConfirmCandidate = (id) => {
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
  const onDismissCandidate = (id) => {
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

function MemoryView() {
  const [data, setData] = useState(null)
  const [pathInput, setPathInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [drafts, setDrafts] = useState({ global: '', project: '' })
  const [editing, setEditing] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [sortOrder, setSortOrder] = useState({ global: 'desc', project: 'desc' })
  const [entryLimit, setEntryLimit] = useState(DEFAULT_ENTRY_LIMIT)
  const [candidates, setCandidates] = useState([])
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
}) {
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
            onDraft: (scope, value) => setDrafts({ ...drafts, [scope]: value }),
            onEdit: (scope, id, desc) => setEditing({ scope, id, desc }),
            onEditDesc: (value) => setEditing({ ...editing, desc: value }),
            onCancelEdit: () => setEditing(null),
            onConfirm: (confirm) => setConfirming(confirm),
            onCancelConfirm: () => setConfirming(null),
            onToggle: (key) =>
              setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
              }),
            onSort: (scope) => setSortOrder((prev) => ({ ...prev, [scope]: prev[scope] === 'desc' ? 'asc' : 'desc' })),
            onCommit: commit,
            onConfirmCandidate,
            onDismissCandidate,
          }),
  )
}

/** Load-failure banner with a retry entry; write-failure banner without. */
function ErrorBanner({ kind, onRetry }) {
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
function createCommitHandler({ data, setData, setSaved, setError, setDrafts, setEditing, setConfirming }) {
  return (confirm) => {
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
}) {
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
}) {
  const isProject = scope === 'project'
  // 徽标：数量（标题已含 scope 标签）；项目加载后附带项目根路径信息。
  const badge =
    scope === 'global'
      ? strings.countOnly(data.items.length)
      : data.cwd !== ''
        ? strings.projectBadge(data.projectRoot, data.items.length)
        : strings.countOnly(data.items.length)
  const order = sortOrder[scope]
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
      value: drafts[scope],
      entryLimit,
      onChange: (value) => onDraft(scope, value),
      onAdd: () => onConfirm({ kind: 'add', scope, desc: drafts[scope] }),
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
