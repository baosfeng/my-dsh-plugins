/**
 * dsh-my-plugin-manager — client half (browser). SOURCE TEMPLATE.
 *
 * A Web Settings "插件市场 / Plugin Market" tab (official `slots` extension
 * point — no third-party dependency) with two read-only sections:
 *  - 更新检查: `dsh plugin outdated` → 列出「当前 → 最新」（官方无 outdated 面）；
 *  - 市场: npm registry 关键词搜索 + 插件详情（README / 版本历史 / 依赖 / 月下载量）。
 *
 * 安装 / 卸载 / 启停 / 清单管理**不在本插件范围**：官方默认内置
 * （bundle/web-app 默认装载 ui-plugin-manager、tool-plugin-manager、`dsh plugin`
 * CLI），且官方刻意让设置页插件列表保持只读——本插件不再在其上叠一层可写管理。
 *
 * Data source: GET/POST /my-plugin-manager/api/* (server half). Styling follows
 * the DSH design language (issue #54): semantic tokens, flat surfaces, hairline
 * borders, shared linear icons (dsh-shared client-parts), brand badges and
 * icon buttons — the dsh-file-activity visual baseline.
 *
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs compiles the
 * `src/client/parts/*.ts` pieces (plus the shared dsh-shared client-parts) and
 * splices them into the PART placeholder markers below (each piece is plain
 * function-declaration text sharing this factory scope; the browser
 * ModuleLoader does not support relative-path require) and writes
 * lib/client.js — the file actually served by DSH, which MUST be committed
 * (CI runs node --check + tests against it, not against this template).
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-plugin-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    // ── README Markdown 渲染：官方 baseline 组件（issue #299 / #428）────────
    // 1) 宿主 staticModules 的官方 MarkdownText —— 唯一渲染内核（平台 seed 模块
    //    @deepseek-ai/dsh-client-ui-primitives，零安装零体积，官方推荐路线）；
    // 2) 本插件自己的 <pre class="dsh-my-plugin-manager-readme-plain">（issue #90）。
    // **不再有「另一个特性插件提供渲染器」这一级**：官方明令禁止特性插件
    // runtime-import 彼此的值，也禁止用 dsh.client.external 获取它们
    // （packages/client/AGENTS.md；官方 scripts/verify-client-packages.ts 判违规）。
    // 三级链与组件可用性判定（React 语义，兼容 memo/forwardRef 对象）与假降级教训
    // 仍在 dsh-shared/client-parts/markdown-fallback.part.js（#299 单一来源），构建期
    // splice 进本 factory 作用域；共享件的外部内核级由下方两个参数显式旁路
    // （external 指向平台模块 + 一个不存在的导出名 → 该级恒不命中），共享件本身与
    // 其它消费方（dsh-think-zh-expand）行为不变。
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

    /** 官方 baseline 模块（平台 seed 表，可直接 require）。 */
    const PLATFORM_PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives'
    const MD_README_LABELS = {
      code: { copyLabel: '复制', copiedLabel: '已复制' },
      footnotes: '脚注',
    }
    const MarkdownView = installMarkdownViewFallback({
      require,
      createElement,
      labels: MD_README_LABELS,
      fallbackAttribute: 'data-dsh-my-plugin-manager-fallback',
      fallbackClassName: 'dsh-my-plugin-manager-readme-plain',
      external: PLATFORM_PRIMITIVES,
      externalExport: 'externalRendererDisabled',
    })

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
    "use strict";
// ── i18n ──────────────────────────────────────────────────────────────
// 只保留本插件实际渲染的文案（市场搜索 / 更新检查 / 详情增强）。安装、卸载、
// 启停、清单管理相关文案随对应 UI 一并删除。
function isZh() {
    try {
        const lang = (navigator.language || 'en').toLowerCase();
        return lang.startsWith('zh');
    }
    catch {
        return false;
    }
}
const strings = {
    title: () => (isZh() ? '插件市场' : 'Plugin Market'),
    scopeHint: () => isZh()
        ? '本页只做市场搜索、更新检查与插件详情。安装 / 卸载 / 启停 / 插件清单请用官方侧边栏插件页（设置 → 插件为只读列表）。'
        : 'This tab only offers market search, update check and package details. Install / uninstall / enable / disable and the plugin list live in the official sidebar Plugins page (Settings → Plugins stays read-only).',
    market: () => (isZh() ? '市场' : 'Market'),
    searchPlaceholder: () => isZh() ? '搜索 npm 插件（如 dsh-file-activity）…' : 'Search npm plugins (e.g. dsh-file-activity)…',
    search: () => (isZh() ? '搜索' : 'Search'),
    updates: () => (isZh() ? '更新检查' : 'Update check'),
    checkUpdates: () => (isZh() ? '检查更新' : 'Check updates'),
    checkUpdatesHint: () => isZh()
        ? '点右上角刷新图标，检查已安装插件是否有新版本。'
        : 'Click the refresh icon to check installed plugins for updates.',
    noUpdates: () => (isZh() ? '全部为最新版本' : 'All up to date'),
    updatesAvailable: (n) => (isZh() ? `${n} 个插件可更新` : `${n} update(s) available`),
    loading: () => (isZh() ? '加载中…' : 'Loading…'),
    loadError: () => (isZh() ? '加载失败' : 'Load failed'),
    emptySearch: () => (isZh() ? '搜索 npm 插件市场' : 'Search the npm plugin market'),
    emptySearchHint: () => (isZh() ? '输入关键词，如 dsh-file-activity' : 'Type a keyword, e.g. dsh-file-activity'),
    noResults: () => (isZh() ? '没有匹配的插件' : 'No matching plugins'),
    noResultsHint: () => (isZh() ? '换个关键词试试' : 'Try a different keyword'),
    searchFailed: () => (isZh() ? '搜索失败，请重试' : 'Search failed, try again'),
    actionFailed: () => (isZh() ? '操作失败' : 'Action failed'),
    details: () => (isZh() ? '详情' : 'Details'),
    close: () => (isZh() ? '关闭' : 'Close'),
    detailFailed: () => (isZh() ? '详情加载失败' : 'Failed to load details'),
    readme: () => (isZh() ? 'README' : 'README'),
    noReadme: () => (isZh() ? '该包没有 README' : 'This package has no README'),
    versionHistory: () => (isZh() ? '版本历史' : 'Version history'),
    noVersions: () => (isZh() ? '暂无版本信息' : 'No version history'),
    dependencies: () => (isZh() ? '依赖' : 'Dependencies'),
    peerDependencies: () => (isZh() ? '对等依赖' : 'Peer dependencies'),
    noDependencies: () => (isZh() ? '无依赖' : 'No dependencies'),
    missingPeer: () => (isZh() ? '缺失' : 'missing'),
    peerHint: () => isZh()
        ? '对等依赖（peer）需由运行环境提供；缺失项已高亮。'
        : 'Peer dependencies must be provided by the runtime; missing ones are highlighted.',
    metadata: () => (isZh() ? '元数据' : 'Metadata'),
    author: () => (isZh() ? '作者' : 'Author'),
    license: () => (isZh() ? '许可证' : 'License'),
    repository: () => (isZh() ? '仓库' : 'Repository'),
    downloads: () => (isZh() ? '月下载量' : 'Downloads / month'),
    loadingDetail: () => (isZh() ? '加载插件详情…' : 'Loading plugin details…'),
    version: () => (isZh() ? '版本' : 'version'),
    noVersion: () => (isZh() ? '—' : '—'),
};

    // ── shared icons (inline, stroke=currentColor, matching better-sidebar) ──
