// ── components-toolbar：工具条（结果数 / 视图 / 排序 / 选择）+ 批量操作条 ──

interface ViewToolbarProps {
  pending: boolean
  resultCount: number
  scanTime: string
  view: string
  sortKey: SortKey
  sortDir: string
  sortOpen: boolean
  selectionMode: boolean
  onView(view: ViewMode): void
  onToggleSortMenu(event: unknown): void
  onSort(key: SortKey): void
  onToggleSortDir(): void
  onEnterSelection(): void
}

const SORT_OPTIONS: Array<{ key: SortKey; label: () => string }> = [
  { key: 'name', label: strings.sortName },
  { key: 'usage', label: strings.sortUsage },
  { key: 'recent', label: strings.sortRecent },
  { key: 'source', label: strings.sortSource },
]

function sortLabelOf(key: SortKey): string {
  for (const option of SORT_OPTIONS) if (option.key === key) return option.label()
  return ''
}

/** 视图切换：564px 下只留图标（aria-label + title 提供名称）。 */
function toolbarViewSeg(props: ViewToolbarProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-seg', role: 'group', 'aria-label': strings.viewAria() },
    createElement(
      'button',
      {
        type: 'button',
        'aria-pressed': props.view === 'cards',
        'aria-label': strings.viewCards(),
        title: strings.viewCards(),
        onClick: () => props.onView('cards'),
      },
      glyph.cards(14),
    ),
    createElement(
      'button',
      {
        type: 'button',
        'aria-pressed': props.view === 'table',
        'aria-label': strings.viewTable(),
        title: strings.viewTable(),
        onClick: () => props.onView('table'),
      },
      glyph.table(14),
    ),
  )
}

function toolbarSortMenu(props: ViewToolbarProps): unknown {
  const menu = props.sortOpen
    ? createElement(
        'div',
        { className: 'dsh-my-skill-manager-menu', role: 'menu', 'aria-label': strings.sortAria() },
        SORT_OPTIONS.map((option) =>
          createElement(
            'button',
            {
              key: option.key,
              type: 'button',
              role: 'menuitemradio',
              className: 'dsh-my-skill-manager-menu-item',
              'aria-checked': props.sortKey === option.key,
              onClick: () => props.onSort(option.key),
            },
            createElement('span', { className: 'dsh-my-skill-manager-menu-check' }, icon.check(14)),
            createElement('span', {}, option.label()),
          ),
        ),
      )
    : null
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-sortwrap' },
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-skill-manager-tool-text',
        'aria-haspopup': 'menu',
        'aria-expanded': props.sortOpen,
        onClick: (event: unknown) => props.onToggleSortMenu(event),
      },
      glyph.sort(13),
      createElement('span', {}, sortLabelOf(props.sortKey)),
    ),
    menu,
  )
}

function toolbarSortDir(props: ViewToolbarProps): unknown {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-skill-manager-sort-dir',
      'aria-label': strings.sortDirAria(props.sortDir),
      onClick: () => props.onToggleSortDir(),
    },
    props.sortDir === 'asc' ? glyph.arrowUp(14) : glyph.arrowDown(14),
  )
}

/** 选择模式：564px 下只留图标。 */
function toolbarSelectButton(props: ViewToolbarProps): unknown {
  if (props.selectionMode) return null
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-skill-manager-select-btn',
      'aria-pressed': false,
      'aria-label': strings.selectAria(),
      title: strings.selectAria(),
      onClick: () => props.onEnterSelection(),
    },
    glyph.checkSquare(14),
  )
}

/** 工具条（单行）：结果数 + 可截断的扫描时间 + 视图 / 排序 / 方向 / 选择。 */
function ViewToolbar(props: ViewToolbarProps): unknown {
  const scanTime = strings.scanTime(props.scanTime)
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-toolbar' },
    createElement(
      'span',
      { className: 'dsh-my-skill-manager-result' },
      createElement('b', {}, props.pending ? '—' : String(props.resultCount)),
      ' ' + strings.resultCountUnit(),
    ),
    createElement('span', { className: 'dsh-my-skill-manager-scan-time', title: scanTime }, scanTime),
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-toolbar-right' },
      toolbarViewSeg(props),
      toolbarSortMenu(props),
      toolbarSortDir(props),
      toolbarSelectButton(props),
    ),
  )
}

// ── 批量操作条 ──────────────────────────────────────────────────────────
interface BulkBarProps {
  count: number
  anomalyCount: number
  confirm: boolean
  onEnable(): void
  onDisable(): void
  onConfirm(): void
  onCancel(): void
  onExit(): void
}

/** 批量禁用的内联二次确认（不弹原生 confirm）。 */
function bulkConfirmBar(props: BulkBarProps): unknown {
  const eligible = props.count - props.anomalyCount
  const skipNote = props.anomalyCount > 0 ? createElement('em', {}, strings.confirmSkipNote(props.anomalyCount)) : null
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-action dsh-my-skill-manager-action-confirm', 'aria-live': 'polite' },
    icon.alert(16),
    createElement('div', { className: 'dsh-my-skill-manager-action-info' }, strings.confirmTitle(eligible), skipNote),
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-action-btns' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-skill-manager-btn dsh-my-skill-manager-btn-danger',
          disabled: eligible === 0,
          onClick: () => props.onConfirm(),
        },
        strings.confirmDisable(),
      ),
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-skill-manager-btn', onClick: () => props.onCancel() },
        strings.confirmCancel(),
      ),
    ),
  )
}

function bulkActionBar(props: BulkBarProps): unknown {
  const skipNote =
    props.anomalyCount > 0
      ? createElement('span', { className: 'dsh-my-skill-manager-action-note' }, strings.bulkSkip(props.anomalyCount))
      : null
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-action', 'aria-live': 'polite' },
    glyph.checkSquare(16),
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-action-info' },
      createElement('span', {}, strings.bulkSelected(props.count)),
      skipNote,
    ),
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-action-btns' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-skill-manager-btn',
          disabled: props.count === 0,
          'aria-label': strings.bulkEnableAria(),
          onClick: () => props.onEnable(),
        },
        strings.bulkEnable(),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-skill-manager-btn dsh-my-skill-manager-btn-danger-ghost',
          disabled: props.count === 0,
          'aria-label': strings.bulkDisableAria(),
          onClick: () => props.onDisable(),
        },
        strings.bulkDisable(),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-skill-manager-btn dsh-my-skill-manager-btn-ghost',
          'aria-label': strings.bulkExitAria(),
          onClick: () => props.onExit(),
        },
        strings.bulkExit(),
      ),
    ),
  )
}

/** 批量条：常规（已选 N / 启用 / 禁用 / 退出）或内联确认。 */
function BulkBar(props: BulkBarProps): unknown {
  if (props.confirm) return bulkConfirmBar(props)
  return bulkActionBar(props)
}
