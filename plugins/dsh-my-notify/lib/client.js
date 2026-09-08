/**
 * dsh-my-notify — client half (browser). SOURCE TEMPLATE.
 *
 * 订阅 server 端 SSE 通道（/notify/api/stream，由 lib/index.js 广播），在
 * 收到通知帧后：
 *  - 系统通知（Notification API）：标题=会话标题，正文=类型+摘要；
 *    点击 → 聚焦窗口 + 打开对应会话（ctx.sessions.open）；
 *  - 提示音：Web Audio 合成短促「滴」声（无需音频资源；受浏览器自动播放
 *    策略约束，首次用户交互后解锁）；
 *  - 页面内 toast 兜底：权限被拒/关闭通知时仍可见提醒，点击同样跳转。
 *
 * 本地开关（localStorage）：
 *  - dsh-notify:notify = '0' 关闭系统通知（默认开）
 *  - dsh-notify:sound   = '0' 关闭提示音（默认开）
 *  - dsh-notify:toast   = '0' 关闭页面内 toast（默认开）
 *  - dsh-notify:volume  = 0~1 提示音音量（默认 0.6，issue #71）
 *
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs
 * 将三个片段文件（lib/parts/i18n.js / render.js / stream.js，均为无
 * import/export 的纯函数声明文本）经下方 __PART_*__ 占位符（函数式
 * replaceAll，避免 $&/$1 特殊解释）拼接进 factory 作用域，写出
 * lib/client.js —— 即 DSH 实际服务的产物。产物必须提交；CI 只对产物执行
 * node --check（见 scripts/test-all.sh / .github/workflows/ci.yml）。
 *
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-notify',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    // ── i18n 文案与本地偏好（lib/parts/i18n.js）────────────────────────
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
  kindEnd: () => (isZh() ? '会话已结束' : 'Session finished'),
  kindAsk: () => (isZh() ? '需要你回答' : 'Needs your answer'),
  kindApproval: () => (isZh() ? '等待你的批准' : 'Approval needed'),
  kindRemote: () => (isZh() ? '提示' : 'Notice'),
  untitled: (short) =>
    isZh() ? (short !== '' ? `会话 ${short}` : '会话') : short !== '' ? `Session ${short}` : 'Session',
  openSession: () => (isZh() ? '打开会话' : 'Open session'),
  closeToast: () => (isZh() ? '关闭通知' : 'Dismiss notification'),
  // 设置页（issue #27 配置可视化）
  settingsTitle: () => (isZh() ? '通知提醒' : 'Notifications'),
  settingsTriggers: () => (isZh() ? '触发开关' : 'Triggers'),
  settingsEnd: () => (isZh() ? '会话结束提醒' : 'Session end'),
  settingsEndHint: () => (isZh() ? '本轮对话结束后弹通知' : 'Notify when a session finishes'),
  settingsAsk: () => (isZh() ? '询问提醒' : 'Ask'),
  settingsAskHint: () => (isZh() ? 'agent 询问问题时弹通知' : 'Notify when the agent asks you'),
  settingsApproval: () => (isZh() ? '审批提醒' : 'Approval'),
  settingsApprovalHint: () => (isZh() ? '等待批准时弹通知' : 'Notify when approval is needed'),
  settingsSubagentEnd: () => (isZh() ? '子代理完成提醒' : 'Subagent end'),
  settingsSubagentEndHint: () =>
    isZh() ? '子代理完成时也弹通知（默认关闭）' : 'Also notify when a subagent finishes (off by default)',
  settingsAdvanced: () => (isZh() ? '高级' : 'Advanced'),
  settingsApiToken: () => (isZh() ? '远程触发 Token' : 'Remote trigger token'),
  settingsApiTokenHint: () =>
    isZh() ? '配置后远程 hook 需携带 x-notify-token 头' : 'Remote hooks must send x-notify-token when set',
  settingsDedupeMs: () => (isZh() ? '去重窗口（毫秒）' : 'Dedupe window (ms)'),
  settingsDedupeMsHint: () => (isZh() ? '同类通知在窗口内只推一次' : 'Same-kind notices are deduped within the window'),
  settingsVolume: () => (isZh() ? '提示音音量' : 'Sound volume'),
  settingsVolumeHint: () => (isZh() ? '调节提示音大小（0~100%）' : 'Adjust the beep volume (0-100%)'),
  // 出站 webhook（issue #92）
  settingsWebhooks: () => (isZh() ? '出站 Webhook' : 'Outbound webhooks'),
  settingsWebhooksHint: () =>
    isZh() ? '事件发生时推送到企微/飞书/钉钉机器人（手机可收）' : 'Push events to WeCom/Feishu/DingTalk bots',
  webhookName: () => (isZh() ? '名称' : 'Name'),
  webhookNamePlaceholder: () => (isZh() ? '如：企微-工作群' : 'e.g. WeCom group'),
  webhookChannel: () => (isZh() ? '渠道' : 'Channel'),
  webhookUrl: () => (isZh() ? 'Webhook URL' : 'Webhook URL'),
  webhookUrlPlaceholder: () => (isZh() ? '机器人 webhook 地址' : 'Bot webhook URL'),
  webhookSecret: () => (isZh() ? '签名密钥（可选）' : 'Secret (optional)'),
  webhookSecretPlaceholder: () => (isZh() ? '机器人签名密钥' : 'Bot signing secret'),
  webhookEvents: () => (isZh() ? '触发事件' : 'Trigger events'),
  webhookMsgType: () => (isZh() ? '消息类型' : 'Message type'),
  webhookTemplate: () => (isZh() ? '自定义模板（可选）' : 'Content template (optional)'),
  webhookTemplatePlaceholder: () =>
    isZh() ? '如 {title} {kind} {note} {tokens} {question} {sessionUrl} {time}' : 'e.g. {title} {kind} {note} {tokens}',
  webhookAdd: () => (isZh() ? '添加 Webhook' : 'Add webhook'),
  webhookEdit: () => (isZh() ? '编辑' : 'Edit'),
  webhookDelete: () => (isZh() ? '删除' : 'Delete'),
  webhookSave: () => (isZh() ? '保存' : 'Save'),
  webhookCancel: () => (isZh() ? '取消' : 'Cancel'),
  webhookFailures: () => (isZh() ? '推送失败记录' : 'Push failures'),
  webhookNoFailures: () => (isZh() ? '暂无失败记录' : 'No failures yet'),
  channelWecom: () => (isZh() ? '企业微信' : 'WeCom'),
  channelFeishu: () => (isZh() ? '飞书' : 'Feishu'),
  channelDingtalk: () => (isZh() ? '钉钉' : 'DingTalk'),
  channelGeneric: () => (isZh() ? '通用' : 'Generic'),
  eventEnd: () => (isZh() ? '会话结束' : 'End'),
  eventAsk: () => (isZh() ? '询问' : 'Ask'),
  eventApproval: () => (isZh() ? '审批' : 'Approval'),
  eventRemote: () => (isZh() ? '远程触发' : 'Remote'),
  eventAll: () => (isZh() ? '全部事件' : 'All events'),
  msgTypeText: () => (isZh() ? '文本' : 'Text'),
  msgTypeMarkdown: () => (isZh() ? 'Markdown' : 'Markdown'),
  msgTypePost: () => (isZh() ? '富文本' : 'Post'),
  save: () => (isZh() ? '保存' : 'Save'),
  saved: () => (isZh() ? '已保存' : 'Saved'),
  saveFailed: () => (isZh() ? '保存失败' : 'Save failed'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
}

// ── 本地开关（localStorage 覆盖，默认全开）──────────────────────────
const LS = {
  notify: 'dsh-notify:notify',
  sound: 'dsh-notify:sound',
  toast: 'dsh-notify:toast',
  volume: 'dsh-notify:volume',
}

function prefOn(key, def) {
  try {
    const v = window.localStorage.getItem(key)
    if (v === null) return def
    return v === '1'
  } catch {
    return def
  }
}

/** 提示音音量（0~1，默认 0.6；issue #71：0.18 太小听不见）。 */
function prefVolume() {
  try {
    const raw = window.localStorage.getItem(LS.volume)
    if (raw === null) return 0.6
    const v = Number(raw)
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v
  } catch {
    // fall through to default
  }
  return 0.6
}


    // ── 共享图标（dsh-shared/client-parts/icons.part.js，issue #54）────
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


    // ── 通知渲染：内容构造 / 提示音 / toast / 系统通知 / 样式 ───────────
    // ── 通知内容构造 ────────────────────────────────────────────────────