// Single source of truth for the plugin UI icon set (issue #54 阶段 0).
// Extracted from dsh-file-activity's lib/parts/icons.part.js; every plugin's
// scripts/build.mjs splices this file via the `shared: true` piece marker.
// Keep the stroke=currentColor outline style — it inherits the surrounding
// text color and reads on both light and dark themes.
const ICON_STROKE = 1.8
const iconSvg = (children, size) =>
  createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: ICON_STROKE,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    children.map((child, i) =>
      child === null || child === undefined || typeof child === 'boolean'
        ? child
        : createElement(child.type, { key: i, ...child.props }),
    ),
  )

const icon = {
  clock: (size = 16) =>
    iconSvg([createElement('circle', { cx: 12, cy: 12, r: 9 }), createElement('path', { d: 'M12 7v5l3 2' })], size),
  refresh: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
        createElement('polyline', { points: '21 3 21 9 15 9' }),
      ],
      size,
    ),
  trash: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M3 6h18' }),
        createElement('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }),
        createElement('path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }),
      ],
      size,
    ),
  chevronRight: (size = 14) => iconSvg([createElement('polyline', { points: '9 6 15 12 9 18' })], size),
  chevronDown: (size = 14) => iconSvg([createElement('polyline', { points: '6 9 12 15 18 9' })], size),
  file: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
        createElement('path', { d: 'M14 2v6h6' }),
      ],
      size,
    ),
  folder: (size = 16) =>
    iconSvg(
      [
        createElement('path', {
          d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
        }),
      ],
      size,
    ),
  external: (size = 15) =>
    iconSvg(
      [
        createElement('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
        createElement('polyline', { points: '15 3 21 3 21 9' }),
        createElement('line', { x1: 10, y1: 14, x2: 21, y2: 3 }),
      ],
      size,
    ),
  close: (size = 15) =>
    iconSvg(
      [
        createElement('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
        createElement('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
      ],
      size,
    ),
  help: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 12, cy: 12, r: 9 }),
        createElement('path', { d: 'M9.1 9.2a3 3 0 0 1 5.8 1.2c0 1.8-2.7 2.4-2.7 3.6' }),
        createElement('line', { x1: 12, y1: 17.2, x2: 12.01, y2: 17.2 }),
      ],
      size,
    ),
  // ── generic action icons (issue #54 阶段 0) ─────────────────────────────
  // Added for the upcoming plugin UI refresh: save/confirm (check), add/
  // install (plus), market search (search), settings entry (settings).
  check: (size = 16) => iconSvg([createElement('polyline', { points: '20 6 9 17 4 12' })], size),
  plus: (size = 16) =>
    iconSvg(
      [
        createElement('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
        createElement('line', { x1: 5, y1: 12, x2: 19, y2: 12 }),
      ],
      size,
    ),
  pencil: (size = 15) =>
    iconSvg([createElement('path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' })], size),
  search: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 11, cy: 11, r: 8 }),
        createElement('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }),
      ],
      size,
    ),
  settings: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 12, cy: 12, r: 3 }),
        createElement('path', {
          d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
        }),
      ],
      size,
    ),
  // 警告（issue #54 阶段 1 新增）：安全护栏告警类型图标（投毒/提示注入），
  // 三角警示 + 感叹号，stroke=currentColor 风格与其余图标一致。
  alert: (size = 16) =>
    iconSvg(
      [
        createElement('path', {
          d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
        }),
        createElement('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
        createElement('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }),
      ],
      size,
    ),
  // 代码（issue #54 阶段 1 新增）：尖括号 `</>`，预览/代码切换的代码视图
  // 图标（dsh-mermaid-render 卡片），stroke=currentColor 风格与其余图标一致。
  code: (size = 16) =>
    iconSvg(
      [
        createElement('polyline', { points: '16 18 22 12 16 6' }),
        createElement('polyline', { points: '8 6 2 12 8 18' }),
      ],
      size,
    ),
  // 下载（issue #85 新增）：箭头入托盘，图表导出按钮（dsh-mermaid-render
  // 卡片下载 PNG/SVG），stroke=currentColor 风格与其余图标一致。
  download: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
        createElement('polyline', { points: '7 10 12 15 17 10' }),
        createElement('line', { x1: 12, y1: 15, x2: 12, y2: 3 }),
      ],
      size,
    ),
  // 复制（issue #85 新增）：双层矩形，复制源码按钮（dsh-mermaid-render
  // 卡片复制代码），stroke=currentColor 风格与其余图标一致。
  copy: (size = 16) =>
    iconSvg(
      [
        createElement('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
        createElement('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
      ],
      size,
    ),
  // 箭头向上（更新图标）：向上的箭头，表示更新操作
  arrowUp: (size = 16) =>
    iconSvg(
      [
        createElement('line', { x1: 12, y1: 19, x2: 12, y2: 5 }),
        createElement('polyline', { points: '5 12 12 5 19 12' }),
      ],
      size,
    ),
  // 电源关（禁用图标）：圆形电源按钮，表示禁用操作
  powerOff: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }),
        createElement('line', { x1: 12, y1: 2, x2: 12, y2: 12 }),
      ],
      size,
    ),
  // 电源开（启用图标）：圆形电源按钮，表示启用操作
  powerOn: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }),
        createElement('line', { x1: 12, y1: 2, x2: 12, y2: 12 }),
      ],
      size,
    ),
}

