// ── deck-actions：派生模型 + 轻交互（筛选 / 视图 / 排序 / 选择 / 诊断）──
// 写操作（启停 / 批量 / 重扫 / 复制）在 deck-data.ts；这里只做同步的状态
// 迁移与「给展示组件用的 props 组装」，保证根组件与展示组件都很薄。

interface DeckDerived {
  data: ListValue | null
  cwd: string
  projectCtx: boolean
  items: SkillItem[]
  counts: CountsValue
  filters: FilterState
  visible: SkillItem[]
  groups: SkillGroup[]
  activeStat: string
  anomalyItems: SkillItem[]
  scanTime: string
  pending: boolean
  /** 生效的筛选条件数（来源 / 状态 / 只看未使用），用于筛选按钮徽标。 */
  activeFilterCount: number
  selectedItems: SkillItem[]
  selectedAnomalyCount: number
}

const EMPTY_COUNTS: CountsValue = {
  all: 0,
  enabled: 0,
  disabled: 0,
  anomaly: 0,
  project: 0,
  user: 0,
  bundled: 0,
  other: 0,
  unused: 0,
}

/** 生效筛选条件数：来源 / 状态 / 只看未使用各算一条。 */
function activeFilterCountOf(state: DeckState): number {
  let count = 0
  if (state.source !== 'all') count += 1
  if (state.status !== 'all') count += 1
  if (state.unusedOnly) count += 1
  return count
}

/** 由根状态推导出所有只读视图数据（每帧重算，数据量小且无副作用）。 */
function deriveDeck(state: DeckState): DeckDerived {
  const data = state.data
  const cwd = data !== null && data.cwd !== '' ? data.cwd : state.sessionCwd
  const items = data === null ? [] : buildItems(data)
  const filters: FilterState = {
    query: state.query,
    source: state.source,
    status: state.status,
    unusedOnly: state.unusedOnly,
  }
  const visible = sortItems(filterItems(items, filters), state.sortKey, state.sortDir)
  const selectedItems = items.filter((item) => state.selected.indexOf(item.key) !== -1)
  return {
    data,
    cwd,
    projectCtx: cwd !== '',
    items,
    counts: data === null ? EMPTY_COUNTS : countsOf(items),
    filters,
    visible,
    groups: groupItems(visible),
    activeStat: activeStatOf(filters),
    anomalyItems: items.filter(isAnomaly),
    scanTime: formatClock(data === null ? 0 : data.scannedAt),
    pending: state.loading && data === null,
    activeFilterCount: activeFilterCountOf(state),
    selectedItems,
    selectedAnomalyCount: selectedItems.filter(isAnomaly).length,
  }
}

function resetFiltersAction(store: DeckStore): void {
  updateDeck(store, { query: '', source: 'all', status: 'all', unusedOnly: false })
}

/** 概览数字：全部=清空筛选；再点同一个状态=取消；其他=只看该状态。 */
function selectStatAction(store: DeckStore, stat: StatKey): void {
  const state = store.state
  if (stat === 'all') {
    resetFiltersAction(store)
    return
  }
  if (state.status === stat && state.source === 'all') {
    updateDeck(store, { status: 'all' })
    return
  }
  updateDeck(store, { source: 'all', status: stat, unusedOnly: false })
}

/** 排序：点同一个键翻转方向，换键回到该键的默认方向（次数/最近默认降序）。 */
function changeSortAction(store: DeckStore, key: SortKey): void {
  const state = store.state
  const defaultDir = key === 'usage' || key === 'recent' ? 'desc' : 'asc'
  const nextDir = state.sortKey === key ? (state.sortDir === 'asc' ? 'desc' : 'asc') : defaultDir
  updateDeck(store, { sortKey: key, sortDir: nextDir, sortOpen: false })
}

function changeViewAction(store: DeckStore, view: ViewMode): void {
  updateDeck(store, { viewMode: view, sortOpen: false })
}

function toggleSortDirAction(store: DeckStore): void {
  updateDeck(store, { sortDir: store.state.sortDir === 'asc' ? 'desc' : 'asc' })
}

