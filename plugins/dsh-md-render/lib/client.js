/**
 * dsh-md-render — client half (browser).
 *
 * 统一 Markdown 渲染插件（issue #31 渲染职责迁移）：
 *  - 提供统一 MarkdownView 组件（表格 / 公式 / 代码块容器），供
 *    dsh-think-zh-expand 的 assistant-step 渲染器调用（跨插件
 *    require，见其 package.json 的 dsh.client.external 声明）；
 *  - 代码块容器 `div.md-code-block` 由本插件产出（结构保持，
 *    dsh-mermaid-render 无需改动即可扫描）；
 *  - DOM 层表格增强：扫描 `[data-conversation-scroll]` 内的
 *    `div.tzx-md`（MarkdownView 输出）与 `div.md-table-wide`（内置
 *    MarkdownText 的宽表格容器）容器，对容器内以纯文本段落形式存在
 *    的表格（`p.tzx-p`），用增强检测规则（支持无首尾管道符、分隔行
 *    变体、对齐标记）识别并解析，将段落替换为 `<table>`（表头 thead /
 *    数据 tbody / 对齐 style），外层 `div.dsh-md-render-table-scroll`
 *    提供宽表格横向滚动 + 滚动提示条；已渲染的表格（`table.tzx-table`
 *    等）跳过，不重复处理；
 *  - MutationObserver 跟随流式渲染，流式中的容器等内容稳定后再处理。
 *
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 *
 * BUILD NOTE: 本文件是源码模板（骨架）。scripts/build.mjs 把
 * lib/parts/*.part.js 片段注入到下方 /*__PART_*__* / 占位符处并写出
 * lib/client.js（DSH 实际提供的产物，单一 __ModuleLoader__ bundle，无相对
 * 路径 require）。产物必须提交（CI 只跑 node --check + 测试，不跑构建）；
 * 片段为纯函数声明文本（无 import/export），注入后处于本 factory 作用域。
 */
window.__ModuleLoader__.load({
  id: 'dsh-md-render',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // MarkdownView（markdown.part.js 片段）使用 createElement；
    // CopyButton（issue #74 复制按钮）使用 useState；设置页
    // （settings.part.js，issue #84）使用 useEffect。
    const { createElement, useState, useEffect } = require('react')

    // ── 共享图标（dsh-shared/client-parts，issue #54 阶段 0）────────
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


    // ── 渲染配置（issue #84）：增强开关状态 + setRenderOptions ──────
    // ── 渲染配置（issue #84 配置化）：增强功能开关状态 ─────────────────
// 各增强功能独立开关（默认全部开启）：copyButton / syntaxHighlight /
// languageLabel / lineNumbers / taskList / strikethrough / image /
// nestedList / mathStructures / tableSort / tableFold。client apply 默认
// 全开，随后异步经 GET /md/api/config 拉取真实配置应用（client 端不能
// 访问 ctx.config——Cordis inject 限制）；设置页保存后 setRenderOptions
// 立即应用新开关，渲染管线（代码块 / 行内 / DOM 表格）读取模块级状态。
// issue #146：选择型配置（非布尔）加入同一 options 状态——
// copyButtonPosition（代码块复制按钮位置，默认 bottom-right 与 #74
// 原始诉求一致）与 codeTheme（代码块主题，默认 bright 明亮高对比）。

/** 代码块复制按钮位置（issue #146）：header=头部右上角 | bottom-right=右下角。 */
const COPY_BUTTON_POSITIONS = ['header', 'bottom-right']

/** 代码块主题 id 列表（issue #146）：色板定义见 styles.part.js。 */
const CODE_THEMES = ['bright', 'github-light', 'github-dark', 'one-dark', 'nord']

const DEFAULT_RENDER_OPTIONS = {
  copyButton: true,
  syntaxHighlight: true,
  languageLabel: true,
  lineNumbers: true,
  taskList: true,
  strikethrough: true,
  image: true,
  nestedList: true,
  mathStructures: true,
  tableSort: true,
  tableFold: true,
  copyButtonPosition: COPY_BUTTON_POSITIONS[1],
  codeTheme: CODE_THEMES[0],
}

let renderOptions = { ...DEFAULT_RENDER_OPTIONS }
function setRenderOptions(next) {
  renderOptions = { ...renderOptions, ...(next || {}) }
}

/** 从应用层配置提取显式配置值（布尔开关仅接受布尔，选择项仅接受合法枚举；缺失/非法值保持默认，不覆盖）。 */
function pickRenderOptions(config) {
  const out = {}
  const cfg = config ?? {}
  for (const key of Object.keys(DEFAULT_RENDER_OPTIONS)) {
    if (typeof cfg[key] === 'boolean') out[key] = cfg[key]
  }
  if (COPY_BUTTON_POSITIONS.includes(cfg.copyButtonPosition)) out.copyButtonPosition = cfg.copyButtonPosition
  if (CODE_THEMES.includes(cfg.codeTheme)) out.codeTheme = cfg.codeTheme
  return out
}

/**
 * 异步从 server 端拉取配置并应用（初始化真实开关）。
 *
 * client 端 apply 不能访问 ctx.config（Cordis inject 限制：未 inject 声明
 * 的 property 访问抛 "cannot get property ... without inject"，导致插件
 * client 端 failed to apply loader entry）——真实配置经 server 端
 * GET /md/api/config 获取（与设置页同一数据源）。拉取失败保持默认全开，
 * 不阻塞渲染能力。
 */
function initConfigFromServer() {
  if (typeof fetch !== 'function') return
  fetch('/md/api/config')
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true || typeof body.value !== 'object' || body.value === null) return
      setRenderOptions(pickRenderOptions(body.value))
    })
    .catch(() => {
      // 服务不可用时保持默认（全部开启），不影响渲染。
    })
}

exports.setRenderOptions = setRenderOptions
exports.pickRenderOptions = pickRenderOptions
exports.initConfigFromServer = initConfigFromServer
exports.COPY_BUTTON_POSITIONS = COPY_BUTTON_POSITIONS
exports.CODE_THEMES = CODE_THEMES


    // ── 复制按钮（issue #74）：CopyButton + 复制工具函数 ──────────
    // ── 复制按钮（issue #74）：代码块 / 整段内容一键复制 ─────────────
// 复制实现：navigator.clipboard.writeText 优先，失败回退
// document.execCommand('copy')（textarea 中转）；复制成功后按钮文案
// 切换「已复制」1.5s 后恢复；流式渲染中（[data-streaming] 祖先）由
// styles.part.js 的 `[data-streaming] .dsh-md-render-copy{display:none}`
// 规则隐藏（按钮始终渲染，流式结束自动可见）。
function fallbackCopyText(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok
  try {
    ok = document.execCommand('copy')
  } catch (e) {
    ok = false
  }
  document.body.removeChild(ta)
  return ok
}

function copyText(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).catch(() => {
      if (!fallbackCopyText(text)) throw new Error('copy failed')
    })
  }
  if (!fallbackCopyText(text)) return Promise.reject(new Error('copy failed'))
  return Promise.resolve()
}

// 收集容器纯文本（跳过复制按钮，避免按钮文案混入复制内容）。
// 不用 textContent 直取：textContent 包含 display:none 元素的文本，
// 按钮文案会混入；递归遍历 childNodes 并跳过 .dsh-md-render-copy。
function collectCopyText(node, out) {
  if (node.nodeType === 3) {
    out.push(node.textContent)
    return
  }
  if (node.nodeType !== 1) return
  // 跳过复制按钮与代码块头部（语言标签，issue #80），避免文案混入复制内容。
  if (node.matches && (node.matches('.dsh-md-render-copy') || node.matches('.dsh-md-render-code-head'))) return
  const kids = node.childNodes || []
  for (let i = 0; i < kids.length; i += 1) collectCopyText(kids[i], out)
}

// kind: 'code'（md-code-block 内，复制 code 文本）| 'content'（tzx-md 内，
// 复制整段纯文本）。点击时从 DOM 取文本（流式结束后内容已稳定）。
function CopyButton({ kind }) {
  const [copied, setCopied] = useState(false)
  const [timer, setTimer] = useState(null)
  const onClick = (event) => {
    const host =
      event && event.currentTarget ? event.currentTarget.closest(kind === 'code' ? '.md-code-block' : '.tzx-md') : null
    if (!host) return
    let text
    if (kind === 'code') {
      const codeEl = host.querySelector('code')
      text = codeEl ? codeEl.textContent : ''
    } else {
      const out = []
      collectCopyText(host, out)
      text = out.join('')
    }
    if (!text) return
    copyText(text).then(
      () => {
        setCopied(true)
        if (timer) clearTimeout(timer)
        setTimer(setTimeout(() => setCopied(false), 1500))
      },
      () => {},
    )
  }
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-md-render-copy' + (copied ? ' dsh-md-render-copy-done' : ''),
      title: copied ? '已复制' : '复制',
      'aria-label': copied ? '已复制' : '复制',
      onClick,
    },
    copied ? '已复制' : '复制',
  )
}


    // ── 代码块增强（issue #80）：tokenizer（语法高亮）────────────────
    // ── 代码块增强（issue #80）：语法高亮 / 语言标签 / 行号 ──────────────
// 零运行时依赖（R10）：自实现轻量单遍 tokenizer（纯函数），按语言拆分
// token 输出 <span class="dsh-md-render-tok-*">；未知语言 / 超长代码块
// （>MAX_CODE_LINES 行）回退纯文本，防卡顿。行号用 CSS counter 伪元素渲
// 染，不进入 code/pre 文本内容，mermaid 扫描与复制按钮读取的原文本
// 不受污染。样式见 styles.part.js（随 activation 注入/卸载），语言标
// 签 + 复制按钮共存于代码块头部（header 行）。渲染（语言标签 / 行号 /
// 高亮 token 输出）见 codeblock.part.js。

// ── 语言别名 → 规范名（标签用）；未知语言回退纯文本 ──────────────────
const LANG_ALIAS = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  text: 'plain',
  txt: 'plain',
}
function canoLang(lang) {
  const l = String(lang || '').toLowerCase()
  return LANG_ALIAS[l] || l
}
function langLabel(lang) {
  const cfg = langConfig(lang)
  if (cfg) return cfg.label
  const l = String(lang || '')
    .toLowerCase()
    .trim()
  return l === '' || l === 'text' ? 'text' : l
}

// ── 关键字表（常见语言子集）────────────────────────────────────────
const JS_KEYWORDS = [
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'of',
  'return',
  'set',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
]
const TS_KEYWORDS = [
  ...JS_KEYWORDS,
  'abstract',
  'any',
  'as',
  'asserts',
  'bigint',
  'boolean',
  'declare',
  'enum',
  'implements',
  'infer',
  'interface',
  'is',
  'keyof',
  'never',
  'number',
  'object',
  'override',
  'private',
  'protected',
  'public',
  'readonly',
  'satisfies',
  'string',
  'symbol',
  'type',
  'unknown',
  'namespace',
  'module',
]
const PY_KEYWORDS = [
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'False',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'match',
  'None',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'self',
  'True',
  'try',
  'type',
  'while',
  'with',
  'yield',
  'case',
]
const SH_KEYWORDS = [
  'alias',
  'break',
  'case',
  'cd',
  'chmod',
  'chown',
  'continue',
  'cp',
  'curl',
  'do',
  'done',
  'echo',
  'elif',
  'else',
  'esac',
  'exit',
  'export',
  'fi',
  'for',
  'function',
  'grep',
  'if',
  'local',
  'ls',
  'mkdir',
  'mv',
  'printf',
  'pwd',
  'readonly',
  'return',
  'rm',
  'sed',
  'select',
  'set',
  'shift',
  'source',
  'then',
  'touch',
  'trap',
  'unset',
  'until',
  'wait',
  'while',
]

// ── 语言配置（keywords 关键字表；lineComment 行注释；block 块注释
//    [start,end]；quotes 字符串成对引号；triple 三引号字符串；label 标
//    签显示名）────────────────────────────────────────────────────
const LANG_CONFIGS = {
  javascript: {
    label: 'javascript',
    keywords: JS_KEYWORDS,
    lineComment: '//',
    block: ['/*', '*/'],
    quotes: ['"', "'", '`'],
  },
  typescript: {
    label: 'typescript',
    keywords: TS_KEYWORDS,
    lineComment: '//',
    block: ['/*', '*/'],
    quotes: ['"', "'", '`'],
  },
  python: {
    label: 'python',
    keywords: PY_KEYWORDS,
    lineComment: '#',
    block: [],
    quotes: ['"', "'"],
    triple: ['"""', "'''"],
  },
  json: { label: 'json', keywords: [], lineComment: null, block: null, quotes: ['"'] },
  bash: { label: 'bash', keywords: SH_KEYWORDS, lineComment: '#', block: null, quotes: ['"', "'"] },
  yaml: { label: 'yaml', keywords: [], lineComment: '#', block: null, quotes: ['"', "'"] },
  markdown: { label: 'markdown', keywords: [], lineComment: null, block: null, quotes: ['`'], markdown: true },
}
const langConfigCache = new Map()
function langConfig(lang) {
  const name = canoLang(lang)
  if (langConfigCache.has(name)) return langConfigCache.get(name)
  const base = LANG_CONFIGS[name]
  if (!base) return null
  const cfg = { ...base, kwSet: new Set(base.keywords), label: base.label }
  langConfigCache.set(name, cfg)
  return cfg
}

