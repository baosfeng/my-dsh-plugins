// ── 扫描器：MutationObserver 跟随流式渲染 ──────────────────────────
// 精简后只保留两个真增量注入点（官方已内置表格 / 公式 / 代码块能力，
// DOM 层不再做任何渲染接管）：
//  - 上下文注入块（pre[data-context-text]，宿主 ContextBody 的纯文本渲染
//    —— 子 agent 消息 / AGENTS.md 注入等）走 context-markdown 的渲染；
//  - text / plaintext / txt 围栏块走 text-markdown 的渲染 + 每块「查看原文」
//    切换。
// 流式门控 / 幂等标记都在各自模块内（scanner 只负责枚举与调用）。
function scanNode(seen: Set<Node>, node: Node): void {
  if (!node || typeof (node as Element).querySelectorAll !== 'function') return
  const el = node as Element
  if (typeof el.matches === 'function' && el.matches(CONTEXT_TEXT_SELECTOR)) applyContextMarkdown(el)
  scanContextBlocks(el)
  scanTextBlocks(el)
}

/** 共享 DOM 扫描骨架（dsh-shared/client-parts/dom-scanner.part.js，构建期拼接）。 */
declare function installDomScanner(options: {
  scan: (node: Node, round: number) => void
  rescanSelectors?: string[]
  attributeFilter?: string[]
  onTeardown?: () => void
}): () => void

/** 观察 body；返回观察器 disposer。
 *  骨架（观察配置 / 批次轮次 / disposer）来自共享 part（与 dsh-mermaid-render
 *  同一份），本插件的特有策略全部留在 scanNode 内；seen 集合保留给调用方
 *  语义（宿主重渲染后新节点仍会被处理）。 */
function installScanner(): () => void {
  const seen = new Set<Node>()
  return installDomScanner({
    scan: (node) => scanNode(seen, node),
    // 兜底重扫目标：会话滚动容器（流式结束后内容补全，不一定以 addedNodes 出现）。
    rescanSelectors: ['[data-conversation-scroll]'],
  })
}
