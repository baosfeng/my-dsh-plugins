// ── view: Skill Manager settings tab ───────────────────────────────────
// issue #69 重设计（Minimal Single Column）：标题区（标题+唯一刷新按钮）/
// 视图区（分段控件：全局|当前项目，自动感知会话 cwd）/ 列表区（名称+状态
// chip 为主、描述次之）/ 诊断区（仅异常时出现、可折叠）。无路径输入。
function isProjectSource(source) {
  return typeof source === 'string' && source.startsWith('project-')
}

/** Toggle one name in a disabled list (remove when disabling, add when enabling). */
function flipDisabled(list, name, isDisabled) {
  return isDisabled ? list.filter((n) => n !== name) : [...new Set([...list, name])]
}

/** Data actions bound to the state setters (created once per component). */
function createActions({ setData, setLoading, setError, setSaved }) {
  const applyValue = (value) => {
    setData(value)
    setLoading(false)
  }
  const refreshWith = (fetcher, cwd) => {
    setLoading(true)
    setError(false)
    setSaved(false)
    fetcher(cwd)
      .then(applyValue)
      .catch(() => {
        setLoading(false)
        setError(true)
      })
  }
  const load = (cwd) => refreshWith(fetchList, cwd)
  const rescan = (cwd) => refreshWith(rescanCatalog, cwd)
  const save = (scope, disabled, cwd) => {
    setSaved(false)
    setError(false)
    saveConfig(scope, disabled, cwd)
      .then(() => {
        setSaved(true)
        load(scope === 'project' ? cwd || '' : '')
      })
      .catch(() => setError(true))
  }
  return {
    load,
    rescan,
    toggle: (data, scope, name, isDisabled, cwd) => {
      if (scope === 'project' && cwd === '') return
      const list = scope === 'global' ? data.globalDisabled : data.projectDisabled
      save(scope, flipDisabled(list, name, isDisabled), scope === 'project' ? cwd : '')
    },
  }
}

/** Skill Manager settings tab: header + view switch + skill list + diagnostics. */
function SkillManagerView() {
  const [data, setData] = useState(null)
  const [view, setView] = useState('global')
  const [sessionCwd, setSessionCwd] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [sortBy, setSortBy] = useState('name')
  const [unusedOnly, setUnusedOnly] = useState(false)
  const actions = createActions({ setData, setLoading, setError, setSaved })

  useEffect(() => {
    fetchSessionCwd(currentSessionId()).then((cwd) => {
      setSessionCwd(cwd)
      actions.load('')
    })
  }, [])

  const projectRoot = data === null ? '' : data.projectRoot
  const cwdOf = (scope) => (scope === 'project' ? sessionCwd : '')
  const switchView = (scope) => {
    if (scope === view) return
    setView(scope)
    actions.load(cwdOf(scope))
  }

  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-root' },
    createElement(Header, {
      loading,
      error,
      saved,
      onRefresh: () => actions.rescan(cwdOf(view)),
    }),
    createElement(ViewSwitch, { view, hasProject: sessionCwd !== '', onSwitch: switchView }),
    loading
      ? createElement('div', { className: 'dsh-my-skill-manager-status' }, strings.loading())
      : error
        ? createElement('div', { className: 'dsh-my-skill-manager-error' }, strings.loadError())
        : data === null
          ? null
          : createElement(Sections, {
              data,
              view,
              saved,
              sortBy,
              unusedOnly,
              onSort: setSortBy,
              onToggleUnused: () => setUnusedOnly(!unusedOnly),
              onToggle: (scope, name, isDisabled) => actions.toggle(data, scope, name, isDisabled, cwdOf(scope)),
            }),
  )
}

/** Title row with the single refresh action (official Button, spins while
 *  loading — issue #143 试点）。 */
function Header({ loading, error, saved, onRefresh }) {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-header' },
    createElement('span', { className: 'dsh-my-skill-manager-header-title' }, strings.title()),
    loading ? createElement('div', { className: 'dsh-my-skill-manager-header-hint' }, strings.loading()) : null,
    saved
      ? createElement(
          'div',
          { className: 'dsh-my-skill-manager-header-hint dsh-my-skill-manager-saved' },
          strings.saved(),
        )
      : null,
    createElement(ui.Button, {
      variant: 'ghost',
      size: 'sm',
      'aria-label': strings.refresh(),
      title: strings.refresh(),
      disabled: loading,
      onClick: onRefresh,
      icon: createElement(ui.IconRefreshOutline14, {
        className: loading ? 'dsh-my-skill-manager-spin' : undefined,
      }),
    }),
  )
}