// ── tokenizer（纯函数，单次遍历；输出每行 token 数组）───────────────
const MAX_CODE_LINES = 500
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/
function tokenize(code, lang) {
  const cfg = langConfig(lang)
  if (!cfg)
    return String(code)
      .split('\n')
      .map((line) => [{ type: 'plain', text: line }])
  if (cfg.markdown) return tokenizeMarkdown(code)
  const state = { block: null }
  return String(code)
    .split('\n')
    .map((line) => tokenizeLine(line, cfg, state))
}

/** markdown 轻量高亮：行首 # 标题（keyword）+ 行内代码/加粗（string）。 */
function tokenizeMarkdown(code) {
  return String(code)
    .split('\n')
    .map((line) => {
      const m = /^(#{1,6})(\s+)(.*)$/.exec(line)
      if (m) {
        return [
          { type: 'keyword', text: m[1] },
          { type: 'plain', text: m[2] },
          ...tokenizeLine(m[3], null, { block: null }),
        ]
      }
      return tokenizeLine(line, null, { block: null })
    })
}

function tokenizeLine(line, cfg, state) {
  const out = []
  let rest = line
  while (rest.length > 0) {
    if (state.block) {
      rest = scanBlock(rest, state, out)
      continue
    }
    const t = firstToken(rest, cfg)
    out.push({ type: t.type, text: t.text })
    if (t.blockEnd) state.block = { end: t.blockEnd, type: t.type }
    rest = rest.slice(t.text.length)
  }
  return out
}

/** 消费处于块注释/三引号字符串中的剩余行文本，输出对应 token。 */
function scanBlock(rest, state, out) {
  const end = state.block.end
  const close = rest.indexOf(end)
  if (close === -1) {
    out.push({ type: state.block.type, text: rest })
    return ''
  }
  out.push({ type: state.block.type, text: rest.slice(0, close + end.length) })
  state.block = null
  return rest.slice(close + end.length)
}

function firstToken(rest, cfg) {
  return (
    matchBlock(rest, cfg) ||
    matchLineComment(rest, cfg) ||
    matchString(rest, cfg) ||
    matchNumber(rest) ||
    matchIdent(rest, cfg) || { type: 'plain', text: rest[0] }
  )
}

function matchBlock(rest, cfg) {
  if (!cfg || !cfg.block || cfg.block.length !== 2) return null
  const start = cfg.block[0]
  const end = cfg.block[1]
  if (!rest.startsWith(start)) return null
  const close = rest.indexOf(end, start.length)
  if (close === -1) return { type: 'comment', text: rest, blockEnd: end }
  return { type: 'comment', text: rest.slice(0, close + end.length) }
}

function matchLineComment(rest, cfg) {
  const lc = cfg && cfg.lineComment
  if (!lc || !rest.startsWith(lc)) return null
  return { type: 'comment', text: rest }
}

function matchString(rest, cfg) {
  const quotes = cfg ? cfg.quotes : ['"', "'", '`']
  const ch = rest[0]
  if (!quotes.includes(ch)) return null
  if (cfg && cfg.triple && rest.startsWith(ch + ch + ch)) return matchTriple(rest, ch + ch + ch)
  let j = 1
  while (j < rest.length) {
    if (rest[j] === '\\') {
      j += 2
      continue
    }
    if (rest[j] === ch) return { type: 'string', text: rest.slice(0, j + 1) }
    j += 1
  }
  return { type: 'string', text: rest }
}

function matchTriple(rest, triple) {
  const close = rest.indexOf(triple, triple.length)
  if (close === -1) return { type: 'string', text: rest, blockEnd: triple }
  return { type: 'string', text: rest.slice(0, close + triple.length) }
}

function matchNumber(rest) {
  const m = /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)/.exec(rest)
  return m ? { type: 'number', text: m[0] } : null
}

function matchIdent(rest, cfg) {
  const m = IDENT_RE.exec(rest)
  if (!m) return null
  const word = m[0]
  const kw = cfg && cfg.kwSet
  if (kw && kw.has(word)) return { type: 'keyword', text: word }
  if (/^\s*\(/.test(rest.slice(word.length))) return { type: 'function', text: word }
  return { type: 'identifier', text: word }
}

exports.tokenizeCode = tokenize
exports.langLabel = langLabel


    // ── 代码块增强（issue #80）：语言标签 + 复制按钮头部 + 行号 ─────
    // ── 代码块渲染（issue #80）：语言标签 + 复制按钮头部 + 行号 + 高亮 ──
// 结构：div.md-code-block > div.dsh-md-render-code-head（语言名 + 复制
// 按钮，同排）+ pre.tzx-pre > code.language-xxx（token 高亮 / 行号）。
// 行号用 CSS counter 伪元素渲染，不进入 code/pre 文本内容，mermaid 扫
// 描与复制按钮读取的原文本不受污染。语法高亮 tokenizer 见
// highlight.part.js。
// 增强开关（issue #84）：renderOptions 见 config.part.js（copyButton /
// syntaxHighlight / languageLabel / lineNumbers），apply(ctx) 从配置
// 读取，测试可用 setRenderOptions 切换。模块级变量，MarkdownView 渲染
// 代码块时读取。
// issue #146：复制按钮位置可配置（copyButtonPosition：header=头部右上
// 角 | bottom-right=右下角默认，与 #74 原始诉求一致——按钮作为
// md-code-block 直接子元素绝对定位右下角）；代码主题经 data-theme 属性
// 选择色板（styles.part.js），仅实际高亮的代码块携带主题（syntaxHighlight
// 关闭/未知语言/超长跳过高亮时无 data-theme → 保持 DSH 默认样式，
// 主题不影响纯文本代码块，开关语义不回归）。

// token 类型 → 高亮类名（其余类型渲染为纯文本）。
const TOKEN_CLASS = {
  keyword: 'dsh-md-render-tok-keyword',
  string: 'dsh-md-render-tok-string',
  comment: 'dsh-md-render-tok-comment',
  number: 'dsh-md-render-tok-number',
  function: 'dsh-md-render-tok-function',
}

function renderTokens(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]
    const cls = TOKEN_CLASS[t.type]
    out.push(cls ? createElement('span', { key: i, className: cls }, t.text) : t.text)
  }
  return out
}

function shouldHighlight(lang, lines) {
  return !!langConfig(lang) && lines.length <= MAX_CODE_LINES
}

/** 渲染代码块主体（code 内细胞）：按行输出 token / 行号 div。 */
function renderCodeCells(code, lang, lines, highlight, lineNumbers) {
  const tokens = highlight ? tokenize(code, lang) : null
  const nodes = []
  for (let i = 0; i < lines.length; i += 1) {
    const toks = tokens ? tokens[i] : [{ type: 'plain', text: lines[i] }]
    const cells = renderTokens(toks)
    if (!lineNumbers) {
      nodes.push(...cells)
    } else {
      nodes.push(createElement('div', { key: 'l' + i, className: 'dsh-md-render-code-line' }, ...cells))
    }
    if (i < lines.length - 1) nodes.push('\n')
  }
  return nodes
}

/** 代码块头部：语言标签 + （header 位置时）复制按钮；两元素都关闭时无头部。 */
function renderCodeHead(lang, bottomCopy) {
  const withHead = renderOptions.languageLabel || (renderOptions.copyButton && !bottomCopy)
  if (!withHead) return null
  return createElement(
    'div',
    { className: 'dsh-md-render-code-head' },
    renderOptions.languageLabel
      ? createElement('span', { className: 'dsh-md-render-code-lang' }, langLabel(lang))
      : null,
    !bottomCopy && renderOptions.copyButton ? createElement(CopyButton, { kind: 'code' }) : null,
  )
}

/** 渲染完整代码块：头部（语言名 + 复制按钮）+ pre > code（高亮/行号）。 */
function renderCodeBlock({ key, lang, code }) {
  const lines = String(code).split('\n')
  // issue #84：syntaxHighlight 关闭 → 不做 token 高亮（回退纯文本）。
  const highlight = renderOptions.syntaxHighlight && shouldHighlight(lang, lines)
  // issue #146：复制按钮位置默认右下角（bottom-right，与 #74 原始诉求
  // 一致）——按钮作为 md-code-block 直接子元素绝对定位；header 位置时
  // 按钮仍在头部（与语言标签同排，issue #80 布局）。
  const bottomCopy = renderOptions.copyButton && renderOptions.copyButtonPosition !== 'header'
  const body = renderCodeCells(code, lang, lines, highlight, renderOptions.lineNumbers)
  // issue #146：主题仅作用于实际高亮的代码块——关闭 syntaxHighlight
  // / 未知语言 / 超长跳过高亮时无 data-theme，保持 DSH 语义 token 默认
  // 样式（主题不影响纯文本代码块，开关语义不回归）。
  const blockProps = { key, className: 'md-code-block' }
  if (highlight) blockProps['data-theme'] = renderOptions.codeTheme
  return createElement(
    'div',
    blockProps,
    renderCodeHead(lang, bottomCopy),
    createElement(
      'pre',
      { className: 'tzx-pre' },
      createElement('code', { className: lang ? 'language-' + lang : '' }, ...body),
    ),
    bottomCopy ? createElement(CopyButton, { kind: 'code' }) : null,
  )
}


    // ── 公式结构（issue #82）：命令符号表 / 轻量解析器 / 结构渲染 ────
    // ── 公式命令 → Unicode 映射表（issue #82）：希腊字母 / 求和积分 /
//    常见符号 / 函数名文本 / \text 类文本命令。由 math.part.js 的
//    parseCommand / parseDelim 查表；零运行时依赖（R10）。
const GREEK_COMMANDS = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ϵ',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  varrho: 'ϱ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'ϕ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
}

const MATH_BIG_SYMS = {
  sum: '∑',
  int: '∫',
  prod: '∏',
  coprod: '∐',
  bigcup: '⋃',
  bigcap: '⋂',
  bigoplus: '⨁',
  bigotimes: '⨂',
  oint: '∮',
  iint: '∬',
  iiint: '∭',
}

const MATH_SYMBOLS = {
  times: '×',
  cdot: '⋅',
  pm: '±',
  mp: '∓',
  div: '÷',
  leq: '≤',
  geq: '≥',
  neq: '≠',
  approx: '≈',
  equiv: '≡',
  sim: '∼',
  simeq: '≃',
  propto: '∝',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  supset: '⊃',
  subseteq: '⊆',
  supseteq: '⊇',
  cup: '∪',
  cap: '∩',
  setminus: '∖',
  emptyset: '∅',
  varnothing: '∅',
  forall: '∀',
  exists: '∃',
  nexists: '∄',
  neg: '¬',
  land: '∧',
  lor: '∨',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  leftrightarrow: '↔',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  Leftrightarrow: '⇔',
  mapsto: '↦',
  ldots: '…',
  cdots: '⋯',
  vdots: '⋮',
  ddots: '⋱',
  infty: '∞',
  nabla: '∇',
  partial: '∂',
  hbar: 'ℏ',
  ell: 'ℓ',
  prime: '′',
  deg: '°',
  circ: '∘',
  bullet: '∙',
  dagger: '†',
  ddagger: '‡',
  parallel: '∥',
  perp: '⊥',
  angle: '∠',
  triangle: '△',
  square: '□',
  aleph: 'ℵ',
  Re: 'ℜ',
  Im: 'ℑ',
  oplus: '⊕',
  ominus: '⊖',
  otimes: '⊗',
  oslash: '⊘',
  odot: '⊙',
  ast: '∗',
  star: '⋆',
}

/** 函数名命令 → 罗马文本（\sin → sin）。 */
const MATH_FUNC_TEXT = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  cot: 'cot',
  sec: 'sec',
  csc: 'csc',
  arcsin: 'arcsin',
  arccos: 'arccos',
  arctan: 'arctan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  log: 'log',
  ln: 'ln',
  exp: 'exp',
  lim: 'lim',
  max: 'max',
  min: 'min',
  det: 'det',
  gcd: 'gcd',
  inf: 'inf',
  sup: 'sup',
}

/** 文本命令：参数组内容按普通文本内联（\text{if} → if）。 */
const MATH_TEXT_CMDS = ['text', 'textrm', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'operatorname']

    // ── 公式结构渲染（issue #82）：轻量 LaTeX 子集解析器 ─────────────────
