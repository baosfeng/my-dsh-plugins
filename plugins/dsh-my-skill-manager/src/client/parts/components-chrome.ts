// ── components-chrome：命令条（搜索 / 筛选 / 重扫 / 概览 / 诊断）────────
// 564px 硬约束：搜索行与概览行都是 nowrap + min-width:0，来源/状态筛选收进
// 「筛选」弹出面板（不再常驻两行 chips），诊断入口在概览行末（异常 0 时只留
// 图标）。所有溢出一律靠 ellipsis 收缩，不靠横向滚动。

interface FilterPanelProps {
  counts: CountsValue
  source: string
  status: string
  unusedOnly: boolean
  onSource(source: string): void
  onStatus(status: string): void
  onToggleUnused(): void
  onReset(): void
  onClose(): void
}

interface ChipSpec {
  key: string
  label: string
  count: number
  dot: boolean
}

function stopEvent(event: unknown): void {
  if (event === null || typeof event !== 'object') return
  const stop = (event as { stopPropagation?: unknown }).stopPropagation
  if (typeof stop === 'function') (stop as () => void).call(event)
}

function sourceFilterChips(props: FilterPanelProps): ChipSpec[] {
  const chips: ChipSpec[] = [
    { key: 'all', label: strings.filterAll(), count: props.counts.all, dot: false },
    { key: 'project', label: strings.sourceProject(), count: props.counts.project, dot: true },
    { key: 'user', label: strings.sourceUser(), count: props.counts.user, dot: true },
    { key: 'bundled', label: strings.sourceBundled(), count: props.counts.bundled, dot: true },
  ]
  if (props.counts.other > 0) {
    chips.push({ key: 'other', label: strings.sourceOther(), count: props.counts.other, dot: true })
  }
  chips.push({ key: 'anomaly', label: strings.sourceAnomaly(), count: props.counts.anomaly, dot: true })
  return chips
}

function statusFilterChips(props: FilterPanelProps): ChipSpec[] {
  return [
    { key: 'all', label: strings.filterAllStatus(), count: -1, dot: false },
    { key: 'enabled', label: strings.statEnabled(), count: props.counts.enabled, dot: false },
    { key: 'disabled', label: strings.statDisabled(), count: props.counts.disabled, dot: false },
    { key: 'anomaly', label: strings.statAnomaly(), count: props.counts.anomaly, dot: false },
  ]
}

function filterChip(entry: ChipSpec, pressed: boolean, onClick: () => void): unknown {
  return createElement(
    'button',
    {
      key: entry.key,
      type: 'button',
      className: 'dsh-my-skill-manager-chip',
      'aria-pressed': pressed,
      onClick,
    },
    entry.dot
      ? createElement('i', {
          className: 'dsh-my-skill-manager-src-dot dsh-my-skill-manager-src-dot-' + entry.key,
          'aria-hidden': 'true',
        })
      : null,
    createElement('span', {}, entry.label),
    entry.count < 0 ? null : createElement('b', {}, String(entry.count)),
  )
}

/** 来源单选组。 */
function filterSourceGroup(props: FilterPanelProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-filter-group', role: 'group', 'aria-label': strings.filterSourceGroup() },
    createElement('span', { className: 'dsh-my-skill-manager-filter-group-label' }, strings.filtersSource()),
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-filter-chip-row' },
      sourceFilterChips(props).map((entry) =>
        filterChip(entry, props.source === entry.key, () => props.onSource(entry.key)),
      ),
    ),
  )
}

/** 状态单选组。 */
function filterStatusGroup(props: FilterPanelProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-filter-group', role: 'group', 'aria-label': strings.filterStatusGroup() },
    createElement('span', { className: 'dsh-my-skill-manager-filter-group-label' }, strings.filtersStatus()),
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-filter-chip-row' },
      statusFilterChips(props).map((entry) =>
        filterChip(entry, props.status === entry.key, () => props.onStatus(entry.key)),
      ),
    ),
  )
}

