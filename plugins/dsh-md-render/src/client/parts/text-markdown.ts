// ── text / plaintext / txt 围栏块按 markdown 渲染 ────────────────────
// 模型有时把**实际是 markdown 的内容**（标题 / 列表 / 表格 / 链接）用
// \`\`\`text 围起来，宿主官方 CodeBlock（ui-primitives）按等宽代码块原样
// 显示就丢掉了排版——官方不接管这类块，所以这是本插件的真增量。
// 本模块在 DOM 层拦截这类块：块内文本交给**官方 MarkdownText**（经
// react-dom/client 挂到我们插入的容器里）渲染，表格 / 公式 / 代码块能力与
// 宿主消息完全一致（同一渲染器），并为**每个块**挂独立的「查看原文」切换。
// 口径（需求方已确认，不做内容启发式判定）：语言标记 ∈ {text, plaintext,
// txt} 一律渲染；其他标记（js / ts / json / bash …）与无标记的块**完全
// 不触碰**。
// 形态照 dsh-mermaid-render 的「拦截特定语言代码块 → 换渲染形态 + 视图
// 切换」先例：宿主内容容器保持原位（只按视图隐藏），渲染容器与切换按钮
// 追加在块内，视图状态写在块属性 data-dsh-md-render-text-view 上（每块
// 独立、可来回切）。
// 语言与源码来源（官方 DOM 契约，ui-primitives/src/markdown/CodeBlock.tsx:
// 187-209）：块是 div.md-code-block；语言不在 DOM class 上（CodeBlock 用
// banner 的 infostring 显示），从 React fiber 的 memoizedProps 读 lang/code
// （与 dsh-md-render 旧版轨迹接管同一手法）；fiber 取不到时回退
// code.language-xxx（官方空围栏分支与旧契约 DOM）→ banner 首个子元素文本。
// 流式口径沿用本插件既有策略（scanner.ts 的 [data-streaming] 门控 +
// 属性移除触发兜底重扫）：流式中的块跳过，稳定后再渲染——不闪断、不重复
// 挂载；幂等靠块上的签名（语言 + 长度 + djb2 哈希，哈希复用
// context-markdown.ts 的 contextHash——同一 factory 作用域），签名变化
// （流式补写 / 宿主重渲染）才重建，宿主冲掉容器后重扫自愈。

/** 触发 markdown 渲染的围栏语言标记（一律渲染，不做内容判定）。 */
const TEXT_FENCE_LANGS: readonly string[] = ['text', 'plaintext', 'txt']
/** 视图状态标记（写在 md-code-block 上，每块独立）：markdown | source。 */
const TEXT_VIEW_ATTR = 'data-dsh-md-render-text-view'
/** 幂等签名标记（写在 md-code-block 上）。 */
const TEXT_SIG_ATTR = 'data-dsh-md-render-text-sig'
/** markdown 渲染容器类名（样式见 styles.ts；tzx-md 为既有契约类）。 */
const TEXT_MD_CLASS = 'dsh-md-render-text-md'
/** 「查看原文 / 查看渲染」切换按钮类名。 */
const TEXT_TOGGLE_CLASS = 'dsh-md-render-text-toggle'
/** 视图 → 按钮文案（按钮文案指向「点击后去哪」）。 */
const TEXT_VIEW_LABELS: Record<string, string> = { markdown: '查看原文', source: '查看渲染' }
/** 单块渲染上限（字符）；超长块保持原代码块，避免单块渲染卡顿。 */
const MAX_TEXT_FENCE_CHARS = 100000
/** 沿 React fiber 向上找 CodeBlock props 的最大跳数（实测 1~3 跳）。 */
const TEXT_FIBER_HOPS = 8

/** React fiber 的最小结构契约（只读 memoizedProps）。 */
interface FiberLike {
  memoizedProps?: Record<string, unknown> | null
  return?: unknown
}

