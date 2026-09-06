// ── view ───────────────────────────────────────────────────────────────
/** State + data loading + user actions for the panel. Polls /guardian/api
 *  while the tab is visible; actions re-fetch on success, flag the load
 *  error banner on failure. */
function useGuardianState(visible) {
  const [state, setState] = useState({
    safeMode: false,
    staged: [],
    promoted: [],
    events: [],
    loaded: false,
  })
  const [loadFailed, setLoadFailed] = useState(false)

  const load = () => {
    api('state')
      .then((value) => {
        setState({ ...value, loaded: true })
        setLoadFailed(false)
      })
      .catch(() => setLoadFailed(true))
  }

  useEffect(() => {
    load()
    if (visible === false) return
    const timer = window.setInterval(load, POLL_MS)
    return () => window.clearInterval(timer)
  }, [visible])

  const onAction = (kind, entry) => {
    const request = { id: entry.id }
    const path = kind === 'retry' ? 'retry' : 'remove'
    return api(path, request)
      .then(() => load())
      .catch(() => setLoadFailed(true))
  }

  const onSafeMode = (enabled) => {
    api('safemode', { enabled })
      .then(() => load())
      .catch(() => setLoadFailed(true))
  }

  return { state, loadFailed, reload: load, onAction, onSafeMode }
}

/** Visual switch (role=switch): track + sliding thumb, checked = enabled.
 *  Semantics match the previous checkbox exactly: clicking reports the NEW
 *  checked state via onToggle. */
function Switch({ checked, disabled, label, onToggle }) {
  return createElement(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': label,
      className: `dsh-my-guardian-switch${checked ? ' dsh-my-guardian-switch-on' : ''}`,
      disabled,
      onClick: onToggle,
    },
    createElement(
      'span',
      { className: 'dsh-my-guardian-switch-track' },
      createElement('span', { className: 'dsh-my-guardian-switch-thumb' }),
    ),
  )
}

/** Safe-mode switch bar: icon + title + switch + hint, wired to the host API. */
function SafeModeBar({ safeMode, onSafeMode }) {
  return createElement(
    'div',
    { className: `dsh-my-guardian-safemode${safeMode ? ' dsh-my-guardian-safemode-on' : ''}` },
    createElement(
      'div',
      { className: 'dsh-my-guardian-safemode-head' },
      createElement('span', { className: 'dsh-my-guardian-safemode-icon' }, icon.settings(16)),
      createElement('span', { className: 'dsh-my-guardian-safemode-title' }, strings.safeMode()),
      createElement(Switch, {
        checked: safeMode === true,
        label: strings.safeMode(),
        onToggle: () => onSafeMode(!safeMode),
      }),
    ),
    createElement('div', { className: 'dsh-my-guardian-hint' }, strings.safeModeDesc()),
  )
}

/** Staged + promoted entries as rows; empty state when there are none. */
function EntryList({ rows, onAction }) {
  if (rows.length === 0) {
    return createElement(
      'div',
      { className: 'dsh-my-guardian-empty' },
      createElement('span', { className: 'dsh-my-guardian-empty-icon' }, icon.folder(20)),
      strings.empty(),
      createElement('span', { className: 'dsh-my-guardian-empty-hint' }, strings.emptyHint()),
    )
  }
  return createElement(
    'div',
    { className: 'dsh-my-guardian-section' },
    createElement(
      'div',
      { className: 'dsh-my-guardian-section-head' },
      createElement('span', { className: 'dsh-my-guardian-section-title' }, strings.entries()),
      createElement('span', { className: 'dsh-my-guardian-section-count' }, String(rows.length)),
    ),
    createElement(
      'div',
      { className: 'dsh-my-guardian-list' },
      rows.map(({ entry, source }) =>
        createElement(EntryRow, {
          key: `${source}:${entry.id}`,
          entry,
          source,
          onAction,
        }),
      ),
    ),
  )
}

/** 高频噪音事件：每次启动/热重载都会大量产生，挤掉真正重要的诊断信息。 */
const EVENT_NOISE = new Set(['entry-init', 'entry-dispose'])

/** Recent guardian event log: badge + key info + time per entry.
 *  过滤 entry-init/entry-dispose 噪音，优先展示隔离/冻结/更新失败等关键事件。 */
