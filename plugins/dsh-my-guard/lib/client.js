/**
 * dsh-my-guard — client half (browser). SOURCE TEMPLATE.
 *
 * 提供侧边栏页签「安全护栏」（dsh-my-guard:guard）：
 *  - 告警列表：破坏性命令 / 投毒扫描 / 提示注入三类告警（类型徽标 +
 *    严重度 + 时间 + 消息 + 详情），每条可「确认」（用户确认机制）；
 *  - 投毒扫描工具：输入包名/本地路径 → 扫描 → 显示发现项；
 *  - 提示注入检测工具：输入文本 → 检测 → 显示命中规则。
 *
 * 面板可见（visible）时轮询（GUARD_POLL_MS），隐藏时暂停（省请求）。
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 *
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs
 * 将片段文件（lib/parts/i18n.js / panel.js / styles.js + 共享
 * dsh-shared/client-parts/icons.part.js，均为无 import/export 的纯函数声明
 * 文本）经下方 __PART_*__ 占位符（函数式 replaceAll，避免 $&/$1 特殊解释）
 * 拼接进 factory 作用域，写出 lib/client.js —— 即 DSH 实际服务的产物。
 * 产物必须提交；CI 只对产物执行 node --check（见 .github/workflows/ci.yml）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-guard',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    // ── parts（scripts/build.mjs 拼接；顺序固定）───────────────────────
    'use strict'
// ── i18n（浏览器语言判定）──────────────────────────────────────────
function isZh() {
  try {
    const lang = (navigator.language || 'en').toLowerCase()
    return lang.startsWith('zh')
  } catch {
    return false
  }
}
const strings = {
  tabTitle: () => (isZh() ? '安全护栏' : 'Guard'),
  alertsTitle: () => (isZh() ? '告警记录' : 'Alerts'),
  scanTitle: () => (isZh() ? '投毒扫描' : 'Poison scan'),
  promptTitle: () => (isZh() ? '提示注入检测' : 'Injection check'),
  emptyAlerts: () =>
    isZh()
      ? '暂无告警——破坏性命令、投毒内容与提示注入命中会出现在这里'
      : 'No alerts yet — destructive commands, poisoned packages and injection hits will appear here',
  emptyAlertsHint: () =>
    isZh()
      ? '执行危险命令、安装可疑包或输入注入文本时，护栏会在这里生成告警'
      : 'Run a dangerous command, install a suspicious package or paste injection text to see alerts here',
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  refresh: () => (isZh() ? '刷新' : 'Refresh'),
  retry: () => (isZh() ? '重试' : 'Retry'),
  scanning: () => (isZh() ? '扫描中…' : 'Scanning…'),
  checking: () => (isZh() ? '检测中…' : 'Checking…'),
  typeDestructive: () => (isZh() ? '破坏性命令' : 'Destructive'),
  typePoison: () => (isZh() ? '投毒扫描' : 'Poison'),
  typeInjection: () => (isZh() ? '提示注入' : 'Injection'),
  sevHigh: () => (isZh() ? '高' : 'high'),
  sevMedium: () => (isZh() ? '中' : 'medium'),
  sevLow: () => (isZh() ? '低' : 'low'),
  confirmed: () => (isZh() ? '已确认' : 'confirmed'),
  confirm: () => (isZh() ? '确认' : 'Confirm'),
  confirmAria: () => (isZh() ? '确认此告警' : 'Confirm this alert'),
  scanPlaceholder: () => (isZh() ? '包名或本地路径，如 dsh-my-guard' : 'package name or path, e.g. dsh-my-guard'),
  scan: () => (isZh() ? '扫描' : 'Scan'),
  scanResult: () => (isZh() ? '扫描结果' : 'Scan result'),
  scanClean: () => (isZh() ? '未发现可疑内容' : 'No suspicious content found'),
  scanError: () => (isZh() ? '扫描失败' : 'Scan failed'),
  findings: (count) => (isZh() ? `${count} 个发现项` : `${count} finding(s)`),
  promptPlaceholder: () => (isZh() ? '输入要检测的文本…' : 'text to check…'),
  check: () => (isZh() ? '检测' : 'Check'),
  checkResult: () => (isZh() ? '检测结果' : 'Result'),
  checkClean: () => (isZh() ? '未命中注入规则' : 'No injection rules hit'),
  checkHits: (count) => (isZh() ? `命中 ${count} 条规则` : `${count} rule(s) hit`),
  file: () => (isZh() ? '文件' : 'file'),
  rule: () => (isZh() ? '规则' : 'rule'),
  // ── 告警可读性（issue #1xx：让用户看懂告警）──────────────────────────
  sessionShort: (id) => (isZh() ? `会话 ${id}` : `session ${id}`),
  hitSnippet: () => (isZh() ? '命中原文' : 'Matched text'),
  falsePositiveHint: () =>
    isZh()
      ? '如为误报：点击「确认」标记为已处理，该告警将弱化显示'
      : 'If this is a false positive, click "Confirm" to mark it as handled (it will be dimmed)',
  noTarget: () => (isZh() ? '请输入包名或路径' : 'Enter a package name or path'),
  noText: () => (isZh() ? '请输入要检测的文本' : 'Enter text to check'),
  modeLabel: () => (isZh() ? '护栏模式' : 'Guard mode'),
  modeObserve: () => (isZh() ? '观察（只告警）' : 'Observe'),
  modeAsk: () => (isZh() ? '确认（审批）' : 'Ask'),
  modeDeny: () => (isZh() ? '拦截' : 'Deny'),
  // ── 自定义护栏规则 + 告警通知（issue #88）───────────────────────────
  rulesTitle: () => (isZh() ? '自定义护栏规则' : 'Custom guard rules'),
  rulesHint: () =>
    isZh()
      ? '添加自定义 bash 危险模式（正则），与内置规则合并生效；命中取最严格模式'
      : 'Add custom bash danger patterns (regex); merged with built-in rules; most-restrictive mode wins',
  addRule: () => (isZh() ? '添加规则' : 'Add rule'),
  saveRules: () => (isZh() ? '保存规则' : 'Save rules'),
  deleteRule: () => (isZh() ? '删除' : 'Delete'),
  deleteRuleAria: () => (isZh() ? '删除此规则' : 'Delete this rule'),
  patternPlaceholder: () => (isZh() ? '正则，如 touch /etc/evil' : 'regex, e.g. touch /etc/evil'),
  descriptionPlaceholder: () => (isZh() ? '描述（可选）' : 'description (optional)'),
  severityLabel: () => (isZh() ? '严重级' : 'Severity'),
  notifyLabel: () => (isZh() ? '告警通知' : 'Alert notification'),
  notifyHint: () => (isZh() ? '高严重级告警经 dsh-my-notify 推送' : 'High-severity alerts pushed via dsh-my-notify'),
  cooldownLabel: () => (isZh() ? '冷却(秒)' : 'Cooldown (s)'),
  saveRulesOk: () => (isZh() ? '规则已保存（已生效）' : 'Rules saved (active)'),
  droppedRule: (count) =>
    isZh()
      ? `已保存 ${count} 条，丢弃 ${count} 条非法规则（正则无效/缺 pattern）`
      : `Saved, ${count} invalid rule(s) dropped`,
  loadRulesError: () => (isZh() ? '规则加载失败' : 'Failed to load rules'),
  noCommand: () => (isZh() ? '请输入命令' : 'Enter a command'),
  ruleTestTitle: () => (isZh() ? '规则测试' : 'Rule test'),
  ruleTestPlaceholder: () => (isZh() ? '输入命令，预览命中哪些规则…' : 'type a command to preview matching rules…'),
  ruleTest: () => (isZh() ? '测试' : 'Test'),
  ruleTestResult: () => (isZh() ? '命中规则' : 'Matching rules'),
  noRuleHit: () => (isZh() ? '未命中任何护栏规则' : 'No guard rule matched'),
  ruleHitSource: (source) => (isZh() ? (source === 'builtin' ? '内置' : '自定义') : source),
  effectiveDecision: () => (isZh() ? '合并决策' : 'Effective'),
  emptyRules: () =>
    isZh() ? '暂无自定义规则——点击「添加规则」创建' : 'No custom rules — click "Add rule" to create one',
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

    'use strict'
// ── 安全护栏面板 ────────────────────────────────────────────────────
const GUARD_POLL_MS = 5000
/** 请求插件 API（非 2xx 抛错；返回响应 JSON 的 value 字段）。 */
function apiJson(path, options) {
  return fetch(path, options).then(async (res) => {
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
    return data.value
  })
}
/** 时间戳 → HH:MM:SS。 */
function timeText(time) {
  try {
    const date = new Date(time)
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  } catch {
    return ''
  }
}
/** 告警类型 → 中文标签。 */
function alertTypeLabel(type) {
  if (type === 'destructive') return strings.typeDestructive()
  if (type === 'poison') return strings.typePoison()
  if (type === 'injection') return strings.typeInjection()
  return type
}
/** 严重度 → 中文标签。 */
function severityLabel(severity) {
  if (severity === 'high') return strings.sevHigh()
  if (severity === 'medium') return strings.sevMedium()
  return strings.sevLow()
}
/** 告警类型 → 视觉类别（类型图标/徽章/颜色共用，语义一致）：
 *  destructive=danger（trash 图标）/ poison=warn（alert 图标）/ injection=info（alert 图标）。 */
