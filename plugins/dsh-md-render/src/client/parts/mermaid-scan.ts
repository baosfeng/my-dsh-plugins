// ── mermaid 围栏块识别 + 流式稳定窗口 + 卡片挂载 ───────────────────────
// 只在 `[data-conversation-scroll]` 内识别 `div.md-code-block` 且语言为 mermaid / mmd 的块
// （宿主没有 mermaid fence 渲染器注册 API —— 这是本插件的真增量）。
//
// 挂载策略（不改官方节点结构）：
//  · 卡片 host 追加在块内（appendChild，不动块的子结构）；
//  · 官方 <pre> 的隐藏全部交给自有 CSS（块上写自有标记），本模块只写 data-*；
//  · 标题 / 类型从源码提取（frontmatter title → accTitle → 类型名；类型 = 首个有效语句
//    的关键字），与原型「标题胶囊 + kind」一致。
//
// 流式口径：宿主在**整条消息**上挂 `data-streaming`，DOM 里看不到「结束围栏是否已出现」，
// 只能从内容是否还在增长来判定闭合（STREAM_SETTLE_MS + 连续观察次数）；误判有第二道
// 防线：源码再变即自愈卸载重来，绝不留残缺卡片。

/** 流式块稳定窗口（毫秒）。取自真机实测的流式更新间隔之上（~240ms/次）。 */
const STREAM_SETTLE_MS = 400
/** 连续观察次数（首次发现算 1 次；窗口到期再确认 1 次才允许渲染）。 */
const STREAM_MIN_OBSERVATIONS = 2
/** 本插件接管的围栏语言（与其它注入点的语言集合不重叠 → 分流稳定）。 */
const MM_FENCE_LANGS: readonly string[] = ['mermaid', 'mmd']

/** 围栏信任查询：源码文本 → { lang, closed }（lang-source 维护的哈希表）。 */
function fenceTrustOf(block: Element): { lang: string; closed: boolean } | undefined {
  return typeof fenceFactsOfText === 'function' ? fenceFactsOfText(mermaidSourceOf(block)) : undefined
}
/** 新围栏闭合后的重扫钩子（由本文件装配；未装配 → 不重扫）。 */
let fenceCloseRescan: (() => void) | null = null
/** 当前已订阅的事件源（同一 source 不重复订阅）。 */
let fenceSubscribedSource: object | null = null
let fenceUnsubscribe: (() => void) | null = null

/** 装配「围栏闭合」重扫回调（null = 卸掉）。 */
function installFenceCloseRescan(callback: (() => void) | null): void {
  fenceCloseRescan = typeof callback === 'function' ? callback : null
}
/** 退订（会话切换 / teardown）。 */
function dropFenceSubscription(): void {
  if (fenceUnsubscribe !== null) {
    try {
      fenceUnsubscribe()
    } catch (_e) {
      /* 退订异常不影响后续扫描 */
    }
  }
  fenceUnsubscribe = null
  fenceSubscribedSource = null
}
/** 事件源 revision 变化 → 刷新索引 → 有新闭合围栏才重扫（防抖到下一拍）。 */
function ensureFenceSubscription(ctx: unknown): void {
  const current = typeof currentEventSource === 'function' ? currentEventSource(ctx) : null
  if (current === null) return
  const source = current.source as { subscribe?: unknown }
  if (typeof source.subscribe !== 'function') return
  if (fenceSubscribedSource === current.source) return
  dropFenceSubscription()
  try {
    const stop = (source.subscribe as (listener: () => void) => unknown).call(current.source, () => {
      const before = fenceClosedCountOf()
      refreshFenceLangIndexOnly(ctx)
      if (fenceClosedCountOf() <= before || fenceCloseRescan === null) return
      setTimeout(fenceCloseRescan, 0)
    })
    fenceSubscribedSource = current.source
    fenceUnsubscribe = typeof stop === 'function' ? (stop as () => void) : null
  } catch (_e) {
    fenceSubscribedSource = null
    fenceUnsubscribe = null
  }
}

