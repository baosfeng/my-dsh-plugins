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
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs 先用
 * tsconfig.client.json 把 src/client/parts/*.ts 编译成 lib/parts/*.js（无
 * import/export 的纯函数声明文本，共享 factory 作用域），再经下方 __PART_*__
 * 占位符（函数式 replaceAll，避免 $&/$1 特殊解释）拼接进 factory 作用域，写出
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

    // ── i18n 文案与本地偏好（src/client/parts/i18n.ts）──────────────────
    'use strict'
function isZh() {
  try {
    const host = (document.documentElement.lang || '').toLowerCase()
    if (host !== '') return host.startsWith('zh')
  } catch {
    void 0
  }
  try {
    return (navigator.language || 'en').toLowerCase().startsWith('zh')
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
  settingsTitle: () => (isZh() ? '通知提醒' : 'Notifications'),
  settingsSubagentEndHint: () =>
    isZh() ? '子代理完成时也弹通知（默认关闭）' : 'Also notify when a subagent finishes (off by default)',
  settingsApiToken: () => (isZh() ? '远程触发 Token' : 'Remote trigger token'),
  settingsApiTokenHint: () =>
    isZh() ? '配置后远程 hook 需携带 x-notify-token 头' : 'Remote hooks must send x-notify-token when set',
  settingsVolume: () => (isZh() ? '提示音音量' : 'Sound volume'),
  settingsVolumeHint: () => (isZh() ? '调节提示音大小（0~100%）' : 'Adjust the beep volume (0-100%)'),
  settingsQuietHoursHint: () =>
    isZh() ? '在指定时段内静默所有通知' : 'Silence all notifications during the specified time window',
  settingsQuietHoursEnabled: () => (isZh() ? '启用免打扰' : 'Enable DND'),
  settingsQuietHoursEnabledHint: () =>
    isZh() ? '开启后在指定时段内不弹通知' : 'When on, notifications are silenced during quiet hours',
  settingsWebhooksHint: () =>
    isZh() ? '事件发生时推送到企微/飞书/钉钉机器人（手机可收）' : 'Push events to WeCom/Feishu/DingTalk bots',
  webhookNamePlaceholder: () => (isZh() ? '如：企微-工作群' : 'e.g. WeCom group'),
  webhookUrl: () => (isZh() ? 'Webhook URL' : 'Webhook URL'),
  webhookUrlPlaceholder: () => (isZh() ? '机器人 webhook 地址' : 'Bot webhook URL'),
  webhookSecretPlaceholder: () => (isZh() ? '机器人签名密钥' : 'Bot signing secret'),
  webhookMsgType: () => (isZh() ? '消息类型' : 'Message type'),
  webhookTemplate: () => (isZh() ? '自定义模板（可选）' : 'Content template (optional)'),
  webhookTemplatePlaceholder: () =>
    isZh() ? '如 {title} {kind} {note} {tokens} {question} {sessionUrl} {time}' : 'e.g. {title} {kind} {note} {tokens}',
  webhookAdd: () => (isZh() ? '添加 Webhook' : 'Add webhook'),
  webhookEdit: () => (isZh() ? '编辑' : 'Edit'),
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
  viewCopy: () => (isZh() ? '文案' : 'Copy'),
  viewChannel: () => (isZh() ? '渠道' : 'Channels'),
  viewPresent: () => (isZh() ? '呈现' : 'Delivery'),
  viewSecure: () => (isZh() ? '高级' : 'Advanced'),
  evTemplates: () => (isZh() ? '事件模板' : 'Event templates'),
  eventEnabled: () => (isZh() ? '已启用' : 'Enabled'),
  eventDisabled: () => (isZh() ? '已关闭' : 'Off'),
  editorEnabled: () => (isZh() ? '发送该事件通知' : 'Notify on this event'),
  editorEnabledHint: () => (isZh() ? '关闭后仍记录投递历史，只是不弹窗、不推送' : 'History is kept; no popup or push'),
  varTree: () => (isZh() ? '变量树' : 'Variables'),
  varSearch: () => (isZh() ? '搜索变量' : 'Search variables'),
  varSearchPlaceholder: () => (isZh() ? '搜索变量，如 duration / 耗时' : 'Search e.g. duration'),
  varNoMatch: () => (isZh() ? '没有匹配的变量' : 'No matching variable'),
  varOpen: () => (isZh() ? '变量…' : 'Variables…'),
  close: () => (isZh() ? '关闭' : 'Close'),
  bandTitle: () => (isZh() ? '五形态预览' : 'Five-form preview'),
  bandHint: () =>
    isZh()
      ? '正文五处联动，「标题」进四处（企业微信无标题字段）'
      : 'Body updates all five; title reaches four (WeCom has none)',
  bandCollapse: () => (isZh() ? '折叠' : 'Collapse'),
  bandExpand: () => (isZh() ? '展开' : 'Expand'),
  bandFeishuIndependent: () => (isZh() ? '独立模板 · 设计器控制' : 'Custom template'),
  panePresent: () => (isZh() ? '呈现' : 'Delivery'),
  paneChannel: () => (isZh() ? '渠道推送' : 'Channels'),
  paneSecure: () => (isZh() ? '高级与安全' : 'Advanced'),
  navLabel: () => (isZh() ? '通知设置分区' : 'Notification settings sections'),
  panelSubtitle: () =>
    isZh()
      ? '五类事件、五个分区；文案与卡片外观都在这里改完即预览'
      : 'Five events, five sections; copy and card appearance preview live',
  resetDefaults: () => (isZh() ? '恢复默认' : 'Reset defaults'),
  dirty: () => (isZh() ? '未保存' : 'Unsaved'),
  presentHint: () =>
    isZh() ? '通知怎么送到你眼前 —— 系统通知、页面 toast、提示音、免打扰。' : 'How notices reach you.',
  systemTitle: () => (isZh() ? '系统通知' : 'System notification'),
  systemEnable: () => (isZh() ? '桌面通知' : 'Desktop notification'),
  systemEnableHint: () => (isZh() ? '窗口在后台时也弹出系统级通知' : 'Also pop a OS-level notice in background'),
  systemPersist: () => (isZh() ? '常驻通知' : 'Sticky notice'),
  systemPersistHint: () =>
    isZh()
      ? '需要浏览器「常驻」权限；未授权时降级为普通通知'
      : 'Needs the sticky permission; falls back to a normal notice',
  permGranted: () => (isZh() ? '已授权' : 'Granted'),
  permDenied: () => (isZh() ? '已拒绝' : 'Denied'),
  permDefault: () => (isZh() ? '未授权' : 'Not granted'),
  toastTitle2: () => (isZh() ? '页面 toast' : 'Page toast'),
  toastEnableHint: () => (isZh() ? '应用在前台时用 toast 代替系统通知' : 'Use a toast while the app is focused'),
  toastPosition: () => (isZh() ? '位置' : 'Position'),
  toastDuration: () => (isZh() ? '显示时长' : 'Duration'),
  toastMaxStack: () => (isZh() ? '最大堆叠' : 'Max stack'),
  toastHoverPause: () => (isZh() ? '暂停倒计时' : 'Pause the countdown'),
  posTopRight: () => (isZh() ? '右上' : 'Top right'),
  posTopLeft: () => (isZh() ? '左上' : 'Top left'),
  posBottomRight: () => (isZh() ? '右下' : 'Bottom right'),
  posBottomLeft: () => (isZh() ? '左下' : 'Bottom left'),
  posTop: () => (isZh() ? '顶部居中' : 'Top center'),
  posBottom: () => (isZh() ? '底部居中' : 'Bottom center'),
  dur3s: () => (isZh() ? '3 秒' : '3s'),
  dur5s: () => (isZh() ? '5 秒' : '5s'),
  dur8s: () => (isZh() ? '8 秒' : '8s'),
  stack1: () => (isZh() ? '1 条' : '1'),
  stack3: () => (isZh() ? '3 条' : '3'),
  stack5: () => (isZh() ? '5 条' : '5'),
  soundTitle: () => (isZh() ? '提示音' : 'Sound'),
  soundEnable: () => (isZh() ? '启用提示音' : 'Enable sound'),
  soundEnableHint: () => (isZh() ? '只在窗口可见时播放' : 'Plays only while the window is visible'),
  soundTone: () => (isZh() ? '音色' : 'Tone'),
  soundTest: () => (isZh() ? '试听' : 'Preview'),
  toneChime: () => (isZh() ? '清脆 · chime' : 'Chime'),
  toneDrop: () => (isZh() ? '柔和水滴 · drop' : 'Drop'),
  toneDeep: () => (isZh() ? '低沉提示 · deep' : 'Deep'),
  quietDedupeTitle: () => (isZh() ? '免打扰与去重' : 'DND & dedupe'),
  quietEnable: () => (isZh() ? '免打扰时段' : 'Do not disturb'),
  quietEnableHint: () => (isZh() ? '时段内只记录到侧边活动，不弹窗' : 'Silence during the window'),
  quietStart: () => (isZh() ? '开始' : 'Start'),
  quietEnd: () => (isZh() ? '结束' : 'End'),
  dedupeWindow: () => (isZh() ? '去重窗口' : 'Dedupe window'),
  dedupeWindowHint: () =>
    isZh() ? '同会话同事件在此窗口内只推一次' : 'One notice per session+event inside the window',
  ms: () => (isZh() ? '毫秒' : 'milliseconds'),
  askModeTitle: () => (isZh() ? '询问呈现' : 'Ask rendering'),
  askModeFull: () => (isZh() ? '完整问题 + 选项' : 'Full question + options'),
  askModeSummary: () => (isZh() ? '仅摘要' : 'Summary only'),
  askModeHint: () =>
    isZh()
      ? '完整模式会把问题全文与选项按钮带进通知；摘要模式只发首行，适合问题很长的会话。'
      : 'Full mode carries the whole question and option buttons; summary only sends the first line.',
  copyHint: () =>
    isZh()
      ? '每类事件独立配标题与正文；右侧五种形态改字即变。'
      : 'One template per event; the preview follows your edits.',
  copyEvent: () => (isZh() ? '事件' : 'Event'),
  evSubagentEnd: () => (isZh() ? '子代理结束' : 'Subagent end'),
  eventSubagentEnd: () => (isZh() ? '子代理结束' : 'Subagent end'),
  dzButtonDefault: () => (isZh() ? '查看会话' : 'View session'),
  retryAttemptsUsed: (n) => (isZh() ? `${n} 次尝试` : `${n} attempts`),
  sampleTitle: () => (isZh() ? '构建完成' : 'Build finished'),
  sampleBody: () => (isZh() ? '耗时 3m12s' : 'Took 3m12s'),
  sampleQuestion: () => (isZh() ? '确认部署到生产环境？' : 'Deploy to production?'),
  previewLoading: () => (isZh() ? '预览生成中…' : 'Rendering preview…'),
  previewFailed: () =>
    isZh() ? '预览生成失败：确认本地服务在运行后重试' : 'Preview failed — check the local server and retry',
  previewRetry: () => (isZh() ? '重试' : 'Retry'),
  previewEmpty: () => (isZh() ? '改标题或正文后这里会实时出现效果' : 'Edit the template to see the preview'),
  tplTitle: () => (isZh() ? '通知标题' : 'Title'),
  tplBody: () => (isZh() ? '通知正文' : 'Body'),
  varLibrary: () => (isZh() ? '变量库 · 点击插入光标处' : 'Variables · click to insert at the caret'),
  varCount: (n) => (isZh() ? `${n} 个变量` : `${n} variables`),
  varInsertDesc: () => (isZh() ? '点击插入变量' : 'Insert variable'),
  formSys: () => (isZh() ? '系统通知' : 'System'),
  formToast: () => (isZh() ? 'toast' : 'Toast'),
  formFeishu: () => (isZh() ? '飞书' : 'Feishu'),
  formWecom: () => (isZh() ? '企微' : 'WeCom'),
  formDing: () => (isZh() ? '钉钉' : 'DingTalk'),
  viewJson: () => (isZh() ? 'JSON' : 'JSON'),
  previewTip: (feishu) =>
    feishu
      ? isZh()
        ? '卡片字段 / 配色 / 按钮在「渠道推送 → 飞书」里改，这里同步。'
        : 'Card fields / accent / button are edited under Channels → Feishu.'
      : isZh()
        ? '改标题或正文，右侧立刻变；点变量插入到光标处。'
        : 'Editing the template updates the preview; click a variable to insert it.',
  channelHint: () =>
    isZh()
      ? '一个渠道一套消息类型与模板；点卡片改细节，飞书可进卡片设计器。'
      : 'One message type and template per channel.',
  channelAddNew: () => (isZh() ? '添加渠道' : 'Add channel'),
  channelEditTitle: () => (isZh() ? '编辑渠道' : 'Edit channel'),
  channelSecret: () => (isZh() ? '加签 secret' : 'Signing secret'),
  msgTypeInteractive: () => (isZh() ? 'interactive 卡片' : 'interactive card'),
  channelName: () => (isZh() ? '渠道名称' : 'Channel name'),
  channelType: () => (isZh() ? '渠道类型' : 'Channel type'),
  channelSecretHint: () => (isZh() ? '（可选，与 URL 同时配置才生效）' : '(optional, only with a URL)'),
  channelEventsSubscribe: () => (isZh() ? '订阅事件' : 'Subscribed events'),
  channelTestSend: () => (isZh() ? '测试发送' : 'Send test'),
  channelTestHint: () =>
    isZh() ? '使用上方模板与卡片配置构造一条真实请求' : 'Sends a real request built from the fields above',
  channelSave: () => (isZh() ? '保存渠道' : 'Save channel'),
  channelDelete: () => (isZh() ? '删除渠道' : 'Delete channel'),
  channelEnabled: () => (isZh() ? '已启用' : 'Enabled'),
  channelDisabled: () => (isZh() ? '已停用' : 'Disabled'),
  channelNoWebhooks: () => (isZh() ? '还没有渠道，点「添加渠道」开始' : 'No channel yet'),
  designerTitle: () => (isZh() ? '飞书卡片设计器' : 'Feishu card designer'),
  designerView: () => (isZh() ? '设计器视图' : 'Designer view'),
  dzCardTitle: () => (isZh() ? '卡片标题模板' : 'Card title template'),
  dzAccent: () => (isZh() ? '主题色' : 'Header accent'),
  dzAccentAuto: () => (isZh() ? '按事件自动' : 'Auto by event'),
  dzFields: () => (isZh() ? '显示字段' : 'Fields'),
  dzButton: () => (isZh() ? '按钮文案' : 'Button label'),
  dzMention: () => (isZh() ? '@ 提醒' : 'Mentions'),
  dzMentionAll: () => (isZh() ? '@所有人' : '@all'),
  dzPreviewLabel: () => (isZh() ? '卡片预览（飞书客户端）' : 'Card preview (Feishu client)'),
  dzMeta: (fields, accent, buttons) =>
    isZh()
      ? `${fields} 个字段 · ${accent} header · ${buttons} 个按钮`
      : `${fields} fields · ${accent} header · ${buttons} buttons`,
  retryAttempts: () => (isZh() ? '重试次数' : 'Retries'),
  secureHint: () =>
    isZh() ? '回调鉴权、站点根、远程触发、配置搬迁。' : 'Auth, base URL, remote trigger, config portability.',
  secureApiToken: () => (isZh() ? '回调 apiToken' : 'Callback apiToken'),
  secureShow: () => (isZh() ? '显示' : 'Show'),
  secureHide: () => (isZh() ? '隐藏' : 'Hide'),
  secureRegenerate: () => (isZh() ? '重新生成' : 'Regenerate'),
  secureBaseUrl: () => (isZh() ? '站点根 webBaseUrl' : 'Site root webBaseUrl'),
  secureBaseUrlHint: () => (isZh() ? '用于会话链接拼接' : 'Used to build session links'),
  secureRemoteTitle: () => (isZh() ? '远程触发测试' : 'Remote trigger test'),
  secureRemoteSample: () => (isZh() ? '样例数据（JSON）' : 'Sample payload (JSON)'),
  secureRemoteSend: () => (isZh() ? '发送测试' : 'Send'),
  secureRemoteUnsent: () => (isZh() ? '未发送' : 'Not sent yet'),
  secureRemoteSending: () => (isZh() ? '发送中…' : 'Sending…'),
  secureRemoteTimeout: () => (isZh() ? '发送超时（8s）' : 'Timed out after 8s'),
  secureRemoteOk: () => (isZh() ? '已发送' : 'Sent'),
  secureRemoteFail: () => (isZh() ? '发送失败' : 'Send failed'),
  secureExport: () => (isZh() ? '导出配置' : 'Export config'),
  secureImport: () => (isZh() ? '导入配置…' : 'Import config…'),
  permSelfCheck: () => (isZh() ? '权限与自检' : 'Permission & self-check'),
  soundAvailable: () => (isZh() ? '提示音可用（WebAudio 合成，无音频文件）' : 'Sound available (WebAudio, no asset)'),
  fieldTokens: () => (isZh() ? 'token 用量' : 'Token usage'),
  fieldDuration: () => (isZh() ? '耗时' : 'Duration'),
  fieldTool: () => (isZh() ? '工具' : 'Tool'),
  fieldQuestion: () => (isZh() ? '问题' : 'Question'),
  fieldLink: () => (isZh() ? '会话链接' : 'Session link'),
  fieldTime: () => (isZh() ? '时间' : 'Time'),
  fcardApp: () => (isZh() ? 'DeepSeek Harness · 通知' : 'DeepSeek Harness · Notice'),
  fcardMentionAll: () => (isZh() ? '@所有人' : '@all'),
  accentGreen: () => (isZh() ? '绿色' : 'Green'),
  accentBlue: () => (isZh() ? '蓝色' : 'Blue'),
  accentOrange: () => (isZh() ? '橙色' : 'Orange'),
  accentGrey: () => (isZh() ? '灰色' : 'Grey'),
  panelKicker: () => (isZh() ? '设置' : 'Settings'),
  panelTabLabel: () => (isZh() ? '通知' : 'Notifications'),
  panelTitle: () => (isZh() ? '通知' : 'Notifications'),
  panelLede: () =>
    isZh()
      ? '挑出真正值得打断你的时刻，写一句话，选择它落在哪里。'
      : 'Pick the moments worth interrupting you, write one line, choose where it lands.',
  panelMeta: (events, channels) =>
    isZh() ? `${events} 个事件 · ${channels} 个渠道` : `${events} events · ${channels} channels`,
  panelMore: () => (isZh() ? '更多设置' : 'More settings'),
  panelSave: () => (isZh() ? '保存更改' : 'Save changes'),
  panelResetCopy: () => (isZh() ? '恢复默认文案' : 'Reset copy'),
  panelEventNotify: () => (isZh() ? '发送该事件通知' : 'Notify on this event'),
  panelEventAlways: () => (isZh() ? '远程触发始终开启' : 'Remote triggers always notify'),
  panelInsert: () => (isZh() ? '插入' : 'Insert'),
  panelAllVars: () => (isZh() ? '全部变量' : 'All variables'),
  panelDelivery: () => (isZh() ? '送达' : 'Delivery'),
  panelDeliveryHint: () => (isZh() ? '点选切换；飞书点开配置' : 'Click to toggle; Feishu opens its channel'),
  panelFeishu: () => (isZh() ? '飞书' : 'Feishu'),
  panelSystem: () => (isZh() ? '系统通知' : 'System'),
  panelToast: () => (isZh() ? '页面提示' : 'Toast'),
  panelSound: () => (isZh() ? '提示音' : 'Sound'),
  panelPreview: () => (isZh() ? '飞书 · 群消息' : 'Feishu · Group message'),
  panelPreviewLive: () => (isZh() ? '即时预览' : 'Live preview'),
  panelCardColor: () => (isZh() ? '卡片颜色' : 'Card colour'),
  panelCardAuto: () => (isZh() ? '自动' : 'Auto'),
  panelCardNoChannel: () =>
    isZh()
      ? '在「更多设置 → 渠道」里添加飞书卡片后可换色。'
      : 'Add a Feishu card channel under More settings → Channels to recolour.',
  panelCardHint: () =>
    isZh()
      ? '字段 / 按钮 / @ 在「更多设置 → 渠道」里改。'
      : 'Fields, buttons and mentions live under More settings → Channels.',
  panelMoreTitle: () => (isZh() ? '更多设置' : 'More settings'),
  panelClose: () => (isZh() ? '关闭' : 'Close'),
  panelFeishuOn: () => (isZh() ? '已配置' : 'Configured'),
  panelFeishuOff: () => (isZh() ? '未配置' : 'Not configured'),
  panelSystemHint: () => (isZh() ? '窗口在后台时提醒' : 'When the window is in the background'),
  panelToastHint: () => (isZh() ? '应用在前台时轻提示' : 'A small heads-up while the app is focused'),
  panelSoundHint: () => (isZh() ? '轻柔的完成音' : 'A soft completion sound'),
  panelSubagentEnd: () => (isZh() ? '子会话结束' : 'Subagent finished'),
  panelRemote: () => (isZh() ? '远程提示' : 'Remote notice'),
  panelTemplateHint: () => (isZh() ? '未识别的变量原样保留' : 'Unknown variables stay literal'),
  panelEventDesc: (key) => {
    if (key === 'ask') return isZh() ? '我停下来等你回答时' : 'When I stop and wait for you'
    if (key === 'approval') return isZh() ? '需要你批准某个操作时' : 'When an action needs your approval'
    if (key === 'subagentEnd') return isZh() ? '子代理跑完时' : 'When a subagent finishes'
    if (key === 'remote') return isZh() ? '外部钩子触发时' : 'When an external hook fires'
    return isZh() ? '会话结束时提醒一次' : 'Once when the session ends'
  },
  panelNoVars: () => (isZh() ? '变量加载中…' : 'Loading variables…'),
  panelPreviewEmpty: () => (isZh() ? '改标题或正文，卡片会即时更新' : 'Edit the title or body and the card follows'),
}
function eventLabelOf(key) {
  if (key === 'end') return strings.eventEnd()
  if (key === 'ask') return strings.eventAsk()
  if (key === 'approval') return strings.eventApproval()
  if (key === 'subagentEnd') return strings.evSubagentEnd()
  if (key === 'remote') return strings.eventRemote()
  return key
}


    // ── 共享图标（dsh-shared/client-parts/icons.part.js，issue #54）────
    'use strict'
const LS = {
  notify: 'dsh-notify:notify',
  sound: 'dsh-notify:sound',
  toast: 'dsh-notify:toast',
  volume: 'dsh-notify:volume',
  tone: 'dsh-notify:tone',
}
function prefTone() {
  try {
    const raw = window.localStorage.getItem(LS.tone)
    if (raw === 'drop' || raw === 'deep' || raw === 'chime') return raw
  } catch {
    void 0
  }
  return 'chime'
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
function writePref(key, on) {
  try {
    window.localStorage.setItem(key, on ? '1' : '0')
  } catch {
    void 0
  }
}
function writePrefNum(key, value) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    void 0
  }
}
function prefNum(key, fallback) {
  const def = Number.isFinite(fallback) && fallback >= 0 && fallback <= 1 ? fallback : 0.6
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return def
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 0 && value <= 1) return value
  } catch {
    void 0
  }
  return def
}
function readPrefRaw(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return undefined
  }
}
function seedPref(key, on) {
  if (readPrefRaw(key) === null) writePref(key, on)
}
function seedPrefNum(key, value) {
  if (readPrefRaw(key) === null) writePrefNum(key, value)
}
function prefVolume() {
  try {
    const raw = window.localStorage.getItem(LS.volume)
    if (raw === null) return 0.6
    const v = Number(raw)
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v
  } catch {
    void 0
  }
  return 0.6
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
  // 代码图标（预览 / 代码切换的代码视图），stroke=currentColor 风格与其余图标一致。
  code: (size = 16) =>
    iconSvg(
      [
        createElement('polyline', { points: '16 18 22 12 16 6' }),
        createElement('polyline', { points: '8 6 2 12 8 18' }),
      ],
      size,
    ),
  // 下载（issue #85 新增）：箭头入托盘，mermaid 卡片导出 PNG/SVG 用，
  // stroke=currentColor 风格与其余图标一致。
  download: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
        createElement('polyline', { points: '7 10 12 15 17 10' }),
        createElement('line', { x1: 12, y1: 15, x2: 12, y2: 3 }),
      ],
      size,
    ),
  // 复制（issue #85 新增）：双层矩形，mermaid 卡片复制源码用，
  // stroke=currentColor 风格与其余图标一致。
  copy: (size = 16) =>
    iconSvg(
      [
        createElement('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
        createElement('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
      ],
      size,
    ),
  // ── 控件图标化（issue #486）：卡片工具条「文字收起、只留图标」需要每个按钮都有图标 ──
  // 全屏浮窗（四角向外），mermaid 缩放条用。
  maximize: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M8 3H5a2 2 0 0 0-2 2v3' }),
        createElement('path', { d: 'M16 3h3a2 2 0 0 1 2 2v3' }),
        createElement('path', { d: 'M21 16v3a2 2 0 0 1-2 2h-3' }),
        createElement('path', { d: 'M3 16v3a2 2 0 0 0 2 2h3' }),
      ],
      size,
    ),
  // 适应容器（「完整显示整张图」）：外框套内框，表达「内容装进可用宽度」。
  fit: (size = 16) =>
    iconSvg(
      [
        createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        createElement('rect', { x: 8, y: 8, width: 8, height: 8, rx: 1 }),
      ],
      size,
    ),
  // 适应宽度 / 铺满：两侧容器边界 + 水平双向箭头。
  fill: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M3 5v14' }),
        createElement('path', { d: 'M21 5v14' }),
        createElement('path', { d: 'M7 12h10' }),
        createElement('path', { d: 'm9 9-3 3 3 3' }),
        createElement('path', { d: 'm15 9 3 3-3 3' }),
      ],
      size,
    ),
  // 缩小：与既有 plus 同粗细的单横线。
  minus: (size = 16) => iconSvg([createElement('line', { x1: 5, y1: 12, x2: 19, y2: 12 })], size),
  // 自动换行：折行箭头（lucide wrap-text 同形），代码块换行切换用。
  wrap: (size = 16) =>
    iconSvg(
      [
        createElement('line', { x1: 3, y1: 6, x2: 21, y2: 6 }),
        createElement('path', { d: 'M3 12h15a3 3 0 1 1 0 6h-4' }),
        createElement('polyline', { points: '16 16 14 18 16 20' }),
        createElement('line', { x1: 3, y1: 18, x2: 10, y2: 18 }),
      ],
      size,
    ),
  // markdown 文本（框内 M↓）：「渲染为 Markdown」用。
  markdown: (size = 16) =>
    iconSvg(
      [
        createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        createElement('path', { d: 'M7 15V9l3 3 3-3v6' }),
        createElement('path', { d: 'M17 9v6' }),
        createElement('path', { d: 'm15 13 2 2 2-2' }),
      ],
      size,
    ),
  // 行号（左侧 gutter 短线列 + 右侧正文线）：代码块「显示 / 隐藏行号」切换用。
  lines: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M4 6h1' }),
        createElement('path', { d: 'M4 12h1' }),
        createElement('path', { d: 'M4 18h1' }),
        createElement('line', { x1: 9, y1: 6, x2: 20, y2: 6 }),
        createElement('line', { x1: 9, y1: 12, x2: 20, y2: 12 }),
        createElement('line', { x1: 9, y1: 18, x2: 20, y2: 18 }),
      ],
      size,
    ),
  // 更多（三点）：卡片工具条的「更多」菜单触发器 —— 低频按钮收进菜单，不长期霸占头部。
  more: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 5, cy: 12, r: 1.6, fill: 'currentColor', stroke: 'none' }),
        createElement('circle', { cx: 12, cy: 12, r: 1.6, fill: 'currentColor', stroke: 'none' }),
        createElement('circle', { cx: 19, cy: 12, r: 1.6, fill: 'currentColor', stroke: 'none' }),
      ],
      size,
    ),
  // 图表（柱状）：mermaid 图表卡片标题与「渲染为图表」选项用。
  chart: (size = 16) =>
    iconSvg(
      [
        createElement('line', { x1: 6, y1: 20, x2: 6, y2: 10 }),
        createElement('line', { x1: 12, y1: 20, x2: 12, y2: 4 }),
        createElement('line', { x1: 18, y1: 20, x2: 18, y2: 14 }),
      ],
      size,
    ),
  // 预览（眼睛）：视图切换的「预览」用 —— 比 file 更贴语义。
  eye: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z' }),
        createElement('circle', { cx: 12, cy: 12, r: 3 }),
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


    // ── 通知内容构造 / 系统通知（render.ts）────────────────────────────
    'use strict'
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
function fireSystemNotification(notice, sessionId, openSession) {
  try {
    const bodyText = noticeBody(notice)
    const notification = new Notification(noticeTitle(notice), {
      body: bodyText !== '' ? bodyText : kindLabel(notice.kind),
      tag: `dsh-my-notify:${notice.kind}:${sessionId}`,
      icon: faviconOf(),
      requireInteraction: systemConfigNow().requireInteraction === true,
    })
    notification.onclick = () => {
      try {
        notification.close()
      } catch {
        void 0
      }
      openSession()
    }
  } catch {
    showToast(notice, openSession)
  }
}
const STYLES = `
.dsh-my-notify-toast-box{position:fixed;right:16px;bottom:16px;z-index:3000;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.dsh-my-notify-toast-box[data-pos="bottom-left"]{right:auto;left:16px;bottom:16px;top:auto}
.dsh-my-notify-toast-box[data-pos="top-right"]{right:16px;left:auto;top:16px;bottom:auto;flex-direction:column-reverse}
.dsh-my-notify-toast-box[data-pos="top-left"]{right:auto;left:16px;top:16px;bottom:auto;flex-direction:column-reverse}
.dsh-my-notify-toast-box[data-pos="top"]{right:auto;left:50%;top:16px;bottom:auto;transform:translateX(-50%);flex-direction:column-reverse}
.dsh-my-notify-toast-box[data-pos="bottom"]{right:auto;left:50%;bottom:16px;top:auto;transform:translateX(-50%)}
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


    // ── 运行时配置（server config → localStorage 播种 / toast / 音量）──
    'use strict'
const DEFAULT_TOAST_CONFIG = { enabled: true, durationMs: 4000, position: 'bottom-right', maxStack: 3 }
const TOAST_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top', 'bottom']
const DEFAULT_SYSTEM_CONFIG = { enabled: true, requireInteraction: false }
let toastConfigCache = null
let soundEnabledCache = null
let soundVolumeCache = null
let systemConfigCache = null
let toastConfigRequested = false
function invalidateRuntimeConfig() {
  toastConfigCache = null
  soundEnabledCache = null
  soundVolumeCache = null
  systemConfigCache = null
  toastConfigRequested = false
}
function toastPositionOf(source) {
  const position = source.position
  return typeof position === 'string' && TOAST_POSITIONS.indexOf(position) >= 0
    ? position
    : DEFAULT_TOAST_CONFIG.position
}
function toastNumberIn(source, key, fallback, min) {
  const value = Number(source[key])
  if (!Number.isFinite(value) || value < min) return fallback
  return Math.round(value)
}
function toastConfigOf(config) {
  const raw = config !== null && config !== undefined ? config.toast : undefined
  const source = raw !== null && raw !== undefined && typeof raw === 'object' ? raw : {}
  return {
    enabled: source.enabled !== false,
    durationMs: Math.min(
      60_000,
      Math.max(1000, toastNumberIn(source, 'durationMs', DEFAULT_TOAST_CONFIG.durationMs, 1000)),
    ),
    position: toastPositionOf(source),
    maxStack: Math.min(10, toastNumberIn(source, 'maxStack', DEFAULT_TOAST_CONFIG.maxStack, 1)),
  }
}
function systemConfigOf(config) {
  const system = config !== null && config !== undefined ? config.system : undefined
  if (system === null || system === undefined || typeof system !== 'object') return { ...DEFAULT_SYSTEM_CONFIG }
  return {
    enabled: system.enabled !== false,
    requireInteraction: system.requireInteraction === true,
  }
}
function soundVolumeOf(config) {
  const sound = config !== null && config !== undefined ? config.sound : undefined
  const volume = sound !== null && sound !== undefined && typeof sound === 'object' ? Number(sound.volume) : Number.NaN
  return Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 0.6
}
function seedRuntimePrefs(config) {
  seedPref(LS.notify, systemConfigOf(config).enabled)
  seedPref(LS.sound, soundEnabledOf(config))
  seedPref(LS.toast, toastConfigOf(config).enabled)
  seedPrefNum(LS.volume, soundVolumeOf(config))
}
function applyRuntimeConfig(config) {
  toastConfigCache = toastConfigOf(config)
  soundEnabledCache = soundEnabledOf(config)
  soundVolumeCache = soundVolumeOf(config)
  systemConfigCache = systemConfigOf(config)
  seedRuntimePrefs(config)
}
function loadRuntimeConfig() {
  if (toastConfigRequested || toastConfigCache !== null) return
  if (typeof fetch !== 'function') return
  toastConfigRequested = true
  fetch('/notify/api/config')
    .then((res) => res.json())
    .then((body) => {
      if (body !== null && body !== undefined && body.ok === true) applyRuntimeConfig(body.value)
    })
    .catch(() => {})
}
function toastConfigNow() {
  return toastConfigCache !== null ? toastConfigCache : DEFAULT_TOAST_CONFIG
}
function soundEnabledOf(config) {
  const sound = config !== null && config !== undefined ? config.sound : undefined
  if (sound === null || sound === undefined || typeof sound !== 'object') return true
  return sound.enabled !== false
}
function soundEnabledNow() {
  return soundEnabledCache !== null ? soundEnabledCache : true
}
function soundVolumeNow() {
  return soundVolumeCache !== null ? soundVolumeCache : 0.6
}
function systemConfigNow() {
  return systemConfigCache !== null ? systemConfigCache : DEFAULT_SYSTEM_CONFIG
}


    // ── 提示音 / 页面 toast / SSE 客户端 ──────────────────────────────
    'use strict'
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
function toneSpecs(preset) {
  if (preset === 'drop') return { wave: 'sine', notes: [1040, 780], gap: 0.11, length: 0.2 }
  if (preset === 'deep') return { wave: 'triangle', notes: [320], gap: 0, length: 0.36 }
  return { wave: 'sine', notes: [880], gap: 0, length: 0.22 }
}
function beep(preset) {
  const ac = baseAudio()
  if (ac === null) return
  const resume = typeof ac.resume === 'function' ? ac.resume() : Promise.resolve()
  void Promise.resolve(resume)
    .then(() => {
      if (!prefOn(LS.sound, true)) return
      const volume = prefNum(LS.volume, soundVolumeNow())
      const spec = toneSpecs(typeof preset === 'string' && preset !== '' ? preset : prefTone())
      spec.notes.forEach((frequency, index) => {
        const t0 = ac.currentTime + index * spec.gap
        const osc = ac.createOscillator()
        const gain = ac.createGain()
        osc.type = spec.wave
        osc.frequency.value = frequency
        gain.gain.setValueAtTime(0.0001, t0)
        gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.length)
        osc.connect(gain)
        gain.connect(ac.destination)
        osc.start(t0)
        osc.stop(t0 + spec.length + 0.02)
      })
    })
    .catch(() => {})
}
function armAudioUnlock() {
  if (typeof document === 'undefined') return () => {}
  const unlock = () => {
    try {
      const ac = baseAudio()
      if (ac !== null && typeof ac.resume === 'function') void ac.resume()
    } catch {
      void 0
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

    'use strict'
function ensureToastBox() {
  let box = document.getElementById('dsh-my-notify-toast-box')
  if (box === null) {
    box = document.createElement('div')
    box.id = 'dsh-my-notify-toast-box'
    box.className = 'dsh-my-notify-toast-box'
    document.body.appendChild(box)
  }
  const config = toastConfigNow()
  box.setAttribute('data-pos', config.position)
  return box
}
function buildToastItem(notice) {
  const item = document.createElement('div')
  item.className = 'dsh-my-notify-toast'
  item.setAttribute('role', 'status')
  const head = document.createElement('div')
  head.className = 'dsh-my-notify-toast-head'
  const iconWrap = document.createElement('span')
  iconWrap.className = `dsh-my-notify-toast-icon ${kindIconClass(notice.kind)}`
  iconWrap.appendChild(elementToDom(kindIcon(notice.kind)))
  head.appendChild(iconWrap)
  const title = document.createElement('span')
  title.className = 'dsh-my-notify-toast-title'
  title.textContent = noticeTitle(notice)
  head.appendChild(title)
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'dsh-my-notify-toast-close'
  closeBtn.setAttribute('aria-label', strings.closeToast())
  closeBtn.appendChild(elementToDom(icon.close(15)))
  head.appendChild(closeBtn)
  item.appendChild(head)
  const body = document.createElement('div')
  body.className = 'dsh-my-notify-toast-body'
  const bodyText =
    (typeof notice.note === 'string' && notice.note !== '' ? notice.note : noticeBody(notice)) || kindLabel(notice.kind)
  body.textContent = bodyText
  item.appendChild(body)
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
  return item
}
function attachToastEvents(item, onOpen, durationMs) {
  const duration = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 4000
  let timer = null
  const dismiss = () => {
    if (timer !== null) clearTimeout(timer)
    if (item.parentNode === null) return
    item.classList.add('dsh-my-notify-toast-out')
    setTimeout(() => {
      if (item.parentNode !== null) item.parentNode.removeChild(item)
    }, 150)
  }
  item.addEventListener('click', (event) => {
    if (event !== null && event.stopPropagation) event.stopPropagation()
    dismiss()
    try {
      onOpen()
    } catch {
      void 0
    }
  })
  const closeBtn = item.querySelector('.dsh-my-notify-toast-close')
  if (closeBtn !== null) {
    closeBtn.addEventListener('click', (event) => {
      if (event !== null && event.stopPropagation) event.stopPropagation()
      if (event !== null && event.preventDefault) event.preventDefault()
      dismiss()
    })
  }
  const openBtn = item.querySelector('.dsh-my-notify-toast-open')
  if (openBtn !== null) {
    openBtn.addEventListener('click', (event) => {
      if (event !== null && event.stopPropagation) event.stopPropagation()
      if (event !== null && event.preventDefault) event.preventDefault()
      dismiss()
      try {
        onOpen()
      } catch {
        void 0
      }
    })
  }
  timer = setTimeout(dismiss, duration)
}
function showToast(notice, onOpen) {
  if (typeof document === 'undefined') return
  loadRuntimeConfig()
  const config = toastConfigNow()
  if (!prefOn(LS.toast, true)) return
  if (config.enabled === false) return
  const box = ensureToastBox()
  const item = buildToastItem(notice)
  attachToastEvents(item, onOpen, config.durationMs)
  box.appendChild(item)
  let guard = 0
  while (box.children.length > config.maxStack && box.children.length > 0 && guard < 20) {
    box.removeChild(box.firstChild)
    guard += 1
  }
}
function removeToastBox() {
  try {
    const box = document.getElementById('dsh-my-notify-toast-box')
    if (box !== null && box.parentNode !== null) box.parentNode.removeChild(box)
  } catch {
    void 0
  }
}

    'use strict'
function isNoticeKind(kind) {
  return kind === 'end' || kind === 'ask' || kind === 'approval' || kind === 'remote'
}
const CLIENT_DEDUPE_MS = 2000
const DEDUPE_LS_PREFIX = 'dsh-notify:dedupe:'
const localRecent = new Map()
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
    void 0
  }
  localRecent.set(key, now)
  if (localRecent.size > 256) {
    for (const [k, t] of localRecent) {
      if (now - t >= CLIENT_DEDUPE_MS) localRecent.delete(k)
    }
  }
  return true
}
function claimNotice(key) {
  const now = Date.now()
  const lastLocal = localRecent.get(key)
  if (lastLocal !== undefined && now - lastLocal < CLIENT_DEDUPE_MS) return Promise.resolve(false)
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks !== undefined && locks !== null && typeof locks.request === 'function') {
    return locks.request(DEDUPE_LS_PREFIX + key, () => claimLocked(key, Date.now()))
  }
  return Promise.resolve(claimLocked(key, now))
}
function openSessionFor(sessionId, sessionsSvc) {
  return () => {
    try {
      window.focus()
    } catch {
      void 0
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
        void 0
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
    if (!claimed) return
    const openSession = openSessionFor(sessionId, sessionsSvc)
    dispatchByPermission(notice, sessionId, openSession)
    if (prefOn(LS.sound, true)) beep()
  })
}
function subscribeStream(sessionsSvc) {
  if (typeof window === 'undefined' || typeof EventSource !== 'function') return () => {}
  loadRuntimeConfig()
  const source = new EventSource('/notify/api/stream')
  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      void handleNotice(data, sessionsSvc)
    } catch {
      void 0
    }
  }
  return () => {
    source.close()
    removeToastBox()
  }
}
exports.apply = function apply(ctx) {
  const sessionsSvc = ctx.get('sessions', false)
  ctx.effect(() => injectStyles(), 'dsh-my-notify: styles')
  ctx.effect(() => armAudioUnlock(), 'dsh-my-notify: audio unlock')
  ctx.effect(() => subscribeStream(sessionsSvc), 'dsh-my-notify: event stream')
  attachSettingsTab(ctx)
}


    // ── 飞书卡片渲染 + 文案数据模型（纯逻辑）──────────────────────────
    'use strict'
const CARD_PREVIEW_STYLES = `
.dsh-my-notify-fcard{--fcard-bg:#ffffff;--fcard-fg:#1f2329;--fcard-fg2:#646a73;--fcard-line:#e8e3d9;--fcard-btn:#2c62e0;--fcard-accent:#3f4448;width:100%;max-width:none;background:var(--fcard-bg);color:var(--fcard-fg);border:1px solid var(--fcard-line);border-radius:14px;overflow:hidden;box-shadow:0 14px 34px rgba(35,31,24,.07),0 2px 6px rgba(35,31,24,.04);font:var(--dsw-font-xxs-12);line-height:1.6}
.dsh-my-notify-fcard[data-accent="green"]{--fcard-accent:#33544a}
.dsh-my-notify-fcard[data-accent="blue"]{--fcard-accent:#2f5570}
.dsh-my-notify-fcard[data-accent="wathet"]{--fcard-accent:#3f657e}
.dsh-my-notify-fcard[data-accent="turquoise"]{--fcard-accent:#2c6660}
.dsh-my-notify-fcard[data-accent="yellow"]{--fcard-accent:#736224}
.dsh-my-notify-fcard[data-accent="orange"]{--fcard-accent:#7a4f2e}
.dsh-my-notify-fcard[data-accent="red"]{--fcard-accent:#7d3b36}
.dsh-my-notify-fcard[data-accent="carmine"]{--fcard-accent:#77384c}
.dsh-my-notify-fcard[data-accent="violet"]{--fcard-accent:#55416b}
.dsh-my-notify-fcard[data-accent="purple"]{--fcard-accent:#5a3f68}
.dsh-my-notify-fcard[data-accent="indigo"]{--fcard-accent:#3d4770}
.dsh-my-notify-fcard[data-accent="grey"]{--fcard-accent:#3f4448}
.dsh-my-notify-fcard[data-accent="default"]{--fcard-accent:#3c3c39}
.dsh-my-notify-fcard-hd{display:flex;flex-direction:column;gap:4px;padding:14px 16px 13px;background:var(--fcard-accent)}
.dsh-my-notify-fcard-app{color:rgba(255,255,255,.72);font:var(--dsw-font-xxs-12);letter-spacing:.04em}
.dsh-my-notify-fcard-title{color:#fff;font:var(--dsw-font-s-strong-14);line-height:1.5;word-break:break-word}
.dsh-my-notify-fcard-bd{display:flex;flex-direction:column;gap:10px;padding:14px 16px}
.dsh-my-notify-fcard-p{color:var(--fcard-fg);font:var(--dsw-font-xs-13);line-height:1.65;word-break:break-word}
.dsh-my-notify-fcard-p strong{font-weight:600}
.dsh-my-notify-fcard-at{color:var(--fcard-btn);margin-right:4px}
.dsh-my-notify-fcard-fields{display:grid;grid-template-columns:1fr;gap:6px;padding-top:10px;border-top:1px solid #f0ece4}
.dsh-my-notify-fcard-field{display:flex;align-items:baseline;gap:12px;min-width:0}
.dsh-my-notify-fcard-field-label{flex:none;width:56px;color:var(--fcard-fg2);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-fcard-field-value{color:#43403a;font:var(--dsw-font-xxs-12);word-break:break-word}
.dsh-my-notify-fcard-acts{display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding-top:10px;border-top:1px solid #f0ece4}
.dsh-my-notify-fcard-btn{color:var(--fcard-accent);font:var(--dsw-font-xxs-strong-12);cursor:default}
.dsh-my-notify-fcard-btn[data-primary="true"]{font:var(--dsw-font-xxs-strong-12)}
.dsh-my-notify-fcard-note{color:var(--fcard-fg2);font:var(--dsw-font-xxxs-11);line-height:1.6}
.dsh-my-notify-fcard-hr{height:1px;background:#f0ece4}
`
const CARD_PALETTE = {
  '--fcard-bg': '#ffffff',
  '--fcard-fg': '#1f2329',
  '--fcard-fg2': '#646a73',
  '--fcard-line': '#dee0e3',
  '--fcard-btn': '#2c62e0',
}
const CARD_COLORS = [
  'blue',
  'wathet',
  'turquoise',
  'green',
  'yellow',
  'orange',
  'red',
  'carmine',
  'violet',
  'purple',
  'indigo',
  'grey',
  'default',
]
const CARD_ACCENTS = [
  { value: 'green', label: () => strings.accentGreen() },
  { value: 'blue', label: () => strings.accentBlue() },
  { value: 'orange', label: () => strings.accentOrange() },
  { value: 'grey', label: () => strings.accentGrey() },
]
const CARD_FIELD_OPTIONS = [
  { value: 'tokens.text', label: () => strings.fieldTokens() },
  { value: 'session.durationText', label: () => strings.fieldDuration() },
  { value: 'tool.name', label: () => strings.fieldTool() },
  { value: 'ask.question', label: () => strings.fieldQuestion() },
  { value: 'session.url', label: () => strings.fieldLink() },
  { value: 'event.time', label: () => strings.fieldTime() },
]
function cardFieldLabel(name) {
  const option = CARD_FIELD_OPTIONS.find((o) => o.value === name)
  return option !== undefined ? option.label() : name
}
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
function cardAccentOf(card) {
  const template = card !== null && typeof card === 'object' ? card.header?.template : undefined
  return typeof template === 'string' && CARD_COLORS.includes(template) ? template : 'grey'
}
function cardTitleOf(card) {
  const title = card !== null && typeof card === 'object' ? card.header?.title?.content : undefined
  return typeof title === 'string' ? title : ''
}
function cardElementsOf(card) {
  if (card === null || typeof card !== 'object') return []
  const list = Array.isArray(card.body?.elements) ? card.body.elements : card.elements
  return Array.isArray(list) ? list : []
}
function larkMdHtml(text) {
  const safe = escapeHtml(text)
  const withAt = safe.replace(
    /&lt;at id=([\w-]+)&gt;&lt;\/at&gt;/g,
    (_m, id) => `<span class="dsh-my-notify-fcard-at">@${id === 'all' ? strings.fcardMentionAll() : id}</span>`,
  )
  return withAt.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
}
function cardFieldHtml(text) {
  const raw = typeof text?.content === 'string' ? text.content : ''
  const match = /^\*\*([^*]+)\*\*[：:]?\s*([\s\S]*)$/.exec(raw)
  const label = match !== null ? match[1] : ''
  const value = match !== null ? match[2] : raw
  const labelHtml = label !== '' ? `<span class="dsh-my-notify-fcard-field-label">${escapeHtml(label)}</span>` : ''
  return `<div class="dsh-my-notify-fcard-field">${labelHtml}<span class="dsh-my-notify-fcard-field-value">${escapeHtml(value)}</span></div>`
}
function cardDivHtml(element) {
  if (Array.isArray(element.fields) && element.fields.length > 0) {
    const cells = element.fields.map((field) => cardFieldHtml(field?.text)).join('')
    return `<div class="dsh-my-notify-fcard-fields">${cells}</div>`
  }
  const content = element.text?.content
  if (typeof content !== 'string' || content === '') return ''
  return `<div class="dsh-my-notify-fcard-p">${larkMdHtml(content)}</div>`
}
function cardActionHtml(element) {
  const actions = Array.isArray(element.actions) ? element.actions : []
  const buttons = actions
    .map((action) => {
      const label = typeof action?.text?.content === 'string' ? action.text.content : ''
      if (label === '') return ''
      const primary = action.type === 'primary' ? 'true' : 'false'
      return `<span class="dsh-my-notify-fcard-btn" data-primary="${primary}">${escapeHtml(label)} →</span>`
    })
    .join('')
  return buttons === '' ? '' : `<div class="dsh-my-notify-fcard-acts">${buttons}</div>`
}
function cardNoteHtml(element) {
  const parts = Array.isArray(element.elements) ? element.elements : []
  const text = parts
    .map((part) => (typeof part?.content === 'string' ? part.content : ''))
    .filter((part) => part !== '')
    .join(' · ')
  return text === '' ? '' : `<div class="dsh-my-notify-fcard-note">${escapeHtml(text)}</div>`
}
function cardElementHtml(element) {
  if (element === null || typeof element !== 'object') return ''
  if (element.tag === 'div') return cardDivHtml(element)
  if (element.tag === 'action') return cardActionHtml(element)
  if (element.tag === 'note') return cardNoteHtml(element)
  if (element.tag === 'hr') return '<div class="dsh-my-notify-fcard-hr"></div>'
  return ''
}
function renderFeishuCardHtml(card) {
  const accent = cardAccentOf(card)
  const title = cardTitleOf(card)
  const body = cardElementsOf(card)
    .map((element) => cardElementHtml(element))
    .filter((html) => html !== '')
    .join('')
  const titleHtml = title !== '' ? `<div class="dsh-my-notify-fcard-title">${escapeHtml(title)}</div>` : ''
  return (
    `<div class="dsh-my-notify-fcard" data-accent="${accent}" role="img" aria-label="${escapeHtml(title)}">` +
    `<div class="dsh-my-notify-fcard-hd"><span class="dsh-my-notify-fcard-app">${escapeHtml(strings.fcardApp())}</span>` +
    titleHtml +
    `</div><div class="dsh-my-notify-fcard-bd">${body}</div></div>`
  )
}
function cardMetaOf(card) {
  const elements = cardElementsOf(card)
  let fields = 0
  let buttons = 0
  for (const element of elements) {
    if (element?.tag === 'div' && Array.isArray(element.fields)) fields += element.fields.length
    if (element?.tag === 'action' && Array.isArray(element.actions)) buttons += element.actions.length
  }
  const accentOption = CARD_ACCENTS.find((option) => option.value === cardAccentOf(card))
  const accentLabel = accentOption !== undefined ? accentOption.label() : cardAccentOf(card)
  return strings.dzMeta(fields, accentLabel, buttons)
}

    'use strict'
const EVENT_KEYS = ['end', 'ask', 'approval', 'subagentEnd', 'remote']
function eventDotOf(key) {
  if (key === 'end') return 'ok'
  if (key === 'ask') return 'warn'
  if (key === 'approval') return 'err'
  return ''
}
function defaultMessages() {
  const base = (body) => ({ title: '{{session.title}}', body })
  return {
    end: base('{{event.note}}'),
    ask: base('{{ask.summary}}'),
    approval: base('{{approval.reason}}'),
    subagentEnd: base('{{event.note}}'),
    remote: base('{{event.note}}'),
  }
}
function messageOf(messages, key) {
  const defaults = defaultMessages()
  const fallback = defaults[key] ?? defaults.end
  const item = messages !== undefined && messages !== null ? messages[key] : undefined
  if (item === null || typeof item !== 'object') return { title: fallback.title, body: fallback.body }
  return {
    title: typeof item.title === 'string' && item.title !== '' ? item.title : fallback.title,
    body: typeof item.body === 'string' && item.body !== '' ? item.body : fallback.body,
  }
}
function previewPayload(kind, messages, card, channel) {
  const template = messageOf(messages, kind)
  const payload = {
    kind,
    channel: typeof channel === 'string' && channel !== '' ? channel : 'feishu',
    titleTemplate: template.title,
    bodyTemplate: template.body,
  }
  if (card !== undefined && card !== null) payload.card = card
  return payload
}
function requestPreview(payload) {
  if (typeof fetch !== 'function') return Promise.resolve(null)
  return fetch('/notify/api/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => res.json())
    .then((body) => (body !== null && body !== undefined && body.ok === true ? body.value : null))
    .catch(() => null)
}
function createPreviewScheduler(run, delayMs) {
  const delay = typeof delayMs === 'number' && Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 300
  let timer = null
  return {
    schedule(payload) {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        run(payload)
      }, delay)
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
function optionLabelOf(options, value) {
  const hit = options.find((option) => option.value === value)
  return hit !== undefined ? hit.label() : value
}
function previewNoticeOf(status) {
  if (status === 'error') return { text: strings.previewFailed(), retry: true, kind: 'error' }
  if (status === 'loading') return { text: strings.previewLoading(), retry: false, kind: 'status' }
  if (status === 'ready') return { text: '', retry: false, kind: 'none' }
  return { text: strings.previewEmpty(), retry: false, kind: 'status' }
}
function previewFormOptions() {
  return [
    { value: 'sys', label: () => strings.formSys() },
    { value: 'toast', label: () => strings.formToast() },
    { value: 'feishu', label: () => strings.formFeishu() },
    { value: 'wecom', label: () => strings.formWecom() },
    { value: 'ding', label: () => strings.formDing() },
  ]
}
function plainTextOf(text) {
  return String(text ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
}
function renderPreviewFrame(form, preview) {
  if (preview === null) return ''
  const title = cardTitleOf(preview.card)
  const text = typeof preview.text === 'string' ? preview.text : ''
  if (form === 'feishu') return renderFeishuCardHtml(preview.card)
  const time = preview.vars !== undefined && preview.vars.time !== undefined ? preview.vars.time : ''
  if (form === 'sys') {
    return (
      '<div class="dsh-my-notify-pv-sys"><span class="dsh-my-notify-pv-sys-ico">D</span>' +
      '<div><div class="dsh-my-notify-pv-sys-title">' +
      escapeHtml(title) +
      '</div><div class="dsh-my-notify-pv-sys-body">' +
      escapeHtml(plainTextOf(text)) +
      '</div></div><span class="dsh-my-notify-pv-sys-time">' +
      escapeHtml(time) +
      '</span></div>'
    )
  }
  if (form === 'toast') {
    return (
      '<div class="dsh-my-notify-pv-toast"><span class="dsh-my-notify-pv-toast-bar"></span>' +
      '<div><div class="dsh-my-notify-pv-sys-title">' +
      escapeHtml(title) +
      '</div><div class="dsh-my-notify-pv-sys-body">' +
      escapeHtml(plainTextOf(text)) +
      '</div></div></div>'
    )
  }
  const brand = form === 'wecom' ? 'wecom' : 'ding'
  const label = brand === 'wecom' ? strings.channelWecom() : strings.channelDingtalk()
  return (
    '<div class="dsh-my-notify-pv-wx" data-brand="' +
    brand +
    '">' +
    '<div class="dsh-my-notify-pv-wx-hd"><i></i>' +
    escapeHtml(label) +
    '</div><div class="dsh-my-notify-pv-wx-bd">' +
    escapeHtml(plainTextOf(text)) +
    '</div></div>'
  )
}


    // ── 文案工作台（事件列表 / 编辑器 / 变量树 / 预览带）───────────────
    'use strict'
function varToken(name) {
  return '{{' + name + '}}'
}
function insertVar(text, caret, name) {
  const source = typeof text === 'string' ? text : ''
  const token = varToken(name)
  const at = Number.isFinite(caret) ? Math.min(Math.max(0, Math.trunc(caret)), source.length) : source.length
  return { value: source.slice(0, at) + token + source.slice(at), caret: at + token.length }
}
function normalizeVarItem(item) {
  if (item === null || typeof item !== 'object') return null
  const raw = item
  const name = typeof raw.name === 'string' ? raw.name : ''
  if (name === '') return null
  const description =
    typeof raw.description === 'string' ? raw.description : typeof raw.desc === 'string' ? raw.desc : name
  const example = typeof raw.example === 'string' ? raw.example : typeof raw.sample === 'string' ? raw.sample : ''
  return { name, description, example }
}
function normalizeVarGroup(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const group = raw
  const rawItems = Array.isArray(group.items) ? group.items : Array.isArray(group.vars) ? group.vars : []
  const items = rawItems.map(normalizeVarItem).filter((item) => item !== null)
  if (items.length === 0) return null
  return {
    group: typeof group.group === 'string' ? group.group : typeof group.name === 'string' ? group.name : '',
    label: typeof group.label === 'string' ? group.label : '',
    items,
  }
}
function normalizeVarGroups(value) {
  const source = value
  const list = Array.isArray(value) ? value : source !== null && source !== undefined ? source.groups : undefined
  if (!Array.isArray(list)) return []
  return list.map(normalizeVarGroup).filter((item) => item !== null)
}
function varCountOf(groups) {
  return groups.reduce((sum, group) => sum + group.items.length, 0)
}
function VariableLibrary(props) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-vars', role: 'group', 'aria-label': strings.varLibrary() },
    props.groups.map((group) =>
      createElement(
        'div',
        { key: group.group, className: 'dsh-my-notify-vargroup' },
        createElement('div', { className: 'dsh-my-notify-vargroup-title' }, group.label),
        createElement(
          'div',
          { className: 'dsh-my-notify-varlist' },
          group.items.map((item) =>
            createElement(
              'button',
              {
                key: item.name,
                type: 'button',
                className: 'dsh-my-notify-vitem',
                title: item.example !== '' ? item.description + ' · ' + item.example : item.description,
                'aria-label': strings.varInsertDesc() + ' ' + item.name,
                onClick: () => props.onInsert(item.name),
              },
              item.name,
              createElement('em', null, item.description),
            ),
          ),
        ),
      ),
    ),
  )
}
function templateEditor(ctx) {
  const { active, template, resetTemplate, insert, groups, patch, setTarget, setCaret } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-editor' },
    { className: 'dsh-my-notify-editor' },
    createElement(
      'div',
      { className: 'dsh-my-notify-editor-hd' },
      createElement('b', null, eventLabelOf(active)),
      createElement('span', { className: 'dsh-my-notify-badge' }, active),
      createElement('span', { className: 'dsh-my-notify-grow' }),
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-notify-btn', onClick: resetTemplate },
        strings.resetDefaults(),
      ),
    ),
    createElement(
      'label',
      { className: 'dsh-my-notify-field' },
      createElement(
        'span',
        { className: 'dsh-my-notify-field-label' },
        strings.tplTitle(),
        createElement('span', { className: 'dsh-my-notify-field-count' }, template.title.length + ' / 52'),
      ),
      createElement('input', {
        className: 'dsh-my-notify-input-full',
        value: template.title,
        'aria-label': strings.tplTitle(),
        onFocus: () => setTarget('title'),
        onChange: (event) => {
          setTarget('title')
          setCaret(event.target.selectionStart ?? event.target.value.length)
          patch({ title: event.target.value, body: template.body })
        },
      }),
    ),
    createElement(
      'label',
      { className: 'dsh-my-notify-field' },
      createElement(
        'span',
        { className: 'dsh-my-notify-field-label' },
        strings.tplBody(),
        createElement('span', { className: 'dsh-my-notify-field-count' }, template.body.length + ' / 180'),
      ),
      createElement('textarea', {
        className: 'dsh-my-notify-textarea',
        value: template.body,
        'aria-label': strings.tplBody(),
        onFocus: () => setTarget('body'),
        onChange: (event) => {
          setTarget('body')
          setCaret(event.target.selectionStart ?? event.target.value.length)
          patch({ title: template.title, body: event.target.value })
        },
      }),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-field-label' },
      strings.varLibrary(),
      createElement('span', { className: 'dsh-my-notify-field-count' }, strings.varCount(varCountOf(groups))),
    ),
    createElement(VariableLibrary, { groups, onInsert: insert }),
  )
}

    'use strict'
function varHintOf(item) {
  const example = item.example !== '' ? ' · 例：' + item.example : ''
  return item.name + ' — ' + item.description + example
}
function filterVarGroups(groups, query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
  if (q === '') return groups
  const out = []
  for (const group of groups) {
    const items = group.items.filter(
      (item) => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
    )
    if (items.length > 0) out.push({ group: group.group, label: group.label, items })
  }
  return out
}
function variableTreeBody(props) {
  const [query, setQuery] = useState('')
  const visible = filterVarGroups(props.groups, query)
  return [
    createElement('input', {
      className: 'dsh-my-notify-varq',
      value: query,
      placeholder: strings.varSearchPlaceholder(),
      'aria-label': strings.varSearch(),
      onChange: (event) => setQuery(event.target.value),
    }),
    visible.length === 0
      ? createElement('div', { className: 'dsh-my-notify-hint' }, strings.varNoMatch())
      : visible.map((group) =>
          createElement(
            'div',
            { key: group.group, className: 'dsh-my-notify-vgroup' },
            createElement('div', { className: 'dsh-my-notify-vgroup-hd' }, group.label),
            createElement(
              'div',
              { className: 'dsh-my-notify-vlist' },
              group.items.map((item) =>
                createElement(
                  'button',
                  {
                    key: item.name,
                    type: 'button',
                    className: 'dsh-my-notify-vchip',
                    title: varHintOf(item),
                    'aria-label': strings.varInsertDesc() + ' ' + item.name,
                    onClick: () => props.onInsert(item.name),
                  },
                  createElement('span', { className: 'dsh-my-notify-vname' }, item.name),
                  createElement('em', { className: 'dsh-my-notify-vdesc' }, item.description),
                ),
              ),
            ),
          ),
        ),
  ]
}
function VariableTree(props) {
  return createElement(
    'aside',
    { className: 'dsh-my-notify-col dsh-my-notify-col-vars', 'aria-label': strings.varTree() },
    createElement('div', { className: 'dsh-my-notify-col-hd' }, strings.varTree()),
    createElement('div', { className: 'dsh-my-notify-vars' }, variableTreeBody(props)),
  )
}
function VarDrawer(props) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-drawer-vars', role: 'dialog', 'aria-label': strings.varTree() },
    createElement(
      'div',
      { className: 'dsh-my-notify-ed-hd' },
      createElement('b', null, strings.varTree()),
      createElement('span', { className: 'dsh-my-notify-grow' }),
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onClose },
        strings.close(),
      ),
    ),
    createElement('div', { className: 'dsh-my-notify-vars' }, variableTreeBody(props)),
  )
}

    'use strict'
function EventList(props) {
  return createElement(
    'nav',
    { className: 'dsh-my-notify-col dsh-my-notify-col-evlist', 'aria-label': strings.copyEvent() },
    createElement('div', { className: 'dsh-my-notify-col-hd' }, strings.evTemplates()),
    createElement(
      'div',
      { className: 'dsh-my-notify-evlist', role: 'tablist', 'aria-label': strings.copyEvent() },
      EVENT_KEYS.map((key) =>
        createElement(
          'button',
          {
            key,
            type: 'button',
            className: 'dsh-my-notify-evbtn',
            role: 'tab',
            'aria-current': String(key === props.active),
            onClick: () => props.onPick(key),
          },
          createElement('span', { className: 'dsh-my-notify-evd', 'data-kind': eventDotOf(key) }),
          createElement(
            'span',
            null,
            createElement('span', { className: 'dsh-my-notify-evname' }, eventLabelOf(key)),
            createElement(
              'span',
              { className: 'dsh-my-notify-evmeta' },
              props.enabledOf(key) ? strings.eventEnabled() : strings.eventDisabled(),
            ),
          ),
        ),
      ),
    ),
  )
}
function EventSelect(props) {
  return createElement(
    'select',
    {
      className: 'dsh-my-notify-evselect',
      value: props.active,
      'aria-label': strings.copyEvent(),
      onChange: (event) => props.onPick(event.target.value),
    },
    EVENT_KEYS.map((key) => createElement('option', { key, value: key }, eventLabelOf(key))),
  )
}

    'use strict'
const BAND_FORMS = ['sys', 'toast', 'feishu', 'wecom', 'ding']
function bandFormLabel(form) {
  if (form === 'sys') return strings.formSys()
  if (form === 'toast') return strings.formToast()
  if (form === 'feishu') return strings.formFeishu()
  if (form === 'wecom') return strings.formWecom()
  return strings.formDing()
}
function bandColumn(props) {
  const html = props.preview !== null ? renderPreviewFrame(props.form, props.preview) : ''
  return createElement(
    'div',
    { className: 'dsh-my-notify-pcol' },
    createElement('div', { className: 'dsh-my-notify-pcol-hd' }, bandFormLabel(props.form)),
    createElement(
      'div',
      { className: 'dsh-my-notify-pstage' },
      html !== ''
        ? createElement('div', { dangerouslySetInnerHTML: { __html: html } })
        : createElement('span', { className: 'dsh-my-notify-status' }, props.title),
    ),
  )
}
function PreviewBand(props) {
  return createElement(
    'section',
    { className: 'dsh-my-notify-band', 'data-open': String(props.open), 'aria-label': strings.bandTitle() },
    createElement(
      'div',
      { className: 'dsh-my-notify-band-hd' },
      createElement('b', { className: 'dsh-my-notify-label' }, strings.bandTitle()),
      createElement('span', { className: 'dsh-my-notify-hint' }, strings.bandHint()),
      props.feishuIndependent
        ? createElement(
            'span',
            { className: 'dsh-my-notify-badge', 'data-kind': 'accent' },
            strings.bandFeishuIndependent(),
          )
        : null,
      createElement('span', { className: 'dsh-my-notify-grow' }),
      props.status !== 'ready'
        ? createElement(
            'span',
            { className: props.notice.kind === 'error' ? 'dsh-my-notify-error' : 'dsh-my-notify-status' },
            props.notice.text,
          )
        : null,
      props.notice.retry
        ? createElement(
            'button',
            { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onRetry },
            strings.previewRetry(),
          )
        : null,
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-notify-btn',
          'aria-expanded': String(props.open),
          onClick: props.onToggle,
        },
        props.open ? strings.bandCollapse() : strings.bandExpand(),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-band-cols' },
      BAND_FORMS.map((form) => bandColumn({ form, preview: props.preview, title: props.title })),
    ),
  )
}

    'use strict'
function useVariables(setGroups) {
  useEffect(() => {
    if (typeof fetch !== 'function') return
    fetch('/notify/api/variables')
      .then((res) => res.json())
      .then((body) => {
        if (body !== null && body !== undefined && body.ok === true) setGroups(normalizeVarGroups(body.value))
      })
      .catch(() => {})
  }, [])
}
function usePreview(props, active, template, attempt, setPreview, setStatus) {
  useEffect(() => {
    setStatus('loading')
    const scheduler = createPreviewScheduler((payload) => {
      void requestPreview(payload).then((value) => {
        setPreview(value)
        setStatus(value === null ? 'error' : 'ready')
      })
    }, 300)
    scheduler.schedule(previewPayload(active, props.messages, props.card))
    return () => scheduler.cancel()
  }, [active, template.title, template.body, props.card, attempt])
}
function makeInsert(props, active, template, target, caret, setCaret) {
  return (name) => {
    const field = target === 'title' ? template.title : template.body
    const next = insertVar(field, caret, name)
    props.onPatchMessage(
      active,
      target === 'title' ? { title: next.value, body: template.body } : { title: template.title, body: next.value },
    )
    setCaret(next.caret)
  }
}
function askModeControl(props) {
  const options = [
    { value: 'full', label: () => strings.askModeFull() },
    { value: 'summary', label: () => strings.askModeSummary() },
  ]
  return createElement(
    'div',
    { className: 'dsh-my-notify-ed', 'data-role': 'ask-mode' },
    createElement(
      'div',
      { className: 'dsh-my-notify-lbl' },
      createElement('span', null, strings.askModeTitle()),
      createElement('span', null, props.askMode),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-segmented', role: 'tablist', 'aria-label': strings.askModeTitle() },
      options.map((option) =>
        createElement(
          'button',
          {
            key: option.value,
            type: 'button',
            className: 'dsh-my-notify-seg',
            role: 'tab',
            'aria-selected': String(option.value === props.askMode),
            onClick: () => props.onChange(option.value),
          },
          option.label(),
        ),
      ),
    ),
    createElement('div', { className: 'dsh-my-notify-hint' }, strings.askModeHint()),
  )
}
function copyEditorColumn(props) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-col' },
    createElement(
      'div',
      { className: 'dsh-my-notify-ed' },
      createElement(
        'div',
        { className: 'dsh-my-notify-ed-hd' },
        createElement('h2', null, eventLabelOf(props.active)),
        createElement('span', { className: 'dsh-my-notify-badge' }, props.active),
        createElement('span', { className: 'dsh-my-notify-grow' }),
        createElement(
          'button',
          { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onOpenVars },
          strings.varOpen(),
        ),
        createElement(
          'button',
          { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onReset },
          strings.resetDefaults(),
        ),
      ),
      createElement(SwitchRow, {
        label: strings.editorEnabled(),
        hint: strings.editorEnabledHint(),
        on: props.enabled,
        onChange: props.onToggle,
      }),
      props.active === 'ask' ? askModeControl({ askMode: props.askMode, onChange: props.onAskMode }) : null,
      copyEditorFields(props),
      createElement('div', { className: 'dsh-my-notify-hint' }, strings.varCount(props.varCount)),
      props.saveError
        ? createElement(
            'div',
            { className: 'dsh-my-notify-errbox', role: 'alert' },
            createElement('span', null, strings.saveFailed()),
            createElement(
              'button',
              { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onRetrySave },
              strings.previewRetry(),
            ),
          )
        : null,
    ),
  )
}
function CopyEditorPane(props) {
  const [active, setActive] = useState('end')
  const [groups, setGroups] = useState([])
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState('idle')
  const [attempt, setAttempt] = useState(0)
  const [bandOpen, setBandOpen] = useState(true)
  const [varsOpen, setVarsOpen] = useState(false)
  const [target, setTarget] = useState('body')
  const [caret, setCaret] = useState(0)
  const template = messageOf(props.messages, active)
  useVariables(setGroups)
  usePreview(props, active, template, attempt, setPreview, setStatus)
  const insert = makeInsert(props, active, template, target, caret, setCaret)
  const notice = previewNoticeOf(status)
  const groupsTotal = varCountOf(groups)
  return createElement(
    'div',
    { className: 'dsh-my-notify-wb' },
    createElement(
      'div',
      { className: 'dsh-my-notify-cols' },
      createElement(EventList, {
        active,
        onPick: (key) => {
          setActive(key)
          setCaret(0)
        },
        enabledOf: props.enabledOf,
      }),
      copyEditorColumn({
        active,
        template,
        enabled: props.enabledOf(active),
        onToggle: (on) => props.onToggleEvent(active, on),
        onReset: () => props.onPatchMessage(active, defaultMessageFor(active)),
        onTitle: (v, at) => {
          setTarget('title')
          setCaret(at)
          props.onPatchMessage(active, { title: v, body: template.body })
        },
        onBody: (v, at) => {
          setTarget('body')
          setCaret(at)
          props.onPatchMessage(active, { title: template.title, body: v })
        },
        askMode: props.askMode ?? 'full',
        onAskMode: (v) => props.onAskMode?.(v),
        onOpenVars: () => setVarsOpen(!varsOpen),
        varCount: groupsTotal,
        saveError: props.saveError === true,
        onRetrySave: props.onRetrySave ?? (() => {}),
      }),
      createElement(VariableTree, { groups, onInsert: insert }),
      varsOpen ? createElement(VarDrawer, { groups, onInsert: insert, onClose: () => setVarsOpen(false) }) : null,
    ),
    createElement(PreviewBand, {
      preview,
      status,
      notice,
      attempt,
      onRetry: () => setAttempt(attempt + 1),
      open: bandOpen,
      onToggle: () => setBandOpen(!bandOpen),
      feishuIndependent: props.card !== undefined && props.card !== null,
      title: strings.previewLoading(),
    }),
  )
}
function defaultMessageFor(key) {
  const defaults = defaultMessages()
  const fallback = defaults[key] ?? defaults.end
  return { title: fallback.title, body: fallback.body }
}
function copyEditorHead(props) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-ed-hd' },
    createElement('h2', null, eventLabelOf(props.active)),
    createElement('span', { className: 'dsh-my-notify-badge' }, props.active),
    createElement('span', { className: 'dsh-my-notify-grow' }),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onOpenVars },
      strings.varOpen(),
    ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onReset },
      strings.resetDefaults(),
    ),
  )
}
function copyEditorFields(props) {
  return [
    createElement(
      'div',
      { key: 'title' },
      createElement(
        'div',
        { className: 'dsh-my-notify-lbl' },
        createElement('span', null, strings.tplTitle()),
        createElement('span', null, props.template.title.length + ' / 52'),
      ),
      createElement('input', {
        className: 'dsh-my-notify-inp2',
        value: props.template.title,
        'aria-label': strings.tplTitle(),
        onFocus: () => props.onTitle(props.template.title, props.template.title.length),
        onChange: (event) => props.onTitle(event.target.value, event.target.selectionStart ?? 0),
      }),
    ),
    createElement(
      'div',
      { key: 'body' },
      createElement(
        'div',
        { className: 'dsh-my-notify-lbl' },
        createElement('span', null, strings.tplBody()),
        createElement('span', null, props.template.body.length + ' / 180'),
      ),
      createElement('textarea', {
        className: 'dsh-my-notify-ta2',
        value: props.template.body,
        'aria-label': strings.tplBody(),
        onFocus: () => props.onBody(props.template.body, props.template.body.length),
        onChange: (event) => props.onBody(event.target.value, event.target.selectionStart ?? 0),
      }),
    ),
  ]
}


    // ── 渠道（列表 + 详情抽屉 + 卡片设计器）───────────────────────────
    'use strict'
function defaultCard() {
  return {
    schemaVersion: '2.0',
    template: '',
    fields: CARD_FIELD_OPTIONS.filter((option) => option.value !== 'event.time').map((option) => option.value),
    buttonText: strings.dzButtonDefault(),
    mentionOpenIds: [],
    mentionAll: false,
    accentByKind: true,
  }
}
function cardFieldsOf(card) {
  const allowed = CARD_FIELD_OPTIONS.map((option) => option.value)
  const raw = card !== null && card !== undefined && Array.isArray(card.fields) ? card.fields : []
  const fields = []
  for (const name of raw) {
    if (allowed.includes(name) && !fields.includes(name)) fields.push(name)
  }
  return fields
}
function cardOf(webhook) {
  const base = defaultCard()
  const card = webhook.card
  if (card === null || card === undefined || typeof card !== 'object') return base
  return {
    schemaVersion: typeof card.schemaVersion === 'string' ? card.schemaVersion : base.schemaVersion,
    template: typeof card.template === 'string' ? card.template : base.template,
    fields: cardFieldsOf(card),
    buttonText: typeof card.buttonText === 'string' && card.buttonText !== '' ? card.buttonText : base.buttonText,
    mentionOpenIds: Array.isArray(card.mentionOpenIds) ? card.mentionOpenIds : [],
    mentionAll: card.mentionAll === true,
    accentByKind: card.accentByKind !== false,
  }
}
function WebhookDesigner(props) {
  const card = cardOf(props.draft)
  const [view, setView] = useState('design')
  const [preview, setPreview] = useState(null)
  const [failed, setFailed] = useState(false)
  const patchCard = (key, value) => {
    props.onChange({ ...props.draft, card: { ...card, [key]: value } })
  }
  const toggleField = (name) => {
    const fields = card.fields ?? []
    patchCard('fields', fields.includes(name) ? fields.filter((f) => f !== name) : [...fields, name])
  }
  useEffect(() => {
    const scheduler = createPreviewScheduler((payload) => {
      void requestPreview(payload).then((value) => {
        setPreview(value)
        setFailed(value === null)
      })
    }, 300)
    scheduler.schedule({
      kind: 'end',
      channel: 'feishu',
      sample: { question: strings.sampleQuestion() },
      titleTemplate: props.draft.titleTemplate ?? '',
      bodyTemplate: props.draft.bodyTemplate ?? '',
      card,
    })
    return () => scheduler.cancel()
  }, [props.draft.card, props.draft.titleTemplate, props.draft.bodyTemplate])
  const ctx = { draft: props.draft, card, patchCard, toggleField, onChange: props.onChange, preview, failed }
  return createElement(
    'div',
    { className: 'dsh-my-notify-design' },
    createElement(
      'div',
      { className: 'dsh-my-notify-design-hd' },
      createElement('b', null, strings.designerTitle()),
      createElement('span', { className: 'dsh-my-notify-badge', 'data-kind': 'accent' }, 'interactive'),
      createElement('span', { className: 'dsh-my-notify-grow' }),
      createElement(
        'div',
        { className: 'dsh-my-notify-segmented', role: 'tablist', 'aria-label': strings.designerView() },
        ['design', 'json'].map((item) =>
          createElement(
            'button',
            {
              key: item,
              type: 'button',
              className: 'dsh-my-notify-seg',
              role: 'tab',
              'aria-selected': String(item === view),
              onClick: () => setView(item),
            },
            item === 'design' ? strings.designerView() : strings.viewJson(),
          ),
        ),
      ),
    ),
    view === 'json'
      ? createElement(
          'pre',
          { className: 'dsh-my-notify-pv-json' },
          JSON.stringify(preview !== null ? preview.card : { schema: '2.0', card }, null, 2),
        )
      : createElement('div', { className: 'dsh-my-notify-design-grid' }, designerControls(ctx), designerPreview(ctx)),
  )
}
function designerControls(ctx) {
  const { draft, card, patchCard, onChange } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-copy-stack' },
    createElement(
      'label',
      { className: 'dsh-my-notify-webhook-field' },
      createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.dzCardTitle()),
      textInput(draft.titleTemplate ?? '', '{{session.title}}', (v) => onChange({ ...draft, titleTemplate: v })),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-webhook-field' },
      createElement(
        'span',
        { className: 'dsh-my-notify-webhook-field-label' },
        strings.dzAccent(),
        createElement('span', { className: 'dsh-my-notify-hint' }, '· ' + strings.dzAccentAuto()),
      ),
      createElement(
        'div',
        { className: 'dsh-my-notify-swatches' },
        CARD_ACCENTS.map((option) =>
          createElement(
            'button',
            {
              key: option.value,
              type: 'button',
              className: 'dsh-my-notify-swatch',
              'data-c': option.value,
              'aria-pressed': String(card.accentByKind !== true && card.template === option.value),
              'aria-label': option.label(),
              onClick: () => onChange({ ...draft, card: { ...card, template: option.value, accentByKind: false } }),
            },
            createElement('i'),
          ),
        ),
        createElement(
          'label',
          { className: 'dsh-my-notify-cbx' },
          createElement('input', {
            type: 'checkbox',
            checked: card.accentByKind !== false,
            onChange: (event) => patchCard('accentByKind', event.target.checked),
          }),
          strings.dzAccentAuto(),
        ),
      ),
    ),
    designerOptionFields(ctx),
  )
}
function designerOptionFields(ctx) {
  const { card, patchCard, toggleField } = ctx
  return [
    createElement(
      'div',
      { className: 'dsh-my-notify-webhook-field' },
      createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.dzFields()),
      createElement(
        'div',
        { className: 'dsh-my-notify-dz-fields' },
        CARD_FIELD_OPTIONS.map((option) =>
          createElement(
            'label',
            { key: option.value, className: 'dsh-my-notify-cbx' },
            createElement('input', {
              type: 'checkbox',
              checked: cardFieldsOf(card).includes(option.value),
              onChange: () => toggleField(option.value),
            }),
            option.label(),
          ),
        ),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-grid2' },
      createElement(
        'label',
        { className: 'dsh-my-notify-webhook-field' },
        createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.dzButton()),
        textInput(card.buttonText ?? '', strings.dzButton(), (v) => patchCard('buttonText', v)),
      ),
      createElement(
        'label',
        { className: 'dsh-my-notify-webhook-field' },
        createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.dzMention()),
        textInput((card.mentionOpenIds ?? []).join(','), 'ou_xxxxxxxx', (v) =>
          patchCard(
            'mentionOpenIds',
            v
              .split(',')
              .map((item) => item.trim())
              .filter((item) => item !== ''),
          ),
        ),
      ),
    ),
    createElement(
      'label',
      { className: 'dsh-my-notify-cbx' },
      createElement('input', {
        type: 'checkbox',
        checked: card.mentionAll === true,
        onChange: (event) => patchCard('mentionAll', event.target.checked),
      }),
      strings.dzMentionAll(),
    ),
  ]
}
function designerPreview(ctx) {
  const { preview, failed } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-copy-stack' },
    createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.dzPreviewLabel()),
    createElement('div', {
      className: 'dsh-my-notify-pv-stage',
      dangerouslySetInnerHTML: { __html: preview !== null ? renderFeishuCardHtml(preview.card) : '' },
    }),
    createElement(
      'span',
      { className: 'dsh-my-notify-hint' },
      failed ? strings.previewFailed() : preview !== null ? cardMetaOf(preview.card) : strings.previewLoading(),
    ),
  )
}

    'use strict'
function editorField(label, control) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-webhook-field' },
    createElement('div', { className: 'dsh-my-notify-webhook-field-label' }, label),
    control,
  )
}
function textInput(value, placeholder, onChange) {
  return createElement('input', {
    className: 'dsh-my-notify-webhook-input',
    value,
    placeholder,
    onChange: (event) => onChange(event.target.value),
  })
}
function selectInput(value, options, onChange) {
  return createElement(
    'select',
    { className: 'dsh-my-notify-webhook-select', value, onChange: (event) => onChange(event.target.value) },
    options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label())),
  )
}
function testStateSetter(set) {
  return (ok) => set(ok ? 'ok' : 'fail')
}
function WebhookEditor(props) {
  const draft = props.draft
  const patch = (key, value) => props.onChange({ ...draft, [key]: value })
  const [secretShown, setSecretShown] = useState(false)
  const [testState, setTestState] = useState('')
  const events = Array.isArray(draft.events) ? draft.events : []
  const toggleEvent = (event) => {
    patch('events', events.includes(event) ? events.filter((e) => e !== event) : [...events, event])
  }
  const ctx = {
    draft,
    patch,
    secretShown,
    setSecretShown,
    events,
    toggleEvent,
    card: cardOf(draft),
    testState,
    setTestState,
    onTest: props.onTest,
    onChange: props.onChange,
    onCancel: props.onCancel,
    onSave: props.onSave,
    onDelete: props.onDelete,
  }
  return createElement(
    'div',
    {
      className: 'dsh-my-notify-drawer',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': strings.channelEditTitle(),
    },
    createElement('div', { className: 'dsh-my-notify-drawer-scrim', onClick: props.onCancel }),
    createElement(
      'div',
      {
        className: 'dsh-my-notify-drawer-panel',
        tabIndex: -1,
        onKeyDown: (event) => {
          if (event !== null && event.key === 'Escape') {
            if (typeof event.stopPropagation === 'function') event.stopPropagation()
            props.onCancel()
          }
        },
      },
      editorHead(ctx),
      createElement(
        'div',
        { className: 'dsh-my-notify-drawer-bd' },
        editorBasicsFields(ctx),
        editorChannelFields(ctx),
        editorContentFields(ctx),
      ),
      editorFooter(ctx),
    ),
  )
}
function editorHead(ctx) {
  const { draft, onCancel } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-drawer-hd' },
    createElement(
      'span',
      { className: 'dsh-my-notify-ch-mark', 'data-brand': draft.channel },
      brandMarkOf(draft.channel),
    ),
    createElement('h3', { className: 'dsh-my-notify-label' }, draft.name !== '' ? draft.name : strings.channelAddNew()),
    createElement(
      'span',
      { className: 'dsh-my-notify-badge', 'data-kind': 'accent' },
      msgTypeLabel(draft.channel, draft.msgType),
    ),
    createElement('span', { className: 'dsh-my-notify-grow' }),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn', 'aria-label': strings.closeToast(), onClick: onCancel },
      '×',
    ),
  )
}
function editorFooter(ctx) {
  const { onDelete, onCancel, onSave } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-drawer-ft' },
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn dsh-my-notify-btn-danger', onClick: onDelete },
      strings.channelDelete(),
    ),
    createElement('span', { className: 'dsh-my-notify-grow' }),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn', onClick: onCancel },
      strings.webhookCancel(),
    ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn dsh-my-notify-btn-primary', onClick: onSave },
      strings.channelSave(),
    ),
  )
}
function editorBasicsFields(ctx) {
  const { draft, patch, secretShown, setSecretShown } = ctx
  return [
    createElement(
      'div',
      { className: 'dsh-my-notify-grid2' },
      editorField(
        strings.channelName(),
        textInput(draft.name, strings.webhookNamePlaceholder(), (v) => patch('name', v)),
      ),
      editorField(
        strings.channelType(),
        selectInput(draft.channel, CHANNEL_OPTIONS, (v) => {
          const options = msgTypeOptions(v)
          const keep = options.some((o) => o.value === draft.msgType) ? draft.msgType : options[0].value
          ctx.onChange({ ...draft, channel: v, msgType: keep })
        }),
      ),
    ),
    editorField(
      strings.webhookUrl(),
      textInput(draft.url, strings.webhookUrlPlaceholder(), (v) => patch('url', v)),
    ),
    editorField(
      strings.channelSecret() + ' ' + strings.channelSecretHint(),
      createElement(
        'span',
        { className: 'dsh-my-notify-inp-group' },
        createElement('input', {
          className: 'dsh-my-notify-webhook-input',
          type: secretShown ? 'text' : 'password',
          value: draft.secret ?? '',
          placeholder: strings.webhookSecretPlaceholder(),
          'aria-label': strings.channelSecret(),
          onChange: (event) => patch('secret', event.target.value),
        }),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-notify-btn',
            'aria-pressed': String(secretShown),
            onClick: () => setSecretShown(!secretShown),
          },
          secretShown ? strings.secureHide() : strings.secureShow(),
        ),
      ),
    ),
  ]
}
function editorChannelFields(ctx) {
  const { draft, events, toggleEvent, patch } = ctx
  return [
    createElement(
      'div',
      { className: 'dsh-my-notify-webhook-field' },
      createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.channelEventsSubscribe()),
      createElement(
        'div',
        { className: 'dsh-my-notify-webhook-events' },
        EVENT_OPTIONS.map((option) =>
          createElement(
            'button',
            {
              key: option.value,
              type: 'button',
              className: 'dsh-my-notify-chip',
              'aria-pressed': String(events.includes(option.value)),
              'aria-label': option.label(),
              onClick: () => toggleEvent(option.value),
            },
            option.label(),
          ),
        ),
      ),
    ),
    editorField(
      strings.webhookMsgType(),
      createElement(
        'div',
        { className: 'dsh-my-notify-segmented', role: 'tablist', 'aria-label': strings.webhookMsgType() },
        msgTypeOptions(draft.channel).map((option) =>
          createElement(
            'button',
            {
              key: option.value,
              type: 'button',
              className: 'dsh-my-notify-seg',
              role: 'tab',
              'aria-selected': String(option.value === draft.msgType),
              onClick: () => patch('msgType', option.value),
            },
            option.label(),
          ),
        ),
      ),
    ),
  ]
}
function editorContentFields(ctx) {
  const { draft, patch, testState, setTestState, onTest } = ctx
  return [
    draft.channel === 'feishu' && draft.msgType === 'interactive'
      ? createElement(WebhookDesigner, { draft, onChange: ctx.onChange })
      : null,
    editorField(
      strings.webhookTemplate(),
      createElement('textarea', {
        className: 'dsh-my-notify-webhook-input dsh-my-notify-textarea',
        value: draft.bodyTemplate ?? draft.template ?? '',
        placeholder: strings.webhookTemplatePlaceholder(),
        'aria-label': strings.webhookTemplate(),
        onChange: (event) => patch('bodyTemplate', event.target.value),
      }),
    ),
    editorField(
      strings.retryAttempts(),
      textInput(String(draft.retry?.attempts ?? 3), '3', (v) =>
        patch('retry', { ...(draft.retry ?? {}), attempts: Number(v) || 0 }),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-actions' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-notify-btn',
          onClick: () => {
            setTestState('sending')
            void onTest(testStateSetter(setTestState))
          },
        },
        strings.channelTestSend(),
      ),
      testState === 'ok'
        ? createElement('span', { className: 'dsh-my-notify-saved' }, strings.secureRemoteOk())
        : testState === 'fail'
          ? createElement('span', { className: 'dsh-my-notify-error' }, strings.secureRemoteFail())
          : null,
      createElement('span', { className: 'dsh-my-notify-hint' }, strings.channelTestHint()),
    ),
  ]
}

    'use strict'
const WEBHOOK_STYLES = `.dsh-my-notify-ch-list{display:flex;flex-direction:column;gap:6px}.dsh-my-notify-ch-card{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}.dsh-my-notify-ch-card:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-my-notify-ch-mark{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;flex:none;font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-accent)}.dsh-my-notify-ch-mark[data-brand="wecom"]{background:var(--dsw-alias-state-success-primary)}.dsh-my-notify-ch-mark[data-brand="dingtalk"]{background:var(--dsw-alias-state-warn-primary)}.dsh-my-notify-ch-mark[data-brand="generic"]{background:var(--dsw-alias-label-tertiary)}.dsh-my-notify-ch-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.dsh-my-notify-ch-name{display:flex;align-items:center;gap:6px;font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}.dsh-my-notify-ch-sub{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}.dsh-my-notify-ch-evs{display:flex;flex-wrap:wrap;gap:4px}.dsh-my-notify-ch-chip{height:18px;padding:0 6px;border-radius:4px;display:inline-flex;align-items:center;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg)}.dsh-my-notify-ch-ctl{display:flex;align-items:center;gap:8px;flex:none}.dsh-my-notify-drawer{position:fixed;inset:0;z-index:3200;display:flex;justify-content:flex-end}.dsh-my-notify-drawer-scrim{position:absolute;inset:0;background:color-mix(in srgb, var(--dsw-alias-label-primary) 28%, transparent)}.dsh-my-notify-drawer-panel{position:relative;display:flex;flex-direction:column;width:min(560px,100%);height:100%;overflow:auto;background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv2)}.dsh-my-notify-drawer-hd{display:flex;align-items:center;gap:8px;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l2);position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);z-index:1}.dsh-my-notify-drawer-bd{display:flex;flex-direction:column;gap:10px;padding:12px}.dsh-my-notify-drawer-ft{display:flex;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--dsw-alias-border-l2);position:sticky;bottom:0;background:var(--dsw-alias-bg-layer-1)}.dsh-my-notify-webhook-editor{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}.dsh-my-notify-webhook-field{display:flex;flex-direction:column;gap:4px;min-width:0}.dsh-my-notify-webhook-field-label{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}.dsh-my-notify-webhook-input{width:100%;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}.dsh-my-notify-webhook-select{height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}.dsh-my-notify-webhook-events{display:flex;flex-wrap:wrap;gap:6px}.dsh-my-notify-webhook-event{display:flex;align-items:center;gap:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}.dsh-my-notify-chip{height:24px;padding:0 8px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}.dsh-my-notify-chip[aria-pressed="true"]{border-color:var(--dsw-alias-accent);color:var(--dsw-alias-accent);background:color-mix(in srgb, var(--dsw-alias-accent) 10%, transparent)}.dsh-my-notify-inp-group{display:flex;align-items:center;gap:6px}.dsh-my-notify-inp-group input{flex:1;min-width:0}.dsh-my-notify-design{display:flex;flex-direction:column;gap:10px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dsh-my-notify-design-hd{display:flex;align-items:center;gap:8px}.dsh-my-notify-design-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.dsh-my-notify-swatches{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.dsh-my-notify-swatch{width:20px;height:20px;padding:0;border-radius:50%;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-label-tertiary)}.dsh-my-notify-swatch i{display:block;width:100%;height:100%;border-radius:50%}.dsh-my-notify-swatch[data-c="green"] i{background:var(--dsw-alias-state-success-primary)}.dsh-my-notify-swatch[data-c="blue"] i{background:var(--dsw-alias-accent)}.dsh-my-notify-swatch[data-c="orange"] i{background:var(--dsw-alias-state-warn-primary)}.dsh-my-notify-swatch[data-c="grey"] i{background:var(--dsw-alias-label-tertiary)}.dsh-my-notify-swatch[aria-pressed="true"]{border-color:var(--dsw-alias-label-primary);border-width:2px}.dsh-my-notify-cbx{display:inline-flex;align-items:center;gap:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}.dsh-my-notify-dz-fields{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px}.dsh-my-notify-fail-list{display:flex;flex-direction:column;gap:4px}.dsh-my-notify-fail-row{display:grid;grid-template-columns:80px 60px minmax(0,1fr) 56px;align-items:center;gap:8px;padding:4px 0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}.dsh-my-notify-fail-row[data-head="true"]{color:var(--dsw-alias-label-tertiary)}.dsh-my-notify-fail-time{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}.dsh-my-notify-fail-err{color:var(--dsw-alias-state-error-primary);word-break:break-word}
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
  { value: 'subagentEnd', label: () => strings.eventSubagentEnd() },
  { value: 'remote', label: () => strings.eventRemote() },
]
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
    titleTemplate: '',
    bodyTemplate: '',
    card: defaultCard(),
    retry: { attempts: 3, backoffMs: 1000 },
  }
}
function channelLabel(channel) {
  const option = CHANNEL_OPTIONS.find((o) => o.value === channel)
  return option !== undefined ? option.label() : channel
}
function brandMarkOf(channel) {
  if (channel === 'feishu') return '飞'
  if (channel === 'wecom') return '企'
  if (channel === 'dingtalk') return '钉'
  return '通'
}
function eventsLabel(events) {
  if (!Array.isArray(events) || events.length === 0) return strings.eventAll()
  return events
    .map((event) => {
      const option = EVENT_OPTIONS.find((o) => o.value === event)
      return option !== undefined ? option.label() : event
    })
    .join(' / ')
}
function msgTypeOptions(channel) {
  if (channel === 'feishu') {
    return [
      { value: 'text', label: () => strings.msgTypeText() },
      { value: 'post', label: () => strings.msgTypePost() },
      { value: 'interactive', label: () => strings.msgTypeInteractive() },
    ]
  }
  return [
    { value: 'text', label: () => strings.msgTypeText() },
    { value: 'markdown', label: () => strings.msgTypeMarkdown() },
    { value: 'post', label: () => strings.msgTypePost() },
  ]
}
function msgTypeLabel(channel, msgType) {
  const option = msgTypeOptions(channel).find((o) => o.value === msgType)
  return option !== undefined ? option.label() : msgType
}
function WebhookRow({ webhook, onEdit, onDelete, onToggle }) {
  const enabled = webhook.enabled !== false
  const events = Array.isArray(webhook.events) ? webhook.events : []
  return createElement(
    'div',
    {
      className: 'dsh-my-notify-webhook-row dsh-my-notify-ch-card',
      role: 'button',
      tabIndex: 0,
      onClick: onEdit,
      onKeyDown: (event) => {
        if (event !== null && (event.key === 'Enter' || event.key === ' ')) {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          onEdit()
        }
      },
    },
    createElement(
      'span',
      { className: 'dsh-my-notify-ch-mark', 'data-brand': webhook.channel },
      brandMarkOf(webhook.channel),
    ),
    createElement(
      'span',
      { className: 'dsh-my-notify-ch-main' },
      createElement(
        'span',
        { className: 'dsh-my-notify-ch-name' },
        createElement('span', { className: 'dsh-my-notify-label' }, webhook.name),
        createElement(
          'span',
          { className: 'dsh-my-notify-badge', 'data-kind': 'accent' },
          msgTypeLabel(webhook.channel, webhook.msgType),
        ),
      ),
      createElement(
        'span',
        { className: 'dsh-my-notify-ch-sub dsh-my-notify-hint' },
        channelLabel(webhook.channel) + ' · ' + eventsLabel(events),
      ),
      createElement(
        'span',
        { className: 'dsh-my-notify-ch-evs' },
        (events.length > 0 ? events : ['end', 'ask', 'approval', 'remote']).map((event) =>
          createElement('span', { key: event, className: 'dsh-my-notify-ch-chip' }, eventLabelOf(event)),
        ),
      ),
    ),
    webhookRowControls({ webhook, enabled, onToggle }),
  )
}
function webhookRowControls({ webhook, enabled, onToggle }) {
  return createElement(
    'span',
    { className: 'dsh-my-notify-ch-ctl' },
    createElement(
      'span',
      { className: 'dsh-my-notify-badge', 'data-kind': enabled ? 'ok' : undefined },
      enabled ? strings.channelEnabled() : strings.channelDisabled(),
    ),
    createElement('div', {
      className: 'dsh-my-notify-toggle',
      'data-on': String(enabled),
      role: 'switch',
      'aria-checked': String(enabled),
      'aria-label': webhook.name,
      tabIndex: 0,
      onClick: (event) => {
        if (event !== null && typeof event.stopPropagation === 'function') event.stopPropagation()
        onToggle(!enabled)
      },
    }),
  )
}
function FailureRow({ failure, onRetry }) {
  const time = new Date(failure.time).toLocaleString()
  return createElement(
    'div',
    { className: 'dsh-my-notify-fail-row' },
    createElement('span', { className: 'dsh-my-notify-fail-time dsh-my-notify-webhook-failure-time' }, time),
    createElement('span', null, channelLabel(failure.channel)),
    createElement(
      'span',
      { className: 'dsh-my-notify-fail-err dsh-my-notify-webhook-failure-msg' },
      failure.error + ' · ' + strings.retryAttemptsUsed(failure.attempts),
    ),
    onRetry !== undefined
      ? createElement(
          'button',
          { type: 'button', className: 'dsh-my-notify-btn', onClick: onRetry },
          strings.webhookEdit(),
        )
      : createElement('span'),
  )
}
function WebhookSection({ webhooks, failures, onPatchWebhooks, apiToken }) {
  const list = Array.isArray(webhooks) ? webhooks : []
  const [editing, setEditing] = useState(-1)
  const [editorDraft, setEditorDraft] = useState(null)
  const startAdd = () => {
    setEditorDraft(emptyWebhook())
    setEditing(list.length)
  }
  const startEdit = (index) => {
    setEditorDraft({ ...list[index], card: cardOf(list[index]) })
    setEditing(index)
  }
  const saveEditor = () => {
    const next = [...list]
    if (editing >= next.length) next.push(editorDraft)
    else next[editing] = editorDraft
    onPatchWebhooks(next)
    setEditing(-1)
    setEditorDraft(null)
  }
  const removeAt = (index) => {
    onPatchWebhooks(list.filter((_, i) => i !== index))
    setEditing(-1)
    setEditorDraft(null)
  }
  const toggleAt = (index, enabled) => {
    onPatchWebhooks(list.map((webhook, i) => (i === index ? { ...webhook, enabled } : webhook)))
  }
  const testSend = (done) => {
    if (typeof fetch !== 'function') {
      done(false)
      return
    }
    fetch('/notify/api/trigger', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-notify-token': typeof apiToken === 'string' ? apiToken : '' },
      body: JSON.stringify({ title: strings.channelTestSend(), body: editorDraft !== null ? editorDraft.name : '' }),
    })
      .then((res) => res.json())
      .then((body) => done(body !== null && body !== undefined && body.ok === true))
      .catch(() => done(false))
  }
  return createElement(
    'div',
    { className: 'dsh-my-notify-section', role: 'tabpanel', 'aria-label': strings.paneChannel() },
    webhookList({ list, onEdit: startEdit, onToggle: toggleAt }),
    list.length === 0 ? createElement('div', { className: 'dsh-my-notify-hint' }, strings.channelNoWebhooks()) : null,
    createElement(
      'div',
      { className: 'dsh-my-notify-actions' },
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-notify-btn', onClick: startAdd },
        strings.webhookAdd(),
      ),
    ),
    webhookDrawer({ editing, editorDraft, setEditorDraft, saveEditor, removeAt, testSend }),
    Array.isArray(failures) && failures.length > 0 ? webhookFailuresBlock(failures) : null,
  )
}
function webhookList(props) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-ch-list' },
    props.list.map((webhook, index) =>
      createElement(WebhookRow, {
        key: index,
        webhook,
        onEdit: () => props.onEdit(index),
        onDelete: () => {},
        onToggle: (enabled) => props.onToggle(index, enabled),
      }),
    ),
  )
}
function webhookFailuresBlock(failures) {
  const title = createElement('div', { className: 'dsh-my-notify-section-title' }, strings.webhookFailures())
  if (failures === undefined || failures.length === 0) {
    return [title, createElement('div', { className: 'dsh-my-notify-hint' }, strings.webhookNoFailures())]
  }
  return [
    title,
    createElement(
      'div',
      { className: 'dsh-my-notify-fail-list' },
      failures.map((failure, index) => createElement(FailureRow, { key: index, failure })),
    ),
  ]
}
function webhookDrawer(ctx) {
  const { editing, editorDraft, setEditorDraft, saveEditor, removeAt, testSend } = ctx
  if (editing < 0 || editorDraft === null) return null
  return createElement(WebhookEditor, {
    draft: editorDraft,
    onChange: setEditorDraft,
    onSave: saveEditor,
    onCancel: () => {
      setEditorDraft(null)
      return removeAt(-1)
    },
    onDelete: () => removeAt(editing),
    onTest: testSend,
  })
}


    // ── 设置分区（呈现 / 高级）+ 行控件 + 样式 ────────────────────────
    'use strict'
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
      'aria-label': label,
      tabIndex: 0,
      onClick: () => onChange(!on),
      onKeyDown: (event) => {
        if (event !== null && (event.key === 'Enter' || event.key === ' ')) {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          onChange(!on)
        }
      },
    }),
  )
}
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
      'aria-label': label,
      onChange: (event) => onChange(event.target.value),
    }),
  )
}
function SelectRow({ label, hint, value, options, onChange }) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-row' },
    createElement(
      'div',
      { className: 'dsh-my-notify-info' },
      createElement('div', { className: 'dsh-my-notify-label' }, label),
      createElement('div', { className: 'dsh-my-notify-hint' }, hint),
    ),
    createElement(
      'select',
      {
        className: 'dsh-my-notify-webhook-select',
        value,
        'aria-label': label,
        onChange: (event) => onChange(event.target.value),
      },
      options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label())),
    ),
  )
}
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
    createElement('div', { className: 'dsh-my-notify-range-value' }, Math.round(value * 100) + '%'),
  )
}
function optionTextOf(options, value) {
  const hit = options.find((option) => option.value === value)
  return hit !== undefined ? hit.label() : value
}
function defaultConfig() {
  return {
    end: true,
    ask: true,
    approval: true,
    subagentEnd: false,
    askMode: 'full',
    apiToken: '',
    webBaseUrl: '',
    dedupeMs: 3000,
    webhooks: [],
    quietHours: { enabled: false, start: '23:00', end: '08:00' },
    sound: { enabled: true, preset: 'chime', volume: 0.6 },
    toast: { enabled: true, durationMs: 4000, position: 'bottom-right', maxStack: 3 },
    system: { enabled: true, requireInteraction: false },
    messages: defaultMessages(),
  }
}
function permissionBadge() {
  try {
    if (typeof Notification === 'undefined') return { text: strings.permDefault(), kind: 'warn' }
    if (Notification.permission === 'granted') return { text: strings.permGranted(), kind: 'ok' }
    if (Notification.permission === 'denied') return { text: strings.permDenied(), kind: 'err' }
    return { text: strings.permDefault(), kind: 'warn' }
  } catch {
    return { text: strings.permDefault(), kind: 'warn' }
  }
}
function configOf(draft) {
  return draft !== null && draft !== undefined ? draft : defaultConfig()
}
function syncPrefsFromConfig(config) {
  seedRuntimePrefs(config)
}

    'use strict'
function renderPresentPane(draft, patch, volume, onVolumeChange) {
  const toast = draft.toast ?? defaultConfig().toast
  const sound = draft.sound ?? defaultConfig().sound
  const system = draft.system ?? defaultConfig().system
  const quiet = draft.quietHours ?? { enabled: false, start: '23:00', end: '08:00' }
  const perm = permissionBadge()
  const patchToast = (key, value) => patch('toast', { ...toast, [key]: value })
  const patchSound = (key, value) => patch('sound', { ...sound, [key]: value })
  const patchSystem = (key, value) => patch('system', { ...system, [key]: value })
  const patchQuiet = (key, value) => patch('quietHours', { ...quiet, [key]: value })
  const { positions, durations, stacks, tones } = presentOptions()
  const ctx = {
    system,
    patchSystem,
    perm,
    toast,
    patchToast,
    positions,
    durations,
    stacks,
    sound,
    patchSound,
    tones,
    quiet,
    patchQuiet,
    draft,
    patch,
    volume,
    onVolumeChange,
  }
  return createElement(
    'div',
    { className: 'dsh-my-notify-pane', role: 'tabpanel', 'aria-label': strings.panePresent() },
    createElement(
      'div',
      { className: 'dsh-my-notify-pane-hd' },
      createElement('h2', null, strings.panePresent()),
      createElement('span', { className: 'dsh-my-notify-hint' }, strings.presentHint()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-grid2' },
      presentSystemCard(ctx),
      presentToastCard(ctx),
      presentSoundCard(ctx),
      presentQuietCard(ctx),
      presentSelfCheckCard(ctx),
    ),
  )
}
function presentSystemCard(ctx) {
  const { system, patchSystem, perm } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.systemTitle()),
      createElement('span', { className: 'dsh-my-notify-badge', 'data-kind': perm.kind }, perm.text),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(SwitchRow, {
        label: strings.systemEnable(),
        hint: strings.systemEnableHint(),
        on: prefOn(LS.notify, system.enabled !== false),
        onChange: (v) => {
          patchSystem('enabled', v)
          writePref(LS.notify, v)
        },
      }),
      createElement(SwitchRow, {
        label: strings.systemPersist(),
        hint: strings.systemPersistHint(),
        on: system.requireInteraction === true,
        onChange: (v) => patchSystem('requireInteraction', v),
      }),
    ),
  )
}
function presentToastCard(ctx) {
  const { toast, patchToast, positions, durations, stacks } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.toastTitle2()),
      createElement('span', { className: 'dsh-my-notify-hint' }, strings.toastEnableHint()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(SwitchRow, {
        label: strings.toastTitle2(),
        hint: strings.toastEnableHint(),
        on: prefOn(LS.toast, toast.enabled !== false),
        onChange: (v) => {
          patchToast('enabled', v)
          writePref(LS.toast, v)
        },
      }),
      createElement(SelectRow, {
        label: strings.toastPosition(),
        hint: strings.toastEnableHint(),
        value: toast.position,
        options: positions,
        onChange: (v) => patchToast('position', v),
      }),
      createElement(SelectRow, {
        label: strings.toastDuration(),
        hint: strings.ms(),
        value: String(toast.durationMs),
        options: durations,
        onChange: (v) => patchToast('durationMs', Number(v)),
      }),
      createElement(SelectRow, {
        label: strings.toastMaxStack(),
        hint: strings.toastHoverPause(),
        value: String(toast.maxStack),
        options: stacks,
        onChange: (v) => patchToast('maxStack', Number(v)),
      }),
    ),
  )
}
function presentSoundCard(ctx) {
  const { sound, patchSound, tones, onVolumeChange } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.soundTitle()),
      createElement('span', { className: 'dsh-my-notify-badge' }, optionTextOf(tones, sound.preset)),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(SwitchRow, {
        label: strings.soundEnable(),
        hint: strings.soundEnableHint(),
        on: prefOn(LS.sound, sound.enabled !== false),
        onChange: (v) => {
          patchSound('enabled', v)
          writePref(LS.sound, v)
        },
      }),
      soundToneRow({ sound, patchSound, tones }),
      createElement(VolumeRow, {
        label: strings.settingsVolume(),
        hint: strings.settingsVolumeHint(),
        value: prefNum(LS.volume, sound.volume),
        onChange: (v) => {
          patchSound('volume', v)
          writePrefNum(LS.volume, v)
          onVolumeChange(v)
        },
      }),
    ),
  )
}
function presentQuietCard(ctx) {
  const { quiet, patchQuiet, draft, patch } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.quietDedupeTitle()),
      createElement(
        'span',
        {
          className: 'dsh-my-notify-badge',
          'data-kind': quiet.enabled === true ? 'warn' : 'ok',
        },
        quiet.enabled === true ? strings.settingsQuietHoursEnabled() : strings.channelDisabled(),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(SwitchRow, {
        label: strings.quietEnable(),
        hint: strings.quietEnableHint(),
        on: quiet.enabled === true,
        onChange: (v) => patchQuiet('enabled', v),
      }),
      createElement(
        'div',
        { className: 'dsh-my-notify-grid2' },
        createElement(TextRow, {
          label: strings.quietStart(),
          hint: '23:00',
          value: quiet.start,
          type: 'time',
          onChange: (v) => patchQuiet('start', v),
        }),
        createElement(TextRow, {
          label: strings.quietEnd(),
          hint: '08:00',
          value: quiet.end,
          type: 'time',
          onChange: (v) => patchQuiet('end', v),
        }),
      ),
      createElement('div', { className: 'dsh-my-notify-divider' }),
      createElement(TextRow, {
        label: strings.dedupeWindow(),
        hint: strings.dedupeWindowHint(),
        value: String(draft.dedupeMs ?? 3000),
        type: 'number',
        onChange: (v) => patch('dedupeMs', Number(v) || 0),
      }),
    ),
  )
}
function presentSelfCheckCard(ctx) {
  const { perm } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.permSelfCheck()),
      createElement('span', { className: 'dsh-my-notify-badge', 'data-kind': perm.kind }, perm.text),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement('div', { className: 'dsh-my-notify-status-line' }, strings.systemTitle() + ' · ' + perm.text),
      createElement('div', { className: 'dsh-my-notify-status-line' }, strings.soundAvailable()),
      createElement('div', { className: 'dsh-my-notify-status-line' }, strings.toastHoverPause()),
    ),
  )
}
function presentOptions() {
  const positions = [
    { value: 'top-right', label: () => strings.posTopRight() },
    { value: 'top-left', label: () => strings.posTopLeft() },
    { value: 'bottom-right', label: () => strings.posBottomRight() },
    { value: 'bottom-left', label: () => strings.posBottomLeft() },
    { value: 'top', label: () => strings.posTop() },
    { value: 'bottom', label: () => strings.posBottom() },
  ]
  const durations = [
    { value: '3000', label: () => strings.dur3s() },
    { value: '5000', label: () => strings.dur5s() },
    { value: '8000', label: () => strings.dur8s() },
  ]
  const stacks = [
    { value: '1', label: () => strings.stack1() },
    { value: '3', label: () => strings.stack3() },
    { value: '5', label: () => strings.stack5() },
  ]
  const tones = [
    { value: 'chime', label: () => strings.toneChime() },
    { value: 'drop', label: () => strings.toneDrop() },
    { value: 'deep', label: () => strings.toneDeep() },
  ]
  return { positions, durations, stacks, tones }
}
function soundToneRow(props) {
  const { sound, patchSound, tones } = props
  return createElement(
    'div',
    { className: 'dsh-my-notify-form-row' },
    createElement('span', { className: 'dsh-my-notify-label' }, strings.soundTone()),
    createElement(
      'select',
      {
        className: 'dsh-my-notify-webhook-select',
        value: sound.preset,
        'aria-label': strings.soundTone(),
        onChange: (event) => {
          patchSound('preset', event.target.value)
          try {
            window.localStorage.setItem(LS.tone, event.target.value)
          } catch {
            void 0
          }
        },
      },
      tones.map((option) => createElement('option', { key: option.value, value: option.value }, option.label())),
    ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn', onClick: () => beep(sound.preset) },
      strings.soundTest(),
    ),
  )
}

    'use strict'
function remoteSampleJson() {
  return JSON.stringify({ title: strings.sampleTitle(), body: strings.sampleBody() }, null, 2)
}
function renderSecurePane(draft, patch, apiToken, onTest) {
  const [shown, setShown] = useState(false)
  const [testState, setTestState] = useState('unsent')
  const [testError, setTestError] = useState('')
  const [sample, setSample] = useState(() => remoteSampleJson())
  const [imported, setImported] = useState('')
  const token = typeof draft.apiToken === 'string' ? draft.apiToken : ''
  const regenerate = () => {
    const next = 'ntf_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
    patch('apiToken', next)
  }
  const ctx = {
    draft,
    patch,
    apiToken,
    shown,
    setShown,
    token,
    regenerate,
    testState,
    setTestState,
    testError,
    setTestError,
    sample,
    setSample,
    imported,
    setImported,
    onTest,
  }
  return createElement(
    'div',
    { className: 'dsh-my-notify-pane', role: 'tabpanel', 'aria-label': strings.paneSecure() },
    createElement(
      'div',
      { className: 'dsh-my-notify-pane-hd' },
      createElement('h2', null, strings.paneSecure()),
      createElement('span', { className: 'dsh-my-notify-hint' }, strings.secureHint()),
    ),
    secureTokenCard(ctx),
    createElement('div', { className: 'dsh-my-notify-grid2' }, secureRemoteCard(ctx), secureImportCard(ctx)),
    createElement('div', { className: 'dsh-my-notify-status' }, apiToken !== '' ? strings.settingsApiTokenHint() : ''),
  )
}
function secureTokenCard(ctx) {
  const { draft, patch, shown, setShown, token, regenerate } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.secureApiToken()),
      createElement(
        'span',
        { className: 'dsh-my-notify-badge', 'data-kind': 'warn' },
        token !== '' ? strings.settingsApiToken() : strings.channelDisabled(),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(
        'div',
        { className: 'dsh-my-notify-inp-group' },
        createElement('input', {
          className: 'dsh-my-notify-webhook-input',
          type: shown ? 'text' : 'password',
          value: token,
          placeholder: 'ntf_…',
          'aria-label': strings.secureApiToken(),
          onChange: (event) => patch('apiToken', event.target.value),
        }),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-notify-btn',
            'aria-pressed': String(shown),
            onClick: () => setShown(!shown),
          },
          shown ? strings.secureHide() : strings.secureShow(),
        ),
        createElement(
          'button',
          { type: 'button', className: 'dsh-my-notify-btn', onClick: regenerate },
          strings.secureRegenerate(),
        ),
      ),
      createElement(TextRow, {
        label: strings.secureBaseUrl(),
        hint: strings.secureBaseUrlHint(),
        value: typeof draft.webBaseUrl === 'string' ? draft.webBaseUrl : '',
        onChange: (v) => patch('webBaseUrl', v),
      }),
      createElement('div', { className: 'dsh-my-notify-hint' }, strings.settingsApiTokenHint()),
    ),
  )
}
function testLineOf(state, error) {
  if (state === 'sending') return strings.secureRemoteSending()
  if (state === 'ok') return strings.secureRemoteOk()
  if (state === 'fail') return strings.secureRemoteFail() + (error !== '' ? '：' + error : '')
  if (state === 'timeout') return strings.secureRemoteTimeout()
  return strings.secureRemoteUnsent()
}
function runRemoteTest(sample, setState, setError, onTest) {
  setState('sending')
  setError('')
  let settled = false
  const finish = (state, reason) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    setState(state)
    setError(reason)
  }
  const timer = setTimeout(() => finish('timeout', ''), 8000)
  onTest('remote', sample, (ok, reason) => finish(ok ? 'ok' : 'fail', ok ? '' : (reason ?? '')))
}
function secureRemoteCard(ctx) {
  const { sample, setSample, testState, setTestState, testError, setTestError, onTest } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.secureRemoteTitle()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.secureRemoteSample()),
      createElement('textarea', {
        className: 'dsh-my-notify-webhook-input dsh-my-notify-textarea',
        value: sample,
        'aria-label': strings.secureRemoteSample(),
        onChange: (event) => setSample(event.target.value),
      }),
      createElement(
        'div',
        { className: 'dsh-my-notify-actions' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-notify-btn dsh-my-notify-btn-primary',
            disabled: testState === 'sending',
            onClick: () => runRemoteTest(sample, setTestState, setTestError, onTest),
          },
          testState === 'sending' ? strings.secureRemoteSending() : strings.secureRemoteSend(),
        ),
        createElement('span', { className: 'dsh-my-notify-hint' }, strings.channelTestHint()),
      ),
      createElement(
        'div',
        {
          className:
            testState === 'ok'
              ? 'dsh-my-notify-saved'
              : testState === 'fail' || testState === 'timeout'
                ? 'dsh-my-notify-error'
                : 'dsh-my-notify-status',
          role: 'status',
        },
        testLineOf(testState, testError),
      ),
    ),
  )
}
function secureImportCard(ctx) {
  const { draft, patch, imported, setImported, testState, setTestState } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement('div', { className: 'dsh-my-notify-card-hd' }, createElement('h3', null, strings.secureExport())),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement('pre', { className: 'dsh-my-notify-code' }, JSON.stringify(draft, null, 2)),
      createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.secureImport()),
      createElement('textarea', {
        className: 'dsh-my-notify-webhook-input dsh-my-notify-textarea',
        value: imported,
        placeholder: '{ "dedupeMs": 60000 }',
        'aria-label': strings.secureImport(),
        onChange: (event) => setImported(event.target.value),
      }),
      createElement(
        'div',
        { className: 'dsh-my-notify-actions' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-notify-btn',
            onClick: () => {
              try {
                const parsed = JSON.parse(imported)
                if (parsed !== null && typeof parsed === 'object') patch('__import__', parsed)
              } catch {
                setTestState('fail')
              }
            },
          },
          strings.secureImport(),
        ),
      ),
    ),
  )
}


    // ── 简版面板（事件 → 文案 → 飞书卡片 → 送达）──────────────────────
    'use strict'
const PANEL_STYLES = `
.dsh-my-notify-panel{container-type:inline-size;display:flex;flex-direction:column;height:100%;min-height:0;padding:2px 2px 0;color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:2px 2px 0}
.dsh-my-notify-p-kicker{margin:0 0 6px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);letter-spacing:.14em}
.dsh-my-notify-p-title{margin:0;font:var(--dsw-font-l-20);letter-spacing:-.01em}
.dsh-my-notify-p-lede{margin:6px 0 0;max-width:46ch;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);line-height:1.7}
.dsh-my-notify-p-head-side{display:flex;flex:none;flex-direction:column;align-items:flex-end;gap:8px}
.dsh-my-notify-p-meta{margin:0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);line-height:1.7;text-align:right}
.dsh-my-notify-p-ghost{min-height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-notify-p-ghost:hover{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-ghost:focus-visible{outline:2px solid var(--dsw-alias-accent);outline-offset:3px}
.dsh-my-notify-p-tabs{display:flex;gap:26px;margin:22px 2px 0;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto;scrollbar-width:none}
.dsh-my-notify-p-tabs::-webkit-scrollbar{display:none}
.dsh-my-notify-p-tab{position:relative;flex:none;min-height:44px;padding:0 1px 11px;border:0;background:none;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);cursor:pointer;white-space:nowrap}
.dsh-my-notify-p-tab::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;background:transparent}
.dsh-my-notify-p-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-tab[aria-selected="true"]::after{background:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-tab:hover{color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-tab:focus-visible{outline:2px solid var(--dsw-alias-accent);outline-offset:4px;border-radius:4px}
.dsh-my-notify-p-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:28px;flex:1;min-height:0;padding:20px 2px 0}
.dsh-my-notify-p-compose{min-width:0;min-height:0;overflow:auto;padding-right:4px}
.dsh-my-notify-p-preview{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:auto}
.dsh-my-notify-p-compose-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}
.dsh-my-notify-p-event{margin:0;font:var(--dsw-font-s-strong-14)}
.dsh-my-notify-p-event-sub{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-p-switch{display:inline-flex;align-items:center;gap:9px;min-height:44px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-notify-p-switch[data-static="true"]{cursor:default;color:var(--dsw-alias-label-tertiary)}
.dsh-my-notify-p-switch input{position:absolute;opacity:0;width:1px;height:1px;margin:0}
.dsh-my-notify-p-switch i{display:block;width:38px;height:22px;border-radius:999px;background:var(--dsw-alias-border-l3);transition:background .16s ease}
.dsh-my-notify-p-switch i::after{content:"";display:block;width:18px;height:18px;margin:2px;border-radius:50%;background:var(--dsw-alias-switch-thumb);box-shadow:0 1px 2px rgba(0,0,0,.18);transition:transform .16s ease}
.dsh-my-notify-p-switch input:checked+i{background:var(--dsw-alias-accent)}
.dsh-my-notify-p-switch input:checked+i::after{transform:translateX(16px)}
.dsh-my-notify-p-switch input:focus-visible+i{outline:2px solid var(--dsw-alias-accent);outline-offset:3px}
.dsh-my-notify-p-field{margin-bottom:14px}
.dsh-my-notify-p-label-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px}
.dsh-my-notify-p-label{display:block;margin-bottom:8px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-p-label-row .dsh-my-notify-p-label{margin-bottom:0}
.dsh-my-notify-p-hint{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11)}
.dsh-my-notify-p-input,.dsh-my-notify-p-textarea{width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);padding:0 12px;transition:border-color .16s ease,box-shadow .16s ease}
.dsh-my-notify-p-input{height:44px}
.dsh-my-notify-p-textarea{min-height:80px;padding:10px 12px;resize:vertical;font:var(--dsw-font-xs-13);line-height:1.65}
.dsh-my-notify-p-input:hover,.dsh-my-notify-p-textarea:hover{border-color:var(--dsw-alias-border-l3)}
.dsh-my-notify-p-input:focus,.dsh-my-notify-p-textarea:focus{outline:none;border-color:var(--dsw-alias-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-accent) 16%,transparent)}
.dsh-my-notify-p-vars{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:2px 0 16px}
.dsh-my-notify-p-vars-label{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);margin-right:2px}
.dsh-my-notify-p-var{min-height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer;transition:border-color .16s ease,color .16s ease}
.dsh-my-notify-p-var:hover{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-var:focus-visible{outline:2px solid var(--dsw-alias-accent);outline-offset:2px}
.dsh-my-notify-p-var-more{min-height:36px;padding:0 6px;border:0;background:none;color:var(--dsw-alias-link);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-notify-p-var-sheet{margin:-8px 0 18px;max-height:220px;overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dsh-my-notify-p-delivery{margin-top:2px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-my-notify-p-delivery-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:9px}
.dsh-my-notify-p-chips{display:flex;flex-wrap:wrap;gap:8px}
.dsh-my-notify-p-chip{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:transparent;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);cursor:pointer;transition:background .16s ease,border-color .16s ease,color .16s ease}
.dsh-my-notify-p-chip i{width:7px;height:7px;border-radius:50%;border:1.5px solid currentColor}
.dsh-my-notify-p-chip[aria-pressed="true"]{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-chip[aria-pressed="true"] i{background:var(--dsw-alias-accent);border-color:var(--dsw-alias-accent)}
.dsh-my-notify-p-chip:hover{border-color:var(--dsw-alias-border-l3)}
.dsh-my-notify-p-chip:focus-visible{outline:2px solid var(--dsw-alias-accent);outline-offset:3px}
.dsh-my-notify-p-ask{margin-top:14px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-my-notify-p-ask-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.dsh-my-notify-p-seg{min-height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-notify-p-seg[aria-selected="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-strong-12)}
.dsh-my-notify-p-preview-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 10px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-p-card-stage{width:100%}
.dsh-my-notify-p-card-skeleton{min-height:280px;display:grid;place-items:center;padding:16px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);text-align:center}
.dsh-my-notify-p-preview-status{margin:10px 0 0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);line-height:1.6}
.dsh-my-notify-p-preview-status[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}
.dsh-my-notify-p-dots{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-top:14px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-p-dot{width:20px;height:20px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:50%;cursor:pointer}
.dsh-my-notify-p-dot[data-tone="green"]{background:#33544a}
.dsh-my-notify-p-dot[data-tone="blue"]{background:#3a4a63}
.dsh-my-notify-p-dot[data-tone="orange"]{background:#7a5344}
.dsh-my-notify-p-dot[data-tone="grey"]{background:#3c3c39}
.dsh-my-notify-p-dot[aria-pressed="true"]{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1),0 0 0 3.5px var(--dsw-alias-label-tertiary)}
.dsh-my-notify-p-dot:focus-visible{outline:2px solid var(--dsw-alias-accent);outline-offset:3px}
.dsh-my-notify-p-auto{min-height:32px;padding:0 4px;border:0;background:none;color:var(--dsw-alias-link);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-notify-p-card-hint{margin:10px 0 0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);line-height:1.6}
.dsh-my-notify-p-actions{display:flex;align-items:center;gap:14px;flex:none;margin-top:6px;padding:12px 2px 2px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-my-notify-p-reset{min-height:36px;padding:0 4px;border:0;background:none;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-notify-p-reset:hover{color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-status{margin:0 auto 0 0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-p-status[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}
.dsh-my-notify-p-status[data-kind="ok"]{color:var(--dsw-alias-state-success-primary)}
.dsh-my-notify-p-btn{min-height:44px;padding:0 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);cursor:pointer}
.dsh-my-notify-p-btn:hover{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-btn-primary{padding:0 22px;border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground);font:var(--dsw-font-xs-strong-13)}
.dsh-my-notify-p-btn-primary:hover{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground);opacity:.88}
.dsh-my-notify-p-btn:focus-visible{outline:2px solid var(--dsw-alias-accent);outline-offset:3px}
.dsh-my-notify-p-drawer{position:fixed;inset:0;z-index:3000;display:flex;justify-content:flex-end}
.dsh-my-notify-p-drawer-scrim{position:absolute;inset:0;background:color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent)}
.dsh-my-notify-p-drawer-panel{position:relative;display:flex;flex-direction:column;width:min(640px,100%);height:100%;background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);box-shadow:-18px 0 48px rgba(0,0,0,.16)}
.dsh-my-notify-p-drawer-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-my-notify-p-drawer-title{margin:0;font:var(--dsw-font-s-strong-14)}
.dsh-my-notify-p-drawer-tabs{display:flex;gap:4px;padding:8px 18px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-my-notify-p-drawer-tab{min-height:40px;padding:0 12px;border:0;border-bottom:2px solid transparent;background:none;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);cursor:pointer}
.dsh-my-notify-p-drawer-tab[aria-selected="true"]{border-bottom-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-drawer-body{flex:1;min-height:0;overflow:auto;padding:14px 18px 24px}
.dsh-my-notify-p-drawer-body .dsh-my-notify-toggle{width:38px;min-width:38px;height:22px;min-height:22px;border-radius:999px}
.dsh-my-notify-p-drawer-body .dsh-my-notify-toggle::after{top:3px;left:3px;width:16px;height:16px}
.dsh-my-notify-p-drawer-body .dsh-my-notify-toggle[data-on="true"]::after{transform:translateX(16px)}
.dsh-my-notify-p-drawer-close{margin-left:auto;min-height:40px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer}
@media (prefers-reduced-motion:reduce){.dsh-my-notify-panel *{transition:none!important}}
@container (max-width: 719px){
.dsh-my-notify-p-grid{grid-template-columns:minmax(0,1fr);gap:22px}
.dsh-my-notify-p-head-side{flex-direction:row;align-items:center}
.dsh-my-notify-p-preview{order:-1}
.dsh-my-notify-p-lede{max-width:none}
.dsh-my-notify-p-meta{display:none}
}
`

    'use strict'
const PANEL_EVENT_VARS = {
  end: ['session.title', 'session.durationText', 'tokens.text', 'event.time'],
  ask: ['session.title', 'ask.summary', 'event.time'],
  approval: ['session.title', 'approval.reason', 'tool.name', 'event.time'],
  subagentEnd: ['session.title', 'session.durationText', 'event.note', 'event.time'],
  remote: ['session.title', 'event.note', 'event.time'],
}
function panelEventLabel(key) {
  if (key === 'ask') return strings.kindAsk()
  if (key === 'approval') return strings.kindApproval()
  if (key === 'subagentEnd') return strings.panelSubagentEnd()
  if (key === 'remote') return strings.panelRemote()
  return strings.eventEnd()
}
const PANEL_VAR_LABELS = {
  'session.title': '会话标题',
  'session.project': '项目',
  'session.durationText': '耗时',
  'session.url': '链接',
  'tokens.text': 'Token',
  'event.time': '时间',
  'event.note': '备注',
  'ask.summary': '提问',
  'ask.question': '完整提问',
  'approval.reason': '审批',
  'tool.name': '工具',
}
function panelVarLabel(item) {
  const fixed = PANEL_VAR_LABELS[item.name]
  if (fixed !== undefined) return fixed
  const base = typeof item.description === 'string' && item.description !== '' ? item.description : item.name
  const cut = base.split(/[（(·,，]/)[0].trim()
  return cut.length > 8 ? cut.slice(0, 8) : cut
}
const PANEL_FILL_VARS = [
  'session.project',
  'session.durationText',
  'tokens.text',
  'event.note',
  'approval.reason',
  'tool.name',
  'session.url',
]
function panelPickVars(groups, active) {
  const all = []
  for (const group of groups) for (const item of group.items) all.push(item)
  const picked = []
  const add = (name) => {
    if (picked.length >= 6) return
    const hit = all.find((item) => item.name === name)
    if (hit !== undefined && !picked.includes(hit)) picked.push(hit)
  }
  for (const name of PANEL_EVENT_VARS[active] ?? []) add(name)
  for (const name of PANEL_FILL_VARS) add(name)
  for (const item of all) {
    if (picked.length >= 6) break
    if (!picked.includes(item)) picked.push(item)
  }
  return picked.slice(0, 6)
}
function PanelCompose(props) {
  return createElement(
    'section',
    { className: 'dsh-my-notify-p-compose', 'aria-label': panelEventLabel(props.active) },
    panelComposeHead(props),
    panelComposeFields(props),
    panelVarRow(props),
    props.varsOpen ? panelVarSheet(props) : null,
    panelDelivery(props),
    props.active === 'ask' ? panelAskMode(props) : null,
  )
}
function panelComposeHead(props) {
  const staticRemote = props.active === 'remote'
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-compose-head' },
    createElement(
      'div',
      null,
      createElement('h2', { className: 'dsh-my-notify-p-event' }, panelEventLabel(props.active)),
      createElement('p', { className: 'dsh-my-notify-p-event-sub' }, strings.panelEventDesc(props.active)),
    ),
    staticRemote
      ? createElement(
          'span',
          { className: 'dsh-my-notify-p-switch', 'data-static': 'true' },
          strings.panelEventAlways(),
        )
      : createElement(
          'label',
          { className: 'dsh-my-notify-p-switch' },
          createElement('span', null, strings.panelEventNotify()),
          createElement('input', {
            type: 'checkbox',
            checked: props.enabled,
            'aria-label': strings.panelEventNotify(),
            onChange: (event) => props.onToggle(event.target.checked),
          }),
          createElement('i'),
        ),
  )
}
function panelComposeFields(props) {
  return [
    createElement(
      'div',
      { key: 'title', className: 'dsh-my-notify-p-field' },
      createElement(
        'div',
        { className: 'dsh-my-notify-p-label-row' },
        createElement(
          'label',
          { className: 'dsh-my-notify-p-label', htmlFor: 'dsh-my-notify-title' },
          strings.tplTitle(),
        ),
      ),
      createElement('input', {
        id: 'dsh-my-notify-title',
        className: 'dsh-my-notify-p-input',
        type: 'text',
        value: props.template.title,
        spellCheck: false,
        'aria-label': strings.tplTitle(),
        onFocus: (event) => props.onTarget('title', event.target.selectionStart ?? 0),
        onSelect: (event) => props.onTarget('title', event.target.selectionStart ?? 0),
        onChange: (event) => {
          props.onTarget('title', event.target.selectionStart ?? event.target.value.length)
          props.onPatch({ title: event.target.value, body: props.template.body })
        },
      }),
    ),
    createElement(
      'div',
      { key: 'body', className: 'dsh-my-notify-p-field' },
      createElement(
        'div',
        { className: 'dsh-my-notify-p-label-row' },
        createElement(
          'label',
          { className: 'dsh-my-notify-p-label', htmlFor: 'dsh-my-notify-body' },
          strings.tplBody(),
        ),
        createElement('span', { className: 'dsh-my-notify-p-hint' }, strings.panelTemplateHint()),
      ),
      createElement('textarea', {
        id: 'dsh-my-notify-body',
        className: 'dsh-my-notify-p-textarea',
        value: props.template.body,
        spellCheck: false,
        'aria-label': strings.tplBody(),
        onFocus: (event) => props.onTarget('body', event.target.selectionStart ?? 0),
        onSelect: (event) => props.onTarget('body', event.target.selectionStart ?? 0),
        onChange: (event) => {
          props.onTarget('body', event.target.selectionStart ?? event.target.value.length)
          props.onPatch({ title: props.template.title, body: event.target.value })
        },
      }),
    ),
  ]
}
function panelVarRow(props) {
  const picked = panelPickVars(props.groups, props.active)
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-vars' },
    createElement('span', { className: 'dsh-my-notify-p-vars-label' }, strings.panelInsert()),
    picked.length === 0
      ? createElement('span', { className: 'dsh-my-notify-p-hint' }, strings.panelNoVars())
      : picked.map((item) =>
          createElement(
            'button',
            {
              key: item.name,
              type: 'button',
              className: 'dsh-my-notify-p-var',
              title: '{{' + item.name + '}} · ' + item.description,
              onClick: () => props.onInsert(item.name),
            },
            panelVarLabel(item),
          ),
        ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-p-var-more', onClick: props.onToggleVars },
      props.varsOpen ? strings.panelClose() : strings.panelAllVars(),
    ),
  )
}
function panelVarSheet(props) {
  return createElement(
    'div',
    { key: 'sheet', className: 'dsh-my-notify-p-var-sheet' },
    createElement(VariableLibrary, { groups: props.groups, onInsert: props.onInsert }),
  )
}
function panelDelivery(props) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-delivery' },
    createElement(
      'div',
      { className: 'dsh-my-notify-p-delivery-head' },
      createElement('span', { className: 'dsh-my-notify-p-label' }, strings.panelDelivery()),
      createElement('span', { className: 'dsh-my-notify-p-hint' }, strings.panelDeliveryHint()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-p-chips' },
      panelFeishuChip(props),
      panelPrefChip(props, 'system', strings.panelSystem(), strings.panelSystemHint(), LS.notify, 'system'),
      panelPrefChip(props, 'toast', strings.panelToast(), strings.panelToastHint(), LS.toast, 'toast'),
      panelPrefChip(props, 'sound', strings.panelSound(), strings.panelSoundHint(), LS.sound, 'sound'),
    ),
  )
}
function panelFeishuChip(props) {
  const configured = panelFeishuConfigured(props.draft)
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-notify-p-chip',
      'aria-pressed': String(configured),
      'aria-haspopup': 'dialog',
      title: configured ? strings.panelFeishuOn() : strings.panelFeishuOff(),
      onClick: props.onOpenChannel,
    },
    createElement('i'),
    strings.panelFeishu(),
  )
}
function panelFeishuConfigured(draft) {
  const list = Array.isArray(draft.webhooks) ? draft.webhooks : []
  return list.some((webhook) => webhook.channel === 'feishu')
}
function panelPrefChip(props, key, label, hint, lsKey, configKey) {
  const config = props.draft[configKey] ?? defaultConfig()[configKey] ?? { enabled: true }
  const on = prefOn(lsKey, config.enabled !== false)
  const toggle = () => {
    const next = !on
    props.patch(configKey, { ...config, enabled: next })
    writePref(lsKey, next)
  }
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-notify-p-chip',
      'aria-pressed': String(on),
      title: hint,
      onClick: toggle,
    },
    createElement('i'),
    label,
  )
}
function panelAskMode(props) {
  const mode = props.draft.askMode === 'summary' ? 'summary' : 'full'
  const options = [
    { value: 'full', label: strings.askModeFull() },
    { value: 'summary', label: strings.askModeSummary() },
  ]
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-ask' },
    createElement('span', { className: 'dsh-my-notify-p-label' }, strings.askModeTitle()),
    createElement(
      'div',
      { className: 'dsh-my-notify-p-ask-row' },
      options.map((option) =>
        createElement(
          'button',
          {
            key: option.value,
            type: 'button',
            className: 'dsh-my-notify-p-seg',
            'aria-selected': String(option.value === mode),
            onClick: () => props.patch('askMode', option.value),
          },
          option.label,
        ),
      ),
    ),
  )
}

    'use strict'
function panelCardTone(card) {
  const tone = card !== null && card !== undefined && typeof card.template === 'string' ? card.template : ''
  return CARD_ACCENTS.some((option) => option.value === tone) ? tone : ''
}
function PanelPreview(props) {
  return createElement(
    'aside',
    { className: 'dsh-my-notify-p-preview', 'aria-label': strings.panelPreview() },
    createElement(
      'div',
      { className: 'dsh-my-notify-p-preview-head' },
      createElement('span', null, strings.panelPreview()),
      createElement('span', { className: 'dsh-my-notify-p-hint' }, strings.panelPreviewLive()),
    ),
    panelPreviewStage(props),
    panelCardColors(props),
    createElement(
      'p',
      { className: 'dsh-my-notify-p-card-hint' },
      props.hasChannel ? strings.panelCardHint() : strings.panelCardNoChannel(),
    ),
  )
}
function panelPreviewStage(props) {
  if (props.preview !== null && props.status === 'ready') {
    return createElement('div', {
      className: 'dsh-my-notify-p-card-stage',
      dangerouslySetInnerHTML: { __html: renderFeishuCardHtml(props.preview.card) },
    })
  }
  return [
    createElement(
      'div',
      { key: 'stage', className: 'dsh-my-notify-p-card-skeleton' },
      props.status === 'loading'
        ? strings.previewLoading()
        : props.status === 'idle'
          ? strings.panelPreviewEmpty()
          : strings.previewFailed(),
    ),
    props.notice.text !== '' && props.notice.kind !== 'status'
      ? createElement(
          'p',
          { key: 'notice', className: 'dsh-my-notify-p-preview-status', 'data-kind': props.notice.kind },
          props.notice.text,
          props.notice.retry
            ? createElement(
                'button',
                { type: 'button', className: 'dsh-my-notify-p-auto', onClick: props.onRetry },
                strings.previewRetry(),
              )
            : null,
        )
      : null,
  ]
}
function panelCardColors(props) {
  const active = props.hasChannel ? panelCardTone(props.card) : ''
  const disable = props.hasChannel ? undefined : true
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-dots' },
    createElement('span', null, strings.panelCardColor()),
    CARD_ACCENTS.map((option) =>
      createElement('button', {
        key: option.value,
        type: 'button',
        className: 'dsh-my-notify-p-dot',
        'data-tone': option.value,
        'aria-label': option.label(),
        'aria-pressed': String(active === option.value),
        disabled: disable,
        title: props.hasChannel ? option.label() : strings.panelCardNoChannel(),
        onClick: () => props.onPatchCard({ ...props.card, template: option.value }),
      }),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-notify-p-auto',
        'aria-pressed': String(active === ''),
        disabled: disable,
        title: props.hasChannel ? strings.panelCardAuto() : strings.panelCardNoChannel(),
        onClick: () => props.onPatchCard({ ...props.card, template: '', accentByKind: true }),
      },
      strings.panelCardAuto(),
    ),
  )
}

    'use strict'
function PanelDrawer(props) {
  useEffect(() => {
    if (props.open === null) return
    const onKey = (event) => {
      if (event.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props.open])
  if (props.open === null) return null
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-drawer' },
    createElement('div', { className: 'dsh-my-notify-p-drawer-scrim', onClick: props.onClose }),
    createElement(
      'div',
      {
        className: 'dsh-my-notify-p-drawer-panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': strings.panelMoreTitle(),
        onClick: (event) => event.stopPropagation(),
      },
      panelDrawerHead(props),
      panelDrawerTabs(props),
      createElement('div', { className: 'dsh-my-notify-p-drawer-body' }, panelDrawerPane(props)),
    ),
  )
}
function panelDrawerHead(props) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-drawer-head' },
    createElement('h2', { className: 'dsh-my-notify-p-drawer-title' }, strings.panelMoreTitle()),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-p-drawer-close', onClick: props.onClose },
      strings.panelClose(),
    ),
  )
}
function panelDrawerTabs(props) {
  const tabs = [
    { value: 'channel', label: strings.paneChannel() },
    { value: 'present', label: strings.panePresent() },
    { value: 'secure', label: strings.paneSecure() },
  ]
  return createElement(
    'div',
    { className: 'dsh-my-notify-p-drawer-tabs', role: 'tablist', 'aria-label': strings.panelMoreTitle() },
    tabs.map((tab) =>
      createElement(
        'button',
        {
          key: tab.value,
          type: 'button',
          className: 'dsh-my-notify-p-drawer-tab',
          role: 'tab',
          'aria-selected': String(props.open === tab.value),
          onClick: () => props.onOpen(tab.value),
        },
        tab.label,
      ),
    ),
  )
}
function panelDrawerPane(props) {
  if (props.open === 'present') return createElement(PanelPresentPane, props)
  if (props.open === 'secure') return createElement(PanelSecurePane, props)
  return createElement(PanelChannelPane, props)
}
function PanelChannelPane(props) {
  return createElement(WebhookSection, {
    webhooks: props.draft.webhooks ?? [],
    apiToken: props.apiToken,
    onPatchWebhooks: (next) => props.patch('webhooks', next),
  })
}
function PanelPresentPane(props) {
  return renderPresentPane(props.draft, props.patch, props.volume, props.onVolumeChange)
}
function PanelSecurePane(props) {
  return renderSecurePane(props.draft, props.patch, props.apiToken, props.onTest)
}

    'use strict'
const PANEL_EVENTS = ['ask', 'approval', 'end', 'subagentEnd', 'remote']
function NotifyPanel(props) {
  const [active, setActive] = useState('ask')
  const [drawer, setDrawer] = useState(null)
  const [groups, setGroups] = useState([])
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState('idle')
  const [attempt, setAttempt] = useState(0)
  const [target, setTarget] = useState('body')
  const [caret, setCaret] = useState(0)
  const [varsOpen, setVarsOpen] = useState(false)
  const template = messageOf(props.draft.messages, active)
  useVariables(setGroups)
  usePreview(
    { messages: props.draft.messages, card: props.feishuCard },
    active,
    template,
    attempt,
    setPreview,
    setStatus,
  )
  const insert = makePanelInsert(props, active, template, target, caret, setCaret)
  const notice = previewNoticeOf(status)
  const view = { active, template, groups, preview, status, notice, target, caret, varsOpen, attempt }
  const actions = { setActive, setDrawer, setVarsOpen, setTarget, setCaret, setAttempt, insert }
  return createElement(
    'div',
    { className: 'dsh-my-notify-panel' },
    panelHead(props, () => setDrawer('channel')),
    panelTabs(active, (key) => {
      setActive(key)
      setCaret(0)
      setVarsOpen(false)
    }),
    panelMain(props, view, actions),
    panelFoot(props),
    createElement(PanelDrawer, {
      open: drawer,
      onOpen: setDrawer,
      onClose: () => setDrawer(null),
      draft: props.draft,
      patch: props.patch,
      volume: props.volume,
      onVolumeChange: props.onVolumeChange,
      apiToken: props.apiToken,
      onTest: props.onTest,
    }),
  )
}
function panelMain(props, view, actions) {
  return createElement(
    'main',
    { className: 'dsh-my-notify-p-grid' },
    createElement(PanelCompose, {
      active: view.active,
      template: view.template,
      enabled: panelEventEnabled(props.draft, view.active),
      onToggle: (on) => {
        if (view.active !== 'remote') props.patch(view.active, on)
      },
      onPatch: (next) => panelPatchMessage(props.draft, props.patch, view.active, next),
      onReset: () => panelPatchMessage(props.draft, props.patch, view.active, defaultMessageFor(view.active)),
      groups: view.groups,
      varsOpen: view.varsOpen,
      onToggleVars: () => actions.setVarsOpen(!view.varsOpen),
      onInsert: actions.insert,
      onTarget: (nextTarget, at) => {
        actions.setTarget(nextTarget)
        actions.setCaret(at)
      },
      draft: props.draft,
      patch: props.patch,
      onOpenChannel: () => actions.setDrawer('channel'),
    }),
    createElement(PanelPreview, {
      preview: view.preview,
      status: view.status,
      notice: view.notice,
      onRetry: () => actions.setAttempt(view.attempt + 1),
      card: props.feishuCard,
      hasChannel: props.hasFeishuCard,
      onPatchCard: props.onPatchFeishuCard,
    }),
  )
}
function panelHead(props, onOpenMore) {
  const channels = panelChannelCount(props.draft)
  return createElement(
    'header',
    { className: 'dsh-my-notify-p-head' },
    createElement(
      'div',
      null,
      createElement('p', { className: 'dsh-my-notify-p-kicker' }, strings.panelKicker()),
      createElement('h1', { className: 'dsh-my-notify-p-title' }, strings.panelTitle()),
      createElement('p', { className: 'dsh-my-notify-p-lede' }, strings.panelLede()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-p-head-side' },
      createElement('p', { className: 'dsh-my-notify-p-meta' }, strings.panelMeta(PANEL_EVENTS.length, channels)),
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-notify-p-ghost', 'aria-haspopup': 'dialog', onClick: onOpenMore },
        strings.panelMore(),
      ),
    ),
  )
}
function panelTabs(active, onPick) {
  return createElement(
    'nav',
    { className: 'dsh-my-notify-p-tabs', role: 'tablist', 'aria-label': strings.panelTitle() },
    PANEL_EVENTS.map((key) =>
      createElement(
        'button',
        {
          key,
          type: 'button',
          role: 'tab',
          className: 'dsh-my-notify-p-tab',
          'aria-selected': String(key === active),
          onClick: () => onPick(key),
        },
        panelEventLabel(key),
      ),
    ),
  )
}
function panelFoot(props) {
  const kind = props.error ? 'error' : props.dirty ? 'idle' : props.saved ? 'ok' : 'idle'
  const text = props.error ? strings.saveFailed() : props.dirty ? strings.dirty() : props.saved ? strings.saved() : ''
  return createElement(
    'footer',
    { className: 'dsh-my-notify-p-actions' },
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-p-reset', onClick: props.onReset },
      strings.panelResetCopy(),
    ),
    createElement('p', { className: 'dsh-my-notify-p-status', 'data-kind': kind, 'aria-live': 'polite' }, text),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-p-btn dsh-my-notify-p-btn-primary', onClick: props.save },
      strings.panelSave(),
    ),
  )
}
function panelPatchMessage(draft, patch, key, template) {
  const messages = { ...(draft.messages ?? defaultMessages()) }
  messages[key] = template
  patch('messages', messages)
}
function panelEventEnabled(draft, key) {
  if (key === 'remote') return true
  return draft[key] === true
}
function panelChannelCount(draft) {
  const list = Array.isArray(draft.webhooks) ? draft.webhooks : []
  return list.filter((webhook) => webhook.enabled !== false).length
}
function makePanelInsert(props, active, template, target, caret, setCaret) {
  return (name) => {
    const field = target === 'title' ? template.title : template.body
    const next = insertVar(field, caret, name)
    panelPatchMessage(
      props.draft,
      props.patch,
      active,
      target === 'title' ? { title: next.value, body: template.body } : { title: template.title, body: next.value },
    )
    setCaret(next.caret)
    if (typeof window === 'undefined') return
    window.setTimeout(() => {
      const id = target === 'title' ? 'dsh-my-notify-title' : 'dsh-my-notify-body'
      const node = document.getElementById(id)
      if (node !== null && typeof node.setSelectionRange === 'function') {
        node.focus()
        node.setSelectionRange(next.caret, next.caret)
      }
    }, 0)
  }
}

    'use strict'
const WORKBENCH_STYLES = `.dsh-my-notify-settings{container-type:inline-size;display:flex;flex-direction:column;gap:8px;padding:10px;min-height:0;height:100%}/* 顶栏：标题 + 视图分段 + 状态 + 主操作 */.dsh-my-notify-tool{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsh-my-notify-tool h1{margin:0;font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary)}.dsh-my-notify-views{display:inline-flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-interactive-bg)}.dsh-my-notify-view{height:26px;padding:0 10px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer}.dsh-my-notify-view:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-my-notify-view[aria-selected="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-strong-13)}.dsh-my-notify-tool .dsh-my-notify-actions{margin-left:auto}/* 文案工作台：三列 + 底部预览带 */.dsh-my-notify-wb{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0}.dsh-my-notify-cols{display:grid;grid-template-columns:168px minmax(0,1fr) 208px;gap:8px;flex:1;min-height:0}.dsh-my-notify-col{min-width:0;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px}.dsh-my-notify-col-hd{display:flex;align-items:center;gap:6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);padding:2px 4px}.dsh-my-notify-panel{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:8px}/* 事件列表 */.dsh-my-notify-evlist{display:flex;flex-direction:column;gap:3px}.dsh-my-notify-evbtn{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;align-items:start;width:100%;padding:7px 8px;border:1px solid transparent;border-radius:8px;background:transparent;text-align:left;cursor:pointer;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}.dsh-my-notify-evbtn:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-my-notify-evbtn[aria-current="true"]{background:var(--dsw-alias-interactive-bg);border-color:var(--dsw-alias-border-l2)}.dsh-my-notify-evd{width:7px;height:7px;border-radius:50%;margin-top:4px;background:var(--dsw-alias-label-tertiary)}.dsh-my-notify-evd[data-kind="ok"]{background:var(--dsw-alias-state-success-primary)}.dsh-my-notify-evd[data-kind="warn"]{background:var(--dsw-alias-state-warn-primary)}.dsh-my-notify-evd[data-kind="err"]{background:var(--dsw-alias-state-error-primary)}.dsh-my-notify-evname{font:var(--dsw-font-xs-strong-13)}.dsh-my-notify-evmeta{display:block;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);margin-top:1px}/* 编辑器 */.dsh-my-notify-ed{display:flex;flex-direction:column;gap:9px}.dsh-my-notify-ed-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsh-my-notify-ed-hd h2{margin:0;font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary)}.dsh-my-notify-lbl{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);margin-bottom:3px}.dsh-my-notify-inp2{width:100%;height:32px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}.dsh-my-notify-ta2{width:100%;min-height:96px;padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);line-height:1.65;resize:vertical}.dsh-my-notify-errbox{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-xxs-12)}/* 变量树 */.dsh-my-notify-vars{display:flex;flex-direction:column;gap:7px}.dsh-my-notify-varq{height:28px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}.dsh-my-notify-vgroup{display:flex;flex-direction:column;gap:4px}.dsh-my-notify-vgroup-hd{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);padding:2px 3px}.dsh-my-notify-vlist{display:flex;flex-wrap:wrap;gap:4px}.dsh-my-notify-vchip{display:inline-flex;align-items:center;height:24px;padding:0 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-my-notify-vchip:hover{border-color:var(--dsw-alias-accent);color:var(--dsw-alias-accent)}.dsh-my-notify-vchip em{font-style:normal;color:var(--dsw-alias-label-tertiary);margin-left:4px}/* 五形态预览带 */.dsh-my-notify-band{border-top:1px solid var(--dsw-alias-border-l2);padding-top:7px;display:flex;flex-direction:column;gap:6px}.dsh-my-notify-band-hd{display:flex;align-items:center;gap:8px}.dsh-my-notify-band-cols{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:8px;overflow-x:auto;padding-bottom:2px}.dsh-my-notify-band[data-open="false"] .dsh-my-notify-band-cols{display:none}.dsh-my-notify-pcol{display:flex;flex-direction:column;gap:4px;min-width:0}.dsh-my-notify-pcol-hd{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}.dsh-my-notify-pstage{min-height:96px;display:flex;align-items:flex-start;justify-content:center;padding:6px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px dashed var(--dsw-alias-border-l2);overflow:auto}/* 渠道视图：列表 + 详情 */.dsh-my-notify-chview{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:8px;flex:1;min-height:0}.dsh-my-notify-chlist{display:flex;flex-direction:column;gap:7px}.dsh-my-notify-chrow{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);text-align:left;width:100%;cursor:pointer}.dsh-my-notify-chrow:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-my-notify-chrow[aria-current="true"]{border-color:var(--dsw-alias-accent)}.dsh-my-notify-detail{display:flex;flex-direction:column;gap:9px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);overflow:auto;min-height:0}/* 卡片（呈现 / 高级 / 失败记录） */.dsh-my-notify-pane{display:flex;flex-direction:column;gap:9px}.dsh-my-notify-pane-hd{display:flex;align-items:baseline;gap:8px}.dsh-my-notify-pane-hd h2{margin:0;font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary)}.dsh-my-notify-card{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dsh-my-notify-card-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsh-my-notify-card-hd h3{margin:0;font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}.dsh-my-notify-card-bd{display:flex;flex-direction:column;gap:8px}.dsh-my-notify-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:9px}.dsh-my-notify-cardbox{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dsh-my-notify-cardbox h3{margin:0;font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}.dsh-my-notify-frow{display:grid;grid-template-columns:118px minmax(0,1fr);gap:9px;align-items:center}.dsh-my-notify-srow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}/* 窄容器（设置页 tab 内容区 <860px）：变量树进抽屉、事件改下拉、预览带 3 列 */@container (max-width: 859px){.dsh-my-notify-cols{grid-template-columns:minmax(0,1fr)}.dsh-my-notify-col-evlist,.dsh-my-notify-col-vars{display:none}.dsh-my-notify-evselect{display:block}.dsh-my-notify-band-cols{grid-template-columns:repeat(3,minmax(150px,1fr))}.dsh-my-notify-chview{grid-template-columns:minmax(0,1fr)}.dsh-my-notify-chrow{min-height:44px}}.dsh-my-notify-evselect{display:none;height:34px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}.dsh-my-notify-drawer-vars{position:absolute;right:0;top:0;bottom:0;width:min(260px,80%);z-index:5;background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);padding:10px;overflow:auto;box-shadow:var(--dsw-shadow-lv2)}.dsh-my-notify-inp2,.dsh-my-notify-ta2,.dsh-my-notify-varq,.dsh-my-notify-evselect{min-height:44px}/* 行控件（开关 / 输入 / 下拉 / 按钮 / 徽标）——沿用组件类名，尺寸按工作台密度 */.dsh-my-notify-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.dsh-my-notify-info{display:flex;flex-direction:column;gap:2px;min-width:0}.dsh-my-notify-label{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}.dsh-my-notify-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.55}.dsh-my-notify-toggle{flex:none;min-width:36px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}.dsh-my-notify-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}.dsh-my-notify-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out)}.dsh-my-notify-toggle[data-on="true"]::after{transform:translateX(14px);background:var(--dsw-alias-label-primary-foreground)}.dsh-my-notify-input{height:28px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);min-width:0}.dsh-my-notify-select{height:28px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}.dsh-my-notify-range{flex:none;width:120px;accent-color:var(--dsw-alias-state-success-primary);cursor:pointer}.dsh-my-notify-range-value{flex:none;min-width:38px;text-align:right;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}.dsh-my-notify-actions{display:flex;align-items:center;gap:6px}.dsh-my-notify-btn{min-height:26px;padding:0 10px;border-radius:7px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}.dsh-my-notify-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-my-notify-btn-primary{border-color:transparent;background:var(--dsw-alias-accent);color:var(--dsw-alias-label-primary-foreground)}.dsh-my-notify-btn-danger{color:var(--dsw-alias-state-error-primary)}.dsh-my-notify-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}.dsh-my-notify-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}.dsh-my-notify-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}.dsh-my-notify-badge{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg)}.dsh-my-notify-badge[data-kind="ok"]{color:var(--dsw-alias-state-success-primary)}.dsh-my-notify-badge[data-kind="warn"]{color:var(--dsw-alias-state-warn-primary)}.dsh-my-notify-badge[data-kind="err"]{color:var(--dsw-alias-state-error-primary)}.dsh-my-notify-badge[data-kind="accent"]{color:var(--dsw-alias-accent)}.dsh-my-notify-grow{flex:1;min-width:0}.dsh-my-notify-divider{height:1px;background:var(--dsw-alias-border-l2)}.dsh-my-notify-segmented{display:inline-flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-interactive-bg);flex-wrap:wrap}.dsh-my-notify-seg{min-height:24px;padding:0 8px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer}.dsh-my-notify-seg[aria-selected="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-strong-13)}/* 触达：窄容器 ≥44，桌面 ≥24 */@media (max-width: 900px){.dsh-my-notify-toggle{min-height:44px}/* 预览带内三种非飞书形态（HTML 由 copy-model 的 renderPreviewFrame 产出） */.dsh-my-notify-pv-sys{display:flex;align-items:flex-start;gap:8px;width:100%;padding:8px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2)}.dsh-my-notify-pv-sys-ico{display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;flex:none;background:var(--dsw-alias-accent);color:var(--dsw-alias-label-primary-foreground);font:var(--dsw-font-xxxs-strong-11)}.dsh-my-notify-pv-sys-title{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);-webkit-line-clamp:2;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis}.dsh-my-notify-pv-sys-body{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.55;-webkit-line-clamp:3;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;word-break:break-word}.dsh-my-notify-pv-sys-time{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);flex:none}.dsh-my-notify-pv-toast{display:flex;align-items:flex-start;gap:8px;width:100%;padding:8px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2)}.dsh-my-notify-pv-toast-bar{width:3px;align-self:stretch;border-radius:2px;flex:none;background:var(--dsw-alias-accent)}.dsh-my-notify-pv-wx{width:100%;padding:8px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2)}.dsh-my-notify-pv-wx-hd{display:flex;align-items:center;gap:6px;font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary)}.dsh-my-notify-pv-wx-hd i{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-accent)}.dsh-my-notify-pv-wx-bd{margin-top:5px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.55;-webkit-line-clamp:3;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;word-break:break-word}/* 变量树：名字 12 / 说明 11（名字不得比说明小），超长省略 + title 全名 */.dsh-my-notify-vchip{gap:3px}.dsh-my-notify-vname{font:var(--dsw-font-xxs-strong-12);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.dsh-my-notify-vdesc{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}@container (max-width: 859px){.dsh-my-notify-varq{min-height:44px}}
`
const SETTINGS_STYLES = WORKBENCH_STYLES + WEBHOOK_STYLES + (typeof PANEL_STYLES !== 'undefined' ? PANEL_STYLES : '')


    // ── 设置页外壳（简版面板 + 更多设置抽屉）──────────────────────────
    'use strict'
function saveConfig(draft, setSaved, setError, onSaved) {
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
      if (typeof onSaved === 'function') onSaved()
    })
    .catch(() => setError(true))
}
function useNotifyConfig(state) {
  useEffect(() => {
    fetch('/notify/api/config')
      .then((res) => res.json())
      .then((body) => {
        if (body === null || body.ok !== true) throw new Error('bad config response')
        state.setConfig(body.value)
        state.setDraft(body.value)
        syncPrefsFromConfig(body.value)
        state.setVolume(prefNum(LS.volume, prefVolume()))
        state.setLoading(false)
      })
      .catch(() => {
        state.setLoading(false)
        state.setError(true)
      })
  }, [])
}
function parseSamplePayload(sample) {
  try {
    const parsed = JSON.parse(sample)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
function NotifySettingsView() {
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [volume, setVolume] = useState(() => prefVolume())
  useNotifyConfig({ setConfig, setDraft, setLoading, setError, setVolume })
  if (loading) {
    return createElement(
      'div',
      { className: 'dsh-my-notify-settings' },
      createElement('div', { className: 'dsh-my-notify-status' }, strings.loading()),
    )
  }
  if (config === null || draft === null) {
    return createElement(
      'div',
      { className: 'dsh-my-notify-settings' },
      createElement('div', { className: 'dsh-my-notify-errbox' }, strings.loadError()),
    )
  }
  return createElement(NotifySettingsLoaded, {
    config,
    draft,
    setConfig,
    setDraft,
    saved,
    setSaved,
    error,
    setError,
    volume,
    setVolume,
  })
}
function NotifySettingsLoaded(props) {
  const current = configOf(props.draft)
  const patch = (key, value) => {
    if (key === '__import__') {
      props.setDraft({ ...current, ...value })
      return
    }
    props.setDraft({ ...current, [key]: value })
  }
  const webhooks = Array.isArray(current.webhooks) ? current.webhooks : []
  const feishuIndex = webhooks.findIndex((webhook) => webhook.channel === 'feishu' && webhook.msgType === 'interactive')
  const feishuCard = feishuIndex >= 0 ? cardOf(webhooks[feishuIndex]) : defaultCard()
  const panelProps = {
    draft: current,
    patch,
    save: () =>
      saveConfig(current, props.setSaved, props.setError, () => {
        props.setConfig(current)
        invalidateRuntimeConfig()
      }),
    saved: props.saved,
    error: props.error,
    dirty: JSON.stringify(current) !== JSON.stringify(props.config),
    volume: props.volume,
    onVolumeChange: props.setVolume,
    apiToken: typeof current.apiToken === 'string' ? current.apiToken : '',
    feishuCard,
    hasFeishuCard: feishuIndex >= 0,
    onPatchFeishuCard: (card) => {
      if (feishuIndex < 0) return
      const next = webhooks.slice()
      next[feishuIndex] = { ...next[feishuIndex], card }
      patch('webhooks', next)
    },
    onTest: (kind, sample, done) => {
      fetch('/notify/api/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-notify-token': current.apiToken ?? '' },
        body: JSON.stringify({ ...parseSamplePayload(sample), kind }),
      })
        .then((res) => res.json())
        .then((body) => done(body !== null && body !== undefined && body.ok === true))
        .catch(() => done(false, strings.secureRemoteFail()))
    },
    onReset: () => {
      props.setDraft({ ...current, messages: defaultMessages(), askMode: 'full' })
      props.setSaved(false)
    },
  }
  return createElement(NotifyPanel, panelProps)
}
function attachSettingsTab(ctx) {
  const slots = ctx.get('slots', false)
  if (slots === undefined) return
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-my-notify-settings', 'styles')
    style.textContent = SETTINGS_STYLES + CARD_PREVIEW_STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode !== null) style.parentNode.removeChild(style)
    }
  }, 'dsh-my-notify: settings styles')
  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          { name: 'settings.plugins.tab', id: 'notify-settings', order: 91, label: () => strings.panelTabLabel() },
          NotifySettingsView,
        ),
      ),
    'dsh-my-notify: settings tab registration',
  )
}


    return module.exports
  },
})
