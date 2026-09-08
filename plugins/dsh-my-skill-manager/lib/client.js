/**
 * dsh-my-skill-manager — client half (browser). SOURCE TEMPLATE.
 *
 * A Web Settings "Skill 管理 / Skill Manager" tab (official `slots`
 * extension point — no third-party dependency) showing:
 *  - the skill catalog grouped by 全局 / 项目 scope,
 *  - an enable/disable toggle per skill for the global scope and for the
 *    current project (project config lives in <projectRoot>/.dsh/skills.enabled.json),
 *  - a project-path input to pick which project's config is edited.
 *
 * Data source: GET /my-skill-manager/api/list + PUT /my-skill-manager/api/config
 * (server half). Styling follows the DSH design language: semantic tokens,
 * flat surfaces, hairline borders.
 *
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs splices the
 * `lib/parts/*.part.js` pieces into the PART placeholder markers below
 * (each piece is plain function-declaration text sharing this factory scope;
 * the browser ModuleLoader does not support relative-path require) and writes
 * lib/client.js — the file actually served by DSH, which MUST be committed
 * (CI runs node --check + tests against it, not against this template).
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-skill-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')
    // 官方 UI 组件库（宿主 staticModules 提供，零安装零体积；组件表见
    // docs/开发指南/官方UI组件库.md）：Pill/Button + 官方线性图标。
    const ui = require('@deepseek-ai/dsh-client-ui-primitives')

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
    // ── i18n ──────────────────────────────────────────────────────────────
function isZh() {
  try {
    const lang = (navigator.language || 'en').toLowerCase()
    return lang.startsWith('zh')
  } catch {
    return false
  }
}

const strings = {
  title: () => (isZh() ? 'Skill 管理' : 'Skill Manager'),
  globalSection: () => (isZh() ? '全局' : 'Global'),
  projectSection: () => (isZh() ? '当前项目' : 'Current project'),
  refresh: () => (isZh() ? '刷新' : 'Refresh'),
  enabled: () => (isZh() ? '启用' : 'Enabled'),
  disabled: () => (isZh() ? '已禁用' : 'Disabled'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  empty: () => (isZh() ? '暂无 skill' : 'No skills yet'),
  emptyHint: () =>
    isZh() ? 'skill 目录为空或尚未扫描，点击右上角刷新重新扫描' : 'No skills found yet; click refresh to rescan',
  sourceProject: (source) => (isZh() ? `项目（${source}）` : `project (${source})`),
  sourceGlobal: (source) => (isZh() ? `全局（${source}）` : `global (${source})`),
  notCataloged: () => (isZh() ? '未收录' : 'Not cataloged'),
  notCatalogedHint: () =>
    isZh()
      ? '该 skill 存在于目录但未被官方目录收录（不注入会话）；可能是 filesystem 发现未启用或扫描器跳过'
      : 'This skill exists on disk but is not in the official catalog (not injected); filesystem discovery may be disabled or the scanner skipped it',
  disabledHint: () =>
    isZh()
      ? '禁用的 skill 不再注入本项目/全局会话：模型不可见、不可加载（占位覆盖）'
      : 'A disabled skill is no longer injected into this scope: the model cannot see or load it (placeholder override)',
  projectRoot: () => (isZh() ? '项目根：' : 'Project root: '),
  saved: () => (isZh() ? '已保存' : 'Saved'),
  saveFailed: () => (isZh() ? '保存失败' : 'Save failed'),
  diagnosticsTitle: () => (isZh() ? '扫描诊断' : 'Scan diagnostics'),
  diagBadge: () => (isZh() ? '跳过' : 'Skipped'),
  diagnosticsHint: () =>
    isZh()
      ? '以下条目存在于 skill 目录但未被收录（可能被官方扫描器跳过）：'
      : 'These entries exist in a skill directory but were not cataloged (likely skipped by the scanner):',
  diagReason: (reason) =>
    isZh()
      ? ({
          'broken-symlink': '符号链接无法解析（目标不存在）',
          'missing-skills-md': '目录缺少 SKILL.md',
          'missing-frontmatter': '缺少 YAML frontmatter',
          'missing-name-description': 'frontmatter 缺少 name 或 description',
          'invalid-name': 'skill 名称不符合 kebab-case 规范',
          unparseable: 'frontmatter 解析失败或字段异常（官方扫描器未收录）',
        }[reason] ?? reason)
      : reason,
  // ── usage statistics (issue #91) ──────────────────────────────────────
  usageCount: (n) => (isZh() ? `使用 ${n} 次` : `Used ${n} times`),
  usageNever: () => (isZh() ? '未使用' : 'Never used'),
  usageLast: (t) => (isZh() ? `最近 ${t}` : `Last used ${t}`),
  usageSourceModel: () => (isZh() ? '模型' : 'model'),
  usageSourceUser: () => (isZh() ? '用户' : 'user'),
  sortName: () => (isZh() ? '名称' : 'Name'),
  sortCount: () => (isZh() ? '次数' : 'Uses'),
  sortLastUsed: () => (isZh() ? '最近' : 'Recent'),
  unusedOnly: () => (isZh() ? '未使用' : 'Unused'),
  unusedOnlyHint: () => (isZh() ? '只看未使用的 skill' : 'Show only unused skills'),
  usageHint: () =>
    isZh()
      ? '使用统计记录 skill 被加载/注入的次数与最近时间（模型 skill 工具 / 用户 /name 手势），持久化于 $DSH_HOME/skills.usage.json'
      : 'Usage tracks how often a skill was loaded/injected (model skill tool / user /name gesture), persisted in $DSH_HOME/skills.usage.json',
}

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

    // ── styles (DSH semantic tokens, injected on activate, removed on teardown) ──
// Visual language follows the dsh-file-activity baseline (issue #54): flat
// surfaces, hairline borders, 24px circular icon buttons with hover fills,
// 8px-radius rows with hover fills, badge chips, and a role=switch toggle
// (track + sliding thumb, checked = success accent). All colors ride the
// --dsw-alias-* tokens; motion rides --ds-*.
// issue #69 重设计：标题区（标题+唯一刷新按钮）/ 分段控件 / 状态 chip /
// 折叠诊断条；移除路径输入相关样式。
const STYLES = `
.dsh-my-skill-manager-root { display:flex; flex-direction:column; gap:8px; padding:2px 6px 8px;
  font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); }
/* ── header: title + single refresh action (issue #69) ─────────────────── */
.dsh-my-skill-manager-header { display:flex; align-items:center; gap:8px; min-height:28px; }
.dsh-my-skill-manager-header-title { flex:1; min-width:0; font:var(--dsw-font-m-strong-16); color:var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-header-hint { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); }
/* 刷新按钮由官方 Button 提供视觉（issue #143 试点）；加载时图标旋转。 */
.dsh-my-skill-manager-spin { animation:dsh-my-skill-manager-spin 900ms linear infinite; }
@keyframes dsh-my-skill-manager-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
/* ── view switch: segmented control (全局 | 当前项目) ─────────────────────
   分段按钮由官方 Pill 提供视觉（issue #143 试点）；容器保留。 */
