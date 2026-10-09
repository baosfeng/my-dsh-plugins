// ── mermaid 代码块识别 + 流式稳定窗口 + 卡片挂载 ──────────────────────
// 只在 `[data-conversation-scroll]` 内识别 `div.md-code-block` 且语言标记为
// mermaid / mmd 的块（官方不接管这类块 —— 全仓 grep `mermaid` 于宿主 packages
// 为 0 命中，官方没有任何 fence 渲染器注册 API，所以这是本插件的真增量）。
//
// 挂载策略（不改官方节点结构）：
//  - 卡片 host 追加在块内（appendChild，**不动**块的子结构）；
//  - 官方 `<pre>` 的隐藏**全部交给自有 CSS**（styles.ts 的
//    `.md-code-block[data-dsh-md-render-mermaid-view]` 规则），本模块只写自己的
//    data-* 标记 —— 硬约束：不对官方元素写 style / class / aria。
//
// 流式口径：宿主在**整条消息**上挂 `data-streaming`，DOM 里看不到「结束围栏是否
// 已出现」，只能从内容是否还在增长来判定闭合（STREAM_SETTLE_MS + 连续观察次数）。
// 误判有第二道防线：源码再变即自愈卸载重来（绝不留残缺卡片）。

/** 流式块稳定窗口（毫秒）。取自真机实测的流式更新间隔（约 240ms/次）之上——
 *  比它小会把 token 间隔误判成「已闭合」。 */
const STREAM_SETTLE_MS = 400
/** 连续观察次数（首次发现算 1 次；窗口到期再确认 1 次才允许渲染）。 */
const STREAM_MIN_OBSERVATIONS = 2

/** 已挂载卡片：记住渲染用的源码快照，源码再变就自愈卸载。 */
interface MountedCard {
  root: { unmount: () => void }
  host: Element
  text: string
}

/** 流式块的稳定观察记录。 */
interface StreamWatch {
  text: string
  observations: number
  round: number
  timer: ReturnType<typeof setTimeout> | null
}

const mermaidMounts = new Map<Element, MountedCard>()
const mermaidStreamWatch = new Map<Element, StreamWatch>()

/** 检查是否为 mermaid 代码块（code.language-mermaid / -mmd；不读 React fiber）。 */
function isMermaidBlock(block: Element): boolean {
  try {
    const code = block.querySelector('code')
    if (!code) return false
    const cls = String(code.className || '').toLowerCase()
    return cls.includes('language-mermaid') || cls.includes('language-mmd')
  } catch (_e) {
    return false
  }
}

/** 提取代码块源码（官方 CodeBlock 的 <pre> 文本）。 */
function mermaidSourceOf(block: Element): string {
  try {
    const pre = block.querySelector('pre')
    return pre ? pre.textContent || '' : ''
  } catch (_e) {
    return ''
  }
}

/** 块是否仍在流式消息里（祖先带 [data-streaming]）。 */
function isMermaidStreaming(block: Element): boolean {
  return !!(block.closest && block.closest('[data-streaming]'))
}

/** 清掉某块的稳定观察（挂载 / 卸载 / 元素已失效时）。 */
function clearStreamWatch(block: Element): void {
  const watch = mermaidStreamWatch.get(block)
  if (watch !== undefined && watch.timer !== null) clearTimeout(watch.timer)
  mermaidStreamWatch.delete(block)
}

/** 把卡片挂进块内（entryId 写在 host 上；状态属性由卡片状态机更新）。 */
function mountCard(block: Element, source: string): void {
  if (mermaidMounts.has(block)) return
  const host = document.createElement('div')
  host.className = 'dsh-md-render-mermaid-host'
  block.appendChild(host)
  const root = (
    require('react-dom/client') as { createRoot: (c: Element) => { render: (n: unknown) => void; unmount: () => void } }
  ).createRoot(host)
  const entryId = 'dsh-md-render-mermaid-' + ++mermaidSeq
  mermaidMounts.set(block, { root, host, text: source })
  clearStreamWatch(block)
  // 视图标记写在块上：自有 CSS 据此隐藏官方 <pre>（不改官方元素的 style/class）。
  block.setAttribute(MERMAID_VIEW_ATTR, 'preview')
  host.setAttribute(MERMAID_ENTRY_ATTR, entryId)
  host.setAttribute(MERMAID_STATE_ATTR, 'loading')
  root.render(createElement(MermaidCard, { entryId, source }))
}

