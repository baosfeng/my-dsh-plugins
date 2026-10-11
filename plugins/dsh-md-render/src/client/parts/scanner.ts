// ── 扫描器：**单一** MutationObserver，按语言分流 ────────────────────────
// 合并前 dsh-md-render 与 dsh-mermaid-render 各装一个 MutationObserver（同一条 body
// 被两路观察）；合并后收敛为**一个**（issue #463 决策 2），扫描顺序固定：
//
//   1. 思考行（think）—— 只看新增节点内的官方折叠行，最轻；
//   2. 上下文注入块（pre[data-context-text]）；
//   3. 围栏块（自研 markdown / 自研代码块，mermaid 除外）；
//   4. mermaid / mmd 围栏块 —— 必须最后（它会给块写视图标记，与 3 的判定互斥，
//      语言集合不重叠；放最后保证「先按语言分流、再决定接管者」的顺序稳定）。
//
// 各注入点自身幂等（签名 / WeakSet / mounts Map），scanner 只负责枚举与调用。
//
// **每批扫描前先刷新围栏语言索引**（lang-source.ts）：本插件的语言判定主源是 client 侧
// 会话事件流索引（历史会话 + 冷启动唯一能命中的来源），它按事件源 `revision` 增量维护 ——
// revision 未变时刷新函数内部直接返回（成本 = 几个属性读）。放在最前：本轮所有块的
// 语言判定都该看到**同一份**表。取不到会话服务 / 任何异常 → 空表 → 全链路退回原有
// DOM 契约读法（行为与修复前一致）。

/** 共享 DOM 扫描骨架（dsh-shared/client-parts/dom-scanner.part.js，构建期拼接）。 */
declare function installDomScanner(options: {
  scan: (node: Node, round: number) => void
  rescanSelectors?: string[]
  attributeFilter?: string[]
  onTeardown?: () => void
}): () => void

/** 扫描器持有的宿主 ctx（apply 时传入；只用于按需读会话事件流，见 lang-source.ts）。 */
let fenceScanContext: unknown = null

/** 扫描单个节点（含自身）内的全部注入点。 */
function scanNode(node: Node, round: number): void {
  if (!node || typeof (node as Element).querySelectorAll !== 'function') return
  // 悬挂 root 清扫：宿主重渲染把我们的容器抹掉时，对应的 React root 必须卸载
  // （否则 root + fiber 树一直活着）。放在最前，先释放再重建。
  sweepDetachedRoots()
  // 围栏语言表按批刷新（lang-source.ts）：事件源 revision 未变则内部直接返回。
  // 放在注入点之前：本轮所有块的语言判定共用同一份表（历史会话冷启动靠它命中）。
  refreshFenceLangIndex(fenceScanContext)
  const el = node as Element
  applyThinkExpand(el)
  if (typeof el.matches === 'function' && el.matches(CONTEXT_TEXT_SELECTOR)) applyContextMarkdown(el)
  scanContextBlocks(el)
  scanFenceBlocks(el)
  scanMermaidBlocks(el, round)
  // 4. 语言手动切换控件（需求 4）—— 最后：mermaid 卡片挂载会决定该块用卡片头还是块内控件。
  scanLangSwitches(el)
}

/** 重扫轮次（语言索引回调专用；与骨架的批次轮次分开计数，避免伪装成同一批）。 */
let langRescanRound = 0

/** 会话滚动容器选择器（与骨架的 rescanSelectors 取同一契约）。 */
const CONVERSATION_SCROLL_SELECTOR = '[data-conversation-scroll]'

/**
 * 语言索引命中（或重试）后的重扫：只扫会话滚动容器，全部注入点幂等（不会重复挂载）。
 * **容器本身也要算**：querySelectorAll 只找后代，容器若就是扫描根（精简页面 / 测试夹具里
 * body 即容器）会一条都匹配不到 —— 那会让「命中后重扫」静默失效。
 */
function rescanForLangs(): void {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return
  langRescanRound += 1
  const roots = [...document.querySelectorAll(CONVERSATION_SCROLL_SELECTOR)]
  const body = document.body
  if (body && typeof body.matches === 'function' && body.matches(CONVERSATION_SCROLL_SELECTOR)) roots.push(body)
  for (const root of roots) scanNode(root, langRescanRound)
}

/**
 * 观察 body；返回观察器 disposer（骨架负责观察配置 / 批次轮次 / disposer）。
 * `ctx` 只被 lang-source.ts 用来惰性读会话事件流（**刻意不声明 inject**，见该文件头部
 * 的 R1 实测结论）；不传 / 精简上下文 → 索引恒为空 → 退回原有 DOM 契约读法。
 */
function installScanner(ctx?: unknown): () => void {
  fenceScanContext = ctx ?? null
  const uninstallRescan = installLangRescan(rescanForLangs)
  // 懒加载的渲染库（marked / hljs）就绪后重扫一次：加载期间落在「宿主官方形态」的块补渲染
  // （代码块则从纯文本换成高亮 —— 签名含就绪版本，重扫会重建）。
  const uninstallAssetReady = installRenderAssetReady(rescanForLangs)
  const dispose = installDomScanner({
    scan: (node, round) => scanNode(node, round),
    // 兜底重扫目标：会话滚动容器（流式结束后内容补全，不一定以 addedNodes 出现）。
    rescanSelectors: ['[data-conversation-scroll]'],
    onTeardown: () => {
      teardownMermaid()
      teardownZoom()
      teardownLangProbes()
      teardownRenderAssets()
      resetFenceIndex()
    },
  })
  return () => {
    dispose()
    uninstallRescan()
    uninstallAssetReady()
  }
}

exports.installScanner = installScanner
