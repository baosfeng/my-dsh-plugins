// ── 围栏块接管：markdown / 代码两路，全部由**自研渲染器**产出 ──────────────
// 用户口径（最高优先级）：「markdown 需要全部替换为我们自己的渲染」「代码渲染使用我们
// 自己的，不要使用原生的」。**任何语言的围栏块都由本插件接管**：
//   · mermaid / mmd     → 图表卡片（mermaid-scan.ts，语言集合不重叠）；
//   · text 家族 / 确证无语言 → 自研 markdown 渲染（own-markdown.ts）；
//   · 其余语言（js / ts / json / bash / python …）→ 自研代码块渲染（own-code.ts），
//     banner 显示**围栏语言的真实 token**（不是官方那个本地化标签「代码块」）。
//
// 官方节点一律**不删不改**：只在块内追加自有容器，靠自有 CSS 在接管视图下隐藏官方
// banner 与内容（切回「源码」时规则不再匹配，官方原样恢复）。视图状态写在块属性
// data-dsh-md-render-text-view（markdown | code | source）上，幂等靠签名（kind + 语言 +
// 长度 + 内容哈希 + **渲染库就绪版本**：marked / hljs 到位后签名变化，重建一次把
// 纯文本换成渲染态 / 高亮态）。流式块跳过（[data-streaming] 门控），稳定后再渲染。

/** 触发自研 markdown 渲染的语言标记（一律渲染，不做内容判定）。 */
const TEXT_FENCE_LANGS: readonly string[] = ['text', 'plaintext', 'txt', 'md', 'markdown']
/** 视图状态标记（写在 md-code-block 上，每块独立）：markdown | code | source。 */
const BLOCK_VIEW_ATTR = 'data-dsh-md-render-text-view'
/** 幂等签名标记（写在 md-code-block 上）。 */
const BLOCK_SIG_ATTR = 'data-dsh-md-render-text-sig'
/** markdown 渲染容器类名（tzx-md 为既有契约类，样式作用域见 styles.ts）。 */
const BLOCK_MD_CLASS = 'dsh-md-render-text-md'
/** 「查看原文 / 查看渲染」切换按钮类名（仅 markdown 视图需要）。 */
const BLOCK_TOGGLE_CLASS = 'dsh-md-render-text-toggle'
/** 视图 → 按钮文案（文案指向「点击后去哪」）。 */
const BLOCK_VIEW_LABELS: Record<string, string> = { markdown: '查看原文', source: '查看渲染' }
/** markdown 单块渲染上限（字符）：超长块保持官方代码块，避免单块渲染卡顿。 */
const MAX_TEXT_FENCE_CHARS = 100000
/** 代码单块渲染上限（字符）：超出同样保持官方形态（与语言索引的上限同口径）。 */
const MAX_CODE_FENCE_CHARS = 200000

/** 接管类型（none = 本模块不动这个块）。 */
interface FenceKind {
  kind: 'markdown' | 'code' | 'mermaid' | 'none'
  lang: string
}

/**
 * 块的接管类型（**唯一入口**，手动覆盖优先级最高）：
 *  ⓪ 「渲染为…」人工覆盖（lang-switch.ts 写入）：source → 不接管（官方原样）；
 *     markdown → 强制 markdown；mermaid → 交给 mermaid-scan；
 *  ① mermaid / mmd → 交给 mermaid-scan；
 *  ② text 家族，或「确证无语言」→ 自研 markdown；
 *  ③ 其余（js / json / bash / 任意语言，含「识别失败」）→ 自研代码块。
 * 识别失败也接管是用户口径（「所有围栏块都由插件接管」）：语言位留空，**绝不编造语言名**。
 */
function fenceKindOf(block: Element): FenceKind {
  const forced = fenceForceOf(block)
  if (forced === 'source') return { kind: 'none', lang: '' }
  if (forced === 'markdown') return { kind: 'markdown', lang: '' }
  if (forced === 'mermaid') return { kind: 'mermaid', lang: 'mermaid' }
  const resolved = resolveFenceLangEx(block)
  const lang = resolved.lang
  if (MERMAID_FENCE_LANGS.includes(lang)) return { kind: 'mermaid', lang }
  if (TEXT_FENCE_LANGS.includes(lang)) return { kind: 'markdown', lang }
  if (lang === '') return { kind: resolved.confirmed ? 'markdown' : 'code', lang: '' }
  return { kind: 'code', lang }
}

/** 块源码：官方 <pre> 的文本（官方 display 语义：去掉一个尾部换行）。 */
function fenceSource(block: Element): string {
  const pre = block.querySelector('pre')
  const text = pre !== null ? (pre.textContent ?? '') : ''
  return text.endsWith('\n') ? text.slice(0, -1) : text
}

/** 本模块已渲染的容器（幂等判定用）。 */
function fenceBodyOf(block: Element): Element | null {
  return block.querySelector('div.' + BLOCK_MD_CLASS + ', div.' + CODE_HOST_CLASS)
}

/** 块是否仍在流式消息里（祖先带 [data-streaming]，与 scanner 同一口径）。 */
function isFenceStreaming(block: Element): boolean {
  return !!(block.closest && block.closest('[data-streaming]'))
}

/**
 * 前置门控（**在任何语言判定之前**）：开关关闭 / react-dom 不可用 / 流式块 /
 * 本插件渲染容器内的块（防递归重建）。
 *
 * 顺序很重要：语言判定会向 host 半发索引查询（未命中还有界重试），而流式补写中的块
 * 内容每批都在变（哈希必然落空）—— 先门控再判定，流式块与开关关闭的块**一次请求都不发**。
 */