/** Segmented control: 全局 / 当前项目 (project tab only when cwd detected).
 *  官方 Pill 承载（issue #143 试点）：active = 当前视图。 */
function ViewSwitch({ view, hasProject, onSwitch }) {
  const seg = (scope, label) =>
    createElement(
      ui.Pill,
      {
        className: 'dsh-my-skill-manager-seg',
        active: view === scope,
        'aria-pressed': view === scope,
        onClick: () => onSwitch(scope),
      },
      label,
    )
  return createElement('div', { className: 'dsh-my-skill-manager-switchseg' }, [
    seg('global', strings.globalSection()),
    hasProject ? seg('project', strings.projectSection()) : null,
  ])
}

/** The toggle section for the current view + diagnostics (collapsible). */
function Sections({ data, view, onToggle, sortBy, unusedOnly, onSort, onToggleUnused }) {
  const projectMode = view === 'project'
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-sections' },
    createElement(SectionBlock, {
      title: projectMode ? projectTitleOf(data) : strings.globalSection(),
      hint: strings.disabledHint(),
      skills: data.skills,
      disabledNames: projectMode ? data.projectDisabled : data.globalDisabled,
      usage: data.usage,
      sortBy,
      unusedOnly,
      onSort,
      onToggleUnused,
      onToggle: (name, isDisabled) => onToggle(projectMode ? 'project' : 'global', name, isDisabled),
    }),
    createElement(DiagnosticsBlock, { diagnostics: data.diagnostics }),
  )
}

/** Collapsed warn bar when there are skipped entries; expandable row list. */
function DiagnosticsBlock({ diagnostics }) {
  const missing = diagnostics?.missing ?? []
  const [open, setOpen] = useState(false)
  if (missing.length === 0) return null
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-diag' },
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-skill-manager-diag-bar',
        'aria-expanded': open,
        onClick: () => setOpen(!open),
      },
      createElement('span', { className: 'dsh-my-skill-manager-diag-badge' }, strings.diagBadge()),
      createElement('span', { className: 'dsh-my-skill-manager-diag-title' }, strings.diagnosticsTitle()),
      createElement('span', { className: 'dsh-my-skill-manager-diag-count' }, `(${missing.length})`),
      createElement('span', { className: 'dsh-my-skill-manager-diag-chevron' }, open ? '▾' : '▸'),
    ),
    open
      ? createElement(
          'div',
          { className: 'dsh-my-skill-manager-diag-body' },
          missing.map((item) =>
            createElement(
              'div',
              { key: item.path, className: 'dsh-my-skill-manager-diag-row' },
              createElement('span', { className: 'dsh-my-skill-manager-diag-name' }, item.name),
              createElement('span', { className: 'dsh-my-skill-manager-diag-reason' }, strings.diagReason(item.reason)),
              createElement('span', { className: 'dsh-my-skill-manager-diag-path' }, item.path),
            ),
          ),
        )
      : null,
  )
}

function projectTitleOf(data) {
  return data.projectRoot === ''
    ? strings.projectSection()
    : `${strings.projectSection()} · ${strings.projectRoot()}${data.projectRoot}`
}

function SectionBlock({
  title,
  hint,
  skills,
  disabledNames,
  usage,
  sortBy,
  unusedOnly,
  onSort,
  onToggleUnused,
  onToggle,
}) {
  const usageOf = (name) => usage?.[name]
  const visible = unusedOnly ? skills.filter((skill) => (usageOf(skill.name)?.count ?? 0) === 0) : skills
  const rows = sortSkills(visible, sortBy, usageOf).map((skill) =>
    createElement(SkillRow, {
      key: skill.name,
      skill,
      usage: usageOf(skill.name),
      disabled: disabledNames.includes(skill.name),
      onToggle: () => onToggle(skill.name, disabledNames.includes(skill.name)),
    }),
  )
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-section' },
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-section-head' },
      createElement('span', { className: 'dsh-my-skill-manager-section-title' }, title),
      createElement(SortControls, { sortBy, unusedOnly, onSort, onToggleUnused }),
    ),
    rows.length === 0
      ? createElement(
          'div',
          { className: 'dsh-my-skill-manager-empty' },
          createElement('span', { className: 'dsh-my-skill-manager-empty-icon' }, icon.file(16)),
          strings.empty(),
          createElement('span', { className: 'dsh-my-skill-manager-empty-hint' }, strings.emptyHint()),
        )
      : rows,
    createElement('div', { className: 'dsh-my-skill-manager-hint' }, `${hint} ${strings.usageHint()}`),
  )
}

