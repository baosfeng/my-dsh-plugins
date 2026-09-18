/**
 * dsh-mermaid-render — client half (browser). SOURCE TEMPLATE.
 *
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs
 * 先运行 `tsc -p tsconfig.client.json` 编译 src/client/index.ts 与
 * src/client/settings.ts（设置页 part 片段），再按各占位符注入下方片段
 * /*__CLIENT_BUNDLE__* / 占位符（函数式 replaceAll，避免 $&/$1 特殊解释），
 * 写出 lib/client.js —— 即 DSH 实际服务的产物（单一 __ModuleLoader__ bundle）。
 * 产物必须提交；CI 只对产物执行 node --check（见 .github/workflows/ci.yml）。
 *
 * 编译产物为 CommonJS 格式：require / exports / module 均为本 factory 作用域
 * 变量（require 由 __ModuleLoader__ 注入，exports/module 为上方局部变量），
 * 因此产物可直接内联。client 端 TS 源码不得有运行时相对 import；UI 多文件
 * 一律拆成「无 import/export 的 part 片段」共享本作用域（如设置页），需要
 * 复杂打包时可用 esbuild/tsdown（官方 tsdown.client.ts 协议）。
 */
// 引擎载荷的占位符只由 src/client/index.ts 的编译产物承载（位于其字符串字面量内，
// 注入必须**恰好一处**，
// 见 scripts/splice.mjs）：本文件任何位置（含注释）都不要写出与它同形的字面量，
// 否则构建会因"placeholder 不止一处"显式失败 —— 这正是 issue #185 的成因
// （模板注释与产物占位符同形 → 4.45 MB base64 被注入两遍 → 产物/包体积翻倍）。
window.__ModuleLoader__.load({
  id: 'dsh-mermaid-render',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // ── 共享图标（dsh-shared/client-parts，issue #186 P1）────────────
    // 注入的 icons part 用裸 createElement（与 dsh-md-render 等 10 个插件
    // 同一份片段），故在此显式解构；tsc 产物自带 react_1 引用，两者互不影响。
    // useState/useEffect 供设置页 part（settings.ts 产物）使用——part 片段无
    // import，只能靠本作用域解构出来的变量。
    const { createElement, useState, useEffect } = require('react')
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


    // ── 共享样式注入 / DOM 扫描骨架（dsh-shared/client-parts，#186 P2）──
    // ── shared plugin stylesheet injection (dsh-shared/client-parts) ──
// 单一来源（issue #186 P2）：把「注入 <style data-<plugin>="styles"> 并随 fiber
// teardown 卸载」这段逐字相同的样板从渲染插件收口到这里。当前调用方：
// dsh-md-render（parts/apply.ts）/ dsh-mermaid-render（client/index.ts）/
// dsh-think-zh-expand（client/index.ts）——各自 scripts/build.mjs 在构建期把本
// 文件拼进 __ModuleLoader__ factory 作用域（构建时源文件，不经过 require 解析）。
//
// 为什么「无条件、最先注入、不进早退分支」：样式若挂在某个服务判空之后，
// HMR / 服务缺省时样式就丢了（dsh-file-activity 踩坑，见三处调用点的原注释）。
/**
 * 注入插件样式表，随 ctx fiber 卸载（HMR/禁用无残留）。
 *
 * @param {{ effect: (fn: () => void | (() => void), label?: string) => void }} ctx cordis client ctx
 * @param {string} attr 标识属性名（如 'data-dsh-md-render'；值固定为 'styles'）
 * @param {string} css 样式表文本
 * @param {string} label effect 标签（如 'dsh-md-render: styles'，HMR/调试定位用）
 * @returns {void}
 */
function installStyles(ctx, attr, css, label) {
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute(attr, 'styles')
    style.textContent = css
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, label)
}

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


    // ── 设置页 part（src/client/settings.ts 产物，issue #383）──────────
    "use strict";
// ── 设置页视图（issue #383）：向系统提示词注入 mermaid 能力说明 ──────────
// 官方 slots 扩展点：设置 → 插件 → Mermaid 渲染 页签。开关语义与 host 半
// （lib/config.js）一一对应：**仅显式 false 关闭**（缺失/非法值按默认开）。
// 保存走 PUT /mermaid-render/api/config → host 半写回 profile patch 文件
// （持久化）+ 当即重同步 systemPrompt section（保存即生效，不等热重载）。
//
// 本文件是 part 片段：无 import/export，与 index.ts 的 tsc 产物、dsh-shared
// client-parts 共享 __ModuleLoader__ factory 作用域（类型来自 globals.d.ts），
// 由 scripts/build.mjs 按 lib/client.src.js 的模板占位符注入本作用域。
/** 页签 id：必须全局唯一——复用宿主已发出的 id 会**替换**对方页签（静默故障）。 */
const MERMAID_SETTINGS_TAB_ID = 'mermaid-render-settings';
/** 配置端点（与 host 半 lib/routes.js 的 API_PREFIX 拼法一致）。 */
const MERMAID_SETTINGS_API = '/mermaid-render/api/config';
/** 设置页样式：只用宿主语义变量（--dsw-* / --ds-*），跟随深浅主题。 */
const MERMAID_SETTINGS_STYLES = `
.dsh-mermaid-render-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-mermaid-render-settings-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-mermaid-render-settings-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-mermaid-render-settings-label{font:var(--dsw-font-xs-strong-13)}
.dsh-mermaid-render-settings-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dsh-mermaid-render-settings-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-mermaid-render-settings-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-mermaid-render-settings-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-mermaid-render-settings-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dsh-mermaid-render-settings-actions{display:flex;align-items:center;gap:8px}
.dsh-mermaid-render-settings-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-mermaid-render-settings-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mermaid-render-settings-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-mermaid-render-settings-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-mermaid-render-settings-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`;
/** 开关行（布尔配置项）。 */
function MermaidSettingsToggle(props) {
    return createElement('div', { className: 'dsh-mermaid-render-settings-row' }, createElement('div', { className: 'dsh-mermaid-render-settings-info' }, createElement('div', { className: 'dsh-mermaid-render-settings-label' }, props.label), createElement('div', { className: 'dsh-mermaid-render-settings-hint' }, props.hint)), createElement('div', {
        className: 'dsh-mermaid-render-settings-toggle',
        'data-on': String(props.on),
        role: 'switch',
        'aria-checked': String(props.on),
        onClick: () => props.onChange(!props.on),
    }));
}
/**
 * 加载失败视图：区分失败原因给可操作提示（404 = 服务端插件未加载 / 403 =
 * 安全围栏拒绝 / 其余为网络异常），并提供重试按钮——不静默、不显示空表单。
 */
function MermaidSettingsLoadError(props) {
    const hint = props.kind === 'http:404'
        ? '服务端插件未加载：/mermaid-render/api 路由不存在（请确认已安装并启用 dsh-mermaid-render 后重启 DSH，HTTP 404）/ Host half not loaded (HTTP 404)'
        : props.kind === 'http:403'
            ? '请求被安全围栏拒绝（403）：请检查网络/代理设置 / Blocked by the trust fence (403)'
            : '网络错误或响应异常：请检查 DSH 服务是否正常运行 / Network or bad response';
    return createElement('div', { className: 'dsh-mermaid-render-settings' }, createElement('div', { className: 'dsh-mermaid-render-settings-error' }, '配置加载失败 / Failed to load config'), createElement('div', { className: 'dsh-mermaid-render-settings-status' }, hint), createElement('div', { className: 'dsh-mermaid-render-settings-actions' }, createElement('button', { className: 'dsh-mermaid-render-settings-btn', onClick: props.onRetry }, '重试 / Retry')));
}
/** 注入开关说明（灰字）：默认开，关闭只影响「主动引导」，不影响渲染本身。 */
const MERMAID_SETTINGS_HINT = '默认开启：模型在用户没写出「mermaid」字样时也会主动输出 ```mermaid 代码块。关闭后已有 mermaid 代码块照常渲染，只是不再主动引导 / When on, the model proactively emits ```mermaid blocks; when off, existing blocks still render — the model is just no longer nudged.';
/** 操作区：保存按钮 + 成功/失败提示（成功失败都留在原地，不弹窗、不静默）。 */
function MermaidSettingsActions(props) {
    return createElement('div', { className: 'dsh-mermaid-render-settings-actions' }, createElement('button', { className: 'dsh-mermaid-render-settings-btn', onClick: props.onSave }, '保存 / Save'), props.saved ? createElement('span', { className: 'dsh-mermaid-render-settings-saved' }, '已保存 / Saved') : null, props.failed
        ? createElement('span', { className: 'dsh-mermaid-render-settings-error' }, '保存失败 / Save failed')
        : null);
}
/** 配置视图（开关 + 操作区）；加载中/加载失败由主视图提前返回。 */
function MermaidSettingsConfigView(props) {
    return createElement('div', { className: 'dsh-mermaid-render-settings' }, createElement(MermaidSettingsToggle, {
        label: '向系统提示词注入 mermaid 能力说明 / Inject mermaid capability note',
        hint: MERMAID_SETTINGS_HINT,
        on: props.draft.injectPrompt !== false,
        onChange: props.onPatch,
    }), createElement(MermaidSettingsActions, { saved: props.saved, failed: props.failed, onSave: props.onSave }));
}
/** 拉取当前生效配置（GET）；成功交 onValue、失败交 onError（kind 供提示区分）。 */
function loadMermaidSettingsConfig(onValue, onError) {
    fetch(MERMAID_SETTINGS_API)
        .then((res) => {
        // 保留 HTTP 状态：加载失败提示要区分「路由未注册（404）」与网络异常。
        if (!res.ok)
            throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
        return res.json();
    })
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('bad config response');
        onValue(body.value ?? {});
    })
        .catch((err) => onError(typeof err?.status === 'number' ? 'http:' + err.status : 'network'));
}
/** 保存配置（PUT）：成功 onSaved、失败 onError('save')——都只改视图状态。 */
function saveMermaidSettingsConfig(draft, onSaved, onError) {
    fetch(MERMAID_SETTINGS_API, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft ?? {}),
    })
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('save failed');
        onSaved();
    })
        .catch(() => onError('save'));
}
/** 设置页主视图：加载当前配置 → 开关编辑 → 保存（PUT 插件配置端点）。 */
function MermaidRenderSettingsView() {
    const [config, setConfig] = useState(null);
    const [draft, setDraft] = useState(null);
    const [loading, setLoading] = useState(true);
    const [errorKind, setErrorKind] = useState('');
    const [saved, setSaved] = useState(false);
    const load = () => {
        setLoading(true);
        setErrorKind('');
        loadMermaidSettingsConfig((value) => {
            setConfig(value);
            setDraft(value);
            setLoading(false);
        }, (kind) => {
            setConfig(null);
            setLoading(false);
            setErrorKind(kind);
        });
    };
    useEffect(() => {
        load();
    }, []);
    if (loading) {
        return createElement('div', { className: 'dsh-mermaid-render-settings' }, createElement('div', { className: 'dsh-mermaid-render-settings-status' }, '加载中… / Loading…'));
    }
    if (config === null)
        return createElement(MermaidSettingsLoadError, { kind: errorKind, onRetry: load });
    const save = () => {
        setSaved(false);
        setErrorKind('');
        saveMermaidSettingsConfig(draft, () => setSaved(true), (kind) => setErrorKind(kind));
    };
    return createElement(MermaidSettingsConfigView, {
        draft: draft ?? {},
        saved,
        failed: errorKind === 'save',
        onPatch: (value) => setDraft({ ...(draft ?? {}), injectPrompt: value }),
        onSave: save,
    });
}
/**
 * 注册设置页签。两处刻意的写法：
 *  - `ctx.get('slots', false)`：**必须传 strict=false**——cordis 的
 *    `ctx.get(name, strict = true)` 在服务提供者 fiber 尚未 active（首屏）
 *    时返回 undefined，页签会消失到下次 HMR；只有 strict=false 才拿得到实例。
 *  - 服务缺失（精简上下文 / 老宿主）时静默跳过：设置页是增强，不能因为
 *    拿不到 slots 就让整个 client（含 mermaid 渲染）挂掉。
 */