.dsh-my-skill-manager-switchseg { display:inline-flex; gap:2px; padding:2px; border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover); align-self:flex-start; }
.dsh-my-skill-manager-status { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); padding:4px 6px; }
.dsh-my-skill-manager-saved { color:var(--dsw-alias-state-success-primary); }
.dsh-my-skill-manager-error { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-state-error-primary); padding:4px 6px; white-space:pre-wrap; }
.dsh-my-skill-manager-section { display:flex; flex-direction:column; gap:2px; margin-top:4px; }
.dsh-my-skill-manager-section-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:2px 6px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary); text-transform:uppercase; letter-spacing:.04em; }
.dsh-my-skill-manager-section-title { font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary);
  text-transform:uppercase; letter-spacing:.04em; }
/* ── sort + unused filter bar (issue #91) ────────────────────────────────
   排序分段由官方 Pill 提供视觉（issue #143 试点）；「未使用」开启态经
   className 覆写为 warn 语义色（官方 Pill active 为 accent，过滤语义用 warn）。 */
.dsh-my-skill-manager-sortbar { display:inline-flex; align-items:center; gap:2px; }
.dsh-my-skill-manager-unused-on { color:var(--dsw-alias-state-warn-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-skill-manager-hint { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); padding:0 6px 4px; line-height:1.7; }
.dsh-my-skill-manager-empty { display:flex; flex-direction:column; align-items:center; gap:4px; padding:12px 6px;
  font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); line-height:1.7; }