/** 自愈卸载：源码在挂载后又变了（流式其实还没写完）→ 拆卡片、恢复原始块。 */
function unmountCard(block: Element, card: MountedCard): void {
  mermaidMounts.delete(block)
  clearStreamWatch(block)
  try {
    card.root.unmount()
  } catch (_e) {
    /* 卸载异常不阻断恢复原始块 */
  }
  if (card.host.parentNode) card.host.parentNode.removeChild(card.host)
  if (typeof block.removeAttribute === 'function') block.removeAttribute(MERMAID_VIEW_ATTR)
}

/** 记录一次观察：内容变了就重新计时，没变就累计观察次数。 */
function watchStream(block: Element, source: string, round: number): void {
  const prev = mermaidStreamWatch.get(block)
  if (prev === undefined || prev.text !== source) {
    if (prev !== undefined && prev.timer !== null) clearTimeout(prev.timer)
    const watch: StreamWatch = { text: source, observations: 1, round, timer: null }
    watch.timer = setTimeout(() => settleStream(block), STREAM_SETTLE_MS)
    mermaidStreamWatch.set(block, watch)
    return
  }
  if (prev.round !== round) {
    prev.round = round
    prev.observations += 1
  }
}

/** 稳定窗口到期：内容仍与观察一致、且已连续观察够次数才渲染。 */
function settleStream(block: Element): void {
  const watch = mermaidStreamWatch.get(block)
  if (watch === undefined) return
  watch.timer = null
  if (typeof block.isConnected === 'boolean' && !block.isConnected) {
    mermaidStreamWatch.delete(block)
    return
  }
  const source = mermaidSourceOf(block)
  if (source !== watch.text || !source.trim()) return
  if (mermaidMounts.has(block)) return
  watch.observations += 1
  if (watch.observations < STREAM_MIN_OBSERVATIONS) {
    watch.timer = setTimeout(() => settleStream(block), STREAM_SETTLE_MS)
    return
  }
  mountCard(block, source)
}

/** 单个候选块：挂载 / 继续等待 / 自愈卸载。非 mermaid 块立即返回（性能护栏）。 */
function considerMermaidBlock(block: Element, round: number): void {
  if (!isMermaidBlock(block)) return
  if (!renderOptions.mermaid.render) return
  const source = mermaidSourceOf(block)
  if (!source.trim() || source.length > MAX_SOURCE_CHARS) return
  const mounted = mermaidMounts.get(block)
  if (mounted !== undefined) {
    if (mounted.text === source) return
    unmountCard(block, mounted) // 源码还在变：拆掉重来，绝不留残缺卡片
  }
  if (!isMermaidStreaming(block)) {
    mountCard(block, source) // 历史消息 / 流式已结束：立即渲染（不回归）
    return
  }
  watchStream(block, source, round)
}

/** 扫描 root（自身 / 后代）内的会话滚动容器里的 mermaid 代码块。 */
function scanMermaidBlocks(root: Element, round: number): void {
  const scrolls: Element[] = []
  if (root.matches && root.matches('[data-conversation-scroll]')) scrolls.push(root)
  if (root.querySelectorAll) {
    for (const sc of root.querySelectorAll('[data-conversation-scroll]')) scrolls.push(sc)
  }
  for (const sc of scrolls) {
    for (const block of sc.querySelectorAll('div.md-code-block')) considerMermaidBlock(block, round)
  }
}

/** teardown：清掉全部观察与挂载记录（observer 断连由共享骨架负责）。 */
function teardownMermaid(): void {
  for (const block of Array.from(mermaidStreamWatch.keys())) clearStreamWatch(block)
  mermaidMounts.clear()
}

exports.STREAM_SETTLE_MS = STREAM_SETTLE_MS
exports.isMermaidBlock = isMermaidBlock
exports.mermaidSourceOf = mermaidSourceOf
exports.considerMermaidBlock = considerMermaidBlock
exports.scanMermaidBlocks = scanMermaidBlocks
exports.teardownMermaid = teardownMermaid