function attachSettingsTab(ctx) {
    // 设置页样式走共享注入器（幂等 + 随 fiber teardown 卸载）；与卡片样式一样
    // 无条件最先注入，不进任何早退分支（服务判空/HMR 时样式会丢，见共享 part 注释）。
    installStyles(ctx, 'data-dsh-mermaid-render-settings', MERMAID_SETTINGS_STYLES, 'dsh-mermaid-render: settings styles');
    const slots = typeof ctx.get === 'function' ? ctx.get('slots', false) : undefined;
    if (slots === undefined || slots === null)
        return;
    ctx.effect(() => {
        slots.inject('settings.plugins.tab', () => slots.register({
            name: 'settings.plugins.tab',
            id: MERMAID_SETTINGS_TAB_ID,
            order: 95,
            label: () => 'Mermaid',
        }, MermaidRenderSettingsView));
        return undefined;
    }, 'dsh-mermaid-render: settings tab registration');
}


    // ── TS 编译产物（scripts/build.mjs 注入）────────────────────────
    "use strict";
/**
 * dsh-mermaid-render — client 端入口（TypeScript 源码）。
 *
 * 构建流程：`tsc -p tsconfig.client.json` 编译本文件为 CommonJS
 * （lib/.client-build/index.js），scripts/build.mjs 把它与 dsh-shared
 * client-parts、src/client/settings.ts 的产物一起注入 lib/client.src.js 的
 * 占位符，写出 lib/client.js（DSH 实际服务的 __ModuleLoader__ bundle）。
 *
 * 约束：客户端 TS 源码不得出现运行时相对 import——require 只认识 DSH 运行时
 * 注入的模块（如 react）。需要拆分时用「无 import/export 的 part 片段 +
 * 模板占位符」（如 settings.ts）；复杂打包可用 esbuild/tsdown。
 *
 * 功能：会话里的 mermaid/mmd 代码块 → 图表卡片（预览/代码切换、导出、复制）
 * + 设置页签（设置 → 插件 → Mermaid 渲染，issue #383）。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// ── 导入 React（DSH 运行时注入的模块）────────────────────────────────
const react_1 = require("react");
const reactDomClient = __importStar(require("react-dom/client"));
// ── engine part：vendored mermaid engine（按需加载，非 base64 内联）──────
/**
 * mermaid 引擎由 DSH webServer 从插件 assets 目录静态托管。
 * 首次渲染时 fetch 加载，不阻塞启动。
 *
 * 构建期：scripts/build.mjs 校验 assets/mermaid-10.9.3.min.js 的 SHA256 与 UMD 形态
 * （issue #322 起该文件是引擎的**唯一真源**，原先冗余的 vendor/ 副本已删除）；
 * 运行时：ensureMermaid() 首次调用时 fetch 该文件并注入 <script>。
 *
 * 降级路径：fetch 失败时（离线/路径错误）回退到旧方案——检查
 * window.mermaid 是否已由外部加载。
 */
