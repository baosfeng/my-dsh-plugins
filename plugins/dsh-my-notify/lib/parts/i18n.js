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