// 事件流里出现「新闭合围栏」时触发一次重扫（scanner.ts 的 rescanForLangs 在同一
// factory 作用域内；流式闭合不产生 DOM 变更，必须靠事件订阅叫醒扫描）。
// 上下文中没有扫描器（纯单测）→ 静默跳过，行为不变。
if (typeof installFenceCloseRescan === 'function' && typeof rescanForLangs === 'function') {
  installFenceCloseRescan(rescanForLangs)
}
/** 已知图表类型关键字 → 展示用规范名（原型 .mm-kind 显示 flowchart 等）。
 *  清单按 mermaid 12.2.0 实测（initialize 后逐个 detectType 命中）补齐；裸关键字与
 *  `-beta` 别名都收，规范名统一去掉 `-beta` 后缀。 */
const MM_KIND_NAMES: readonly string[] = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'quadrantChart',
  'requirementDiagram',
  'gitGraph',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'mindmap',
  'timeline',
  'sankey',
  'sankey-beta',
  'xychart',
  'xychart-beta',
  'block',
  'block-beta',
  'packet',
  'packet-beta',
  'architecture',
  'architecture-beta',
  'kanban',
  'info',
  'eventmodeling',
  'ishikawa',
  'ishikawa-beta',
  'cynefin-beta',
  'radar-beta',
  'treemap',
  'treemap-beta',
  'venn-beta',
  'wardley-beta',
  'swimlane-beta',
  'treeView-beta',
  'agentflow-beta',
  'railroad-beta',
  'railroad-abnf-beta',
  'railroad-ebnf-beta',
  'railroad-peg-beta',
  'usecase-beta',
]

/** 类型关键字 → 规范名（纯函数）。 */
function mmCanonicalKind(word: string): string {
  if (word === 'graph') return 'flowchart'
  if (word === 'stateDiagram-v2') return 'stateDiagram'
  if (word.slice(-5) === '-beta') return word.slice(0, -5)
  return word
}

/** 无类型信息的行：空行 / mermaid 注释 / frontmatter 键（纯函数）。 */
function mmSkipKindLine(line: string): boolean {
  if (line === '') return true
  if (line.indexOf('%%') === 0) return true
  if (line.indexOf('title:') === 0) return true
  return line.indexOf('config:') === 0
}

/** 从源码提取图表类型（纯函数；识别不了 → 'mermaid'）。 */
function mermaidKindOf(source: string): string {
  const text = String(source === undefined || source === null ? '' : source).replace(/^\uFEFF/, '')
  let frontMatter = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '---') {
      frontMatter = !frontMatter
      continue
    }
    if (frontMatter) continue
    if (mmSkipKindLine(line)) continue
    const word = line.split(/\s+/)[0]
    if (MM_KIND_NAMES.indexOf(word) >= 0) return mmCanonicalKind(word)
  }
  return 'mermaid'
}

/** 从源码提取标题：frontmatter title → accTitle → 类型名（纯函数）。 */
function mermaidTitleOf(source: string, kind: string): string {
  const text = String(source === undefined || source === null ? '' : source).replace(/^\uFEFF/, '')
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(text)
  if (fm !== null) {
    const inFm = /(?:^|\n)\s*title:\s*(.+?)\s*(?:\n|$)/.exec(fm[1])
    if (inFm !== null && inFm[1] !== '') return inFm[1]
  }
  const acc = /accTitle:\s*(.+?)\s*(?:\n|$)/.exec(text)
  if (acc !== null && acc[1] !== '') return acc[1]
  return kind
}

/** 挂载序号（host 上的 entry 标记用）。 */
let mmHostSeq = 0

/** 已挂载卡片：记住渲染用的源码快照，源码再变就自愈卸载。 */
interface MmMount {
  root: { unmount: () => void }
  host: Element
  text: string
}

/** 流式块的稳定观察记录。 */
interface MmStreamWatch {
  text: string
  observations: number
  round: number
  timer: ReturnType<typeof setTimeout> | null
}

const mmMounts = new Map<Element, MmMount>()
const mmStreamWatch = new Map<Element, MmStreamWatch>()

/**
 * 是否为 mermaid 代码块。语言来源 = block-lang 的双源互补：
 *  · allowIndex !== false：① client 事件流索引（含历史，冷启动唯一来源）；② DOM 语言名兜底；
 *  · allowIndex === false：只读 DOM —— 流式块专用（内容还在补写，哈希必然落空）。
 */
function isMermaidBlock(block: Element, allowIndex = true): boolean {
  try {
    const lang = allowIndex ? resolveFenceLang(block) : blockLangDomLang(block)
    return MM_FENCE_LANGS.indexOf(lang) >= 0
  } catch (_e) {
    return false
  }
}

