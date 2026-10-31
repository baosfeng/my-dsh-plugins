// ── 上下文注入块（B 路）：标注头 + 来源 + markdown 正文 ───────────────────
// 宿主 ContextBody 把上下文注入正文渲染成 <pre data-context-text="true"> 纯文本
// （ui-chat/src/client/chat/ContextBody.tsx:147，white-space:pre-wrap）：其中的
// 标题 / 列表 / 表格 / 代码块都是字面文本。本模块在 DOM 层把这类块交给本插件自己的
// markdown 渲染器（render-assets.ts 懒加载 marked 的入口），并加一带「上下文注入」标注、
// 来源与「按 markdown 渲染」徽标的卡片（原型 3558–3603）。
//
// 与 React 共存的约束：
//  - 不改 pre 的子结构（React 对 <pre>{text}</pre> 的文本 diff 会整体改写 textContent），
//    只在 pre 之前插入卡片并给 pre 置 hidden；
//  - 卡片写签名（长度 + 哈希 + 渲染库就绪版本），重扫签名一致 → 跳过（幂等）；
//  - 宿主重渲染冲掉卡片后，scanner 的重扫会补挂；超长 / 渲染库未就绪 → 保持宿主纯文本。

/** 上下文注入正文选择器（宿主 ContextBody 的稳定 data 契约）。 */
const CONTEXT_TEXT_SELECTOR = 'pre[data-context-text="true"]'
/** 卡片类名 / 卡片标记 / 签名属性 / 原文隐藏标记。 */
const MDR_CONTEXT_CLASS = 'mdr-ctx'
const MDR_CONTEXT_HEAD_CLASS = 'mdr-ctx-head'
const MDR_CONTEXT_TITLE_CLASS = 'mdr-ctx-title'
const MDR_CONTEXT_FROM_CLASS = 'mdr-ctx-from'
const MDR_CONTEXT_BADGE_CLASS = 'mdr-pill mdr-ctx-badge'
const MDR_CONTEXT_BODY_CLASS = 'mdr-md mdr-ctx-body'
const MDR_CONTEXT_MARK_ATTR = 'data-mdr-context'
const MDR_CONTEXT_SIG_ATTR = 'data-mdr-sig'
const MDR_CONTEXT_HIDDEN_ATTR = 'data-mdr-context-hidden'
/** 单块渲染上限（字符）；超过则保持宿主纯文本。 */
const MAX_CONTEXT_CHARS = 200000

/** djb2 字符串哈希（签名用，非加密；lang-source.ts 的 fenceHash 复用）。 */
function contextHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** 来源标注：宿主行头部的 [data-context-source]（producer 名）；找不到 → ''。 */
function mdrContextSourceOf(host: Element): string {
  let node: Element | null = host
  for (let depth = 0; depth < 8 && node !== null && node !== undefined; depth += 1) {
    if (typeof (node as { querySelector?: unknown }).querySelector === 'function') {
      try {
        const found = (node as Element).querySelector('[data-context-source]')
        if (found !== null) {
          const label = (found.textContent ?? '').trim()
          if (label !== '') return label
        }
      } catch (_e) {
        /* 契约失配 → 退化为无来源 */
      }
    }
    node = node.parentNode as Element | null
  }
  return ''
}

/** 已在位的卡片（pre 的前一个兄弟且带本模块标记）。 */
function mdrContextCardOf(host: Element): Element | null {
  const prev = host.previousElementSibling
  if (prev === null || prev === undefined) return null
  return prev.getAttribute(MDR_CONTEXT_MARK_ATTR) === 'true' ? prev : null
}

/** 卡片签名（内容 + 渲染库就绪版本：库到位后重建一次把纯文本换成渲染态）。 */
function mdrContextSignature(text: string): string {
  return String(text.length) + ':' + contextHash(text) + ':' + String(renderAssetsReady())
}

/** 移掉在位卡片（内容变化 / 重建前清理）。 */
function removeMdrContextCard(host: Element): void {
  const card = mdrContextCardOf(host)
  if (card === null) return
  // React root 挂在正文容器上（不是外层卡片）：先卸内层，再清 DOM。
  const body = typeof card.querySelector === 'function' ? card.querySelector('.mdr-ctx-body') : null
  if (body !== null) unmountMarkdownIn(body)
  unmountMarkdownIn(card)
  if (card.parentNode) card.parentNode.removeChild(card)
  if (typeof host.removeAttribute === 'function') host.removeAttribute(MDR_CONTEXT_HIDDEN_ATTR)
}