function alertKind(alert) {
  if (alert.type === 'destructive') return 'danger'
  if (alert.type === 'poison') return 'warn'
  return 'info'
}
/** 告警类型 → 类型图标（共享线性图标集，stroke=currentColor）。 */
function alertTypeIcon(alert) {
  if (alert.type === 'destructive') return icon.trash(15)
  return icon.alert(15)
}
/** 告警 meta 行：命令/文件/规则 id + 会话短标识。 */
function AlertMeta({ alert }) {
  const detail = alert.detail || {}
  const meta =
    detail.command !== undefined
      ? detail.command
      : detail.file !== undefined
        ? `${strings.file()} ${detail.file}`
        : detail.rule !== undefined
          ? `${strings.rule()} ${detail.rule}${alert.sessionId ? ' · ' + strings.sessionShort(shortSessionId(alert.sessionId)) : ''}`
          : ''
  return meta !== '' ? createElement('div', { className: 'dsh-my-guard-alert-meta' }, meta) : null
}
/** 告警详情行：规则说明 + 命中原文（可读性）。 */
function AlertDetails({ alert }) {
  const detail = alert.detail || {}
  return createElement(
    'div',
    null,
    createElement(AlertMeta, { alert }),
    typeof detail.explain === 'string' && detail.explain !== ''
      ? createElement('div', { className: 'dsh-my-guard-alert-explain' }, detail.explain)
      : null,
    typeof detail.snippet === 'string' && detail.snippet !== ''
      ? createElement('div', { className: 'dsh-my-guard-alert-snippet' }, `${strings.hitSnippet()}：${detail.snippet}`)
      : null,
  )
}
/** 单条告警行：类型图标 + 类型徽章 + 严重度徽章 + 时间 + 消息 + 详情 + 确认操作。
 *  已确认告警弱化显示（已处理=不再打扰），确认按钮带 check 图标与 aria-label。
 *  提示注入告警补：规则说明（explain）+ 命中原文（snippet）+ 会话 id +
 *  「如为误报可确认」提示——之前只显示"规则 <id>"，用户看不懂告警含义。 */
