// ── 上下文注入块 markdown 渲染 ───────────────────────────────────────
// 宿主 @deepseek-ai/dsh-client-ui-chat 的 ContextBody 把上下文注入正文
// （子 agent 回传消息 / AGENTS.md 等 workspace 指令 / 回忆注入）渲染为
// <pre data-context-text="true"> 纯文本（ui-chat/src/client/chat/ContextBody.tsx:147，
// CSS white-space:pre-wrap），其中的 markdown（粗体 / 列表 / 标题 / 表格 /
// 代码块）不会渲染——官方不接管这类纯文本块，所以这是本插件的真增量。
// 本模块在 DOM 层把这类块交给**官方 MarkdownText**（react-dom/client 挂到
// 插入的容器里）渲染，与宿主消息同一套渲染器（表格 / 公式 / 代码块能力
// 完全一致）。
//
// 与 React 共存的约束（宿主白名单是 React 管理的 DOM）：
//  - 不修改 pre 的子结构（React 对 <pre>{text}</pre> 的文本 diff 会整体
//    改写 textContent，改子结构必被冲掉），只在 pre 之前插入渲染容器并
//    给 pre 置 hidden；
//  - 渲染容器写 data-signature（文本长度 + djb2 哈希），重扫时签名一致
//    且容器仍在位 → 跳过（幂等，不重复渲染、不抖动）；
//  - 宿主重建节点（会话切换 / 重渲染）冲掉容器后，MutationObserver 兜底
//    重扫会重做；pre 上的标记不影响宿主（React 不管理该属性）。
// 超长文本（> MAX_CONTEXT_CHARS）跳过；官方组件不可用时不接管（保持宿主
// 纯文本，真降级）。

/** 上下文注入正文选择器（宿主 ContextBody 的稳定 data 契约）。 */
const CONTEXT_TEXT_SELECTOR = 'pre[data-context-text="true"]'
/** 已处理标记（写在 pre 上）。 */
const CONTEXT_APPLIED = 'applied'
/** 渲染容器标记（写在插入的 div 上）。 */
const CONTEXT_BODY_ATTR = 'data-dsh-md-render-context-body'
/** 单块渲染上限（字符）；超过则保持宿主纯文本。 */
const MAX_CONTEXT_CHARS = 200000

/** djb2 字符串哈希（签名用，非加密）。 */
function contextHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** 取已在位的渲染容器（pre 的前一个兄弟且带标记）。 */
function contextBodyOf(pre: Element): Element | null {
  const prev = pre.previousElementSibling
  return prev && prev.getAttribute(CONTEXT_BODY_ATTR) === 'true' ? prev : null
}

/** 接管前置条件（开关 / 官方组件 / 父节点 / 长度）→ 待渲染文本；不满足返回 null。 */
function contextSourceOf(pre: Element): { parent: Element; text: string } | null {
  if (!renderOptions.contextMarkdown) return null
  if (!officialMarkdownAvailable()) return null
  const parent = pre.parentNode as Element | null
  if (!parent || typeof parent.insertBefore !== 'function') return null
  const text = pre.textContent ?? ''
  if (text.length > MAX_CONTEXT_CHARS) return null
  return { parent, text }
}

/** 建容器并交给官方渲染器；官方组件不可用 → null（调用方保持宿主原样）。 */
function buildContextBody(text: string, signature: string): Element | null {
  const body = document.createElement('div')
  body.className = 'tzx-md dsh-md-render-context-md'
  body.setAttribute(CONTEXT_BODY_ATTR, 'true')
  body.setAttribute('data-signature', signature)
  return renderMarkdownInto(body, text) ? body : null
}

/** 幂等应用：文本未变且容器在位 → 跳过；否则（重）渲染并隐藏原文。 */
function applyContextMarkdown(pre: Element): void {
  const source = contextSourceOf(pre)
  if (source === null) return
  const signature = String(source.text.length) + ':' + contextHash(source.text)
  const existing = contextBodyOf(pre)
  if (existing && existing.getAttribute('data-signature') === signature) return
  if (existing) {
    unmountMarkdownIn(existing)
    source.parent.removeChild(existing)
  }
  const body = buildContextBody(source.text, signature)
  if (body === null) return
  source.parent.insertBefore(body, pre)
  pre.setAttribute('data-dsh-md-render-context', CONTEXT_APPLIED)
  ;(pre as HTMLElement).hidden = true
}

/** 扫描 root 内的上下文注入块（供 scanner 调用）。 */
function scanContextBlocks(root: Element): void {
  for (const pre of Array.from(root.querySelectorAll(CONTEXT_TEXT_SELECTOR))) {
    applyContextMarkdown(pre)
  }
}

exports.CONTEXT_TEXT_SELECTOR = CONTEXT_TEXT_SELECTOR
exports.MAX_CONTEXT_CHARS = MAX_CONTEXT_CHARS
exports.contextHash = contextHash
exports.applyContextMarkdown = applyContextMarkdown
exports.scanContextBlocks = scanContextBlocks
