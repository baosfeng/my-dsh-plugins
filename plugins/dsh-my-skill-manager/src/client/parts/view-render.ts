// ── view-render：把根状态渲染成技能台（命令区 + 舞台 + toast）──────────
// 只做节点组装，不持有状态；每个区块拆成一个小函数，便于单独调整布局。

function renderCommandBar(store: DeckStore, derived: DeckDerived): unknown {
  const state = store.state
  if (state.diagOpen || state.selectionMode) return null
  return createElement(CommandBar, {
    query: state.query,
    pending: derived.pending,
    counts: derived.counts,
    activeStat: derived.activeStat,
    scanning: state.loading,
    scanTime: derived.scanTime,
    projectCtx: derived.projectCtx,
    searchRef: store.searchRef,
    onQueryChange: (value: string) => updateDeck(store, { query: value }),
    onClearSearch: () => {
      updateDeck(store, { query: '' })
      focusDeckSearch(store)
    },
    onSelectStat: (stat: StatKey) => selectStatAction(store, stat),
    onRescan: () => rescanAction(store, derived.cwd, derived.data !== null),
    onOpenDiagnostics: () => openDiagnosticsAction(store),
    filterOpen: state.filterOpen,
    activeFilterCount: derived.activeFilterCount,
    source: state.source,
    status: state.status,
    unusedOnly: state.unusedOnly,
    onToggleFilters: (event: unknown) => toggleFilterPanelAction(store, event),
    onCloseFilters: () => closeFilterPanelAction(store),
    onResetFilters: () => resetFiltersAction(store),
    onSource: (next: string) => updateDeck(store, { source: next }),
    onStatus: (next: string) => updateDeck(store, { status: next }),
    onToggleUnused: () => updateDeck(store, { unusedOnly: !state.unusedOnly }),
  })
}

function renderBulkBar(store: DeckStore, derived: DeckDerived): unknown {
  const state = store.state
  if (!state.selectionMode || state.diagOpen) return null
  return createElement(BulkBar, {
    count: derived.selectedItems.length,
    anomalyCount: derived.selectedAnomalyCount,
    confirm: state.batchConfirm,
    onEnable: () => batchApplyAction(store, derived, true),
    onDisable: () => updateDeck(store, { batchConfirm: true }),
    onConfirm: () => batchApplyAction(store, derived, false),
    onCancel: () => updateDeck(store, { batchConfirm: false }),
    onExit: () => exitSelectionAction(store),
  })
}

function renderToolbar(store: DeckStore, derived: DeckDerived): unknown {
  const state = store.state
  if (state.diagOpen) return null
  return createElement(ViewToolbar, {
    pending: derived.pending,
    resultCount: derived.visible.length,
    scanTime: derived.scanTime,
    view: state.viewMode,
    sortKey: state.sortKey,
    sortDir: state.sortDir,
    sortOpen: state.sortOpen,
    selectionMode: state.selectionMode,
    onView: (next: ViewMode) => changeViewAction(store, next),
    onToggleSortMenu: (event: unknown) => toggleSortMenuAction(store, event),
    onSort: (key: SortKey) => changeSortAction(store, key),
    onToggleSortDir: () => toggleSortDirAction(store),
    onEnterSelection: () => enterSelectionAction(store),
  })
}

function renderDiagnostics(store: DeckStore, derived: DeckDerived): unknown {
  const items = derived.anomalyItems.slice().sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return createElement(DiagnosticsPage, {
    items,
    scanTime: derived.scanTime,
    onBack: () => closeDiagnosticsAction(store),
    onRescan: () => rescanAction(store, derived.cwd, derived.data !== null),
    onCopyPath: (item: SkillItem) => copyPathAction(store, item),
  })
}

/** 舞台：诊断台 / 加载 / 失败 / 空态 / 紧凑表 / 卡片流，六选一。 */
function renderStage(store: DeckStore, derived: DeckDerived): unknown {
  const state = store.state
  const shared = deckShared(store, derived)
  const panel = statePanelProps(store, derived)
  if (state.diagOpen) return renderDiagnostics(store, derived)
  if (state.loading) return createElement(StatePanel, { ...panel, kind: 'loading' })
  if (state.error !== '') return createElement(StatePanel, { ...panel, kind: 'error', message: state.error })
  if (derived.visible.length === 0) {
    return createElement(StatePanel, { ...panel, kind: 'empty', variant: emptyVariantOf(state, derived) })
  }
  if (state.viewMode === 'table') {
    return createElement(SkillTable, {
      items: derived.visible,
      shared,
      sortKey: state.sortKey,
      sortDir: state.sortDir,
      onSort: (key: SortKey) => changeSortAction(store, key),
      onSelectAll: (checked: boolean) =>
        selectAllAction(store, checked ? derived.visible.map((item) => item.key) : null),
    })
  }
  return createElement(CardsView, { groups: derived.groups, shared })
}

/** 命令区三段（命令条 / 批量条 / 工具条）；来源与状态筛选收进命令条的面板。 */
function renderChrome(store: DeckStore, derived: DeckDerived): unknown[] {
  return [renderCommandBar(store, derived), renderBulkBar(store, derived), renderToolbar(store, derived)]
}

/** 技能台根容器：命令区 + 舞台 + toast。 */
function renderDeck(store: DeckStore): unknown {
  const derived = deriveDeck(store.state)
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-root' },
    ...renderChrome(store, derived),
    createElement('div', { className: 'dsh-my-skill-manager-stage' }, renderStage(store, derived)),
    createElement(Toast, { toast: store.state.toast }),
  )
}
