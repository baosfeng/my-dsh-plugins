/**
 * dsh-my-observability — client half (browser). SOURCE TEMPLATE.
 *
 * 提供两个侧边栏页签：
 *  - 轨迹回放（dsh-my-observability:replay）：按时间轴查看 agent 行为
 *    （agent 状态 / 模型流 / 工具调用与结果），支持会话切换与类型过滤，
 *    数据来自 server 端事件审计（/observability/api/events）；
 *  - Git 工具 + 增量 diff 审查（dsh-my-observability:git）：仓库状态与
 *    差异查看、类型化提交（Conventional Commits）、提交前规则引擎 +
 *    可选 AI 审查（/observability/api/git/* 与 /observability/api/review）。
 *
 * 面板可见（visible）时轮询（REPLAY_POLL_MS），隐藏时暂停（省请求）。
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 *
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs
 * 先编译 client TS 片段（src/client/parts/*.ts → lib/.client-build/parts/*.js），
 * 再将这些片段（无 import/export 的纯函数声明文本；图标片段来自 dsh-shared
 * 共享 client-parts，见 docs/UI规范.md；audit-view 片段来自 server 端产物
 * lib/audit-view.js，剥离 export 前缀）经下方 __PART_*__ 占位符（函数式
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

    // ── parts（scripts/build.mjs 拼接；顺序固定）───────────────────────
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
const strings = {
    replayTitle: () => (isZh() ? '轨迹回放' : 'Trajectory'),
    resourceTitle: () => (isZh() ? '资源监控' : 'Resources'),
    resourceLoading: () => (isZh() ? '资源采样中…' : 'Sampling…'),
    resourceFile: () => (isZh() ? '审计文件' : 'Audit file'),
    resourceRate: () => (isZh() ? '写入速率' : 'Write rate'),
    resourceCpu: () => (isZh() ? 'CPU' : 'CPU'),
    resourceMem: () => (isZh() ? '内存' : 'Memory'),
    gitTitle: () => (isZh() ? 'Git 工具' : 'Git Tools'),
    allSessions: () => (isZh() ? '全部会话' : 'All sessions'),
    // ── 会话下拉可读性（issue #1xx：只能看到 UUID）────────────────────────
    eventCount: (n) => (isZh() ? `${n} 事件` : `${n} events`),
    sessionFallback: (shortId) => (isZh() ? `会话 ${shortId}` : `session ${shortId}`),
    filterAll: () => (isZh() ? '全部' : 'All'),
    filterStatus: () => (isZh() ? '状态' : 'Status'),
    filterLlm: () => (isZh() ? '模型流' : 'LLM'),
    filterTools: () => (isZh() ? '工具' : 'Tools'),
    filterPlugin: () => (isZh() ? '插件' : 'Plugins'),
    typePluginEvent: () => (isZh() ? '插件事件' : 'plugin event'),
    detailReason: () => (isZh() ? '原因' : 'reason'),
    emptyEvents: () => (isZh() ? '暂无审计事件' : 'No audit events yet'),
    emptyEventsHint: () => isZh()
        ? '开始一段对话后，agent 的状态、模型流与工具调用会按时间记录在这里'
        : 'Start a conversation — agent status, LLM streams and tool calls are recorded here in time order',
    refresh: () => (isZh() ? '刷新' : 'Refresh'),
    retry: () => (isZh() ? '重试' : 'Retry'),
    loadError: () => (isZh() ? '加载失败' : 'Load failed'),
    typeAgentStatus: () => (isZh() ? 'agent 状态' : 'agent status'),
    typeLlmStream: () => (isZh() ? '模型流' : 'LLM stream'),
    typeToolCall: () => (isZh() ? '工具调用' : 'tool call'),
    typeToolResult: () => (isZh() ? '工具结果' : 'tool result'),
    phaseStart: () => (isZh() ? '开始' : 'start'),
    phaseEnd: () => (isZh() ? '结束' : 'end'),
    phaseError: () => (isZh() ? '错误' : 'error'),
    agentTop: () => (isZh() ? '顶层' : 'top'),
    agentSub: () => (isZh() ? '子代理' : 'subagent'),
    agentUnknown: () => (isZh() ? '未知' : 'unknown'),
    toolOk: () => (isZh() ? '成功' : 'ok'),
    toolFail: () => (isZh() ? '失败' : 'failed'),
    // 审计日志搜索 / 过滤 / 导出 / 统计
    searchPlaceholder: () => (isZh() ? '搜索工具名/参数/错误…' : 'Search tool/args/error…'),
    filterAllResult: () => (isZh() ? '全部结果' : 'All results'),
    filterSuccess: () => (isZh() ? '成功' : 'Ok'),
    filterFail: () => (isZh() ? '失败' : 'Failed'),
    timeStartLabel: () => (isZh() ? '开始' : 'Start'),
    timeEndLabel: () => (isZh() ? '结束' : 'End'),
    clearFilters: () => (isZh() ? '清除' : 'Clear'),
    exportJson: () => (isZh() ? '导出 JSON' : 'Export JSON'),
    exportCsv: () => (isZh() ? '导出 CSV' : 'Export CSV'),
    scopeSession: () => (isZh() ? '当前会话' : 'This session'),
    scopeAll: () => (isZh() ? '全部会话' : 'All sessions'),
    statsTitle: () => (isZh() ? '工具统计' : 'Tool stats'),
    statsTool: () => (isZh() ? '工具' : 'Tool'),
    statsCalls: () => (isZh() ? '调用' : 'Calls'),
    statsFailRate: () => (isZh() ? '失败率' : 'Fail rate'),
    statsEmpty: () => (isZh() ? '暂无工具调用数据' : 'No tool call data'),
    noMatches: () => (isZh() ? '无匹配事件' : 'No matching events'),
    exportFileName: () => (isZh() ? 'dsh-observability-审计导出' : 'dsh-observability-audit-export'),
    // Git 面板
    repoLabel: () => (isZh() ? '仓库路径' : 'Repo path'),
    repoPlaceholder: () => (isZh() ? '如 /path/to/project' : 'e.g. /path/to/project'),
    loadRepo: () => (isZh() ? '加载' : 'Load'),
    branch: () => (isZh() ? '分支' : 'Branch'),
    staged: () => (isZh() ? '已暂存' : 'staged'),
    unstaged: () => (isZh() ? '未暂存' : 'unstaged'),
    clean: () => (isZh() ? '工作区干净' : 'Working tree clean'),
    diffTitle: () => (isZh() ? '差异' : 'Diff'),
    showDiff: () => (isZh() ? '查看差异' : 'Show diff'),
    showStagedDiff: () => (isZh() ? '查看暂存差异' : 'Staged diff'),
    noChanges: () => (isZh() ? '没有变更' : 'No changes'),
    review: () => (isZh() ? '提交前审查' : 'Review'),
    reviewAi: () => (isZh() ? 'AI 审查' : 'AI review'),
    reviewResult: () => (isZh() ? '审查结果' : 'Review result'),
    reviewPass: () => (isZh() ? '未发现问题' : 'No issues found'),
    issues: (count) => (isZh() ? `${count} 个问题` : `${count} issue(s)`),
    commitTitle: () => (isZh() ? '类型化提交' : 'Typed commit'),
    commitType: () => (isZh() ? '类型' : 'Type'),
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
    loading: () => (isZh() ? '加载中…' : 'Loading…'),
    emptyDiff: () => (isZh() ? '（空）' : '(empty)'),
    noRepo: () => (isZh() ? '请输入仓库路径' : 'Enter a repo path'),
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

    /**
 * dsh-my-observability — audit log view helpers (pure functions).
 *
 * 轨迹回放面板的搜索 / 组合过滤 / 导出（JSON/CSV）/ 统计的纯逻辑，无副作用、
 * 不依赖 React 与 cordis（可被 vitest 直接导入单测），仅供 client 端在已加载
 * 的审计事件数据上做视图变换。DSH ModuleLoader 不支持相对路径 require，client
 * 侧经 scripts/build.mjs 把本文件（剥离 `export` 前缀）作为片段拼接进
 * lib/client.js 的 factory 作用域，因此本文件约定：
 *  - 只用 `export function`（单行形式），不用 export 块 / export default；
 *  - 顶层没有 import / 副作用；
 *  - 不读取 strings —— 涉及界面文案的默认值集中在此，client 如需 i18n 覆盖
 *    通过参数传入。
 */
