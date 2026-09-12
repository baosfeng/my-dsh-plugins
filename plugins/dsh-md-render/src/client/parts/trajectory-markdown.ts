// ── 轨迹视图 markdown 接管（issue #205）──────────────────────────
// 宿主 @deepseek-ai/dsh-client-ui-trajectory 的 MarkdownFragment 在
// rendered 模式下把 markdown 交给 @deepseek-ai/dsh-client-ui-primitives
// 的 MarkdownText 渲染（bundle 证据见 PR 正文）：
//
//   <div class="<hash>_markdownPayload|<hash>_markdownPreview">
//     <div class="_markdown_<hash>">…宿主渲染的 HTML…</div>
//   </div>
//
// 外层包裹在 <div data-trajectory-scroll>（TrajectoryTable 滚动面板）内。
// 宿主渲染的 markdown 完全不享本插件增强（无表格滚动容器/排序/折叠、
// 无代码高亮/行号/复制按钮、无公式结构渲染）；本模块在 DOM 层接管：
//
//  - **原文来源**：DOM 里只有渲染结果，markdown 原文只存在于 React fiber
//    上（MarkdownFragment 的 memoizedProps.text）。沿 `__reactFiber$*` 向上
//    有限跳数读取；拿不到 → 静默降级（保持宿主渲染，不报错、不改 DOM）。
//  - **接管方式**：在宿主容器**之前**插入 div.tzx-md（+ 整段复制按钮），
//    把宿主容器置 hidden——不改宿主子结构（React 拥有该子树，改子结构会
//    被 text diff 冲掉），与 issue #196 的上下文块接管同一模式。
//  - **幂等**：容器记 data-signature（长度 + djb2 哈希），文本未变且容器
//   在位 → 跳过；宿主重建（虚拟列表回收 / 重渲染）后由 MutationObserver
//    兜底重扫重建。
//  - **内容门控**：只有确实含增强目标的块才接管（表格 / 公式 / 围栏代码
//    块）。实测工作区 70 个会话 2262 个 markdown 文本块：表格 2.6%、
//    代码块 1.0%、公式 0.0%，字符数 p50 = 51 —— 全量接管对 96% 的短文本
//    无收益却要付 DOM 替换与虚拟列表行高重算成本，故按内容门控。
//  - **性能保护**：单块超过 MAX_TRAJECTORY_CHARS 跳过。
//  - **作用域隔离**：只在 div[data-trajectory-scroll] 子树内工作，主会话
//    （[data-conversation-scroll]）与思考块（div.tzx-md）路径不受影响。

/** 轨迹视图滚动面板（宿主 TrajectoryTable 的稳定 data 契约）。 */
const TRAJECTORY_SCROLL_SELECTOR = 'div[data-trajectory-scroll]'
/** 轨迹视图 markdown 容器（CSS module 哈希前缀会变，取稳定语义段）。 */
const TRAJECTORY_MARKDOWN_SELECTOR = 'div[class*="markdownPayload"], div[class*="markdownPreview"]'
/** 宿主 MarkdownText 输出（ui-primitives），用于二次确认容器契约。 */
const TRAJECTORY_RENDERED_SELECTOR = 'div[class*="_markdown_"]'
/** 已处理标记（写在宿主容器上，React 不管理该属性）。 */
const TRAJECTORY_APPLIED = 'applied'
/** 渲染容器标记（写在插入的 div 上）。 */
const TRAJECTORY_BODY_ATTR = 'data-dsh-md-render-trajectory-body'
/** 宿主容器上的接管标记属性名。 */
const TRAJECTORY_MARKER_ATTR = 'data-dsh-md-render-trajectory'
/** 单块渲染上限（字符）；超过则保持宿主渲染。 */
const MAX_TRAJECTORY_CHARS = 200000
/** React fiber 的最小结构契约（只读 memoizedProps.text）。 */
interface FiberLike {
  memoizedProps?: { text?: unknown } | null
  return?: unknown
}

/** 沿 fiber 向上查找 memoizedProps.text 的最大跳数（实测 1~2 跳）。 */
const TRAJECTORY_FIBER_HOPS = 12
/** 向上寻找轨迹视图根的最大跳数（详情面板实测 6 跳）。 */
const TRAJECTORY_ROOT_HOPS = 14

/** djb2 字符串哈希（签名用，非加密）。 */
function trajectoryHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** 从一条 fiber 链向上找第一个带 string `text` prop 的 memoizedProps。 */
function searchFiberText(start: unknown): string | null {
  let fiber = start as FiberLike | null
  for (let hops = 0; fiber !== null && fiber !== undefined && hops < TRAJECTORY_FIBER_HOPS; hops += 1) {
    const props = fiber.memoizedProps
    if (props !== undefined && props !== null && typeof props.text === 'string') return props.text
    fiber = (fiber.return ?? null) as FiberLike | null
  }
  return null
}

/** 从宿主容器读 markdown 原文（React fiber 的 memoizedProps.text）。 */
function readTrajectorySource(el: Element): string | null {
  const keys = typeof Object.keys === 'function' ? Object.keys(el) : []
  for (const key of keys) {
    if (key.indexOf('__reactFiber$') !== 0) continue
    const found = searchFiberText(el[key])
    if (found !== null) return found
  }
  return null
}

/**
 * 内容门控：是否含本插件能增强的内容（表格 / 公式 / 围栏代码块）。
 * 用 parseTable 判定表格（与渲染同一套宽容规则，避免"门控说没有、渲染
 * 却有"的不一致）。
 */