function shortId(id) {
  if (typeof id !== 'string' || id === '') return ''
  return id.length > 8 ? id.slice(0, 8) : id
}

function kindLabel(kind) {
  switch (kind) {
    case 'end':
      return strings.kindEnd()
    case 'ask':
      return strings.kindAsk()
    case 'approval':
      return strings.kindApproval()
    default:
      return strings.kindRemote()
  }
}

function noticeTitle(notice) {
  if (typeof notice.title === 'string' && notice.title !== '') return notice.title
  return strings.untitled(shortId(notice.sessionId))
}

function noticeBody(notice) {
  const parts = []
  if (notice.kind !== 'remote') parts.push(kindLabel(notice.kind))
  if (typeof notice.toolName === 'string' && notice.toolName !== '') parts.push(notice.toolName)
  if (typeof notice.note === 'string' && notice.note !== '') parts.push(notice.note)
  return parts.join(' · ')
}

function faviconOf() {
  try {
    const link = document.querySelector('link[rel="icon"]')
    return link !== null && typeof link.href === 'string' ? link.href : ''
  } catch {
    return ''
  }
}

// ── 提示音（Web Audio 合成短促滴声）────────────────────────────────
let audioCtx = null

function baseAudio() {
  const AC = window.AudioContext || window.webkitAudioContext
  if (typeof AC !== 'function') return null
  if (audioCtx === null) {
    try {
      audioCtx = new AC()
    } catch {
      return null
    }
  }
  return audioCtx
}

function beep() {
  const ac = baseAudio()
  if (ac === null) return
  const resume = typeof ac.resume === 'function' ? ac.resume() : Promise.resolve()
  void Promise.resolve(resume)
    .then(() => {
      if (!prefOn(LS.sound, true)) return
      const volume = prefVolume()
      const t0 = ac.currentTime
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22)
      osc.connect(gain)
      gain.connect(ac.destination)
      osc.start(t0)
      osc.stop(t0 + 0.24)
    })
    .catch(() => {
      // autoplay policy / audio hardware: sound is best-effort
    })
}

/** 浏览器自动播放策略：首次用户交互后解锁 AudioContext。 */
function armAudioUnlock() {
  if (typeof document === 'undefined') return () => {}
  const unlock = () => {
    try {
      const ac = baseAudio()
      if (ac !== null && typeof ac.resume === 'function') void ac.resume()
    } catch {
      // ignore
    }
    document.removeEventListener('pointerdown', unlock)
    document.removeEventListener('keydown', unlock)
  }
  document.addEventListener('pointerdown', unlock, { passive: true })
  document.addEventListener('keydown', unlock)
  return () => {
    document.removeEventListener('pointerdown', unlock)
    document.removeEventListener('keydown', unlock)
  }
}

// ── 页面内 toast（通知权限关闭/被拒时的兜底）────────────────────────
/** 共享图标是 React 元素树（icon.* 返回 createElement 树），toast 是命令式
 *  DOM 构建：把元素树转成 SVG DOM 节点复用同一套图标（stroke=currentColor
 *  继承周围文字色）。camelCase 属性转 SVG 属性名（viewBox 特例保持原样）。 */
