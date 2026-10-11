// ── 自研 markdown 渲染（marked 解析 → React vdom）───────────────────────
// 用户口径（最高优先级）：「markdown 需要全部替换为我们自己的渲染」。本模块**不调用
// 官方 MarkdownText**：markdown → marked 词法树 → 本插件自己的 React 元素（自有 class，
// 只在 .tzx-md 作用域内由自有 CSS 上色，样式全部取 --dsw-* 变量）。
//
// 安全口径（与官方 MarkdownText 逐条对齐）：
//   · **raw HTML 一律当字面文本**（marked 的 html token 渲染成文本节点，React 会转义）——
//     模型输出永远不会被当 HTML 执行；
//   · 链接只放行 http / https / mailto 与同源相对路径（`/…`，不含 `//host`）；
//   · 图片只放行 http / https 与同源相对路径；其余渲染 alt 文本；
//   · 全程没有 innerHTML / dangerouslySetInnerHTML。
//
// 解析层懒加载（assets/marked-*.umd.js，不进 bundle）：marked 未就绪 → 返回 null，
// 调用方保持宿主官方形态；就绪通知后的重扫再接管（真降级，绝不丢内容）。
// 表格容错沿用既有 normalizeTables（GFM 不认的两种分隔行写法先规范化）。
// 数学公式不做（用户明确：暂不做）。