const MERMAID_ENGINE_URL = '/mermaid-render/assets/mermaid-10.9.3.min.js';
let mermaidReady = null;
/**
 * 引擎初始化配置。
 *
 * `suppressErrorRendering` 是 mermaid v11+ 的开关：本插件 vendored 的是 **10.9.3**，
 * 实测该版本不认识这个键 —— 传进去会被 config 静默接收（getConfig() 里能看到）
 * 但**不生效**，渲染失败时仍会往容器里插错误图形。这里依然显式传：一是升级引擎后
 * 自动多一层保险，二是真正的兜底（离屏渲染）与它互不依赖。实测证据见
 * docs/mermaid渲染/概述.md「零炸弹图」。
 */
const MERMAID_INIT = { startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true };
/** 初始化引擎；重复 initialize 抛错时忽略（配置已经在）。 */
function initEngine(engine) {
    try {
        engine.initialize(MERMAID_INIT);
    }
    catch {
        /* already initialized */
    }
    return engine;
}
/** Load (or reuse) the mermaid engine. Fetch from assets on first use. */
function ensureMermaid() {
    if (typeof window !== 'undefined' && window.mermaid) {
        return Promise.resolve(initEngine(window.mermaid));
    }
    if (mermaidReady)
        return mermaidReady;
    mermaidReady = new Promise((resolve, reject) => {
        try {
            if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') {
                reject(new Error('no document to inject mermaid'));
                return;
            }
            // fetch mermaid UMD from assets (served by DSH webServer)
            fetch(MERMAID_ENGINE_URL)
                .then((resp) => {
                if (!resp.ok)
                    throw new Error(`mermaid engine fetch failed: ${resp.status}`);
                return resp.text();
            })
                .then((code) => {
                const script = document.createElement('script');
                script.textContent = code;
                script.onerror = () => reject(new Error('mermaid engine script injection failed'));
                document.head.appendChild(script);
                const m = typeof window !== 'undefined' ? window.mermaid : undefined;
                if (!m) {
                    reject(new Error('mermaid engine missing after injection'));
                    return;
                }
                resolve(initEngine(m));
            })
                .catch((err) => {
                reject(err instanceof Error ? err : new Error(String(err)));
            });
        }
        catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    }).catch((err) => {
        mermaidReady = null; // 加载失败不留缓存：卡片「重试」必须能真的重新加载一次
        throw err instanceof Error ? err : new Error(String(err));
    });
    return mermaidReady;
}
// ── offscreen part：离屏渲染（零「炸弹图」兜底）───────────────────────
/** 离屏渲染容器标记（回归测试据此断言渲染发生在脱离文档流的节点里）。 */
const OFFSCREEN_ATTR = 'data-dsh-mermaid-render-offscreen';
/** 创建离屏渲染容器：脱离文档流并移出视口，但仍在布局树内
 *  （display:none / visibility:hidden 会让 mermaid 量不到节点尺寸）。 */