function svgAttrName(key) {
  if (key === 'viewBox') return 'viewBox'
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

function isVoidNode(node) {
  return node === null || node === undefined || typeof node === 'boolean'
}

function isTextNode(node) {
  return typeof node === 'string' || typeof node === 'number'
}

function toChildList(children) {
  if (Array.isArray(children)) return children
  if (children === undefined || children === null) return []
  return [children]
}

function elementToDom(node) {
  if (isVoidNode(node)) return null
  if (isTextNode(node)) return document.createTextNode(String(node))
  const el = document.createElementNS('http://www.w3.org/2000/svg', node.type)
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (key === 'children') continue
    el.setAttribute(svgAttrName(key), String(value))
  }
  for (const child of toChildList(node.props?.children)) {
    const dom = elementToDom(child)
    if (dom !== null) el.appendChild(dom)
  }
  return el
}

/** 通知类型 → 共享图标（stroke=currentColor，颜色语义由 CSS 类区分）。 */
function kindIcon(kind) {
  switch (kind) {
    case 'end':
      return icon.clock(16)
    case 'ask':
      return icon.help(16)
    case 'approval':
      return icon.check(16)
    default:
      return icon.external(16)
  }
}

/** 通知类型 → 图标颜色语义类（end/remote=品牌色信息、ask=警告、approval=成功）。 */
function kindIconClass(kind) {
  switch (kind) {
    case 'end':
      return 'dsh-my-notify-toast-icon-end'
    case 'ask':
      return 'dsh-my-notify-toast-icon-ask'
    case 'approval':
      return 'dsh-my-notify-toast-icon-approval'
    default:
      return 'dsh-my-notify-toast-icon-remote'
  }
}

function ensureToastBox() {
  let box = document.getElementById('dsh-my-notify-toast-box')
  if (box === null) {
    box = document.createElement('div')
    box.id = 'dsh-my-notify-toast-box'
    box.className = 'dsh-my-notify-toast-box'
    document.body.appendChild(box)
  }
  return box
}

function buildToastItem(notice) {
  const item = document.createElement('div')
  item.className = 'dsh-my-notify-toast'
  item.setAttribute('role', 'status')
  const head = document.createElement('div')
  head.className = 'dsh-my-notify-toast-head'
  // 类型图标：共享图标 + 颜色语义（end=clock/品牌色、ask=help/警告、
  // approval=check/成功、remote=external/品牌色）。
  const iconWrap = document.createElement('span')
  iconWrap.className = `dsh-my-notify-toast-icon ${kindIconClass(notice.kind)}`
  iconWrap.appendChild(elementToDom(kindIcon(notice.kind)))
  head.appendChild(iconWrap)
  const title = document.createElement('span')
  title.className = 'dsh-my-notify-toast-title'
  title.textContent = noticeTitle(notice)
  head.appendChild(title)
  // 关闭按钮：close 图标按钮（纯图标，aria-label 无障碍）。
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'dsh-my-notify-toast-close'
  closeBtn.setAttribute('aria-label', strings.closeToast())
  closeBtn.appendChild(elementToDom(icon.close(15)))
  head.appendChild(closeBtn)
  item.appendChild(head)
  const body = document.createElement('div')
  body.className = 'dsh-my-notify-toast-body'
  const bodyText = noticeBody(notice) || kindLabel(notice.kind)
  body.textContent = bodyText
  item.appendChild(body)
  // 操作按钮：打开会话（external 图标 + 文字，点击跳转会话）。
  const actions = document.createElement('div')
  actions.className = 'dsh-my-notify-toast-actions'
  const openBtn = document.createElement('button')
  openBtn.type = 'button'
  openBtn.className = 'dsh-my-notify-toast-open'
  openBtn.appendChild(elementToDom(icon.external(14)))
  const openLabel = document.createElement('span')
  openLabel.textContent = strings.openSession()
  openBtn.appendChild(openLabel)
  actions.appendChild(openBtn)
  item.appendChild(actions)
  // 只允许 textContent 渲染：note/远程 body 不受信任，禁止 innerHTML。
  return item
}

function attachToastEvents(item, onOpen) {
  let timer = null
  const dismiss = () => {
    if (timer !== null) clearTimeout(timer)
    if (item.parentNode === null) return
    // 退场动画：先播 150ms 过渡再移除节点。
    item.classList.add('dsh-my-notify-toast-out')
    setTimeout(() => {
      if (item.parentNode !== null) item.parentNode.removeChild(item)
    }, 150)
  }
  // toast 整体点击：关闭 + 跳转会话（保留原行为）。
  item.addEventListener('click', (event) => {
    if (event !== null && event.stopPropagation) event.stopPropagation()
    dismiss()
    try {
      onOpen()
    } catch {
      // opening the session is best-effort
    }
  })
  // 关闭按钮：只关闭不跳转。
  const closeBtn = item.querySelector('.dsh-my-notify-toast-close')
  if (closeBtn !== null) {
    closeBtn.addEventListener('click', (event) => {
      if (event !== null && event.stopPropagation) event.stopPropagation()
      if (event !== null && event.preventDefault) event.preventDefault()
      dismiss()
    })
  }
  // 打开会话按钮：关闭 + 跳转（与整体点击一致，stopPropagation 防双重触发）。
  const openBtn = item.querySelector('.dsh-my-notify-toast-open')
  if (openBtn !== null) {
    openBtn.addEventListener('click', (event) => {
      if (event !== null && event.stopPropagation) event.stopPropagation()
      if (event !== null && event.preventDefault) event.preventDefault()
      dismiss()
      try {
        onOpen()
      } catch {
        // opening the session is best-effort
      }
    })
  }
  timer = setTimeout(dismiss, 6000)
}

function showToast(notice, onOpen) {
  if (!prefOn(LS.toast, true)) return
  if (typeof document === 'undefined') return
  const box = ensureToastBox()
  const item = buildToastItem(notice)
  attachToastEvents(item, onOpen)
  box.appendChild(item)
  if (box.children.length > 4) box.removeChild(box.firstChild)
}

