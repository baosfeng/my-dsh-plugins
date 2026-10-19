// ── 围栏块接管（B 路）：div.md-code-block → 自研代码卡 / markdown 卡 / 源码 ──
// 宿主契约（写死的选择器）：围栏块是 `div.md-code-block`，官方内容（banner + pre）保留不动；
// 本模块只在块内追加自有容器，并在块上写 `data-mdr-view`（code | markdown；source 时移除），
// 由 STYLES_CODE 的属性选择器隐藏官方内容 —— 切回源码时官方原样恢复。
//
// 视图状态 = 块上的 data-mdr-view（单一事实源）：底栏三态控件的点击由 lang-switch.ts 派发
// `mdr-lang-switch` CustomEvent，本模块监听后改写视图；幂等靠签名（视图 + 语言 + 长度 +
// 内容哈希 + 渲染库就绪版本），流式块（[data-streaming] 祖先）跳过，稳定后再渲染。

/** 自建容器 / markdown 卡类名（BLOCK_MD_CLASS 也被 block-lang.ts 用于防递归重建）。 */
const MDR_BLOCK_CLASS = 'mdr-block'
const BLOCK_MD_CLASS = 'mdr-block-md'
/** 块视图 / 签名 / 语言 / 事件绑定标记（全部为本插件自有 data-mdr-*）。 */
const BLOCK_VIEW_ATTR = 'data-mdr-view'
const BLOCK_SIG_ATTR = 'data-mdr-sig'
const BLOCK_LANG_ATTR = 'data-mdr-lang'
const BLOCK_BOUND_ATTR = 'data-mdr-bound'
/** 底栏三态控件派发的事件名（与 lang-switch.ts 同一契约）。 */
const BLOCK_SWITCH_EVENT = 'mdr-lang-switch'
/** 触发 markdown 渲染的语言标记（一律渲染，不做内容判定）。 */
const TEXT_FENCE_LANGS: readonly string[] = ['text', 'plaintext', 'txt', 'md', 'markdown']
/** 图表语言（渲染交给 mermaid-scan.ts；本模块不碰）。 */
const MDR_DIAGRAM_LANGS: readonly string[] = ['mermaid', 'mmd']
/** markdown / 代码单块渲染上限（字符）：超长保持官方形态，避免单块卡顿。 */
const MAX_TEXT_FENCE_CHARS = 100000
const MAX_CODE_FENCE_CHARS = 200000

/** 接管类型（none = 本模块不动这个块）。 */
interface MdrFenceKind {
  kind: 'markdown' | 'code' | 'none'
  lang: string
}

/** 块源码：官方 <pre> 文本（去掉一个尾部换行，对齐官方 display 语义）。 */
function fenceSource(block: Element): string {
  const pre = typeof block.querySelector === 'function' ? block.querySelector('pre') : null
  const text = pre !== null ? (pre.textContent ?? '') : ''
  return text.endsWith('\n') ? text.slice(0, -1) : text
}

/** 块是否仍在流式消息里（祖先带 [data-streaming]）。 */
function isFenceStreaming(block: Element): boolean {
  return !!(block.closest && block.closest('[data-streaming]'))
}

/**
 * 接管类型（唯一入口，手动覆盖优先级最高）：
 *  ⓪ 「渲染为…」覆盖：source → 不接管（官方原样）；markdown → 强制 markdown；mermaid → 交给图表；
 *  ① mermaid / mmd → 交给 mermaid-scan（本模块不碰）；
 *  ② text 家族，或「确证无语言」→ 自研 markdown；
 *  ③ 其余（含识别失败）→ 自研代码卡（语言位留空，绝不编造语言名）。
 */
function fenceKindOf(block: Element): MdrFenceKind {
  const forced = fenceForceOf(block)
  if (forced === 'source') return { kind: 'none', lang: '' }
  if (forced === 'markdown') return { kind: 'markdown', lang: '' }
  if (forced === 'mermaid') return { kind: 'none', lang: 'mermaid' }
  const resolved = resolveFenceLangEx(block)
  const lang = resolved.lang
  if (MDR_DIAGRAM_LANGS.includes(lang)) return { kind: 'none', lang }
  if (TEXT_FENCE_LANGS.includes(lang)) return { kind: 'markdown', lang }
  if (lang === '') return { kind: resolved.confirmed ? 'markdown' : 'code', lang: '' }
  return { kind: 'code', lang }
}

