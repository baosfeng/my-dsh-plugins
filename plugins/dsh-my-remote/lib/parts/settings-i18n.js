// ── 设置页 i18n（issue #385）──────────────────────────────────────────────
// 判据照抄本仓库设置页惯例（见 docs/UI规范.md「文案与国际化」）：能读到
// <html lang>（宿主 locale）时优先它——避免「浏览器英文 + 宿主中文」错配；
// 否则看 navigator.language 前缀；都取不到按英文。
//
// **文案一律写成惰性函数**（宿主 `settings.plugins.tab` 的 label 靠重注册跟随
// 语言切换），且**每种语言只出一份**——「中文 (English)」并排塞进同一段会让设置
// 行视觉臃肿，是本仓库已纠正的写法。
//
// 本文件是 part 片段（构建期拼接进 __ModuleLoader__ factory 作用域，见
// scripts/build.mjs），无 import/export。

/** 当前是否中文界面。 */
function myRemoteIsZh() {
  try {
    const htmlLang = typeof document !== 'undefined' ? document.documentElement?.lang : undefined
    if (typeof htmlLang === 'string' && htmlLang !== '') return htmlLang.toLowerCase().startsWith('zh')
    return (navigator.language || 'en').toLowerCase().startsWith('zh')
  } catch {
    return false
  }
}

/** 设置页文案（按当前语言返回单语；每次调用重新判定，不缓存）。 */
const MY_REMOTE_STRINGS = {
  tabLabel: () => (myRemoteIsZh() ? '远程控制' : 'Remote control'),
  tokenSection: () => (myRemoteIsZh() ? '鉴权' : 'Authentication'),
  tokenLabel: () => (myRemoteIsZh() ? 'API Token' : 'API token'),
  tokenHint: () => (myRemoteIsZh() ? '已配置，留空则不修改' : 'Configured; leave blank to keep the current value'),
  tokenHintEmpty: () => (myRemoteIsZh() ? '未配置，仅靠本机围栏保护' : 'Not set; loopback fence only'),
  tokenPlaceholder: () => (myRemoteIsZh() ? '留空则不修改' : 'Leave blank to keep'),
  timeoutSection: () => (myRemoteIsZh() ? '等待超时' : 'Waiting timeouts'),
  askTimeoutLabel: () => (myRemoteIsZh() ? '回答超时' : 'Answer timeout'),
  askTimeoutHint: () => (myRemoteIsZh() ? '毫秒，0 表示无限等待' : 'Milliseconds; 0 waits indefinitely'),
  approvalTimeoutLabel: () => (myRemoteIsZh() ? '批准超时' : 'Approval timeout'),
  approvalTimeoutHint: () =>
    myRemoteIsZh() ? '毫秒，0 表示无限等待；超时按拒绝处理' : 'Milliseconds; 0 waits indefinitely, otherwise rejects',
  webhookSection: () => (myRemoteIsZh() ? '出站 Webhook' : 'Outbound webhooks'),
  webhookEmpty: () => (myRemoteIsZh() ? '暂无 webhook' : 'No webhooks yet'),
  webhookAdd: () => (myRemoteIsZh() ? '添加' : 'Add'),
  webhookEdit: () => (myRemoteIsZh() ? '编辑' : 'Edit'),
  webhookDelete: () => (myRemoteIsZh() ? '删除' : 'Delete'),
  webhookConfirmDelete: () => (myRemoteIsZh() ? '确认删除' : 'Confirm'),
  webhookCancel: () => (myRemoteIsZh() ? '取消' : 'Cancel'),
  webhookSave: () => (myRemoteIsZh() ? '确定' : 'OK'),
  webhookName: () => (myRemoteIsZh() ? '名称' : 'Name'),
  webhookNamePlaceholder: () => (myRemoteIsZh() ? '例如：我的中转服务' : 'e.g. my relay'),
  webhookUrl: () => (myRemoteIsZh() ? 'URL' : 'URL'),
  webhookEvents: () => (myRemoteIsZh() ? '事件（不选 = 全部）' : 'Events (none selected = all)'),
  eventAll: () => (myRemoteIsZh() ? '全部事件' : 'All events'),
  webhookEnabled: () => (myRemoteIsZh() ? '启用' : 'Enabled'),
  webhookHeadersNote: () =>
    myRemoteIsZh()
      ? '自定义 headers 请在 cordis.patch.yml 配置，保存不会覆盖'
      : 'Custom headers live in cordis.patch.yml; saving keeps them',
  loading: () => (myRemoteIsZh() ? '加载中…' : 'Loading…'),
  loadFailed: () => (myRemoteIsZh() ? '配置加载失败' : 'Failed to load settings'),
  save: () => (myRemoteIsZh() ? '保存' : 'Save'),
  saved: () => (myRemoteIsZh() ? '已保存' : 'Saved'),
  saveFailed: () => (myRemoteIsZh() ? '保存失败' : 'Save failed'),
  retry: () => (myRemoteIsZh() ? '重试' : 'Retry'),
  errorRouteMissing: () =>
    myRemoteIsZh()
      ? '服务端插件未加载：' + MY_REMOTE_SETTINGS_API + ' 不存在（请确认已安装并启用 dsh-my-remote 后重启 DSH）'
      : 'Server plugin not loaded: ' +
        MY_REMOTE_SETTINGS_API +
        ' is missing (install and enable dsh-my-remote, then restart DSH)',
  errorForbidden: () =>
    myRemoteIsZh()
      ? '请求被安全围栏拒绝（403）：请检查网络/代理设置'
      : 'Rejected by the security fence (403): check network/proxy settings',
  errorNetwork: () =>
    myRemoteIsZh()
      ? '网络错误或响应异常：请检查 DSH 服务是否正常运行'
      : 'Network error or unexpected response: check the DSH server',
}

/** 事件 kind 的显示名。 */
function myRemoteEventLabel(kind) {
  const zh = { ask: '提问', approval: '批准', end: '结束' }
  const en = { ask: 'Ask', approval: 'Approval', end: 'End' }
  const table = myRemoteIsZh() ? zh : en
  return table[kind] ?? kind
}

/** 事件列表文案（空 = 全部）。 */
function myRemoteEventsLabel(events) {
  if (!Array.isArray(events) || events.length === 0) return MY_REMOTE_STRINGS.eventAll()
  return events.map((kind) => myRemoteEventLabel(kind)).join(' / ')
}