/** 元素上的 React fiber 属性名（React 私有前缀，只读）。 */
function fiberKeys(el: Element): string[] {
  const keys = typeof Object.keys === 'function' ? Object.keys(el) : []
  return keys.filter((key) => key.indexOf('__reactFiber$') === 0)
}

/** 沿一条 fiber 链向上找带 string `code` 的 props（CodeBlock 的 memoizedProps）。 */
function fiberCodeBlockProps(start: unknown): { lang: string; code: string } | null {
  let fiber = start as FiberLike | null
  for (let hops = 0; fiber !== null && fiber !== undefined && hops < TEXT_FIBER_HOPS; hops += 1) {
    const props = fiber.memoizedProps
    if (props !== undefined && props !== null && typeof props.code === 'string') {
      return { lang: typeof props.lang === 'string' ? props.lang.toLowerCase() : '', code: props.code }
    }
    fiber = (fiber.return ?? null) as FiberLike | null
  }
  return null
}

/** 从 React fiber 读官方 CodeBlock 的 { lang, code }（取不到返回 null）。 */
function textFenceFiberProps(block: Element): { lang: string; code: string } | null {
  for (const key of fiberKeys(block)) {
    const found = fiberCodeBlockProps((block as unknown as Record<string, unknown>)[key])
    if (found !== null) return found
  }
  return null
}

/** 官方空围栏 / 旧契约 DOM 的 code.language-xxx（无则 ''）。 */
function textFenceClassLang(block: Element): string {
  const code = block.querySelector('code')
  const className = code !== null && typeof code.className === 'string' ? code.className : ''
  const m = className.match(/language-([A-Za-z0-9_+-]+)/)
  return m ? m[1].toLowerCase() : ''
}

/** banner infostring（官方 CodeBlock 的 data-code-block-banner 首个子元素）。 */
function textFenceBannerLang(block: Element): string {
  const banner = block.querySelector('[data-code-block-banner]')
  const info = banner !== null && banner.firstElementChild ? banner.firstElementChild.textContent : ''
  return String(info ?? '')
    .trim()
    .toLowerCase()
}

/** 块的围栏语言（fiber → code class → banner；非 text/plaintext/txt → ''）。 */
function textFenceLang(block: Element): { lang: string; code: string | null } {
  const fiber = textFenceFiberProps(block)
  const candidates = [fiber === null ? '' : fiber.lang, textFenceClassLang(block), textFenceBannerLang(block)]
  const lang = candidates.find((value) => TEXT_FENCE_LANGS.includes(value)) ?? ''
  return { lang, code: fiber === null ? null : fiber.code }
}

/** 块源码：fiber code（官方 display 语义：去掉一个尾部换行）优先，否则 DOM 文本。 */
function textFenceSource(block: Element, code: string | null): string {
  if (typeof code === 'string') return code.endsWith('\n') ? code.slice(0, -1) : code
  const codeEl = block.querySelector('code')
  return codeEl !== null ? (codeEl.textContent ?? '') : ''
}

/** 取块的源码与签名素材（非目标语言 / 空内容 / 超长 → null）。 */
function textFenceBody(block: Element): { lang: string; text: string } | null {
  const { lang, code } = textFenceLang(block)
  if (lang === '') return null
  const text = textFenceSource(block, code)
  if (!text.trim() || text.length > MAX_TEXT_FENCE_CHARS) return null
  return { lang, text }
}

/** 块是否仍在流式消息里（祖先带 [data-streaming]，与 scanner.ts 同一口径）。 */
function isStreamingBlock(block: Element): boolean {
  return !!(block.closest && block.closest('[data-streaming]'))
}

/** 本插件已渲染的 markdown 容器（幂等判定用）。 */
function textMarkdownBody(block: Element): Element | null {
  return block.querySelector('div.' + TEXT_MD_CLASS)
}

