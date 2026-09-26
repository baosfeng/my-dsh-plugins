/**
 * dsh-my-observability — client half (browser). SOURCE TEMPLATE.
 *
 * 提供两个侧边栏页签：
 *  - 资源监控（dsh-my-observability:resources）：审计文件大小 / 写入速率 +
 *    本进程 CPU / 内存（资源看门狗的可视面，数据来自
 *    /observability/api/resources）；
 *  - Git 工具 + 增量 diff 审查（dsh-my-observability:git）：仓库状态与
 *    差异查看、类型化提交（Conventional Commits）、提交前规则引擎 +
 *    可选 AI 审查（/observability/api/git/* 与 /observability/api/review）。
 *
 * 轨迹回放面板**已移除**（官方 @deepseek-ai/dsh-client-ui-trajectory 自
 * 0.1.7-rc.2 起默认装载，提供按轮次的事件记录表 + 交互式时间概览与检查器）。
 * 本插件保留的真增量是 host 侧的审计落盘与查询 API（/observability/api 的
 * sessions / events 端点）、结构化 Git 工具、提交前增量 diff 审查与资源看门狗。
 *
 * 面板可见（visible）时轮询（RESOURCE_POLL_MS），隐藏时暂停（省请求）。
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 *
 * 侧边栏走**宿主原生扩展点**（issue #187 批 1），不再消费第三方侧边栏服务：
 * sidebarRightTabs 注册页签类型（guide 胶囊供用户从右栏指南页打开），slots 的
 * sidebar.right.pane.tab / .title 两个 keyed 席位注册面板与标题（key = 类型 id）。
 * 原生能力经 Cordis 服务名 inject 获取，无需 require 任何
 * @deepseek-ai/dsh-client-ui-* 包（官方范本：
 * dsh-client-ui-sidebar-files/lib/client.js:681-711）。
 *
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs
 * 先编译 client TS 片段（src/client/parts/*.ts → lib/.client-build/parts/*.js），
 * 再将这些片段（无 import/export 的纯函数声明文本；图标片段来自 dsh-shared
 * 共享 client-parts，见 docs/UI规范.md）经下方 __PART_*__ 占位符（函数式
 * replaceAll，避免 $&/$1 特殊解释）拼接进 factory 作用域，写出
 * lib/client.js —— 即 DSH 实际服务的产物。产物必须提交；CI 只对产物执行
 * node --check（见 scripts/test-all.sh / .github/workflows/ci.yml）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-observability',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    // 原生页签身份（issue #187 批 1）：id/kind 与迁移前 better-sidebar 的 tab id 同约定（每面板一个类型，id 全局唯一且是席位 key），order 为指南页顺序。
    const RESOURCE_TAB_ID = 'dsh-my-observability:resources'
    const GIT_TAB_ID = 'dsh-my-observability:git'
    const RESOURCE_TAB_ORDER = 40
    const GIT_TAB_ORDER = 41

    // ── parts（scripts/build.mjs 拼接；顺序固定）───────────────────────
    /**
 * 原生侧边栏页签注册助手（issue #187 批 1；scripts/build.mjs 拼接片段）。
 *
 * 原生结构：每个面板一个**页签类型**（sidebarRightTabs.register）+ 两个
 * **keyed 席位**（slots.register，body 与 title）。id 全局唯一且是席位的
 * key，一个 key 只能注册一个席位 —— 本插件有两个独立面板，因此每个 kind 用
 * 自己的 id（沿用迁移前 better-sidebar 的 tab id）。
 *
 * 片段无 import/export，共享 client.src.js 的 factory 作用域：本函数的参数
 * 全部由调用方（apply）注入，便于单测与阅读。
 */
function registerNativeTab(ctx, tabs, slots, spec) {
  ctx.effect(
    () =>
      tabs.register({
        id: spec.id,
        kind: spec.id,
        title: spec.title,
        guide: [{ order: spec.order, title: spec.title }],
      }),
    'dsh-my-observability: ' + spec.label + ' tab',
  )
  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab', () =>
        slots.register({ name: 'sidebar.right.pane.tab', key: spec.id }, spec.Body),
      ),
    'dsh-my-observability: ' + spec.label + ' tab body',
  )
  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab.title', () =>
        slots.register({ name: 'sidebar.right.pane.tab.title', key: spec.id }, spec.Title),
      ),
    'dsh-my-observability: ' + spec.label + ' tab title',
  )
}

/** 原生 tab title 席位：宿主给定标题优先，否则回退面板自带文案。 */
function nativeTabTitle(fallback) {
  return function TabTitle(props) {
    const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
    return createElement('span', null, info?.tab?.title ?? fallback())
  }
}

    "use strict";