function AlertRow({ alert, onConfirm }) {
  const kind = alertKind(alert)
  return createElement(
    'div',
    { className: `dsh-my-guard-alert${alert.confirmed ? ' dsh-my-guard-alert-confirmed' : ''}` },
    createElement(
      'div',
      { className: 'dsh-my-guard-alert-head' },
      createElement('span', { className: `dsh-my-guard-alert-icon dsh-my-guard-icon-${kind}` }, alertTypeIcon(alert)),
      createElement('span', { className: `dsh-my-guard-badge dsh-my-guard-badge-${kind}` }, alertTypeLabel(alert.type)),
      createElement(
        'span',
        { className: `dsh-my-guard-sev dsh-my-guard-sev-${alert.severity}` },
        severityLabel(alert.severity),
      ),
      createElement('span', { className: 'dsh-my-guard-time' }, timeText(alert.time)),
    ),
    createElement('div', { className: 'dsh-my-guard-alert-msg' }, alert.message),
    createElement(AlertDetails, { alert }),
    alert.confirmed
      ? confirmedBadge()
      : createElement(
          'div',
          { className: 'dsh-my-guard-alert-actions' },
          createElement(
            'div',
            { className: 'dsh-my-guard-alert-hint' },
            alert.type === 'injection' ? strings.falsePositiveHint() : '',
          ),
          createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-my-guard-btn dsh-my-guard-btn-confirm',
              'aria-label': strings.confirmAria(),
              title: strings.confirm(),
              onClick: () => onConfirm(alert.id),
            },
            icon.check(14),
            createElement('span', null, strings.confirm()),
          ),
        ),
  )
}
/** 会话 id 短显示（UUID 取前 8 位）。 */
function shortSessionId(sessionId) {
  return typeof sessionId === 'string' && sessionId.length > 8 ? sessionId.slice(0, 8) + '…' : sessionId || ''
}
/** 拉取告警列表。 */
async function loadAlerts(setters) {
  try {
    setters.setAlerts(await apiJson('/guard/api/alerts?limit=200'))
    setters.setError('')
  } catch (err) {
    setters.setError(err instanceof Error ? err.message : String(err))
  } finally {
    setters.setLoading(false)
  }
}
/** 确认告警（用户确认机制）；成功后行内反馈「已确认」，失败静默（轮询恢复真实状态）。 */
async function confirmAlert(id, setAlerts) {
  try {
    await apiJson('/guard/api/alerts/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, confirmed: true } : a)))
  } catch {
    // 确认失败静默（下次轮询恢复真实状态）
  }
}
/** 扫描结果展示（发现项列表；无发现 = 绿色 check 反馈）。 */
function ScanResult({ result }) {
  const findings = result?.findings || []
  if (findings.length === 0) return cleanFeedback(strings.scanClean())
  return createElement(
    'div',
    { className: 'dsh-my-guard-feedback' },
    createElement('div', { className: 'dsh-my-guard-feedback-head' }, `${strings.findings(findings.length)}：`),
    findings.map((f, index) => issueRow(f, index, `${f.file} · ${f.pattern}`)),
  )
}
/** 执行投毒扫描（target 校验 + 请求 + 状态管理）。 */
async function runScan(target, setters) {
  const value = target.trim()
  if (value === '') {
    setters.setError(strings.noTarget())
    return
  }
  setters.setBusy(true)
  setters.setError('')
  try {
    setters.setResult(
      await apiJson('/guard/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: value }),
      }),
    )
  } catch (err) {
    setters.setError(err instanceof Error ? err.message : String(err))
    setters.setResult(null)
  } finally {
    setters.setBusy(false)
  }
}
/** 投毒扫描工具：输入框 + search 图标按钮 → 扫描 → 显示发现项（busy 禁用 + 扫描中状态）。 */
function ScanTool() {
  const [target, setTarget] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = () => runScan(target, { setResult, setBusy, setError })
  return createElement(
    'div',
    { className: 'dsh-my-guard-section' },
    createElement('div', { className: 'dsh-my-guard-section-title' }, strings.scanTitle()),
    createElement(
      'div',
      { className: 'dsh-my-guard-tool-row' },
      createElement('input', {
        className: 'dsh-my-guard-input dsh-my-guard-tool-input',
        value: target,
        placeholder: strings.scanPlaceholder(),
        disabled: busy,
        onChange: (e) => setTarget(e.target.value),
        onKeyDown: (e) => {
          if (e.key === 'Enter') void run()
        },
      }),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-guard-btn dsh-my-guard-btn-primary',
          disabled: busy,
          onClick: () => void run(),
        },
        icon.search(14),
        createElement('span', null, strings.scan()),
      ),
    ),
    busy ? busyState(strings.scanning()) : null,
    error !== '' ? errorFeedback(`${strings.scanError()}：${error}`) : null,
    result !== null ? createElement(ScanResult, { result }) : null,
  )
}
/** 注入检测结果展示（命中规则列表；无命中 = 绿色 check 反馈）。 */
function PromptResult({ hits }) {
  if (hits.length === 0) return cleanFeedback(strings.checkClean())
  return createElement(
    'div',
    { className: 'dsh-my-guard-feedback' },
    createElement('div', { className: 'dsh-my-guard-feedback-head' }, `${strings.checkHits(hits.length)}：`),
    hits.map((h, index) => issueRow(h, index, h.id)),
  )
}
/** 提示注入检测工具：textarea + check 图标按钮 → 检测 → 显示命中规则（busy 禁用 + 检测中状态）。 */
function PromptTool() {
  const [text, setText] = useState('')
  const [hits, setHits] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async () => {
    const value = text.trim()
    if (value === '') {
      setError(strings.noText())
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await apiJson('/guard/api/scan-prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: value }),
      })
      setHits(result.hits)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setHits(null)
    } finally {
      setBusy(false)
    }
  }
  return createElement(
    'div',
    { className: 'dsh-my-guard-section' },
    createElement('div', { className: 'dsh-my-guard-section-title' }, strings.promptTitle()),
    createElement('textarea', {
      className: 'dsh-my-guard-input dsh-my-guard-textarea',
      value: text,
      placeholder: strings.promptPlaceholder(),
      disabled: busy,
      onChange: (e) => setText(e.target.value),
    }),
    createElement(
      'div',
      { className: 'dsh-my-guard-tool-row' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-guard-btn dsh-my-guard-btn-primary',
          disabled: busy,
          onClick: () => void run(),
        },
        icon.check(14),
        createElement('span', null, strings.check()),
      ),
    ),
    busy ? busyState(strings.checking()) : null,
    error !== '' ? errorFeedback(`${strings.loadError()}：${error}`) : null,
    hits !== null ? createElement(PromptResult, { hits }) : null,
  )
}
/** 安全护栏主面板：告警列表（标题 + 刷新）+ 扫描工具 + 注入检测工具（可见时轮询）。 */
function GuardPanel(props) {
  const visible = props.visible !== false
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    const setters = { setAlerts, setError, setLoading }
    const tick = () => {
      if (alive) void loadAlerts(setters)
    }
    tick()
    const timer = setInterval(tick, GUARD_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [visible, reloadTick])
  const retry = () => {
    setError('')
    setLoading(true)
    setReloadTick((tick) => tick + 1)
  }
  const rows = alerts.map((alert) =>
    createElement(AlertRow, {
      key: alert.id,
      alert,
      onConfirm: (id) => void confirmAlert(id, setAlerts),
    }),
  )
  return createElement(
    'div',
    { className: 'dsh-my-guard-panel' },
    createElement(
      'div',
      { className: 'dsh-my-guard-section-head' },
      createElement('span', { className: 'dsh-my-guard-section-title' }, strings.alertsTitle()),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-guard-iconbtn',
          'aria-label': strings.refresh(),
          title: strings.refresh(),
          onClick: retry,
        },
        icon.refresh(15),
      ),
    ),
    error !== '' ? createElement(ErrorState, { message: error, onRetry: retry }) : null,
    loading && error === '' ? createElement(LoadingState, null) : null,
    !loading && error === '' && alerts.length === 0 ? createElement(EmptyState, null) : null,
    createElement('div', { className: 'dsh-my-guard-timeline' }, rows),
    createElement(ScanTool, null),
    createElement(PromptTool, null),
    createElement(RuleTest, null),
    createElement(RuleSettings, null),
  )
}

    'use strict'