function createOffscreenHost(entryId) {
    const host = document.createElement('div');
    host.setAttribute(OFFSCREEN_ATTR, entryId);
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none';
    return host;
}
/** 丢弃离屏容器及其内部一切（失败时 mermaid 的错误图形就在里面）。 */
function dropOffscreen(host) {
    if (host.parentNode)
        host.parentNode.removeChild(host);
}
/**
 * 渲染 mermaid 源码为 SVG 字符串。
 *
 * 为什么必须离屏：mermaid 10.9.3 解析/渲染失败时**自己**往渲染容器里插一张
 * 「炸弹图」（`#d<id>` + `.error-icon` / `.error-text`，文案 "Syntax error in text"），
 * 而 `suppressErrorRendering` 在该版本无效。把渲染导向一个脱离文档流的容器后，
 * 失败图形只落在容器里，随容器一起被移除——页面永远看不到它；成功则只取返回的
 * svg 字符串注入卡片（卡片 DOM 里不会出现引擎的临时节点）。
 */
function renderSvg(engine, entryId, source) {
    const body = typeof document !== 'undefined' && document !== null ? document.body : null;
    if (body === null || body === undefined)
        return Promise.reject(new Error('no document body to render into'));
    const host = createOffscreenHost(entryId);
    body.appendChild(host);
    return engine.render(entryId, source, host).then((out) => {
        const svg = out && typeof out.svg === 'string' ? out.svg : '';
        dropOffscreen(host);
        if (!svg)
            throw new Error('mermaid 未返回 SVG');
        return svg;
    }, (err) => {
        dropOffscreen(host);
        throw err instanceof Error ? err : new Error(String(err));
    });
}
// ── detection: md-code-block + code.language-mermaid / -mmd ─────────
/** 检查是否为 mermaid 代码块。 */
function isMermaidBlock(block) {
    try {
        const code = block.querySelector('code');
        if (!code)
            return false;
        const cls = String(code.className || '').toLowerCase();
        return cls.includes('language-mermaid') || cls.includes('language-mmd');
    }
    catch {
        return false;
    }
}
/** 提取代码块源码。 */
function sourceOf(block) {
    try {
        const pre = block.querySelector('pre');
        return pre ? pre.textContent || '' : '';
    }
    catch {
        return '';
    }
}
// ── 文件类型徽标（共享 part）────────────────────────────────────────\n// FILE_BADGES（98 项扩展名映射）、badgeIcon、fileIconByExt 同属\n// dsh-shared/client-parts/icons.part.js 的图标集，构建期一并注入本作用域；\n// 这里只声明本文件用到的入口类型，实现不复制。\ndeclare const fileIconByExt: (ext: string | null | undefined, size?: number) => ReactNode
// ── export part：PNG/SVG download + copy source ─────────────────────
/** 默认文件名：mermaid-<序号>.<ext>（序号取自 entryId，如 dsh-mermaid-3 → 3）。 */
function buildExportFileName(entryId, ext) {
    const m = /(\d+)/.exec(String(entryId || ''));
    return 'mermaid-' + (m ? m[1] : '1') + '.' + ext;
}
/** 序列化 SVG DOM 为字符串；缺 xmlns 时补上（Image 加载 SVG 必需）。 */
function serializeSvg(svgEl) {
    const xml = new XMLSerializer().serializeToString(svgEl);
    return xml.includes('xmlns') ? xml : xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}