/** 提取代码块源码（官方 <pre> 的文本）。 */
function mermaidSourceOf(block: Element): string {
  try {
    const pre = block.querySelector('pre')
    return pre === null ? '' : pre.textContent || ''
  } catch (_e) {
    return ''
  }
}

/** 块是否仍在流式消息里（祖先带 [data-streaming]）。 */
function isMmStreaming(block: Element): boolean {
  return !!(block.closest && block.closest('[data-streaming]'))
}

/** 清掉某块的稳定观察。 */
function clearStreamWatch(block: Element): void {
  const watch = mmStreamWatch.get(block)
  if (watch !== undefined && watch.timer !== null) clearTimeout(watch.timer)
  mmStreamWatch.delete(block)
}

/** 把卡片挂进块内（卡片自带作用域 id；块上写自有标记驱动官方 <pre> 的隐藏）。 */
function mountMermaidCard(block: Element, source: string): void {
  if (mmMounts.has(block)) return
  const host = document.createElement('div')
  // 双类名：新口径 mdr-mm-host + 既有 dsh-md-render-* 前缀（旧样式按前缀白名单保留我们的节点）。
  host.className = 'mdr-mm-host dsh-md-render-mermaid-host'
  block.appendChild(host)
  const root = (
    require('react-dom/client') as { createRoot: (c: Element) => { render: (n: unknown) => void; unmount: () => void } }
  ).createRoot(host)
  const kind = mermaidKindOf(source)
  mmMounts.set(block, { root: root, host: host, text: source })
  clearStreamWatch(block)
  block.setAttribute(MERMAID_VIEW_ATTR, 'preview')
  host.setAttribute(MERMAID_ENTRY_ATTR, 'mermaid-' + String(++mmHostSeq))
  host.setAttribute(MERMAID_STATE_ATTR, 'loading')
  // 已是卡片：块内不再挂「渲染为…」控件（卡片底栏常显三态入口）。
  removeLangSwitch(block)
  root.render(createElement(MdrMermaidCard, { source: source, kind: kind, title: mermaidTitleOf(source, kind) }))
}

/** 自愈卸载：源码在挂载后又变了（流式其实还没写完）→ 拆卡片、恢复原始块。 */
function unmountMermaidCard(block: Element, card: MmMount): void {
  mmMounts.delete(block)
  clearStreamWatch(block)
  try {
    card.root.unmount()
  } catch (_e) {
    /* 卸载异常不阻断恢复原始块 */
  }
  if (card.host.parentNode !== null) card.host.parentNode.removeChild(card.host)
  if (typeof block.removeAttribute === 'function') block.removeAttribute(MERMAID_VIEW_ATTR)
}

/** 记录一次观察：内容变了就重新计时，没变就累计观察次数。 */
function watchStream(block: Element, source: string, round: number): void {
  const prev = mmStreamWatch.get(block)
  if (prev === undefined || prev.text !== source) {
    if (prev !== undefined && prev.timer !== null) clearTimeout(prev.timer)
    const watch: MmStreamWatch = { text: source, observations: 1, round: round, timer: null }
    watch.timer = setTimeout(() => settleStream(block), STREAM_SETTLE_MS)
    mmStreamWatch.set(block, watch)
    return
  }
  if (prev.round !== round) {
    prev.round = round
    prev.observations += 1
  }
}

/** 稳定窗口到期：内容仍与观察一致、且已连续观察够次数才渲染。 */
function settleStream(block: Element): void {
  const watch = mmStreamWatch.get(block)
  if (watch === undefined) return
  watch.timer = null
  if (typeof block.isConnected === 'boolean' && !block.isConnected) {
    mmStreamWatch.delete(block)
    return
  }
  const source = mermaidSourceOf(block)
  if (source !== watch.text || !source.trim()) return
  if (mmMounts.has(block)) return
  watch.observations += 1
  if (watch.observations < STREAM_MIN_OBSERVATIONS) {
    watch.timer = setTimeout(() => settleStream(block), STREAM_SETTLE_MS)
    return
  }
  mountMermaidCard(block, source)
}

/** 取可挂载源码：空 / 超长 → null；已挂载且内容变了 → 先自愈卸载（绝不留残缺卡片）。 */
function mountableSource(block: Element): string | null {
  const source = mermaidSourceOf(block)
  if (!source.trim() || source.length > MAX_SOURCE_CHARS) return null
  const mounted = mmMounts.get(block)
  if (mounted === undefined) return source
  if (mounted.text === source) return null
  unmountMermaidCard(block, mounted)
  return source
}