// 零运行时依赖（R10）：自实现 tokenize + 递归下降，输出语义化嵌套节点
// （text / seq / frac / sqrt / supsub / big），由 math-render.part.js
// 渲染为 <span class="dsh-md-render-*"> 结构。符号映射表见
// math-symbols.part.js。回退策略（不误伤）：结构命令（\frac / \sqrt /
// 组 / 上下标）参数不完整时为「全局解析失败」→ 整个公式保持原文；未知
// 命令（\foo）保持原样文本（不报错）。由 syntax.part.js（行内）与
// markdown.part.js（块级）调用。

// ── tokenizer（纯函数）：\命令 / 花括号组 / ^ _ 上下标 / 字符 / 空白 ──
function tokenizeMath(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    if (src[i] === '\\') i = tokenizeCommand(src, i, out)
    else if (src[i] === '{') {
      out.push({ t: 'lbrace' })
      i += 1
    } else if (src[i] === '}') {
      out.push({ t: 'rbrace' })
      i += 1
    } else if (src[i] === '^' || src[i] === '_') {
      out.push({ t: src[i] === '^' ? 'sup' : 'sub' })
      i += 1
    } else if (/\s/.test(src[i])) {
      out.push({ t: 'space', v: src[i] })
      i += 1
    } else {
      out.push({ t: 'char', v: src[i] })
      i += 1
    }
  }
  return out
}

/** 消费一个 \\命令（或孤立反斜杠）token，返回新的下标。 */
function tokenizeCommand(src, i, out) {
  if (!/[A-Za-z]/.test(src[i + 1] || '')) {
    out.push({ t: 'char', v: '\\' })
    return i + 1
  }
  let j = i + 1
  while (j < src.length && /[A-Za-z]/.test(src[j])) j += 1
  out.push({ t: 'cmd', v: src.slice(i, j) })
  return j
}

// ── 解析：递归下降，输出节点数组（text / seq / frac / sqrt / supsub / big）──
function parseMath(src) {
  const tokens = tokenizeMath(String(src ?? ''))
  const state = { p: 0, failed: false }
  const nodes = parseSequence(tokens, state)
  return { nodes, failed: state.failed }
}

/** 追加文本片段到序列末尾（相邻文本合并）。 */
function mergeText(kids, v) {
  const last = kids[kids.length - 1]
  if (last !== undefined && last !== null && last.t === 'text') last.v += v
  else kids.push({ t: 'text', v })
}

/** 读取一个原子（组 / 命令 / 单个字符），供上下标等使用。 */
function readAtom(tokens, state) {
  if (state.p >= tokens.length) return null
  const tk = tokens[state.p]
  if (tk.t === 'lbrace') {
    state.p += 1
    return parseGroup(tokens, state)
  }
  if (tk.t === 'cmd') return parseCommand(tokens, state)
  if (tk.t === 'space') {
    state.p += 1
    return readAtom(tokens, state)
  }
  if (tk.t === 'rbrace' || tk.t === 'sup' || tk.t === 'sub') return null
  state.p += 1
  return { t: 'text', v: tk.v }
}

/** 解析序列，直到 token 耗尽或遇 rbrace（组边界）。 */
function parseSequence(tokens, state) {
  const kids = []
  while (state.p < tokens.length) {
    const tk = tokens[state.p]
    if (tk.t === 'rbrace') break
    if (tk.t === 'lbrace') {
      state.p += 1
      kids.push(parseGroup(tokens, state))
    } else if (tk.t === 'cmd') {
      kids.push(parseCommand(tokens, state))
    } else if (tk.t === 'sup' || tk.t === 'sub') {
      applyScript(tokens, state, kids)
    } else if (tk.t === 'space') {
      mergeText(kids, tk.v)
      state.p += 1
    } else {
      mergeText(kids, tk.v)
      state.p += 1
    }
  }
  return kids
}

/** 解析花括号组：state.p 位于 lbrace 之后；未闭合 → 全局失败（回退原文）。 */
function parseGroup(tokens, state) {
  const kids = parseSequence(tokens, state)
  if (state.p < tokens.length && tokens[state.p].t === 'rbrace') {
    state.p += 1
  } else {
    state.failed = true
  }
  return kids.length === 1 && kids[0].t !== 'seq' ? kids[0] : { t: 'seq', kids }
}

/** 尝试读花括号参数（跳过空白）；不闭合/不存在 → null（调用方决定失败）。 */
function tryGroup(tokens, state) {
  let i = state.p
  while (i < tokens.length && tokens[i].t === 'space') i += 1
  if (tokens[i] === undefined || tokens[i].t !== 'lbrace') return null
  state.p = i + 1
  const kids = parseSequence(tokens, state)
  let closed = false
  if (state.p < tokens.length && tokens[state.p].t === 'rbrace') {
    state.p += 1
    closed = true
  }
  if (!closed) return null
  return kids.length === 1 && kids[0].t !== 'seq' ? kids[0] : { t: 'seq', kids }
}

/** 上下标：把 ^/_ 后的原子绑定到序列末尾元素（supsub）；无 base → 失败回退。 */
function applyScript(tokens, state, kids) {
  const dir = tokens[state.p].t
  state.p += 1
  const atom = readAtom(tokens, state)
  if (atom === null) {
    state.failed = true
    return
  }
  const last = kids[kids.length - 1]
  if (last !== undefined && last.t === 'supsub') {
    if (dir === 'sup') last.sup = atom
    else last.sub = atom
    return
  }
  const node = { t: 'supsub', base: last !== undefined ? kids.pop() : null, sup: null, sub: null }
  if (dir === 'sup') node.sup = atom
  else node.sub = atom
  if (node.base === null) {
    state.failed = true
    return
  }
  kids.push(node)
}

/** 命令分派（表驱动分支，控制圈复杂度）。state.p 指向 \\命令 token。 */
function parseCommand(tokens, state) {
  const name = tokens[state.p].v.slice(1)
  state.p += 1
  if (name === 'frac') return parseFrac(tokens, state)
  if (name === 'sqrt') return parseSqrt(tokens, state)
  if (MATH_BIG_SYMS[name] !== undefined) return parseBig(tokens, state, MATH_BIG_SYMS[name])
  if (name === 'left' || name === 'right') return parseDelim(tokens, state)
  if (MATH_TEXT_CMDS.includes(name)) return parseTextCmd(tokens, state)
  const sym = GREEK_COMMANDS[name]
  if (sym !== undefined) return { t: 'text', v: sym }
  const symbol = MATH_SYMBOLS[name]
  if (symbol !== undefined) return { t: 'text', v: symbol }
  const fn = MATH_FUNC_TEXT[name]
  if (fn !== undefined) return { t: 'text', v: fn }
  return { t: 'text', v: '\\' + name }
}

/** 分数：\frac{num}{den}；参数不完整 → 全局失败（整体回退原文）。 */
function parseFrac(tokens, state) {
  const num = tryGroup(tokens, state)
  if (num !== null) {
    const den = tryGroup(tokens, state)
    if (den !== null) return { t: 'frac', num, den }
  }
  state.failed = true
  return { t: 'text', v: '\\frac' }
}

/** 根号：\sqrt{body}；无体 → 全局失败。 */
function parseSqrt(tokens, state) {
  const body = tryGroup(tokens, state)
  if (body !== null) return { t: 'sqrt', body }
  state.failed = true
  return { t: 'text', v: '\\sqrt' }
}

/** 大符号（求和/积分等）：\sum_{sub}^{sup}，上下限可选。 */
function parseBig(tokens, state, sym) {
  const sub = tryScript(tokens, state, 'sub')
  const sup = tryScript(tokens, state, 'sup')
  return { t: 'big', sym, sub, sup }
}

/** 尝试读上下限脚本（_{...} 或 ^{...}）；不存在 → null。 */
function tryScript(tokens, state, dir) {
  let i = state.p
  while (i < tokens.length && tokens[i].t === 'space') i += 1
  if (tokens[i] === undefined || tokens[i].t !== dir) return null
  state.p = i + 1
  return readAtom(tokens, state)
}

/** \left / \right 定界符：后随字符或组按普通文本渲染（不构造结构）。 */
function parseDelim(tokens, state) {
  if (state.p >= tokens.length) return { t: 'text', v: '' }
  const tk = tokens[state.p]
  if (tk.t === 'space') {
    state.p += 1
    return parseDelim(tokens, state)
  }
  if (tk.t === 'char') {
    state.p += 1
    return { t: 'text', v: tk.v }
  }
  if (tk.t === 'cmd') {
    const name = tk.v.slice(1)
    if (name === 'vert') {
      state.p += 1
      return { t: 'text', v: '|' }
    }
    if (name === 'Vert') {
      state.p += 1
      return { t: 'text', v: '‖' }
    }
    const sym = GREEK_COMMANDS[name] ?? MATH_SYMBOLS[name]
    if (sym !== undefined) {
      state.p += 1
      return { t: 'text', v: sym }
    }
  }
  if (tk.t === 'lbrace') {
    state.p += 1
    return parseGroup(tokens, state)
  }
  return { t: 'text', v: '' }
}

/** 文本命令：\text{...} 参数组按普通文本内联。 */
function parseTextCmd(tokens, state) {
  const body = tryGroup(tokens, state)
  if (body !== null) return body
  return { t: 'text', v: '' }
}

exports.parseMath = parseMath

    // ── 公式结构渲染（issue #82）：AST 节点 → React 元素 ────────────────
// 由 math.part.js（解析）产出节点数组，本文件渲染为语义化嵌套结构：
//   frac → span.dsh-md-render-frac（num / den 上下 + 分数线）
//   sqrt → span.dsh-md-render-sqrt（√ 符号 + body 顶部根号线）
//   supsub → span.dsh-md-render-supsub（base + 上下标 scripts）
//   big → span.dsh-md-render-big（求和/积分符号 + 上下限）
//   seq → span.dsh-md-render-seq（组内联，无样式）
// 样式见 styles.part.js（语义 token，深浅主题自适应；随 activation 注入）。
let __mathKey = 0
function mathNodesToReact(nodes) {
  return nodes.map(renderMathNode)
}

function renderMathNode(node) {
  const k = 'm' + __mathKey++
  if (node === null || node === undefined) return ''
  if (node.t === 'text') return node.v
  if (node.t === 'seq')
    return createElement('span', { key: k, className: 'dsh-md-render-seq' }, ...mathNodesToReact(node.kids))
  if (node.t === 'frac') return renderFrac(node, k)
  if (node.t === 'sqrt') return renderSqrt(node, k)
  if (node.t === 'supsub') return renderSupsub(node, k)
  if (node.t === 'big') return renderBig(node, k)
  return ''
}

function renderFrac(node, k) {
  return createElement(
    'span',
    { key: k, className: 'dsh-md-render-frac' },
    createElement('span', { key: k + 'n', className: 'dsh-md-render-frac-num' }, ...mathNodesToReact([node.num])),
    createElement('span', { key: k + 'd', className: 'dsh-md-render-frac-den' }, ...mathNodesToReact([node.den])),
  )
}

function renderSqrt(node, k) {
  return createElement(
    'span',
    { key: k, className: 'dsh-md-render-sqrt' },
    createElement('span', { key: k + 's', className: 'dsh-md-render-sqrt-symbol' }, '√'),
    createElement('span', { key: k + 'b', className: 'dsh-md-render-sqrt-body' }, ...mathNodesToReact([node.body])),
  )
}

function renderSupsub(node, k) {
  const scripts =
    node.sup !== null || node.sub !== null
      ? createElement(
          'span',
          { key: k + 's', className: 'dsh-md-render-supsub-scripts' },
          node.sup !== null
            ? createElement(
                'span',
                { key: k + 'u', className: 'dsh-md-render-supsub-sup' },
                ...mathNodesToReact([node.sup]),
              )
            : null,
          node.sub !== null
            ? createElement(
                'span',
                { key: k + 'd', className: 'dsh-md-render-supsub-sub' },
                ...mathNodesToReact([node.sub]),
              )
            : null,
        )
      : null
  return createElement(
    'span',
    { key: k, className: 'dsh-md-render-supsub' },
    createElement('span', { key: k + 'b', className: 'dsh-md-render-supsub-base' }, ...mathNodesToReact([node.base])),
    scripts,
  )
}

function renderBig(node, k) {
  return createElement(
    'span',
    { key: k, className: 'dsh-md-render-big' },
    node.sup !== null || node.sub !== null
      ? createElement(
          'span',
          { key: k + 'l', className: 'dsh-md-render-big-limits' },
          node.sup !== null
            ? createElement(
                'span',
                { key: k + 'u', className: 'dsh-md-render-big-sup' },
                ...mathNodesToReact([node.sup]),
              )
            : null,
          node.sub !== null
            ? createElement(
                'span',
                { key: k + 'd', className: 'dsh-md-render-big-sub' },
                ...mathNodesToReact([node.sub]),
              )
            : null,
        )
      : null,
    createElement('span', { key: k + 'y', className: 'dsh-md-render-big-symbol' }, node.sym),
  )
}