// Common-language / file-type badges (issue #24): brand fill + contrast
// ink, reading on both light and dark themes. Unmapped extensions keep the
// neutral currentColor file icon above. [bg, fg ink, short mark]
const FILE_BADGES = {
  // JavaScript / TypeScript
  js: ['#F7DF1E', '#323330', 'JS'],
  mjs: ['#F7DF1E', '#323330', 'JS'],
  cjs: ['#F7DF1E', '#323330', 'JS'],
  ts: ['#3178C6', '#ffffff', 'TS'],
  mts: ['#3178C6', '#ffffff', 'TS'],
  cts: ['#3178C6', '#ffffff', 'TS'],
  tsx: ['#3178C6', '#ffffff', 'TSX'],
  jsx: ['#3178C6', '#ffffff', 'JSX'],
  // 后端语言
  java: ['#007396', '#ffffff', 'JAVA'],
  c: ['#A8B9CC', '#111111', 'C'],
  cpp: ['#00599C', '#ffffff', 'C++'],
  cxx: ['#00599C', '#ffffff', 'C++'],
  cc: ['#00599C', '#ffffff', 'C++'],
  hpp: ['#00599C', '#ffffff', 'C++'],
  h: ['#A8B9CC', '#111111', 'H'],
  hh: ['#A8B9CC', '#111111', 'H'],
  cs: ['#68217A', '#ffffff', 'C#'],
  csharp: ['#68217A', '#ffffff', 'C#'],
  go: ['#00ADD8', '#ffffff', 'GO'],
  rs: ['#CE422B', '#ffffff', 'RS'],
  rb: ['#B51624', '#ffffff', 'RB'],
  php: ['#777BB4', '#ffffff', 'PHP'],
  py: ['#3776AB', '#ffffff', 'PY'],
  swift: ['#F05138', '#ffffff', 'SWIFT'],
  kt: ['#7F52FF', '#ffffff', 'KT'],
  kotlin: ['#7F52FF', '#ffffff', 'KT'],
  dart: ['#0175C2', '#ffffff', 'DART'],
  scala: ['#DC322F', '#ffffff', 'SCALA'],
  lua: ['#2C2C7C', '#ffffff', 'LUA'],
  pl: ['#0298C3', '#ffffff', 'PERL'],
  r: ['#336DC3', '#ffffff', 'R'],
  m: ['#C1272D', '#ffffff', 'MAT'],
  mm: ['#C1272D', '#ffffff', 'MAT'],
  // Web / 前端
  html: ['#E34F26', '#ffffff', '</>'],
  htm: ['#E34F26', '#ffffff', '</>'],
  css: ['#663399', '#ffffff', 'CSS'],
  scss: ['#CD6799', '#ffffff', 'SCSS'],
  sass: ['#CD6799', '#ffffff', 'SCSS'],
  vue: ['#42B883', '#ffffff', 'VUE'],
  svelte: ['#FF3E00', '#ffffff', 'SVELTE'],
  // 数据 / 结构化
  json: ['#F7DF1E', '#323330', '{}'],
  sql: ['#00758F', '#ffffff', 'SQL'],
  csv: ['#2E7D32', '#ffffff', 'CSV'],
  db: ['#0F62FE', '#ffffff', 'DB'],
  sqlite: ['#0F62FE', '#ffffff', 'DB'],
  sqlite3: ['#0F62FE', '#ffffff', 'DB'],
  xml: ['#FF6F00', '#ffffff', 'XML'],
  svg: ['#FF6F00', '#ffffff', 'SVG'],
  // 文档
  md: ['#42A5F5', '#ffffff', 'M↓'],
  markdown: ['#42A5F5', '#ffffff', 'M↓'],
  txt: ['#90A4AE', '#ffffff', 'TXT'],
  text: ['#90A4AE', '#ffffff', 'TXT'],
  log: ['#90A4AE', '#ffffff', 'TXT'],
  pdf: ['#E5202B', '#ffffff', 'PDF'],
  doc: ['#2B579A', '#ffffff', 'DOC'],
  docx: ['#2B579A', '#ffffff', 'DOC'],
  xls: ['#217346', '#ffffff', 'XLS'],
  xlsx: ['#217346', '#ffffff', 'XLS'],
  ppt: ['#D24726', '#ffffff', 'PPT'],
  pptx: ['#D24726', '#ffffff', 'PPT'],
  // 配置 / 构建
  yml: ['#CB171E', '#ffffff', 'YML'],
  yaml: ['#CB171E', '#ffffff', 'YML'],
  toml: ['#8D6E63', '#ffffff', 'TOML'],
  ini: ['#546E7A', '#ffffff', 'CFG'],
  cfg: ['#546E7A', '#ffffff', 'CFG'],
  config: ['#546E7A', '#ffffff', 'CFG'],
  env: ['#F9A825', '#323330', 'ENV'],
  properties: ['#7B1FA2', '#ffffff', 'PROP'],
  lock: ['#37474F', '#ffffff', 'LOCK'],
  dockerfile: ['#2496ED', '#ffffff', 'DOCK'],
  docker: ['#2496ED', '#ffffff', 'DOCK'],
  makefile: ['#607D8B', '#ffffff', 'MAKE'],
  gradle: ['#02303A', '#ffffff', 'GRADLE'],
  cmake: ['#265774', '#ffffff', 'CMAKE'],
  ipynb: ['#F37726', '#ffffff', 'JNB'],
  // 脚本 / Shell
  sh: ['#89E051', '#111111', '>_'],
  bash: ['#89E051', '#111111', '>_'],
  zsh: ['#89E051', '#111111', '>_'],
  ps1: ['#012456', '#ffffff', 'PS1'],
  bat: ['#546E7A', '#ffffff', 'CMD'],
  cmd: ['#546E7A', '#ffffff', 'CMD'],
  // 打包 / 二进制
  zip: ['#FFA726', '#323330', 'ZIP'],
  tar: ['#FFA726', '#323330', 'ZIP'],
  gz: ['#FFA726', '#323330', 'ZIP'],
  '7z': ['#FFA726', '#323330', 'ZIP'],
  rar: ['#FFA726', '#323330', 'ZIP'],
  exe: ['#0078D4', '#ffffff', 'EXE'],
  msi: ['#0078D4', '#ffffff', 'EXE'],
  wasm: ['#654FF0', '#ffffff', 'WASM'],
  // 图片 / 媒体
  png: ['#8E44AD', '#ffffff', 'IMG'],
  jpg: ['#8E44AD', '#ffffff', 'IMG'],
  jpeg: ['#8E44AD', '#ffffff', 'IMG'],
  gif: ['#8E44AD', '#ffffff', 'IMG'],
  webp: ['#8E44AD', '#ffffff', 'IMG'],
  ico: ['#8E44AD', '#ffffff', 'IMG'],
  bmp: ['#8E44AD', '#ffffff', 'IMG'],
  // 版本控制
  gitignore: ['#F05032', '#ffffff', 'GIT'],
  gitattributes: ['#F05032', '#ffffff', 'GIT'],
}