/** 建标注头（纯 DOM，不写 style）。 */
function mdrContextHeadElement(source: string): Element {
  const head = document.createElement('div')
  head.className = MDR_CONTEXT_HEAD_CLASS
  const dot = document.createElement('span')
  dot.className = 'mdr-ctx-dot'
  dot.setAttribute('aria-hidden', 'true')
  head.appendChild(dot)
  const title = document.createElement('strong')
  title.className = MDR_CONTEXT_TITLE_CLASS
  title.textContent = '上下文注入'
  head.appendChild(title)
  if (source !== '') {
    const from = document.createElement('span')
    from.className = MDR_CONTEXT_FROM_CLASS
    from.textContent = '来自 ' + source
    head.appendChild(from)
  }
  const badge = document.createElement('span')
  badge.className = MDR_CONTEXT_BADGE_CLASS
  badge.textContent = '按 markdown 渲染'
  head.appendChild(badge)
  return head
}

/** 可接管的正文：门控（开关 / 渲染层 / 宿主契约 / 空文本 / 超长）全在前置，不可接管 → null。 */
function mdrContextTextOf(host: Element): string | null {
  if (!renderOptions.markdown.contextMarkdown) return null
  if (!domRootAvailable()) return null
  if (typeof host.getAttribute !== 'function') return null
  const parent = host.parentNode as Element | null
  if (parent === null || parent === undefined || typeof parent.insertBefore !== 'function') return null
  const text = host.textContent ?? ''
  if (text.trim() === '' || text.length > MAX_CONTEXT_CHARS) return null
  return text
}

/** 建卡片（标注头 + markdown 正文）：渲染层不就绪 → null（调用方保持宿主纯文本）。 */
function mdrContextCardFor(host: Element, text: string): Element | null {
  const card = document.createElement('div')
  card.className = MDR_CONTEXT_CLASS
  card.setAttribute(MDR_CONTEXT_MARK_ATTR, 'true')
  card.setAttribute(MDR_CONTEXT_SIG_ATTR, mdrContextSignature(text))
  card.appendChild(mdrContextHeadElement(mdrContextSourceOf(host)))
  const body = document.createElement('div')
  body.className = MDR_CONTEXT_BODY_CLASS
  if (!renderMarkdownInto(body, text)) return null
  card.appendChild(body)
  return card
}

/**
 * 把 <pre data-context-text="true"> 接管成「标注头 + markdown 正文」卡片。
 * 开关关闭 / 渲染层不可用 / 超长 / 空文本 → 保持宿主纯文本（真降级）。
 */
function mountMdrContext(host: Element): void {
  const text = mdrContextTextOf(host)
  if (text === null) return
  const signature = mdrContextSignature(text)
  const existing = mdrContextCardOf(host)
  if (existing !== null && existing.getAttribute(MDR_CONTEXT_SIG_ATTR) === signature) return
  if (existing !== null) removeMdrContextCard(host)
  const card = mdrContextCardFor(host, text)
  if (card === null) return
  const parent = host.parentNode as Element | null
  if (parent === null) return
  parent.insertBefore(card, host)
  ;(host as HTMLElement).hidden = true
  host.setAttribute(MDR_CONTEXT_HIDDEN_ATTR, 'true')
}

/**
 * 扫描 root（自身 / 后代）内的上下文注入块（供 scanner 调用）。
 *
 * **增量渲染**：只登记，块进入视口才挂卡片（内容哈希 / markdown 渲染都留在回调里）。
 */
function scanContextBlocks(root: Element): void {
  if (!root || typeof root.querySelectorAll !== 'function') return
  if (typeof root.matches === 'function' && root.matches(CONTEXT_TEXT_SELECTOR)) {
    const self = root
    enqueueWhenVisible(self, 'context', () => mountMdrContext(self))
  }
  for (const pre of Array.from(root.querySelectorAll(CONTEXT_TEXT_SELECTOR))) {
    enqueueWhenVisible(pre, 'context', () => mountMdrContext(pre))
  }
}

exports.CONTEXT_TEXT_SELECTOR = CONTEXT_TEXT_SELECTOR
exports.MAX_CONTEXT_CHARS = MAX_CONTEXT_CHARS
exports.MDR_CONTEXT_CLASS = MDR_CONTEXT_CLASS
exports.contextHash = contextHash
exports.mdrContextSourceOf = mdrContextSourceOf
exports.mountMdrContext = mountMdrContext
exports.scanContextBlocks = scanContextBlocks
