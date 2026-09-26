// ── 官方渲染器接入（平台 MarkdownText + react-dom/client）─────────────
// 本插件**不再自实现 markdown 渲染**：GFM 表格（对齐 / 宽表格横向滚动）、
// 公式（micromark-extension-math + KaTeX）、代码块（shiki 高亮 / 语言标签 /
// 行号 / 复制按钮 / 主题）全部由宿主官方
// @deepseek-ai/dsh-client-ui-primitives 的 MarkdownText 提供（0.1.7-rc.2
// 起内置）。本模块只负责两件事：
//  1. 解析平台模块：两个 spec 都在宿主 staticModules seed 表里
//     （react-dom/client、@deepseek-ai/dsh-client-ui-primitives），
//     零安装零打包（白名单见 scripts/check-client-modules.mjs 的
//     SEED_MODULES）；
//  2. 把官方组件渲染到**本插件插入的容器**里（react-dom/client.createRoot，
//     与 dsh-mermaid-render 同一手法；注入点才是本插件的真增量）。
//
// 降级（真降级，不是假降级）：官方组件或 createRoot 取不到时 ——
//   · MarkdownView（公共 API）落 <pre> 兜底：原文不丢、渲染期不抛错；
//   · DOM 注入点（text 围栏 / 上下文块）**不动宿主 DOM**，保持宿主原样。
// labels 必填（官方 MarkdownText 没有默认值，渲染含围栏代码块的文档会读
// labels.code.copyLabel），本插件按自己的中文界面硬编码。

const PLATFORM_MARKDOWN_MODULE = '@deepseek-ai/dsh-client-ui-primitives'
const PLATFORM_MARKDOWN_EXPORT = 'MarkdownText'

/** 官方 MarkdownText 的 labels 契约（MarkdownLabels：code + footnotes）。 */
const MARKDOWN_LABELS = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
  footnotes: '脚注',
}

/** React 语义的组件判定：函数，或带 $$typeof 的对象（memo/forwardRef/lazy）。 */
function isRenderableComponent(value: unknown): boolean {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null && typeof (value as { $$typeof?: unknown }).$$typeof === 'symbol'
}

/** 平台模块解析结果（缓存；undefined = 尚未解析）。 */
interface PlatformMarkdown {
  MarkdownText: unknown
  createRoot: ((container: Element) => { render: (node: unknown) => void; unmount: () => void }) | null
}

let platformCache: PlatformMarkdown | null | undefined

/** 解析官方 MarkdownText 与 createRoot；任一缺失返回 null（真降级起点）。 */
function platformMarkdown(): PlatformMarkdown | null {
  if (platformCache !== undefined) return platformCache
  let MarkdownText: unknown = null
  let createRoot: unknown = null
  // 字面量 spec：scripts/check-client-modules.mjs 以 AST 提取字面量 require 并逐条
  // 判定是否在允许集合内（平台 seed 表 / dsh.client.external / 自身包名）——写成变量
  // 会让这条门禁看不见依赖，等于绕开门禁。
  try {
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    MarkdownText = primitives ? primitives[PLATFORM_MARKDOWN_EXPORT] : null
  } catch (_e) {
    MarkdownText = null
  }
  try {
    const reactDomClient = require('react-dom/client')
    createRoot = reactDomClient ? reactDomClient.createRoot : null
  } catch (_e) {
    createRoot = null
  }
  platformCache = isRenderableComponent(MarkdownText)
    ? {
        MarkdownText,
        createRoot: typeof createRoot === 'function' ? (createRoot as PlatformMarkdown['createRoot']) : null,
      }
    : null
  return platformCache
}

/** 官方 MarkdownText 是否可用于 DOM 注入（组件 + createRoot 都在）。 */
function officialMarkdownAvailable(): boolean {
  const platform = platformMarkdown()
  return platform !== null && platform.createRoot !== null
}

/** 容器 → React root（WeakMap：容器被宿主回收后不留引用）。 */
const markdownRoots = new WeakMap<Element, { render: (node: unknown) => void; unmount: () => void }>()

/**
 * 把 markdown 原文渲染进容器（官方组件负责渲染，文本先过表格容错规范化）。
 * @returns 是否已渲染（官方组件不可用 → false，调用方保持宿主原样）。
 */
function renderMarkdownInto(container: Element, text: string): boolean {
  const platform = platformMarkdown()
  if (platform === null || platform.createRoot === null) return false
  let root = markdownRoots.get(container)
  if (root === undefined) {
    root = platform.createRoot(container)
    markdownRoots.set(container, root)
  }
  root.render(createElement(platform.MarkdownText, { text: normalizeTables(text), labels: MARKDOWN_LABELS }))
  return true
}

/** 卸载容器上的 React root（容器内容被重建/清理前调用，避免悬挂 root）。 */
function unmountMarkdownIn(container: Element): void {
  const root = markdownRoots.get(container)
  if (root === undefined) return
  markdownRoots.delete(container)
  try {
    root.unmount()
  } catch (_e) {
    /* 卸载异常不阻断调用方清理 DOM */
  }
}

/** MarkdownView 的内容节点：官方组件，或 <pre> 兜底（原文不丢）。 */
function officialMarkdownNode(text: string): unknown {
  const platform = platformMarkdown()
  if (platform === null) return createElement('pre', { className: 'dsh-md-render-fallback' }, text)
  return createElement(platform.MarkdownText, { text: normalizeTables(text), labels: MARKDOWN_LABELS })
}

exports.PLATFORM_MARKDOWN_MODULE = PLATFORM_MARKDOWN_MODULE
exports.MARKDOWN_LABELS = MARKDOWN_LABELS
exports.platformMarkdown = platformMarkdown
exports.officialMarkdownAvailable = officialMarkdownAvailable
exports.renderMarkdownInto = renderMarkdownInto
exports.unmountMarkdownIn = unmountMarkdownIn
exports.officialMarkdownNode = officialMarkdownNode