/** markdown 文本内的行内代码类名。 */
const MD_CODE_CLASS = 'dsh-md-render-md-code'
/** 解析异常时的原文兜底容器类名（内容一字不丢）。 */
const MD_PLAIN_CLASS = 'dsh-md-render-md-plain'
/** 表格单元格对齐 class（不用行内 style / 不用 align 属性）。 */
const MD_ALIGN_CLASSES: Record<string, string> = {
  left: 'dsh-md-render-md-left',
  center: 'dsh-md-render-md-center',
  right: 'dsh-md-render-md-right',
}
/** 链接放行的协议（与官方 sanitizeUrl 同口径）。 */
const MD_LINK_PROTOCOLS: readonly string[] = ['http:', 'https:', 'mailto:']
/** info string → 语言 token（`{js}` / `.js` 花括号与点前缀写法也认，取首个空白分隔 token）。 */
const MD_LANG_TOKEN_RE = /^\{?\.?([A-Za-z0-9_+#-]*)\}?$/

/** 任意值 → markdown 文本（null / undefined → 空串）。 */
function mdText(value: unknown): string {
  if (typeof value === 'string') return value
  return value === null || value === undefined ? '' : String(value)
}

/** info string → 小写语言 token（无语言 → 空串）。 */
function mdInfoLang(info: unknown): string {
  const token = mdText(info).trim().split(/\s+/)[0] ?? ''
  const matched = MD_LANG_TOKEN_RE.exec(token)
  return (matched === null ? token : matched[1]).toLowerCase()
}

/** 归一化后的对象形态 token（非对象 → 空对象）。 */
function mdToken(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** 标题层级收敛到 h1–h6（marked 可能给出 7+ 的畸形层级）。 */
function mdHeadingTag(depth: unknown): string {
  const value = Number(depth)
  const level = Number.isFinite(value) ? Math.min(6, Math.max(1, Math.trunc(value))) : 1
  return 'h' + String(level)
}

/** 表格列对齐 class 后缀（未知 / 缺省 → 空）。 */
function mdAlignClass(align: unknown): string {
  const name = mdText(align)
  return Object.prototype.hasOwnProperty.call(MD_ALIGN_CLASSES, name) ? ' ' + MD_ALIGN_CLASSES[name] : ''
}

/** 安全链接目标：http / https / mailto 或同源相对路径；其余返回空串（渲染为纯文本）。 */
function mdSafeHref(url: unknown): string {
  const value = mdText(url)
  if (value === '') return ''
  try {
    const protocol = new URL(value).protocol
    return MD_LINK_PROTOCOLS.indexOf(protocol) >= 0 ? value : ''
  } catch (_e) {
    return value.charAt(0) === '/' && value.charAt(1) !== '/' ? value : ''
  }
}

/** 安全图片地址：http / https 或同源相对路径；其余返回空串（渲染 alt 文本）。 */
function mdSafeImageSrc(url: unknown): string {
  const value = mdText(url)
  if (value === '') return ''
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:' ? value : ''
  } catch (_e) {
    return value.charAt(0) === '/' && value.charAt(1) !== '/' ? value : ''
  }
}

/** 行内 token 数组 → vdom 子节点。 */
function mdInlineChildren(tokens: unknown, keyBase: string): unknown[] {
  if (!Array.isArray(tokens)) return []
  const out: unknown[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const node = mdInlineNode(tokens[i], keyBase + '-' + i)
    if (node !== null) out.push(node)
  }
  return out
}

/** 语义强调类行内 token（strong / em / del → 同名 HTML 标签）。 */
const MD_EMPHASIS_TAGS: Record<string, string> = { strong: 'strong', em: 'em', del: 'del' }

/** 行内 token → vdom 节点（未知 token 原样出文本，绝不丢内容）。 */
function mdInlineNode(token: unknown, key: string): unknown {
  const t = mdToken(token)
  const type = mdText(t.type)
  if (Object.prototype.hasOwnProperty.call(MD_EMPHASIS_TAGS, type)) {
    return createElement(MD_EMPHASIS_TAGS[type], { key }, ...mdInlineChildren(t.tokens, key))
  }
  if (type === 'codespan') {
    // 与官方一致：行内代码里的换行按空格显示。
    return createElement('code', { key, className: MD_CODE_CLASS }, mdText(t.text).replace(/\r?\n|\r/g, ' '))
  }
  if (type === 'br') return createElement('br', { key })
  if (type === 'link') return mdLinkNode(t, key)
  if (type === 'image') return mdImageNode(t, key)
  // text / escape / html（与官方一致：raw HTML 当字面文本，React 负责转义）/ 未知 token
  return mdText(t.text)
}

/** 链接：目标不安全 → 退化为纯文本（不产生可点击的 javascript: / data: 目标）。 */
function mdLinkNode(t: Record<string, unknown>, key: string): unknown {
  const children = mdInlineChildren(t.tokens, key)
  const href = mdSafeHref(t.href)
  if (href === '') return createElement('span', { key, className: 'dsh-md-render-md-link-plain' }, ...children)
  const title = mdText(t.title)
  return createElement(
    'a',
    {
      key,
      className: 'dsh-md-render-md-link',
      href,
      target: '_blank',
      rel: 'noreferrer noopener',
      title: title === '' ? undefined : title,
    },
    ...children,
  )
}

/** 图片：地址不安全 → 渲染 alt 文本（不加载任何来路不明的资源）。 */
function mdImageNode(t: Record<string, unknown>, key: string): unknown {
  const alt = mdText(t.text)
  const src = mdSafeImageSrc(t.href)
  if (src === '') return createElement('span', { key, className: 'dsh-md-render-md-img-alt' }, alt)
  const title = mdText(t.title)
  return createElement('img', {
    key,
    className: 'dsh-md-render-md-img',
    src,
    alt,
    title: title === '' ? undefined : title,
    loading: 'lazy',
  })
}

/** 表格单元格（th / td；对齐走自有 class）。 */
function mdCellNode(cell: unknown, key: string, tag: string, align: unknown): unknown {
  return createElement(
    tag,
    { key, className: 'dsh-md-render-md-cell' + mdAlignClass(align) },
    ...mdInlineChildren(mdToken(cell).tokens, key),
  )
}

/** 表格（外层包一个横向滚动容器，宽表格不撑破消息区）。 */
function mdTableNode(t: Record<string, unknown>, key: string): unknown {
  const header = Array.isArray(t.header) ? t.header : []
  const rows = Array.isArray(t.rows) ? t.rows : []
  const aligns = Array.isArray(t.align) ? t.align : []
  const headRow = createElement(
    'tr',
    { key: key + '-head' },
    ...header.map((cell, index) => mdCellNode(cell, key + '-h-' + index, 'th', aligns[index])),
  )
  const bodyRows = rows.map((row, rowIndex) => {
    const cells = Array.isArray(row) ? row : []
    return createElement(
      'tr',
      { key: key + '-r-' + rowIndex },
      ...cells.map((cell, index) => mdCellNode(cell, key + '-r-' + rowIndex + '-' + index, 'td', aligns[index])),
    )
  })
  return createElement(
    'div',
    { key, className: 'dsh-md-render-md-table-wrap' },
    createElement(
      'table',
      { className: 'dsh-md-render-md-table' },
      createElement('thead', null, headRow),
      createElement('tbody', null, ...bodyRows),
    ),
  )
}

/**
 * 列表项内容：tight 列表的 `text` token 直接出行内节点，其余（段落 / 嵌套列表 / 代码块…）
 * 按块渲染 —— 与 marked 的 tight / loose 语义一致，且不额外包一层 `<p>`。
 */
function mdItemChildren(item: Record<string, unknown>, keyBase: string): unknown[] {
  const tokens = Array.isArray(item.tokens) ? item.tokens : []
  const out: unknown[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const key = keyBase + '-i-' + i
    const t = mdToken(tokens[i])
    if (t.type === 'text') {
      if (Array.isArray(t.tokens)) {
        for (const node of mdInlineChildren(t.tokens, key)) out.push(node)
      } else {
        out.push(mdText(t.text))
      }
      continue
    }
    const node = mdBlockNode(tokens[i], key)
    if (node === null) continue
    if (Array.isArray(node)) {
      for (const item2 of node) out.push(item2)
    } else {
      out.push(node)
    }
  }
  return out
}

/** 列表项（任务列表渲染成只读复选框）。 */
function mdItemNode(item: unknown, key: string): unknown {
  const t = mdToken(item)
  const children = mdItemChildren(t, key)
  if (t.task !== true) return createElement('li', { key, className: 'dsh-md-render-md-li' }, ...children)
  const box = createElement('input', {
    key: key + '-task',
    className: 'dsh-md-render-md-task',
    type: 'checkbox',
    checked: t.checked === true,
    disabled: true,
    readOnly: true,
  })
  return createElement('li', { key, className: 'dsh-md-render-md-li dsh-md-render-md-task-item' }, box, ...children)
}

/** 列表（有序列表按 marked 的 start 还原起始序号）。 */
function mdListNode(t: Record<string, unknown>, key: string): unknown {
  const ordered = t.ordered === true
  const items = Array.isArray(t.items) ? t.items : []
  const start = Number(t.start)
  const startAttr = ordered && Number.isFinite(start) && start > 1 ? start : undefined
  return createElement(
    ordered ? 'ol' : 'ul',
    { key, className: 'dsh-md-render-md-list', start: startAttr },
    ...items.map((item, index) => mdItemNode(item, key + '-' + index)),
  )
}

/** 围栏代码块（markdown 内部的代码块：同样走**自研**代码块渲染器）。 */
function mdCodeNode(t: Record<string, unknown>, key: string): unknown {
  return createElement(CodeBlockView, { key, lang: mdInfoLang(t.lang), code: mdText(t.text) })
}

/** 内容全是行内 token 的块级类型（paragraph / heading / text / html）。 */
const MD_TEXT_BLOCK_TYPES: readonly string[] = ['paragraph', 'heading', 'text', 'html']

/** 行内内容块 → vdom 节点（html 按字面文本出一段，其余按标签渲染）。 */
function mdTextBlockNode(type: string, t: Record<string, unknown>, key: string): unknown {
  if (type === 'paragraph') {
    return createElement('p', { key, className: 'dsh-md-render-md-p' }, ...mdInlineChildren(t.tokens, key))
  }
  if (type === 'heading') {
    return createElement(
      mdHeadingTag(t.depth),
      { key, className: 'dsh-md-render-md-h' },
      ...mdInlineChildren(t.tokens, key),
    )
  }
  if (type === 'html') return createElement('p', { key, className: 'dsh-md-render-md-html' }, mdText(t.text))
  return mdInlineChildren(t.tokens, key) // 'text'（tight 列表项）
}

/** 块级 token → vdom 节点（null = 不产出；数组 = 展开多个）。 */
function mdBlockNode(token: unknown, key: string): unknown {
  const t = mdToken(token)
  const type = mdText(t.type)
  if (MD_TEXT_BLOCK_TYPES.indexOf(type) >= 0) return mdTextBlockNode(type, t, key)
  if (type === 'blockquote') {
    return createElement('blockquote', { key, className: 'dsh-md-render-md-quote' }, ...mdBlockChildren(t.tokens, key))
  }
  if (type === 'code') return mdCodeNode(t, key)
  if (type === 'table') return mdTableNode(t, key)
  if (type === 'list') return mdListNode(t, key)
  if (type === 'hr') return createElement('hr', { key, className: 'dsh-md-render-md-hr' })
  return null // space / def / 未知 token
}

/** 块级 token 数组 → vdom 子节点数组（展开嵌套数组，保持 key 稳定）。 */
function mdBlockChildren(tokens: unknown, keyBase: string): unknown[] {
  if (!Array.isArray(tokens)) return []
  const out: unknown[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const node = mdBlockNode(tokens[i], keyBase + '-' + i)
    if (node === null) continue
    if (Array.isArray(node)) {
      for (const item of node) out.push(item)
    } else {
      out.push(node)
    }
  }
  return out
}

/**
 * markdown 文本 → vdom 子节点数组（调用方放进 `.tzx-md` 容器）。
 * @returns null = marked 还没就绪（调用方保持宿主官方形态，等就绪重扫）；
 *          数组 = 渲染结果（解析异常时退化为原文 `<pre>`，内容一字不丢）。
 */
function markdownNodes(text: unknown): unknown[] | null {
  const source = mdText(text)
  const marked = ensureRenderAsset(MARKED_ASSET)
  if (marked === null) return null
  const lexer = marked.lexer
  if (typeof lexer !== 'function') return null
  let tokens: unknown = null
  try {
    // 表格容错沿用既有实现：GFM 不认的两种分隔行写法先规范化再进解析器。
    tokens = (lexer as (src: string) => unknown).call(marked, normalizeTables(source))
  } catch (_e) {
    tokens = null
  }
  if (!Array.isArray(tokens)) return [createElement('pre', { key: 'md-plain', className: MD_PLAIN_CLASS }, source)]
  return mdBlockChildren(tokens, 'md')
}

exports.MD_CODE_CLASS = MD_CODE_CLASS
exports.MD_PLAIN_CLASS = MD_PLAIN_CLASS
exports.mdInfoLang = mdInfoLang
exports.mdSafeHref = mdSafeHref
exports.mdSafeImageSrc = mdSafeImageSrc
exports.markdownNodes = markdownNodes