/** One self-colored badge svg: rounded brand rect + short contrast mark.
 *  Mark font scales by length so 5-6 char marks (JAVA/SCALA/SWIFT) stay
 *  inside the 24×24 viewBox. */
const badgeIcon = ([bg, fg, mark], size) =>
  createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
    },
    createElement('rect', { x: 1, y: 1, width: 22, height: 22, rx: 5, fill: bg }),
    createElement(
      'text',
      {
        x: 12,
        y: 16,
        textAnchor: 'middle',
        fontSize: mark.length <= 2 ? 9 : mark.length <= 4 ? 7 : 5.5,
        fontWeight: 700,
        fill: fg,
      },
      mark,
    ),
  )

/** File-type icon dispatcher: branded badge for known extensions, the
 *  neutral file icon for everything else (case-insensitive, tolerates a
 *  leading dot like ".md"). */
const fileIconByExt = (ext, size = 14) => {
  const spec =
    FILE_BADGES[
      String(ext ?? '')
        .toLowerCase()
        .replace(/^\./, '')
    ]
  return spec === undefined ? icon.file(size) : badgeIcon(spec, size)
}

    "use strict";
// ── styles (DSH semantic tokens, injected on activate, removed on teardown) ──
// Visual baseline: dsh-file-activity (issue #54) — flat surfaces, hairline
// borders, 24px circular icon buttons, brand badges, 8px-radius rows with
// hover fills, 150ms row entrance animation. All colors ride --dsw-alias-*,
// typography rides --dsw-font-*, motion rides --ds-*.
const STYLES = `
.dsh-my-plugin-manager-root { display:flex; flex-direction:column; gap:2px; padding:2px 6px 8px;
  font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); }
.dsh-my-plugin-manager-hint { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); line-height:1.7; padding:2px 6px; }
.dsh-my-plugin-manager-status { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); padding:2px 6px; }
.dsh-my-plugin-manager-new { color:var(--dsw-alias-state-warn-primary); }
.dsh-my-plugin-manager-error { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-state-error-primary);
  padding:4px 6px; white-space:pre-wrap; word-break:break-all; }
.dsh-my-plugin-manager-section { display:flex; flex-direction:column; gap:2px; margin-top:4px; }
.dsh-my-plugin-manager-section-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:2px 6px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary); text-transform:uppercase; letter-spacing:.04em; }
.dsh-my-plugin-manager-section-title { font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary);
  text-transform:uppercase; letter-spacing:.04em; }
.dsh-my-plugin-manager-section-head-actions { display:flex; align-items:center; gap:2px; flex:none; }
.dsh-my-plugin-manager-iconbtn { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0;
  border:none; border-radius:50%; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; flex:none;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-plugin-manager-iconbtn svg { display:block; }
.dsh-my-plugin-manager-iconbtn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.dsh-my-plugin-manager-iconbtn:disabled { opacity:.4; cursor:default; }
.dsh-my-plugin-manager-iconbtn-xs { width:20px; height:20px; }
.dsh-my-plugin-manager-row { display:flex; flex-direction:column; gap:2px; padding:6px 8px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1); background:transparent;
  animation:dsh-my-plugin-manager-row-in 150ms var(--ds-ease-in-out);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-plugin-manager-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-plugin-manager-row-head { display:flex; align-items:center; gap:6px; min-width:0; }
.dsh-my-plugin-manager-row-icon { flex:none; display:flex; align-items:center; color:var(--dsw-alias-label-tertiary); }
.dsh-my-plugin-manager-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
.dsh-my-plugin-manager-ver { flex:none; display:inline-flex; align-items:center; justify-content:center; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-accent);
  background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent); }
.dsh-my-plugin-manager-update { flex:none; display:inline-flex; align-items:center; justify-content:center; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-state-warn-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-plugin-manager-author { flex:none; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); white-space:nowrap; }
.dsh-my-plugin-manager-desc { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-secondary); line-height:1.5;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.dsh-my-plugin-manager-actions { display:flex; gap:6px; margin-top:4px; }
.dsh-my-plugin-manager-btn { display:inline-flex; align-items:center; gap:5px; flex:none; height:24px; padding:0 10px; border-radius:5px; cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-secondary);
  font:var(--dsw-font-xxs-12);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-plugin-manager-btn svg { display:block; }
.dsh-my-plugin-manager-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.dsh-my-plugin-manager-btn:disabled { opacity:.4; cursor:default; }
.dsh-my-plugin-manager-btn-primary { color:var(--dsw-alias-accent); border-color:color-mix(in srgb, var(--dsw-alias-accent) 45%, transparent); }
.dsh-my-plugin-manager-btn-primary:hover:not(:disabled) { color:var(--dsw-alias-accent); }
.dsh-my-plugin-manager-searchbar { display:flex; gap:6px; align-items:center; padding:0 6px; }
.dsh-my-plugin-manager-search-input { flex:1; min-width:0; height:28px; padding:0 8px; border-radius:6px;
  border:1px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-primary);
  font:var(--dsw-font-s-14); }
.dsh-my-plugin-manager-search-input:focus { outline:none; border-color:var(--dsw-alias-accent); }
.dsh-my-plugin-manager-empty { display:flex; flex-direction:column; align-items:center; gap:2px; padding:10px 6px;
  font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); line-height:1.7; text-align:center; }
.dsh-my-plugin-manager-empty svg { color:var(--dsw-alias-label-dimmed); }
.dsh-my-plugin-manager-empty-hint { color:var(--dsw-alias-label-dimmed); font:var(--dsw-font-xxxs-11); }
.dsh-my-plugin-manager-name-btn { flex:1; min-width:0; padding:0; border:none; background:transparent; text-align:left; cursor:pointer;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
.dsh-my-plugin-manager-name-btn:hover { color:var(--dsw-alias-accent); text-decoration:underline; }
.dsh-my-plugin-manager-btn-ghost { color:var(--dsw-alias-label-secondary); }
.dsh-my-plugin-manager-detail { position:absolute; inset:0; z-index:10; display:flex; flex-direction:column; gap:2px;
  padding:0 6px 8px; overflow-y:auto; border:1px solid var(--dsw-alias-border-l1); border-radius:8px;
  background:var(--dsw-alias-bg-elevated); }
.dsh-my-plugin-manager-detail-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 6px 2px;
  position:sticky; top:0; background:var(--dsw-alias-bg-elevated); }
.dsh-my-plugin-manager-detail-title { font:var(--dsw-font-m-strong-16); color:var(--dsw-alias-label-primary); min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-my-plugin-manager-detail-body { display:flex; flex-direction:column; gap:8px; padding:4px 6px; }
.dsh-my-plugin-manager-detail-meta { display:flex; flex-direction:column; gap:4px; }
.dsh-my-plugin-manager-detail-toolbar { display:flex; gap:8px; align-items:center; }
.dsh-my-plugin-manager-detail-version { height:24px; padding:0 6px; border-radius:5px; flex:none; border:1px solid var(--dsw-alias-border-l2);
  background:transparent; color:var(--dsw-alias-label-secondary); font:var(--dsw-font-xxs-12); }
.dsh-my-plugin-manager-detail-desc { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-secondary); line-height:1.6; }
.dsh-my-plugin-manager-detail-tags { display:flex; flex-wrap:wrap; gap:6px; }
.dsh-my-plugin-manager-detail-tag { display:inline-flex; align-items:center; padding:2px 6px; border-radius:4px; font:var(--dsw-font-xxxs-11);
  color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-plugin-manager-detail-tag-link { color:var(--dsw-alias-accent); text-decoration:none; }
.dsh-my-plugin-manager-detail-tag-link:hover { text-decoration:underline; }
.dsh-my-plugin-manager-detail-section { display:flex; flex-direction:column; gap:4px; }
.dsh-my-plugin-manager-detail-section-title { font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary);
  text-transform:uppercase; letter-spacing:.04em; }
.dsh-my-plugin-manager-readme-plain { margin:0; padding:8px 10px; border-radius:6px; border:1px solid var(--dsw-alias-border-l1);
  max-height:320px; overflow-y:auto; font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-secondary);
  white-space:pre-wrap; word-break:break-word; }
.dsh-my-plugin-manager-timeline { display:flex; flex-direction:column; gap:0; }
.dsh-my-plugin-manager-timeline-item { display:flex; align-items:center; gap:8px; padding:4px 0; position:relative; }
.dsh-my-plugin-manager-timeline-dot { flex:none; width:8px; height:8px; border-radius:50%; background:var(--dsw-alias-accent); }
.dsh-my-plugin-manager-timeline-version { flex:1; min-width:0; font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-primary);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-my-plugin-manager-timeline-date { flex:none; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); white-space:nowrap; }
.dsh-my-plugin-manager-deps { display:flex; flex-direction:column; gap:8px; }
.dsh-my-plugin-manager-deps-group { display:flex; flex-direction:column; gap:4px; }
.dsh-my-plugin-manager-deps-label { font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-secondary); }
.dsh-my-plugin-manager-deps-hint { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); line-height:1.6; }
.dsh-my-plugin-manager-dep-table { display:flex; flex-direction:column; gap:2px; }
.dsh-my-plugin-manager-dep-row { display:flex; align-items:center; gap:8px; padding:3px 6px; border-radius:4px;
  border:1px solid var(--dsw-alias-border-l1); font:var(--dsw-font-xxs-12); }
.dsh-my-plugin-manager-dep-row.dsh-my-plugin-manager-dep-missing { border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
.dsh-my-plugin-manager-dep-name { flex:1; min-width:0; color:var(--dsw-alias-label-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-my-plugin-manager-dep-spec { flex:none; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); white-space:nowrap; }
.dsh-my-plugin-manager-dep-missing-badge { flex:none; padding:1px 6px; border-radius:4px; font:var(--dsw-font-xxxs-strong-11);
  color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-plugin-manager-dep-empty { padding:4px 0; }
@keyframes dsh-my-plugin-manager-row-in { from { opacity:0; transform:translateY(1px); } to { opacity:1; transform:none; } }
`.trim();
const STYLE_TAG = 'data-dsh-my-plugin-manager';

    "use strict";