function removeToastBox() {
  try {
    const box = document.getElementById('dsh-my-notify-toast-box')
    if (box !== null && box.parentNode !== null) box.parentNode.removeChild(box)
  } catch {
    // ignore
  }
}

// ── 系统通知（Notification API）────────────────────────────────────
function fireSystemNotification(notice, sessionId, openSession) {
  try {
    const bodyText = noticeBody(notice)
    const notification = new Notification(noticeTitle(notice), {
      body: bodyText !== '' ? bodyText : kindLabel(notice.kind),
      tag: `dsh-my-notify:${notice.kind}:${sessionId}`,
      icon: faviconOf(),
    })
    notification.onclick = () => {
      try {
        notification.close()
      } catch {
        // ignore
      }
      openSession()
    }
  } catch {
    // Notification constructor failure: fall back to the toast.
    showToast(notice, openSession)
  }
}

// ── 样式（DSH 语义 token，随 activation 注入）───────────────────────
const STYLES = `
.dsh-my-notify-toast-box{position:fixed;right:16px;bottom:16px;z-index:3000;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.dsh-my-notify-toast{pointer-events:auto;width:284px;max-width:calc(100vw - 32px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:var(--dsw-shadow-lv2);padding:10px 12px;cursor:pointer;
  animation:dsh-my-notify-toast-in 160ms var(--ds-ease-in-out);display:flex;flex-direction:column;gap:6px;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),transform var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-notify-toast:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-notify-toast:active{transform:scale(.99)}
.dsh-my-notify-toast-head{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-my-notify-toast-icon{flex:none;display:flex;align-items:center}
.dsh-my-notify-toast-icon svg{display:block}
.dsh-my-notify-toast-icon-end{color:var(--dsw-alias-accent)}
.dsh-my-notify-toast-icon-ask{color:var(--dsw-alias-state-warn-primary)}
.dsh-my-notify-toast-icon-approval{color:var(--dsw-alias-state-success-primary)}
.dsh-my-notify-toast-icon-remote{color:var(--dsw-alias-accent)}
.dsh-my-notify-toast-title{flex:1;min-width:0;font:var(--dsw-font-s-strong-14);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-my-notify-toast-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;
  border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-notify-toast-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-toast-close svg{display:block}
.dsh-my-notify-toast-body{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.6;word-break:break-word}
.dsh-my-notify-toast-actions{display:flex;align-items:center;gap:6px;margin-top:2px}
.dsh-my-notify-toast-open{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:6px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);
  font:var(--dsw-font-xxs-12);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-notify-toast-open:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-accent)}
.dsh-my-notify-toast-open svg{display:block;flex:none}
.dsh-my-notify-toast-out{opacity:0;transform:translateY(6px);transition:opacity 150ms var(--ds-ease-in-out),transform 150ms var(--ds-ease-in-out)}
@keyframes dsh-my-notify-toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`

function injectStyles() {
  if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-my-notify', 'styles')
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style)
  }
}


    // ── SSE 客户端：通知分发 / EventSource 订阅 / 插件体 ─────────────────
    // ── 通知分发（SSE 帧 → 渲染入口）───────────────────────────────────
function isNoticeKind(kind) {
  return kind === 'end' || kind === 'ask' || kind === 'approval' || kind === 'remote'
}

// ── 通知去重（issue #70）：本地窗口 + 跨标签页协调 ─────────────────
// 服务端已按 kind:sessionId 在 dedupeMs（默认 3000ms）内去重；客户端再做
// 双保险：① 本标签页内存窗口（快速路径 + localStorage 不可用时的兜底）；
// ② 跨标签页互斥（Web Locks，Chrome 69+/Firefox 96+/Safari 15.4+）——
// 同一通知只由一个标签页弹系统通知 + 响铃，其余标签页静默。窗口
// 2000ms，覆盖多标签页帧到达时间差与服务端窗口外的偶发重复帧。
//
// 为什么不用 localStorage 做锁：get→check→set 三个步骤非原子（TOCTOU），
// 两个标签页几乎同时收到同一帧时都会读到「未过期」而各自弹通知（真实
// 浏览器复现双弹；单元测试串行调用测不出来）。navigator.locks.request
// 为同名锁提供浏览器级跨标签页互斥：回调串行执行，后到的标签页在回调
// 里读到的锁时间戳已在窗口内 → 静默。无 Web Locks（旧浏览器）时降级为
// 原 localStorage 快速路径（尽力而为，保留历史行为）。
const CLIENT_DEDUPE_MS = 2000
const DEDUPE_LS_PREFIX = 'dsh-notify:dedupe:'
const localRecent = new Map() // `${kind}:${sessionId}` -> lastTime

/** 锁内检查窗口并登记；返回 true = 本标签页应处理（调用方需已持有锁或降级）。 */
function claimLocked(key, now) {
  try {
    const lockKey = DEDUPE_LS_PREFIX + key
    const last = Number(window.localStorage.getItem(lockKey) || 0)
    if (now - last < CLIENT_DEDUPE_MS) {
      localRecent.set(key, now)
      return false
    }
    window.localStorage.setItem(lockKey, String(now))
  } catch {
    // localStorage 不可用（隐私模式等）：仅本地窗口去重
  }
  localRecent.set(key, now)
  if (localRecent.size > 256) {
    for (const [k, t] of localRecent) {
      if (now - t >= CLIENT_DEDUPE_MS) localRecent.delete(k)
    }
  }
  return true
}

/** 通知帧是否在去重窗口内已处理（本标签页或其他标签页）；未处理则登记并返回 true。
 *  返回 Promise（Web Locks 互斥异步；无 Web Locks 时立即 resolve，接口统一）。 */