exports.mathNodesToReact = mathNodesToReact


    // ── 语法补全（issue #81）：图片 / 任务列表 / 行内元素构造 / 列表解析 ──
    // ── 语法补全（issue #81）：图片 / 任务列表 / 行内元素构造 / 列表解析 ──
// 零运行时依赖（R10）。与 markdown.part.js 处于同一 factory 作用域（经
// build.mjs 拼接），函数声明共享：markdown.part.js 的 mdInline 与块级
// MD_RENDERERS 调用本文件声明的 inlineMatch / tryList；本文件的 mdInline
// 依赖构造函数（linkEl / mathSpanOrText）与列表解析（listInfo / parseList）。

// ── 图片嵌入：![alt](url) → <img>，alt 兜底 + 加载失败占位 ──────
function MarkdownImage({ src, alt }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return createElement('span', { className: 'dsh-md-render-img-fallback', role: 'img' }, alt || '图片加载失败')
  }
  return createElement('img', {
    src,
    alt: alt || 'image',
    loading: 'lazy',
    className: 'dsh-md-render-img',
    onError: () => setFailed(true),
  })
}

// ── 任务列表复选框：- [ ] / - [x] → <input type=checkbox> ────────
function TaskCheckbox({ checked }) {
  const [value, setValue] = useState(Boolean(checked))
  return createElement('input', {
    type: 'checkbox',
    className: 'dsh-md-render-task-checkbox',
    checked: value,
    onChange: (e) => setValue(e.currentTarget.checked),
  })
}

// ── 行内元素构造（单分支小函数，控制 mdInline 圈复杂度 ≤ 10）──────
function linkEl(full, kk) {
  const lm = full.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
  if (lm) {
    return createElement('a', { key: kk, href: lm[2], target: '_blank', rel: 'noreferrer' }, lm[1])
  }
  return full
}

function mathSpanOrText(m, text, kk) {
  // issue #84：mathStructures 关闭 → 公式语法保持原文（不渲染公式结构）。
  if (!renderOptions.mathStructures) return m[7]
  if (isMathSpan(text, m)) {
    const content = m[7].slice(1, -1)
    const parsed = parseMath(content)
    // issue #82：轻量结构解析成功 → 渲染嵌套结构；解析失败 → 保持原文
    // （不误伤，与 R14 错误标记逻辑兼容——此处仅处理合法公式内容）。
    const kids = parsed.failed ? [content] : mathNodesToReact(parsed.nodes)
    return createElement('span', { key: kk, className: 'dsh-md-render-math' }, ...kids)
  }
  if (isMathError(m)) {
    return createElement(
      'span',
      { key: kk, className: 'dsh-md-render-math-error', title: MATH_ERROR_TITLES.malformed },
      icon.alert(12),
      m[7],
    )
  }
  return m[7]
}

function inlineMatch(m, text, kk) {
  if (m[1] !== undefined) return createElement('code', { key: kk }, trimCode(m[2]))
  if (m[3] !== undefined) return createElement('strong', { key: kk }, m[3].slice(2, -2))
  if (m[4] !== undefined) return matchImage(m, kk)
  if (m[6] !== undefined) return linkEl(m[6], kk)
  if (m[7] !== undefined) return mathSpanOrText(m, text, kk)
  if (m[8] !== undefined) return matchDel(m, kk)
  return createElement('em', { key: kk }, m[9].slice(1, -1))
}

function matchImage(m, kk) {
  // issue #84：image 关闭 → 图片语法保持原文（不解析为 <img>）。
  if (renderOptions.image) return createElement(MarkdownImage, { key: kk, src: m[5], alt: m[4] })
  return m[0]
}

function matchDel(m, kk) {
  // issue #84：strikethrough 关闭 → 删除线保持原文（不解析为 <del>）。
  if (renderOptions.strikethrough) return createElement('del', { key: kk, className: 'dsh-md-render-del' }, m[8])
  return m[0]
}

// ── 列表解析（issue #81 增强）：多级嵌套 + 任务列表（- [ ] / - [x]）
//    按缩进层级递归解析 ul / ol（保留层级正确嵌套）；任务标记
//    [ ]/[x]/[X] 渲染 checkbox（勾选态由标记决定）。复用 mdInline。────────
function listInfo(line) {
  const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
  if (!m) return null
  const indent = m[1].length
  const ordered = /^\d/.test(m[2])
  let rest = m[3]
  let task = false
  let checked = false
  // issue #84：taskList 关闭 → 任务标记保持原文（不解析 checkbox）。
  const tm = rest.match(/^\[( |x|X)\]\s+(.*)$/)
  if (tm && renderOptions.taskList) {
    task = true
    checked = tm[1] !== ' '
    rest = tm[2]
  }
  return { indent, ordered, marker: m[2], rest, task, checked }
}

function sameLevel(info, indent, ordered) {
  // issue #84：nestedList 关闭 → 忽略缩进层级，全部同级渲染（不嵌套）。
  return !!info && info.ordered === ordered && (!renderOptions.nestedList || info.indent === indent)
}

function itemKids(info, i) {
  const kids = []
  if (info.task) kids.push(createElement(TaskCheckbox, { key: 'task' + i, checked: info.checked }))
  kids.push(...mdInline(info.rest, 'li' + i))
  return kids
}

function parseList(lines, start) {
  const first = listInfo(lines[start])
  const ordered = first.ordered
  const indent = first.indent
  const items = []
  let i = start
  while (i < lines.length) {
    const info = listInfo(lines[i])
    if (!sameLevel(info, indent, ordered)) break
    const kids = itemKids(info, i)
    i += 1
    while (i < lines.length) {
      // issue #84：nestedList 关闭 → 不递归解析深层列表（深层项由外层
      // 同级消费，扁平渲染）。
      if (!renderOptions.nestedList) break
      const nxt = listInfo(lines[i])
      if (!nxt || nxt.indent <= indent) break
      const nested = parseList(lines, i)
      kids.push(nested.node)
      i = nested.index
    }
    items.push(createElement('li', { key: items.length }, ...kids))
  }
  return {
    node: createElement(ordered ? 'ol' : 'ul', { className: ordered ? 'tzx-ol' : 'tzx-ul' }, ...items),
    index: i,
  }
}

function tryList(lines, i, out) {
  if (!listInfo(lines[i])) return 0
  const parsed = parseList(lines, i)
  out.push(parsed.node)
  return parsed.index
}


    // ── 统一 MarkdownView：行内 + 块级渲染（导出供 think-zh-expand）──
    // ── 统一 MarkdownView：行内 + 块级渲染（issue #31 自 dsh-think-zh-expand
//    迁移，行为等价 + 公式渲染）。由 scripts/build.mjs 拼入 client.js 的
//    factory 作用域（纯函数声明文本，依赖 factory 内 createElement）；输出
//    结构保持迁移前约定（div.tzx-md / p.tzx-p / table.tzx-table /
//    div.md-code-block）。零运行时依赖（issue #81 语法补全见 syntax.part.js）。

// ── 行内 code（CommonMark 多反引号语义）────────────────────────────
function trimCode(raw) {
  if (raw.length > 1 && raw[0] === ' ' && raw[raw.length - 1] === ' ' && raw.trim() !== '') {
    return raw.slice(1, -1)
  }
  return raw
}

// ── 行内公式候选验证（货币/变量/块级保护，通过才渲染为公式）──────
function isMathSpan(text, m) {
  const content = m[7].slice(1, -1)
  if (content === '' || content.trim() !== content) return false
  const before = text[m.index - 1]
  const after = text[m.index + m[0].length]
  if (before !== undefined && /[\w$]/.test(before)) return false
  if (after !== undefined && /[\w$]/.test(after)) return false
  return true
}

// 公式错误提示（issue #32）：异常公式 → 错误标记（原文保留 + 错误样式，
// 参考内置 katex-error 语义）；货币/变量/块级 `$$` 保护不误报。
const MATH_ERROR_TITLES = {
  malformed: '公式内容异常',
  unclosed: '未闭合的公式',
  multiline: '公式内容含换行',
  empty: '公式内容为空',
}

function isMathError(m) {
  const content = m[7].slice(1, -1)
  return content[0] === ' ' || content[0] === '\t'
}

function mathSkip(text, i) {
  const before = text[i - 1]
  const after = text[i + 1]
  if (before !== undefined && /[\w$]/.test(before)) return i + 1
  if (after === '$') return i + 2
  if (after !== undefined && /\d/.test(after)) return i + 1
  return i
}

/** 在正则未匹配区间 [start, end) 中扫描疑似公式的 `$`（未闭合/跨行 → 错误标记）。 */
function scanMathErrors(text, start, end, key, k, out) {
  let i = start
  let segStart = start
  while (i < end) {
    if (text[i] !== '$') {
      i += 1
      continue
    }
    const skip = mathSkip(text, i)
    if (skip !== i) {
      i = skip
      continue
    }
    if (i > segStart) out.push(text.slice(segStart, i))
    let j = i + 1
    while (j < end && text[j] !== '$') j += 1
    if (j >= end) {
      out.push(
        createElement(
          'span',
          { key: key + '-e' + k, className: 'dsh-md-render-math-error', title: MATH_ERROR_TITLES.unclosed },
          icon.alert(12),
          text.slice(i, end),
        ),
      )
      return k + 1
    }
    out.push(
      createElement(
        'span',
        { key: key + '-e' + k, className: 'dsh-md-render-math-error', title: MATH_ERROR_TITLES.multiline },
        icon.alert(12),
        text.slice(i, j + 1),
      ),
    )
    k += 1
    i = j + 1
    segStart = i
  }
  if (end > segStart) out.push(text.slice(segStart, end))
  return k
}