// ── api: fetch helpers for the Plugin Manager views ────────────────────
// 只保留三条只读接口：市场搜索（/search）、插件详情（/detail）、更新检查（/updates）。
// 安装、卸载、启停、清单接口随对应 UI 一并下线。
const API_BASE = '/my-plugin-manager/api';
/** GET /search?q= → { results: [{ name, version, description, author }] }. */
function fetchSearch(query) {
    return fetchJson(`${API_BASE}/search?q=${encodeURIComponent(query.trim())}`);
}
/** GET /detail?name=&version= → plugin detail (README/versions/deps). */
function fetchDetail(name, version) {
    let url = `${API_BASE}/detail?name=${encodeURIComponent(name)}`;
    if (version)
        url += `&version=${encodeURIComponent(version)}`;
    return fetchJson(url);
}
/** GET /updates → { outdated: [{ name, current, latest }], error? }. */
function fetchUpdates() {
    return fetchJson(`${API_BASE}/updates`);
}
function fetchJson(url, options) {
    return fetch(url, options)
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error(body?.error?.message ?? 'bad response');
        return body.value ?? {};
    });
}

    "use strict";
// ── view: Plugin Manager settings tab ─────────────────────────────────
// 只保留官方插件管理**没有**的三块：npm 市场关键词搜索、更新检查、插件详情增强。
// 安装 / 卸载 / 启停 / 清单管理由官方侧边栏插件页（+ tool-plugin-manager）承担，
// 本页不再重复实现——官方刻意让设置页插件列表保持只读。
// npm brand badge for market rows (badgeIcon from the shared icons part):
// brand fill + contrast ink, same family as the FILE_BADGES chips.
const NPM_BADGE = ['#CB3837', '#ffffff', 'npm'];
function createActions({ setUpdates, setError, setChecking, setDetailName, setDetail, setDetailLoading, setDetailError, setDetailVersion, detailName, }) {
    const runUpdates = () => {
        setError(false);
        setChecking(true);
        fetchUpdates()
            .then((value) => setUpdates(value.outdated ?? []))
            .catch((error) => setError(error.message ?? true))
            .finally(() => setChecking(false));
    };
    const loadDetail = (name, version) => {
        setDetailName(name);
        setDetailVersion(version);
        setDetailError(null);
        setDetailLoading(true);
        fetchDetail(name, version)
            .then((value) => {
            setDetail(value);
            setDetailVersion(value.version);
            setDetailLoading(false);
        })
            .catch((error) => {
            setDetailError(error.message ?? true);
            setDetailLoading(false);
        });
    };
    const openDetail = (name) => loadDetail(name, '');
    const closeDetail = () => {
        setDetailName(null);
        setDetail(null);
        setDetailVersion(null);
        setDetailError(null);
        setDetailLoading(false);
    };
    const changeDetailVersion = (version) => loadDetail(detailName, version);
    return { runUpdates, openDetail, closeDetail, changeDetailVersion };
}
function usePluginManagerState() {
    const [updates, setUpdates] = useState(null);
    const [error, setError] = useState(false);
    const [checking, setChecking] = useState(false);
    const [detailName, setDetailName] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState(null);
    const [detailVersion, setDetailVersion] = useState(null);
    const actions = createActions({
        setUpdates,
        setError,
        setChecking,
        setDetailName,
        setDetail,
        setDetailLoading,
        setDetailError,
        setDetailVersion,
        detailName,
    });
    return { updates, error, checking, detailName, detail, detailLoading, detailError, detailVersion, actions };
}
function PluginManagerView() {
    const { updates, error, checking, detailName, detail, detailLoading, detailError, detailVersion, actions } = usePluginManagerState();
    return createElement('div', { className: 'dsh-my-plugin-manager-root' }, createElement('div', { className: 'dsh-my-plugin-manager-hint' }, strings.scopeHint()), error
        ? createElement('div', { className: 'dsh-my-plugin-manager-error' }, typeof error === 'string' ? `${strings.actionFailed()}：${error}` : strings.loadError())
        : null, createElement(UpdatesSection, { updates, checking, onCheck: actions.runUpdates }), createElement(MarketSection, { actions }), detailName !== null
        ? createElement(PluginDetailPanel, {
            name: detailName,
            detail,
            loading: detailLoading,
            error: detailError,
            version: detailVersion,
            onClose: actions.closeDetail,
            onVersionChange: actions.changeDetailVersion,
        })
        : null);
}
/** 更新检查：点刷新图标跑 `dsh plugin outdated`，逐行列出「当前 → 最新」。 */
function UpdatesSection({ updates, checking, onCheck }) {
    const rows = updates === null
        ? null
        : updates.length === 0
            ? createElement('div', { className: 'dsh-my-plugin-manager-status' }, strings.noUpdates())
            : updates.map((entry) => createElement('div', { key: entry.name, className: 'dsh-my-plugin-manager-row' }, createElement('div', { className: 'dsh-my-plugin-manager-row-head' }, createElement('span', { className: 'dsh-my-plugin-manager-row-icon' }, icon.file(16)), createElement('span', { className: 'dsh-my-plugin-manager-name' }, entry.name), createElement('span', { className: 'dsh-my-plugin-manager-update' }, `${entry.current} → ${entry.latest}`))));
    return createElement('div', { className: 'dsh-my-plugin-manager-section' }, createElement('div', { className: 'dsh-my-plugin-manager-section-head' }, createElement('span', { className: 'dsh-my-plugin-manager-section-title' }, strings.updates()), createElement('span', { className: 'dsh-my-plugin-manager-section-head-actions' }, createElement('button', {
        className: 'dsh-my-plugin-manager-iconbtn dsh-my-plugin-manager-iconbtn-xs',
        onClick: onCheck,
        disabled: checking,
        title: strings.checkUpdates(),
        'aria-label': strings.checkUpdates(),
    }, icon.refresh(14)))), updates === null
        ? createElement('div', { className: 'dsh-my-plugin-manager-status' }, strings.checkUpdatesHint())
        : rows, updates !== null && updates.length > 0
        ? createElement('div', { className: 'dsh-my-plugin-manager-status dsh-my-plugin-manager-new' }, strings.updatesAvailable(updates.length))
        : null);
}
/** 市场：npm 关键词搜索 + 详情入口（安装由官方插件页承担）。 */
function MarketSection({ actions }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState(false);
    const runSearch = () => {
        if (query.trim() === '')
            return;
        setSearching(true);
        setSearchError(false);
        fetchSearch(query)
            .then((value) => {
            setResults(value.results ?? []);
            setSearching(false);
        })
            .catch(() => {
            setSearching(false);
            setSearchError(true);
        });
    };
    return createElement('div', { className: 'dsh-my-plugin-manager-section' }, createElement('div', { className: 'dsh-my-plugin-manager-section-head' }, createElement('span', { className: 'dsh-my-plugin-manager-section-title' }, strings.market())), createElement('div', { className: 'dsh-my-plugin-manager-searchbar' }, createElement('input', {
        className: 'dsh-my-plugin-manager-search-input',
        placeholder: strings.searchPlaceholder(),
        value: query,
        onChange: (event) => setQuery(event.target.value),
        onKeyDown: (event) => {
            if (event.key === 'Enter')
                runSearch();
        },
    }), createElement('button', {
        className: 'dsh-my-plugin-manager-btn dsh-my-plugin-manager-btn-primary',
        onClick: runSearch,
        disabled: searching,
    }, icon.search(14), strings.search())), searchError ? createElement('div', { className: 'dsh-my-plugin-manager-error' }, strings.searchFailed()) : null, searching
        ? createElement('div', { className: 'dsh-my-plugin-manager-status' }, strings.loading())
        : marketRows(results, actions.openDetail));
}
/** Market rows: placeholder / empty / result list. */
function marketRows(results, openDetail) {
    if (results === null)
        return createElement('div', { className: 'dsh-my-plugin-manager-empty' }, icon.search(18), strings.emptySearch(), createElement('span', { className: 'dsh-my-plugin-manager-empty-hint' }, strings.emptySearchHint()));
    if (results.length === 0)
        return createElement('div', { className: 'dsh-my-plugin-manager-empty' }, icon.search(18), strings.noResults(), createElement('span', { className: 'dsh-my-plugin-manager-empty-hint' }, strings.noResultsHint()));
    return results.map((item) => createElement(MarketRow, { key: item.name, item, onOpen: () => openDetail(item.name) }));
}
/** One market search result row: npm badge / name / version chip + detail. */
function MarketRow({ item, onOpen }) {
    return createElement('div', { className: 'dsh-my-plugin-manager-row' }, createElement('div', { className: 'dsh-my-plugin-manager-row-head' }, createElement('span', { className: 'dsh-my-plugin-manager-row-icon' }, badgeIcon(NPM_BADGE, 16)), createElement('button', { className: 'dsh-my-plugin-manager-name dsh-my-plugin-manager-name-btn', onClick: onOpen }, item.name), createElement('span', { className: 'dsh-my-plugin-manager-ver' }, `v${item.version}`), item.author !== '' ? createElement('span', { className: 'dsh-my-plugin-manager-author' }, item.author) : null), createElement('div', { className: 'dsh-my-plugin-manager-desc' }, item.description), createElement('div', { className: 'dsh-my-plugin-manager-actions' }, createElement('button', { className: 'dsh-my-plugin-manager-btn', onClick: onOpen }, strings.details())));
}

    "use strict";