function needsTrajectoryEnhancement(text: string): boolean {
  if (/^```[A-Za-z0-9_+-]*\s*$/m.test(text)) return true
  if (/\$\$/.test(text)) return true
  if (renderOptions.mathStructures && /(?<![\w$])\$[^$\n]+?\$(?![\w$])/.test(text)) return true
  return parseTable(text) !== null
}

/** 容器契约确认：宿主容器内确有 MarkdownText 输出（避免误伤同名前缀类名）。 */
function isTrajectoryMarkdownHost(el: Element): boolean {
  if (typeof el.querySelector !== 'function') return false
  return el.querySelector(TRAJECTORY_RENDERED_SELECTOR) !== null
}

/** 节点是否直接含轨迹视图滚动面板（TrajectoryTable 根：表窗格 + 详情面板）。 */
function hasTrajectoryPaneChild(node: Element): boolean {
  const kids = node.children
  if (!kids) return false
  for (let i = 0; i < kids.length; i += 1) {
    const kid = kids[i]
    if (kid.nodeType === 1 && typeof kid.matches === 'function' && kid.matches(TRAJECTORY_SCROLL_SELECTOR)) return true
  }
  return false
}

/**
 * 作用域确认：元素属于轨迹视图。两条路径都覆盖——
 *  (a) 在滚动面板内（行内展开的 preview 块）；
 *  (b) 在"直接含滚动面板的祖先"内（详情面板 aside，与滚动面板同级）。
 * 上游契约改名/改结构时返回 false → 静默退让，不误伤其它视图。
 */
function inTrajectoryView(el: Element): boolean {
  if (typeof el.closest === 'function' && el.closest(TRAJECTORY_SCROLL_SELECTOR) !== null) return true
  let node: Element | null = el.parentElement ?? null
  let hops = 0
  while (node !== null && hops < TRAJECTORY_ROOT_HOPS) {
    if (hasTrajectoryPaneChild(node)) return true
    node = node.parentElement ?? null
    hops += 1
  }
  return false
}

/** 取已在位的渲染容器（宿主容器的前一个兄弟且带标记）。 */
function trajectoryBodyOf(el: Element): Element | null {
  const prev = el.previousElementSibling
  return prev !== null && prev.getAttribute(TRAJECTORY_BODY_ATTR) === 'true' ? prev : null
}

/**
 * 取该容器应渲染的 markdown 原文；任一前置条件不满足返回 null（静默退让）：
 * 容器契约 / 轨迹视图作用域 / fiber 原文 / 长度上限 / 内容门控。
 */
function trajectorySourceFor(el: Element): string | null {
  if (!isTrajectoryMarkdownHost(el)) return null
  if (!inTrajectoryView(el)) return null
  const text = readTrajectorySource(el)
  if (text === null || text === '') return null
  if (text.length > MAX_TRAJECTORY_CHARS) return null
  return needsTrajectoryEnhancement(text) ? text : null
}

/** 构建接管渲染容器（div.tzx-md + 幂等签名 + 整段复制按钮）。 */
function buildTrajectoryBody(text: string, signature: string): Element {
  const body = document.createElement('div')
  body.className = 'tzx-md dsh-md-render-trajectory-md'
  body.setAttribute(TRAJECTORY_BODY_ATTR, 'true')
  body.setAttribute('data-signature', signature)
  body.appendChild(renderDomMarkdown(text))
  if (renderOptions.copyButton) body.appendChild(domCopyButton(body, 'content'))
  return body
}

/** 幂等应用：文本未变且容器在位 → 跳过；否则（重）渲染并隐藏宿主容器。 */
function applyTrajectoryMarkdown(el: Element): void {
  const parent = el.parentNode as Element | null
  if (!parent || typeof parent.insertBefore !== 'function') return
  const text = trajectorySourceFor(el)
  if (text === null) return
  const signature = String(text.length) + ':' + trajectoryHash(text)
  const existing = trajectoryBodyOf(el)
  if (existing && existing.getAttribute('data-signature') === signature) return
  if (existing) parent.removeChild(existing)
  parent.insertBefore(buildTrajectoryBody(text, signature), el)
  el.setAttribute(TRAJECTORY_MARKER_ATTR, TRAJECTORY_APPLIED)
  ;(el as HTMLElement).hidden = true
}

/** 扫描 root 内的轨迹视图 markdown 块（供 scanner 调用）。
 *  作用域与契约校验都在 applyTrajectoryMarkdown 内，这里只做候选枚举
 *  （轨迹视图的 markdown 容器既可能在滚动面板内，也可能在详情面板里，
 *  后者与滚动面板同级——所以不能只从滚动面板往下找）。 */
function scanTrajectoryBlocks(root: Element): void {
  if (!root || typeof root.querySelectorAll !== 'function') return
  if (typeof root.matches === 'function' && root.matches(TRAJECTORY_MARKDOWN_SELECTOR)) {
    applyTrajectoryMarkdown(root)
  }
  for (const el of Array.from(root.querySelectorAll(TRAJECTORY_MARKDOWN_SELECTOR))) {
    applyTrajectoryMarkdown(el)
  }
}

exports.TRAJECTORY_SCROLL_SELECTOR = TRAJECTORY_SCROLL_SELECTOR
exports.TRAJECTORY_MARKDOWN_SELECTOR = TRAJECTORY_MARKDOWN_SELECTOR
exports.TRAJECTORY_RENDERED_SELECTOR = TRAJECTORY_RENDERED_SELECTOR
exports.MAX_TRAJECTORY_CHARS = MAX_TRAJECTORY_CHARS
exports.applyTrajectoryMarkdown = applyTrajectoryMarkdown
exports.scanTrajectoryBlocks = scanTrajectoryBlocks
exports.readTrajectorySource = readTrajectorySource
exports.needsTrajectoryEnhancement = needsTrajectoryEnhancement