function claimNotice(key) {
  const now = Date.now()
  const lastLocal = localRecent.get(key)
  if (lastLocal !== undefined && now - lastLocal < CLIENT_DEDUPE_MS) return Promise.resolve(false)
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks !== undefined && locks !== null && typeof locks.request === 'function') {
    // 跨标签页互斥：同名锁回调串行执行，后到者读到窗口内时间戳 → 静默。
    return locks.request(DEDUPE_LS_PREFIX + key, () => claimLocked(key, Date.now()))
  }
  // 降级：无 Web Locks（旧浏览器）→ 原 localStorage 快速路径。
  return Promise.resolve(claimLocked(key, now))
}

function openSessionFor(sessionId, sessionsSvc) {
  return () => {
    try {
      window.focus()
    } catch {
      // ignore
    }
    if (
      sessionId !== '' &&
      sessionsSvc !== undefined &&
      sessionsSvc !== null &&
      typeof sessionsSvc.open === 'function'
    ) {
      try {
        sessionsSvc.open(sessionId)
      } catch {
        // opening is best-effort
      }
    }
  }
}

function dispatchByPermission(notice, sessionId, openSession) {
  if (prefOn(LS.notify, true) && typeof window !== 'undefined' && typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      fireSystemNotification(notice, sessionId, openSession)
      return
    }
    if (Notification.permission === 'default') {
      // 第一次收到通知时请求权限（用户此刻正需要它）；请求期间先以
      // toast + 声音保证提醒，授权成功后本次已不重复弹系统通知。
      void Notification.requestPermission()
        .then((permission) => {
          if (permission === 'granted') {
            fireSystemNotification(notice, sessionId, openSession)
          } else {
            showToast(notice, openSession)
          }
        })
        .catch(() => showToast(notice, openSession))
      showToast(notice, openSession)
      return
    }
  }
  showToast(notice, openSession)
}

function handleNotice(notice, sessionsSvc) {
  if (notice === null || typeof notice !== 'object' || notice.type !== 'notice') return Promise.resolve()
  if (!isNoticeKind(notice.kind)) return Promise.resolve()
  const sessionId = typeof notice.sessionId === 'string' ? notice.sessionId : ''
  const key = `${notice.kind}:${sessionId}`
  return claimNotice(key).then((claimed) => {
    if (!claimed) return // 窗口内已处理（本标签页或其他标签页）→ 静默
    const openSession = openSessionFor(sessionId, sessionsSvc)
    dispatchByPermission(notice, sessionId, openSession)
    if (prefOn(LS.sound, true)) beep()
  })
}

// ── SSE 订阅（server 事件 → 浏览器通知）─────────────────────────────
function subscribeStream(sessionsSvc) {
  if (typeof window === 'undefined' || typeof EventSource !== 'function') return () => {}
  const source = new EventSource('/notify/api/stream')
  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      void handleNotice(data, sessionsSvc)
    } catch {
      // one bad frame must never kill the stream handler
    }
  }
  return () => {
    source.close()
    removeToastBox()
  }
}

// ── 插件体 ──────────────────────────────────────────────────────────
exports.apply = function apply(ctx) {
  // strict=false：首屏加载时 sessions 服务的提供者 fiber 可能尚未 active，
  // cordis 的 ctx.get(name, strict = true) 在 strict 模式下会返回 undefined，
  // 导致点击通知无法跳转会话（降级为仅聚焦窗口，直到 HMR/重启才恢复）；
  // 取到实例即可——openSessionFor 内部仍按 typeof open === 'function' 判空降级。
  const sessionsSvc = ctx.get('sessions', false)

  // 样式注入（与 fiber 同生命周期）。
  ctx.effect(() => injectStyles(), 'dsh-my-notify: styles')

  // 音频解锁：首次用户交互后 resume（浏览器自动播放策略）。
  ctx.effect(() => armAudioUnlock(), 'dsh-my-notify: audio unlock')

  // SSE 订阅：server 事件 → 浏览器通知。
  ctx.effect(() => subscribeStream(sessionsSvc), 'dsh-my-notify: event stream')

  // 设置页 tab（官方 slots 扩展点，issue #27 配置可视化）。
  attachSettingsTab(ctx)
}


    // ── 设置页：出站 webhook 可视化编辑（issue #92）────────────────────
    // 拼接顺序：webhook-settings.js 必须先于 settings.js——settings.js 顶层
    // `SETTINGS_STYLES = ... + WEBHOOK_STYLES` 引用 webhook-settings.js 声明的
    // WEBHOOK_STYLES，顺序颠倒会 TDZ（#92 引入，0.3.6 客户端在真实浏览器
    // 挂载失败：Cannot access 'WEBHOOK_STYLES' before initialization）。
    // ── 出站 Webhook 设置（issue #92）：列表 + 编辑表单 + 失败记录 ──────
const WEBHOOK_STYLES = `
.dsh-my-notify-webhook-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-notify-webhook-editor{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-notify-webhook-field{display:flex;flex-direction:column;gap:4px}
.dsh-my-notify-webhook-field-label{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dsh-my-notify-webhook-input{height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-webhook-select{height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-webhook-events{display:flex;flex-wrap:wrap;gap:6px}
.dsh-my-notify-webhook-event{display:flex;align-items:center;gap:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-webhook-failures{display:flex;flex-direction:column;gap:4px}
.dsh-my-notify-webhook-failure{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-notify-webhook-failure-time{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-notify-webhook-failure-msg{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`

const CHANNEL_OPTIONS = [
  { value: 'wecom', label: () => strings.channelWecom() },
  { value: 'feishu', label: () => strings.channelFeishu() },
  { value: 'dingtalk', label: () => strings.channelDingtalk() },
  { value: 'generic', label: () => strings.channelGeneric() },
]

const EVENT_OPTIONS = [
  { value: 'end', label: () => strings.eventEnd() },
  { value: 'ask', label: () => strings.eventAsk() },
  { value: 'approval', label: () => strings.eventApproval() },
  { value: 'remote', label: () => strings.eventRemote() },
]

/** 空 webhook 模板（添加时使用）。 */
function emptyWebhook() {
  return {
    name: '',
    channel: 'wecom',
    url: '',
    secret: '',
    events: ['end', 'ask', 'approval'],
    enabled: true,
    msgType: 'text',
    template: '',
  }
}