// ── detail panel (issue #90): README / version history / deps / metadata ──
// 本块是本插件的真增量之一：官方插件页不提供 README / 版本历史 / 依赖 / 月下载量。
// 安装按钮已随「安装」能力下线（官方插件页负责安装），此处只做只读浏览。
function PluginDetailPanel({ name, detail, loading, error, version, onClose, onVersionChange, }) {
    return createElement('div', { className: 'dsh-my-plugin-manager-detail' }, createElement(DetailHead, { name, onClose }), renderDetail({ detail, loading, error, version, onVersionChange }));
}
function DetailHead({ name, onClose }) {
    return createElement('div', { className: 'dsh-my-plugin-manager-detail-head' }, createElement('span', { className: 'dsh-my-plugin-manager-detail-title' }, name ?? ''), createElement('button', { className: 'dsh-my-plugin-manager-btn dsh-my-plugin-manager-btn-ghost', onClick: onClose }, strings.close()));
}
/** Loading → error → detail-body switch. */
function renderDetail({ detail, loading, error, version, onVersionChange }) {
    if (loading)
        return createElement('div', { className: 'dsh-my-plugin-manager-status' }, strings.loadingDetail());
    if (error !== null && error !== false) {
        const message = typeof error === 'string' ? error : strings.loadError();
        return createElement('div', { className: 'dsh-my-plugin-manager-error' }, `${strings.detailFailed()}：${message}`);
    }
    if (detail === null)
        return null;
    const readmeBody = detail.readme === ''
        ? createElement('div', { className: 'dsh-my-plugin-manager-empty' }, strings.noReadme())
        : createElement(ReadmeView, { text: detail.readme });
    return createElement('div', { className: 'dsh-my-plugin-manager-detail-body' }, createElement(DetailMeta, { detail, version, onVersionChange }), createElement(DetailSection, { title: strings.readme(), body: readmeBody }), createElement(DetailSection, {
        title: strings.versionHistory(),
        body: createElement(DetailTimeline, { versions: detail.versions }),
    }), createElement(DetailSection, {
        title: strings.dependencies(),
        body: createElement(DetailDeps, { dependencies: detail.dependencies, peerDependencies: detail.peerDependencies }),
    }));
}
/** Metadata toolbar: version picker (view-only) + info tags. */
function DetailMeta({ detail, version, onVersionChange }) {
    const versions = Array.isArray(detail.versions) ? detail.versions : [];
    return createElement('div', { className: 'dsh-my-plugin-manager-detail-meta' }, versions.length > 0
        ? createElement('div', { className: 'dsh-my-plugin-manager-detail-toolbar' }, createElement('select', {
            className: 'dsh-my-plugin-manager-detail-version',
            value: version ?? '',
            onChange: (event) => onVersionChange(event.target.value),
        }, versions.map((v) => createElement('option', { key: v.version, value: v.version }, v.version))))
        : null, detail.description !== ''
        ? createElement('div', { className: 'dsh-my-plugin-manager-detail-desc' }, detail.description)
        : null, createElement('div', { className: 'dsh-my-plugin-manager-detail-tags' }, metaTag(detail.author, strings.author()), metaTag(detail.license, strings.license()), metaTag(detail.downloads > 0 ? String(detail.downloads) : '', strings.downloads()), detail.repository !== ''
        ? createElement('a', {
            className: 'dsh-my-plugin-manager-detail-tag dsh-my-plugin-manager-detail-tag-link',
            href: detail.repository,
            target: '_blank',
            rel: 'noreferrer',
        }, strings.repository())
        : null));
}
/** A single metadata chip; hidden when the value is empty. */
function metaTag(value, label) {
    if (value === '' || value === null || value === undefined)
        return null;
    return createElement('span', { className: 'dsh-my-plugin-manager-detail-tag' }, `${label}：${value}`);
}
function DetailSection({ title, body }) {
    return createElement('div', { className: 'dsh-my-plugin-manager-detail-section' }, createElement('div', { className: 'dsh-my-plugin-manager-detail-section-title' }, title), body);
}
/**
 * README preview：统一 MarkdownView（issue #299 / #428）。
 *
 * 渲染内核 = 宿主官方 baseline `@deepseek-ai/dsh-client-ui-primitives` 的 MarkdownText；
 * 缺它时落到本插件 `<pre class="dsh-my-plugin-manager-readme-plain">`。外部内核级
 * （dsh-md-render）已在模板里显式旁路——官方禁止特性插件 runtime-import 另一个特性
 * 插件的值、也禁止用 dsh.client.external 获取（packages/client/AGENTS.md）。
 * 三级链的组件可用性判定收口在 dsh-shared/client-parts/markdown-fallback.part.js，
 * 模板里解析出的 `MarkdownView` **永远是可用组件**，这里不再需要 null 分支。
 */