/** 排序菜单开关（触发按钮吞掉这次点击，避免被外点关闭逻辑立刻关掉）。 */
function toggleSortMenuAction(store: DeckStore, event: unknown): void {
  if (event !== null && typeof event === 'object') {
    const stop = (event as { stopPropagation?: unknown }).stopPropagation
    if (typeof stop === 'function') (stop as () => void).call(event)
  }
  updateDeck(store, { sortOpen: !store.state.sortOpen, filterOpen: false })
}

/** 筛选面板开关（互斥排序菜单；面板内点击自行 stopPropagation）。 */
function toggleFilterPanelAction(store: DeckStore, event: unknown): void {
  if (event !== null && typeof event === 'object') {
    const stop = (event as { stopPropagation?: unknown }).stopPropagation
    if (typeof stop === 'function') (stop as () => void).call(event)
  }
  updateDeck(store, { filterOpen: !store.state.filterOpen, sortOpen: false })
}

function closeFilterPanelAction(store: DeckStore): void {
  updateDeck(store, { filterOpen: false })
}

function enterSelectionAction(store: DeckStore): void {
  updateDeck(store, {
    diagOpen: false,
    sortOpen: false,
    filterOpen: false,
    selectionMode: true,
    selected: [],
    batchConfirm: false,
  })
}

function exitSelectionAction(store: DeckStore): void {
  updateDeck(store, { selectionMode: false, selected: [], batchConfirm: false })
}

function toggleSelectAction(store: DeckStore, key: string): void {
  store.setState((previous) => {
    const present = previous.selected.indexOf(key) !== -1
    const selected = present ? previous.selected.filter((entry) => entry !== key) : previous.selected.concat([key])
    return { ...previous, selected, batchConfirm: false }
  })
}

/** 表头全选：keys = null 表示取消全选。 */
function selectAllAction(store: DeckStore, keys: string[] | null): void {
  updateDeck(store, { selected: keys === null ? [] : keys, batchConfirm: false })
}

function openDiagnosticsAction(store: DeckStore): void {
  updateDeck(store, {
    diagOpen: true,
    selectionMode: false,
    selected: [],
    batchConfirm: false,
    sortOpen: false,
    filterOpen: false,
  })
}

function closeDiagnosticsAction(store: DeckStore): void {
  updateDeck(store, { diagOpen: false })
}

/** 空态判定：搜索无结果 > 无项目上下文 > 筛选无结果 > 无数据。 */
function emptyVariantOf(state: DeckState, derived: DeckDerived): string {
  if (state.query.trim() !== '') return 'noresult'
  if (!derived.projectCtx && (state.source === 'project' || derived.items.length === 0)) return 'noproject'
  if (state.source !== 'all' || state.status !== 'all' || state.unusedOnly) return 'filtered'
  return 'nodata'
}

/** 卡片 / 表格共用的展示状态 + 回调。 */
function deckShared(store: DeckStore, derived: DeckDerived): SkillViewShared {
  return {
    projectCtx: derived.projectCtx,
    selectionMode: store.state.selectionMode,
    selected: store.state.selected,
    expanded: store.state.expanded,
    details: store.state.details,
    inlineError: store.state.inlineError,
    handlers: deckHandlers(store, derived),
  }
}

/** 卡片 / 表格共用回调：全部转调 deck-data 的真实动作。 */
function deckHandlers(store: DeckStore, derived: DeckDerived): SkillViewHandlers {
  return {
    onToggleDetail: (item) => toggleDetailAction(store, derived.cwd, item),
    onToggleScope: (item, scope) => toggleScopeAction(store, derived, item, scope),
    onToggleSelect: (key) => toggleSelectAction(store, key),
    onCopyPath: (item) => copyPathAction(store, item),
    onCopyMd: (item) => copyMdAction(store, item),
    onRetryInline: (item) => retryInlineAction(store, derived.cwd, item),
    onRetryDetail: (item) => loadDetailAction(store, derived.cwd, item),
  }
}

/** 状态页 props（空态复用同一组回调）。 */
function statePanelProps(store: DeckStore, derived: DeckDerived): StatePanelProps {
  return {
    kind: 'empty',
    variant: 'nodata',
    query: store.state.query,
    message: '',
    onRescan: () => rescanAction(store, derived.cwd, derived.data !== null),
    onClearSearch: () => resetFiltersAction(store),
    onResetFilters: () => resetFiltersAction(store),
    onShowAll: () => resetFiltersAction(store),
  }
}
