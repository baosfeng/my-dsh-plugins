'use strict'
// ── view component ────────────────────────────────────────────────────
/** Shared empty bucket for sessions that have never loaded data (stable ref). */
const EMPTY_SESSION = { recent: [], counts: {}, loading: true }
/**
 * Polling loader for one session: fetches stats on mount and on a fixed
 * interval while visible, prefers the sidebar's authoritative session.cwd
 * for relative display, and writes results into the per-session bucket.
 */
function useSessionLoader(visible, sessionId, scope, dataStore, setCwd, setError) {
  useEffect(() => {
    if (!visible || sessionId === '') return
    let cancelled = false
    const load = () => {
      void fetchStats(sessionId)
        .then((value) => {
          if (cancelled || value === null) return
          setCwd((prev) => prev || value.cwd || '')
          const current = dataStore.getSnapshot()
          dataStore.set({
            bySession: {
              ...(current.bySession ?? {}),
              [sessionId]: {
                recent: value.recent ?? [],
                counts: value.counts ?? {},
                loading: false,
              },
            },
          })
          setError(false)
        })
        .catch(() => {
          if (!cancelled) setError(true)
        })
    }
    load()
    void fetchSessionCwd(sessionId).then((cwd) => {
      if (!cancelled && cwd !== '') setCwd(cwd)
    })
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [visible, sessionId, dataStore])
}
/** Error banner element, or null when the last load succeeded. */
function renderError(error) {
  if (!error) return null
  return createElement(
    'div',
    {
      style: {
        color: 'var(--dsw-alias-state-error-primary)',
        padding: '4px 6px',
        font: 'var(--dsw-font-xxs-12)',
      },
    },
    strings.loadError(),
  )
}
/** "最近访问" section: collapsible head with refresh/clear actions. */
function renderRecentSection(recent, recentOpen, onToggle, onRefresh, onClear, onOpen) {
  return createElement(
    'div',
    { className: 'dfa-section' },
    createElement(
      'div',
      { className: 'dfa-section-head' },
      createElement(
        'button',
        { className: 'dfa-section-head-toggle', onClick: onToggle },
        recentOpen ? icon.chevronDown(13) : icon.chevronRight(13),
        strings.recent(),
      ),
      createElement(
        'span',
        { className: 'dfa-section-head-actions' },
        createElement(
          'button',
          {
            className: 'dfa-iconbtn dfa-iconbtn-xs',
            onClick: onRefresh,
            title: strings.refresh(),
            'aria-label': strings.refresh(),
          },
          icon.refresh(14),
        ),
        createElement(
          'button',
          {
            className: 'dfa-iconbtn dfa-iconbtn-xs dfa-iconbtn-danger',
            onClick: onClear,
            title: strings.clear(),
            'aria-label': strings.clear(),
          },
          icon.trash(14),
        ),
      ),
    ),
    !recentOpen
      ? null
      : recent.length === 0
        ? createElement(
            'div',
            { className: 'dfa-empty' },
            strings.empty(),
            createElement('span', { className: 'dfa-empty-hint' }, strings.emptyHint()),
          )
        : createElement(
            'div',
            { className: 'dfa-list' },
            recent.map((entry) => recentEntry(entry, onOpen)),
          ),
  )
}
/** "文件统计" section: the directory tree, or an empty hint. */
function renderStatsSection(tree, collapsedDirs, onToggleDir, onOpen) {
  return createElement(
    'div',
    { className: 'dfa-section' },
    createElement('div', { className: 'dfa-section-head' }, strings.stats()),
    tree.children.length === 0
      ? createElement('div', { className: 'dfa-empty' }, strings.empty())
      : createElement(
          'div',
          { className: 'dfa-list' },
          tree.children.map((child) => renderTreeNode(child, 0, collapsedDirs, onToggleDir, onOpen)),
        ),
  )
}
/**
 * The file-activity tab. Each session renders only its own store bucket:
 * a fresh conversation shows an empty list immediately, with no residue
 * from the previous session. Clicking any file opens a FLOATING preview
 * that reuses the sidebar's NATIVE viewer via matchFileViewer.
 */
function FileActivityView({ ctx, store, scope, visible, dataStore }) {
  const data = useSyncExternalStore(dataStore.subscribe, dataStore.getSnapshot)
  const [cwd, setCwd] = useState(scope?.cwd || '')
  const [error, setError] = useState(false)
  const [recentOpen, setRecentOpen] = useState(true)
  const [collapsedDirs, setCollapsedDirs] = useState(() => new Set())
  const sessionId = scope?.sessionId ?? ''
  const sessionData = (data.bySession ?? {})[sessionId] ?? EMPTY_SESSION
  const tree = useMemo(() => buildTree(sessionData.counts ?? {}), [sessionData.counts])
  useEffect(() => {
    if (scope?.cwd) setCwd(scope.cwd)
  }, [scope?.cwd])
  useSessionLoader(visible, sessionId, scope, dataStore, setCwd, setError)
  // Switching conversations closes any floating preview left open by the
  // previous session (preview is shared UI state; session data never
  // crosses sessions anymore).
  useEffect(() => {
    dataStore.set({ preview: null })
  }, [sessionId, dataStore])
  // Switching tabs hides this view: close any floating preview so it never
  // lingers over the main UI (issue #76).
  useEffect(() => {
    closePreviewOnHidden(visible, dataStore)
  }, [visible, dataStore])
  const toggleDir = (path) => setCollapsedDirs((prev) => toggleInSet(prev, path))
  const openPreview = (path) => dataStore.set({ preview: { abs: path, name: basenameOf(path) } })
  const closePreview = () => dataStore.set({ preview: null })
  const onClear = () => clearSessionData(dataStore, sessionId)
  const onRefresh = () => refreshSessionData(dataStore, sessionId, setCwd, setError)
  const recent = sessionData.recent ?? []
  return createElement(
    'div',
    { className: 'dfa' },
    renderError(error),
    renderRecentSection(recent, recentOpen, () => setRecentOpen((v) => !v), onRefresh, onClear, openPreview),
    renderStatsSection(tree, collapsedDirs, toggleDir, openPreview),
    data.preview
      ? createElement(FloatingPreview, {
          ctx,
          store,
          scope,
          preview: data.preview,
          onClose: closePreview,
        })
      : null,
  )
}