/**
 * 单个候选块：挂载 / 继续等待 / 自愈卸载。流式分支优先级：
 * ① 事件流围栏已闭合 → 立即渲染；② 明确未闭合 → 不渲染；③ 查不到 → 旧判据兜底。
 */
function considerMermaidBlock(block: Element, round: number): void {
  if (!renderOptions.mermaid.render) return
  if (isInsideRenderedMarkdown(block)) return
  if (isMmStreaming(block)) {
    considerStreaming(block, round)
    return
  }
  if (!isMermaidBlock(block, true)) return
  const source = mountableSource(block)
  if (source !== null) mountMermaidCard(block, source)
}

/** 流式分支：闭合位优先，事件流不可用才退回 400ms 窗口。 */
function considerStreaming(block: Element, round: number): void {
  const trust = typeof fenceTrustOf === 'function' ? fenceTrustOf(block) : undefined
  if (trust === undefined) {
    considerByWindow(block, round)
    return
  }
  if (MM_FENCE_LANGS.indexOf(trust.lang) < 0) return
  if (!trust.closed) {
    clearStreamWatch(block)
    return
  }
  const source = mountableSource(block)
  if (source !== null) mountMermaidCard(block, source)
}

/** 内容启发式：源码首行能识别出图表类型（flowchart / erDiagram…）即认为像 mermaid。 */
function looksLikeMermaid(source: string): boolean {
  return source.trim() !== '' && mermaidKindOf(source) !== 'mermaid'
}

/** 旧判据兜底：DOM 语言 OR 内容启发式 + 400ms 窗口（chat 的 DOM 语言恒为「代码块」）。 */
function considerByWindow(block: Element, round: number): void {
  const source = mermaidSourceOf(block)
  const byDom = isMermaidBlock(block, false)
  if (!byDom && !looksLikeMermaid(source)) return
  const mountable = mountableSource(block)
  if (mountable !== null) watchStream(block, mountable, round)
}

/** 扫描 root（自身 / 后代）内的会话滚动容器里的 mermaid 代码块。 */
function scanMermaidBlocks(root: Element, round: number): void {
  const scrolls: Element[] = root.matches && root.matches('[data-conversation-scroll]') ? [root] : []
  if (root.querySelectorAll) scrolls.push(...root.querySelectorAll('[data-conversation-scroll]'))
  // **增量渲染**：只登记，块进入视口才判定是否 mermaid 并渲染（图谱分析 / 布局都在回调里）。
  // round 是「本批次」标记，登记后已经过期，回调里统一用 0（各注入点自身的幂等判定负责去重）。
  for (const sc of scrolls) {
    for (const block of sc.querySelectorAll('div.md-code-block')) {
      enqueueWhenVisible(block, 'mermaid', () => considerMermaidBlock(block, 0))
    }
  }
}

/** teardown：清掉全部观察与挂载记录（observer 断连由共享骨架负责）。 */
function teardownMermaid(): void {
  for (const block of Array.from(mmStreamWatch.keys())) clearStreamWatch(block)
  mmMounts.clear()
}

exports.STREAM_SETTLE_MS = STREAM_SETTLE_MS
exports.MM_FENCE_LANGS = MM_FENCE_LANGS
exports.mmSkipKindLine = mmSkipKindLine
exports.mmCanonicalKind = mmCanonicalKind
exports.mermaidKindOf = mermaidKindOf
exports.mermaidTitleOf = mermaidTitleOf
exports.isMermaidBlock = isMermaidBlock
exports.mermaidSourceOf = mermaidSourceOf
exports.fenceTrustOf = fenceTrustOf
exports.installFenceCloseRescan = installFenceCloseRescan
exports.dropFenceSubscription = dropFenceSubscription
exports.ensureFenceSubscription = ensureFenceSubscription
exports.mountableSource = mountableSource
exports.looksLikeMermaid = looksLikeMermaid
exports.considerStreaming = considerStreaming
exports.considerByWindow = considerByWindow
exports.considerMermaidBlock = considerMermaidBlock
exports.scanMermaidBlocks = scanMermaidBlocks
exports.teardownMermaid = teardownMermaid
