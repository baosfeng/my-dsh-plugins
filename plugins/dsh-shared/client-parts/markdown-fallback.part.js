// ── shared markdown render fallback (dsh-shared/client-parts) ──
// 单一来源（issue #299）：把「三级渲染回退」这段原本在 dsh-think-zh-expand（#293）
// 与 dsh-my-plugin-manager（#299）逐字重复的样板（约 40 行：三级解析 + labels
// 适配 + 组件可用性判定）收口到这里（ADR-0002 / docs/UI规范.md：同一段 UI 样板
// 出现 ≥2 处即抽出）。消费方各自 scripts/build.mjs 在构建期把本文件拼进
// __ModuleLoader__ factory 作用域（构建时源文件，不经过 require/exports 解析）。
//
// ⚠️ 边界：dsh-shared **npm 包**的 package.json `files` 只有 lib / README /
// CHANGELOG / LICENSE，**不含 client-parts** → 本部件**只在 monorepo 内有效**，
// 消费方不能改成 `require('dsh-shared/client-parts/...')`（发布出去的包里没有它）。
//
// 为什么必须是「真回退」（#290/#293 教训）：只把 require 包进 try/catch、把组件
// 变量置 null，而渲染路径没有 null 分支 → 渲染期抛
// `Element type is invalid: expected a string … but got: null`。那是**假降级**：
// 用户照样崩，只是崩在渲染而不是加载。降级 = 真的换掉被渲染的组件，且每一级都能
// 落到下一级（外部内核 → 平台官方组件 → 消费方 <pre>），渲染期永不抛错。
//
// 为什么可用性判定不能用 `typeof === 'function'`：宿主官方 MarkdownText 是
// `React.memo(...)` 返回的**对象**（真实宿主实测 object($$typeof,type,compare)，
// `typeof` 为 'object'）→ 会被判成不可用、直接落到最后一级（不再崩，但「用官方
// 组件渲染」落空）。故按 React 语义判定：优先 `react.isValidElementType`，
// 取不到时退化为「函数 或 带 $$typeof 的 symbol 对象」——实测 react 19 已不再
// 导出该 API、宿主 shell 里也被 tree-shake 掉，**退化式才是浏览器里实际生效的
// 路径**。两种判定都排除宿主标签字符串（'div' 之类垃圾导出值应落到下一级，
// 而不是渲染成未知标签）。
/**
 * 解析最终的 Markdown 渲染组件：外部内核 → 宿主平台官方组件 → 消费方兜底 `<pre>`。
 *
 * 返回组件签名固定 `(props: { text: string }) => ReactNode`，消费方当 MarkdownView
 * 直接用（跨插件 `declare const MarkdownView` 无需改动）。**无副作用**，可在 factory
 * 顶层调用一次。
 *
 * @param {{
 *   require: (spec: string) => any
 *   createElement: Function
 *   labels: object
 *   fallbackAttribute: string
 *   fallbackClassName?: string
 *   external?: string
 *   externalExport?: string
 *   platformModule?: string
 *   platformExport?: string
 * }} options
 *   - require / createElement：消费方 factory 作用域里的实例（本件不自行 require）
 *   - labels：**必填**。透传给平台 MarkdownText —— 它没有默认值，渲染含代码块的
 *     markdown 时会读 `labels.code.copyLabel`（不传即 TypeError）。文案由消费方
 *     提供，本共享件**不硬编码任何中文**
 *   - fallbackAttribute：兜底 `<pre>` 的标记属性名（值固定 `'true'`）。消费方各用
 *     自己的前缀，避免两个插件的 DOM 标记串味
 *   - fallbackClassName：兜底 `<pre>` 的 class（消费方既有契约可保留，可选）
 *   - external / externalExport：外部渲染内核（默认 `dsh-md-render` 的 `MarkdownView`，
 *     即 issue #31/#186 的首选内核）
 *   - platformModule / platformExport：宿主 staticModules 官方组件（默认
 *     `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`，零安装零体积）
 * @returns {(props: { text: string }) => any} 最终渲染组件（**永远不是 null**）
 */
function installMarkdownViewFallback(options) {
  const req = options.require
  const createElement = options.createElement
  const external = options.external ?? 'dsh-md-render'
  const externalExport = options.externalExport ?? 'MarkdownView'
  const platformModule = options.platformModule ?? '@deepseek-ai/dsh-client-ui-primitives'
  const platformExport = options.platformExport ?? 'MarkdownText'
  const labels = options.labels
  const fallbackAttribute = options.fallbackAttribute
  const fallbackClassName = options.fallbackClassName

  // 组件可用性判定（React 语义，见文件头注释）：函数，或带 $$typeof 的对象
  // （memo / forwardRef / lazy）；宿主标签字符串不算组件。
  const isComponentLike = (value) =>
    typeof value === 'function' || (typeof value === 'object' && value !== null && typeof value.$$typeof === 'symbol')
  let reactIsValidElementType = null
  try {
    reactIsValidElementType = req('react').isValidElementType ?? null
  } catch {
    reactIsValidElementType = null
  }
  const isRenderable = (value) => {
    if (typeof value === 'string') return false
    if (typeof reactIsValidElementType === 'function') return reactIsValidElementType(value)
    return isComponentLike(value)
  }

  // 级 3（兜底）：消费方自己的 <pre>，原文不丢、永不抛错
  const renderPlain = (props) => {
    const preProps = { [fallbackAttribute]: 'true' }
    if (fallbackClassName) preProps.className = fallbackClassName
    return createElement('pre', preProps, props.text)
  }

  // 级 1：外部渲染内核（装了就用，行为与迁移前逐字节一致）
  try {
    const externalModule = req(external)
    const externalView = externalModule ? externalModule[externalExport] : null
    if (isRenderable(externalView)) return externalView
  } catch {
    // 外部内核未安装：落到平台官方组件
  }

  // 级 2：宿主 staticModules 的官方组件（零安装零体积），补 labels 契约
  try {
    const platform = req(platformModule)
    const PlatformView = platform ? platform[platformExport] : null
    if (isRenderable(PlatformView)) {
      return (props) => {
        const platformProps = { ...props, labels }
        return createElement(PlatformView, platformProps)
      }
    }
  } catch {
    // 宿主模块表里没有官方组件：落到兜底
  }

  return renderPlain
}