/** 事件类型 → 中文标签（CSV 默认；client 可传 labels 覆盖）。非导出常量。 */
const DEFAULT_CSV_LABELS = Object.freeze({
    time: '时间',
    type: '类型',
    tool: '工具',
    result: '结果',
    typeMap: Object.freeze({
        agent_status: 'agent 状态',
        llm_stream: '模型流',
        tool_call: '工具调用',
        tool_result: '工具结果',
    }),
    ok: '成功',
    fail: '失败',
    error: '错误',
});
const MAX_STATS_TOP = 50;
/** 两位补零。 */
function pad2(n) {
    return String(n).padStart(2, '0');
}
/** 毫秒时间戳 → `YYYY-MM-DD HH:MM:SS`（本地时区）；非法输入返回空串。 */
function formatTime(time) {
    if (typeof time !== 'number' || !Number.isFinite(time))
        return '';
    const d = new Date(time);
    if (Number.isNaN(d.getTime()))
        return '';
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    return `${date} ${clock}`;
}
/** agent 状态事件的搜索片段。 */
function agentStatusParts(data) {
    return [data.status, data.agentType].filter((part) => typeof part === 'string');
}
/** 模型流事件的搜索片段（含错误消息）。 */
function llmParts(data) {
    const parts = [data.phase];
    if (typeof data.message === 'string' && data.message !== '')
        parts.push(data.message);
    return parts;
}
/** 工具调用事件的搜索片段（工具名 + 参数键 + 参数摘要）。 */
function toolCallParts(data) {
    const parts = [];
    if (typeof data.name === 'string')
        parts.push(data.name);
    if (Array.isArray(data.args?.keys))
        parts.push(...data.args.keys);
    if (typeof data.args?.summary === 'string' && data.args.summary !== '')
        parts.push(data.args.summary);
    return parts;
}
/** 工具结果事件的搜索片段（工具名 + 成败）。 */
function toolResultParts(data) {
    const parts = [];
    if (typeof data.name === 'string')
        parts.push(data.name);
    parts.push(data.ok === false ? '失败' : '成功');
    return parts;
}
/** 插件事件（issue #154）的搜索片段（插件名/事件名/动作/原因/参数值）。 */
function pluginEventParts(data) {
    const parts = [];
    if (typeof data.plugin === 'string')
        parts.push(data.plugin);
    if (typeof data.event === 'string')
        parts.push(data.event);
    if (typeof data.action === 'string')
        parts.push(data.action);
    if (typeof data.reason === 'string')
        parts.push(data.reason);
    if (data.params !== null && typeof data.params === 'object') {
        for (const value of Object.values(data.params)) {
            if (typeof value === 'string' && value !== '')
                parts.push(value);
        }
    }
    return parts;
}
/** 事件类型 → 搜索片段收集函数（查表消分支）。 */
const PARTS_COLLECTORS = {
    agent_status: agentStatusParts,
    llm_stream: llmParts,
    tool_call: toolCallParts,
    tool_result: toolResultParts,
    plugin_event: pluginEventParts,
};
/** 提取事件可用于关键词匹配的文本（工具名/参数摘要/错误信息/状态/阶段等）。 */
function searchableText(event) {
    const data = event && event.data ? event.data : {};
    const parts = [event?.type, event?.sessionId];
    const collector = PARTS_COLLECTORS[event?.type];
    if (collector !== undefined)
        parts.push(...collector(data));
    return parts
        .filter((part) => typeof part === 'string')
        .join(' ')
        .toLowerCase();
}
/** 事件是否命中关键词（不区分大小写；空关键词视为命中全部）。 */
function matchesKeyword(event, keyword) {
    const kw = String(keyword ?? '')
        .trim()
        .toLowerCase();
    if (kw === '')
        return true;
    return searchableText(event).includes(kw);
}
/** 返回 `true` 表示事件具备失败语义（工具失败 / 模型流出错）。 */
function isFailEvent(event) {
    if (event?.type === 'tool_result')
        return event.data?.ok === false;
    if (event?.type === 'llm_stream')
        return event.data?.phase === 'error';
    return false;
}
/** 归一化过滤条件（时间转为闭区间数值；空值透传）。 */
function normalizeCriteria(criteria) {
    const start = typeof criteria.timeStart === 'number' && Number.isFinite(criteria.timeStart) ? criteria.timeStart : undefined;
    const end = typeof criteria.timeEnd === 'number' && Number.isFinite(criteria.timeEnd) ? criteria.timeEnd : undefined;
    return { type: criteria.type ?? '', keyword: criteria.keyword ?? '', result: criteria.result ?? '', start, end };
}
/** 类型过滤（'tool' 表示 tool_call + tool_result；'plugin' 表示 plugin_event）。 */
function passType(type, filterType) {
    if (filterType === '')
        return true;
    if (filterType === 'tool')
        return type === 'tool_call' || type === 'tool_result';
    if (filterType === 'plugin')
        return type === 'plugin_event';
    return type === filterType;
}
/** 时间范围闭区间。 */
function passTime(time, start, end) {
    if (start !== undefined && time < start)
        return false;
    if (end !== undefined && time > end)
        return false;
    return true;
}
/** 成功/失败过滤：只作用于有成败语义的事件，其余事件透传。 */
function passResult(event, result) {
    if (result === '')
        return true;
    if (result === 'success')
        return !isFailEvent(event);
    if (result === 'fail')
        return isFailEvent(event);
    return true;
}
/** 组合过滤：类型（tool 表示 tool_call+tool_result）+ 时间范围 + 成功/失败 + 关键词。
 *  criteria: { type, timeStart, timeEnd, result, keyword } */