/** 前置门控（任何语言判定之前）：开关关闭 / 渲染层不可用 / 流式块 / 已渲染容器内的块。 */
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

/** 本模块已建的自有容器。 */
function mdrBlockOf(host: Element): Element | null {
  const found = typeof host.querySelector === 'function' ? host.querySelector('div.' + MDR_BLOCK_CLASS) : null
  return found === null || found === undefined ? null : found
}

/** 清掉自有容器（宿主的 banner / pre 一律不动）。 */
function clearMdrBlock(host: Element): void {
  const card = mdrBlockOf(host)
  if (card === null) return
  // React root 挂在标题正文容器上（不是外壳卡）：先卸内层，再清 DOM。
  const body = typeof card.querySelector === 'function' ? card.querySelector('.mdr-block-body') : null
  if (body !== null) unmountMarkdownIn(body)
  unmountMarkdownIn(card)
  if (card.parentNode) card.parentNode.removeChild(card)
  if (typeof host.removeAttribute === 'function') {
    host.removeAttribute(BLOCK_SIG_ATTR)
    host.removeAttribute(BLOCK_VIEW_ATTR)
  }
}

/** 幂等签名（含渲染库就绪版本：库到位后重建一次，把兜底换成渲染态）。 */
function fenceSignature(kind: string, lang: string, source: string): string {
  return kind + ':' + lang + ':' + String(source.length) + ':' + contextHash(source) + ':' + String(renderAssetsReady())
}

/** 建代码卡（React：MdrCodeBlock 自带头 / 体 / 底栏三态）。 */
function buildMdrCodeCard(lang: string, source: string): Element | null {
  const card = document.createElement('div')
  card.className = MDR_BLOCK_CLASS
  const ok = renderNodeInto(card, createElement(MdrCodeBlock, { lang, code: source, view: 'code' }))
  return ok ? card : null
}

/** 建 markdown 卡（正文交给 render-assets 懒加载入口；底栏保留三态控件）。 */
function buildMdrMarkdownCard(source: string): Element | null {
  const card = document.createElement('div')
  card.className = MDR_BLOCK_CLASS + ' ' + BLOCK_MD_CLASS
  const body = document.createElement('div')
  body.className = 'mdr-md mdr-block-body'
  if (!renderMarkdownInto(body, source)) return null
  card.appendChild(body)
  const foot = document.createElement('div')
  foot.className = 'mdr-fence-foot'
  const note = document.createElement('span')
  note.className = 'mdr-fence-note'
  note.textContent = '按 markdown 渲染'
  foot.appendChild(note)
  // 注意：类名**不能**用 mdr-lang-switch —— 那是扫描器补注入控件的类，
  // scanLangSwitches 会把同类的节点当自己的清掉（markdown 卡底栏会被误删）。
  const switchHost = document.createElement('div')
  switchHost.className = 'mdr-block-switch'
  if (!renderNodeInto(switchHost, createElement(MdrLangSwitchFrom, { current: 'markdown' }))) return null
  foot.appendChild(switchHost)
  card.appendChild(foot)
  return card
}

/** 监听底栏三态事件（每块只绑一次）：事件 → 块视图（单一事实源）。 */
function bindMdrBlockEvents(host: Element): void {
  if (host.getAttribute(BLOCK_BOUND_ATTR) === 'true') return
  host.setAttribute(BLOCK_BOUND_ATTR, 'true')
  host.addEventListener(BLOCK_SWITCH_EVENT, (event: Event) => {
    const detail = (event as CustomEvent).detail as { value?: unknown } | undefined
    const value = detail !== undefined && typeof detail.value === 'string' ? detail.value : ''
    if (value === '') return
    applyMdrLangChoice(host, value)
  })
}

/** 三态选择落地：图表 → 覆盖层 + 重扫（mermaid-scan 接）；markdown/source → 直接换视图。 */
function applyMdrLangChoice(host: Element, value: string): void {
  const lang = host.getAttribute(BLOCK_LANG_ATTR) ?? ''
  if (value === 'diagram') {
    setFenceForce(host, 'mermaid')
    clearMdrBlock(host)
    if (typeof rescanForLangs === 'function') rescanForLangs()
    return
  }
  const source = fenceSource(host)
  if (value === 'markdown') {
    setFenceForce(host, 'markdown')
    mountMdrBlock(host, lang, source, 'markdown')
    return
  }
  setFenceForce(host, 'source')
  mountMdrBlock(host, lang, source, 'source')
  // 源码视图下块回到宿主形态：重扫把底栏三态入口补回来（幂等）。
  if (typeof rescanForLangs === 'function') rescanForLangs()
}