function ReadmeView({ text }) {
    return createElement(MarkdownView, { text });
}
function DetailTimeline({ versions }) {
    if (!Array.isArray(versions) || versions.length === 0) {
        return createElement('div', { className: 'dsh-my-plugin-manager-empty' }, strings.noVersions());
    }
    return createElement('div', { className: 'dsh-my-plugin-manager-timeline' }, versions.map((entry, i) => createElement('div', { key: `${entry.version}-${i}`, className: 'dsh-my-plugin-manager-timeline-item' }, createElement('span', { className: 'dsh-my-plugin-manager-timeline-dot' }), createElement('span', { className: 'dsh-my-plugin-manager-timeline-version' }, entry.version), createElement('span', { className: 'dsh-my-plugin-manager-timeline-date' }, entry.date))));
}
/** dependencies + peerDependencies tables (peer missing highlighted). */
function DetailDeps({ dependencies, peerDependencies }) {
    const deps = Array.isArray(dependencies) ? dependencies : [];
    const peers = Array.isArray(peerDependencies) ? peerDependencies : [];
    return createElement('div', { className: 'dsh-my-plugin-manager-deps' }, createElement('div', { className: 'dsh-my-plugin-manager-deps-group' }, createElement('div', { className: 'dsh-my-plugin-manager-deps-label' }, strings.dependencies()), deps.length === 0
        ? createElement('div', { className: 'dsh-my-plugin-manager-empty dsh-my-plugin-manager-dep-empty' }, strings.noDependencies())
        : depRows(deps)), createElement('div', { className: 'dsh-my-plugin-manager-deps-group dsh-my-plugin-manager-deps-peer' }, createElement('div', { className: 'dsh-my-plugin-manager-deps-label' }, strings.peerDependencies()), createElement('div', { className: 'dsh-my-plugin-manager-deps-hint' }, strings.peerHint()), peers.length === 0
        ? createElement('div', { className: 'dsh-my-plugin-manager-empty dsh-my-plugin-manager-dep-empty' }, strings.noDependencies())
        : peerRows(peers)));
}
function depRows(deps) {
    return createElement('div', { className: 'dsh-my-plugin-manager-dep-table' }, deps.map((dep) => createElement('div', { key: dep.name, className: 'dsh-my-plugin-manager-dep-row' }, createElement('span', { className: 'dsh-my-plugin-manager-dep-name' }, dep.name), createElement('span', { className: 'dsh-my-plugin-manager-dep-spec' }, dep.spec))));
}
function peerRows(peers) {
    return createElement('div', { className: 'dsh-my-plugin-manager-dep-table' }, peers.map((peer) => createElement('div', {
        key: peer.name,
        className: `dsh-my-plugin-manager-dep-row${peer.missing ? ' dsh-my-plugin-manager-dep-missing' : ''}`,
    }, createElement('span', { className: 'dsh-my-plugin-manager-dep-name' }, peer.name), createElement('span', { className: 'dsh-my-plugin-manager-dep-spec' }, peer.spec), peer.missing
        ? createElement('span', { className: 'dsh-my-plugin-manager-dep-missing-badge' }, strings.missingPeer())
        : null)));
}

    "use strict";