.dsh-my-skill-manager-empty-icon { color:var(--dsw-alias-label-dimmed); }
.dsh-my-skill-manager-empty-hint { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-dimmed); }
.dsh-my-skill-manager-row { display:flex; flex-direction:column; gap:2px; padding:6px 8px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1); background:transparent;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out);
  animation:dsh-my-skill-manager-row-in 150ms var(--ds-ease-in-out); }
.dsh-my-skill-manager-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-skill-manager-row-disabled { opacity:.72; }
.dsh-my-skill-manager-row-head { display:flex; align-items:center; gap:6px; min-width:0; }
.dsh-my-skill-manager-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
/* ── not-cataloged badge (warn chip in the row head) ───────────────────────
   官方 Pill 承载（issue #143 试点）；仅覆写 warn 语义色（官方 Pill 中性底）。 */
.dsh-my-skill-manager-chip-warn { color:var(--dsw-alias-state-warn-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-skill-manager-desc { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-secondary); }
.dsh-my-skill-manager-row-source { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); margin-top:2px; }
.dsh-my-skill-manager-row-meta { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-dimmed); }
/* ── switch (role=switch): track + sliding thumb, checked = enabled ────────
   Off = neutral grey track, on = success accent; both thumb and track
   transition on --ds-transition-duration-slow. */
.dsh-my-skill-manager-switch { flex:none; width:34px; height:20px; padding:0; border:none; background:transparent; cursor:pointer; }
.dsh-my-skill-manager-switch-track { display:block; width:34px; height:20px; border-radius:10px;
  background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 25%, transparent);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-skill-manager-switch-thumb { display:block; width:16px; height:16px; margin:2px; border-radius:50%;
  background:var(--dsw-alias-label-tertiary);
  transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out), background var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-skill-manager-switch-on .dsh-my-skill-manager-switch-track { background:var(--dsw-alias-state-success-primary); }
.dsh-my-skill-manager-switch-on .dsh-my-skill-manager-switch-thumb { transform:translateX(14px); background:var(--dsw-alias-label-primary-foreground); }
.dsh-my-skill-manager-switch:hover:not(:disabled) .dsh-my-skill-manager-switch-track { background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 40%, transparent); }
.dsh-my-skill-manager-switch:hover:not(:disabled).dsh-my-skill-manager-switch-on .dsh-my-skill-manager-switch-track { background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 85%, var(--dsw-alias-label-tertiary)); }
.dsh-my-skill-manager-switch:disabled { opacity:.4; cursor:default; }
/* ── diagnostics: collapsible warn bar (issue #69) ──────────────────────── */
.dsh-my-skill-manager-diag { display:flex; flex-direction:column; gap:2px; margin-top:4px; }
.dsh-my-skill-manager-diag-bar { display:flex; align-items:center; gap:6px; padding:4px 8px; border-radius:8px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, var(--dsw-alias-border-l1));
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); cursor:pointer;
  font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-diag-badge { flex:none; display:inline-flex; align-items:center; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-state-warn-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-skill-manager-diag-title { font:var(--dsw-font-xxs-strong-12); color:var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-diag-count { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-diag-chevron { margin-left:auto; color:var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-diag-body { display:flex; flex-direction:column; gap:2px; padding:2px 0 0 8px; }
.dsh-my-skill-manager-diag-row { display:flex; align-items:center; gap:6px; padding:4px 8px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1); background:transparent;
  animation:dsh-my-skill-manager-row-in 150ms var(--ds-ease-in-out); }
.dsh-my-skill-manager-diag-name { flex:none; font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-diag-reason { flex:none; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-state-warn-primary); }
.dsh-my-skill-manager-diag-path { flex:1; min-width:0; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
@keyframes dsh-my-skill-manager-row-in { from { opacity:0; transform:translateY(1px); } to { opacity:1; transform:none; } }
`.trim()

const STYLE_TAG = 'data-dsh-my-skill-manager'

    // ── api: fetch helpers for the Skill Manager views ─────────────────────
const API_BASE = '/my-skill-manager/api'

/** One GET list payload into { skills, globalDisabled, projectDisabled, cwd, projectRoot, diagnostics, usage }. */
function normalizeList(value) {
  return {
    skills: Array.isArray(value.skills) ? value.skills : [],
    globalDisabled: value.global?.disabled ?? [],
    projectDisabled: Array.isArray(value.project) ? value.project : [],
    cwd: value.cwd ?? '',
    projectRoot: value.projectRoot ?? '',
    diagnostics: value.diagnostics ?? { missing: [] },
    usage: value.usage ?? {},
  }
}

/** GET /my-skill-manager/api/list → normalized value; rejects on bad responses. */
function fetchList(cwd) {
  const query = cwd.trim() === '' ? '' : `?cwd=${encodeURIComponent(cwd.trim())}`
  return fetch(`${API_BASE}/list${query}`)
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('bad list response')
      return normalizeList(body.value)
    })
}

/** Current session id from localStorage ('dsh.sessions.current' → { sessionId }). */
function currentSessionId() {
  try {
    const raw = localStorage.getItem('dsh.sessions.current')
    const parsed = raw === null ? null : JSON.parse(raw)
    return typeof parsed?.sessionId === 'string' ? parsed.sessionId : ''
  } catch {
    return ''
  }
}

/** GET /my-skill-manager/api/session → the session's working directory ('' if none). */
function fetchSessionCwd(sessionId) {
  if (sessionId === '') return Promise.resolve('')
  return fetch(`${API_BASE}/session?sessionId=${encodeURIComponent(sessionId)}`)
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) return ''
      return typeof body.value?.cwd === 'string' ? body.value.cwd : ''
    })
    .catch(() => '')
}

/** GET /my-skill-manager/api/rescan → invalidate + fresh normalized value. */
function rescanCatalog(cwd) {
  const query = cwd.trim() === '' ? '' : `?cwd=${encodeURIComponent(cwd.trim())}`
  return fetch(`${API_BASE}/rescan${query}`)
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('rescan failed')
      return normalizeList(body.value)
    })
}

/** PUT /my-skill-manager/api/config; rejects on bad responses. */
function saveConfig(scope, disabled, cwd) {
  return fetch(`${API_BASE}/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope, disabled, cwd }),
  })
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('save failed')
    })
}

    // ── view: Skill Manager settings tab ───────────────────────────────────