/** 触发浏览器下载：Blob → 临时 a[download] → click → 延迟 revoke URL。 */
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** 下载 SVG：序列化 → Blob(image/svg+xml) → 下载。 */
function downloadSvgFile(svgEl, fileName) {
    const blob = new Blob([serializeSvg(svgEl)], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, fileName);
}
/** 下载 PNG：SVG → Image → canvas(2x) → toBlob → 下载；失败 reject。 */
function downloadPngFile(svgEl, fileName) {
    return new Promise((resolve, reject) => {
        let url = '';
        try {
            const blob = new Blob([serializeSvg(svgEl)], { type: 'image/svg+xml;charset=utf-8' });
            url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                try {
                    const scale = 2;
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(img.width * scale));
                    canvas.height = Math.max(1, Math.round(img.height * scale));
                    const ctx = canvas.getContext('2d');
                    if (!ctx)
                        throw new Error('canvas 2d 上下文不可用');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    canvas.toBlob((pngBlob) => {
                        URL.revokeObjectURL(url);
                        if (!pngBlob) {
                            reject(new Error('PNG 编码失败'));
                            return;
                        }
                        downloadBlob(pngBlob, fileName);
                        resolve();
                    }, 'image/png');
                }
                catch (err) {
                    URL.revokeObjectURL(url);
                    reject(err instanceof Error ? err : new Error(String(err)));
                }
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('SVG 图片加载失败'));
            };
            img.src = url;
        }
        catch (err) {
            URL.revokeObjectURL(url);
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    });
}
/** 复制文本：clipboard API 优先，失败回退 execCommand；失败 reject。 */
function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
}
/** execCommand 回退复制（clipboard API 不可用/被拒时）。 */
function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok)
        throw new Error('复制失败');
}
/** 从卡片 DOM 取渲染出的 SVG 元素（按 entryId 定位，避免多卡片串扰）。 */
function findCardSvg(entryId) {
    if (typeof document === 'undefined' || document === null)
        return null;
    const host = document.querySelector('[data-dsh-mermaid-render-entry="' + entryId + '"]');
    if (!host || !host.querySelector)
        return null;
    return host.querySelector('svg');
}
/** 错误对象转可读文本（提示条用）。 */
function errMsg(err) {
    return err instanceof Error && err.message ? err.message : String(err);
}
/** 组装卡片导出 handler（issue #85）：返回 { onPng, onSvg, onCopy }，
 *  失败一律经 flashNotice 转可见提示，绝不静默。 */
function makeExportHandlers(entryId, source, flashNotice) {
    return {
        onPng: () => {
            const svgEl = findCardSvg(entryId);
            if (!svgEl) {
                flashNotice('error', '图表尚未渲染完成，无法导出 PNG');
                return;
            }
            downloadPngFile(svgEl, buildExportFileName(entryId, 'png'))
                .then(() => flashNotice('ok', 'PNG 已下载'))
                .catch((err) => flashNotice('error', 'PNG 导出失败：' + errMsg(err)));
        },
        onSvg: () => {
            const svgEl = findCardSvg(entryId);
            if (!svgEl) {
                flashNotice('error', '图表尚未渲染完成，无法导出 SVG');
                return;
            }
            try {
                downloadSvgFile(svgEl, buildExportFileName(entryId, 'svg'));
                flashNotice('ok', 'SVG 已下载');
            }
            catch (err) {
                flashNotice('error', 'SVG 导出失败：' + errMsg(err));
            }
        },
        onCopy: () => {
            copyText(source)
                .then(() => flashNotice('ok', '源码已复制'))
                .catch((err) => flashNotice('error', '复制失败：' + errMsg(err)));
        },
    };
}
// ── card part：diagram card (React) ─────────────────────────────────
let noticeTimer = null;
/**
 * 渲染状态机（issue #195）：加载引擎 → **离屏渲染** → 成功取 SVG / 失败留原因。
 * 独立成 hook 是为了让 MermaidCard 保持在函数行数门禁（≤70 行）内。
 *
 * 渲染令牌（issue #296）：effect 每次运行（含重试）先作废旧令牌再挂新令牌，异步
 * 结果落定时令牌已废就丢弃。只靠 effect 的 cancelled 标志不够——引擎加载有缓存层
 * （mermaidReady）且是慢操作，重试清缓存并发起新一轮后，上一轮仍可能迟到落定，把
 * 已渲染好的卡片打回错误态（用户看到「重试没生效」）；cancelled 只在 React 真跑
 * 清理时翻转，挡不住这种迟到。
 */