/**
 * 挂载围栏块视图（契约导出）：host = div.md-code-block。
 * view = code（代码卡）| markdown（自研 markdown）| source（移除自有容器、官方原样）。
 */
function mountMdrBlock(host: Element, lang: string, source: string, view: 'code' | 'markdown' | 'source'): void {
  if (!host || typeof host.getAttribute !== 'function') return
  bindMdrBlockEvents(host)
  if (view === 'source') {
    clearMdrBlock(host)
    host.setAttribute(BLOCK_LANG_ATTR, lang)
    return
  }
  if (!domRootAvailable()) return
  const safeView = view === 'markdown' ? 'markdown' : 'code'
  const signature = fenceSignature(safeView, lang, source)
  if (host.getAttribute(BLOCK_SIG_ATTR) === signature && mdrBlockOf(host) !== null) return
  clearMdrBlock(host)
  const card = safeView === 'markdown' ? buildMdrMarkdownCard(source) : buildMdrCodeCard(lang, source)
  if (card === null) return
  host.appendChild(card)
  markMdrBlock(host, lang, safeView, signature)
}

/** 挂载完成后的收尾：写块标记 + 去掉扫描器补的块内控件（卡片底栏自带三态，避免一套两块）。 */
function markMdrBlock(host: Element, lang: string, view: 'code' | 'markdown', signature: string): void {
  host.setAttribute(BLOCK_LANG_ATTR, lang)
  host.setAttribute(BLOCK_VIEW_ATTR, view)
  host.setAttribute(BLOCK_SIG_ATTR, signature)
  if (typeof removeLangSwitch === 'function') removeLangSwitch(host)
}

/** 应用（幂等）：把围栏块交给自研渲染器；门控 / 超长 / 空内容 → 不动宿主 DOM。 */
function applyFenceBlock(block: Element): void {
  if (fencePreSkip(block)) return
  const target = fenceKindOf(block)
  if (target.kind === 'none') return
  const source = fenceSource(block)
  if (source.trim() === '' || source.length > fenceMaxChars(target.kind)) return
  mountMdrBlock(block, target.lang, source, target.kind === 'markdown' ? 'markdown' : 'code')
}

/** 扫描 root（自身 / 后代）内的围栏代码块（mermaid 块由 mermaid-scan 负责）。 */
function scanFenceBlocks(root: Element): void {
  if (!root || typeof root.querySelectorAll !== 'function') return
  if (typeof root.matches === 'function' && root.matches('div.md-code-block')) applyFenceBlock(root)
  for (const block of Array.from(root.querySelectorAll('div.md-code-block'))) applyFenceBlock(block)
}

exports.MDR_BLOCK_CLASS = MDR_BLOCK_CLASS
exports.BLOCK_MD_CLASS = BLOCK_MD_CLASS
exports.BLOCK_VIEW_ATTR = BLOCK_VIEW_ATTR
exports.BLOCK_SIG_ATTR = BLOCK_SIG_ATTR
exports.BLOCK_SWITCH_EVENT = BLOCK_SWITCH_EVENT
exports.TEXT_FENCE_LANGS = TEXT_FENCE_LANGS
exports.MAX_TEXT_FENCE_CHARS = MAX_TEXT_FENCE_CHARS
exports.MAX_CODE_FENCE_CHARS = MAX_CODE_FENCE_CHARS
exports.fenceSource = fenceSource
exports.isFenceStreaming = isFenceStreaming
exports.fenceKindOf = fenceKindOf
exports.fenceSignature = fenceSignature
exports.mdrBlockOf = mdrBlockOf
exports.clearMdrBlock = clearMdrBlock
exports.bindMdrBlockEvents = bindMdrBlockEvents
exports.mountMdrBlock = mountMdrBlock
exports.applyFenceBlock = applyFenceBlock
exports.scanFenceBlocks = scanFenceBlocks
