// ── i18n（浏览器语言判定）──────────────────────────────────────────
function isZh(): boolean {
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
  untitled: (short: string) =>
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

function prefOn(key: string, def: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key)
    if (v === null) return def
    return v === '1'
  } catch {
    return def
  }
}

/** 提示音音量（0~1，默认 0.6；issue #71：0.18 太小听不见）。 */
function prefVolume(): number {
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