function EventList({ events }) {
  const important = events.filter((event) => !EVENT_NOISE.has(event.type))
  if (important.length === 0) return null
  return createElement(
    'div',
    { className: 'dsh-my-guardian-events' },
    createElement('div', { className: 'dsh-my-guardian-events-title' }, icon.clock(14), strings.events()),
    important.map((event, index) =>
      createElement(
        'div',
        {
          className: 'dsh-my-guardian-event',
          key: index,
          title: event.message,
        },
        createElement(
          'span',
          { className: `dsh-my-guardian-event-badge dsh-my-guardian-event-${eventVariant(event.type)}` },
          eventLabel(event.type),
        ),
        createElement('span', { className: 'dsh-my-guardian-event-message' }, event.message),
        createElement('span', { className: 'dsh-my-guardian-event-time' }, formatTime(event.time)),
      ),
    ),
  )
}

/** 启动区问题（issue #144）：启动名册静态预检发现的问题条目，置顶展示
 *  修复命令与移除提示——名册中的坏条目是 all-or-nothing 启动失败的源头。 */
function StartupIssuesBlock({ issues, checkedAt }) {
  if (!Array.isArray(issues) || issues.length === 0) return null
  return createElement(
    'div',
    { className: 'dsh-my-guardian-startup-issues' },
    createElement(
      'div',
      { className: 'dsh-my-guardian-startup-issues-title' },
      icon.alert(14),
      strings.startupIssues(),
      createElement('span', { className: 'dsh-my-guardian-startup-issues-count' }, String(issues.length)),
      typeof checkedAt === 'number' && Number.isFinite(checkedAt)
        ? createElement('span', { className: 'dsh-my-guardian-startup-issues-time' }, formatTime(checkedAt))
        : null,
    ),
    issues.map((issue, index) =>
      createElement(
        'div',
        { className: 'dsh-my-guardian-startup-issue', key: index },
        createElement(
          'div',
          { className: 'dsh-my-guardian-startup-issue-head' },
          createElement(
            'span',
            {
              className: `dsh-my-guardian-event-badge dsh-my-guardian-startup-issue-badge-${issue.type}`,
              title: issue.entryId,
            },
            startupIssueLabel(issue.type),
          ),
          createElement('span', { className: 'dsh-my-guardian-startup-issue-name' }, issue.name),
        ),
        createElement('div', { className: 'dsh-my-guardian-startup-issue-message' }, issue.message),
        typeof issue.fix === 'string' && issue.fix !== ''
          ? createElement(
              'div',
              { className: 'dsh-my-guardian-startup-issue-line' },
              createElement('span', { className: 'dsh-my-guardian-startup-issue-label' }, strings.startupIssueFix()),
              createElement('code', null, issue.fix),
            )
          : null,
        typeof issue.remove === 'string' && issue.remove !== ''
          ? createElement(
              'div',
              { className: 'dsh-my-guardian-startup-issue-line' },
              createElement('span', { className: 'dsh-my-guardian-startup-issue-label' }, strings.startupIssueRemove()),
              createElement('span', { className: 'dsh-my-guardian-startup-issue-remove' }, issue.remove),
            )
          : null,
      ),
    ),
  )
}

function GuardianView({ visible }) {
  const { state, loadFailed, reload, onAction, onSafeMode } = useGuardianState(visible)

  if (!state.loaded && !loadFailed) {
    return createElement(
      'div',
      { className: 'dsh-my-guardian-loading' },
      createElement('span', { className: 'dsh-my-guardian-loading-icon' }, icon.refresh(14)),
      strings.loading(),
    )
  }

  const rows = [
    ...state.staged.map((entry) => ({ entry, source: 'staged' })),
    ...state.promoted.map((entry) => ({ entry, source: 'promoted' })),
  ]

  return createElement(
    'div',
    { className: 'dsh-my-guardian-root' },
    createElement(SafeModeBar, { safeMode: state.safeMode, onSafeMode }),
    createElement(StartupIssuesBlock, {
      issues: state.startupIssues,
      checkedAt: state.startupCheckedAt,
    }),
    loadFailed
      ? createElement(
          'div',
          { className: 'dsh-my-guardian-error' },
          createElement('span', { className: 'dsh-my-guardian-error-text' }, strings.loadError()),
          createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-my-guardian-iconbtn dsh-my-guardian-iconbtn-xs',
              'aria-label': strings.retry(),
              title: strings.retry(),
              onClick: reload,
            },
            icon.refresh(14),
          ),
        )
      : null,
    createElement(EntryList, { rows, onAction }),
    createElement(EventList, { events: state.events }),
  )
}
