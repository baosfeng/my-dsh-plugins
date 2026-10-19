// ── 自研 markdown 渲染（marked 词法树 → 自有 vdom）──────────────────────
// 口径（最高优先级）：markdown 内容**全部由本插件自己的渲染器产出**，不调用宿主
// MarkdownText；自有类名 `mdr-*`，样式在 styles-markdown.ts（只在 .mdr-md 作用域内）。
//
// 安全口径（与宿主 MarkdownText 逐条对齐）：
//   · raw HTML 一律当**字面文本**（html token → 文本节点，由 React 转义），
//     模型输出永远不会被当 HTML 执行；
//   · 链接只放行 http / https / mailto 与同源相对路径（`/…`，不含 `//host`）；
//   · 图片只放行 http / https 与同源相对路径，其余渲染 alt 文本；
//   · 全程没有 innerHTML / dangerouslySetInnerHTML。
//
// 解析层懒加载（assets 里的 marked，不进 bundle）：未就绪 → markdownNodes 返回 null，
// 调用方保持宿主官方形态；就绪通知后的重扫再接管（真降级，绝不丢内容）。
// 表格进 lexer 之前先过 table-normalize 的 normalizeTables（非标准分隔行容错）。
//
// 脚本模式片段（无 import/export）：createElement / ensureRenderAsset / MARKED_ASSET /
// normalizeTables 都是同一 factory 作用域里的全局；跨路组件（MdrCodeBlock）走 exports
// 运行时探测，未就绪时退化为自有 <pre>，两条路各自独立可交付。

