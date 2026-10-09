// ── 扫描器：**单一** MutationObserver，按语言分流 ────────────────────────
// 合并前 dsh-md-render 与 dsh-mermaid-render 各装一个 MutationObserver（同一条 body
// 被两路观察）；合并后收敛为**一个**（issue #463 决策 2），扫描顺序固定：
//
//   1. 思考行（think）—— 只看新增节点内的官方折叠行，最轻；
//   2. 上下文注入块（pre[data-context-text]）；
//   3. text / plaintext / txt 围栏块；
//   4. mermaid / mmd 围栏块 —— 必须最后（它会给块写视图标记，与 3 的判定互斥，
//      语言集合不重叠；放最后保证「先按语言分流、再决定接管者」的顺序稳定）。
//
// 各注入点自身幂等（签名 / WeakSet / mounts Map），scanner 只负责枚举与调用。

/** 共享 DOM 扫描骨架（dsh-shared/client-parts/dom-scanner.part.js，构建期拼接）。 */
declare function installDomScanner(options: {
  scan: (node: Node, round: number) => void
  rescanSelectors?: string[]
  attributeFilter?: string[]
  onTeardown?: () => void
}): () => void

/** 扫描单个节点（含自身）内的全部注入点。 */
function scanNode(node: Node, round: number): void {
  if (!node || typeof (node as Element).querySelectorAll !== 'function') return
  // 悬挂 root 清扫：宿主重渲染把我们的容器抹掉时，对应的 React root 必须卸载
  // （否则 root + fiber 树一直活着）。放在最前，先释放再重建。
  sweepDetachedRoots()
  const el = node as Element
  applyThinkExpand(el)
  if (typeof el.matches === 'function' && el.matches(CONTEXT_TEXT_SELECTOR)) applyContextMarkdown(el)
  scanContextBlocks(el)
  scanTextBlocks(el)
  scanMermaidBlocks(el, round)
}

/** 观察 body；返回观察器 disposer（骨架负责观察配置 / 批次轮次 / disposer）。 */
function installScanner(): () => void {
  return installDomScanner({
    scan: (node, round) => scanNode(node, round),
    // 兜底重扫目标：会话滚动容器（流式结束后内容补全，不一定以 addedNodes 出现）。
    rescanSelectors: ['[data-conversation-scroll]'],
    onTeardown: () => teardownMermaid(),
  })
}

exports.installScanner = installScanner