function useMermaidRender(entryId, source, attempt) {
    const [status, setStatus] = (0, react_1.useState)('loading');
    const [svg, setSvg] = (0, react_1.useState)(null);
    const [error, setError] = (0, react_1.useState)(null);
    // 令牌表随组件实例常驻（useState 初值只取一次），键为该卡片的 entryId。
    const [tokens] = (0, react_1.useState)(() => new Map());
    (0, react_1.useEffect)(() => {
        // 作废旧令牌 → 新一轮尝试拿到唯一令牌，此后旧结果一律不落定。
        const token = {};
        tokens.set(entryId, token);
        const current = () => tokens.get(entryId) === token;
        setStatus('loading');
        noteRenderState(entryId, 'loading');
        ensureMermaid()
            .then((m) => renderSvg(m, entryId, source))
            .then((svgText) => {
            if (!current())
                return;
            setSvg(svgText);
            setError(null);
            setStatus('ok');
            noteRenderState(entryId, 'ok');
        })
            .catch((err) => {
            if (!current())
                return;
            setError(errMsg(err));
            setStatus('error');
            noteRenderState(entryId, 'error');
        });
        return () => {
            if (tokens.get(entryId) === token)
                tokens.delete(entryId);
        };
    }, [entryId, source, attempt, tokens]);
    /** 立刻回到 loading（重试时先重置视图、并作废在飞的一轮，不等 effect 跑完）。 */
    function begin() {
        tokens.delete(entryId);
        setError(null);
        setStatus('loading');
        noteRenderState(entryId, 'loading');
    }
    return { status, svg, error, begin };
}
/** Mermaid 图表卡片组件。 */
function MermaidCard({ entryId, source }) {
    const [attempt, setAttempt] = (0, react_1.useState)(0);
    const [mode, setMode] = (0, react_1.useState)('preview');
    const [notice, setNotice] = (0, react_1.useState)(null);
    const { status, svg, error, begin } = useMermaidRender(entryId, source, attempt);
    /** 重试渲染：先清掉引擎加载缓存（上次可能就失败在加载），再重跑渲染。
     *  失败卡片不静默——源码与错误原因都留在卡片里，用户可改完再重试。 */
    function retry() {
        mermaidReady = null;
        begin();
        setAttempt((n) => n + 1);
    }
    /** 短暂提示（成功/失败），2.5s 后自动消失。 */
    function flashNotice(type, text) {
        setNotice({ type: type, text });
        if (noticeTimer)
            clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => setNotice(null), 2500);
    }
    const exportActions = makeExportHandlers(entryId, source, flashNotice);
    return (0, react_1.createElement)('div', { className: 'dsh-mermaid-render-card', 'data-dsh-mermaid-render-entry': entryId }, (0, react_1.createElement)('div', { className: 'dsh-mermaid-render-card-head' }, (0, react_1.createElement)('div', { className: 'dsh-mermaid-render-card-title' }, icon.file(12), (0, react_1.createElement)('span', null, 'Mermaid 图表')), (0, react_1.createElement)('div', { className: 'dsh-mermaid-render-card-actions' }, (0, react_1.createElement)(ExportButtons, {
        status,
        onPng: exportActions.onPng,
        onSvg: exportActions.onSvg,
        onCopy: exportActions.onCopy,
    }), (0, react_1.createElement)(ViewToggle, { mode, setMode }))), notice ? renderNotice(notice) : null, (0, react_1.createElement)(CardBody, { status, mode, error, source, svg, onRetry: retry }));
}
/** 导出结果提示条（成功/失败），无提示时返回 null。 */
function renderNotice(notice) {
    if (!notice)
        return null;
    return (0, react_1.createElement)('div', { className: 'dsh-mermaid-render-notice dsh-mermaid-render-notice-' + notice.type }, notice.text);
}
/** 导出按钮组：下载 PNG / 下载 SVG / 复制代码（issue #85）。 */
function ExportButtons({ status, onPng, onSvg, onCopy, }) {
    const ready = status === 'ok';
    return (0, react_1.createElement)('div', { className: 'dsh-mermaid-render-export', role: 'group', 'aria-label': 'export' }, (0, react_1.createElement)('button', {
        type: 'button',
        className: 'dsh-mermaid-render-eb',
        onClick: onPng,
        disabled: !ready,
        title: '下载 PNG',
        'aria-label': '下载 PNG',
    }, icon.download(14), (0, react_1.createElement)('span', null, '下载 PNG')), (0, react_1.createElement)('button', {
        type: 'button',
        className: 'dsh-mermaid-render-eb',
        onClick: onSvg,
        disabled: !ready,
        title: '下载 SVG',
        'aria-label': '下载 SVG',
    }, icon.download(14), (0, react_1.createElement)('span', null, '下载 SVG')), (0, react_1.createElement)('button', {
        type: 'button',
        className: 'dsh-mermaid-render-eb',
        onClick: onCopy,
        title: '复制代码',
        'aria-label': '复制代码',
    }, icon.copy(14), (0, react_1.createElement)('span', null, '复制代码')));
}
/** Preview / code view-mode toggle (card header, icon + label). */
function ViewToggle({ mode, setMode }) {
    return (0, react_1.createElement)('div', { className: 'dsh-mermaid-render-view-toggle', role: 'group', 'aria-label': 'view mode' }, (0, react_1.createElement)('button', {
        type: 'button',
        className: mode === 'preview' ? 'dsh-mermaid-render-vt dsh-mermaid-render-vt-active' : 'dsh-mermaid-render-vt',
        onClick: () => setMode('preview'),
        'aria-pressed': mode === 'preview',
    }, icon.file(14), (0, react_1.createElement)('span', null, '预览')), (0, react_1.createElement)('button', {
        type: 'button',
        className: mode === 'code' ? 'dsh-mermaid-render-vt dsh-mermaid-render-vt-active' : 'dsh-mermaid-render-vt',
        onClick: () => setMode('code'),
        'aria-pressed': mode === 'code',
    }, icon.code(14), (0, react_1.createElement)('span', null, '代码')));
}
/** Card body: loading / error banner + source / code / rendered svg. */
function CardBody({ status, mode, error, source, svg, onRetry, }) {
    if (status === 'loading') {
        return (0, react_1.createElement)('div', { className: 'dsh-mermaid-render-loading' }, icon.refresh(14), (0, react_1.createElement)('span', null, '渲染中…'));
    }
    if (status === 'error') {
        // 失败兜底：错误原因 + 重试 + **原始源码**（源码必须看得见，不能只剩一张报错卡片）
        return (0, react_1.createElement)('div', { className: 'dsh-mermaid-render-error' }, (0, react_1.createElement)('div', { className: 'dsh-mermaid-render-error-head' }, icon.alert(15), (0, react_1.createElement)('span', { className: 'dsh-mermaid-render-error-title' }, 'Mermaid 渲染失败'), (0, react_1.createElement)('button', {
            type: 'button',
            className: 'dsh-mermaid-render-eb dsh-mermaid-render-retry',
            onClick: onRetry,
            title: '重试渲染',
            'aria-label': '重试',
        }, icon.refresh(13), (0, react_1.createElement)('span', null, '重试'))), (0, react_1.createElement)('div', { className: 'dsh-mermaid-render-error-msg' }, error), (0, react_1.createElement)('pre', { className: 'dsh-mermaid-render-code' }, source));
    }
    if (mode === 'code' || !svg) {
        return (0, react_1.createElement)('pre', { className: 'dsh-mermaid-render-code' }, source);
    }
    return (0, react_1.createElement)('div', {
        className: 'dsh-mermaid-render-svg',
        dangerouslySetInnerHTML: { __html: svg },
    });
}
// ── scanner part：attach cards to mermaid blocks ─────────────────────
let seq = 0;
/**
 * 流式块稳定窗口（毫秒）。宿主在**整条消息**上挂 data-streaming（证据：
 * dsh-client-ui-chat/lib/client.js 里 "data-streaming": streaming || void 0），
 * DOM 里看不到「结束围栏是否已经出现」，只能从内容是否还在增长来判定闭合。
 * 400ms 取自真机实测的流式更新间隔（约 240ms/次）之上——比它小会把 token
 * 间隔误判成「已闭合」。误判还有第二道防线：源码再变即自愈卸载重来。
 */