/** 渠道中文标签。 */
function channelLabel(channel) {
  const option = CHANNEL_OPTIONS.find((o) => o.value === channel)
  return option !== undefined ? option.label() : channel
}

/** 事件选择中文标签（空数组 = 全部）。 */
function eventsLabel(events) {
  if (!Array.isArray(events) || events.length === 0) return strings.eventAll()
  return events
    .map((event) => {
      const option = EVENT_OPTIONS.find((o) => o.value === event)
      return option !== undefined ? option.label() : event
    })
    .join(' / ')
}

/** 消息类型选项（按渠道：wecom/dingtalk → text/markdown，feishu → text/post）。 */
function msgTypeOptions(channel) {
  if (channel === 'feishu') {
    return [
      { value: 'text', label: () => strings.msgTypeText() },
      { value: 'post', label: () => strings.msgTypePost() },
    ]
  }
  return [
    { value: 'text', label: () => strings.msgTypeText() },
    { value: 'markdown', label: () => strings.msgTypeMarkdown() },
  ]
}

/** 单条 webhook 显示行：名称/渠道/事件 + 启用开关 + 编辑/删除。 */
function WebhookRow({ webhook, onEdit, onDelete, onToggle }) {
  const enabled = webhook.enabled !== false
  return createElement(
    'div',
    { className: 'dsh-my-notify-webhook-row' },
    createElement(
      'div',
      { className: 'dsh-my-notify-info' },
      createElement('div', { className: 'dsh-my-notify-label' }, webhook.name),
      createElement(
        'div',
        { className: 'dsh-my-notify-hint' },
        `${channelLabel(webhook.channel)} · ${eventsLabel(webhook.events)}`,
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-actions' },
      createElement('div', {
        className: 'dsh-my-notify-toggle',
        'data-on': String(enabled),
        role: 'switch',
        'aria-checked': String(enabled),
        onClick: () => onToggle(!enabled),
      }),
      createElement('button', { className: 'dsh-my-notify-btn', onClick: onEdit }, strings.webhookEdit()),
      createElement('button', { className: 'dsh-my-notify-btn', onClick: onDelete }, strings.webhookDelete()),
    ),
  )
}

/** 编辑表单字段容器（label + control）。 */
function editorField(label, control) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-webhook-field' },
    createElement('div', { className: 'dsh-my-notify-webhook-field-label' }, label),
    control,
  )
}

/** 文本输入控件。 */
function textInput(value, placeholder, onChange) {
  return createElement('input', {
    className: 'dsh-my-notify-webhook-input',
    value,
    placeholder,
    onChange: (event) => onChange(event.target.value),
  })
}

/** 下拉选择控件。 */
function selectInput(value, options, onChange) {
  return createElement(
    'select',
    { className: 'dsh-my-notify-webhook-select', value, onChange: (event) => onChange(event.target.value) },
    options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label())),
  )
}

/** 编辑表单：名称/渠道/URL/secret/事件多选/消息类型 + 保存/取消。 */
function WebhookEditor({ draft, onChange, onSave, onCancel }) {
  const patch = (key, value) => onChange({ ...draft, [key]: value })
  const toggleEvent = (event) => {
    const events = draft.events.includes(event) ? draft.events.filter((e) => e !== event) : [...draft.events, event]
    patch('events', events)
  }
  return createElement(
    'div',
    { className: 'dsh-my-notify-webhook-editor' },
    editorField(
      strings.webhookName(),
      textInput(draft.name, strings.webhookNamePlaceholder(), (v) => patch('name', v)),
    ),
    editorField(
      strings.webhookChannel(),
      selectInput(draft.channel, CHANNEL_OPTIONS, (v) => patch('channel', v)),
    ),
    editorField(
      strings.webhookUrl(),
      textInput(draft.url, strings.webhookUrlPlaceholder(), (v) => patch('url', v)),
    ),
    editorField(
      strings.webhookSecret(),
      textInput(draft.secret, strings.webhookSecretPlaceholder(), (v) => patch('secret', v)),
    ),
    editorField(
      strings.webhookEvents(),
      createElement(
        'div',
        { className: 'dsh-my-notify-webhook-events' },
        EVENT_OPTIONS.map((option) =>
          createElement(
            'label',
            { key: option.value, className: 'dsh-my-notify-webhook-event' },
            createElement('input', {
              type: 'checkbox',
              checked: draft.events.includes(option.value),
              onChange: () => toggleEvent(option.value),
            }),
            option.label(),
          ),
        ),
      ),
    ),
    editorField(
      strings.webhookMsgType(),
      selectInput(draft.msgType, msgTypeOptions(draft.channel), (v) => patch('msgType', v)),
    ),
    editorField(
      strings.webhookTemplate(),
      createElement('textarea', {
        className: 'dsh-my-notify-webhook-input',
        style: { height: 'auto', minHeight: '56px', resize: 'vertical', padding: '6px 8px' },
        value: draft.template ?? '',
        placeholder: strings.webhookTemplatePlaceholder(),
        onChange: (event) => patch('template', event.target.value),
      }),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-actions' },
      createElement('button', { className: 'dsh-my-notify-btn', onClick: onSave }, strings.webhookSave()),
      createElement('button', { className: 'dsh-my-notify-btn', onClick: onCancel }, strings.webhookCancel()),
    ),
  )
}

/** 失败记录条目。 */
function FailureRow({ failure }) {
  const time = new Date(failure.time).toLocaleString()
  return createElement(
    'div',
    { className: 'dsh-my-notify-webhook-failure' },
    createElement(
      'div',
      { className: 'dsh-my-notify-webhook-failure-time' },
      `${time} · ${failure.webhookName}（${channelLabel(failure.channel)}）· ${failure.attempts} 次尝试`,
    ),
    createElement('div', { className: 'dsh-my-notify-webhook-failure-msg' }, failure.error),
  )
}

