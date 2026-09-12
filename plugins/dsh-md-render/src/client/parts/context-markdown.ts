// ── 上下文注入块 markdown 渲染（issue #196）──────────────────────────
// 宿主 @deepseek-ai/dsh-client-ui-chat 的 ContextBody 把上下文注入正文
// （子 agent 回传消息 / AGENTS.md 等 workspace 指令 / 回忆注入）渲染为
// <pre data-context-text="true"> 纯文本（CSS white-space:pre-wrap），其中
// 的 markdown（粗体 / 列表 / 标题 / 表格 / 代码块）不会渲染；本模块在
// DOM 层把这类块渲染为 markdown 结构，复用 MarkdownView 的输出类名
// （div.tzx-md / p.tzx-p / table.tzx-table / div.md-code-block），样式与
// 既有增强（表格 / 公式 / 代码块）完全一致。
//
// 与 React 共存的约束（宿主白名单是 React 管理的 DOM）：
//  - 不修改 pre 的子结构（React 对 <pre>{text}</pre> 的文本 diff 会整体
//    改写 textContent，改子结构必被冲掉），只在 pre 之前插入渲染容器并
//    给 pre 置 hidden；
//  - 渲染容器写 data-signature（文本长度 + djb2 哈希），重扫时签名一致
//    且容器仍在位 → 跳过（幂等，不重复渲染、不抖动）；
//  - 宿主重建节点（会话切换 / 重渲染）冲掉容器后，MutationObserver 兜底
//    重扫会重做；pre 上的标记不影响宿主（React 不管理该属性）。
// 超长文本（> MAX_CONTEXT_CHARS）跳过，避免单块渲染卡顿。

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

/** 块级渲染：围栏代码 / 标题 / 引用 / 列表 / 表格 / 段落。 */
function cmFence(lines: string[], i: number, out: DocumentFragment): number {
  const m = lines[i].match(/^```([A-Za-z0-9_+-]*)\s*$/)
  if (!m) return 0
  const body: string[] = []
  let j = i + 1
  while (j < lines.length && !/^```\s*$/.test(lines[j])) {
    body.push(lines[j])
    j += 1
  }
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const pre = document.createElement('pre')
  pre.className = 'tzx-pre'
  const code = document.createElement('code')
  if (m[1]) code.className = 'language-' + m[1]
  code.textContent = body.join('\n')
  pre.appendChild(code)
  block.appendChild(pre)
  out.appendChild(block)
  return j < lines.length ? j + 1 : j
}

/** 标题 # ~ ####。 */
function cmHeading(lines: string[], i: number, out: DocumentFragment): number {
  const m = lines[i].match(/^(#{1,4})\s+(.*)$/)
  if (!m) return 0
  const h = document.createElement('h' + String(m[1].length))
  h.appendChild(renderInline(m[2]))
  out.appendChild(h)
  return i + 1
}

/** 引用块（连续 > 行，合并为一个 blockquote，段内换行保留为多段）。 */
function cmQuote(lines: string[], i: number, out: DocumentFragment): number {
  if (!/^\s*>/.test(lines[i])) return 0
  const buf: string[] = []
  let j = i
  while (j < lines.length && /^\s*>/.test(lines[j])) {
    buf.push(lines[j].replace(/^\s*>\s?/, ''))
    j += 1
  }
  const bq = document.createElement('blockquote')
  bq.className = 'tzx-bq'
  for (const line of buf) {
    const p = document.createElement('p')
    p.appendChild(renderInline(line))
    bq.appendChild(p)
  }
  out.appendChild(bq)
  return j
}

/** 列表（无序 - * + / 有序 1. 1)，连续同类项合并为一个列表）。 */
function cmList(lines: string[], i: number, out: DocumentFragment): number {
  const unordered = /^\s*[-*+]\s+/
  const ordered = /^\s*\d+[.)]\s+/
  const isUnordered = unordered.test(lines[i])
  if (!isUnordered && !ordered.test(lines[i])) return 0
  const list = document.createElement(isUnordered ? 'ul' : 'ol')
  list.className = isUnordered ? 'tzx-ul' : 'tzx-ol'
  let j = i
  while (j < lines.length && (isUnordered ? unordered.test(lines[j]) : ordered.test(lines[j]))) {
    const li = document.createElement('li')
    li.appendChild(renderInline(lines[j].replace(isUnordered ? unordered : ordered, '')))
    list.appendChild(li)
    j += 1
  }
  out.appendChild(list)
  return j
}

/** 段落文本里的表格（不标准格式也识别）→ 表格渲染；否则普通段落。 */
function cmParagraph(text: string, out: DocumentFragment): void {
  const table = parseTable(text)
  if (table) {
    out.appendChild(renderTable(table))
    return
  }
  const p = document.createElement('p')
  p.className = 'tzx-p'
  p.appendChild(renderInline(text))
  out.appendChild(p)
}

/** 纯文本 markdown → DOM 片段（块级顺序：围栏 / 标题 / 引用 / 列表 / 段落）。 */
function renderContextMarkdown(text: string): DocumentFragment {
  const out = document.createDocumentFragment()
  const lines = String(text).split('\n')
  let i = 0
  while (i < lines.length) {
    const next = cmFence(lines, i, out) || cmHeading(lines, i, out) || cmQuote(lines, i, out) || cmList(lines, i, out)
    if (next) {
      i = next
      continue
    }
    if (lines[i].trim() === '') {
      i += 1
      continue
    }
    const para = [lines[i]]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4})\s|^```|^\s*[-*+]\s|^\s*\d+[.)]\s|^\s*>/.test(lines[i])
    ) {
      para.push(lines[i])
      i += 1
    }
    cmParagraph(para.join('\n'), out)
  }
  return out
}

/** 取已在位的渲染容器（pre 的前一个兄弟且带标记）。 */
function contextBodyOf(pre: Element): Element | null {
  const prev = pre.previousElementSibling
  return prev && prev.getAttribute(CONTEXT_BODY_ATTR) === 'true' ? prev : null
}

/** 幂等应用：文本未变且容器在位 → 跳过；否则（重）渲染并隐藏原文。 */
function applyContextMarkdown(pre: Element): void {
  const parent = pre.parentNode as Element | null
  if (!parent || typeof parent.insertBefore !== 'function') return
  const text = pre.textContent ?? ''
  if (text.length > MAX_CONTEXT_CHARS) return
  const signature = String(text.length) + ':' + contextHash(text)
  const existing = contextBodyOf(pre)
  if (existing && existing.getAttribute('data-signature') === signature) return
  if (existing) parent.removeChild(existing)
  const body = document.createElement('div')
  body.className = 'tzx-md dsh-md-render-context-md'
  body.setAttribute(CONTEXT_BODY_ATTR, 'true')
  body.setAttribute('data-signature', signature)
  body.appendChild(renderContextMarkdown(text))
  parent.insertBefore(body, pre)
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
exports.renderContextMarkdown = renderContextMarkdown
exports.applyContextMarkdown = applyContextMarkdown
exports.scanContextBlocks = scanContextBlocks
