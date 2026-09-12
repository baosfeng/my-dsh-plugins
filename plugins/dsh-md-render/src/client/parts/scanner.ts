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
  if (typeof el.matches === 'function' && (el.matches('div.tzx-md') || el.matches('div.md-table-wide'))) {
    scanContainer(seen, el)
    return
  }
  for (const c of el.querySelectorAll('div.tzx-md, div.md-table-wide')) {
    scanContainer(seen, c)
  }
}

/** 观察 body；返回观察器 disposer。 */
function installScanner(): () => void {
  const seen = new Set<Node>()
  scanNode(seen, document.body)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType === 1) scanNode(seen, added)
      }
    }
    // 兜底重扫：流式结束后容器内容变化（新增段落 / 表格文本补全），
    // 对已知滚动容器重扫，保证流式中的表格最终被渲染。
    for (const sc of document.querySelectorAll('[data-conversation-scroll]')) {
      scanNode(seen, sc)
    }
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-streaming'],
  })
  return () => observer.disconnect()
}