// ── 轻量行内 Markdown：行内代码 / 粗体 / 图片 / 链接 / 公式 / 删除线 / 斜体 ──
// 图片须先于链接（`![alt](url)` 内含 `[alt](url)` 链式子结构）；行内公式
// $...$ 保护货币/变量/块级 `$$`。元素构造见 syntax.part.js 的 inlineMatch。
function mdInline(text, key) {
  const out = []
  const re =
    /(`+)([^`\n][^\n]*?)\1(?!`)|(\*\*[^*]+\*\*)|!\[([^\]]*)\]\(([^)]+)\)|(\[[^\]]+\]\([^)]+\))|(\$[^$\n]+?\$)|~~([^~]+)~~|(\*[^*]+\*)/g
  let last = 0
  let m,
    k = 0
  while ((m = re.exec(text)) !== null) {
    // issue #84：mathStructures 关闭 → 不扫描疑似公式的未闭合 `$`（保持原文）。
    if (renderOptions.mathStructures) k = scanMathErrors(text, last, m.index, key, k, out)
    out.push(inlineMatch(m, text, key + '-i' + k))
    k += 1
    last = m.index + m[0].length
  }
  if (renderOptions.mathStructures) scanMathErrors(text, last, text.length, key, k, out)
  return out
}

// ── 轻量块级 Markdown：代码块 / 标题 / 列表 / 引用 / 表格 / 公式 ──
// 每个 tryXxx 尝试从 lines[i] 消费一类块：成功则 push 元素并返回下一行下标，
// 失败返回 0（不消费）。复制按钮（CopyButton，issue #74）代码块/整段右下角。
function tryFence(lines, i, out) {
  const fence = lines[i].match(/^```(\w*)\s*$/)
  if (!fence) return 0
  const buf = []
  i += 1
  while (i < lines.length && !/^```\s*$/.test(lines[i])) {
    buf.push(lines[i])
    i += 1
  }
  i += 1
  // 语法高亮 / 语言标签 / 行号（issue #80）：结构见 highlight/codeblock.part.js。
  out.push(renderCodeBlock({ key: 'b' + out.length, lang: fence[1], code: buf.join('\n') }))
  return i
}

function tryHeading(lines, i, out) {
  const heading = lines[i].match(/^(#{1,4})\s+(.*)$/)
  if (!heading) return 0
  const level = heading[1].length
  out.push(
    createElement(
      'h' + level,
      { key: 'b' + out.length, className: 'tzx-h' },
      ...mdInline(heading[2], 'h' + out.length),
    ),
  )
  return i + 1
}

function tryQuote(lines, i, out) {
  const quote = lines[i].match(/^\s*>\s?(.*)$/)
  if (!quote) return 0
  const buf = [quote[1]]
  i += 1
  while (i < lines.length) {
    const q2 = lines[i].match(/^\s*>\s?(.*)$/)
    if (!q2) break
    buf.push(q2[1])
    i += 1
  }
  out.push(
    createElement(
      'blockquote',
      { key: 'b' + out.length, className: 'tzx-bq' },
      ...buf.map((l, j) => createElement('p', { key: j }, ...mdInline(l, 'bq' + out.length + '-' + j))),
    ),
  )
  return i
}

function tryTable(lines, i, out) {
  const line = lines[i]
  const tableHead = line.match(/^\s*\|.*\|\s*$/)
  if (!tableHead) return 0
  const sep = lines[i + 1]
  const isSep = typeof sep === 'string' && /^\s*\|?[\s:\-|]+\|?\s*$/.test(sep) && sep.includes('-')
  if (!isSep) return 0
  // 无分隔行（不是标准表格）时返回 0：由段落逻辑接管，表格头行按普通行处理。
  const cellsOf = (row) =>
    row
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())
  const aligns = cellsOf(sep).map((a) => {
    if (a.startsWith(':') && a.endsWith(':')) return 'center'
    if (a.endsWith(':')) return 'right'
    return 'left'
  })
  const header = cellsOf(line)
  const dataRows = []
  i += 2
  while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
    dataRows.push(cellsOf(lines[i]))
    i += 1
  }
  const cellStyle = (j) => ({ textAlign: aligns[j] ?? 'left' })
  out.push(
    createElement(
      'table',
      { key: 'b' + out.length, className: 'tzx-table' },
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          header.map((c, j) =>
            createElement('th', { key: j, style: cellStyle(j) }, ...mdInline(c, 'th' + out.length + '-' + j)),
          ),
        ),
      ),
      dataRows.length > 0
        ? createElement(
            'tbody',
            null,
            dataRows.map((row, ri) =>
              createElement(
                'tr',
                { key: ri },
                row.map((c, j) =>
                  createElement(
                    'td',
                    { key: j, style: cellStyle(j) },
                    ...mdInline(c, 'td' + out.length + '-' + ri + '-' + j),
                  ),
                ),
              ),
            ),
          )
        : null,
    ),
  )
  return i
}

// ── 块级公式：$$...$$ 单行或 $$ 开闭块；异常（未闭合/空）→ 错误标记 ──
function mathErrorEl(out, title, content) {
  return createElement(
    'div',
    { key: 'b' + out.length, className: 'dsh-md-render-math-error', title },
    icon.alert(12),
    content,
  )
}

function tryMath(lines, i, out) {
  // issue #84：mathStructures 关闭 → 块级公式不渲染为公式结构（回退段落）。
  if (!renderOptions.mathStructures) return 0
  return tryMathEnabled(lines, i, out)
}

function tryMathEnabled(lines, i, out) {
  const single = lines[i].match(/^\$\$([^$]*)\$\$\s*$/)
  if (single) {
    const content = single[1].trim()
    out.push(content === '' ? mathErrorEl(out, MATH_ERROR_TITLES.empty, lines[i].trim()) : mathBlockEl(out, content))
    return i + 1
  }
  if (!/^\$\$\s*$/.test(lines[i])) return 0
  const buf = []
  i += 1
  while (i < lines.length && !/^\$\$\s*$/.test(lines[i])) {
    buf.push(lines[i])
    i += 1
  }
  const closed = i < lines.length
  i += 1
  const content = buf.join('\n').trim()
  const err = !closed ? MATH_ERROR_TITLES.unclosed : content === '' ? MATH_ERROR_TITLES.empty : null
  out.push(err ? mathErrorEl(out, err, !closed ? '$$\n' + buf.join('\n') : '$$\n$$') : mathBlockEl(out, content))
  return i
}

/** 块级公式内容：轻量结构解析成功 → 嵌套结构；失败 → 保持原文（issue #82）。 */
function mathBlockEl(out, content) {
  const parsed = parseMath(content)
  const kids = parsed.failed ? [content] : mathNodesToReact(parsed.nodes)
  return createElement('div', { key: 'b' + out.length, className: 'dsh-md-render-math-block' }, ...kids)
}

function tryParagraph(lines, i, out) {
  const para = [lines[i]]
  i += 1
  while (i < lines.length) {
    const nxt = lines[i]
    if (nxt.trim() === '' || /^(#{1,4})\s|^\s*[-*+]\s|^\s*\d+[.)]\s|^\s*>\s?|^```|^\$\$/.test(nxt)) break
    para.push(nxt)
    i += 1
  }
  out.push(
    createElement('p', { key: 'b' + out.length, className: 'tzx-p' }, ...mdInline(para.join('\n'), 'p' + out.length)),
  )
  return i
}

// 块级渲染顺序（与迁移前逐分支判断的顺序一致，公式块追加在末尾）。
// 列表（内联 task/嵌套）与行内元素构造见 syntax.part.js。
const MD_RENDERERS = [tryFence, tryHeading, tryList, tryQuote, tryTable, tryMath]

function MarkdownView({ text }) {
  const lines = String(text).split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    let handled = false
    for (const render of MD_RENDERERS) {
      const next = render(lines, i, out)
      if (next) {
        i = next
        handled = true
        break
      }
    }
    if (handled) continue
    if (lines[i].trim() === '') {
      i += 1
      continue
    }
    i = tryParagraph(lines, i, out)
  }
  return createElement(
    'div',
    { className: 'tzx-md' },
    out,
    // issue #84：copyButton 关闭 → 整段内容复制按钮不渲染。
    renderOptions.copyButton ? createElement(CopyButton, { kind: 'content' }) : null,
  )
}

exports.MarkdownView = MarkdownView


    // ── 表格检测与解析（纯函数，导出供单测）──────────────────────
    // ── 表格检测与解析（纯函数，导出供单测）──────────────────────
// 增强检测规则（相对 dsh-think-zh-expand 的 tryTable）：
//  - 表头/数据行：含 `|` 且至少 2 列即可，允许无首尾管道符；
//  - 分隔行：只含 `-` `:` `|` 与空白的变体（--- | ---、-|-|-、---）；
//  - 对齐标记：`:---` 左、`:---:` 中、`---:` 右，无冒号默认左；
//  - 表格可出现在段落中间（prefix/suffix 文本保留）。

/** 分隔行：只含 - : | 与空白，且至少含一个 -。 */
function isSeparatorLine(line) {
  if (typeof line !== 'string') return false
  if (!/^\s*\|?[\s:\-|]+\|?\s*$/.test(line)) return false
  return line.includes('-')
}

/** 按 | 分割一行（去首尾管道符，逐格 trim）。 */
function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** 表格行：含 |、至少 2 列、且不是分隔行。 */
function isTableLine(line) {
  if (typeof line !== 'string') return false
  if (isSeparatorLine(line)) return false
  const t = line.trim()
  if (!t.includes('|')) return false
  return splitRow(t).length >= 2
}

/** 对齐标记解析：:--- 左、:---: 中、---: 右、其余左。 */
function parseAlign(cell) {
  if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
  if (cell.endsWith(':')) return 'right'
  return 'left'
}

/**
 * 解析表格文本 → { header, aligns, rows, prefix, suffix } 或 null。
 * 在段落内查找「表格行 + 分隔行」组合；prefix/suffix 为表格前后的
 * 非表格文本（渲染时保留）。
 */
function parseTable(text) {
  const lines = String(text).split('\n')
  for (let start = 0; start < lines.length - 1; start += 1) {
    if (!isTableLine(lines[start])) continue
    if (!isSeparatorLine(lines[start + 1])) continue
    const header = splitRow(lines[start])
    const aligns = splitRow(lines[start + 1]).map(parseAlign)
    const rows = []
    let end = start + 2
    while (end < lines.length) {
      const line = lines[end]
      if (line.trim() === '') break
      if (!isTableLine(line)) break
      rows.push(splitRow(line))
      end += 1
    }
    return {
      header,
      aligns,
      rows,
      prefix: lines.slice(0, start).join('\n'),
      suffix: lines.slice(end).join('\n'),
    }
  }
  return null
}

exports.isSeparatorLine = isSeparatorLine
exports.isTableLine = isTableLine
exports.splitRow = splitRow
exports.parseAlign = parseAlign
exports.parseTable = parseTable


    // ── 行内渲染：单元格内的 code / strong / em / link ─────────────
    // ── 行内渲染：单元格内的 code / strong / em / link / del / img ──
// 与 dsh-think-zh-expand 的 mdInline 同规则（CommonMark 语义）：
// N 个反引号开闭配对、**bold**、[link](url)、*em*；issue #81 增补
// **删除线** ~~text~~ 与 **图片** ![alt](url)（图片须先于链接）。返回
// DocumentFragment（无匹配时含单个文本节点）。零运行时依赖。
// 各分支拆为小函数（domXxx），控制 renderInline 圈复杂度 ≤ 10。
function domCode(m) {
  const el = document.createElement('code')
  el.textContent = m[2]
  return el
}

function domStrong(m) {
  const el = document.createElement('strong')
  el.textContent = m[3].slice(2, -2)
  return el
}

function domImg(m) {
  const img = document.createElement('img')
  img.src = m[5]
  img.alt = m[4] || 'image'
  img.className = 'dsh-md-render-img'
  img.setAttribute('loading', 'lazy')
  return img
}

function domLink(m) {
  const lm = m[6].match(/^\[([^\]]+)\]\(([^)]+)\)$/)
  if (!lm) return m[6]
  const a = document.createElement('a')
  a.href = lm[2]
  a.target = '_blank'
  a.rel = 'noreferrer'
  a.textContent = lm[1]
  return a
}

function domDel(m) {
  const el = document.createElement('del')
  el.className = 'dsh-md-render-del'
  el.textContent = m[7]
  return el
}

function domEm(m) {
  const el = document.createElement('em')
  el.textContent = m[8].slice(1, -1)
  return el
}

function inlineDomMatch(m) {
  if (m[1] !== undefined) return domCode(m)
  if (m[3] !== undefined) return domStrong(m)
  // issue #84：image 关闭 → 单元格内图片语法保持原文。
  if (m[4] !== undefined && renderOptions.image) return domImg(m)
  if (m[4] !== undefined) return m[0]
  if (m[6] !== undefined) return domLink(m)
  // issue #84：strikethrough 关闭 → 单元格内删除线保持原文。
  if (m[7] !== undefined && renderOptions.strikethrough) return domDel(m)
  if (m[7] !== undefined) return m[0]
  return domEm(m)
}

