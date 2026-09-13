// ── 扫描器：MutationObserver 跟随流式渲染 ──────────────────────
// 处理 tzx-md（think-zh-expand 的 MarkdownView 输出）与
// md-table-wide（内置 MarkdownText 的宽表格容器）内的表格段落：
//  - 流式中的容器（祖先带 [data-streaming]）跳过，等流式结束重扫；
//  - 已渲染的表格（容器内已有 table）不重复处理；
//  - 段落被替换为表格后记入 seen，避免重复处理。
// issue #196：上下文注入块（pre[data-context-text]，宿主 ContextBody 的
// 纯文本渲染——子 agent 消息 / AGENTS.md 注入等）走 context-markdown
// 的 DOM markdown 渲染；幂等标记在 pre/容器上，宿主重渲染后可重做。
function scanContainer(seen: Set<Node>, container: Element): void {
  if (container.closest && container.closest('[data-streaming]')) return
  const paragraphs = container.querySelectorAll('p.tzx-p')
  for (const p of paragraphs) {
    if (seen.has(p)) continue
    const table = parseTable(p.textContent ?? '')
    if (!table) continue
    const frag = renderTable(table)
    p.replaceWith(frag)
    seen.add(p)
  }
}

/** 扫描一个节点：上下文注入块 + 自身/内部的目标容器（表格增强）。 */
function scanNode(seen: Set<Node>, node: Node): void {
  if (!node || typeof (node as Element).querySelectorAll !== 'function') return
  const el = node as Element
  // issue #196：上下文注入块（pre[data-context-text]）的 markdown 渲染。
  if (typeof el.matches === 'function' && el.matches(CONTEXT_TEXT_SELECTOR)) applyContextMarkdown(el)
  scanContextBlocks(el)
  // issue #205：轨迹视图（div[data-trajectory-scroll]）内 markdown 的接管。
  scanTrajectoryBlocks(el)
  if (typeof el.matches === 'function' && (el.matches('div.tzx-md') || el.matches('div.md-table-wide'))) {
    scanContainer(seen, el)
    return
  }
  for (const c of el.querySelectorAll('div.tzx-md, div.md-table-wide')) {
    scanContainer(seen, c)
  }
}

/** 共享 DOM 扫描骨架（dsh-shared/client-parts/dom-scanner.part.js，构建期拼接；issue #186 P2）。 */
declare function installDomScanner(options: {
  scan: (node: Node, round: number) => void
  rescanSelectors?: string[]
  attributeFilter?: string[]
  onTeardown?: () => void
}): () => void

/** 观察 body；返回观察器 disposer。
 *  骨架（观察配置 / 批次轮次 / disposer）来自共享 part（与 dsh-mermaid-render 同一份），
 *  本插件的特有策略全部留在 scanNode 内：流式内容门控、幂等 seen 集合、
 *  上下文注入块接管（#196）、轨迹视图接管（#205）、宿主契约不匹配时的静默降级。 */
function installScanner(): () => void {
  const seen = new Set<Node>()
  return installDomScanner({
    scan: (node) => scanNode(seen, node),
    // 兜底重扫目标：会话滚动容器（流式结束后段落 / 表格文本补全）与轨迹视图
    // 虚拟列表容器（#205：滚动 / 行回收）——这两类变化不一定以 addedNodes 出现。
    rescanSelectors: ['[data-conversation-scroll]', TRAJECTORY_SCROLL_SELECTOR],
  })
}
