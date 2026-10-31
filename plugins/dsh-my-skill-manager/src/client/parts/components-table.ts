// ── components-table：紧凑表（可排序表头 + 多选 + 行内双开关 + 行展开）──

interface TableViewProps {
  items: SkillItem[]
  shared: SkillViewShared
  sortKey: SortKey
  sortDir: string
  onSort(key: SortKey): void
  onSelectAll(checked: boolean): void
}

function ariaSortFor(key: SortKey, sortKey: SortKey, sortDir: string): string {
  if (sortKey !== key) return 'none'
  return sortDir === 'asc' ? 'ascending' : 'descending'
}

function sortGlyph(key: SortKey, sortKey: SortKey, sortDir: string): unknown {
  if (sortKey !== key) return glyph.sortNeutral(12)
  return sortDir === 'asc' ? glyph.arrowUp(12) : glyph.arrowDown(12)
}

function sortHeader(key: SortKey, label: string, props: TableViewProps): unknown {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-skill-manager-sortbtn',
      'aria-label': strings.sortByAria(label),
      onClick: () => props.onSort(key),
    },
    label,
    sortGlyph(key, props.sortKey, props.sortDir),
  )
}

function sortableTh(key: SortKey, label: string, props: TableViewProps): unknown {
  return createElement(
    'th',
    {
      className: 'dsh-my-skill-manager-th-sort',
      'aria-sort': ariaSortFor(key, props.sortKey, props.sortDir),
    },
    sortHeader(key, label, props),
  )
}

function rowClasses(item: SkillItem, selected: boolean): string {
  const classes = ['dsh-my-skill-manager-row']
  if (isAnomaly(item)) classes.push('dsh-my-skill-manager-row-anomaly')
  else if (!item.globalOn) classes.push('dsh-my-skill-manager-row-off')
  if (selected) classes.push('dsh-my-skill-manager-row-selected')
  return classes.join(' ')
}

function rowCheckCell(item: SkillItem, selected: boolean, shared: SkillViewShared): unknown {
  if (!shared.selectionMode) return null
  return createElement(
    'td',
    { className: 'dsh-my-skill-manager-col-check' },
    createElement('input', {
      type: 'checkbox',
      className: 'dsh-my-skill-manager-checkbox',
      'aria-label': strings.selectRowAria(item.name),
      checked: selected,
      onChange: () => shared.handlers.onToggleSelect(item.key),
    }),
  )
}

function rowNameCell(item: SkillItem, expanded: boolean, shared: SkillViewShared): unknown {
  const button = createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-skill-manager-row-open',
      'aria-expanded': expanded,
      'aria-controls': 'detail-row-' + item.key,
      title: strings.cardOpenAria(item.name, expanded),
      onClick: () => shared.handlers.onToggleDetail(item),
    },
    createElement('span', { className: 'dsh-my-skill-manager-name' }, item.name),
    skillBadges(item),
    createElement('span', { className: 'dsh-my-skill-manager-chevron' }, icon.chevronDown(12)),
  )
  return createElement(
    'td',
    {},
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-row-name' },
      createElement('span', { className: 'dsh-my-skill-manager-row-bar', 'aria-hidden': 'true' }),
      button,
    ),
  )
}

function rowScopeCell(item: SkillItem, shared: SkillViewShared): unknown {
  const anomaly = isAnomaly(item)
  return createElement(
    'td',
    {},
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-scope-cell' },
      createElement(ScopeSwitch, {
        item,
        scope: 'global',
        checked: item.globalOn,
        disabled: anomaly,
        projectCtx: shared.projectCtx,
        mini: true,
        onToggle: shared.handlers.onToggleScope,
      }),
      createElement(ScopeSwitch, {
        item,
        scope: 'project',
        checked: item.projectOn,
        disabled: anomaly,
        projectCtx: shared.projectCtx,
        mini: true,
        onToggle: shared.handlers.onToggleScope,
      }),
    ),
  )
}

/** 行主体：勾选 / 名称 / 来源 / 使用次数 / 最近使用 / 双开关。 */
function rowMainCells(item: SkillItem, props: TableViewProps, expanded: boolean, selected: boolean): unknown[] {
  const recent = formatRecent(lastUsedOf(item))
  const count = usageCountOf(item)
  return [
    rowCheckCell(item, selected, props.shared),
    rowNameCell(item, expanded, props.shared),
    createElement('td', {}, sourceLabelOf(item.source)),
    createElement('td', { title: strings.usageTimes(count) }, String(count)),
    createElement(
      'td',
      { title: recent === '' ? strings.recentNever() : recent },
      recent === '' ? strings.usageViaNone() : recent,
    ),
    rowScopeCell(item, props.shared),
  ]
}