// issue #69 重设计（Minimal Single Column）：标题区（标题+唯一刷新按钮）/
// 视图区（分段控件：全局|当前项目，自动感知会话 cwd）/ 列表区（名称+状态
// chip 为主、描述次之）/ 诊断区（仅异常时出现、可折叠）。无路径输入。
function isProjectSource(source) {
  return typeof source === 'string' && source.startsWith('project-')
}

/** Toggle one name in a disabled list (remove when disabling, add when enabling). */
function flipDisabled(list, name, isDisabled) {
  return isDisabled ? list.filter((n) => n !== name) : [...new Set([...list, name])]
}

/** Data actions bound to the state setters (created once per component). */
function createActions({ setData, setLoading, setError, setSaved }) {
  const applyValue = (value) => {
    setData(value)
    setLoading(false)
  }
  const refreshWith = (fetcher, cwd) => {
    setLoading(true)
    setError(false)
    setSaved(false)
    fetcher(cwd)
      .then(applyValue)
      .catch(() => {
        setLoading(false)
        setError(true)
      })
  }
  const load = (cwd) => refreshWith(fetchList, cwd)
  const rescan = (cwd) => refreshWith(rescanCatalog, cwd)
  const save = (scope, disabled, cwd) => {
    setSaved(false)
    setError(false)
    saveConfig(scope, disabled, cwd)
      .then(() => {
        setSaved(true)
        load(scope === 'project' ? cwd || '' : '')
      })
      .catch(() => setError(true))
  }
  return {
    load,
    rescan,
    toggle: (data, scope, name, isDisabled, cwd) => {
      if (scope === 'project' && cwd === '') return
      const list = scope === 'global' ? data.globalDisabled : data.projectDisabled
      save(scope, flipDisabled(list, name, isDisabled), scope === 'project' ? cwd : '')
    },
  }
}

