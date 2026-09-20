// ── text / plaintext / txt 围栏块按 markdown 渲染（issue #393）────────
// 宿主与 MarkdownView 都把围栏代码块渲染为
// div.md-code-block > div.dsh-md-render-code-head + pre.tzx-pre >
// code.language-xxx（跨插件 DOM 契约，见 README「公共 API 契约」）。模型
// 有时把**实际是 markdown 的内容**（标题 / 列表 / 表格 / 链接）用 ```text
// 围起来，按等宽代码块原样显示就丢掉了排版——本模块在 DOM 层拦截这类块，
// 把块内文本按 markdown 渲染（复用 #205 的 renderDomMarkdown，即轨迹视图
// 那一套 DOM 渲染管线，表格 / 公式 / 代码块 / 行内能力完全一致），并为
// **每个块**挂独立的「查看原文」切换。
// 口径（需求方已确认，不做内容启发式判定）：语言标记 ∈ {text, plaintext,
// txt} 一律渲染；其他标记（js / ts / json / bash …）与无标记的块**完全
// 不触碰**，仍走过去的高亮代码块形态。
// 形态照 dsh-mermaid-render 的「拦截特定语言代码块 → 换渲染形态 + 视图
// 切换」先例：原文 pre 保留在 DOM（只按视图隐藏，宿主 / 插件的复制按钮与
// 文本读取不受影响），渲染容器与切换按钮追加在块内，视图状态写在块属性
// data-dsh-md-render-text-view 上（每块独立、可来回切）。
// 流式口径沿用本插件既有策略（scanner.ts 的 [data-streaming] 门控 +
// 属性移除触发兜底重扫）：流式中的块跳过，稳定后再渲染——不闪断、不重复
// 挂载；幂等靠块上的签名（语言 + 长度 + djb2 哈希，哈希复用
// context-markdown.ts 的 contextHash——同一 factory 作用域），签名变化
// （流式补写 / 宿主重渲染）才重建，宿主冲掉容器后重扫自愈。

/** 触发 markdown 渲染的围栏语言标记（issue #393：一律渲染，不做内容判定）。 */
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

/** 块的围栏语言：取 code 上的 language-xxx，非 text/plaintext/txt → ''。 */
function textFenceLang(block: Element): string {
  const code = block.querySelector('code')
  const className = code !== null && typeof code.className === 'string' ? code.className : ''
  const m = className.match(/language-([A-Za-z0-9_+-]+)/)
  if (!m) return ''
  const lang = m[1].toLowerCase()
  return TEXT_FENCE_LANGS.includes(lang) ? lang : ''
}

/** 取块的源码与签名素材（非目标语言 / 无 code / 空内容 / 超长 → null）。 */
function textFenceSource(block: Element): { lang: string; text: string } | null {
  const lang = textFenceLang(block)
  const code = lang ? block.querySelector('code') : null
  const text = code !== null ? (code.textContent ?? '') : ''
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
  for (const sel of ['div.' + TEXT_MD_CLASS, 'button.' + TEXT_TOGGLE_CLASS]) {
    const el = block.querySelector(sel)
    if (el && el.parentNode) el.parentNode.removeChild(el)
  }
}

/** 切换视图：写块上的状态属性 + 同步按钮文案与 aria 状态（不动原文 pre）。 */
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
 * 应用（幂等）：把 text / plaintext / txt 块的内容渲染为 markdown + 挂切换按钮。
 * 已在流式中 / 非目标语言 / 内容为空或超长 / 签名未变 → 不动 DOM。
 */
function applyTextMarkdown(block: Element): void {
  if (isStreamingBlock(block)) return
  // 本插件渲染容器内的块不再二次接管（嵌套 ```text 保持代码块形态，避免递归重建）。
  if (block.closest && block.closest('div.' + TEXT_MD_CLASS)) return
  const src = textFenceSource(block)
  if (!src) return
  const signature = src.lang + ':' + src.text.length + ':' + contextHash(src.text)
  if (textMarkdownBody(block) && block.getAttribute(TEXT_SIG_ATTR) === signature) return
  clearTextView(block)
  const body = document.createElement('div')
  body.className = 'tzx-md ' + TEXT_MD_CLASS
  body.appendChild(renderDomMarkdown(src.text))
  block.appendChild(body)
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
exports.applyTextMarkdown = applyTextMarkdown
exports.scanTextBlocks = scanTextBlocks