const STREAM_SETTLE_MS = 400;
/** 连续观察次数（首次发现算 1 次；窗口到期再确认 1 次才允许渲染）。 */
const STREAM_MIN_OBSERVATIONS = 2;
/** 超长块跳过（与 mermaid 自身 maxTextSize 5e4 对齐，不做无谓渲染）。 */
const MAX_SOURCE_CHARS = 50000;
const mounts = new Map();
const streamWatch = new Map();
/**
 * 记录一条渲染态转移（issue #343）：把状态写到卡片 host 的真实 DOM 属性上。
 * 与 React 的提交时机解耦 —— 无论组件是否已重渲染，宿主/CSS/测试都能立刻观察到。
 */
function noteRenderState(entryId, state) {
    if (typeof document === 'undefined' || document === null)
        return;
    const host = document.querySelector('[data-dsh-mermaid-render-entry="' + entryId + '"]');
    if (host && typeof host.setAttribute === 'function')
        host.setAttribute('data-dsh-mermaid-render-state', state);
}
/** Mount a card into the block, hiding the original <pre>. */
function mountCard(block, source) {
    if (mounts.has(block))
        return;
    const pre = block.querySelector('pre');
    if (pre && pre.style)
        pre.style.display = 'none';
    const host = document.createElement('div');
    host.className = 'dsh-mermaid-render-card-host';
    block.appendChild(host);
    const root = reactDomClient.createRoot(host);
    const entryId = 'dsh-mermaid-' + ++seq;
    mounts.set(block, { root, host, pre, text: source });
    clearStreamWatch(block);
    // 渲染态可观测（issue #343）：状态机每次转移都写真实 DOM 属性（loading / ok / error），
    // 宿主 / CSS / 测试可据此**条件轮询**渲染是否落定，不必固定 sleep 赌渲染时长。
    host.setAttribute('data-dsh-mermaid-render-entry', entryId);
    host.setAttribute('data-dsh-mermaid-render-state', 'loading');
    root.render((0, react_1.createElement)(MermaidCard, { entryId, source }));
}
/** 自愈卸载：源码在挂载后又变了（流式其实还没写完）→ 拆卡片、恢复原始块。 */
function unmountCard(block, card) {
    mounts.delete(block);
    clearStreamWatch(block);
    try {
        card.root.unmount();
    }
    catch {
        /* 卸载异常不阻断恢复原始块 */
    }
    if (card.host.parentNode)
        card.host.parentNode.removeChild(card.host);
    if (card.pre && card.pre.style)
        card.pre.style.display = '';
}
/** 清掉某块的稳定观察（挂载 / 卸载 / 元素已失效时）。 */
function clearStreamWatch(block) {
    const watch = streamWatch.get(block);
    if (watch !== undefined && watch.timer !== null)
        clearTimeout(watch.timer);
    streamWatch.delete(block);
}
/** 块是否仍在流式消息里（祖先带 data-streaming）。 */
function isStreamingBlock(block) {
    return !!(block.closest && block.closest('[data-streaming]'));
}
/** 记录一次观察：内容变了就重新计时，没变就累计观察次数。 */
function watchStream(block, source, round) {
    const prev = streamWatch.get(block);
    if (prev === undefined || prev.text !== source) {
        if (prev !== undefined && prev.timer !== null)
            clearTimeout(prev.timer);
        const watch = { text: source, observations: 1, round, timer: null };
        watch.timer = setTimeout(() => settleStream(block), STREAM_SETTLE_MS);
        streamWatch.set(block, watch);
        return;
    }
    if (prev.round !== round) {
        prev.round = round;
        prev.observations += 1;
    }
}
/** 稳定窗口到期：内容仍与观察一致、且已连续观察够次数才渲染。 */
function settleStream(block) {
    const watch = streamWatch.get(block);
    if (watch === undefined)
        return;
    watch.timer = null;
    if (typeof block.isConnected === 'boolean' && !block.isConnected) {
        streamWatch.delete(block);
        return;
    }
    const source = sourceOf(block);
    if (source !== watch.text || !source.trim())
        return;
    if (mounts.has(block))
        return;
    watch.observations += 1;
    if (watch.observations < STREAM_MIN_OBSERVATIONS) {
        watch.timer = setTimeout(() => settleStream(block), STREAM_SETTLE_MS);
        return;
    }
    mountCard(block, source);
}
/** 单个候选块：挂载 / 继续等待 / 自愈卸载。 */
function considerBlock(block, round) {
    if (!isMermaidBlock(block))
        return;
    const source = sourceOf(block);
    if (!source.trim() || source.length > MAX_SOURCE_CHARS)
        return;
    const mounted = mounts.get(block);
    if (mounted !== undefined) {
        if (mounted.text === source)
            return;
        unmountCard(block, mounted); // 源码还在变：拆掉重来，绝不留残缺卡片
    }
    if (!isStreamingBlock(block)) {
        mountCard(block, source); // 历史消息 / 流式已结束：立即渲染（不回归）
        return;
    }
    watchStream(block, source, round);
}
/** Scan a subtree for mermaid md-code-blocks under conversation scrolls. */
function scanBlocks(root, round) {
    const scrolls = [];
    if (root.matches && root.matches('[data-conversation-scroll]'))
        scrolls.push(root);
    if (root.querySelectorAll) {
        for (const sc of root.querySelectorAll('[data-conversation-scroll]'))
            scrolls.push(sc);
    }
    for (const sc of scrolls) {
        for (const block of sc.querySelectorAll('div.md-code-block')) {
            considerBlock(block, round);
        }
    }
}
/** Observe the body; returns the observer disposer.
 *  骨架（观察配置 / 批次轮次 / disposer）来自共享 part（dsh-shared/client-parts/
 *  dom-scanner.part.js，与 dsh-md-render 同一份，issue #186 P2）。本插件的特有策略
 *  全部留在 scanBlocks / considerBlock 内 —— 围栏闭合判定、离屏渲染、自愈卸载；
 *  teardown 清理经 onTeardown 注入，行为与原 disposer 一致。 */