// ── 状态与反馈展示（loading / 空 / 错误 / 操作反馈）────────────────
/** busy 状态行（旋转刷新图标 + 次级色文案）。 */
function busyState(text) {
  return createElement('div', { className: 'dsh-my-guard-state' }, icon.refresh(14), createElement('span', null, text))
}
/** 错误反馈行（错误色文案）。 */
function errorFeedback(text) {
  return createElement('div', { className: 'dsh-my-guard-feedback dsh-my-guard-feedback-error' }, text)
}
/** 干净结果反馈行（绿色 check + 文案）。 */
function cleanFeedback(text) {
  return createElement(
    'div',
    { className: 'dsh-my-guard-feedback dsh-my-guard-feedback-ok' },
    icon.check(14),
    createElement('span', null, text),
  )
}
/** 已确认反馈（绿色 check + 文案）。 */
function confirmedBadge() {
  return createElement(
    'div',
    { className: 'dsh-my-guard-alert-confirmed' },
    icon.check(13),
    createElement('span', null, strings.confirmed()),
  )
}
/** 发现项行（严重度徽章 + 消息 + 规则）。 */
function issueRow(issue, index, rule) {
  return createElement(
    'div',
    { key: index, className: `dsh-my-guard-issue dsh-my-guard-issue-${issue.severity}` },
    createElement('div', { className: 'dsh-my-guard-issue-sev' }, severityLabel(issue.severity)),
    createElement('div', { className: 'dsh-my-guard-issue-msg' }, issue.message),
    createElement('div', { className: 'dsh-my-guard-issue-rule' }, rule),
  )
}
/** 加载中状态（旋转刷新图标 + 次级色文案，不阻塞布局）。 */
function LoadingState() {
  return busyState(strings.loading())
}
/** 空状态（图标 + 主文案 + hint 两行结构）。 */
function EmptyState() {
  return createElement(
    'div',
    { className: 'dsh-my-guard-empty' },
    createElement('span', { className: 'dsh-my-guard-empty-icon' }, icon.check(20)),
    createElement('span', null, strings.emptyAlerts()),
    createElement('span', { className: 'dsh-my-guard-empty-hint' }, strings.emptyAlertsHint()),
  )
}
/** 错误状态（错误色文案 + 重试按钮）。 */
function ErrorState({ message, onRetry }) {
  return createElement(
    'div',
    { className: 'dsh-my-guard-error' },
    createElement('span', { className: 'dsh-my-guard-error-text' }, `${strings.loadError()}：${message}`),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-guard-iconbtn',
        'aria-label': strings.retry(),
        title: strings.retry(),
        onClick: onRetry,
      },
      icon.refresh(15),
    ),
  )
}

    'use strict'