/** 排序 + 未使用过滤控件（issue #91）：名称 / 次数 / 最近 + 只看未使用。
 *  官方 Pill 承载（issue #143 试点）：active = 当前排序/过滤；「未使用」
 *  开启态经 className 覆写为 warn 语义色。 */
function SortControls({ sortBy, unusedOnly, onSort, onToggleUnused }) {
  const seg = (key, label) =>
    createElement(
      ui.Pill,
      {
        className: 'dsh-my-skill-manager-sortseg',
        active: sortBy === key,
        'aria-pressed': sortBy === key,
        onClick: () => onSort(key),
      },
      label,
    )
  return createElement('div', { className: 'dsh-my-skill-manager-sortbar' }, [
    createElement(
      ui.Pill,
      {
        className: `dsh-my-skill-manager-unused${unusedOnly ? ' dsh-my-skill-manager-unused-on' : ''}`,
        active: unusedOnly,
        'aria-pressed': unusedOnly,
        title: strings.unusedOnlyHint(),
        onClick: onToggleUnused,
      },
      strings.unusedOnly(),
    ),
    seg('name', strings.sortName()),
    seg('count', strings.sortCount()),
    seg('lastUsed', strings.sortLastUsed()),
  ])
}

/** 按 sortBy 排序：count/lastUsed 降序（未使用排最后），name 字母序；同值按名称。 */
function sortSkills(skills, sortBy, usageOf) {
  const list = [...skills]
  if (sortBy === 'count') {
    list.sort((a, b) => (usageOf(b.name)?.count ?? 0) - (usageOf(a.name)?.count ?? 0) || a.name.localeCompare(b.name))
  } else if (sortBy === 'lastUsed') {
    list.sort(
      (a, b) => (usageOf(b.name)?.lastUsedAt ?? 0) - (usageOf(a.name)?.lastUsedAt ?? 0) || a.name.localeCompare(b.name),
    )
  } else {
    list.sort((a, b) => a.name.localeCompare(b.name))
  }
  return list
}

/** 时间戳 → "MM-DD HH:mm"（无效时间返回空串）。 */
function formatTime(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Card row: name + meta on the main line, description below —
 *  issue #69 hierarchy + issue #91 usage columns. State is encoded ONLY by
 *  the switch (曾经的"状态 chip + 开关"双编码让状态表达重复且拥挤，已移除)。 */
function SkillRow({ skill, disabled, onToggle, usage }) {
  const usageMeta =
    usage === undefined
      ? strings.usageNever()
      : [
          strings.usageCount(usage.count),
          strings.usageLast(formatTime(usage.lastUsedAt)),
          usage.lastSource === 'model' ? strings.usageSourceModel() : strings.usageSourceUser(),
        ].join(' · ')
  const sourceText = isProjectSource(skill.source)
    ? strings.sourceProject(skill.source)
    : strings.sourceGlobal(skill.source)
  return createElement(
    'div',
    { className: `dsh-my-skill-manager-row${disabled ? ' dsh-my-skill-manager-row-disabled' : ''}` },
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-row-head' },
      createElement('span', { className: 'dsh-my-skill-manager-name', title: skill.name }, skill.name),
      skill.cataloged === false
        ? createElement(
            ui.Pill,
            {
              className: 'dsh-my-skill-manager-chip-warn',
              title: strings.notCatalogedHint(),
            },
            strings.notCataloged(),
          )
        : null,
      createElement(Switch, {
        checked: !disabled,
        label: `${skill.name}: ${disabled ? strings.disabled() : strings.enabled()}`,
        onToggle,
      }),
    ),
    createElement('div', { className: 'dsh-my-skill-manager-desc' }, skill.description),
    createElement('div', { className: 'dsh-my-skill-manager-row-source' }, sourceText),
    createElement('div', { className: 'dsh-my-skill-manager-row-meta' }, usageMeta),
  )
}

/** Visual switch (role=switch): track + sliding thumb, checked = enabled.
 *  Semantics match the previous enable/disable text button exactly: clicking
 *  reports the CURRENT disabled state, and the parent flips the list. */
function Switch({ checked, disabled, label, onToggle }) {
  return createElement(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': label,
      className: `dsh-my-skill-manager-switch${checked ? ' dsh-my-skill-manager-switch-on' : ''}`,
      disabled,
      onClick: onToggle,
    },
    createElement(
      'span',
      { className: 'dsh-my-skill-manager-switch-track' },
      createElement('span', { className: 'dsh-my-skill-manager-switch-thumb' }),
    ),
  )
}