function installScanner() {
    return installDomScanner({
        // round 由共享骨架递增（同一批次的 scan 调用共享同一轮次），语义与原 scanRound 相同。
        scan: (node, round) => scanBlocks(node, round),
        // Fallback re-scan: 会话滚动容器（流式结束后内容补全，不产生 addedNodes）。
        rescanSelectors: ['[data-conversation-scroll]'],
        onTeardown: () => {
            for (const block of Array.from(streamWatch.keys()))
                clearStreamWatch(block);
            mounts.clear();
        },
    });
}
// ── styles part：DSH tokens ──────────────────────────────────────────
const STYLES = `
.dsh-mermaid-render-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 12px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2);font:var(--dsw-font-s-14);line-height:22px;color:var(--dsw-alias-label-primary);animation:dsh-mermaid-render-card-in 150ms var(--ds-ease-in-out)}
.dsh-mermaid-render-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-mermaid-render-card-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.dsh-mermaid-render-export{display:inline-flex;gap:2px;flex:none}
.dsh-mermaid-render-eb{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l1);background:transparent;border-radius:6px;padding:2px 8px;cursor:pointer;font:var(--dsw-font-xxs-12);line-height:20px;color:var(--dsw-alias-label-secondary);transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-mermaid-render-eb svg{display:block;flex:none}
.dsh-mermaid-render-eb:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-mermaid-render-eb:disabled{opacity:.45;cursor:not-allowed}
.dsh-mermaid-render-notice{border-radius:6px;padding:4px 10px;font:var(--dsw-font-xxs-12);line-height:20px}
.dsh-mermaid-render-notice-ok{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-mermaid-render-notice-error{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-mermaid-render-card-title{display:flex;align-items:center;gap:5px;font:var(--dsw-font-xxxs-strong-11);color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em}
.dsh-mermaid-render-card-title svg{display:block;flex:none}
.dsh-mermaid-render-view-toggle{display:inline-flex;gap:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:2px;flex:none}
.dsh-mermaid-render-vt{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;border-radius:6px;padding:2px 8px;cursor:pointer;font:var(--dsw-font-xxs-12);line-height:20px;color:var(--dsw-alias-label-secondary);transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-mermaid-render-vt svg{display:block;flex:none}
.dsh-mermaid-render-vt:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-mermaid-render-vt-active{background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent);color:var(--dsw-alias-accent);font-weight:600}
.dsh-mermaid-render-svg{overflow:auto;max-height:70vh}
.dsh-mermaid-render-svg svg{max-width:100%;height:auto}
.dsh-mermaid-render-code{margin:0;background:var(--dsw-alias-markdown-code-block);border-radius:6px;padding:8px 12px;overflow:auto;font:var(--dsw-font-markdown-code-block-small);white-space:pre-wrap}
.dsh-mermaid-render-loading{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-mermaid-render-loading svg{flex:none;animation:dsh-mermaid-render-spin 1s linear infinite}
.dsh-mermaid-render-error{border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);padding:8px 10px}
.dsh-mermaid-render-error-head{display:flex;align-items:center;gap:6px}
.dsh-mermaid-render-error-head svg{flex:none;color:var(--dsw-alias-state-error-primary)}
.dsh-mermaid-render-error-title{color:var(--dsw-alias-state-error-primary);font-weight:600}
.dsh-mermaid-render-error-msg{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-all;margin-top:4px;line-height:1.5}
.dsh-mermaid-render-retry{margin-left:auto;flex:none}
@keyframes dsh-mermaid-render-card-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}
@keyframes dsh-mermaid-render-spin{to{transform:rotate(360deg)}}
`;
exports.inject = [];
exports.apply = function apply(ctx) {
    // 样式注入走共享实现（issue #186 P2）：与 dsh-md-render / dsh-think-zh-expand
    // 同一份「无条件最先注入 + 随 fiber teardown 卸载」逻辑（style-tag.part.js）。
    // 位置仍在最前、不进任何早退分支（dsh-file-activity 踩坑：挂在服务判空之后，
    // HMR / 服务缺省时样式会丢）。
    installStyles(ctx, 'data-dsh-mermaid-render', STYLES, 'dsh-mermaid-render: styles');
    // 设置页签（issue #383）：注册「设置 → 插件 → Mermaid 渲染」；part 片段见
    // src/client/settings.ts（由 scripts/build.mjs 按模板占位符注入本作用域）。
    attachSettingsTab(ctx);
    ctx.effect(() => installScanner(), 'dsh-mermaid-render: scanner');
};


    return module.exports
  },
})