// ── i18n（浏览器语言判定）──────────────────────────────────────────
function isZh() {
    try {
        const lang = (navigator.language || 'en').toLowerCase();
        return lang.startsWith('zh');
    }
    catch {
        return false;
    }
}
// 只保留两个面板（资源监控 / Git 工具）与设置页实际引用的文案；
// 轨迹回放面板移除后其专属文案（类型徽标/过滤/导出/统计）一并删除。
const strings = {
    resourceTitle: () => (isZh() ? '资源监控' : 'Resources'),
    resourceLoading: () => (isZh() ? '资源采样中…' : 'Sampling…'),
    resourceFile: () => (isZh() ? '审计文件' : 'Audit file'),
    resourceRate: () => (isZh() ? '写入速率' : 'Write rate'),
    resourceCpu: () => (isZh() ? 'CPU' : 'CPU'),
    resourceMem: () => (isZh() ? '内存' : 'Memory'),
    gitTitle: () => (isZh() ? 'Git 工具' : 'Git Tools'),
    retry: () => (isZh() ? '重试' : 'Retry'),
    loadError: () => (isZh() ? '加载失败' : 'Load failed'),
    loading: () => (isZh() ? '加载中…' : 'Loading…'),
    // Git 面板
    repoPlaceholder: () => (isZh() ? '如 /path/to/project' : 'e.g. /path/to/project'),
    loadRepo: () => (isZh() ? '加载' : 'Load'),
    branch: () => (isZh() ? '分支' : 'Branch'),
    staged: () => (isZh() ? '已暂存' : 'staged'),
    unstaged: () => (isZh() ? '未暂存' : 'unstaged'),
    clean: () => (isZh() ? '工作区干净' : 'Working tree clean'),
    diffTitle: () => (isZh() ? '差异' : 'Diff'),
    showDiff: () => (isZh() ? '查看差异' : 'Show diff'),
    showStagedDiff: () => (isZh() ? '查看暂存差异' : 'Staged diff'),
    emptyDiff: () => (isZh() ? '（空）' : '(empty)'),
    review: () => (isZh() ? '提交前审查' : 'Review'),
    reviewResult: () => (isZh() ? '审查结果' : 'Review result'),
    reviewPass: () => (isZh() ? '未发现问题' : 'No issues found'),
    commitTitle: () => (isZh() ? '类型化提交' : 'Typed commit'),
    commitScope: () => (isZh() ? '范围（可选）' : 'Scope (optional)'),
    commitDesc: () => (isZh() ? '描述' : 'Description'),
    commitBody: () => (isZh() ? '正文（可选）' : 'Body (optional)'),
    commit: () => (isZh() ? '提交' : 'Commit'),
    committed: () => (isZh() ? '已提交' : 'Committed'),
    commitError: () => (isZh() ? '提交失败' : 'Commit failed'),
    severityError: () => (isZh() ? '错误' : 'Error'),
    severityWarning: () => (isZh() ? '警告' : 'Warning'),
    severityInfo: () => (isZh() ? '提示' : 'Info'),
    aiVerdictApprove: () => (isZh() ? 'AI 结论：可以提交' : 'AI verdict: approve'),
    aiVerdictChanges: () => (isZh() ? 'AI 结论：建议修改' : 'AI verdict: changes'),
    aiFailed: () => (isZh() ? 'AI 审查不可用' : 'AI review unavailable'),
    // 设置页（设置 → 插件 → 可观测性，issue #383）
    settingsTitle: () => (isZh() ? '可观测性' : 'Observability'),
    settingsSectionTitle: () => (isZh() ? 'AI 审查' : 'AI review'),
    settingsAiReviewLabel: () => (isZh() ? 'AI 审查增强' : 'AI review enhancement'),
    settingsAiReviewHint: () => isZh()
        ? '增量 diff 审查调用 AI agent 补充规则引擎结论（agents 服务不可用或超时自动降级为纯规则）'
        : 'Let an AI agent augment the rule-engine review of the incremental diff (degrades to rules only when the agents service is unavailable)',
    settingsAiTimeoutLabel: () => (isZh() ? 'AI 审查超时（ms）' : 'AI review timeout (ms)'),
    settingsAiTimeoutHint: () => isZh()
        ? '单次 AI 审查的最长等待；非正数或非有限值在保存时回退为 60000'
        : 'Max wait per AI review; non-positive or non-finite values fall back to 60000 on save',
    settingsSave: () => (isZh() ? '保存' : 'Save'),
    settingsSaved: () => (isZh() ? '已保存并生效' : 'Saved and applied'),
    settingsSaveFailed: () => (isZh() ? '保存失败' : 'Save failed'),
    settingsLoadFailedHint: () => isZh()
        ? '无法读取 /observability/api/config：请确认服务端插件已加载（改过 server 端后需重启 dsh web）'
        : 'Cannot read /observability/api/config: make sure the host half is loaded (restart dsh web after host-side changes)',
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
// ── 插件 API 请求（client 片段，跨面板共用）─────────────────────────────
// 片段无 import/export，共享 client.src.js 的 factory 作用域
// （fetch 由浏览器提供），供资源 / Git / 设置页三个面板复用。
/** 请求插件 API（非 2xx 抛错；返回响应 JSON 的 value 字段）。 */
function apiJson(path, options) {
    return fetch(path, options).then(async (res) => {
        const data = await res.json();
        if (!res.ok)
            throw new Error(data.error?.message || `HTTP ${res.status}`);
        return data.value;
    });
}

    "use strict";
// ── 资源监控区块（写放大/资源超限预警，见 lib/resource-monitor.js）──────
// 依赖 api.js 片段（apiJson）与 i18n.js（strings）。纯函数声明文本。
const RESOURCE_POLL_MS = 15000;
function fmtResourceBytes(bytes) {
    if (!Number.isFinite(bytes))
        return '-';
    return `${(bytes / 1048576).toFixed(1)} MB`;
}
/** 资源采样状态：可见时每 15s 轮询 /observability/api/resources，隐藏时暂停。 */
function useResourceState(visible) {
    const [resource, setResource] = useState(null);
    useEffect(() => {
        if (!visible)
            return undefined;
        let alive = true;
        const tick = () => {
            if (alive)
                apiJson('/observability/api/resources')
                    .then(setResource)
                    .catch(() => { });
        };
        tick();
        const timer = setInterval(tick, RESOURCE_POLL_MS);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [visible]);
    return resource;
}
function ResourceMetric({ label, value }) {
    return createElement('div', { className: 'dsh-my-observability-resource-metric' }, createElement('span', { className: 'dsh-my-observability-resource-label' }, label), createElement('span', { className: 'dsh-my-observability-resource-value' }, value));
}
/** 资源面板：四指标 + 告警列表（write-rate/file-size level=error 红色，cpu/memory warn 黄色）。 */
function ResourcePanel({ resource }) {
    if (resource === null || resource === undefined) {
        return createElement('div', { className: 'dsh-my-observability-state' }, icon.refresh(14), createElement('span', null, strings.resourceLoading()));
    }
    const alerts = Array.isArray(resource.alerts) ? resource.alerts : [];
    return createElement('div', { className: 'dsh-my-observability-resource' }, createElement('div', { className: 'dsh-my-observability-resource-head' }, strings.resourceTitle()), createElement('div', { className: 'dsh-my-observability-resource-grid' }, createElement(ResourceMetric, { label: strings.resourceFile(), value: fmtResourceBytes(resource.fileBytes) }), createElement(ResourceMetric, {
        label: strings.resourceRate(),
        value: `${fmtResourceBytes(resource.writeRateBytesPerHour)}/h`,
    }), createElement(ResourceMetric, {
        label: strings.resourceCpu(),
        value: `${Math.round(resource.cpuPercent ?? 0)}%`,
    }), createElement(ResourceMetric, { label: strings.resourceMem(), value: fmtResourceBytes(resource.memoryBytes) })), alerts.length > 0
        ? createElement('div', { className: 'dsh-my-observability-resource-alerts' }, alerts.map((alert) => createElement('div', { className: `dsh-my-observability-resource-alert dsh-my-observability-resource-alert-${alert.level}` }, alert.message)))
        : null);
}

    "use strict";
// ── Git 工具 + 增量 diff 审查面板 ──────────────────────────────────
const REPO_KEY = 'dsh-my-observability:repo';
const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'];
function loadRepoKey() {
    try {
        const value = window.localStorage.getItem(REPO_KEY);
        return typeof value === 'string' ? value : '';
    }
    catch {
        return '';
    }
}
function saveRepoKey(repo) {
    try {
        window.localStorage.setItem(REPO_KEY, repo);
    }
    catch {
        // storage is best-effort
    }
}
/** 状态条：分支 + 变更计数。 */
function StatusBar({ status }) {
    if (status === null)
        return null;
    const parts = [`${strings.branch()} ${status.branch}`];
    if (status.clean)
        parts.push(strings.clean());
    else {
        if (status.stagedCount > 0)
            parts.push(`${status.stagedCount} ${strings.staged()}`);
        if (status.unstagedCount > 0)
            parts.push(`${status.unstagedCount} ${strings.unstaged()}`);
    }
    return createElement('div', { className: 'dsh-my-observability-status' }, parts.join(' · '));
}
/** 差异文本预览。 */
function DiffView({ diff }) {
    return createElement('div', { className: 'dsh-my-observability-section' }, createElement('div', { className: 'dsh-my-observability-section-title' }, strings.diffTitle()), createElement('pre', { className: 'dsh-my-observability-diff' }, diff !== '' ? diff : strings.emptyDiff()));
}
/** 严重级别 → 中文。 */
function severityText(severity) {
    if (severity === 'error')
        return strings.severityError();
    if (severity === 'warning')
        return strings.severityWarning();
    return strings.severityInfo();
}
/** AI 结论文本（未启用/失败/成功三态，尽力而为）。 */
function aiTextOf(ai) {
    if (ai === undefined || ai === null || !ai.enabled)
        return '';
    if (ai.failed)
        return `${strings.aiFailed()}（${ai.note ?? ''}）`;
    return ai.verdict === 'approve' ? strings.aiVerdictApprove() : strings.aiVerdictChanges();
}
/** 审查报告：问题列表 + AI 结论。 */
function ReviewReport({ report }) {
    if (report === null)
        return null;
    const issues = report.issues || [];
    const rows = issues.map((issue, index) => createElement('div', {
        key: index,
        className: `dsh-my-observability-issue dsh-my-observability-issue-${issue.severity}`,
    }, createElement('span', { className: 'dsh-my-observability-issue-sev' }, severityText(issue.severity)), createElement('span', { className: 'dsh-my-observability-issue-rule' }, `${issue.rule}${issue.file !== '' ? ` ${issue.file}:${issue.line}` : ''}`), createElement('span', { className: 'dsh-my-observability-issue-msg' }, issue.message)));
    const aiText = aiTextOf(report.ai);
    return createElement('div', { className: 'dsh-my-observability-section' }, createElement('div', { className: 'dsh-my-observability-section-title' }, strings.reviewResult()), issues.length === 0
        ? createElement('div', { className: 'dsh-my-observability-review-ok' }, strings.reviewPass())
        : null, rows, aiText !== '' ? createElement('div', { className: 'dsh-my-observability-ai' }, aiText) : null);
}
/** 提交表单字段（type/scope/description/body + 提交按钮）。 */
function CommitFields({ form, update, busy, submit, }) {
    return createElement('div', { className: 'dsh-my-observability-form' }, createElement('select', {
        className: 'dsh-my-observability-select dsh-my-observability-type',
        value: form.type,
        onChange: update('type'),
    }, COMMIT_TYPES.map((type) => createElement('option', { key: type, value: type }, type))), createElement('input', {
        className: 'dsh-my-observability-input',
        placeholder: strings.commitScope(),
        value: form.scope,
        onChange: update('scope'),
    }), createElement('input', {
        className: 'dsh-my-observability-input',
        placeholder: strings.commitDesc(),
        value: form.description,
        onChange: update('description'),
    }), createElement('textarea', {
        className: 'dsh-my-observability-input dsh-my-observability-textarea',
        placeholder: strings.commitBody(),
        value: form.body,
        onChange: update('body'),
    }), createElement('div', { className: 'dsh-my-observability-actions' }, createElement('button', {
        className: 'dsh-my-observability-btn dsh-my-observability-btn-primary',
        disabled: busy,
        onClick: submit,
    }, strings.commit())));
}
/** 类型化提交表单：type/scope/description/body → POST /git/commit。 */
function CommitForm({ repo, onCommitted }) {
    const [form, setForm] = useState({ type: 'feat', scope: '', description: '', body: '' });
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [feedbackKind, setFeedbackKind] = useState('ok');
    const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });
    const submit = async () => {
        if (form.description.trim() === '') {
            setFeedback(strings.commitError());
            setFeedbackKind('error');
            return;
        }
        setBusy(true);
        try {
            const value = await apiJson('/observability/api/git/commit', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ repoPath: repo, ...form }),
            });
            setFeedback(`${strings.committed()}：${value.hash} ${value.message}`);
            setFeedbackKind('ok');
            setForm({ ...form, scope: '', description: '', body: '' });
            onCommitted();
        }
        catch (err) {
            setFeedback(`${strings.commitError()}：${err instanceof Error ? err.message : String(err)}`);
            setFeedbackKind('error');
        }
        finally {
            setBusy(false);
        }
    };
    return createElement('div', { className: 'dsh-my-observability-section' }, createElement('div', { className: 'dsh-my-observability-section-title' }, strings.commitTitle()), createElement(CommitFields, { form, update, busy, submit }), feedback !== ''
        ? createElement('div', { className: `dsh-my-observability-feedback dsh-my-observability-feedback-${feedbackKind}` }, feedback)
        : null);
}
/** 仓库路径行：输入 + 加载按钮。 */
function RepoRow({ repo, onRepoChange, onLoad, }) {
    return createElement('div', { className: 'dsh-my-observability-repo-row' }, createElement('input', {
        className: 'dsh-my-observability-input dsh-my-observability-repo-input',
        placeholder: strings.repoPlaceholder(),
        value: repo,
        onChange: (e) => onRepoChange(e.target.value),
    }), createElement('button', { className: 'dsh-my-observability-btn', onClick: onLoad }, strings.loadRepo()));
}
/** 操作按钮组：diff / staged diff / 审查。 */
function GitActions({ onDiff, onReview }) {
    return createElement('div', { className: 'dsh-my-observability-actions' }, createElement('button', { className: 'dsh-my-observability-btn', onClick: () => onDiff(false) }, strings.showDiff()), createElement('button', { className: 'dsh-my-observability-btn', onClick: () => onDiff(true) }, strings.showStagedDiff()), createElement('button', { className: 'dsh-my-observability-btn dsh-my-observability-btn-primary', onClick: onReview }, strings.review()));
}
/** 拉取仓库状态（错误写入 setError）。 */
async function fetchStatus(path, setStatus, setError) {
    if (path === '')
        return;
    try {
        setStatus(await apiJson(`/observability/api/git/status?repo=${encodeURIComponent(path)}`));
        setError('');
    }
    catch (err) {
        setError(err instanceof Error ? err.message : String(err));
    }
}
/** 拉取差异文本（staged 切换；错误写入 setError）。 */
async function fetchDiff(path, staged, setDiff, setError) {
    if (path === '')
        return;
    try {
        const value = await apiJson(`/observability/api/git/diff?repo=${encodeURIComponent(path)}&staged=${staged ? 1 : 0}`);
        setDiff(value.text);
        setError('');
    }
    catch (err) {
        setError(err instanceof Error ? err.message : String(err));
    }
}
/** 运行提交前审查（错误写入 setError）。 */
async function runReview(path, setReport, setError) {
    if (path === '')
        return;
    try {
        setReport(await apiJson('/observability/api/review', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ repoPath: path }),
        }));
        setError('');
    }
    catch (err) {
        setError(err instanceof Error ? err.message : String(err));
    }
}
/** Git 面板主组件：仓库状态 / diff / 审查 / 类型化提交。 */
function GitPanel() {
    const [repo, setRepo] = useState(loadRepoKey);
    const [status, setStatus] = useState(null);
    const [diff, setDiff] = useState('');
    const [report, setReport] = useState(null);
    const [error, setError] = useState('');
    const onCommitted = async () => {
        setDiff('');
        setReport(null);
        await fetchStatus(repo, setStatus, setError);
    };
    return createElement('div', { className: 'dsh-my-observability-panel' }, createElement(RepoRow, {
        repo,
        onRepoChange: (value) => {
            setRepo(value);
            saveRepoKey(value);
        },
        onLoad: () => fetchStatus(repo, setStatus, setError),
    }), error !== '' ? createElement('div', { className: 'dsh-my-observability-empty' }, error) : null, createElement(StatusBar, { status }), createElement(GitActions, {
        onDiff: (staged) => fetchDiff(repo, staged, setDiff, setError),
        onReview: () => runReview(repo, setReport, setError),
    }), createElement(DiffView, { diff }), createElement(ReviewReport, { report }), createElement(CommitForm, { repo, onCommitted }));
}

    "use strict";