/** 出站 Webhook 区块：列表 + 添加/编辑 + 失败记录。 */
function WebhookSection({ webhooks, failures, onPatchWebhooks }) {
  const [editing, setEditing] = useState(-1)
  const [editorDraft, setEditorDraft] = useState(null)
  const startAdd = () => {
    setEditorDraft(emptyWebhook())
    setEditing(webhooks.length)
  }
  const startEdit = (index) => {
    setEditorDraft({ ...webhooks[index] })
    setEditing(index)
  }
  const saveEditor = () => {
    const next = [...webhooks]
    if (editing >= next.length) next.push(editorDraft)
    else next[editing] = editorDraft
    onPatchWebhooks(next)
    setEditing(-1)
  }
  const removeAt = (index) => onPatchWebhooks(webhooks.filter((_, i) => i !== index))
  const toggleAt = (index, enabled) => {
    const next = webhooks.map((webhook, i) => (i === index ? { ...webhook, enabled } : webhook))
    onPatchWebhooks(next)
  }
  return createElement(
    'div',
    { className: 'dsh-my-notify-section' },
    createElement('div', { className: 'dsh-my-notify-section-title' }, strings.settingsWebhooks()),
    (webhooks ?? []).map((webhook, index) =>
      createElement(WebhookRow, {
        key: `${index}-${webhook.name}`,
        webhook,
        onEdit: () => startEdit(index),
        onDelete: () => removeAt(index),
        onToggle: (enabled) => toggleAt(index, enabled),
      }),
    ),
    editing >= 0
      ? createElement(WebhookEditor, {
          draft: editorDraft,
          onChange: setEditorDraft,
          onSave: saveEditor,
          onCancel: () => setEditing(-1),
        })
      : null,
    createElement(
      'div',
      { className: 'dsh-my-notify-actions' },
      createElement('button', { className: 'dsh-my-notify-btn', onClick: startAdd }, strings.webhookAdd()),
    ),
    createElement('div', { className: 'dsh-my-notify-section-title' }, strings.webhookFailures()),
    failures !== undefined && failures.length > 0
      ? createElement(
          'div',
          { className: 'dsh-my-notify-webhook-failures' },
          failures.map((failure, index) => createElement(FailureRow, { key: index, failure })),
        )
      : createElement('div', { className: 'dsh-my-notify-hint' }, strings.webhookNoFailures()),
  )
}


    // ── 设置页视图：配置可视化（issue #27，官方 slots 扩展点）───────────
    // ── 设置页视图：配置可视化（issue #27，官方 slots 扩展点）──────────
const SETTINGS_STYLES =
  `
.dsh-my-notify-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-my-notify-section{display:flex;flex-direction:column;gap:8px}
.dsh-my-notify-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dsh-my-notify-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-notify-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-my-notify-label{font:var(--dsw-font-xs-strong-13)}
.dsh-my-notify-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
/* issue #58: toggle 开关开/关一眼可分——关态用灰色轨道（tertiary 混合，
   浅色主题下不再白底融入设置面板背景），开态圆点换对比墨色（foreground），
   强化视觉差异；样式与 dsh-my-skill-manager-switch 的轨道/圆点方案一致 */
.dsh-my-notify-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-notify-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-my-notify-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-notify-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dsh-my-notify-input{flex:none;width:180px;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
/* issue #71: 音量滑杆（range）——细轨道 + 主色填充，与设置面板风格一致 */
.dsh-my-notify-range{flex:none;width:140px;accent-color:var(--dsw-alias-state-success-primary);cursor:pointer}
.dsh-my-notify-range-value{flex:none;min-width:40px;text-align:right;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dsh-my-notify-actions{display:flex;align-items:center;gap:8px}
.dsh-my-notify-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-notify-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-my-notify-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
.dsh-my-notify-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
` + WEBHOOK_STYLES

/** 开关行（布尔配置项）。 */
function SwitchRow({ label, hint, on, onChange }) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-row' },
    createElement(
      'div',
      { className: 'dsh-my-notify-info' },
      createElement('div', { className: 'dsh-my-notify-label' }, label),
      createElement('div', { className: 'dsh-my-notify-hint' }, hint),
    ),
    createElement('div', {
      className: 'dsh-my-notify-toggle',
      'data-on': String(on),
      role: 'switch',
      'aria-checked': String(on),
      onClick: () => onChange(!on),
    }),
  )
}

/** 输入行（文本/数字配置项）。 */
function TextRow({ label, hint, value, onChange, type }) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-row' },
    createElement(
      'div',
      { className: 'dsh-my-notify-info' },
      createElement('div', { className: 'dsh-my-notify-label' }, label),
      createElement('div', { className: 'dsh-my-notify-hint' }, hint),
    ),
    createElement('input', {
      className: 'dsh-my-notify-input',
      type: type ?? 'text',
      value,
      onChange: (event) => onChange(event.target.value),
    }),
  )
}

/** 音量滑杆行（0~1，issue #71：音量走 localStorage，不走 server config）。 */
function VolumeRow({ label, hint, value, onChange }) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-row' },
    createElement(
      'div',
      { className: 'dsh-my-notify-info' },
      createElement('div', { className: 'dsh-my-notify-label' }, label),
      createElement('div', { className: 'dsh-my-notify-hint' }, hint),
    ),
    createElement('input', {
      className: 'dsh-my-notify-range',
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
      value: String(value),
      'aria-label': label,
      onChange: (event) => onChange(Number(event.target.value)),
    }),
    createElement('div', { className: 'dsh-my-notify-range-value' }, `${Math.round(value * 100)}%`),
  )
}