// ── 自定义护栏规则 + 告警通知（issue #88）─────────────────────────
// 依赖：strings（i18n）、icon（共享图标）、apiJson/severityLabel（panel.js）、
// busyState/cleanFeedback/errorFeedback（states.js）；本片段在 STATES 之后拼接。
/** 模式 → 中文标签。 */
function modeLabel(mode) {
  if (mode === 'ask') return strings.modeAsk()
  if (mode === 'deny') return strings.modeDeny()
  return strings.modeObserve()
}
/** 规则来源 → 中文标签。 */
function ruleSourceLabel(source) {
  return strings.ruleHitSource(source)
}
/** 单条自定义规则行（pattern + mode + severity + description + 删除）。 */
function RuleEntry({ rule, index, onChange, onRemove }) {
  const update = (patch) => onChange(index, patch)
  return createElement(
    'div',
    { className: 'dsh-my-guard-rule-row' },
    createElement('input', {
      className: 'dsh-my-guard-input dsh-my-guard-rule-pattern',
      value: rule.pattern || '',
      placeholder: strings.patternPlaceholder(),
      onChange: (e) => update({ pattern: e.target.value }),
    }),
    createElement(
      'select',
      {
        className: 'dsh-my-guard-input dsh-my-guard-rule-select',
        value: rule.mode,
        'aria-label': strings.modeLabel(),
        onChange: (e) => update({ mode: e.target.value }),
      },
      createElement('option', { value: 'observe' }, strings.modeObserve()),
      createElement('option', { value: 'ask' }, strings.modeAsk()),
      createElement('option', { value: 'deny' }, strings.modeDeny()),
    ),
    createElement(
      'select',
      {
        className: 'dsh-my-guard-input dsh-my-guard-rule-select',
        value: rule.severity,
        'aria-label': strings.severityLabel(),
        onChange: (e) => update({ severity: e.target.value }),
      },
      createElement('option', { value: 'low' }, strings.sevLow()),
      createElement('option', { value: 'medium' }, strings.sevMedium()),
      createElement('option', { value: 'high' }, strings.sevHigh()),
    ),
    createElement('input', {
      className: 'dsh-my-guard-input dsh-my-guard-rule-desc',
      value: rule.description || '',
      placeholder: strings.descriptionPlaceholder(),
      onChange: (e) => update({ description: e.target.value }),
    }),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-guard-iconbtn',
        'aria-label': strings.deleteRuleAria(),
        title: strings.deleteRule(),
        onClick: () => onRemove(index),
      },
      icon.trash(14),
    ),
  )
}
/** 规则测试结果：命中列表（来源/模式/严重级）+ 合并决策。 */
function RuleTestResult({ result }) {
  const hits = result?.hits || []
  const decision = result?.decision
  return createElement(
    'div',
    { className: 'dsh-my-guard-feedback' },
    hits.length === 0
      ? cleanFeedback(strings.noRuleHit())
      : createElement(
          'div',
          { className: 'dsh-my-guard-feedback' },
          createElement('div', { className: 'dsh-my-guard-feedback-head' }, `${strings.ruleTestResult()}：`),
          hits.map((h, index) =>
            createElement(
              'div',
              { key: index, className: `dsh-my-guard-issue dsh-my-guard-issue-${h.severity}` },
              createElement('div', { className: 'dsh-my-guard-issue-sev' }, severityLabel(h.severity)),
              createElement('div', { className: 'dsh-my-guard-issue-msg' }, `${modeLabel(h.mode)} · ${h.message}`),
              createElement('div', { className: 'dsh-my-guard-issue-rule' }, `${ruleSourceLabel(h.source)} · ${h.id}`),
            ),
          ),
          decision
            ? createElement(
                'div',
                { className: 'dsh-my-guard-issue-rule dsh-my-guard-effective' },
                `${strings.effectiveDecision()}: ${modeLabel(decision.mode)} / ${severityLabel(decision.severity)}`,
              )
            : null,
        ),
  )
}
/** 规则测试：输入命令 → 实时预览命中规则 + 合并决策。 */
function RuleTest() {
  const [command, setCommand] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async () => {
    const value = command.trim()
    if (value === '') {
      setError(strings.noCommand())
      return
    }
    setBusy(true)
    setError('')
    try {
      setResult(
        await apiJson('/guard/api/rules/test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command: value }),
        }),
      )
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setResult(null)
    } finally {
      setBusy(false)
    }
  }
  return createElement(
    'div',
    { className: 'dsh-my-guard-section' },
    createElement('div', { className: 'dsh-my-guard-section-title' }, strings.ruleTestTitle()),
    createElement(
      'div',
      { className: 'dsh-my-guard-tool-row' },
      createElement('input', {
        className: 'dsh-my-guard-input dsh-my-guard-tool-input',
        value: command,
        placeholder: strings.ruleTestPlaceholder(),
        disabled: busy,
        onChange: (e) => setCommand(e.target.value),
        onKeyDown: (e) => {
          if (e.key === 'Enter') void run()
        },
      }),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-guard-btn dsh-my-guard-btn-primary',
          disabled: busy,
          onClick: () => void run(),
        },
        icon.search(14),
        createElement('span', null, strings.ruleTest()),
      ),
    ),
    busy ? busyState(strings.checking()) : null,
    error !== '' ? errorFeedback(`${strings.loadError()}：${error}`) : null,
    result !== null ? createElement(RuleTestResult, { result }) : null,
  )
}
/** 自定义护栏规则设置：列表编辑 + 保存（持久化 profile patch）+ 通知开关。 */
function RuleSettings() {
  const [customRules, setCustomRules] = useState([])
  const [notifyEnabled, setNotifyEnabled] = useState(false)
  const [notifyCooldownSec, setNotifyCooldownSec] = useState(60)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    void apiJson('/guard/api/rules')
      .then((value) => {
        if (!alive) return
        setCustomRules(value.custom || [])
        setNotifyEnabled(value.notifyEnabled === true)
        if (typeof value.notifyCooldownMs === 'number') setNotifyCooldownSec(Math.round(value.notifyCooldownMs / 1000))
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [])
  const changeRule = (index, patch) =>
    setCustomRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  const addRule = () =>
    setCustomRules((prev) => [...prev, { pattern: '', mode: 'observe', severity: 'medium', description: '' }])
  const removeRule = (index) => setCustomRules((prev) => prev.filter((_, i) => i !== index))
  const save = async () => {
    setBusy(true)
    setFeedback('')
    setError('')
    try {
      const result = await apiJson('/guard/api/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customRules, notifyEnabled, notifyCooldownMs: notifyCooldownSec * 1000 }),
      })
      setCustomRules(result.customRules || [])
      setNotifyEnabled(result.notifyEnabled === true)
      if (typeof result.notifyCooldownMs === 'number') setNotifyCooldownSec(Math.round(result.notifyCooldownMs / 1000))
      setFeedback(result.dropped > 0 ? strings.droppedRule(result.dropped) : strings.saveRulesOk())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return ruleSettingsView({
    customRules,
    notifyEnabled,
    notifyCooldownSec,
    busy,
    feedback,
    error,
    changeRule,
    addRule,
    removeRule,
    save,
    setNotifyEnabled,
    setNotifyCooldownSec,
  })
}
function ruleSettingsView(view) {
  return createElement(
    'div',
    { className: 'dsh-my-guard-section dsh-my-guard-rules-section' },
    createElement('div', { className: 'dsh-my-guard-section-title' }, strings.rulesTitle()),
    createElement('div', { className: 'dsh-my-guard-rules-hint' }, strings.rulesHint()),
    view.customRules.length === 0
      ? createElement('div', { className: 'dsh-my-guard-empty-rules' }, strings.emptyRules())
      : createElement(
          'div',
          { className: 'dsh-my-guard-rule-list' },
          view.customRules.map((rule, index) =>
            createElement(RuleEntry, { key: index, rule, index, onChange: view.changeRule, onRemove: view.removeRule }),
          ),
        ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-guard-btn', onClick: view.addRule },
      createElement('span', null, strings.addRule()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-guard-notify-row' },
      createElement(
        'label',
        { className: 'dsh-my-guard-check' },
        createElement('input', {
          type: 'checkbox',
          checked: view.notifyEnabled,
          onChange: (e) => view.setNotifyEnabled(e.target.checked),
        }),
        createElement('span', null, strings.notifyLabel()),
      ),
      createElement(
        'label',
        { className: 'dsh-my-guard-cooldown' },
        createElement('span', null, strings.cooldownLabel()),
        createElement('input', {
          className: 'dsh-my-guard-input dsh-my-guard-cooldown-input',
          type: 'number',
          min: '0',
          value: view.notifyCooldownSec,
          onChange: (e) => view.setNotifyCooldownSec(Number(e.target.value) || 0),
        }),
      ),
    ),
    createElement('div', { className: 'dsh-my-guard-notify-hint' }, strings.notifyHint()),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-guard-btn dsh-my-guard-btn-primary',
        disabled: view.busy,
        onClick: () => void view.save(),
      },
      icon.check(14),
      createElement('span', null, strings.saveRules()),
    ),
    view.busy ? busyState(strings.loading()) : null,
    view.error !== '' ? errorFeedback(`${strings.loadRulesError()}：${view.error}`) : null,
    view.feedback !== '' ? cleanFeedback(view.feedback) : null,
  )
}

    'use strict'
// ── 样式（DSH 语义 token，随 activation 注入 / teardown 卸载）──────
// 前缀 dsh-my-guard-（issue #54：与 dsh-my-observability- 前缀分离，消除跨插件类名冲突）。
const STYLES = `
.dsh-my-guard-panel{display:flex;flex-direction:column;gap:10px;padding:2px 6px 8px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
.dsh-my-guard-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 6px 2px}
.dsh-my-guard-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dsh-my-guard-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;
  border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-guard-iconbtn svg{display:block}
.dsh-my-guard-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-my-guard-iconbtn:disabled{opacity:.4;cursor:default}
/* ── 告警时间线：卡片式告警行（类型图标 + 徽章 + 严重度 + 时间 + 消息 + 操作）── */
.dsh-my-guard-timeline{display:flex;flex-direction:column;gap:6px;max-height:calc(100vh - 320px);overflow-y:auto}
.dsh-my-guard-alert{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;
  animation:dsh-my-guard-row-in 150ms var(--ds-ease-in-out);
  transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-guard-alert-confirmed{opacity:.55}
.dsh-my-guard-alert-head{display:flex;align-items:center;gap:6px}
.dsh-my-guard-alert-icon{flex:none;display:flex;align-items:center}
.dsh-my-guard-icon-danger{color:var(--dsw-alias-state-error-primary)}
.dsh-my-guard-icon-warn{color:var(--dsw-alias-state-warn-primary)}
.dsh-my-guard-icon-info{color:var(--dsw-alias-state-info-primary)}
.dsh-my-guard-badge{flex:none;font:var(--dsw-font-xxxs-strong-11);border-radius:4px;padding:1px 6px}
.dsh-my-guard-badge-danger{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
.dsh-my-guard-badge-warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)}
.dsh-my-guard-badge-info{color:var(--dsw-alias-state-info-primary);background:color-mix(in srgb, var(--dsw-alias-state-info-primary) 14%, transparent)}
.dsh-my-guard-sev{flex:none;font:var(--dsw-font-xxxs-strong-11);border-radius:4px;padding:1px 6px}
.dsh-my-guard-sev-high{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}
.dsh-my-guard-sev-medium{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent)}
.dsh-my-guard-sev-low{color:var(--dsw-alias-state-info-primary);background:color-mix(in srgb, var(--dsw-alias-state-info-primary) 10%, transparent)}
.dsh-my-guard-time{flex:none;margin-left:auto;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dsh-my-guard-alert-msg{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);line-height:1.5;margin-top:4px;word-break:break-word}
.dsh-my-guard-alert-meta{font:var(--dsw-font-mono-xxs);font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5;margin-top:2px;word-break:break-all}
.dsh-my-guard-alert-explain{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.5;margin-top:2px;word-break:break-word}
.dsh-my-guard-alert-snippet{font:var(--dsw-font-mono-xxs);font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5;margin-top:2px;word-break:break-all}
.dsh-my-guard-alert-hint{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-dimmed);line-height:1.5;margin-top:2px}
.dsh-my-guard-alert-actions{display:flex;align-items:flex-end;justify-content:space-between;gap:6px;margin-top:4px}
.dsh-my-guard-alert-actions>.dsh-my-guard-alert-hint{flex:1;min-width:0;margin-top:0}
.dsh-my-guard-alert-confirmed{display:flex;align-items:center;gap:4px;font:var(--dsw-font-xxxs-strong-11);color:var(--dsw-alias-state-success-primary);margin-top:4px}
.dsh-my-guard-alert-confirmed svg{display:block;flex:none}
/* ── 按钮（图标 + 文字，hover/active/disabled 过渡）── */
.dsh-my-guard-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 12px;cursor:pointer;flex:none;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-guard-btn svg{display:block;flex:none}
.dsh-my-guard-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-guard-btn:active:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 55%, transparent)}
.dsh-my-guard-btn:disabled{opacity:.4;cursor:default}
.dsh-my-guard-btn-primary{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-interactive-primary);
  background:color-mix(in srgb, var(--dsw-alias-interactive-primary) 16%, transparent)}
.dsh-my-guard-btn-confirm{padding:2px 10px;font:var(--dsw-font-xxxs-strong-11)}
/* ── 状态区：loading / 空 / 错误 ── */
.dsh-my-guard-state{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-guard-state svg{flex:none;animation:dsh-my-guard-spin 1s linear infinite}
.dsh-my-guard-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:16px 8px;text-align:center;
  font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.7}
.dsh-my-guard-empty-icon{display:flex;color:var(--dsw-alias-state-success-primary)}
.dsh-my-guard-empty-hint{display:block;color:var(--dsw-alias-label-dimmed);font:var(--dsw-font-xxxs-11)}
.dsh-my-guard-error{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);
  color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;word-break:break-all;line-height:1.7}
.dsh-my-guard-error-text{flex:1;min-width:0}
@keyframes dsh-my-guard-row-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}
@keyframes dsh-my-guard-spin{to{transform:rotate(360deg)}}
/* ── 工具区块：扫描 / 注入检测 ── */
.dsh-my-guard-section{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}
.dsh-my-guard-tool-row{display:flex;gap:6px;align-items:center}
.dsh-my-guard-input{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;
  transition:border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-guard-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-my-guard-input:focus{outline:none;border-color:var(--dsw-alias-interactive-primary)}
.dsh-my-guard-input:disabled{opacity:.4;cursor:default}
.dsh-my-guard-tool-input{flex:1}
.dsh-my-guard-textarea{min-height:52px;resize:vertical;font:var(--dsw-font-xxs-12)}
.dsh-my-guard-feedback{display:flex;flex-direction:column;gap:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);word-break:break-all;line-height:1.5}
.dsh-my-guard-feedback-ok{flex-direction:row;align-items:center;gap:5px;color:var(--dsw-alias-state-success-primary)}
.dsh-my-guard-feedback-ok svg{display:block;flex:none}
.dsh-my-guard-feedback-error{color:var(--dsw-alias-state-error-primary)}
.dsh-my-guard-feedback-head{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary)}
.dsh-my-guard-issue{display:flex;flex-direction:column;gap:2px;border-radius:6px;padding:6px 8px;font:var(--dsw-font-xxs-12)}
.dsh-my-guard-issue-high{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)}
.dsh-my-guard-issue-medium{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent)}
.dsh-my-guard-issue-low{background:color-mix(in srgb, var(--dsw-alias-state-info-primary) 10%, transparent)}
.dsh-my-guard-issue-sev{font:var(--dsw-font-xxxs-strong-11);text-transform:uppercase}
.dsh-my-guard-issue-high .dsh-my-guard-issue-sev{color:var(--dsw-alias-state-error-primary)}
.dsh-my-guard-issue-medium .dsh-my-guard-issue-sev{color:var(--dsw-alias-state-warn-primary)}
.dsh-my-guard-issue-low .dsh-my-guard-issue-sev{color:var(--dsw-alias-state-info-primary)}
.dsh-my-guard-issue-rule{font:var(--dsw-font-mono-xxs);font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-my-guard-issue-msg{color:var(--dsw-alias-label-primary);line-height:1.5}
/* ── 自定义护栏规则 + 告警通知（issue #88）── */
.dsh-my-guard-rules-section{gap:8px}
.dsh-my-guard-rules-hint{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);line-height:1.6}
.dsh-my-guard-empty-rules{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);padding:4px 2px}
.dsh-my-guard-rule-list{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto}
.dsh-my-guard-rule-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-my-guard-rule-row .dsh-my-guard-input{flex:1;min-width:120px}
.dsh-my-guard-rule-select{flex:0 0 auto;width:86px}
.dsh-my-guard-rule-desc{flex:2}
.dsh-my-guard-notify-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.dsh-my-guard-check{display:inline-flex;align-items:center;gap:6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-my-guard-check input{accent-color:var(--dsw-alias-interactive-primary)}
.dsh-my-guard-cooldown{display:inline-flex;align-items:center;gap:6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}
.dsh-my-guard-cooldown-input{flex:0 0 auto;width:64px}
.dsh-my-guard-notify-hint{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dsh-my-guard-effective{color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxxs-strong-11)}
`
function injectStyles() {
  if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-my-guard', 'styles')
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style)
  }
}


    // ── 插件体：样式注入 + 页签注册 ─────────────────────────────────────
    exports.inject = ['betterSidebar']

    exports.apply = function apply(ctx) {
      ctx.effect(() => injectStyles(), 'dsh-my-guard: styles')
      const service = ctx.betterSidebar
      if (service === undefined) return
      ctx.effect(
        () =>
          service.registerTab({
            id: 'dsh-my-guard:guard',
            title: () => strings.tabTitle(),
            order: 42,
            single: true,
            component: (props) => createElement(GuardPanel, props),
          }),
        'dsh-my-guard: guard tab registration',
      )
    }

    return module.exports
  },
})
