// ── shared DOM scanner skeleton (dsh-shared/client-parts) ──
// 单一来源（issue #186 P2）：dsh-md-render（parts/scanner.ts：表格增强 + #196
// 上下文块接管 + #205 轨迹视图接管）与 dsh-mermaid-render（client/index.ts：
// mermaid 卡片挂载 / 流式闭合判定）各自的 MutationObserver 骨架结构等价，收口到这里。
//
// 共享的只是**骨架**：观察 body、把新增元素与兜底重扫目标交给插件的 scan 回调、
// 维护批次轮次、返回 disposer。各插件的特有策略全部留在 scan 回调里（本 issue
// 的一条硬约束：共享化不得削掉 #185/#195/#196/#205 的任何行为）：
//  - dsh-md-render：流式内容门控（[data-streaming] 祖先跳过）、幂等 seen 集合、
//    上下文注入块 / 轨迹视图接管、宿主契约不匹配时的静默降级；
//  - dsh-mermaid-render：围栏闭合判定（settleStream）、离屏渲染、自愈卸载，
//    以及 teardown 时清理挂载表 / 流式观察表（经 onTeardown 注入）。
/**
 * 观察 body 的 DOM 变更（子节点 + data-streaming 属性），把新增元素与兜底重扫
 * 目标交给 scan 回调；返回 disposer。
 *
 * @param {{
 *   scan: (node: Node, round: number) => void
 *   rescanSelectors?: string[]
 *   attributeFilter?: string[]
 *   onTeardown?: () => void
 * }} options
 *   - scan：处理一个节点（新增元素，或重扫容器的根）。round 是本次批次的递增序号，
 *     同一批次内所有 scan 调用共享它（插件可用它做「本批次只挂载一次」判定）
 *   - rescanSelectors：每次变更后兜底重扫的选择器（流式结束、虚拟列表行回收等
 *     不产生 addedNodes 的内容变化）
 *   - attributeFilter：触发重扫的属性名（默认 ['data-streaming']）
 *   - onTeardown：disposer 被调用时（fiber 卸载 / HMR）的清理钩子
 * @returns {() => void} 观察器 disposer
 */
function installDomScanner(options) {
  const rescanSelectors = options.rescanSelectors ?? []
  const attributeFilter = options.attributeFilter ?? ['data-streaming']
  let round = 0
  options.scan(document.body, ++round)
  const observer = new MutationObserver((mutations) => {
    const current = ++round
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType === 1) options.scan(added, current)
      }
    }
    // 兜底重扫：流式结束后的内容补全 / 轨迹视图虚拟列表回收不一定以 addedNodes
    // 形式出现，按选择器整体重扫，保证最终一致。
    for (const selector of rescanSelectors) {
      for (const el of document.querySelectorAll(selector)) options.scan(el, current)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter })
  return () => {
    observer.disconnect()
    if (options.onTeardown) options.onTeardown()
  }
}