/** Skill Manager settings tab: header + view switch + skill list + diagnostics. */
function SkillManagerView() {
  const [data, setData] = useState(null)
  const [view, setView] = useState('global')
  const [sessionCwd, setSessionCwd] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [sortBy, setSortBy] = useState('name')
  const [unusedOnly, setUnusedOnly] = useState(false)
  const actions = createActions({ setData, setLoading, setError, setSaved })

  useEffect(() => {
    fetchSessionCwd(currentSessionId()).then((cwd) => {
      setSessionCwd(cwd)
      actions.load('')
    })
  }, [])

  const projectRoot = data === null ? '' : data.projectRoot
  const cwdOf = (scope) => (scope === 'project' ? sessionCwd : '')
  const switchView = (scope) => {
    if (scope === view) return
    setView(scope)
    actions.load(cwdOf(scope))
  }

  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-root' },
    createElement(Header, {
      loading,
      error,
      saved,
      onRefresh: () => actions.rescan(cwdOf(view)),
    }),
    createElement(ViewSwitch, { view, hasProject: sessionCwd !== '', onSwitch: switchView }),
    loading
      ? createElement('div', { className: 'dsh-my-skill-manager-status' }, strings.loading())
      : error
        ? createElement('div', { className: 'dsh-my-skill-manager-error' }, strings.loadError())
        : data === null
          ? null
          : createElement(Sections, {
              data,
              view,
              saved,
              sortBy,
              unusedOnly,
              onSort: setSortBy,
              onToggleUnused: () => setUnusedOnly(!unusedOnly),
              onToggle: (scope, name, isDisabled) => actions.toggle(data, scope, name, isDisabled, cwdOf(scope)),
            }),
  )
}

/** Title row with the single refresh action (official Button, spins while
 *  loading — issue #143 试点）。 */
function Header({ loading, error, saved, onRefresh }) {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-header' },
    createElement('span', { className: 'dsh-my-skill-manager-header-title' }, strings.title()),
    loading ? createElement('div', { className: 'dsh-my-skill-manager-header-hint' }, strings.loading()) : null,
    saved
      ? createElement(
          'div',
          { className: 'dsh-my-skill-manager-header-hint dsh-my-skill-manager-saved' },
          strings.saved(),
        )
      : null,
    createElement(ui.Button, {
      variant: 'ghost',
      size: 'sm',
      'aria-label': strings.refresh(),
      title: strings.refresh(),
      disabled: loading,
      onClick: onRefresh,
      icon: createElement(ui.IconRefreshOutline14, {
        className: loading ? 'dsh-my-skill-manager-spin' : undefined,
      }),
    }),
  )
}

/** Segmented control: 全局 / 当前项目 (project tab only when cwd detected).
 *  官方 Pill 承载（issue #143 试点）：active = 当前视图。 */
function ViewSwitch({ view, hasProject, onSwitch }) {
  const seg = (scope, label) =>
    createElement(
      ui.Pill,
      {
        className: 'dsh-my-skill-manager-seg',
        active: view === scope,
        'aria-pressed': view === scope,
        onClick: () => onSwitch(scope),
      },
      label,
    )
  return createElement('div', { className: 'dsh-my-skill-manager-switchseg' }, [
    seg('global', strings.globalSection()),
    hasProject ? seg('project', strings.projectSection()) : null,
  ])
}

/** The toggle section for the current view + diagnostics (collapsible). */
function Sections({ data, view, onToggle, sortBy, unusedOnly, onSort, onToggleUnused }) {
  const projectMode = view === 'project'
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-sections' },
    createElement(SectionBlock, {
      title: projectMode ? projectTitleOf(data) : strings.globalSection(),
      hint: strings.disabledHint(),
      skills: data.skills,
      disabledNames: projectMode ? data.projectDisabled : data.globalDisabled,
      usage: data.usage,
      sortBy,
      unusedOnly,
      onSort,
      onToggleUnused,
      onToggle: (name, isDisabled) => onToggle(projectMode ? 'project' : 'global', name, isDisabled),
    }),
    createElement(DiagnosticsBlock, { diagnostics: data.diagnostics }),
  )
}