// ── plugin body ───────────────────────────────────────────────────────
// 零第三方依赖：面板挂在官方 slots 扩展点（设置 → 插件 → 插件市场），
// 不依赖 dsh-better-sidebar，也不依赖任何其它特性插件。slots 服务通过
// ctx.get 动态获取——服务缺省时静默跳过（不注册 tab，server 端 API 不受影响）。
exports.apply = function apply(ctx) {
    ctx.effect(() => {
        if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined')
            return () => { };
        const style = document.createElement('style');
        style.setAttribute(STYLE_TAG, 'styles');
        style.textContent = STYLES;
        document.head.appendChild(style);
        return () => {
            if (style.parentNode)
                style.parentNode.removeChild(style);
        };
    }, 'dsh-my-plugin-manager: styles');
    // ctx.get(name, strict = true) 默认是严格模式：服务提供者 fiber 未 active 时
    // 返回 undefined（cordis `_getImpl`: `if (strict && impl.fiber.state !== 2)
    // return`）。首屏加载时 slots 可能尚未 active，严格模式会静默跳过注册 →
    // 设置页看不到「插件市场」页签。传 strict = false 只按「服务是否已提供」
    // 判断，首屏也能拿到 slots；服务确实不存在时才降级跳过。
    const slots = ctx.get('slots', false);
    if (slots === undefined)
        return;
    ctx.effect(() => slots.inject('settings.plugins.tab', () => slots.register({
        name: 'settings.plugins.tab',
        id: 'my-plugin-manager',
        order: 100,
        label: () => strings.title(),
    }, PluginManagerView)), 'dsh-my-plugin-manager: settings tab registration');
};


    return module.exports
  },
})
