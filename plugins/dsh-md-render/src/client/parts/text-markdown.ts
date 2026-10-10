// ── text / plaintext / txt / md 围栏块按 markdown 渲染 ────────────────
// 模型常把**实际是 markdown 的内容**（标题 / 列表 / 表格 / 链接）用 ```text 围起来，宿主官方
// CodeBlock 按等宽代码块原样显示就丢掉了排版 —— 官方不接管这类块，所以这是本插件的真增量。
// 做法：块内文本交给**官方 MarkdownText**（经 react-dom/client 挂到我们插入的容器里）渲染，
// 表格 / 公式 / 代码块能力与宿主消息完全一致（同一渲染器），每块独立「查看原文」切换；宿主
// 内容容器保持原位（只按视图隐藏），视图状态写在块属性 data-dsh-md-render-text-view 上。
// 语言判定收敛到 block-lang.ts 的 **resolveFenceLangEx**（不读 React fiber 私有属性）；它带出
// 的 `confirmed` 决定「确证无语言」能否兜底（需求 3）。流式块跳过（scanner 的 [data-streaming]
// 门控 + 属性移除兜底重扫），稳定后再渲染；幂等靠块上的签名（模式 + 长度 + djb2），变化才重建。

/** 触发 markdown 渲染的围栏语言标记（一律渲染，不做内容判定）。 */
const TEXT_FENCE_LANGS: readonly string[] = ['text', 'plaintext', 'txt', 'md', 'markdown']
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

/**
/**
 * 块的围栏语言（**唯一来源** = block-lang.ts 的 resolveFenceLangEx；不读 React fiber）。
 * **必须在这里过滤到本文件接管的语言**：resolveFenceLangEx 会把认得的其它语言原样返回，
 * 不在此收口就会把普通代码块也 markdown 化（回归）。
 */
function textFenceTarget(block: Element): { lang: string; fallback: boolean } {
  const result = resolveFenceLangEx(block)
  if (TEXT_FENCE_LANGS.includes(result.lang)) return { lang: result.lang, fallback: false }
  if (result.lang === '' && result.confirmed) return { lang: '', fallback: true }
  return { lang: '', fallback: false }
}

/** 块源码：官方 <pre> 的文本（官方 display 语义：去掉一个尾部换行）。 */
function textFenceSource(block: Element): string {
  const pre = block.querySelector('pre')
  const text = pre !== null ? (pre.textContent ?? '') : ''
  return text.endsWith('\n') ? text.slice(0, -1) : text
}

/** 取源码与签名素材（非目标语言 / 识别失败 / 空 / 超长 -> null）。 */
function textFenceBody(block: Element): { lang: string; text: string; fallback: boolean } | null {
  const target = textFenceTarget(block)
  if (target.lang === '' && !target.fallback) return null
  const text = textFenceSource(block)
  if (!text.trim() || text.length > MAX_TEXT_FENCE_CHARS) return null
  return { lang: target.lang, text, fallback: target.fallback }
}

/** 块是否仍在流式消息里（祖先带 [data-streaming]，与 scanner 同一口径）。
 *  名字带 TextFence 前缀：本文件与 mermaid-scan 片段共享 factory 作用域，重名会互相覆盖。 */
function isTextFenceStreaming(block: Element): boolean {
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
/** 前置门控：开关关闭 / 官方组件不可用 / 流式块 / 本插件渲染容器内的块（防递归重建）。 */
function textFenceSkip(block: Element): boolean {
  if (!renderOptions.markdown.textFenceMarkdown) return true
  if (!officialMarkdownAvailable()) return true
  if (isTextFenceStreaming(block)) return true
  return !!(block.closest && block.closest('div.' + TEXT_MD_CLASS))
}

/** 幂等判定：容器在且签名未变 → 本轮不必重建。 */
function textMarkdownSettled(block: Element, signature: string): boolean {
  return textMarkdownBody(block) !== null && block.getAttribute(TEXT_SIG_ATTR) === signature
}

/**
 * 应用（幂等）：把 text / plaintext / txt / md 块的内容交给官方渲染器渲染 + 挂切换按钮。
 * 门控 / 非目标语言 / 内容为空或超长 / 签名未变 → 不动 DOM（见 textFenceSkip / textFenceBody）。
 */
function applyTextMarkdown(block: Element): void {
  if (textFenceSkip(block)) return
  const src = textFenceBody(block)
  if (src === null) return
  const signature = (src.fallback ? '~' : src.lang) + ':' + src.text.length + ':' + contextHash(src.text)
  if (textMarkdownSettled(block, signature)) return
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
exports.TEXT_VIEW_ATTR = TEXT_VIEW_ATTR
exports.TEXT_TOGGLE_CLASS = TEXT_TOGGLE_CLASS
exports.textFenceTarget = textFenceTarget
exports.applyTextMarkdown = applyTextMarkdown
exports.scanTextBlocks = scanTextBlocks