/** 触发开关区块（end/ask/approval/subagentEnd + 音量）。 */
function renderTriggersSection(draft, patch, volume, onVolumeChange) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-section' },
    createElement('div', { className: 'dsh-my-notify-section-title' }, strings.settingsTriggers()),
    createElement(SwitchRow, {
      label: strings.settingsEnd(),
      hint: strings.settingsEndHint(),
      on: draft.end === true,
      onChange: (v) => patch('end', v),
    }),
    createElement(SwitchRow, {
      label: strings.settingsAsk(),
      hint: strings.settingsAskHint(),
      on: draft.ask === true,
      onChange: (v) => patch('ask', v),
    }),
    createElement(SwitchRow, {
      label: strings.settingsApproval(),
      hint: strings.settingsApprovalHint(),
      on: draft.approval === true,
      onChange: (v) => patch('approval', v),
    }),
    createElement(SwitchRow, {
      label: strings.settingsSubagentEnd(),
      hint: strings.settingsSubagentEndHint(),
      on: draft.subagentEnd === true,
      onChange: (v) => patch('subagentEnd', v),
    }),
    createElement(VolumeRow, {
      label: strings.settingsVolume(),
      hint: strings.settingsVolumeHint(),
      value: volume,
      onChange: onVolumeChange,
    }),
  )
}

/** 高级区块（apiToken + dedupeMs）。 */
function renderAdvancedSection(draft, patch) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-section' },
    createElement('div', { className: 'dsh-my-notify-section-title' }, strings.settingsAdvanced()),
    createElement(TextRow, {
      label: strings.settingsApiToken(),
      hint: strings.settingsApiTokenHint(),
      value: draft.apiToken ?? '',
      onChange: (v) => patch('apiToken', v),
    }),
    createElement(TextRow, {
      label: strings.settingsDedupeMs(),
      hint: strings.settingsDedupeMsHint(),
      value: String(draft.dedupeMs ?? 3000),
      type: 'number',
      onChange: (v) => patch('dedupeMs', Number(v)),
    }),
  )
}

/** 设置表单渲染（触发开关 + 出站 webhook + 高级项 + 保存动作）。 */
function renderSettingsForm(draft, patch, save, saved, error, volume, onVolumeChange, webhookProps) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-settings' },
    renderTriggersSection(draft, patch, volume, onVolumeChange),
    createElement(WebhookSection, {
      webhooks: draft.webhooks ?? [],
      failures: webhookProps.failures,
      onPatchWebhooks: (webhooks) => patch('webhooks', webhooks),
    }),
    renderAdvancedSection(draft, patch),
    createElement(
      'div',
      { className: 'dsh-my-notify-actions' },
      createElement('button', { className: 'dsh-my-notify-btn', onClick: save }, strings.save()),
      saved ? createElement('span', { className: 'dsh-my-notify-saved' }, strings.saved()) : null,
      error ? createElement('span', { className: 'dsh-my-notify-error' }, strings.saveFailed()) : null,
    ),
  )
}

/** 保存配置（PUT /notify/api/config），成功/失败更新状态。 */
function saveConfig(draft, setSaved, setError) {
  setSaved(false)
  setError(false)
  fetch('/notify/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('save failed')
      setSaved(true)
    })
    .catch(() => setError(true))
}

/** 设置页主视图：加载当前配置 → 表单编辑 → 保存（PUT /notify/api/config）。 */
function NotifySettingsView() {
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)
  // issue #92: 出站 webhook 推送失败记录（GET /notify/api/webhooks）
  const [failures, setFailures] = useState([])
  // issue #71: 音量走 localStorage（纯 client 端偏好，不随 server config 保存）
  const [volume, setVolume] = useState(() => prefVolume())

  useEffect(() => {
    fetch('/notify/api/config')
      .then((res) => res.json())
      .then((body) => {
        if (body === null || body.ok !== true) throw new Error('bad config response')
        setConfig(body.value)
        setDraft(body.value)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
        setError(true)
      })
  }, [])

  // 出站 webhook 失败记录（issue #92：面板可见）
  useEffect(() => {
    fetch('/notify/api/webhooks')
      .then((res) => res.json())
      .then((body) => {
        if (body === null || body.ok !== true) throw new Error('bad webhooks response')
        setFailures(body.value.failures ?? [])
      })
      .catch(() => {
        // failures are best-effort; the section renders empty
      })
  }, [])

  if (loading) {
    return createElement(
      'div',
      { className: 'dsh-my-notify-settings' },
      createElement('div', { className: 'dsh-my-notify-status' }, strings.loading()),
    )
  }
  if (config === null) {
    return createElement(
      'div',
      { className: 'dsh-my-notify-settings' },
      createElement('div', { className: 'dsh-my-notify-error' }, strings.loadError()),
    )
  }
  const patch = (key, value) => setDraft({ ...draft, [key]: value })
  const save = () => saveConfig(draft, setSaved, setError)
  const onVolumeChange = (v) => {
    setVolume(v)
    try {
      window.localStorage.setItem(LS.volume, String(v))
    } catch {
      // storage unavailable: volume stays in-memory for this session
    }
  }
  return renderSettingsForm(draft, patch, save, saved, error, volume, onVolumeChange, { failures })
}

/** 设置页 tab 注册（官方 slots 扩展点；服务缺省时静默跳过）。 */
function attachSettingsTab(ctx) {
  // strict=false：首屏加载时 slots 服务（由 @deepseek-ai/dsh-client-ui-renderer
  // 提供）的提供者 fiber 尚未 active，cordis 的 ctx.get(name, strict = true)
  // 在 strict 模式下会返回 undefined，注册代码会静默 return（设置页看不到
  // tab，HMR 重载后才出现）；取到实例即可——注册本身由 slots.inject 等待
  // 槽位声明，实际渲染发生在之后，安全。
  const slots = ctx.get('slots', false)
  if (slots === undefined) return
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-my-notify-settings', 'styles')
    style.textContent = SETTINGS_STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode !== null) style.parentNode.removeChild(style)
    }
  }, 'dsh-my-notify: settings styles')
  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'notify-settings',
            order: 91,
            label: () => strings.settingsTitle(),
          },
          NotifySettingsView,
        ),
      ),
    'dsh-my-notify: settings tab registration',
  )
}


    return module.exports
  },
})