/** 只看未使用开关（role=switch + aria-checked）。 */
function filterUnusedRow(props: FilterPanelProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-filter-group' },
    createElement(
      'button',
      {
        type: 'button',
        role: 'switch',
        className: 'dsh-my-skill-manager-switch dsh-my-skill-manager-filter-switch',
        'aria-checked': props.unusedOnly,
        'aria-label': strings.unusedOnly(),
        onClick: () => props.onToggleUnused(),
      },
      createElement('span', { className: 'dsh-my-skill-manager-switch-label' }, strings.unusedOnly()),
      createElement(
        'span',
        { className: 'dsh-my-skill-manager-track', 'aria-hidden': 'true' },
        createElement('span', { className: 'dsh-my-skill-manager-knob' }),
      ),
    ),
  )
}

/** 面板底部：重置 + 关闭。 */
function filterActions(props: FilterPanelProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-filter-actions' },
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-skill-manager-btn', onClick: () => props.onReset() },
      strings.filterReset(),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-skill-manager-btn dsh-my-skill-manager-btn-primary',
        onClick: () => props.onClose(),
      },
      strings.filterClose(),
    ),
  )
}

/** 筛选面板：来源单选 + 状态单选 + 只看未使用开关 + 重置 / 关闭。
 *  点面板内部不冒泡到 document（外点关闭逻辑依赖）。 */
function FilterPanel(props: FilterPanelProps): unknown {
  return createElement(
    'div',
    {
      id: 'dsh-my-skill-manager-filter-panel',
      className: 'dsh-my-skill-manager-filter-panel',
      role: 'dialog',
      'aria-label': strings.filterTitle(),
      onClick: (event: unknown) => stopEvent(event),
    },
    createElement('div', { className: 'dsh-my-skill-manager-filter-panel-title' }, strings.filterTitle()),
    filterSourceGroup(props),
    filterStatusGroup(props),
    filterUnusedRow(props),
    filterActions(props),
  )
}

interface CommandBarProps {
  query: string
  pending: boolean
  counts: CountsValue
  activeStat: string
  scanning: boolean
  scanTime: string
  projectCtx: boolean
  filterOpen: boolean
  activeFilterCount: number
  source: string
  status: string
  unusedOnly: boolean
  searchRef: { current: unknown }
  onQueryChange(value: string): void
  onClearSearch(): void
  onSelectStat(stat: StatKey): void
  onRescan(): void
  onOpenDiagnostics(): void
  onToggleFilters(event: unknown): void
  onCloseFilters(): void
  onResetFilters(): void
  onSource(source: string): void
  onStatus(status: string): void
  onToggleUnused(): void
}

/** 搜索框（⌘K）+ 清空按钮。 */
function searchField(props: CommandBarProps): unknown {
  const clearButton =
    props.query === ''
      ? null
      : createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-skill-manager-search-clear',
            'aria-label': strings.searchClear(),
            onClick: () => props.onClearSearch(),
          },
          icon.close(12),
        )
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-search' },
    icon.search(15),
    createElement('input', {
      ref: props.searchRef,
      type: 'text',
      role: 'searchbox',
      className: 'dsh-my-skill-manager-search-input',
      placeholder: strings.searchPlaceholder(),
      'aria-label': strings.searchAria(),
      autoComplete: 'off',
      spellCheck: false,
      value: props.query,
      onChange: (event: { target: { value: string } }) => props.onQueryChange(event.target.value),
    }),
    createElement('kbd', { className: 'dsh-my-skill-manager-kbd' }, strings.shortcutHint()),
    clearButton,
  )
}

