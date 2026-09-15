'use strict'
// ── view component ────────────────────────────────────────────────────
/** Shared empty bucket for sessions that have never loaded data (stable ref). */
const EMPTY_SESSION = { recent: [], counts: {}, loading: true }
/** tab.visible out of the host's SidebarRightTabInfo; undefined when the
 *  information (or its shape) is unavailable. */
function readSeatVisible(info) {
  if (info === null || typeof info !== 'object') return undefined
  const tab = info.tab
  if (tab === null || typeof tab !== 'object') return undefined
  const visible = tab.visible
  return typeof visible === 'boolean' ? visible : undefined
}
/**
 * Resolve whether this seat is on screen.
 *
 * The native seat hands the component **no** `visible` prop: the host dispatches
 * it as `renderSlot('sidebar.right.pane.tab', {}, { hookContext })`, so the owner
 * props share is empty and everything live arrives through the injected
 * `useTabInfo()` hook (SidebarRightTabInfo.tab.visible). Reading `props.visible`
 * alone is therefore always `undefined` — the pre-#266 (`if (!visible) return`)
 * guard was constant-true, so an opened panel never loaded and never polled
 * (it only showed data after a manual Refresh).
 *
 * Order: the host hook first, then the legacy prop, then visible by default.
 * Defaulting to visible is the deliberate failure direction (issue #266): if the
 * hook is unavailable or the host shape changes again, the panel must still
 * load — the cost is one polling panel, the alternative is a blank one.
 */
function useSeatVisible(useTabInfo, legacyVisible) {
  const info = typeof useTabInfo === 'function' ? useTabInfo() : undefined
  const seatVisible = readSeatVisible(info)
  if (seatVisible !== undefined) return seatVisible
  return legacyVisible !== false
}
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
function FileActivityView({
  ctx,
  store,
  scope,
  sessionId: seatSessionId,
  visible: legacyVisible,
  useTabInfo,
  dataStore,
}) {
  const data = useSyncExternalStore(dataStore.subscribe, dataStore.getSnapshot)
  const [, setCwd] = useState(scope?.cwd || '')
  const [error, setError] = useState(false)
  const [recentOpen, setRecentOpen] = useState(true)
  const [collapsedDirs, setCollapsedDirs] = useState(() => new Set())
  // Native seats pass sessionId directly; the legacy scope object still works.
  const sessionId = seatSessionId ?? scope?.sessionId ?? ''
  // issue #266 A: the native seat passes NO visible prop — visibility comes
  // from the injected useTabInfo() (see useSeatVisible).
  const visible = useSeatVisible(useTabInfo, legacyVisible)
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
  // The floating preview itself lives in the root-scoped 'shell.overlay' seat
  // (registered by registerPreviewOverlay), so this view only publishes the
  // target — together with the owning session, which authorizes the routes.
  const openPreview = (path) => dataStore.set({ preview: { abs: path, name: basenameOf(path), sessionId } })
  const onClear = () => clearSessionData(dataStore, sessionId)
  const onRefresh = () => refreshSessionData(dataStore, sessionId, setCwd, setError)
  const recent = sessionData.recent ?? []
  return createElement(
    'div',
    { className: 'dfa' },
    renderError(error),
    renderDegraded(),
    renderRecentSection(recent, recentOpen, () => setRecentOpen((v) => !v), onRefresh, onClear, openPreview),
    renderStatsSection(tree, collapsedDirs, toggleDir, openPreview),
  )
}
/**
 * Degradation notice: shown when this activation failed to register one of the
 * host extension points (registerTabType / documentPreviews / auto-open). The
 * panel is also marked with data-dfa-degraded so the e2e suite can assert the
 * failure instead of hunting a missing tab.
 * @returns the notice element, or null when nothing degraded.
 */
function renderDegraded() {
  try {
    const markers = typeof document === 'undefined' ? undefined : document.documentElement?.dataset
    if (markers === undefined || markers === null || markers.dfaDegraded === undefined) return null
  } catch {
    return null
  }
  return createElement(
    'div',
    { className: 'dfa-degraded', 'data-dfa-degraded': '1' },
    createElement('div', { className: 'dfa-degraded-title' }, strings.tabUnavailable()),
    createElement('div', { className: 'dfa-degraded-hint' }, strings.tabUnavailableHint()),
  )
}