function renderInline(text) {
  const frag = document.createDocumentFragment()
  // 行内代码 / 粗体 / 图片 / 链接 / 删除线 / 斜体（图片须先于链接）。
  const re =
    /(`+)([^`\n][^\n]*?)\1(?!`)|(\*\*[^*]+\*\*)|!\[([^\]]*)\]\(([^)]+)\)|(\[[^\]]+\]\([^)]+\))|~~([^~]+)~~|(\*[^*]+\*)/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
    const node = inlineDomMatch(m)
    if (typeof node === 'string') frag.appendChild(document.createTextNode(node))
    else if (node) frag.appendChild(node)
    last = m.index + m[0].length
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
  return frag
}


    // ── DOM 表格渲染：div.dsh-md-render-table-scroll > table.dsh-md-render-table ──
    // ── DOM 表格渲染：div.dsh-md-render-table-scroll > table.dsh-md-render-table ──
// 表头 thead / 数据 tbody / 每列对齐 style；prefix/suffix 文本保留
// 为段落；外层滚动容器提供宽表格横向滚动，容器下方带滚动提示条
// （chevronRight 图标 + 文案，issue #54 阶段 1 视觉统一）。返回
// DocumentFragment。
//
// 交互增强（issue #83）：
//  - 表头排序：th 带 data-sort-col，点击按该列排序（升/降切换，数值列
//    按数值比较、文本列按 localeCompare），箭头 span 显示 ↑/↓；排序
//    只影响当前表格 DOM（状态存 scroll 容器 dataset，不跨表格共享）；
//  - 长表格折叠：行数 > FOLD_LIMIT 时第 FOLD_LIMIT 行起加
//    dsh-md-render-folded-row（CSS display:none 隐藏，行数据保留在 DOM，
//    展开/收起只切换 class），表格下方渲染「展开全部 N 行」按钮；
//  - 事件委托：click 绑定在 scroll 容器上（th 排序 / 折叠按钮切换），
//    排序/折叠状态存 scroll.dataset（sortCol/sortDir/totalRows）。

/** 长表格折叠阈值：行数超过该值默认折叠为前 N 行。 */
const FOLD_LIMIT = 20

/** 单元格比较：两个非空数值字符串按数值比较，否则按 localeCompare。 */
function compareCells(a, b) {
  const sa = String(a ?? '').trim()
  const sb = String(b ?? '').trim()
  const na = Number(sa)
  const nb = Number(sb)
  if (sa !== '' && sb !== '' && Number.isFinite(na) && Number.isFinite(nb)) {
    return na - nb
  }
  return sa.localeCompare(sb)
}

/** 按列排序（返回新数组，不修改原数组；dir: 'asc' | 'desc'）。 */
function sortRows(rows, colIndex, dir) {
  const factor = dir === 'desc' ? -1 : 1
  return rows.slice().sort((r1, r2) => factor * compareCells(r1[colIndex], r2[colIndex]))
}

/** 折叠：行数超过 limit 时返回 { visible: 前 limit 行, hidden: 隐藏数 }。 */
function foldRows(rows, limit) {
  if (rows.length <= limit) return { visible: rows, hidden: 0 }
  return { visible: rows.slice(0, limit), hidden: rows.length - limit }
}

/** 构建 thead（表头行 + 每列对齐 + 排序列标记与箭头 span；issue #84：
 *  tableSort 关闭 → th 不渲染排序列标记与箭头）。 */
function renderHead(table) {
  const thead = document.createElement('thead')
  const headTr = document.createElement('tr')
  table.header.forEach((cell, j) => {
    const th = document.createElement('th')
    th.style.textAlign = table.aligns[j] || 'left'
    th.appendChild(renderInline(cell))
    if (renderOptions.tableSort) {
      th.setAttribute('data-sort-col', String(j))
      const arrow = document.createElement('span')
      arrow.className = 'dsh-md-render-sort-arrow'
      arrow.setAttribute('aria-hidden', 'true')
      th.appendChild(arrow)
    }
    headTr.appendChild(th)
  })
  thead.appendChild(headTr)
  return thead
}

/** 构建 tbody（数据行 + 每列对齐；issue #84：tableFold 关闭 → 不折叠）。 */
function renderBody(table) {
  const tbody = document.createElement('tbody')
  table.rows.forEach((row, i) => {
    const tr = document.createElement('tr')
    if (renderOptions.tableFold && i >= FOLD_LIMIT) tr.className = 'dsh-md-render-folded-row'
    row.forEach((cell, j) => {
      const td = document.createElement('td')
      td.style.textAlign = table.aligns[j] || 'left'
      td.appendChild(renderInline(cell))
      tr.appendChild(td)
    })
    tbody.appendChild(tr)
  })
  return tbody
}

/** 折叠控制按钮（初始「展开全部 N 行」）。 */
function renderFoldButton(total) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'dsh-md-render-table-fold'
  btn.textContent = `展开全部 ${total} 行`
  return btn
}

/** 更新表头排序箭头：当前列显示 ↑/↓ 并带 data-sorted，其余列清空。 */
function updateSortArrows(tbl, col, dir) {
  tbl.querySelectorAll('th').forEach((th, j) => {
    const arrow = th.querySelector('.dsh-md-render-sort-arrow')
    if (!arrow) return
    if (j === col) {
      arrow.textContent = dir === 'asc' ? '↑' : '↓'
      th.setAttribute('data-sorted', dir)
    } else {
      arrow.textContent = ''
      th.removeAttribute('data-sorted')
    }
  })
}

/** 按点击的表头列排序：升/降切换，对 tbody 全部行（含折叠行）排序。 */
function sortTable(scroll, th) {
  const tbl = scroll.querySelector('table.dsh-md-render-table')
  const tbody = tbl.querySelector('tbody')
  if (!tbody) return
  const col = Number(th.getAttribute('data-sort-col'))
  const prevCol = scroll.dataset.sortCol
  const prevDir = scroll.dataset.sortDir
  const dir = prevCol === String(col) ? (prevDir === 'asc' ? 'desc' : 'asc') : 'asc'
  scroll.dataset.sortCol = String(col)
  scroll.dataset.sortDir = dir
  const cellText = (tr) => {
    const tds = tr.querySelectorAll('td')
    return tds[col] ? tds[col].textContent : ''
  }
  const trs = Array.from(tbody.querySelectorAll('tr'))
  trs.sort((a, b) => {
    const c = compareCells(cellText(a), cellText(b))
    return dir === 'desc' ? -c : c
  })
  for (const tr of trs) tbody.appendChild(tr)
  updateSortArrows(tbl, col, dir)
}

/** 折叠/展开切换：只切换行的折叠 class 与按钮文本。 */
function toggleFold(scroll, btn) {
  const tbl = scroll.querySelector('table.dsh-md-render-table')
  const tbody = tbl.querySelector('tbody')
  if (!tbody) return
  const total = Number(scroll.dataset.totalRows) || 0
  const trs = Array.from(tbody.querySelectorAll('tr'))
  const folded = trs.some((tr) => tr.classList.contains('dsh-md-render-folded-row'))
  if (folded) {
    for (const tr of trs) tr.classList.remove('dsh-md-render-folded-row')
    btn.textContent = '收起'
  } else {
    for (let i = FOLD_LIMIT; i < trs.length; i += 1) trs[i].classList.add('dsh-md-render-folded-row')
    btn.textContent = `展开全部 ${total} 行`
  }
}

/** scroll 容器上的 click 事件委托：表头排序 / 折叠按钮切换（issue #84：
 *  tableSort / tableFold 关闭 → 对应交互不生效）。 */
function onTableClick(e) {
  const target = e.target
  if (!target || typeof target.closest !== 'function') return
  const scroll = target.closest('.dsh-md-render-table-scroll')
  if (!scroll) return
  const th = target.closest('th[data-sort-col]')
  if (th && renderOptions.tableSort) {
    sortTable(scroll, th)
    return
  }
  if (renderOptions.tableFold) {
    const btn = target.closest('.dsh-md-render-table-fold')
    if (btn) toggleFold(scroll, btn)
  }
}

/** 共享图标风格的 chevronRight（DOM 侧手写 SVG，stroke=currentColor，
 *  与 dsh-shared/client-parts/icons.part.js 的线性图标风格一致）。 */
function chevronIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  polyline.setAttribute('points', '9 6 15 12 9 18')
  svg.appendChild(polyline)
  return svg
}

/** 滚动提示条：指示宽表格可横向滚动（弱化样式，见 styles.part.js）。 */
function renderScrollHint() {
  const hint = document.createElement('div')
  hint.className = 'dsh-md-render-scroll-hint'
  hint.appendChild(chevronIcon())
  hint.appendChild(document.createTextNode('横向滚动'))
  return hint
}

/** 渲染完整表格（含 prefix/suffix 段落、滚动容器与滚动提示条）。 */
function renderTable(table) {
  const frag = document.createDocumentFragment()
  if (table.prefix) {
    const p = document.createElement('p')
    p.className = 'dsh-md-render-prefix'
    p.textContent = table.prefix
    frag.appendChild(p)
  }
  const scroll = document.createElement('div')
  scroll.className = 'dsh-md-render-table-scroll'
  const tbl = document.createElement('table')
  tbl.className = 'dsh-md-render-table'
  tbl.appendChild(renderHead(table))
  if (table.rows.length > 0) {
    tbl.appendChild(renderBody(table))
    // issue #84：tableFold 关闭 → 不渲染折叠按钮（全部行可见）。
    if (renderOptions.tableFold && table.rows.length > FOLD_LIMIT) {
      scroll.dataset.totalRows = String(table.rows.length)
      scroll.appendChild(renderFoldButton(table.rows.length))
    }
  }
  scroll.appendChild(tbl)
  scroll.addEventListener('click', onTableClick)
  frag.appendChild(scroll)
  frag.appendChild(renderScrollHint())
  if (table.suffix) {
    const p = document.createElement('p')
    p.className = 'dsh-md-render-suffix'
    p.textContent = table.suffix
    frag.appendChild(p)
  }
  return frag
}

// ── 导出（纯函数供单测；renderTable 供渲染断言测试）────────────
exports.compareCells = compareCells
exports.sortRows = sortRows
exports.foldRows = foldRows
exports.renderTable = renderTable


    // ── 扫描器：MutationObserver 跟随流式渲染 ──────────────────────
    // ── 扫描器：MutationObserver 跟随流式渲染 ──────────────────────
// 处理 tzx-md（think-zh-expand 的 MarkdownView 输出）与
// md-table-wide（内置 MarkdownText 的宽表格容器）内的表格段落：
//  - 流式中的容器（祖先带 [data-streaming]）跳过，等流式结束重扫；
//  - 已渲染的表格（容器内已有 table）不重复处理；
//  - 段落被替换为表格后记入 seen，避免重复处理。
function scanContainer(seen, container) {
  if (container.closest && container.closest('[data-streaming]')) return
  const paragraphs = container.querySelectorAll('p.tzx-p')
  for (const p of paragraphs) {
    if (seen.has(p)) continue
    const table = parseTable(p.textContent)
    if (!table) continue
    const frag = renderTable(table)
    p.replaceWith(frag)
    seen.add(p)
  }
}

/** 扫描一个节点：自身是目标容器则处理，否则找其内部的目标容器。 */
function scanNode(seen, node) {
  if (node && typeof node.matches === 'function' && (node.matches('div.tzx-md') || node.matches('div.md-table-wide'))) {
    scanContainer(seen, node)
    return
  }
  if (node && typeof node.querySelectorAll === 'function') {
    for (const c of node.querySelectorAll('div.tzx-md, div.md-table-wide')) {
      scanContainer(seen, c)
    }
  }
}

/** 观察 body；返回观察器 disposer。 */
function installScanner() {
  const seen = new Set()
  scanNode(seen, document.body)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType === 1) scanNode(seen, added)
      }
    }
    // 兜底重扫：流式结束后容器内容变化（新增段落 / 表格文本补全），
    // 对已知滚动容器重扫，保证流式中的表格最终被渲染。
    for (const sc of document.querySelectorAll('[data-conversation-scroll]')) {
      scanNode(seen, sc)
    }
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-streaming'],
  })
  return () => observer.disconnect()
}


    // ── 样式（DSH 语义 token，随 activation 注入）──────────────────
    // ── 样式（DSH 语义 token，随 activation 注入）──────────────────
// 视觉基准：dsh-file-activity（issue #54 阶段 0 UI 规范）——线性图标、
// 语义 token 着色、hover/transition 反馈；适配对话内渲染场景。
// 前缀 dsh-md-render-（issue #54：与 dsh-mermaid-render 前缀分离，
// 消除跨插件类名冲突）；.tzx-md 系列为统一 MarkdownView 的输出样式
// （issue #31 从 dsh-think-zh-expand 迁移，对外契约类名 tzx-* /
// md-code-block 保持不动）。
const STYLES = `
.tzx-md{display:flex;flex-direction:column;gap:8px;min-width:0;font:var(--dsw-font-s-14);line-height:22px;color:var(--dsw-alias-label-primary)}
.tzx-md .tzx-p{margin:0}
.tzx-md h1,.tzx-md h2,.tzx-md h3,.tzx-md h4{margin:0;font-weight:600;line-height:1.35}
.tzx-md ul,.tzx-md ol{margin:0;padding-left:26px}
.tzx-md li{margin:2px 0}
.tzx-md .tzx-pre{margin:0;background:var(--dsh-md-render-code-bg,var(--dsw-alias-markdown-code-block));border:1px solid var(--dsh-md-render-code-border,var(--dsw-alias-border-l1));border-radius:8px;padding:12px 16px 12px 12px;overflow:auto;font:var(--dsw-font-markdown-code-block-small);color:var(--dsh-md-render-code-fg,var(--dsw-alias-label-primary));transition:border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.tzx-md .tzx-pre:hover{border-color:var(--dsw-alias-border-l2)}
.tzx-md code{background:var(--dsw-alias-markdown-code-block);border-radius:4px;padding:0 4px;font:var(--dsw-font-markdown-code-block-small)}
.tzx-md .tzx-pre code{background:none;padding:0}
.tzx-md .tzx-bq{margin:0;padding:2px 0 2px 12px;border-left:3px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.tzx-md .tzx-bq p{margin:0}
.tzx-md .tzx-table{border-collapse:collapse;margin:0;font-size:14px;line-height:22px}
.tzx-md .tzx-table th,.tzx-md .tzx-table td{border:1px solid var(--dsw-alias-border-l1);padding:6px 12px}
.tzx-md .tzx-table th{background:var(--dsw-alias-markdown-code-block);font-weight:600}
.tzx-md .tzx-table tbody tr{transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.tzx-md .tzx-table tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tzx-md a{color:var(--dsw-alias-accent-primary)}
.dsh-md-render-math{font:var(--dsw-font-markdown-code-block-small);font-style:italic;color:var(--dsw-alias-label-primary)}
.dsh-md-render-math-block{margin:0;text-align:center;font:var(--dsw-font-markdown-code-block-small);font-style:italic;color:var(--dsw-alias-label-primary);padding:4px 0}
.dsh-md-render-math-error{display:inline-flex;align-items:center;gap:4px;font:var(--dsw-font-markdown-code-block-small);font-style:italic;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);border-radius:4px;padding:0 4px}
.dsh-md-render-math-error svg{display:block;flex:none}
div.dsh-md-render-math-error{margin:0;text-align:center;justify-content:center;padding:4px 8px}
/* ── 公式结构（issue #82）：分数 / 根号 / 上下标 / 求和积分、希腊字母 ──
   自实现轻量 LaTeX 子集（零依赖）：frac(a,b) 上下结构 + 分数线、
   sqrt(x) 根号符号 + 顶部根号线、x^2 / x_i 上下标、sum / int 符号 +
   上下限；flex 布局走语义 token（currentColor 继承，深浅主题自适应）。
   无法解析的公式命令回退原文（不误伤，见 math.part.js / syntax.part.js）。 */
.dsh-md-render-math,.dsh-md-render-math-block{white-space:normal}
.dsh-md-render-math .dsh-md-render-frac,.dsh-md-render-math .dsh-md-render-sqrt,.dsh-md-render-math .dsh-md-render-supsub,.dsh-md-render-math .dsh-md-render-big,.dsh-md-render-math .dsh-md-render-seq,.dsh-md-render-math-block .dsh-md-render-frac,.dsh-md-render-math-block .dsh-md-render-sqrt,.dsh-md-render-math-block .dsh-md-render-supsub,.dsh-md-render-math-block .dsh-md-render-big,.dsh-md-render-math-block .dsh-md-render-seq{display:inline;font-style:italic;white-space:nowrap}
.dsh-md-render-frac{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;margin:0 2px;line-height:1.25}
.dsh-md-render-frac-num{padding:1px 4px 0}
.dsh-md-render-frac-den{border-top:1px solid currentColor;padding:0 4px 1px}
.dsh-md-render-sqrt{display:inline-flex;align-items:center;vertical-align:middle;margin:0 2px}
.dsh-md-render-sqrt-symbol{font-size:1.2em;line-height:1;padding-right:1px}
.dsh-md-render-sqrt-body{display:inline-flex;flex-direction:column;justify-content:center;border-top:1px solid currentColor;padding:1px 2px 0}
.dsh-md-render-supsub{display:inline-flex;align-items:flex-start;vertical-align:middle;margin:0 1px}
.dsh-md-render-supsub-base{line-height:1.3}
.dsh-md-render-supsub-scripts{display:inline-flex;flex-direction:column;align-items:flex-start;font-size:.7em;line-height:1.05;margin-left:1px}
.dsh-md-render-big{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;margin:0 2px;line-height:1.1}
.dsh-md-render-big-limits{display:flex;flex-direction:column;align-items:center;font-size:.7em;line-height:1.05}
.dsh-md-render-big-symbol{font-size:1.5em;line-height:1}
.dsh-md-render-seq{display:inline}
.dsh-md-render-table-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);transition:border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-table-scroll:hover{border-color:var(--dsw-alias-border-l2)}
.dsh-md-render-table{border-collapse:collapse;width:max-content;max-width:max-content;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.dsh-md-render-table th,.dsh-md-render-table td{padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);max-width:min(30vw,320px);min-width:100px}
.dsh-md-render-table th{text-align:start;font-weight:600;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-markdown-code-block);font:var(--dsw-font-markdown-table-head)}
.dsh-md-render-table td{font:var(--dsw-font-markdown-table)}
.dsh-md-render-table tbody tr{transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-table tbody tr:nth-child(even){background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 40%, transparent)}
.dsh-md-render-table tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-md-render-table code{font-size:13px}
.dsh-md-render-table th{cursor:pointer;user-select:none}
.dsh-md-render-sort-arrow{display:inline-block;margin-left:4px;font-size:12px;line-height:1;color:var(--dsw-alias-label-tertiary);transition:color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-table th[data-sorted] .dsh-md-render-sort-arrow{color:var(--dsw-alias-accent-primary)}
.dsh-md-render-table tr.dsh-md-render-folded-row{display:none}
.dsh-md-render-table-fold{display:block;margin:8px auto 0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);padding:4px 12px;cursor:pointer;transition:border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out),color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-table-fold:hover{border-color:var(--dsw-alias-accent-primary);color:var(--dsw-alias-accent-primary)}
.dsh-md-render-scroll-hint{display:flex;align-items:center;gap:4px;padding:2px 8px;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-scroll-hint svg{display:block;flex:none}
.dsh-md-render-prefix,.dsh-md-render-suffix{margin:0}
/* ── 复制按钮（issue #74）：代码块 / 整段内容一键复制 ──
   整段内容按钮绝对定位右下角；代码块按钮位置可配置（issue #146）：
   bottom-right（默认，与 #74 原始诉求一致）= md-code-block 直接子元素
   绝对定位右下角，header = 头部与语言标签同排（issue #80 布局）。
   hover 才显示（不干扰阅读）；DSH 语义 token 深浅主题自适应；流式渲染
   中（[data-streaming] 祖先）隐藏，避免复制到半截内容。 */
.md-code-block{position:relative}
.tzx-md{position:relative}
.dsh-md-render-copy{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;font:var(--dsw-font-xxxs-11);line-height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;cursor:pointer;opacity:0;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out),color var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-code-head>.dsh-md-render-copy{margin-left:auto}
.md-code-block>.dsh-md-render-copy{position:absolute;right:8px;bottom:8px}
.tzx-md>.dsh-md-render-copy{position:absolute;right:8px;bottom:8px}
.md-code-block:hover .dsh-md-render-copy,.tzx-md:hover>.dsh-md-render-copy{opacity:1}
.dsh-md-render-copy:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dsh-md-render-copy-done{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
[data-streaming] .dsh-md-render-copy{display:none}
/* ── 代码块增强（issue #80）：头部语言标签 + 行号 + 语法高亮 ──
   header 行与复制按钮（#74）同排；行号用 CSS counter 伪元素（不污染
   pre/code 文本内容，mermaid/复制读取原文本不受影响）；token 类走
   固定色板 + prefers-color-scheme 深浅两套，随 activation 注入/卸载。 */
.dsh-md-render-code-head{display:flex;align-items:center;gap:8px;padding:4px 8px;font:var(--dsw-font-xxxs-11);line-height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsh-md-render-code-bg,color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent));border:1px solid var(--dsh-md-render-code-border,var(--dsw-alias-border-l1));border-bottom:none;border-radius:8px 8px 0 0}
.dsh-md-render-code-lang{text-transform:lowercase;letter-spacing:.02em;user-select:none}
.md-code-block .tzx-pre{border-top:none;border-radius:0 0 8px 8px}
.tzx-md .tzx-pre code{display:block;white-space:normal;counter-reset:dsh-md-render-line}
.dsh-md-render-code-line{display:block;white-space:pre;position:relative;padding-left:2.25em;counter-increment:dsh-md-render-line}
.dsh-md-render-code-line::before{content:counter(dsh-md-render-line);position:absolute;left:0;width:1.75em;text-align:right;color:var(--dsw-alias-label-tertiary);user-select:none}
/* ── 代码主题（issue #146）：内置 5 套可配置色板，经 data-theme 选择 ──
   每套定义 5 个 token 色（kw/str/com/num/fn）+ 代码块背景/边框色；
   bright（默认）= 明亮高对比：柔和白底 + 深色 token，解决白底刺眼观感
   （不用高饱和青色系）；github-light / github-dark / one-dark / nord 为
   知名编辑器色板。深浅色自适应保留：每套主题均有 prefers-color-scheme
   暗色变体（github-light 暗色变体 = github-dark 官方色板；github-dark /
   one-dark / nord 本身为暗色主题，两套相同）。仅实际高亮的代码块携带
   data-theme（syntaxHighlight 关闭 / 未知语言 / 超长跳过高亮时无
   data-theme → 保持 DSH 语义 token 默认样式，主题不影响纯文本代码块）。 */
/* 每个主题含自洽前景色 --dsh-md-render-code-fg（init：#146 只改了背景/
   token 色，文字色继承宿主 .tzx-md → 系统暗色 + 宿主浅色时深背景黑字
   不可见）。现在背景与前景色同源于主题，代码块内文字恒可见（修复）。 */
.md-code-block[data-theme]{--dsh-md-render-c-kw:#6d28d9;--dsh-md-render-c-str:#15803d;--dsh-md-render-c-com:#78716c;--dsh-md-render-c-num:#b45309;--dsh-md-render-c-fn:#1d4ed8;--dsh-md-render-code-bg:#fafaf9;--dsh-md-render-code-border:#d6d3d1;--dsh-md-render-code-fg:#1f2328}
.md-code-block[data-theme="github-light"]{--dsh-md-render-c-kw:#cf222e;--dsh-md-render-c-str:#0a3069;--dsh-md-render-c-com:#6e7781;--dsh-md-render-c-num:#0550ae;--dsh-md-render-c-fn:#8250df;--dsh-md-render-code-bg:#ffffff;--dsh-md-render-code-border:#d0d7de;--dsh-md-render-code-fg:#1f2328}
.md-code-block[data-theme="github-dark"]{--dsh-md-render-c-kw:#ff7b72;--dsh-md-render-c-str:#a5d6ff;--dsh-md-render-c-com:#8b949e;--dsh-md-render-c-num:#79c0ff;--dsh-md-render-c-fn:#d2a8ff;--dsh-md-render-code-bg:#0d1117;--dsh-md-render-code-border:#30363d;--dsh-md-render-code-fg:#e6edf3}
.md-code-block[data-theme="one-dark"]{--dsh-md-render-c-kw:#c678dd;--dsh-md-render-c-str:#98c379;--dsh-md-render-c-com:#5c6370;--dsh-md-render-c-num:#d19a66;--dsh-md-render-c-fn:#61afef;--dsh-md-render-code-bg:#282c34;--dsh-md-render-code-border:#3e4451;--dsh-md-render-code-fg:#abb2bf}
.md-code-block[data-theme="nord"]{--dsh-md-render-c-kw:#b48ead;--dsh-md-render-c-str:#a3be8c;--dsh-md-render-c-com:#616e88;--dsh-md-render-c-num:#d08770;--dsh-md-render-c-fn:#81a1c1;--dsh-md-render-code-bg:#2e3440;--dsh-md-render-code-border:#434c5e;--dsh-md-render-code-fg:#d8dee9}
/* 暗色系统：bright / github-light 背景被反转成深色 → 前景色同步变浅
   （保持主题内自洽可见）；github-dark / one-dark / nord 本身深色背景，基础
   规则的前景色已是浅色，无需重复覆盖。 */
@media (prefers-color-scheme:dark){.md-code-block[data-theme]{--dsh-md-render-c-kw:#c4b5fd;--dsh-md-render-c-str:#86efac;--dsh-md-render-c-com:#64748b;--dsh-md-render-c-num:#f87171;--dsh-md-render-c-fn:#93c5fd;--dsh-md-render-code-bg:#1e1f26;--dsh-md-render-code-border:#3a3b45;--dsh-md-render-code-fg:#cbd5e1}.md-code-block[data-theme="github-light"]{--dsh-md-render-c-kw:#ff7b72;--dsh-md-render-c-str:#a5d6ff;--dsh-md-render-c-com:#8b949e;--dsh-md-render-c-num:#79c0ff;--dsh-md-render-c-fn:#d2a8ff;--dsh-md-render-code-bg:#0d1117;--dsh-md-render-code-border:#30363d;--dsh-md-render-code-fg:#c9d1d9}}
.dsh-md-render-tok-keyword{color:var(--dsh-md-render-c-kw)}
.dsh-md-render-tok-string{color:var(--dsh-md-render-c-str)}
.dsh-md-render-tok-comment{color:var(--dsh-md-render-c-com);font-style:italic}
.dsh-md-render-tok-number{color:var(--dsh-md-render-c-num)}
.dsh-md-render-tok-function{color:var(--dsh-md-render-c-fn)}
/* ── 语法补全（issue #81）：任务列表 / 删除线 / 图片 ──
   任务列表：checkbox 与文本同排、状态色走 accent；删除线 <del>
   line-through 弱化次级字色；图片块级自适应、失败占位。 */
.tzx-md del,.dsh-md-render-del{text-decoration:line-through;color:var(--dsw-alias-label-secondary)}
.dsh-md-render-task-checkbox{width:14px;height:14px;margin:0 6px 0 0;vertical-align:-2px;accent-color:var(--dsw-alias-accent-primary);cursor:pointer;flex:none}
.dsh-md-render-img{display:block;max-width:100%;max-height:40vh;margin:4px 0;border-radius:8px;object-fit:contain}
.dsh-md-render-img-fallback{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}
`


    // ── 设置页（issue #84）：渲染增强开关可视化 + 保存 ───────────────
    // ── 设置页视图（issue #84）：各增强功能开关可视化 ──────────────────
// 官方 slots 扩展点：设置 → 插件 → 渲染 页签。开关列表与 server 端
// （lib/index.js buildOptions + lib/routes.js SWITCH_KEYS）一一对应；
// issue #146 起支持选择型配置（复制按钮位置 / 代码主题，server 端
// SELECT_KEYS）——新增「代码块外观」区块，枚举下拉保存同走
// PUT /md/api/config。保存写入 profile patch 文件（持久化），DSH 的
// watchUserPatches 热重载后 client 重新 apply（保存即生效）；保存成功
// 后立即 setRenderOptions 应用新配置（当前页面无需等待重载）。
const SETTINGS_STYLES = `
.dsh-md-render-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-md-render-settings-section{display:flex;flex-direction:column;gap:8px}
.dsh-md-render-settings-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dsh-md-render-settings-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-md-render-settings-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-md-render-settings-label{font:var(--dsw-font-xs-strong-13)}
.dsh-md-render-settings-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dsh-md-render-settings-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-settings-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-md-render-settings-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-settings-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dsh-md-render-settings-select{flex:none;height:28px;min-width:150px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-md-render-settings-select:hover{border-color:var(--dsw-alias-border-l3)}
.dsh-md-render-settings-select:focus{outline:none;border-color:var(--dsw-alias-accent-primary)}
.dsh-md-render-settings-actions{display:flex;align-items:center;gap:8px}
.dsh-md-render-settings-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-md-render-settings-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-md-render-settings-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-settings-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-md-render-settings-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`

/** 开关定义（key 与 server 端 SWITCH_KEYS / config.part.js 一致）。 */
const SETTINGS_SWITCHES = [
  { key: 'copyButton', label: '复制按钮', hint: '代码块与整段内容一键复制（位置/外观见下方配置，issue #74）' },
  { key: 'syntaxHighlight', label: '语法高亮', hint: '代码块关键字/字符串/注释等着色（issue #80）' },
  { key: 'languageLabel', label: '语言标签', hint: '代码块头部显示语言名（issue #80）' },
  { key: 'lineNumbers', label: '行号', hint: '代码块左侧行号（issue #80）' },
  { key: 'taskList', label: '任务列表', hint: '- [ ] / - [x] 渲染为 checkbox（issue #81）' },
  { key: 'strikethrough', label: '删除线', hint: '~~text~~ 渲染为删除线（issue #81）' },
  { key: 'image', label: '图片', hint: '![alt](url) 渲染为图片（issue #81）' },
  { key: 'nestedList', label: '嵌套列表', hint: '按缩进层级嵌套列表（issue #81）' },
  { key: 'mathStructures', label: '公式结构', hint: '行内 $...$ 与块级 $$...$$ 公式渲染（issue #82）' },
  { key: 'tableSort', label: '表头排序', hint: '点击表头按列排序（issue #83）' },
  { key: 'tableFold', label: '长表格折叠', hint: '超过 20 行的表格默认折叠（issue #83）' },
]

/** 代码块复制按钮位置选项（issue #146）：key 与 server 端 SELECT_KEYS 一致。 */
const COPY_POSITION_OPTIONS = [
  { id: 'bottom-right', label: '右下角', hint: '按钮浮在代码块右下角（hover 显示，issue #74 原始诉求）' },
  { id: 'header', label: '头部', hint: '按钮固定在代码块头部、与语言标签同排（issue #80 布局）' },
]

/** 代码主题选项（issue #146）：id 与 server 端 SELECT_KEYS / styles.part.js 色板一致。 */
const CODE_THEME_OPTIONS = [
  { id: 'bright', label: '明亮高对比', hint: '默认主题：柔和白底 + 深色 token，白底清晰不刺眼' },
  { id: 'github-light', label: 'GitHub Light', hint: 'GitHub 官方亮色配色' },
  { id: 'github-dark', label: 'GitHub Dark', hint: 'GitHub 官方暗色配色' },
  { id: 'one-dark', label: 'One Dark', hint: 'Atom One Dark 编辑器配色' },
  { id: 'nord', label: 'Nord', hint: '北极清新配色调（暗色）' },
]

/** 开关行（布尔配置项）。 */
function SettingsSwitchRow({ label, hint, on, onChange }) {
  return createElement(
    'div',
    { className: 'dsh-md-render-settings-row' },
    createElement(
      'div',
      { className: 'dsh-md-render-settings-info' },
      createElement('div', { className: 'dsh-md-render-settings-label' }, label),
      createElement('div', { className: 'dsh-md-render-settings-hint' }, hint),
    ),
    createElement('div', {
      className: 'dsh-md-render-settings-toggle',
      'data-on': String(on),
      role: 'switch',
      'aria-checked': String(on),
      onClick: () => onChange(!on),
    }),
  )
}

/** 开关区块（全部增强项）。 */
function renderSwitchesSection(draft, patch) {
  return createElement(
    'div',
    { className: 'dsh-md-render-settings-section' },
    createElement('div', { className: 'dsh-md-render-settings-section-title' }, '渲染增强'),
    ...SETTINGS_SWITCHES.map((item) =>
      createElement(SettingsSwitchRow, {
        key: item.key,
        label: item.label,
        hint: item.hint,
        on: draft[item.key] === true,
        onChange: (v) => patch(item.key, v),
      }),
    ),
  )
}

/** 选择行（枚举配置项，issue #146：复制按钮位置 / 代码主题）。 */
function SettingsSelectRow({ label, hint, value, options, onChange }) {
  return createElement(
    'div',
    { className: 'dsh-md-render-settings-row' },
    createElement(
      'div',
      { className: 'dsh-md-render-settings-info' },
      createElement('div', { className: 'dsh-md-render-settings-label' }, label),
      createElement('div', { className: 'dsh-md-render-settings-hint' }, hint),
    ),
    createElement(
      'select',
      {
        className: 'dsh-md-render-settings-select',
        value: value,
        onChange: (e) => onChange(e.target.value),
      },
      ...options.map((o) => createElement('option', { key: o.id, value: o.id }, o.label)),
    ),
  )
}

/** 代码块外观区块（issue #146：复制按钮位置 + 代码主题选择）。 */
function renderAppearanceSection(draft, patch) {
  return createElement(
    'div',
    { className: 'dsh-md-render-settings-section' },
    createElement('div', { className: 'dsh-md-render-settings-section-title' }, '代码块外观'),
    createElement(SettingsSelectRow, {
      label: '复制按钮位置',
      hint: COPY_POSITION_OPTIONS.find((o) => o.id === draft.copyButtonPosition)?.hint ?? COPY_POSITION_OPTIONS[0].hint,
      value:
        draft.copyButtonPosition && COPY_POSITION_OPTIONS.some((o) => o.id === draft.copyButtonPosition)
          ? draft.copyButtonPosition
          : COPY_POSITION_OPTIONS[0].id,
      options: COPY_POSITION_OPTIONS,
      onChange: (v) => patch('copyButtonPosition', v),
    }),
    createElement(SettingsSelectRow, {
      label: '代码主题',
      hint: CODE_THEME_OPTIONS.find((o) => o.id === draft.codeTheme)?.hint ?? CODE_THEME_OPTIONS[0].hint,
      value:
        draft.codeTheme && CODE_THEME_OPTIONS.some((o) => o.id === draft.codeTheme)
          ? draft.codeTheme
          : CODE_THEME_OPTIONS[0].id,
      options: CODE_THEME_OPTIONS,
      onChange: (v) => patch('codeTheme', v),
    }),
  )
}

/** 保存配置（PUT /md/api/config），成功/失败更新状态。 */
function saveConfig(draft, setSaved, setErrorKind) {
  setSaved(false)
  setErrorKind('')
  fetch('/md/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('save failed')
      // 立即应用新开关（无需等待 patch 热重载，当前页面生效）。
      setRenderOptions(pickRenderOptions(draft))
      setSaved(true)
    })
    .catch(() => setErrorKind('save'))
}

/** 配置加载失败视图：失败原因（http 状态/网络）+ 针对性提示 + 重试。 */
function LoadErrorView({ errorKind, onRetry }) {
  const hint =
    errorKind === 'http:404'
      ? '服务端插件未加载：/md/api 路由不存在（请确认已安装并启用 dsh-md-render 后重启 DSH）'
      : errorKind === 'http:403'
        ? '请求被安全围栏拒绝（403）：请检查网络/代理设置'
        : '网络错误或响应异常：请检查 DSH 服务是否正常运行'
  return createElement(
    'div',
    { className: 'dsh-md-render-settings' },
    createElement('div', { className: 'dsh-md-render-settings-error' }, '配置加载失败'),
    createElement('div', { className: 'dsh-md-render-settings-status' }, hint),
    createElement(
      'div',
      { className: 'dsh-md-render-settings-actions' },
      createElement('button', { className: 'dsh-md-render-settings-btn', onClick: onRetry }, '重试'),
    ),
  )
}

/** 设置页主视图：加载当前配置 → 开关编辑 → 保存（PUT /md/api/config）。 */
function MdRenderSettingsView() {
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errorKind, setErrorKind] = useState('')
  const [saved, setSaved] = useState(false)

  const load = () => {
    setLoading(true)
    setErrorKind('')
    fetch('/md/api/config')
      .then((res) => {
        if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status })
        return res.json()
      })
      .then((body) => {
        if (body === null || body.ok !== true) throw new Error('bad config response')
        setConfig(body.value)
        setDraft(body.value)
        setLoading(false)
      })
      .catch((err) => {
        setLoading(false)
        setConfig(null)
        // 区分失败原因：404 = /md/api 路由未注册（服务端插件未加载），
        // 403 = 安全围栏拒绝，其余为网络/响应异常。之前只显示笼统的
        // "配置加载失败"，用户无法判断是插件没启用还是临时网络问题。
        setErrorKind(typeof err?.status === 'number' ? 'http:' + err.status : 'network')
      })
  }
  useEffect(() => {
    load()
  }, [])

  if (loading) {
    return createElement(
      'div',
      { className: 'dsh-md-render-settings' },
      createElement('div', { className: 'dsh-md-render-settings-status' }, '加载中…'),
    )
  }
  if (config === null) {
    return createElement(LoadErrorView, { errorKind, onRetry: load })
  }
  const patch = (key, value) => setDraft({ ...draft, [key]: value })
  const save = () => saveConfig(draft, setSaved, setErrorKind)
  return createElement(
    'div',
    { className: 'dsh-md-render-settings' },
    renderSwitchesSection(draft, patch),
    renderAppearanceSection(draft, patch),
    createElement(
      'div',
      { className: 'dsh-md-render-settings-actions' },
      createElement('button', { className: 'dsh-md-render-settings-btn', onClick: save }, '保存'),
      saved ? createElement('span', { className: 'dsh-md-render-settings-saved' }, '已保存') : null,
      errorKind ? createElement('span', { className: 'dsh-md-render-settings-error' }, '保存失败') : null,
    ),
  )
}

/** 设置页 tab 注册（官方 slots 扩展点；服务缺省时静默跳过）。 */
function attachSettingsTab(ctx) {
  // ctx.get 缺省（测试桩/精简上下文）时静默跳过，不影响渲染能力。
  // strict=false：首屏加载时 slots 服务（由 @deepseek-ai/dsh-client-ui-renderer
  // 提供）的提供者 fiber 尚未 active，cordis 的 ctx.get(name, strict = true)
  // 在 strict 模式下会返回 undefined，导致注册代码静默 return（设置页看不到
  // tab，HMR 重载后才出现）；取到实例即可——注册本身由 slots.inject 等待
  // 槽位声明，实际渲染发生在之后，安全。
  const slots = typeof ctx.get === 'function' ? ctx.get('slots', false) : undefined
  if (slots === undefined) return
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-md-render-settings', 'styles')
    style.textContent = SETTINGS_STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode !== null) style.parentNode.removeChild(style)
    }
  }, 'dsh-md-render: settings styles')
  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'md-render-settings',
            order: 90,
            label: () => '渲染',
          },
          MdRenderSettingsView,
        ),
      ),
    'dsh-md-render: settings tab registration',
  )
}


    // ── 插件入口：样式注入 + 扫描器装配 ───────────────────────────
    exports.inject = []

exports.apply = function apply(ctx) {
  // 增强功能开关（issue #84）：默认全开；真实配置异步经 GET /md/api/config
  // 拉取应用（client 端不能访问 ctx.config——Cordis inject 限制，访问抛
  // "cannot get property without inject"，导致 client failed to apply）。
  setRenderOptions(pickRenderOptions())
  initConfigFromServer()

  // Stylesheet first, unconditionally (see dsh-file-activity pitfall:
  // injecting styles behind a service early-return loses them on HMR).
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-md-render', 'styles')
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, 'dsh-md-render: styles')

  ctx.effect(() => installScanner(), 'dsh-md-render: scanner')

  // 设置页 tab（官方 slots 扩展点，issue #84 配置可视化）。
  attachSettingsTab(ctx)
}


    return module.exports
  },
})