// ── 设置页签（issue #383）：设置 → 插件 → 可观测性 ────────────────────
// 只暴露 README 已记录的 aiReview / aiTimeoutMs 两项；其余键（aiProvider /
// aiModel / aiCwd / resourceIntervalMs / resourceLimits）继续由用户在
// cordis.patch.yml 手写（服务端写回时会合并保留原条目已存在的键）。
//
// 保存 → PUT /observability/api/config → 写回 profile patch 文件；DSH 的
// watchUserPatches 热重载 patch 后重新 apply（保存即生效）。保存成功后面板
// 只更新本地状态：这两项在服务端生效，前端无缓存需要同步。
//
// 片段文件：无 import/export，共享 factory 作用域（apiJson / strings /
// createElement 由 replay.js / i18n.js / 模板提供）。
const SETTINGS_API = '/observability/api/config';
/** 设置页样式：只用自己的类名前缀 + 宿主语义 token（随 effect 注入/卸载）。 */
const SETTINGS_STYLES = `
.dsh-my-observability-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-my-observability-settings-section{display:flex;flex-direction:column;gap:8px}
.dsh-my-observability-settings-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dsh-my-observability-settings-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-observability-settings-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-my-observability-settings-label{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dsh-my-observability-settings-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dsh-my-observability-settings-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-observability-settings-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-my-observability-settings-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-observability-settings-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dsh-my-observability-settings-input{flex:none;width:120px;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-observability-settings-input:focus{outline:none;border-color:var(--dsw-alias-interactive-primary)}
.dsh-my-observability-settings-actions{display:flex;align-items:center;gap:8px}
.dsh-my-observability-settings-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-observability-settings-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-observability-settings-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-settings-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-my-observability-settings-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`;
/** 开关行（布尔配置项）。 */
function SettingsToggleRow({ label, hint, on, onChange, }) {
    return createElement('div', { className: 'dsh-my-observability-settings-row' }, createElement('div', { className: 'dsh-my-observability-settings-info' }, createElement('div', { className: 'dsh-my-observability-settings-label' }, label), createElement('div', { className: 'dsh-my-observability-settings-hint' }, hint)), createElement('div', {
        className: 'dsh-my-observability-settings-toggle',
        'data-on': String(on),
        role: 'switch',
        'aria-checked': String(on),
        onClick: () => onChange(!on),
    }));
}
/** 数字输入行（AI 审查超时 ms）。 */
function SettingsNumberRow({ label, hint, value, onChange, }) {
    return createElement('div', { className: 'dsh-my-observability-settings-row' }, createElement('div', { className: 'dsh-my-observability-settings-info' }, createElement('div', { className: 'dsh-my-observability-settings-label' }, label), createElement('div', { className: 'dsh-my-observability-settings-hint' }, hint)), createElement('input', {
        className: 'dsh-my-observability-settings-input',
        type: 'number',
        min: '1',
        step: '1000',
        value: String(value),
        onChange: (e) => onChange(Number(e.target.value)),
    }));
}
/** 保存配置：PUT 配置端点；失败只显示失败提示（绝不误报已保存）。 */
function saveSettings(draft, setSaved, setSaveError) {
    setSaved(false);
    setSaveError(false);
    apiJson(SETTINGS_API, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
    })
        .then(() => setSaved(true))
        .catch(() => setSaveError(true));
}
/** 配置加载失败视图（读不到配置时不显示表单，避免用默认值覆盖真实配置）。 */
function SettingsLoadError({ onRetry }) {
    return createElement('div', { className: 'dsh-my-observability-settings' }, createElement('div', { className: 'dsh-my-observability-settings-error' }, strings.loadError()), createElement('div', { className: 'dsh-my-observability-settings-status' }, strings.settingsLoadFailedHint()), createElement('div', { className: 'dsh-my-observability-settings-actions' }, createElement('button', { className: 'dsh-my-observability-settings-btn', onClick: onRetry }, strings.retry())));
}
/** 加载态（配置未返回前的占位，避免先渲染出默认值表单再被回填覆盖）。 */
function SettingsLoading() {
    return createElement('div', { className: 'dsh-my-observability-settings' }, createElement('div', { className: 'dsh-my-observability-settings-status' }, strings.loading()));
}
/** 配置区块：区块标题 + 两个配置行（AI 审查开关 / 超时）。 */
function SettingsConfigSection({ draft, patch, }) {
    return createElement('div', { className: 'dsh-my-observability-settings-section' }, createElement('div', { className: 'dsh-my-observability-settings-section-title' }, strings.settingsSectionTitle()), createElement(SettingsToggleRow, {
        label: strings.settingsAiReviewLabel(),
        hint: strings.settingsAiReviewHint(),
        on: draft.aiReview !== false,
        onChange: (value) => patch('aiReview', value),
    }), createElement(SettingsNumberRow, {
        label: strings.settingsAiTimeoutLabel(),
        hint: strings.settingsAiTimeoutHint(),
        value: draft.aiTimeoutMs,
        onChange: (value) => patch('aiTimeoutMs', value),
    }));
}
/** 保存区块：保存按钮 + 成功/失败提示（互斥，保存失败绝不显示"已保存"）。 */
function SettingsActions({ save, saved, saveError, }) {
    return createElement('div', { className: 'dsh-my-observability-settings-actions' }, createElement('button', { className: 'dsh-my-observability-settings-btn', onClick: save }, strings.settingsSave()), saved ? createElement('span', { className: 'dsh-my-observability-settings-saved' }, strings.settingsSaved()) : null, saveError
        ? createElement('span', { className: 'dsh-my-observability-settings-error' }, strings.settingsSaveFailed())
        : null);
}
/** 设置页视图：GET 回填 → 编辑 → 保存（各区块拆成子组件，控制单函数长度）。 */
function ObservabilitySettingsView() {
    const [draft, setDraft] = useState(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const load = () => {
        setLoading(true);
        setSaved(false);
        setSaveError(false);
        apiJson(SETTINGS_API)
            .then((value) => {
            setDraft(value);
            setLoading(false);
        })
            .catch(() => {
            setLoading(false);
            setFailed(true);
        });
    };
    useEffect(() => {
        load();
    }, []);
    if (loading)
        return createElement(SettingsLoading, null);
    if (draft === null)
        return createElement(SettingsLoadError, { onRetry: load });
    const patch = (key, value) => setDraft({ ...draft, [key]: value });
    return createElement('div', { className: 'dsh-my-observability-settings' }, createElement(SettingsConfigSection, { draft, patch }), createElement(SettingsActions, {
        save: () => saveSettings(draft, setSaved, setSaveError),
        saved,
        saveError,
    }));
}
/** 附加设置页签：slots 服务缺失（精简上下文 / 宿主未提供）时静默跳过。 */
function attachObservabilitySettingsTab(ctx) {
    // strict=false：首屏时 slots 提供者 fiber 可能尚未 active，strict 模式的
    // ctx.get 返回 undefined → 页签静默消失（要等 HMR 才出现）。取到实例即可，
    // 注册本身由 slots.inject 等待槽位声明。
    const slots = typeof ctx.get === 'function' ? ctx.get('slots', false) : undefined;
    if (slots === undefined || slots === null)
        return;
    ctx.effect(() => {
        if (typeof document === 'undefined' || typeof document.head === 'undefined')
            return () => { };
        const style = document.createElement('style');
        style.setAttribute('data-dsh-my-observability-settings', 'styles');
        style.textContent = SETTINGS_STYLES;
        document.head.appendChild(style);
        return () => {
            if (style.parentNode !== null)
                style.parentNode.removeChild(style);
        };
    }, 'dsh-my-observability: settings styles');
    ctx.effect(() => slots.inject('settings.plugins.tab', () => slots.register({
        name: 'settings.plugins.tab',
        // id 必须全局唯一（list 型槽位的 tab key）：复用别人的 id 会顶掉
        // 对方那一格（宿主契约：fresh id 追加在已有条目旁）。
        id: 'dsh-my-observability-settings',
        order: 92,
        label: () => strings.settingsTitle(),
    }, ObservabilitySettingsView)), 'dsh-my-observability: settings tab registration');
}

    "use strict";
// ── 样式（DSH 语义 token，随 activation 注入 / teardown 卸载）──────
// 前缀 dsh-my-observability-（issue #54：与 dsh-my-guard 前缀分离，消除跨插件类名冲突）。
// 轨迹回放面板移除后，其专属样式（时间轴 / 事件行 / 徽标 / 过滤 chip /
// 搜索与时间范围 / 导出 / 统计表）一并删除；保留资源面板、Git 面板、
// 状态区与设置页（设置页样式在 settings.js 片段内自带）。
const STYLES = `
.dsh-my-observability-panel{display:flex;flex-direction:column;gap:10px;padding:2px 6px 8px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
.dsh-my-observability-select{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px}
.dsh-my-observability-select:disabled{opacity:.4;cursor:default}
.dsh-my-observability-input{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px}
.dsh-my-observability-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-repo-row{display:flex;gap:8px;align-items:center}
.dsh-my-observability-repo-input{flex:1}
/* ── 状态区：loading / 空 / 错误 ── */
.dsh-my-observability-state{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-state svg{flex:none;animation:dsh-my-observability-spin 1s linear infinite}
.dsh-my-observability-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:16px 8px;text-align:center;
  font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.7}
@keyframes dsh-my-observability-spin{to{transform:rotate(360deg)}}
/* ── Git 面板 ── */
.dsh-my-observability-status{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-secondary)}
.dsh-my-observability-actions{display:flex;gap:8px;flex-wrap:wrap}
.dsh-my-observability-btn{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 12px;cursor:pointer;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-observability-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-observability-btn:disabled{opacity:.5;cursor:default}
.dsh-my-observability-btn-primary{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-interactive-primary);
  background:color-mix(in srgb, var(--dsw-alias-interactive-primary) 16%, transparent)}
.dsh-my-observability-section{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}
.dsh-my-observability-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dsh-my-observability-diff{max-height:240px;overflow:auto;font:var(--dsw-font-mono-xxs);font-size:11px;line-height:1.5;
  color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);
  border-radius:6px;padding:8px;white-space:pre-wrap;word-break:break-all}
.dsh-my-observability-form{display:flex;flex-direction:column;gap:6px}
.dsh-my-observability-type{flex:none;width:96px}
.dsh-my-observability-textarea{min-height:52px;resize:vertical;font:var(--dsw-font-xxs-12)}
.dsh-my-observability-feedback{font:var(--dsw-font-xxs-12);word-break:break-all;line-height:1.5}
.dsh-my-observability-feedback-ok{color:var(--dsw-alias-state-success-primary)}
.dsh-my-observability-feedback-error{color:var(--dsw-alias-state-error-primary)}
.dsh-my-observability-issue{display:flex;flex-direction:column;gap:2px;border-radius:6px;padding:6px 8px;font:var(--dsw-font-xxs-12)}
.dsh-my-observability-issue-error{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)}
.dsh-my-observability-issue-warning{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent)}
.dsh-my-observability-issue-info{background:color-mix(in srgb, var(--dsw-alias-state-info-primary) 10%, transparent)}
.dsh-my-observability-issue-sev{font:var(--dsw-font-xxxs-strong-11);text-transform:uppercase}
.dsh-my-observability-issue-error .dsh-my-observability-issue-sev{color:var(--dsw-alias-state-error-primary)}
.dsh-my-observability-issue-warning .dsh-my-observability-issue-sev{color:var(--dsw-alias-state-warn-primary)}
.dsh-my-observability-issue-info .dsh-my-observability-issue-sev{color:var(--dsw-alias-state-info-primary)}
.dsh-my-observability-issue-rule{font:var(--dsw-font-mono-xxs);font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-my-observability-issue-msg{color:var(--dsw-alias-label-primary);line-height:1.5}
.dsh-my-observability-review-ok{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-state-success-primary)}
.dsh-my-observability-ai{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.5;
  border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;padding:6px 8px}
/* ── 资源面板 ── */
.dsh-my-observability-resource{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;margin:0 0 8px}
.dsh-my-observability-resource-head{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);margin-bottom:6px}
.dsh-my-observability-resource-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px}
.dsh-my-observability-resource-metric{display:flex;justify-content:space-between;gap:8px;font:var(--dsw-font-xxs-12)}
.dsh-my-observability-resource-label{color:var(--dsw-alias-label-secondary)}
.dsh-my-observability-resource-value{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono-xxs)}
.dsh-my-observability-resource-alerts{margin-top:6px;display:flex;flex-direction:column;gap:4px}
.dsh-my-observability-resource-alert{font:var(--dsw-font-xxxs-11);border-radius:4px;padding:2px 6px}
.dsh-my-observability-resource-alert-error{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
.dsh-my-observability-resource-alert-warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}
`;
function injectStyles() {
    if (typeof document === 'undefined' || typeof document.head === 'undefined')
        return () => { };
    const style = document.createElement('style');
    style.setAttribute('data-dsh-my-observability', 'styles');
    style.textContent = STYLES;
    document.head.appendChild(style);
    return () => {
        if (style.parentNode !== null)
            style.parentNode.removeChild(style);
    };
}


    // ── 插件体：样式注入 + 两个原生页签注册 ─────────────────────────────
    exports.inject = ['slots', 'sidebarRightTabs']

    /** 原生 tab body 席位：资源面板要 visible（隐藏时暂停采样轮询）。 */
    function ResourceTabBody(props) {
      const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
      return createElement(ResourcePanel, { resource: useResourceState(info?.tab?.visible !== false) })
    }

    /** Git 面板不接 props（迁移前组件工厂同样只是透传）。 */
    function GitTabBody() {
      return createElement(GitPanel, null)
    }

    exports.apply = function apply(ctx) {
      // 样式先注入：不依赖任何服务（服务缺失/时序未就绪也不影响面板配色）。
      ctx.effect(() => injectStyles(), 'dsh-my-observability: styles')

      // 设置页签（issue #383）：只依赖 slots（strict=false 读取），与侧边栏面板所需的 sidebarRightTabs 无关，故先于判空注册。
      attachObservabilitySettingsTab(ctx)

      const { sidebarRightTabs: tabs, slots } = ctx
      // 判空必须同时覆盖 null 与 undefined（typeof null 是 object，会骗过 === undefined）。
      if (tabs == null || slots == null) return

      registerNativeTab(ctx, tabs, slots, {
        id: RESOURCE_TAB_ID,
        order: RESOURCE_TAB_ORDER,
        label: 'resources',
        title: () => strings.resourceTitle(),
        Body: ResourceTabBody,
        Title: nativeTabTitle(() => strings.resourceTitle()),
      })
      registerNativeTab(ctx, tabs, slots, {
        id: GIT_TAB_ID,
        order: GIT_TAB_ORDER,
        label: 'git',
        title: () => strings.gitTitle(),
        Body: GitTabBody,
        Title: nativeTabTitle(() => strings.gitTitle()),
      })
    }

    return module.exports
  },
})