function applyAuditFilter(events, criteria = {}) {
    const ctx = normalizeCriteria(criteria);
    return (events ?? []).filter((event) => passType(event.type, ctx.type) &&
        passTime(event.time, ctx.start, ctx.end) &&
        passResult(event, ctx.result) &&
        matchesKeyword(event, ctx.keyword));
}
/** CSV 单元格转义：含逗号/引号/换行时用双引号包裹并转义内嵌引号。 */
function csvCell(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** 事件的工具名（仅 tool_call/tool_result；否则空）。 */
function toolNameOf(event) {
    if (event?.type === 'tool_call' || event?.type === 'tool_result')
        return String(event.data?.name ?? '');
    return '';
}
/** 事件的结果摘要（成功/失败/错误；其余空）。 */
function resultTextOf(event, labels = DEFAULT_CSV_LABELS) {
    if (event?.type === 'tool_result')
        return event.data?.ok === false ? labels.fail : labels.ok;
    if (event?.type === 'llm_stream' && event.data?.phase === 'error')
        return labels.error;
    return '';
}
/** 生成 CSV 摘要（表头：时间/类型/工具/结果）。labels 可覆盖默认中文。
 *  返回不含换行结尾符的 CSV 文本。 */
function auditToCsv(events, labels = DEFAULT_CSV_LABELS) {
    const typeMap = labels.typeMap ?? {};
    const header = [labels.time, labels.type, labels.tool, labels.result];
    const lines = [header.map(csvCell).join(',')];
    for (const event of (events ?? [])) {
        const typeLabel = typeMap[event.type] ?? String(event.type);
        const row = [formatTime(event.time), typeLabel, toolNameOf(event), resultTextOf(event, labels)];
        lines.push(row.map(csvCell).join(','));
    }
    return lines.join('\n');
}
/** 生成 JSON 完整数据（缩进默认 2）。 */
function auditToJson(events, space = 2) {
    return JSON.stringify(events ?? [], null, space);
}
/** 事件是否为工具类（tool_call / tool_result）。 */
function isToolEvent(event) {
    return event?.type === 'tool_call' || event?.type === 'tool_result';
}
/** 把单条工具事件计入聚合（调用次数 / 失败次数）。 */
function bumpTool(byTool, event, name) {
    const entry = byTool.get(name) ?? { tool: name, calls: 0, fails: 0 };
    if (event.type === 'tool_call')
        entry.calls += 1;
    if (event.type === 'tool_result' && event.data?.ok === false)
        entry.fails += 1;
    byTool.set(name, entry);
}
/** 按工具名聚合调用次数与失败次数。 */
function aggregateToolStats(events) {
    const byTool = new Map();
    for (const event of (events ?? [])) {
        if (!isToolEvent(event))
            continue;
        const name = String(event.data?.name ?? '');
        if (name === '')
            continue;
        bumpTool(byTool, event, name);
    }
    return byTool;
}
/** 聚合结果 → 排序 + 失败率列表。 */
function rankTools(byTool) {
    return [...byTool.values()]
        .map((entry) => ({ ...entry, failRate: entry.calls > 0 ? entry.fails / entry.calls : 0 }))
        .sort((a, b) => b.calls - a.calls || b.fails - a.fails || a.tool.localeCompare(b.tool));
}
/** 工具调用统计：每个工具调用次数 + 失败率（topN 截断，默认 5）。
 *  返回 [{ tool, calls, fails, failRate }] 按调用次数降序。 */
function computeToolStats(events, topN = 5) {
    const n = typeof topN === 'number' && topN > 0 ? Math.min(topN, MAX_STATS_TOP) : 5;
    return rankTools(aggregateToolStats(events)).slice(0, n);
}
/** 把 text 按 keyword 切成 [ { text, hit } ] 分段（用于命中关键词高亮）。
 *  空关键词返回整段未命中。 */
function highlightSegments(text, keyword) {
    const raw = String(text ?? '');
    const kw = String(keyword ?? '')
        .trim()
        .toLowerCase();
    if (kw === '')
        return [{ text: raw, hit: false }];
    const lower = raw.toLowerCase();
    const out = [];
    let cursor = 0;
    for (;;) {
        const idx = lower.indexOf(kw, cursor);
        if (idx === -1) {
            if (cursor < raw.length)
                out.push({ text: raw.slice(cursor), hit: false });
            break;
        }
        if (idx > cursor)
            out.push({ text: raw.slice(cursor, idx), hit: false });
        out.push({ text: raw.slice(idx, idx + kw.length), hit: true });
        cursor = idx + kw.length;
    }
    return out.length === 0 ? [{ text: raw, hit: false }] : out;
}

    "use strict";
// ── 轨迹回放面板（时间轴）──────────────────────────────────────────
// 拆分的审计视图组件（搜索/组合过滤/导出/统计/高亮/hook）位于
// replay-ext.js 片段（见 client.src.js 占位符顺序）。
/** 请求插件 API（非 2xx 抛错；返回响应 JSON 的 value 字段）。 */
function apiJson(path, options) {
    return fetch(path, options).then(async (res) => {
        const data = await res.json();
        if (!res.ok)
            throw new Error(data.error?.message || `HTTP ${res.status}`);
        return data.value;
    });
}
/** 事件类型 → 中文标签。 */
function typeLabel(event) {
    switch (event.type) {
        case 'agent_status':
            return strings.typeAgentStatus();
        case 'llm_stream':
            return strings.typeLlmStream();
        case 'tool_call':
            return strings.typeToolCall();
        case 'tool_result':
            return strings.typeToolResult();
        case 'plugin_event':
            return strings.typePluginEvent();
        default:
            return event.type;
    }
}
/** 事件类型 → 视觉类别（徽标/图标/节点共用，颜色语义一致）：
 *  status=info / llm=warn / call=accent / result=success / fail=danger /
 *  plugin=info（插件事件复用 info 色，图标区分）。 */
function typeKind(event) {
    if (event.type === 'agent_status')
        return 'status';
    if (event.type === 'llm_stream')
        return 'llm';
    if (event.type === 'tool_call')
        return 'call';
    if (event.type === 'plugin_event')
        return 'plugin';
    return event.data?.ok === false ? 'fail' : 'result';
}
/** 事件类型 → 类型图标（共享线性图标集，stroke=currentColor）。 */
function typeIcon(event) {
    const kind = typeKind(event);
    if (kind === 'status')
        return icon.clock(15);
    if (kind === 'llm')
        return icon.file(15);
    if (kind === 'call')
        return icon.external(15);
    if (kind === 'plugin')
        return icon.alert(15);
    if (kind === 'fail')
        return icon.close(15);
    return icon.check(15);
}
/** 时间戳 → HH:MM:SS。 */
function timeText(time) {
    try {
        const date = new Date(time);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }
    catch {
        return '';
    }
}
/** agent 类型标记 → 中文。 */
function agentTypeText(agentType) {
    if (agentType === 'top')
        return strings.agentTop();
    if (agentType === 'subagent')
        return strings.agentSub();
    return strings.agentUnknown();
}
/** 模型流阶段 → 中文。 */
function phaseText(phase) {
    if (phase === 'start')
        return strings.phaseStart();
    if (phase === 'end')
        return strings.phaseEnd();
    if (phase === 'error')
        return strings.phaseError();
    return phase;
}
/** agent 状态事件摘要。 */
function agentMeta(data) {
    return `状态 ${data.status} · ${agentTypeText(data.agentType)}`;
}
/** 模型流事件摘要（开始/结束/错误 + 统计）。 */
function llmMeta(data) {
    const stats = data.phase === 'start' ? '' : ` · ${data.chunks} chunks / ${data.chars} chars / ${data.ms}ms`;
    const error = data.message !== undefined ? `：${data.message}` : '';
    return `${phaseText(data.phase)}${stats}${error}`;
}
/** 工具调用事件摘要（名称 + 参数摘要）。 */
function toolCallMeta(data) {
    const args = data.args && data.args.summary !== undefined ? ` — ${data.args.summary}` : '';
    return `${data.name}${args}`;
}
/** 工具结果事件摘要（名称 + 成败 + 耗时）。 */
function toolResultMeta(data) {
    const result = data.ok === false ? strings.toolFail() : strings.toolOk();
    return `${data.name} · ${result} · ${data.ms}ms`;
}
/** 插件事件摘要（插件名 · 事件名 · 动作；issue #154）。 */
function pluginEventMeta(data) {
    const action = typeof data.action === 'string' && data.action !== '' ? data.action : data.event;
    return `${data.plugin} · ${data.event} · ${action}`;
}
/** 事件 → 摘要文本（单行，尽力而为）。 */
function eventMeta(event) {
    const data = event.data || {};
    if (event.type === 'agent_status')
        return agentMeta(data);
    if (event.type === 'llm_stream')
        return llmMeta(data);
    if (event.type === 'tool_call')
        return toolCallMeta(data);
    if (event.type === 'tool_result')
        return toolResultMeta(data);
    if (event.type === 'plugin_event')
        return pluginEventMeta(data);
    return '';
}
/** 插件事件详情行（原因 + 参数键值对；非插件事件返回 null 不可展开）。 */
function eventDetail(event) {
    if (event?.type !== 'plugin_event')
        return null;
    const data = event.data || {};
    const rows = [];
    if (typeof data.reason === 'string' && data.reason !== '') {
        rows.push(createElement('div', { key: 'reason', className: 'dsh-my-observability-detail-row' }, createElement('span', { className: 'dsh-my-observability-detail-key' }, strings.detailReason()), createElement('span', { className: 'dsh-my-observability-detail-value' }, data.reason)));
    }
    if (data.params !== null && typeof data.params === 'object') {
        for (const [key, value] of Object.entries(data.params)) {
            rows.push(createElement('div', { key, className: 'dsh-my-observability-detail-row' }, createElement('span', { className: 'dsh-my-observability-detail-key' }, key), createElement('span', { className: 'dsh-my-observability-detail-value' }, String(value))));
        }
    }
    return rows.length > 0 ? rows : null;
}
/** 单条事件行：节点圆点 + 类型图标 + 徽标/时间 + 摘要（hover/active 反馈）。
 *  摘要命中关键词时以 mark 高亮；插件事件可点击展开详情（原因/参数）。 */
function EventRow({ event, keyword }) {
    const meta = eventMeta(event);
    const kind = typeKind(event);
    const detail = eventDetail(event);
    const [open, setOpen] = useState(false);
    return createElement('button', {
        className: 'dsh-my-observability-event',
        type: 'button',
        'aria-expanded': detail !== null ? open : undefined,
        onClick: detail !== null ? () => setOpen(!open) : undefined,
    }, createElement('span', { className: `dsh-my-observability-node dsh-my-observability-node-${kind}` }), createElement('span', { className: `dsh-my-observability-event-icon dsh-my-observability-icon-${kind}` }, typeIcon(event)), createElement('span', { className: 'dsh-my-observability-event-body' }, createElement('span', { className: 'dsh-my-observability-event-head' }, createElement('span', { className: `dsh-my-observability-badge dsh-my-observability-badge-${kind}` }, typeLabel(event)), createElement('span', { className: 'dsh-my-observability-time' }, timeText(event.time))), meta !== ''
        ? createElement('span', { className: 'dsh-my-observability-event-meta' }, createElement(HighlightText, { text: meta, keyword }))
        : null, detail !== null && open ? createElement('div', { className: 'dsh-my-observability-event-detail' }, detail) : null));
}
/** 类型过滤按钮组（aria-pressed 选中态；plugin 过滤插件事件，issue #154）。 */
function TypeFilter({ filter, onFilter }) {
    const options = [
        ['', strings.filterAll()],
        ['agent_status', strings.filterStatus()],
        ['llm_stream', strings.filterLlm()],
        ['tool', strings.filterTools()],
        ['plugin', strings.filterPlugin()],
    ];
    return createElement('div', { className: 'dsh-my-observability-filters' }, options.map(([value, label]) => createElement('button', {
        key: value,
        type: 'button',
        className: `dsh-my-observability-chip${filter === value ? ' dsh-my-observability-chip-active' : ''}`,
        'aria-pressed': filter === value,
        onClick: () => onFilter(value),
    }, label)));
}
/** 拉取会话列表与事件（选中为空时自动选当前/首个会话）。 */
async function loadReplayData(selected, currentSession, setters) {
    try {
        const list = await apiJson('/observability/api/sessions');
        setters.setSessions(list);
        if (selected === '' && list.length > 0) {
            const preferred = list.some((s) => s.sessionId === currentSession) ? currentSession : list[0].sessionId;
            setters.setSelected(preferred);
            return;
        }
        const query = selected !== ''
            ? `/observability/api/events?sessionId=${encodeURIComponent(selected)}&limit=300`
            : '/observability/api/events?limit=0';
        setters.setEvents(await apiJson(query));
        setters.setError('');
    }
    catch (err) {
        setters.setError(err instanceof Error ? err.message : String(err));
    }
    finally {
        setters.setLoading(false);
    }
}
/** 下拉选项文案：可读标题（首条用户消息）优先，无标题回退 UUID 短显；
 *  附加事件数与时间，用户一眼看出"哪个对话"。 */
function sessionOptionLabel(s) {
    const title = typeof s.title === 'string' && s.title !== '' ? s.title : strings.sessionFallback(shortId(s.sessionId));
    return `${title} · ${strings.eventCount(s.count)}`;
}
/** 会话 id 短显示（UUID 取前 8 位）。 */
function shortId(sessionId) {
    return typeof sessionId === 'string' && sessionId.length > 8 ? `${sessionId.slice(0, 8)}…` : sessionId || '';
}
/** 工具栏：会话选择 + 手动刷新 + 类型过滤。 */
function ReplayToolbar({ sessions, selected, onSelect, filter, onFilter, onRefresh, }) {
    return createElement('div', { className: 'dsh-my-observability-toolbar' }, createElement('div', { className: 'dsh-my-observability-toolbar-row' }, createElement('select', {
        className: 'dsh-my-observability-select',
        value: selected,
        disabled: sessions.length === 0,
        onChange: (e) => onSelect(e.target.value),
    }, sessions.length === 0
        ? createElement('option', { value: '' }, strings.allSessions())
        : sessions.map((s) => createElement('option', { key: s.sessionId, value: s.sessionId }, sessionOptionLabel(s)))), createElement('button', {
        type: 'button',
        className: 'dsh-my-observability-iconbtn',
        'aria-label': strings.refresh(),
        title: strings.refresh(),
        onClick: onRefresh,
    }, icon.refresh(15))), createElement(TypeFilter, { filter, onFilter }));
}
/** 加载中状态（旋转刷新图标 + 次级色文案，不阻塞布局）。 */
function LoadingState() {
    return createElement('div', { className: 'dsh-my-observability-state' }, icon.refresh(14), createElement('span', null, strings.loading()));
}
/** 空状态（图标 + 主文案 + hint 两行结构）。 */
function EmptyState() {
    return createElement('div', { className: 'dsh-my-observability-empty' }, createElement('span', { className: 'dsh-my-observability-empty-icon' }, icon.clock(20)), createElement('span', null, strings.emptyEvents()), createElement('span', { className: 'dsh-my-observability-empty-hint' }, strings.emptyEventsHint()));
}
/** 错误状态（错误色文案 + 重试按钮）。 */
function ErrorState({ message, onRetry }) {
    return createElement('div', { className: 'dsh-my-observability-error' }, createElement('span', { className: 'dsh-my-observability-error-text' }, `${strings.loadError()}：${message}`), createElement('button', {
        type: 'button',
        className: 'dsh-my-observability-iconbtn',
        'aria-label': strings.retry(),
        title: strings.retry(),
        onClick: onRetry,
    }, icon.refresh(15)));
}
/** 轨迹回放主面板：会话选择 + 类型过滤 + 搜索/组合过滤 + 导出 + 统计 + 时间轴。
 *  状态与派生值集中在 replay-ext.js 的 useReplayState；本组件只拼装视图。
 *  面板可见时轮询、隐藏时暂停。 */
function ReplayPanel(props) {
    const s = useReplayState(props);
    return createElement('div', { className: 'dsh-my-observability-panel' }, createElement(ResourcePanel, { resource: s.resource }), createElement(ReplayToolbar, {
        sessions: s.sessions,
        selected: s.selected,
        onSelect: s.setSelected,
        filter: s.filter,
        onFilter: s.setFilter,
        onRefresh: s.retry,
    }), createElement(SearchFilterBar, {
        keyword: s.keyword,
        onKeyword: s.setKeyword,
        timeStart: s.timeStart,
        onTimeStart: s.setTimeStart,
        timeEnd: s.timeEnd,
        onTimeEnd: s.setTimeEnd,
        result: s.result,
        onResult: s.setResult,
        onClear: s.clearFilters,
    }), createElement(ExportBar, {
        scope: s.scope,
        onScope: s.setScope,
        onExportJson: () => void s.onExport('json'),
        onExportCsv: () => void s.onExport('csv'),
        showStats: s.showStats,
        onToggleStats: () => s.setShowStats((value) => !value),
        disabled: !s.canExport,
    }), s.error !== '' ? createElement(ErrorState, { message: s.error, onRetry: s.retry }) : null, s.loading && s.error === '' ? createElement(LoadingState, null) : null, !s.loading && s.error === '' && s.filtered.length === 0
        ? s.hasFilter
            ? createElement(NoMatchesState, null)
            : createElement(EmptyState, null)
        : null, s.showStats ? createElement(StatsPanel, { events: s.filtered }) : null, createElement('div', { className: 'dsh-my-observability-timeline' }, s.rows));
}

    "use strict";
// ── 资源监控区块（写放大/资源超限预警，见 lib/resource-monitor.js）──────
// 依赖 replay.js 先拼接（apiJson）与 i18n.js（strings）。纯函数声明文本。
const RESOURCE_POLL_MS = 15000;
function fmtResourceBytes(bytes) {
    if (!Number.isFinite(bytes))
        return '-';
    return `${(bytes / 1048576).toFixed(1)} MB`;
}
/** 资源采样状态：可见时每 15s 轮询 /observability/api/resources。 */
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
        return createElement('div', { className: 'dsh-my-observability-resource' }, strings.resourceLoading());
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
// ── 审计视图扩展：搜索 / 组合过滤 / 导出 / 统计 / 高亮（replay.js 拆出）────
// 依赖 replay.js（REPLAY_POLL_MS 等常量与 loadReplayData/EventRow）与
// audit-view.js 纯函数（applyAuditFilter 等）。始终以 function 声明提升。
const REPLAY_POLL_MS = 5000;
const ALL_SESSIONS = '*';
const EXPORT_LIMIT_ALL = 20000;
/** `datetime-local` 值 → 毫秒时间戳（空/非法返回 undefined）。 */
function datetimeToMs(value) {
    if (typeof value !== 'string' || value.trim() === '')
        return undefined;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : undefined;
}
/** 是否有活动过滤条件（决定无匹配/空状态展示）。 */
function hasActiveFilter(criteria) {
    return (criteria.keyword !== '' ||
        criteria.result !== '' ||
        criteria.timeStart !== undefined ||
        criteria.timeEnd !== undefined ||
        criteria.type !== '');
}
/** 命中关键词高亮（`mark` 包裹命中段；无关键词时原样文本）。 */
function HighlightText({ text, keyword }) {
    const segments = highlightSegments(text, keyword);
    return createElement('span', null, segments.map((seg, index) => seg.hit ? createElement('mark', { key: index, className: 'dsh-my-observability-mark' }, seg.text) : seg.text));
}
/** 搜索 / 组合过滤栏：关键词 + 时间范围 + 成功/失败。 */
/** 搜索框行（含清除按钮）。 */
function SearchInput({ keyword, onKeyword, onClear, }) {
    return createElement('div', { className: 'dsh-my-observability-search-row' }, createElement('input', {
        className: 'dsh-my-observability-input',
        type: 'search',
        value: keyword,
        placeholder: strings.searchPlaceholder(),
        onChange: (e) => onKeyword(e.target.value),
    }), keyword !== ''
        ? createElement('button', {
            type: 'button',
            className: 'dsh-my-observability-iconbtn',
            'aria-label': strings.clearFilters(),
            title: strings.clearFilters(),
            onClick: onClear,
        }, icon.close(15))
        : null);
}
/** 时间范围行（开始/结束，datetime-local）。 */
function TimeRangeInput({ timeStart, onTimeStart, timeEnd, onTimeEnd, }) {
    return createElement('div', { className: 'dsh-my-observability-time-row' }, createElement('label', { className: 'dsh-my-observability-time-label' }, strings.timeStartLabel()), createElement('input', {
        className: 'dsh-my-observability-input dsh-my-observability-time-input',
        type: 'datetime-local',
        value: timeStart,
        onChange: (e) => onTimeStart(e.target.value),
    }), createElement('label', { className: 'dsh-my-observability-time-label' }, strings.timeEndLabel()), createElement('input', {
        className: 'dsh-my-observability-input dsh-my-observability-time-input',
        type: 'datetime-local',
        value: timeEnd,
        onChange: (e) => onTimeEnd(e.target.value),
    }));
}
/** 成功/失败结果过滤组。 */
function ResultFilter({ result, onResult }) {
    const options = [
        ['', strings.filterAllResult()],
        ['success', strings.filterSuccess()],
        ['fail', strings.filterFail()],
    ];
    return createElement('div', { className: 'dsh-my-observability-filters' }, options.map(([value, label]) => createElement('button', {
        key: value,
        type: 'button',
        className: `dsh-my-observability-chip${result === value ? ' dsh-my-observability-chip-active' : ''}`,
        'aria-pressed': result === value,
        onClick: () => onResult(value),
    }, label)));
}
/** 搜索 / 组合过滤栏：关键词 + 时间范围 + 成功/失败。 */
function SearchFilterBar({ keyword, onKeyword, timeStart, onTimeStart, timeEnd, onTimeEnd, result, onResult, onClear, }) {
    return createElement('div', { className: 'dsh-my-observability-toolbar' }, createElement(SearchInput, { keyword, onKeyword, onClear }), createElement(TimeRangeInput, { timeStart, onTimeStart, timeEnd, onTimeEnd }), createElement(ResultFilter, { result, onResult }));
}
/** 导出栏：导出范围选择（当前会话/全部会话）+ JSON/CSV 按钮 + 统计开关。 */
function ExportBar({ scope, onScope, onExportJson, onExportCsv, showStats, onToggleStats, disabled, }) {
    return createElement('div', { className: 'dsh-my-observability-export' }, createElement('div', { className: 'dsh-my-observability-toolbar-row' }, createElement('select', {
        className: 'dsh-my-observability-select',
        value: scope,
        disabled,
        onChange: (e) => onScope(e.target.value),
    }, createElement('option', { value: 'session' }, strings.scopeSession()), createElement('option', { value: 'all' }, strings.scopeAll())), createElement('button', { type: 'button', className: 'dsh-my-observability-btn', disabled, onClick: onExportJson }, strings.exportJson()), createElement('button', { type: 'button', className: 'dsh-my-observability-btn', disabled, onClick: onExportCsv }, strings.exportCsv()), createElement('button', {
        type: 'button',
        className: 'dsh-my-observability-btn',
        'aria-pressed': showStats,
        onClick: onToggleStats,
    }, strings.statsTitle())));
}
/** 工具调用统计视图（Top N 调用次数 + 失败率）。 */
function StatsPanel({ events }) {
    const stats = computeToolStats(events, 5);
    if (stats.length === 0)
        return createElement('div', { className: 'dsh-my-observability-stats-empty' }, strings.statsEmpty());
    return createElement('div', { className: 'dsh-my-observability-stats' }, createElement('div', { className: 'dsh-my-observability-stats-title' }, strings.statsTitle()), createElement('table', { className: 'dsh-my-observability-stats-table' }, createElement('thead', null, createElement('tr', null, createElement('th', null, strings.statsTool()), createElement('th', null, strings.statsCalls()), createElement('th', null, strings.statsFailRate()))), createElement('tbody', null, stats.map((s) => createElement('tr', { key: s.tool }, createElement('td', null, s.tool), createElement('td', null, String(s.calls)), createElement('td', null, `${(s.failRate * 100).toFixed(1)}%`))))));
}
/** 无匹配状态（搜索/过滤条件命中 0 条）。 */
function NoMatchesState() {
    return createElement('div', { className: 'dsh-my-observability-empty' }, createElement('span', { className: 'dsh-my-observability-empty-icon' }, icon.search(20)), createElement('span', null, strings.noMatches()));
}
/** 触发浏览器下载（Blob + a[download]）。 */
function downloadAudit(content, format) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const filename = `${strings.exportFileName()}-${stamp}.${format}`;
    const mime = format === 'json' ? 'application/json' : 'text/csv;charset=utf-8';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
/** 拉取全部会话事件（导出范围「全部会话」用），并应用当前过滤条件。 */
async function allSessionEvents(criteria) {
    const all = await apiJson(`/observability/api/events?sessionId=${encodeURIComponent(ALL_SESSIONS)}&limit=${EXPORT_LIMIT_ALL}`);
    return applyAuditFilter(all, criteria);
}
/** 导出：依据范围（当前会话=过滤后结果 / 全部会话=拉取后过滤）生成并下载。 */
async function runExport(format, scope, filtered, criteria, onError) {
    try {
        const dataEvents = scope === 'session' ? filtered : await allSessionEvents(criteria);
        downloadAudit(format === 'json' ? auditToJson(dataEvents) : auditToCsv(dataEvents), format);
    }
    catch (err) {
        onError(err instanceof Error ? err.message : String(err));
    }
}
/** 轨迹回放面板的数据状态：会话列表 + 选中 + 事件 + 轮询 + 加载/错误。
 *  隐藏时暂停轮询，可见时按 REPLAY_POLL_MS 拉取并自动选当前会话。 */
function useReplayDataState(props) {
    const currentSession = props?.scope?.sessionId || '';
    const visible = props?.visible !== false;
    const [sessions, setSessions] = useState([]);
    const [selected, setSelected] = useState('');
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reloadTick, setReloadTick] = useState(0);
    const [resource, setResource] = useState(null);
    // 资源采样轮询（写放大/资源超限预警；可见时 15s 一次，隐藏暂停）
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
    useEffect(() => {
        if (!visible)
            return undefined;
        let alive = true;
        const setters = { setSessions, setSelected, setEvents, setError, setLoading };
        const tick = () => {
            if (alive)
                void loadReplayData(selected, currentSession, setters);
        };
        tick();
        const timer = setInterval(tick, REPLAY_POLL_MS);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [visible, selected, currentSession, reloadTick]);
    const retry = () => {
        setError('');
        setLoading(true);
        setReloadTick((tick) => tick + 1);
    };
    return {
        currentSession,
        resource,
        sessions,
        selected,
        events,
        loading,
        error,
        setSessions,
        setSelected,
        setEvents,
        setLoading,
        setError,
        retry,
    };
}
/** 轨迹回放面板的视图状态：过滤条件（类型/关键词/时间/成功失败）+ 导出范围 +
 *  统计开关，及派生值（过滤结果 / 高亮行 / 可导出）。 */
function useReplayState(props) {
    const data = useReplayDataState(props);
    const [filter, setFilter] = useState('');
    const [keyword, setKeyword] = useState('');
    const [timeStart, setTimeStart] = useState('');
    const [timeEnd, setTimeEnd] = useState('');
    const [result, setResult] = useState('');
    const [scope, setScope] = useState('session');
    const [showStats, setShowStats] = useState(false);
    const clearFilters = () => {
        setKeyword('');
        setTimeStart('');
        setTimeEnd('');
        setResult('');
        setFilter('');
    };
    const criteria = {
        type: filter,
        keyword,
        timeStart: datetimeToMs(timeStart),
        timeEnd: datetimeToMs(timeEnd),
        result,
    };
    const filtered = applyAuditFilter(data.events, criteria);
    const hasFilter = hasActiveFilter(criteria);
    const rows = filtered.map((event, index) => createElement(EventRow, { key: event.id ?? index, event, keyword }));
    const canExport = !data.loading && data.events.length > 0;
    const onExport = (format) => void runExport(format, scope, filtered, criteria, data.setError);
    return {
        resource: data.resource,
        sessions: data.sessions,
        selected: data.selected,
        events: data.events,
        loading: data.loading,
        error: data.error,
        filter,
        keyword,
        timeStart,
        timeEnd,
        result,
        scope,
        showStats,
        setSelected: data.setSelected,
        setFilter,
        setKeyword,
        setTimeStart,
        setTimeEnd,
        setResult,
        setScope,
        setShowStats,
        retry: data.retry,
        clearFilters,
        filtered,
        hasFilter,
        rows,
        canExport,
        onExport,
    };
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
// ── 样式（DSH 语义 token，随 activation 注入 / teardown 卸载）──────
// 前缀 dsh-my-observability-（issue #54：与 dsh-my-guard 前缀分离，消除跨插件类名冲突）。
const STYLES = `
.dsh-my-observability-panel{display:flex;flex-direction:column;gap:10px;padding:2px 6px 8px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
.dsh-my-observability-toolbar{display:flex;flex-direction:column;gap:8px}
.dsh-my-observability-toolbar-row{display:flex;align-items:center;gap:6px}
.dsh-my-observability-select{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px}
.dsh-my-observability-select:disabled{opacity:.4;cursor:default}
.dsh-my-observability-input{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px}
.dsh-my-observability-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-repo-row{display:flex;gap:8px;align-items:center}
.dsh-my-observability-repo-input{flex:1}
.dsh-my-observability-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;
  border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-observability-iconbtn svg{display:block}
.dsh-my-observability-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-my-observability-iconbtn:disabled{opacity:.4;cursor:default}
.dsh-my-observability-filters{display:flex;gap:6px;flex-wrap:wrap}
.dsh-my-observability-chip{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);background:transparent;
  border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;cursor:pointer;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-observability-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-my-observability-chip-active{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-interactive-primary);
  background:color-mix(in srgb, var(--dsw-alias-interactive-primary) 12%, transparent)}
/* ── 时间轴：左侧竖线 + 类型色节点圆点 + 类型图标行 ── */
.dsh-my-observability-timeline{display:flex;flex-direction:column;gap:2px;max-height:calc(100vh - 240px);overflow-y:auto;
  padding-left:14px;position:relative}
.dsh-my-observability-timeline::before{content:'';position:absolute;left:5px;top:8px;bottom:8px;width:2px;border-radius:1px;
  background:var(--dsw-alias-border-l2)}
.dsh-my-observability-event{position:relative;display:flex;align-items:flex-start;gap:8px;box-sizing:border-box;width:100%;
  margin:0;padding:5px 8px 5px 0;border:none;background:transparent;border-radius:8px;cursor:pointer;text-align:left;
  font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary);
  animation:dsh-my-observability-row-in 150ms var(--ds-ease-in-out);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-observability-event:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-observability-event:active{background:color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 55%, transparent)}
.dsh-my-observability-node{position:absolute;left:-14px;top:50%;transform:translateY(-50%);width:12px;height:12px;flex:none;
  box-sizing:border-box;border-radius:50%;background:var(--dsw-alias-bg-layer-2);border:2px solid var(--dsw-alias-label-tertiary)}
.dsh-my-observability-node-status{border-color:var(--dsw-alias-state-info-primary)}
.dsh-my-observability-node-llm{border-color:var(--dsw-alias-state-warn-primary)}
.dsh-my-observability-node-call{border-color:var(--dsw-alias-accent)}
.dsh-my-observability-node-plugin{border-color:var(--dsw-alias-state-info-primary)}
.dsh-my-observability-node-result{border-color:var(--dsw-alias-state-success-primary)}
.dsh-my-observability-node-fail{border-color:var(--dsw-alias-state-error-primary)}
.dsh-my-observability-event-icon{flex:none;display:flex;align-items:center;margin-top:1px}
.dsh-my-observability-icon-status{color:var(--dsw-alias-state-info-primary)}
.dsh-my-observability-icon-llm{color:var(--dsw-alias-state-warn-primary)}
.dsh-my-observability-icon-call{color:var(--dsw-alias-accent)}
.dsh-my-observability-icon-plugin{color:var(--dsw-alias-state-info-primary)}
.dsh-my-observability-icon-result{color:var(--dsw-alias-state-success-primary)}
.dsh-my-observability-icon-fail{color:var(--dsw-alias-state-error-primary)}
.dsh-my-observability-event-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dsh-my-observability-event-head{display:flex;align-items:center;gap:8px;justify-content:space-between}
.dsh-my-observability-badge{flex:none;font:var(--dsw-font-xxxs-strong-11);border-radius:4px;padding:1px 6px}
.dsh-my-observability-badge-status{color:var(--dsw-alias-state-info-primary);background:color-mix(in srgb, var(--dsw-alias-state-info-primary) 14%, transparent)}
.dsh-my-observability-badge-llm{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)}
.dsh-my-observability-badge-call{color:var(--dsw-alias-accent);background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent)}
.dsh-my-observability-badge-plugin{color:var(--dsw-alias-state-info-primary);background:color-mix(in srgb, var(--dsw-alias-state-info-primary) 14%, transparent)}
.dsh-my-observability-badge-result{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)}
.dsh-my-observability-badge-fail{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
.dsh-my-observability-time{flex:none;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dsh-my-observability-event-meta{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.6;word-break:break-word}
/* ── 插件事件详情展开（issue #154：原因/参数可查）── */
.dsh-my-observability-event-detail{display:flex;flex-direction:column;gap:2px;margin-top:4px;padding:6px 8px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}
.dsh-my-observability-detail-row{display:flex;gap:8px;font:var(--dsw-font-xxs-12);line-height:1.5;word-break:break-word}
.dsh-my-observability-detail-key{flex:none;font:var(--dsw-font-xxxs-strong-11);color:var(--dsw-alias-label-tertiary);min-width:56px}
.dsh-my-observability-detail-value{color:var(--dsw-alias-label-primary)}
/* ── 状态区：loading / 空 / 错误 ── */
.dsh-my-observability-state{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-state svg{flex:none;animation:dsh-my-observability-spin 1s linear infinite}
.dsh-my-observability-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:16px 8px;text-align:center;
  font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.7}
.dsh-my-observability-empty-icon{display:flex;color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-empty-hint{display:block;color:var(--dsw-alias-label-dimmed);font:var(--dsw-font-xxxs-11)}
.dsh-my-observability-error{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);
  color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;word-break:break-all;line-height:1.7}
.dsh-my-observability-error-text{flex:1;min-width:0}
@keyframes dsh-my-observability-row-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}
@keyframes dsh-my-observability-spin{to{transform:rotate(360deg)}}
/* ── 审计视图：搜索 / 组合过滤 / 导出 / 统计 / 高亮 ── */
.dsh-my-observability-search-row{display:flex;align-items:center;gap:6px}
.dsh-my-observability-search-row .dsh-my-observability-input{flex:1}
.dsh-my-observability-time-row{display:flex;align-items:center;gap:6px}
.dsh-my-observability-time-label{flex:none;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-time-input{flex:1;min-width:0}
.dsh-my-observability-mark{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent);
  color:var(--dsw-alias-label-primary);border-radius:2px;padding:0 1px}
.dsh-my-observability-export{display:flex;flex-direction:column;gap:6px}
.dsh-my-observability-stats{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l2);
  border-radius:6px;padding:8px}
.dsh-my-observability-stats-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dsh-my-observability-stats-table{width:100%;border-collapse:collapse;font:var(--dsw-font-xxs-12)}
.dsh-my-observability-stats-table th,.dsh-my-observability-stats-table td{text-align:left;padding:3px 6px;
  border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dsh-my-observability-stats-table th{font:var(--dsw-font-xxxs-strong-11);color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-stats-empty{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);padding:6px 2px}
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


    // ── 插件体：样式注入 + 两个页签注册 ────────────────────────────────
    exports.inject = ['betterSidebar']

    exports.apply = function apply(ctx) {
      ctx.effect(() => injectStyles(), 'dsh-my-observability: styles')
      const service = ctx.betterSidebar
      if (service === undefined) return
      ctx.effect(
        () =>
          service.registerTab({
            id: 'dsh-my-observability:replay',
            title: () => strings.replayTitle(),
            order: 40,
            single: true,
            component: (props) => createElement(ReplayPanel, props),
          }),
        'dsh-my-observability: replay tab registration',
      )
      ctx.effect(
        () =>
          service.registerTab({
            id: 'dsh-my-observability:git',
            title: () => strings.gitTitle(),
            order: 41,
            single: true,
            component: (props) => createElement(GitPanel, props),
          }),
        'dsh-my-observability: git tab registration',
      )
    }

    return module.exports
  },
})