/** 筛选按钮（图标 + 文字 + 生效条件数）与其弹出面板。 */
function filterControl(props: CommandBarProps): unknown {
  const active = props.activeFilterCount > 0
  const filterButton = createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-skill-manager-filter-btn' + (active ? ' dsh-my-skill-manager-filter-btn-active' : ''),
      'aria-haspopup': 'dialog',
      'aria-expanded': props.filterOpen,
      'aria-controls': 'dsh-my-skill-manager-filter-panel',
      'aria-label': strings.filterButtonAria(props.activeFilterCount),
      title: strings.filterButtonAria(props.activeFilterCount),
      onClick: (event: unknown) => props.onToggleFilters(event),
    },
    glyph.filter(14),
    createElement('span', { className: 'dsh-my-skill-manager-filter-btn-label' }, strings.filterButton()),
    active
      ? createElement('b', { className: 'dsh-my-skill-manager-filter-btn-count' }, String(props.activeFilterCount))
      : null,
  )
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-filter-wrap' },
    filterButton,
    props.filterOpen
      ? createElement(FilterPanel, {
          counts: props.counts,
          source: props.source,
          status: props.status,
          unusedOnly: props.unusedOnly,
          onSource: props.onSource,
          onStatus: props.onStatus,
          onToggleUnused: props.onToggleUnused,
          onReset: props.onResetFilters,
          onClose: props.onCloseFilters,
        })
      : null,
  )
}

/** 重新扫描（图标按钮；loading 时旋转并禁用）。 */
function rescanButton(props: CommandBarProps): unknown {
  const label = props.scanning ? strings.rescanning() : strings.rescanAria()
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-skill-manager-scan' + (props.scanning ? ' dsh-my-skill-manager-scan-loading' : ''),
      'aria-label': label,
      title: label,
      disabled: props.scanning,
      onClick: () => props.onRescan(),
    },
    icon.refresh(15),
  )
}

/** 搜索行：搜索框（flex:1）+ 筛选按钮 + 重新扫描（图标）。 */
function commandSearchRow(props: CommandBarProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-search-row' },
    searchField(props),
    filterControl(props),
    rescanButton(props),
  )
}

/** 概览行：4 个紧凑统计段（等分、nowrap）+ 行末诊断入口（异常 0 时只留图标）。 */
function commandStatsRow(props: CommandBarProps): unknown {
  const stats: Array<{ key: StatKey; label: string; count: number; warn: boolean }> = [
    { key: 'all', label: strings.statAll(), count: props.counts.all, warn: false },
    { key: 'enabled', label: strings.statEnabled(), count: props.counts.enabled, warn: false },
    { key: 'disabled', label: strings.statDisabled(), count: props.counts.disabled, warn: false },
    { key: 'anomaly', label: strings.statAnomaly(), count: props.counts.anomaly, warn: true },
  ]
  const diagLabel = strings.diagEntryAria(props.counts.anomaly)
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-stats-row' },
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-stats', role: 'group', 'aria-label': strings.statsAria() },
      stats.map((stat) =>
        createElement(
          'button',
          {
            key: stat.key,
            type: 'button',
            className: 'dsh-my-skill-manager-stat' + (stat.warn ? ' dsh-my-skill-manager-stat-warn' : ''),
            'aria-pressed': props.activeStat === stat.key,
            onClick: () => props.onSelectStat(stat.key),
          },
          createElement('span', { className: 'dsh-my-skill-manager-stat-label' }, stat.label),
          createElement('b', {}, props.pending ? '—' : String(stat.count)),
        ),
      ),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className:
          'dsh-my-skill-manager-diag-entry' +
          (props.counts.anomaly === 0 ? ' dsh-my-skill-manager-diag-entry-idle' : ''),
        'aria-label': diagLabel,
        title: diagLabel,
        onClick: () => props.onOpenDiagnostics(),
      },
      icon.alert(14),
      props.counts.anomaly > 0 ? createElement('b', {}, props.pending ? '—' : String(props.counts.anomaly)) : null,
    ),
  )
}

/** 命令条：搜索行 + 概览行（无项目上下文时补一行提示）。 */
function CommandBar(props: CommandBarProps): unknown {
  const note = props.projectCtx
    ? null
    : createElement(
        'div',
        { className: 'dsh-my-skill-manager-project-note' },
        icon.folder(13),
        createElement('span', {}, strings.projectNote()),
      )
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-command' },
    commandSearchRow(props),
    commandStatsRow(props),
    note,
  )
}