/** Collapsed warn bar when there are skipped entries; expandable row list. */
function DiagnosticsBlock({ diagnostics }) {
  const missing = diagnostics?.missing ?? []
  const [open, setOpen] = useState(false)
  if (missing.length === 0) return null
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-diag' },
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-skill-manager-diag-bar',
        'aria-expanded': open,
        onClick: () => setOpen(!open),
      },
      createElement('span', { className: 'dsh-my-skill-manager-diag-badge' }, strings.diagBadge()),
      createElement('span', { className: 'dsh-my-skill-manager-diag-title' }, strings.diagnosticsTitle()),
      createElement('span', { className: 'dsh-my-skill-manager-diag-count' }, `(${missing.length})`),
      createElement('span', { className: 'dsh-my-skill-manager-diag-chevron' }, open ? '▾' : '▸'),
    ),
    open
      ? createElement(
          'div',
          { className: 'dsh-my-skill-manager-diag-body' },
          missing.map((item) =>
            createElement(
              'div',
              { key: item.path, className: 'dsh-my-skill-manager-diag-row' },
              createElement('span', { className: 'dsh-my-skill-manager-diag-name' }, item.name),
              createElement('span', { className: 'dsh-my-skill-manager-diag-reason' }, strings.diagReason(item.reason)),
              createElement('span', { className: 'dsh-my-skill-manager-diag-path' }, item.path),
            ),
          ),
        )
      : null,
  )
}

function projectTitleOf(data) {
  return data.projectRoot === ''
    ? strings.projectSection()
    : `${strings.projectSection()} · ${strings.projectRoot()}${data.projectRoot}`
}

function SectionBlock({
  title,
  hint,
  skills,
  disabledNames,
  usage,
  sortBy,
  unusedOnly,
  onSort,
  onToggleUnused,
  onToggle,
}) {
  const usageOf = (name) => usage?.[name]
  const visible = unusedOnly ? skills.filter((skill) => (usageOf(skill.name)?.count ?? 0) === 0) : skills
  const rows = sortSkills(visible, sortBy, usageOf).map((skill) =>
    createElement(SkillRow, {
      key: skill.name,
      skill,
      usage: usageOf(skill.name),
      disabled: disabledNames.includes(skill.name),
      onToggle: () => onToggle(skill.name, disabledNames.includes(skill.name)),
    }),
  )
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-section' },
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-section-head' },
      createElement('span', { className: 'dsh-my-skill-manager-section-title' }, title),
      createElement(SortControls, { sortBy, unusedOnly, onSort, onToggleUnused }),
    ),
    rows.length === 0
      ? createElement(
          'div',
          { className: 'dsh-my-skill-manager-empty' },
          createElement('span', { className: 'dsh-my-skill-manager-empty-icon' }, icon.file(16)),
          strings.empty(),
          createElement('span', { className: 'dsh-my-skill-manager-empty-hint' }, strings.emptyHint()),
        )
      : rows,
    createElement('div', { className: 'dsh-my-skill-manager-hint' }, `${hint} ${strings.usageHint()}`),
  )
}

/** 排序 + 未使用过滤控件（issue #91）：名称 / 次数 / 最近 + 只看未使用。
 *  官方 Pill 承载（issue #143 试点）：active = 当前排序/过滤；「未使用」
 *  开启态经 className 覆写为 warn 语义色。 */
function SortControls({ sortBy, unusedOnly, onSort, onToggleUnused }) {
  const seg = (key, label) =>
    createElement(
      ui.Pill,
      {
        className: 'dsh-my-skill-manager-sortseg',
        active: sortBy === key,
        'aria-pressed': sortBy === key,
        onClick: () => onSort(key),
      },
      label,
    )
  return createElement('div', { className: 'dsh-my-skill-manager-sortbar' }, [
    createElement(
      ui.Pill,
      {
        className: `dsh-my-skill-manager-unused${unusedOnly ? ' dsh-my-skill-manager-unused-on' : ''}`,
        active: unusedOnly,
        'aria-pressed': unusedOnly,
        title: strings.unusedOnlyHint(),
        onClick: onToggleUnused,
      },
      strings.unusedOnly(),
    ),
    seg('name', strings.sortName()),
    seg('count', strings.sortCount()),
    seg('lastUsed', strings.sortLastUsed()),
  ])
}

