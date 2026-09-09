// ── DOM 表格渲染：div.dsh-md-render-table-scroll > table.dsh-md-render-table ──
// 表头 thead / 数据 tbody / 每列对齐 style；prefix/suffix 文本保留
// 为段落；外层滚动容器提供宽表格横向滚动，容器下方带滚动提示条
// （chevronRight 图标 + 文案，issue #54 阶段 1 视觉统一）。返回
// DocumentFragment。
//
// 交互增强（issue #83）：
//  - 表头排序：th 带 data-sort-col，点击按该列排序（升/降切换，数值列
//    按数值比较、文本列按 localeCompare），箭头 span 显示 ↑/↓；排序
//    只影响当前表格 DOM（状态存 scroll 容器 dataset，不跨表格共享）；
//  - 长表格折叠：行数 > FOLD_LIMIT 时第 FOLD_LIMIT 行起加
//    dsh-md-render-folded-row（CSS display:none 隐藏，行数据保留在 DOM，
//    展开/收起只切换 class），表格下方渲染「展开全部 N 行」按钮；
//  - 事件委托：click 绑定在 scroll 容器上（th 排序 / 折叠按钮切换），
//    排序/折叠状态存 scroll.dataset（sortCol/sortDir/totalRows）。

/** 长表格折叠阈值：行数超过该值默认折叠为前 N 行。 */
const FOLD_LIMIT = 20

/** 单元格比较：两个非空数值字符串按数值比较，否则按 localeCompare。 */
function compareCells(a: string | null | undefined, b: string | null | undefined): number {
  const sa = String(a ?? '').trim()
  const sb = String(b ?? '').trim()
  const na = Number(sa)
  const nb = Number(sb)
  if (sa !== '' && sb !== '' && Number.isFinite(na) && Number.isFinite(nb)) {
    return na - nb
  }
  return sa.localeCompare(sb)
}

/** 按列排序（返回新数组，不修改原数组；dir: 'asc' | 'desc'）。 */
function sortRows(rows: string[][], colIndex: number, dir: string): string[][] {
  const factor = dir === 'desc' ? -1 : 1
  return rows.slice().sort((r1, r2) => factor * compareCells(r1[colIndex], r2[colIndex]))
}

/** 折叠：行数超过 limit 时返回 { visible: 前 limit 行, hidden: 隐藏数 }。 */
function foldRows(rows: string[][], limit: number): { visible: string[][]; hidden: number } {
  if (rows.length <= limit) return { visible: rows, hidden: 0 }
  return { visible: rows.slice(0, limit), hidden: rows.length - limit }
}

/** 构建 thead（表头行 + 每列对齐 + 排序列标记与箭头 span；issue #84：
 *  tableSort 关闭 → th 不渲染排序列标记与箭头）。 */
function renderHead(table: TableData): HTMLTableSectionElement {
  const thead = document.createElement('thead')
  const headTr = document.createElement('tr')
  table.header.forEach((cell, j) => {
    const th = document.createElement('th')
    th.style.textAlign = table.aligns[j] || 'left'
    th.appendChild(renderInline(cell))
    if (renderOptions.tableSort) {
      th.setAttribute('data-sort-col', String(j))
      const arrow = document.createElement('span')
      arrow.className = 'dsh-md-render-sort-arrow'
      arrow.setAttribute('aria-hidden', 'true')
      th.appendChild(arrow)
    }
    headTr.appendChild(th)
  })
  thead.appendChild(headTr)
  return thead
}

/** 构建 tbody（数据行 + 每列对齐；issue #84：tableFold 关闭 → 不折叠）。 */
function renderBody(table: TableData): HTMLTableSectionElement {
  const tbody = document.createElement('tbody')
  table.rows.forEach((row, i) => {
    const tr = document.createElement('tr')
    if (renderOptions.tableFold && i >= FOLD_LIMIT) tr.className = 'dsh-md-render-folded-row'
    row.forEach((cell, j) => {
      const td = document.createElement('td')
      td.style.textAlign = table.aligns[j] || 'left'
      td.appendChild(renderInline(cell))
      tr.appendChild(td)
    })
    tbody.appendChild(tr)
  })
  return tbody
}

/** 折叠控制按钮（初始「展开全部 N 行」）。 */
function renderFoldButton(total: number): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'dsh-md-render-table-fold'
  btn.textContent = `展开全部 ${total} 行`
  return btn
}

/** 更新表头排序箭头：当前列显示 ↑/↓ 并带 data-sorted，其余列清空。 */
function updateSortArrows(tbl: HTMLTableElement, col: number, dir: string): void {
  tbl.querySelectorAll('th').forEach((th, j) => {
    const arrow = th.querySelector('.dsh-md-render-sort-arrow')
    if (!arrow) return
    if (j === col) {
      arrow.textContent = dir === 'asc' ? '↑' : '↓'
      th.setAttribute('data-sorted', dir)
    } else {
      arrow.textContent = ''
      th.removeAttribute('data-sorted')
    }
  })
}