/** 移除上一轮的渲染容器与切换按钮（源码变化 / 重建前清理）。 */
function clearTextView(block: Element): void {
  const body = textMarkdownBody(block)
  if (body !== null) {
    unmountMarkdownIn(body)
    if (body.parentNode) body.parentNode.removeChild(body)
  }
  const btn = block.querySelector('button.' + TEXT_TOGGLE_CLASS)
  if (btn !== null && btn.parentNode) btn.parentNode.removeChild(btn)
}

/** 切换视图：写块上的状态属性 + 同步按钮文案与 aria 状态（不动宿主内容）。 */
function setTextView(block: Element, view: string): void {
  block.setAttribute(TEXT_VIEW_ATTR, view)
  const btn = block.querySelector('button.' + TEXT_TOGGLE_CLASS)
  if (!btn) return
  btn.textContent = TEXT_VIEW_LABELS[view] ?? TEXT_VIEW_LABELS.markdown
  btn.setAttribute('aria-pressed', view === 'source' ? 'true' : 'false')
}

/** 「查看原文 / 查看渲染」按钮：点击只翻转本块的状态属性（每块独立）。 */
function textToggleButton(block: Element, view: string): Element {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = TEXT_TOGGLE_CLASS
  btn.textContent = TEXT_VIEW_LABELS[view] ?? TEXT_VIEW_LABELS.markdown
  btn.setAttribute('aria-pressed', view === 'source' ? 'true' : 'false')
  btn.addEventListener('click', () => {
    setTextView(block, block.getAttribute(TEXT_VIEW_ATTR) === 'source' ? 'markdown' : 'source')
  })
  return btn
}

/**
 * 应用（幂等）：把 text / plaintext / txt 块的内容交给官方渲染器渲染 +
 * 挂切换按钮。开关关闭 / 官方组件不可用 / 流式中 / 非目标语言 / 内容为空
 * 或超长 / 签名未变 → 不动 DOM。
 */
function applyTextMarkdown(block: Element): void {
  if (!renderOptions.textFenceMarkdown) return
  if (!officialMarkdownAvailable()) return
  if (isStreamingBlock(block)) return
  // 本插件渲染容器内的块不再二次接管（嵌套 \`\`\`text 保持代码块形态，避免递归重建）。
  if (block.closest && block.closest('div.' + TEXT_MD_CLASS)) return
  const src = textFenceBody(block)
  if (src === null) return
  const signature = src.lang + ':' + src.text.length + ':' + contextHash(src.text)
  if (textMarkdownBody(block) !== null && block.getAttribute(TEXT_SIG_ATTR) === signature) return
  clearTextView(block)
  const body = document.createElement('div')
  body.className = 'tzx-md ' + TEXT_MD_CLASS
  block.appendChild(body)
  if (!renderMarkdownInto(body, src.text)) {
    // 官方组件中途不可用：撤掉半成品，保持宿主原样（真降级）。
    block.removeChild(body)
    return
  }
  block.appendChild(textToggleButton(block, 'markdown'))
  block.setAttribute(TEXT_VIEW_ATTR, 'markdown')
  block.setAttribute(TEXT_SIG_ATTR, signature)
}

/** 扫描 root（自身 / 后代）内的围栏代码块，处理其中的 text/plaintext/txt 块。 */
function scanTextBlocks(root: Element): void {
  if (!root || typeof root.querySelectorAll !== 'function') return
  if (typeof root.matches === 'function' && root.matches('div.md-code-block')) applyTextMarkdown(root)
  for (const block of root.querySelectorAll('div.md-code-block')) applyTextMarkdown(block)
}

exports.TEXT_FENCE_LANGS = TEXT_FENCE_LANGS
exports.MAX_TEXT_FENCE_CHARS = MAX_TEXT_FENCE_CHARS
exports.textFenceLang = textFenceLang
exports.applyTextMarkdown = applyTextMarkdown
exports.scanTextBlocks = scanTextBlocks