/** 按 sortBy 排序：count/lastUsed 降序（未使用排最后），name 字母序；同值按名称。 */
function sortSkills(skills, sortBy, usageOf) {
  const list = [...skills]
  if (sortBy === 'count') {
    list.sort((a, b) => (usageOf(b.name)?.count ?? 0) - (usageOf(a.name)?.count ?? 0) || a.name.localeCompare(b.name))
  } else if (sortBy === 'lastUsed') {
    list.sort(
      (a, b) => (usageOf(b.name)?.lastUsedAt ?? 0) - (usageOf(a.name)?.lastUsedAt ?? 0) || a.name.localeCompare(b.name),
    )
  } else {
    list.sort((a, b) => a.name.localeCompare(b.name))
  }
  return list
}

/** 时间戳 → "MM-DD HH:mm"（无效时间返回空串）。 */
function formatTime(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Card row: name + meta on the main line, description below —
 *  issue #69 hierarchy + issue #91 usage columns. State is encoded ONLY by
 *  the switch (曾经的"状态 chip + 开关"双编码让状态表达重复且拥挤，已移除)。 */
function SkillRow({ skill, disabled, onToggle, usage }) {
  const usageMeta =
    usage === undefined
      ? strings.usageNever()
      : [
          strings.usageCount(usage.count),
          strings.usageLast(formatTime(usage.lastUsedAt)),
          usage.lastSource === 'model' ? strings.usageSourceModel() : strings.usageSourceUser(),
        ].join(' · ')
  const sourceText = isProjectSource(skill.source)
    ? strings.sourceProject(skill.source)
    : strings.sourceGlobal(skill.source)
  return createElement(
    'div',
    { className: `dsh-my-skill-manager-row${disabled ? ' dsh-my-skill-manager-row-disabled' : ''}` },
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-row-head' },
      createElement('span', { className: 'dsh-my-skill-manager-name', title: skill.name }, skill.name),
      skill.cataloged === false
        ? createElement(
            ui.Pill,
            {
              className: 'dsh-my-skill-manager-chip-warn',
              title: strings.notCatalogedHint(),
            },
            strings.notCataloged(),
          )
        : null,
      createElement(Switch, {
        checked: !disabled,
        label: `${skill.name}: ${disabled ? strings.disabled() : strings.enabled()}`,
        onToggle,
      }),
    ),
    createElement('div', { className: 'dsh-my-skill-manager-desc' }, skill.description),
    createElement('div', { className: 'dsh-my-skill-manager-row-source' }, sourceText),
    createElement('div', { className: 'dsh-my-skill-manager-row-meta' }, usageMeta),
  )
}

/** Visual switch (role=switch): track + sliding thumb, checked = enabled.
 *  Semantics match the previous enable/disable text button exactly: clicking
 *  reports the CURRENT disabled state, and the parent flips the list. */
function Switch({ checked, disabled, label, onToggle }) {
  return createElement(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': label,
      className: `dsh-my-skill-manager-switch${checked ? ' dsh-my-skill-manager-switch-on' : ''}`,
      disabled,
      onClick: onToggle,
    },
    createElement(
      'span',
      { className: 'dsh-my-skill-manager-switch-track' },
      createElement('span', { className: 'dsh-my-skill-manager-switch-thumb' }),
    ),
  )
}

    // ── plugin body ───────────────────────────────────────────────────────
// 零第三方依赖：面板挂在官方 slots 扩展点（设置 → 插件 → Skill 管理），
// 不依赖 dsh-better-sidebar。slots 服务是官方 client 服务，通过
// ctx.get 动态获取——服务缺省时静默跳过（不注册 tab，server 端禁用
// 能力不受影响）。
exports.apply = function apply(ctx) {
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute(STYLE_TAG, 'styles')
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, 'dsh-my-skill-manager: styles')

  // strict=false：首屏加载时 slots 服务（由 @deepseek-ai/dsh-client-ui-renderer
  // 提供）的提供者 fiber 尚未 active，cordis 的 ctx.get(name, strict = true)
  // 在 strict 模式下会返回 undefined，注册代码会静默 return（设置页看不到
  // tab，HMR 重载后才出现）；取到实例即可——注册本身由 slots.inject 等待
  // 槽位声明，实际渲染发生在之后，安全。
  const slots = ctx.get('slots', false)
  if (slots === undefined) return

  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'my-skill-manager',
            order: 90,
            label: () => strings.title(),
          },
          SkillManagerView,
        ),
      ),
    'dsh-my-skill-manager: settings tab registration',
  )
}


    return module.exports
  },
})