/** 按点击的表头列排序：升/降切换，对 tbody 全部行（含折叠行）排序。 */
function sortTable(scroll: HTMLElement, th: HTMLElement): void {
  const tbl = scroll.querySelector('table.dsh-md-render-table') as HTMLTableElement
  const tbody = tbl.querySelector('tbody')
  if (!tbody) return
  const col = Number(th.getAttribute('data-sort-col'))
  const prevCol = scroll.dataset.sortCol
  const prevDir = scroll.dataset.sortDir
  const dir = prevCol === String(col) ? (prevDir === 'asc' ? 'desc' : 'asc') : 'asc'
  scroll.dataset.sortCol = String(col)
  scroll.dataset.sortDir = dir
  const cellText = (tr: HTMLTableRowElement): string => {
    const tds = tr.querySelectorAll('td')
    return tds[col] ? (tds[col].textContent ?? '') : ''
  }
  const trs = Array.from(tbody.querySelectorAll('tr'))
  trs.sort((a, b) => {
    const c = compareCells(cellText(a), cellText(b))
    return dir === 'desc' ? -c : c
  })
  for (const tr of trs) tbody.appendChild(tr)
  updateSortArrows(tbl, col, dir)
}

/** 折叠/展开切换：只切换行的折叠 class 与按钮文本。 */
function toggleFold(scroll: HTMLElement, btn: HTMLButtonElement): void {
  const tbl = scroll.querySelector('table.dsh-md-render-table') as HTMLTableElement
  const tbody = tbl.querySelector('tbody')
  if (!tbody) return
  const total = Number(scroll.dataset.totalRows) || 0
  const trs = Array.from(tbody.querySelectorAll('tr'))
  const folded = trs.some((tr) => tr.classList.contains('dsh-md-render-folded-row'))
  if (folded) {
    for (const tr of trs) tr.classList.remove('dsh-md-render-folded-row')
    btn.textContent = '收起'
  } else {
    for (let i = FOLD_LIMIT; i < trs.length; i += 1) trs[i].classList.add('dsh-md-render-folded-row')
    btn.textContent = `展开全部 ${total} 行`
  }
}

/** scroll 容器上的 click 事件委托：表头排序 / 折叠按钮切换（issue #84：
 *  tableSort / tableFold 关闭 → 对应交互不生效）。 */
function onTableClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return
  const scroll = target.closest('.dsh-md-render-table-scroll') as HTMLElement | null
  if (!scroll) return
  const th = target.closest('th[data-sort-col]') as HTMLElement | null
  if (th && renderOptions.tableSort) {
    sortTable(scroll, th)
    return
  }
  if (renderOptions.tableFold) {
    const btn = target.closest('.dsh-md-render-table-fold') as HTMLButtonElement | null
    if (btn) toggleFold(scroll, btn)
  }
}

/** 共享图标风格的 chevronRight（DOM 侧手写 SVG，stroke=currentColor，
 *  与 dsh-shared/client-parts/icons.part.js 的线性图标风格一致）。 */
function chevronIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  polyline.setAttribute('points', '9 6 15 12 9 18')
  svg.appendChild(polyline)
  return svg
}

/** 滚动提示条：指示宽表格可横向滚动（弱化样式，见 styles.ts）。 */
function renderScrollHint(): HTMLDivElement {
  const hint = document.createElement('div')
  hint.className = 'dsh-md-render-scroll-hint'
  hint.appendChild(chevronIcon())
  hint.appendChild(document.createTextNode('横向滚动'))
  return hint
}

/** 渲染完整表格（含 prefix/suffix 段落、滚动容器与滚动提示条）。 */
function renderTable(table: TableData): DocumentFragment {
  const frag = document.createDocumentFragment()
  if (table.prefix) {
    const p = document.createElement('p')
    p.className = 'dsh-md-render-prefix'
    p.textContent = table.prefix
    frag.appendChild(p)
  }
  const scroll = document.createElement('div')
  scroll.className = 'dsh-md-render-table-scroll'
  const tbl = document.createElement('table')
  tbl.className = 'dsh-md-render-table'
  tbl.appendChild(renderHead(table))
  if (table.rows.length > 0) {
    tbl.appendChild(renderBody(table))
    // issue #84：tableFold 关闭 → 不渲染折叠按钮（全部行可见）。
    if (renderOptions.tableFold && table.rows.length > FOLD_LIMIT) {
      scroll.dataset.totalRows = String(table.rows.length)
      scroll.appendChild(renderFoldButton(table.rows.length))
    }
  }
  scroll.appendChild(tbl)
  scroll.addEventListener('click', onTableClick)
  frag.appendChild(scroll)
  frag.appendChild(renderScrollHint())
  if (table.suffix) {
    const p = document.createElement('p')
    p.className = 'dsh-md-render-suffix'
    p.textContent = table.suffix
    frag.appendChild(p)
  }
  return frag
}

exports.compareCells = compareCells
exports.sortRows = sortRows
exports.foldRows = foldRows
exports.renderTable = renderTable