/** 展开详情行 / 未展开时的内联错误行。 */
function rowDetailNode(
  item: SkillItem,
  props: TableViewProps,
  cols: number,
  expanded: boolean,
  error: InlineErrorValue | null,
): unknown {
  if (expanded) {
    const inline =
      error === null ? null : createElement(InlineError, { item, error, onRetry: props.shared.handlers.onRetryInline })
    return createElement(
      'tr',
      { key: 'detail-row:' + item.key, className: 'dsh-my-skill-manager-detail-row', id: 'detail-row-' + item.key },
      createElement(
        'td',
        { colSpan: cols },
        inline,
        createElement(FocusDetail, {
          id: 'detail-' + item.key,
          item,
          detail: props.shared.details[item.key],
          projectCtx: props.shared.projectCtx,
          handlers: props.shared.handlers,
        }),
      ),
    )
  }
  if (error === null) return null
  return createElement(
    'tr',
    { key: 'error-row:' + item.key, className: 'dsh-my-skill-manager-detail-row' },
    createElement(
      'td',
      { colSpan: cols },
      createElement(InlineError, { item, error, onRetry: props.shared.handlers.onRetryInline }),
    ),
  )
}

/** 一行 = 主体行 [+ 详情行 / 错误行]。 */
function tableRow(item: SkillItem, props: TableViewProps, cols: number): unknown[] {
  const shared = props.shared
  const expanded = shared.expanded.indexOf(item.key) !== -1
  const selected = shared.selected.indexOf(item.key) !== -1
  const error = shared.inlineError !== null && shared.inlineError.key === item.key ? shared.inlineError : null
  const row = createElement(
    'tr',
    {
      key: 'row:' + item.key,
      className: rowClasses(item, selected),
      'data-expanded': expanded ? 'true' : 'false',
      'data-row-id': item.key,
      onClick: (event: unknown) => {
        if (!isInteractiveEvent(event)) shared.handlers.onToggleDetail(item)
      },
    },
    ...rowMainCells(item, props, expanded, selected),
  )
  const detail = rowDetailNode(item, props, cols, expanded, error)
  return detail === null ? [row] : [row, detail]
}

function tableColgroup(selectionMode: boolean): unknown {
  return createElement(
    'colgroup',
    {},
    selectionMode ? createElement('col', { className: 'dsh-my-skill-manager-col-check' }) : null,
    createElement('col', {}),
    createElement('col', { className: 'dsh-my-skill-manager-col-source' }),
    createElement('col', { className: 'dsh-my-skill-manager-col-usage' }),
    createElement('col', { className: 'dsh-my-skill-manager-col-recent' }),
    createElement('col', { className: 'dsh-my-skill-manager-col-scope' }),
  )
}

function tableCheckAllCell(props: TableViewProps, allSelected: boolean): unknown {
  if (!props.shared.selectionMode) return null
  return createElement(
    'th',
    { className: 'dsh-my-skill-manager-col-check' },
    createElement('input', {
      type: 'checkbox',
      className: 'dsh-my-skill-manager-checkbox',
      'aria-label': strings.selectAllAria(),
      checked: allSelected,
      onChange: (event: { target?: { checked?: boolean } }) =>
        props.onSelectAll(event.target !== undefined && event.target.checked === true),
    }),
  )
}

function tableHead(props: TableViewProps, allSelected: boolean): unknown {
  return createElement(
    'thead',
    {},
    createElement(
      'tr',
      {},
      tableCheckAllCell(props, allSelected),
      sortableTh('name', strings.colName(), props),
      sortableTh('source', strings.colSource(), props),
      sortableTh('usage', strings.colUsage(), props),
      sortableTh('recent', strings.colRecent(), props),
      createElement(
        'th',
        { className: 'dsh-my-skill-manager-th-scope', title: strings.colScopeTitle() },
        strings.colScope(),
      ),
    ),
  )
}

function SkillTable(props: TableViewProps): unknown {
  const shared = props.shared
  const cols = shared.selectionMode ? 6 : 5
  let selectedVisible = 0
  for (const item of props.items) if (shared.selected.indexOf(item.key) !== -1) selectedVisible += 1
  const allSelected = props.items.length > 0 && selectedVisible === props.items.length
  const rows: unknown[] = []
  for (const item of props.items) {
    for (const node of tableRow(item, props, cols)) rows.push(node)
  }
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-table-wrap' },
    createElement(
      'table',
      { className: 'dsh-my-skill-manager-table', 'aria-label': strings.tableAria() },
      tableColgroup(shared.selectionMode),
      tableHead(props, allSelected),
      createElement('tbody', {}, rows),
    ),
  )
}