/** markdown 内容根类名（styles-markdown.ts 的作用域）。 */
const MDR_MD_ROOT_CLASS = 'mdr-root mdr-md'
/** 解析异常时的原文兜底类名（内容一字不丢）。 */
const MDR_MD_PLAIN_CLASS = 'mdr-md-plain'
/** 行内代码 / 图片 / 链接降级 / 图片降级类名。 */
const MDR_MD_CODE_CLASS = 'mdr-md-code'
const MDR_MD_IMG_CLASS = 'mdr-md-img'
const MDR_MD_IMG_ALT_CLASS = 'mdr-md-img-alt'
const MDR_MD_LINK_PLAIN_CLASS = 'mdr-md-link-plain'
/** 代码块兜底（跨路 MdrCodeBlock 未就绪时）。 */
const MDR_MD_PRE_CLASS = 'mdr-md-pre'
/** 表格 / 列表 / 任务项类名。 */
const MDR_MD_TABLE_WRAP_CLASS = 'mdr-scroll mdr-md-table-wrap'
const MDR_MD_TABLE_CLASS = 'mdr-md-table'
const MDR_MD_LIST_CLASS = 'mdr-md-list'
const MDR_MD_TASK_LIST_CLASS = 'mdr-md-list mdr-md-task-list'
const MDR_MD_TASK_ITEM_CLASS = 'mdr-md-task-item'
const MDR_MD_CHECK_CLASS = 'mdr-md-check'
/** 单元格对齐 class（不用行内 style / align 属性）。 */
const MDR_MD_ALIGN_CLASSES: Record<string, string> = {
  left: 'mdr-md-cell-left',
  center: 'mdr-md-cell-center',
  right: 'mdr-md-cell-right',
}
/** 链接放行的协议。 */
const MDR_MD_LINK_PROTOCOLS: readonly string[] = ['http:', 'https:', 'mailto:']
/** info string → 语言 token（`{js}` / `.js` 也认，取首个空白分隔 token）。 */
const MDR_MD_LANG_RE = /^\{?\.?([A-Za-z0-9_+#-]*)\}?$/
/** 语义强调 token → 同名 HTML 标签。 */
const MDR_MD_EMPHASIS_TAGS: Record<string, string> = { strong: 'strong', em: 'em', del: 'del' }

/** 任意值 → 文本（null / undefined → 空串）。 */
function mdText(value: unknown): string {
  if (typeof value === 'string') return value
  return value === null || value === undefined ? '' : String(value)
}

/** 归一化后的对象形态 token（非对象 → 空对象）。 */
function mdTokenOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** info string → 小写语言 token（无语言 → 空串）。 */
function mdInfoLang(info: unknown): string {
  const token = mdText(info).trim().split(/\s+/)[0] ?? ''
  const matched = MDR_MD_LANG_RE.exec(token)
  return (matched === null ? token : matched[1]).toLowerCase()
}

/** 标题层级收敛到 h1–h6（marked 可能给出 7+ 的畸形层级）。 */
function mdHeadingTag(depth: unknown): string {
  const value = Number(depth)
  const level = Number.isFinite(value) ? Math.min(6, Math.max(1, Math.trunc(value))) : 1
  return 'h' + String(level)
}

/** 表格列对齐的追加 class（未知 / 缺省 → 空串）。 */
function mdAlignClass(align: unknown): string {
  const name = mdText(align)
  return Object.prototype.hasOwnProperty.call(MDR_MD_ALIGN_CLASSES, name) ? ' ' + MDR_MD_ALIGN_CLASSES[name] : ''
}

/** 安全链接目标：http / https / mailto 或同源相对路径；其余返回空串。 */
function mdSafeHref(url: unknown): string {
  const value = mdText(url)
  if (value === '') return ''
  try {
    const protocol = new URL(value).protocol
    return MDR_MD_LINK_PROTOCOLS.indexOf(protocol) >= 0 ? value : ''
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

/** 从 bundle 的 exports 面探测其它路的组件（未就绪 → null，绝不抛错）。 */
function mdrPartFunction(name: string): ((props: unknown) => unknown) | null {
  if (typeof exports !== 'object' || exports === null) return null
  const value = exports[name]
  return typeof value === 'function' ? (value as (props: unknown) => unknown) : null
}

/** 图片点开放大（灯箱由另一路提供；未就绪时静默降级为不可放大）。 */
function mdOpenImage(src: string, alt: string): void {
  const open = mdrPartFunction('openImageLightbox')
  if (open === null) return
  ;(open as unknown as (src: string, alt: string) => void)(src, alt)
}

/** 行内 token 数组 → vdom 子节点。 */
function mdInlineChildren(tokens: unknown, keyBase: string): unknown[] {
  if (!Array.isArray(tokens)) return []
  const out: unknown[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    out.push(mdInlineNode(tokens[i], keyBase + '-' + String(i)))
  }
  return out
}

/** 行内 token → vdom 节点（未知 token 原样出文本，绝不丢内容）。 */
function mdInlineNode(token: unknown, key: string): unknown {
  const t = mdTokenOf(token)
  const type = mdText(t.type)
  if (Object.prototype.hasOwnProperty.call(MDR_MD_EMPHASIS_TAGS, type)) {
    return createElement(MDR_MD_EMPHASIS_TAGS[type], { key }, ...mdInlineChildren(t.tokens, key))
  }
  if (type === 'codespan') {
    // 与宿主一致：行内代码里的换行按空格显示。
    return createElement('code', { key, className: MDR_MD_CODE_CLASS }, mdText(t.text).replace(/\r?\n|\r/g, ' '))
  }
  if (type === 'br') return createElement('br', { key })
  if (type === 'link') return mdLinkNode(t, key)
  if (type === 'image') return mdImageNode(t, key)
  // text / escape / html（raw HTML 当字面文本）/ 未知 token
  return mdText(t.text)
}

/** 链接：目标不安全 → 退化为纯文本（不产生 javascript: / data: 目标）。 */
function mdLinkNode(t: Record<string, unknown>, key: string): unknown {
  const children = mdInlineChildren(t.tokens, key)
  const href = mdSafeHref(t.href)
  if (href === '') return createElement('span', { key, className: MDR_MD_LINK_PLAIN_CLASS }, ...children)
  const title = mdText(t.title)
  return createElement(
    'a',
    {
      key,
      className: 'mdr-md-link',
      href,
      target: '_blank',
      rel: 'noreferrer noopener',
      title: title === '' ? undefined : title,
    },
    ...children,
  )
}

/** 键盘事件最小契约（真实 KeyboardEvent 满足）。 */
interface MdrMdKeyEvent {
  key?: unknown
  preventDefault?: () => void
}

/** 放大键：Enter / 空格与点击同路（焦点环真能用，不做死的焦点环）。 */
function mdImageZoomKey(src: string, alt: string, event: MdrMdKeyEvent): void {
  const key = String(event.key ?? '')
  if (key !== 'Enter' && key !== ' ') return
  if (typeof event.preventDefault === 'function') event.preventDefault()
  mdOpenImage(src, alt)
}

/** 图片：地址不安全 → alt 文本；安全 → 可点击放大的图片。 */
function mdImageNode(t: Record<string, unknown>, key: string): unknown {
  const alt = mdText(t.text)
  const src = mdSafeImageSrc(t.href)
  if (src === '') return createElement('span', { key, className: MDR_MD_IMG_ALT_CLASS }, alt)
  const title = mdText(t.title)
  return createElement('img', {
    key,
    className: MDR_MD_IMG_CLASS,
    src,
    alt,
    title: title === '' ? undefined : title,
    loading: 'lazy',
    tabIndex: 0,
    'data-mdr-zoom': 'true',
    onClick: () => mdOpenImage(src, alt),
    onKeyDown: (event: MdrMdKeyEvent) => mdImageZoomKey(src, alt, event),
  })
}

/**
 * markdown 文本 → vdom 子节点数组（调用方放进 `.mdr-md` 容器）。
 * @returns null = 解析层还没就绪（调用方保持宿主官方形态，等就绪重扫）；
 *          数组 = 渲染结果（解析异常时退化为原文 <pre>，内容一字不丢）。
 */
function markdownNodes(text: unknown): unknown[] | null {
  const source = mdText(text)
  const marked = ensureRenderAsset(MARKED_ASSET)
  if (marked === null) return null
  const lexer = marked.lexer
  if (typeof lexer !== 'function') return null
  let tokens: unknown = null
  try {
    // 非标准表格容错：GFM 不认的分隔行先规范化，再进解析器。
    tokens = (lexer as (src: string) => unknown).call(marked, normalizeTables(source))
  } catch (_e) {
    tokens = null
  }
  if (!Array.isArray(tokens)) return [createElement('pre', { key: 'md-plain', className: MDR_MD_PLAIN_CLASS }, source)]
  return mdBlockChildren(tokens, 'md')
}

/**
 * markdown 内容组件：`{ text, streaming }` → div.mdr-root.mdr-md。
 * streaming=true 时根上加 `data-streaming="true"` + `.is-streaming`（宿主 DOM 契约 [data-streaming]）。
 */
function MdrMarkdown(props: { text: string; streaming?: boolean }): unknown {
  const text = mdText(props === null || props === undefined ? '' : props.text)
  const streaming = props !== null && props !== undefined && props.streaming === true
  const nodes = markdownNodes(text)
  return createElement(
    'div',
    {
      className: MDR_MD_ROOT_CLASS + (streaming ? ' is-streaming' : ''),
      'data-mdr-root': 'true',
      'data-streaming': streaming ? 'true' : undefined,
    },
    ...(nodes === null ? [createElement('pre', { key: 'md-fallback', className: MDR_MD_PLAIN_CLASS }, text)] : nodes),
  )
}

exports.MdrMarkdown = MdrMarkdown
exports.markdownNodes = markdownNodes
exports.mdInfoLang = mdInfoLang
exports.mdSafeHref = mdSafeHref
exports.mdSafeImageSrc = mdSafeImageSrc
