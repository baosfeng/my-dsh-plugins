// ── 自有渲染容器的 React root 管理（不再依赖官方组件）────────────────────
// 用户口径（最高优先级）：「markdown 需要全部替换为我们自己的渲染」「代码渲染使用我们自己的」。
// 本插件插入的容器里跑的是**自研渲染器**产出的 vdom，由平台 seed 模块
// react-dom/client 的 createRoot 落到 DOM（与 mermaid 卡片同一手法，零安装零打包）。
// 本模块不再 require 官方 UI 组件库（ui-primitives）—— 官方 MarkdownText / CodeBlock
// 已完全不参与本插件的内容渲染。
//
// 只保留两件事：
//  1. 解析 react-dom/client（缺失 → 真降级：DOM 注入点不动宿主 DOM、MarkdownView 落 <pre>）；
//  2. 「容器 → root」映射（可枚举 + WeakRef）：宿主重渲染把容器连节点一起抹掉时，
//     悬挂的 React root 必须 unmount，否则 root 与 fiber 树一直活着。

/** 平台模块解析结果（缓存；undefined = 尚未解析）。 */
interface DomRootPlatform {
  createRoot: ((container: Element) => MarkdownRoot) | null
}

/** 容器上的 React root（render / unmount 两个动作）。 */
interface MarkdownRoot {
  render: (node: unknown) => void
  unmount: () => void
}

let domRootPlatform: DomRootPlatform | null | undefined

/** 解析 react-dom/client（字面量 spec：check-client-modules.mjs 以 AST 提取字面量 require）。 */
function platformDomRoot(): DomRootPlatform | null {
  if (domRootPlatform !== undefined) return domRootPlatform
  let createRoot: unknown = null
  try {
    const reactDomClient = require('react-dom/client')
    createRoot = reactDomClient ? reactDomClient.createRoot : null
  } catch (_e) {
    createRoot = null
  }
  domRootPlatform =
    typeof createRoot === 'function' ? { createRoot: createRoot as DomRootPlatform['createRoot'] } : null
  return domRootPlatform
}

/** 自研渲染器的挂载能力是否可用（react-dom/client 在）。 */
function domRootAvailable(): boolean {
  const platform = platformDomRoot()
  return platform !== null && platform.createRoot !== null
}

/**
 * 容器 → React root。
 *
 * 用 `Map` + `WeakRef` 而不是 `WeakMap`：**需要能枚举**以清扫「宿主把容器连同
 * 我们的节点一起重渲染掉」留下的悬挂 root（容器已脱离文档 → 必须 unmount，否则
 * React root 与其 fiber 树一直活着）。WeakRef 保证条目不会让容器本身无法回收。
 */
const markdownRoots = new Map<WeakRef<Element>, MarkdownRoot>()

/** 取出仍存活且与当前容器一致的 root。 */
function rootOf(container: Element): MarkdownRoot | undefined {
  for (const [ref, root] of markdownRoots) {
    if (ref.deref() === container) return root
  }
  return undefined
}

/** 记下容器与 root 的对应（先清掉同一容器的旧条目，避免重复登记）。 */
function trackRoot(container: Element, root: MarkdownRoot): void {
  forgetRoot(container)
  markdownRoots.set(new WeakRef(container), root)
}

/** 忘掉某容器的条目（不 unmount，调用方决定）。 */
function forgetRoot(container: Element): void {
  for (const [ref, _root] of markdownRoots) {
    if (ref.deref() === container) markdownRoots.delete(ref)
  }
}

/** 容器是否已脱离文档（`isConnected` 优先，缺失时退回 `parentNode` 判定）。 */
function isDetached(container: Element): boolean {
  if (typeof (container as { isConnected?: unknown }).isConnected === 'boolean') {
    return (container as { isConnected: boolean }).isConnected === false
  }
  const body = typeof document !== 'undefined' && document !== null ? document.body : null
  if (body === null || body === undefined) return false
  let node: Element | null = container
  while (node !== null && node !== undefined) {
    if (node === (body as unknown as Element)) return false
    node = (node.parentNode as Element | null) ?? null
  }
  return true
}

/**
 * 清扫悬挂 root：容器已脱离文档（宿主重渲染把我们的节点抹掉 / 整个节点被替换）
 * 或已被 GC → unmount 并移除条目。每轮扫描开头调用一次（容器数量是「被接管的
 * 块数」，量级很小）。
 */
function sweepDetachedRoots(): void {
  for (const [ref, root] of markdownRoots) {
    const container = ref.deref()
    if (container === undefined) {
      markdownRoots.delete(ref)
      continue
    }
    if (isDetached(container)) {
      markdownRoots.delete(ref)
      try {
        root.unmount()
      } catch (_e) {
        /* 卸载异常不阻断清扫 */
      }
    }
  }
}

/**
 * 把 vdom 渲染进容器（复用容器上已有的 root）。
 * @returns react-dom/client 不可用 → false（调用方保持宿主原样，真降级）。
 */
function renderNodeInto(container: Element, node: unknown): boolean {
  const platform = platformDomRoot()
  if (platform === null || platform.createRoot === null) return false
  let root = rootOf(container)
  if (root === undefined) {
    root = platform.createRoot(container)
    trackRoot(container, root)
  }
  root.render(node)
  return true
}

/**
 * 把 markdown 原文渲染进容器（**自研渲染器**；表格容错在 markdownNodes 内）。
 * @returns marked 未就绪 / react-dom 不可用 → false（调用方保持宿主原样）。
 */
function renderMarkdownInto(container: Element, text: unknown): boolean {
  const nodes = markdownNodes(text)
  if (nodes === null) return false
  return renderNodeInto(container, nodes)
}

/** 卸载容器上的 React root（容器内容被重建/清理前调用，避免悬挂 root）。 */
function unmountMarkdownIn(container: Element): void {
  const root = rootOf(container)
  if (root === undefined) return
  forgetRoot(container)
  try {
    root.unmount()
  } catch (_e) {
    /* 卸载异常不阻断调用方清理 DOM */
  }
}

exports.platformDomRoot = platformDomRoot
exports.domRootAvailable = domRootAvailable
exports.renderNodeInto = renderNodeInto
exports.renderMarkdownInto = renderMarkdownInto
exports.unmountMarkdownIn = unmountMarkdownIn
exports.sweepDetachedRoots = sweepDetachedRoots
