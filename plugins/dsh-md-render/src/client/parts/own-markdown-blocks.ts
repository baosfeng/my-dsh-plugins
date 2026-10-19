// ── markdown 块级渲染（A 路 · own-markdown.ts 的块级分支）────────────────
// 从 own-markdown.ts 拆出（文件 ≤400 行门禁）：表格 / 列表 / 任务项 / 代码块 /
// 行内内容块 → vdom 节点。与 inline 层共用同一个 factory 作用域（script 模式），
// 因此这里直接引用 createElement / mdInlineChildren / mdTokenOf 等，无需 import。
// 行为与拆分前逐字一致：块级 token 组装逻辑没有任何改动。

/** 表格单元格（th / td；对齐走自有 class）。 */
function mdCellNode(cell: unknown, key: string, tag: string, align: unknown): unknown {
  return createElement(
    tag,
    { key, className: 'mdr-md-cell' + mdAlignClass(align) },
    ...mdInlineChildren(mdTokenOf(cell).tokens, key),
  )
}

/** 表格：外层横向滚动容器（宽表格不撑破消息区）。 */
function mdTableNode(t: Record<string, unknown>, key: string): unknown {
  const header = Array.isArray(t.header) ? t.header : []
  const rows = Array.isArray(t.rows) ? t.rows : []
  const aligns = Array.isArray(t.align) ? t.align : []
  const headRow = createElement(
    'tr',
    { key: key + '-head' },
    ...header.map((cell, index) => mdCellNode(cell, key + '-h-' + String(index), 'th', aligns[index])),
  )
  const bodyRows = rows.map((row, rowIndex) => {
    const cells = Array.isArray(row) ? row : []
    return createElement(
      'tr',
      { key: key + '-r-' + String(rowIndex) },
      ...cells.map((cell, index) =>
        mdCellNode(cell, key + '-r-' + String(rowIndex) + '-' + String(index), 'td', aligns[index]),
      ),
    )
  })
  return createElement(
    'div',
    { key, className: MDR_MD_TABLE_WRAP_CLASS },
    createElement(
      'table',
      { className: MDR_MD_TABLE_CLASS },
      createElement('thead', null, headRow),
      createElement('tbody', null, ...bodyRows),
    ),
  )
}

/**
 * 列表项内容：tight 列表的 text token 直接出行内节点；其余（段落 / 嵌套列表 / 代码块…）
 * 按块渲染 —— 与 marked 的 tight / loose 语义一致，且不额外包一层 <p>。
 */
function mdItemChildren(item: Record<string, unknown>, keyBase: string): unknown[] {
  const tokens = Array.isArray(item.tokens) ? item.tokens : []
  const out: unknown[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const key = keyBase + '-i-' + String(i)
    const t = mdTokenOf(tokens[i])
    if (t.type === 'text' && Array.isArray(t.tokens)) {
      for (const node of mdInlineChildren(t.tokens, key)) out.push(node)
      continue
    }
    if (t.type === 'text') {
      out.push(mdText(t.text))
      continue
    }
    const node = mdBlockNode(tokens[i], key)
    if (node === null) continue
    if (Array.isArray(node)) {
      for (const child of node) out.push(child)
    } else {
      out.push(node)
    }
  }
  return out
}

/** 列表项：任务项渲染成只读复选框（disabled + readOnly；勾形由 CSS :has 画）。 */
function mdItemNode(item: unknown, key: string): unknown {
  const t = mdTokenOf(item)
  const children = mdItemChildren(t, key)
  if (t.task !== true) return createElement('li', { key, className: 'mdr-md-li' }, ...children)
  const checked = t.checked === true
  const box = createElement('input', {
    key: key + '-check',
    className: MDR_MD_CHECK_CLASS,
    type: 'checkbox',
    checked,
    disabled: true,
    readOnly: true,
    'aria-label': checked ? '已完成' : '未完成',
  })
  return createElement('li', { key, className: MDR_MD_TASK_ITEM_CLASS + (checked ? ' is-done' : '') }, box, ...children)
}

/** 列表（有序列表按 marked 的 start 还原起始序号；任务列表加同类名）。 */
function mdListNode(t: Record<string, unknown>, key: string): unknown {
  const ordered = t.ordered === true
  const items = Array.isArray(t.items) ? t.items : []
  const start = Number(t.start)
  const hasTask = items.some((item) => mdTokenOf(item).task === true)
  return createElement(
    ordered ? 'ol' : 'ul',
    {
      key,
      className: hasTask ? MDR_MD_TASK_LIST_CLASS : MDR_MD_LIST_CLASS,
      start: ordered && Number.isFinite(start) && start > 1 ? start : undefined,
    },
    ...items.map((item, index) => mdItemNode(item, key + '-' + String(index))),
  )
}

/**
 * 代码块：优先交给另一路的 MdrCodeBlock（围栏块渲染器）；未就绪时退化为自有 <pre>。
 * 两条路各自独立可交付，集成后自动接管。
 */
function mdCodeNode(t: Record<string, unknown>, key: string): unknown {
  const lang = mdInfoLang(t.lang)
  const code = mdText(t.text)
  const codeBlock = mdrPartFunction('MdrCodeBlock')
  if (codeBlock !== null) return createElement(codeBlock, { key, lang, code })
  return createElement(
    'pre',
    { key, className: MDR_MD_PRE_CLASS, 'data-mdr-lang': lang === '' ? undefined : lang },
    createElement('code', null, code),
  )
}

/** 内容全是行内 token 的块级类型。 */
const MDR_MD_TEXT_BLOCK_TYPES: readonly string[] = ['paragraph', 'heading', 'text', 'html']

/** 行内内容块 → vdom 节点（html 按字面文本出一段，其余按标签渲染）。 */
function mdTextBlockNode(type: string, t: Record<string, unknown>, key: string): unknown {
  if (type === 'paragraph') {
    return createElement('p', { key, className: 'mdr-md-p' }, ...mdInlineChildren(t.tokens, key))
  }
  if (type === 'heading') {
    return createElement(mdHeadingTag(t.depth), { key, className: 'mdr-md-h' }, ...mdInlineChildren(t.tokens, key))
  }
  if (type === 'html') return createElement('p', { key, className: 'mdr-md-html' }, mdText(t.text))
  return mdInlineChildren(t.tokens, key) // 'text'（tight 列表项）
}

/** 块级 token → vdom 节点（null = 不产出；数组 = 展开多个）。 */
function mdBlockNode(token: unknown, key: string): unknown {
  const t = mdTokenOf(token)
  const type = mdText(t.type)
  if (MDR_MD_TEXT_BLOCK_TYPES.indexOf(type) >= 0) return mdTextBlockNode(type, t, key)
  if (type === 'blockquote') {
    return createElement('blockquote', { key, className: 'mdr-md-quote' }, ...mdBlockChildren(t.tokens, key))
  }
  if (type === 'code') return mdCodeNode(t, key)
  if (type === 'table') return mdTableNode(t, key)
  if (type === 'list') return mdListNode(t, key)
  if (type === 'hr') return createElement('hr', { key, className: 'mdr-md-hr' })
  return null // space / def / 未知 token
}

/** 块级 token 数组 → vdom 子节点数组（展开嵌套数组，保持 key 稳定）。 */
function mdBlockChildren(tokens: unknown, keyBase: string): unknown[] {
  if (!Array.isArray(tokens)) return []
  const out: unknown[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const node = mdBlockNode(tokens[i], keyBase + '-' + String(i))
    if (node === null) continue
    if (Array.isArray(node)) {
      for (const child of node) out.push(child)
    } else {
      out.push(node)
    }
  }
  return out
}