function fencePreSkip(block: Element): boolean {
  if (!renderOptions.markdown.textFenceMarkdown) return true
  if (!domRootAvailable()) return true
  if (isFenceStreaming(block)) return true
  return isInsideRenderedMarkdown(block)
}

/** 内容长度上限（markdown 与代码两档）。 */
function fenceMaxChars(kind: string): number {
  return kind === 'markdown' ? MAX_TEXT_FENCE_CHARS : MAX_CODE_FENCE_CHARS
}

/** 移除上一轮的渲染容器与切换按钮（源码变化 / 重建前清理）。 */
function clearFenceView(block: Element): void {
  const body = fenceBodyOf(block)
  if (body !== null) {
    unmountMarkdownIn(body)
    if (body.parentNode) body.parentNode.removeChild(body)
  }
  const btn = block.querySelector('button.' + BLOCK_TOGGLE_CLASS)
  if (btn !== null && btn.parentNode) btn.parentNode.removeChild(btn)
}

/** 切换视图：写块上的状态属性 + 同步按钮文案与 aria 状态（不动宿主内容）。 */
function setFenceView(block: Element, view: string): void {
  block.setAttribute(BLOCK_VIEW_ATTR, view)
  const btn = block.querySelector('button.' + BLOCK_TOGGLE_CLASS)
  if (!btn) return
  btn.textContent = BLOCK_VIEW_LABELS[view] ?? BLOCK_VIEW_LABELS.markdown
  btn.setAttribute('aria-pressed', view === 'source' ? 'true' : 'false')
}

/** 「查看原文 / 查看渲染」按钮：点击只翻转本块的状态属性（每块独立）。 */
function fenceToggleButton(block: Element, view: string): Element {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = BLOCK_TOGGLE_CLASS
  btn.textContent = BLOCK_VIEW_LABELS[view] ?? BLOCK_VIEW_LABELS.markdown
  btn.setAttribute('aria-pressed', view === 'source' ? 'true' : 'false')
  btn.addEventListener('click', () => {
    setFenceView(block, block.getAttribute(BLOCK_VIEW_ATTR) === 'source' ? 'markdown' : 'source')
  })
  return btn
}

/** 幂等签名（含渲染库就绪版本：库到位后重建一次）。 */
function fenceSignature(kind: string, lang: string, source: string): string {
  return kind + ':' + lang + ':' + String(source.length) + ':' + contextHash(source) + ':' + String(renderAssetsReady())
}

/** 幂等判定：容器在且签名未变 → 本轮不必重建。 */
function fenceSettled(block: Element, signature: string): boolean {
  return fenceBodyOf(block) !== null && block.getAttribute(BLOCK_SIG_ATTR) === signature
}

/** 建自有容器并把内容交给**自研渲染器**；渲染库未就绪 / 不可用 → null（保持宿主原样）。 */
function buildFenceBody(kind: string, lang: string, source: string): Element | null {
  const body = document.createElement('div')
  if (kind === 'markdown') {
    body.className = 'tzx-md ' + BLOCK_MD_CLASS
    return renderMarkdownInto(body, source) ? body : null
  }
  body.className = CODE_HOST_CLASS
  return renderNodeInto(body, createElement(CodeBlockView, { lang, code: source })) ? body : null
}

/**
 * 应用（幂等）：把围栏块内容交给自研渲染器（markdown 或代码块）+ 挂切换按钮。
 * 门控（含流式）/ mermaid 块 / 语言为「源码」 / 空内容或超长 / 签名未变 → 一律不动 DOM。
 */
function applyFenceBlock(block: Element): void {
  if (fencePreSkip(block)) return
  const target = fenceKindOf(block)
  // mermaid 块交给 mermaid-scan；「渲染为…源码」的块保持官方原样。
  if (target.kind === 'none' || target.kind === 'mermaid') return
  const source = fenceSource(block)
  if (!source.trim() || source.length > fenceMaxChars(target.kind)) return
  const signature = fenceSignature(target.kind, target.lang, source)
  if (fenceSettled(block, signature)) return
  clearFenceView(block)
  const body = buildFenceBody(target.kind, target.lang, source)
  if (body === null) return
  block.appendChild(body)
  if (target.kind === 'markdown') block.appendChild(fenceToggleButton(block, 'markdown'))
  block.setAttribute(BLOCK_VIEW_ATTR, target.kind)
  block.setAttribute(BLOCK_SIG_ATTR, signature)
}

/** 扫描 root（自身 / 后代）内的围栏代码块并接管（mermaid 块由 mermaid-scan 负责）。 */
function scanFenceBlocks(root: Element): void {
  if (!root || typeof root.querySelectorAll !== 'function') return
  if (typeof root.matches === 'function' && root.matches('div.md-code-block')) applyFenceBlock(root)
  for (const block of root.querySelectorAll('div.md-code-block')) applyFenceBlock(block)
}

exports.TEXT_FENCE_LANGS = TEXT_FENCE_LANGS
exports.MAX_TEXT_FENCE_CHARS = MAX_TEXT_FENCE_CHARS
exports.MAX_CODE_FENCE_CHARS = MAX_CODE_FENCE_CHARS
exports.BLOCK_VIEW_ATTR = BLOCK_VIEW_ATTR
exports.BLOCK_SIG_ATTR = BLOCK_SIG_ATTR
exports.BLOCK_MD_CLASS = BLOCK_MD_CLASS
exports.BLOCK_TOGGLE_CLASS = BLOCK_TOGGLE_CLASS
exports.isFenceStreaming = isFenceStreaming
exports.fenceKindOf = fenceKindOf
exports.fenceSource = fenceSource
exports.fenceSignature = fenceSignature
exports.applyFenceBlock = applyFenceBlock
exports.scanFenceBlocks = scanFenceBlocks
