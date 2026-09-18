/**
 * dsh-my-remote — client half (browser). SOURCE TEMPLATE（issue #385）。
 *
 * 本插件原本是**纯 server 插件**；client 半只为承载「设置 → 插件 → 远程控制」
 * 面板：可视化编辑 apiToken（掩码）/ askTimeoutMs / approvalTimeoutMs /
 * webhooks[]，保存走 PUT /remote/settings/api/settings（host 半写回 profile
 * patch + 立即热生效）。
 *
 * BUILD NOTE: 本文件是**模板源码**，不是 DSH 实际服务的文件。scripts/build.mjs
 * 把 dsh-shared 的共享样式样板与 lib/parts/*.js 的片段按下方占位符拼接进来，
 * 写出 lib/client.js —— DSH 实际服务的 __ModuleLoader__ bundle（单一 factory
 * 作用域，无相对路径 require）。产物必须提交（CI 只跑 node --check + 测试，
 * 不跑构建）。
 *
 * 片段之间共享本 factory 作用域（函数声明可直接互调；模板里刻意**不**写它们的
 * 名字，避免 ESLint no-undef —— lib/parts/*.js 的规则已关闭 no-undef）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-remote',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // React API：设置页视图使用 createElement / useState / useEffect。
    const { createElement, useState, useEffect } = require('react')

    // ── 共享样式注入样板（dsh-shared/client-parts，issue #186 P2）──────
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


    // ── 设置页片段（lib/parts/*.js，issue #385）──────────────────────
    // 顺序有依赖：样式常量 → i18n 文案 → 配置模型/加载保存 → 通用视图 →
    // webhook 编辑器 → 主视图与页签注册（后者引用前面全部）。
    // ── 设置页样式（issue #385）────────────────────────────────────────────────
// 只用宿主语义变量（--dsw-*），跟随深浅主题，不硬编码色值。
//
// 本文件是 part 片段（构建期拼接进 __ModuleLoader__ factory 作用域），无 import/export。

const MY_REMOTE_SETTINGS_STYLES = `
.dsh-my-remote-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-my-remote-section{display:flex;flex-direction:column;gap:8px}
.dsh-my-remote-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dsh-my-remote-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-remote-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-my-remote-label{font:var(--dsw-font-xs-strong-13)}
.dsh-my-remote-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dsh-my-remote-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-remote-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-my-remote-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-remote-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dsh-my-remote-input{flex:none;width:180px;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-remote-actions{display:flex;align-items:center;gap:8px}
.dsh-my-remote-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-remote-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-remote-btn-danger{color:var(--dsw-alias-state-error-primary)}
.dsh-my-remote-btn-danger:hover{border-color:var(--dsw-alias-state-error-primary)}
.dsh-my-remote-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-my-remote-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
.dsh-my-remote-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-remote-webhook-editor{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-remote-webhook-field{display:flex;flex-direction:column;gap:4px}
.dsh-my-remote-webhook-field-label{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dsh-my-remote-webhook-input{height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-remote-webhook-events{display:flex;flex-wrap:wrap;gap:6px}
.dsh-my-remote-webhook-event{display:flex;align-items:center;gap:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}
`

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

// ── 设置页配置模型与数据加载/保存（issue #385）────────────────────────────
// 与 host 半 src/settings-model.ts 同口径：快照规整（脏值一律回退默认，绝不 throw
// 到渲染）+ PUT body 构造。**token 掩码语义**在这里收口：
//   输入框里是「新值（明文）或空串」；只有非空串才发送 apiToken —— 空串 / 未改 =
//   不发送该键 = host 半保持原值，界面永不回显完整 token。
//
// 本文件是 part 片段（构建期拼接进 __ModuleLoader__ factory 作用域，见
// scripts/build.mjs），无 import/export；跨文件函数同处一个作用域。

/** 空 webhook 模板（添加时使用）。 */
function myRemoteEmptyWebhook() {
  return { name: '', url: '', events: [], enabled: true }
}

/** 超时规整：非负整数生效，其余回退 fallback（与 host 半 normalizeTimeout 同口径）。 */
function myRemoteNormalizeTimeout(value, fallback) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
}

/** 快照 → 表单草稿（缺失 / 脏值一律回退默认，绝不 throw 到渲染）。 */
function myRemoteResolveSnapshot(raw) {
  const empty = { apiTokenSet: false, askTimeoutMs: 0, approvalTimeoutMs: 0, webhooks: [] }
  if (raw === null || typeof raw !== 'object') return empty
  return {
    apiTokenSet: raw.apiTokenSet === true,
    askTimeoutMs: myRemoteNormalizeTimeout(raw.askTimeoutMs, 0),
    approvalTimeoutMs: myRemoteNormalizeTimeout(raw.approvalTimeoutMs, 0),
    webhooks: Array.isArray(raw.webhooks)
      ? raw.webhooks.filter((webhook) => webhook !== null && typeof webhook === 'object')
      : [],
  }
}

/** 草稿 + 输入框 token → PUT body（token 为空串时不带该键 = 不修改）。 */
function myRemoteBuildPayload(draft, token) {
  const payload = {
    askTimeoutMs: draft.askTimeoutMs,
    approvalTimeoutMs: draft.approvalTimeoutMs,
    webhooks: draft.webhooks,
  }
  if (token !== '') payload.apiToken = token
  return payload
}

// ── 数据加载 / 保存 ───────────────────────────────────────────────────────

/** 加载失败提示：区分 404（服务端插件未加载）/ 403（安全围栏）/ 网络异常。 */
function myRemoteErrorHint(kind) {
  if (kind === 'http:404') return MY_REMOTE_STRINGS.errorRouteMissing()
  if (kind === 'http:403') return MY_REMOTE_STRINGS.errorForbidden()
  return MY_REMOTE_STRINGS.errorNetwork()
}

/** 拉取当前配置（成功 / 失败都落到状态上，不静默）。 */
function myRemoteLoad(apply, setLoading, setErrorKind) {
  setLoading(true)
  setErrorKind('')
  fetch(MY_REMOTE_SETTINGS_API)
    .then((res) => {
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status })
      return res.json()
    })
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('bad config response')
      apply(myRemoteResolveSnapshot(body.value))
      setLoading(false)
    })
    .catch((err) => {
      setLoading(false)
      setErrorKind(err && typeof err.status === 'number' ? 'http:' + err.status : 'network')
    })
}

/** 保存草稿（PUT 配置端点）；成功 / 失败都更新状态提示，不静默。 */
function myRemoteSave(payload, onSaved, setSaved, setFailed) {
  setSaved(false)
  setFailed(false)
  fetch(MY_REMOTE_SETTINGS_API, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('save failed')
      if (body.value !== undefined) onSaved(myRemoteResolveSnapshot(body.value))
      setSaved(true)
    })
    .catch(() => setFailed(true))
}

// ── 设置页通用视图片段（issue #385）───────────────────────────────────────
// 输入行 / 字段容器 / 加载失败视图。样式走宿主语义 token（--dsw-*），随 activation
// 注入、fiber teardown 卸载（HMR / 禁用无残留）。
//
// 本文件是 part 片段（构建期拼接进 __ModuleLoader__ factory 作用域），无 import/export。

/** 输入行（文本 / 数字 / 密码）。 */
function MyRemoteTextRow(props) {
  return createElement(
    'div',
    { className: 'dsh-my-remote-row' },
    createElement(
      'div',
      { className: 'dsh-my-remote-info' },
      createElement('div', { className: 'dsh-my-remote-label' }, props.label),
      createElement('div', { className: 'dsh-my-remote-hint' }, props.hint),
    ),
    createElement('input', {
      className: 'dsh-my-remote-input',
      type: props.type ?? 'text',
      value: props.value,
      placeholder: props.placeholder ?? '',
      'aria-label': props.label,
      onChange: (event) => props.onChange(event.target.value),
    }),
  )
}

/** 字段容器（label + 控件）。 */
function myRemoteField(label, control) {
  return createElement(
    'div',
    { className: 'dsh-my-remote-webhook-field' },
    createElement('div', { className: 'dsh-my-remote-webhook-field-label' }, label),
    control,
  )
}

/** 文本输入控件（webhook 编辑器内）。 */
function myRemoteInput(value, placeholder, onChange) {
  return createElement('input', {
    className: 'dsh-my-remote-webhook-input',
    value,
    placeholder,
    onChange: (event) => onChange(event.target.value),
  })
}

/** 加载失败视图：失败原因（http 状态 / 网络）+ 针对性提示 + 重试。 */
function MyRemoteLoadError(props) {
  return createElement(
    'div',
    { className: 'dsh-my-remote-settings' },
    createElement('div', { className: 'dsh-my-remote-error' }, MY_REMOTE_STRINGS.loadFailed()),
    createElement('div', { className: 'dsh-my-remote-status' }, myRemoteErrorHint(props.errorKind)),
    createElement(
      'div',
      { className: 'dsh-my-remote-actions' },
      createElement(
        'button',
        { 'data-role': 'settings-retry', className: 'dsh-my-remote-btn', onClick: props.onRetry },
        MY_REMOTE_STRINGS.retry(),
      ),
    ),
  )
}

// ── 出站 webhook 列表编辑器（issue #385）──────────────────────────────────
// 交互与样式照搬 dsh-my-notify 的出站 webhook 设置（同一套类名结构与按钮排布），
// 便于两处面板看起来是一套；字段集合按本插件的数据模型收敛为
// name / url / events / enabled（无 channel / secret / 模板；headers 不暴露，
// 由 host 半按名称继承保留）。
//
// 破坏性操作（删除）走**内联二次确认**：UI 规范要求破坏性操作二次确认、禁原生
// confirm()；确认态才出现「确认删除」，取消回到常规按钮。
//
// 本文件是 part 片段（构建期拼接进 __ModuleLoader__ factory 作用域），无 import/export。

/** 单条 webhook 显示行：名称 / URL · 事件 + 启用开关 + 编辑 / 删除。 */
function MyRemoteWebhookRow(props) {
  const enabled = props.webhook.enabled !== false
  const toggle = createElement('div', {
    className: 'dsh-my-remote-toggle',
    'data-on': String(enabled),
    role: 'switch',
    'aria-checked': String(enabled),
    'aria-label': MY_REMOTE_STRINGS.webhookEnabled(),
    onClick: () => props.onToggle(!enabled),
  })
  return createElement(
    'div',
    { className: 'dsh-my-remote-row' },
    createElement(
      'div',
      { className: 'dsh-my-remote-info' },
      createElement('div', { className: 'dsh-my-remote-label' }, props.webhook.name),
      createElement(
        'div',
        { className: 'dsh-my-remote-hint' },
        `${props.webhook.url} · ${myRemoteEventsLabel(props.webhook.events)}`,
      ),
    ),
    createElement('div', { className: 'dsh-my-remote-actions' }, toggle, myRemoteRowButtons(props)),
  )
}

/** 行尾按钮：常规态（编辑 / 删除）或确认态（确认删除 / 取消）。 */
function myRemoteRowButtons(props) {
  if (props.confirming) {
    return [
      createElement(
        'button',
        {
          key: 'confirm',
          'data-role': 'webhook-confirm-delete',
          className: 'dsh-my-remote-btn dsh-my-remote-btn-danger',
          onClick: props.onConfirm,
        },
        MY_REMOTE_STRINGS.webhookConfirmDelete(),
      ),
      createElement(
        'button',
        {
          key: 'cancel',
          'data-role': 'webhook-cancel-delete',
          className: 'dsh-my-remote-btn',
          onClick: props.onCancel,
        },
        MY_REMOTE_STRINGS.webhookCancel(),
      ),
    ]
  }
  return [
    createElement(
      'button',
      { key: 'edit', 'data-role': 'webhook-edit', className: 'dsh-my-remote-btn', onClick: props.onEdit },
      MY_REMOTE_STRINGS.webhookEdit(),
    ),
    createElement(
      'button',
      { key: 'delete', 'data-role': 'webhook-delete', className: 'dsh-my-remote-btn', onClick: props.onDelete },
      MY_REMOTE_STRINGS.webhookDelete(),
    ),
  ]
}

/** webhook 编辑表单：名称 / URL / 事件多选 + 确定 / 取消。 */
function MyRemoteWebhookEditor(props) {
  const draft = props.draft
  const events = draft.events ?? []
  const toggleEvent = (kind) => {
    const next = events.includes(kind) ? events.filter((item) => item !== kind) : [...events, kind]
    props.onChange({ ...draft, events: next })
  }
  return createElement(
    'div',
    { className: 'dsh-my-remote-webhook-editor' },
    myRemoteField(
      MY_REMOTE_STRINGS.webhookName(),
      myRemoteInput(draft.name, MY_REMOTE_STRINGS.webhookNamePlaceholder(), (v) =>
        props.onChange({ ...draft, name: v }),
      ),
    ),
    myRemoteField(
      MY_REMOTE_STRINGS.webhookUrl(),
      myRemoteInput(draft.url, 'https://…', (v) => props.onChange({ ...draft, url: v })),
    ),
    myRemoteField(MY_REMOTE_STRINGS.webhookEvents(), myRemoteEventPickers(events, toggleEvent)),
    createElement(
      'div',
      { className: 'dsh-my-remote-actions' },
      createElement(
        'button',
        { 'data-role': 'webhook-save', className: 'dsh-my-remote-btn', onClick: props.onSave },
        MY_REMOTE_STRINGS.webhookSave(),
      ),
      createElement(
        'button',
        { 'data-role': 'webhook-cancel', className: 'dsh-my-remote-btn', onClick: props.onCancel },
        MY_REMOTE_STRINGS.webhookCancel(),
      ),
    ),
    createElement('div', { className: 'dsh-my-remote-hint' }, MY_REMOTE_STRINGS.webhookHeadersNote()),
  )
}

/** 事件多选（不选 = 全部事件）。 */
function myRemoteEventPickers(events, toggleEvent) {
  return createElement(
    'div',
    { className: 'dsh-my-remote-webhook-events' },
    MY_REMOTE_EVENTS.map((kind) =>
      createElement(
        'label',
        { key: kind, className: 'dsh-my-remote-webhook-event' },
        createElement('input', { type: 'checkbox', checked: events.includes(kind), onChange: () => toggleEvent(kind) }),
        myRemoteEventLabel(kind),
      ),
    ),
  )
}

/** 出站 webhook 区块：列表 + 添加 / 编辑 / 删除。 */
function MyRemoteWebhookSection(props) {
  const webhooks = props.webhooks
  const [editing, setEditing] = useState(-1)
  const [draft, setDraft] = useState(null)
  const [confirming, setConfirming] = useState(-1)
  const closeEditor = () => {
    setEditing(-1)
    setDraft(null)
  }
  const startAdd = () => {
    setDraft(myRemoteEmptyWebhook())
    setEditing(webhooks.length)
  }
  const startEdit = (index) => {
    setDraft({ ...webhooks[index] })
    setEditing(index)
  }
  const saveEditor = () => {
    if (draft === null) return
    const next = [...webhooks]
    if (editing >= next.length) next.push(draft)
    else next[editing] = draft
    props.onChange(next)
    closeEditor()
  }
  const removeAt = (index) => {
    props.onChange(webhooks.filter((_, i) => i !== index))
    setConfirming(-1)
  }
  const toggleAt = (index, enabled) => {
    props.onChange(webhooks.map((webhook, i) => (i === index ? { ...webhook, enabled } : webhook)))
  }
  return createElement(
    'div',
    { className: 'dsh-my-remote-section' },
    createElement('div', { className: 'dsh-my-remote-section-title' }, MY_REMOTE_STRINGS.webhookSection()),
    webhooks.length === 0
      ? createElement('div', { className: 'dsh-my-remote-hint' }, MY_REMOTE_STRINGS.webhookEmpty())
      : null,
    webhooks.map((webhook, index) =>
      createElement(MyRemoteWebhookRow, {
        key: `${index}-${webhook.name}`,
        webhook,
        confirming: confirming === index,
        onEdit: () => startEdit(index),
        onDelete: () => setConfirming(index),
        onConfirm: () => removeAt(index),
        onCancel: () => setConfirming(-1),
        onToggle: (enabled) => toggleAt(index, enabled),
      }),
    ),
    editing >= 0 && draft !== null
      ? createElement(MyRemoteWebhookEditor, { draft, onChange: setDraft, onSave: saveEditor, onCancel: closeEditor })
      : null,
    createElement(
      'div',
      { className: 'dsh-my-remote-actions' },
      createElement(
        'button',
        { 'data-role': 'webhook-add', className: 'dsh-my-remote-btn', onClick: startAdd },
        MY_REMOTE_STRINGS.webhookAdd(),
      ),
    ),
  )
}

// ── 设置页主视图 + 页签注册（issue #385）──────────────────────────────────
// 官方 slots 扩展点：设置 → 插件 → 远程控制。视图本体见 settings-views.js /
// settings-webhooks.js；本文件负责状态编排与页签注册。
//
// 本文件是 part 片段（构建期拼接进 __ModuleLoader__ factory 作用域），无 import/export。

/** 页签 id：必须全局唯一——复用宿主已发出的 id 会**顶掉**对方那一格（静默故障）。 */
const MY_REMOTE_SETTINGS_TAB_ID = 'my-remote-settings'

/** 配置端点（与 host 半 src/settings.ts 的 SETTINGS_ROUTE_PATH 一致）。 */
const MY_REMOTE_SETTINGS_API = '/remote/settings/api/settings'

/** 可用事件 kind（与 host 半 settings-model.ts 的 EVENT_KINDS / channels.ts 一致）。 */
const MY_REMOTE_EVENTS = ['ask', 'approval', 'end']

/** 设置页主视图：加载配置 → 编辑 → 保存（PUT 配置端点）。 */
function MyRemoteSettingsView() {
  const [snapshot, setSnapshot] = useState(null)
  const [draft, setDraft] = useState(null)
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [errorKind, setErrorKind] = useState('')
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = () => {
    myRemoteLoad(
      (next) => {
        setSnapshot(next)
        setDraft(next)
      },
      setLoading,
      setErrorKind,
    )
  }
  useEffect(() => {
    load()
  }, [])

  if (loading) return myRemoteStatusView(MY_REMOTE_STRINGS.loading(), 'dsh-my-remote-status')
  if (draft === null || snapshot === null || errorKind !== '') {
    return createElement(MyRemoteLoadError, { errorKind, onRetry: load })
  }
  const onSaved = (next) => {
    setSnapshot(next)
    setDraft(next)
    setToken('')
  }
  return createElement(
    'div',
    { className: 'dsh-my-remote-settings' },
    myRemoteTokenSection(snapshot, token, setToken),
    myRemoteTimeoutSection(draft, setDraft),
    createElement(MyRemoteWebhookSection, {
      webhooks: draft.webhooks,
      onChange: (webhooks) => setDraft({ ...draft, webhooks }),
    }),
    myRemoteSaveRow(draft, token, onSaved, saved, failed, setSaved, setFailed),
  )
}

/** 单行状态视图（加载中 / 其它纯文本状态）。 */
function myRemoteStatusView(text, className) {
  return createElement('div', { className: 'dsh-my-remote-settings' }, createElement('div', { className }, text))
}

/** 鉴权区块：token 输入（密码型，留空则不修改）。 */
function myRemoteTokenSection(snapshot, token, setToken) {
  return createElement(
    'div',
    { className: 'dsh-my-remote-section' },
    createElement('div', { className: 'dsh-my-remote-section-title' }, MY_REMOTE_STRINGS.tokenSection()),
    createElement(MyRemoteTextRow, {
      label: MY_REMOTE_STRINGS.tokenLabel(),
      hint: snapshot.apiTokenSet ? MY_REMOTE_STRINGS.tokenHint() : MY_REMOTE_STRINGS.tokenHintEmpty(),
      value: token,
      type: 'password',
      placeholder: MY_REMOTE_STRINGS.tokenPlaceholder(),
      onChange: setToken,
    }),
  )
}

/** 超时区块：两个非负整数输入。 */
function myRemoteTimeoutSection(draft, setDraft) {
  const timeoutRow = (label, hint, key) =>
    createElement(MyRemoteTextRow, {
      label,
      hint,
      value: String(draft[key]),
      type: 'number',
      onChange: (v) => setDraft({ ...draft, [key]: myRemoteNormalizeTimeout(Number(v), draft[key]) }),
    })
  return createElement(
    'div',
    { className: 'dsh-my-remote-section' },
    createElement('div', { className: 'dsh-my-remote-section-title' }, MY_REMOTE_STRINGS.timeoutSection()),
    timeoutRow(MY_REMOTE_STRINGS.askTimeoutLabel(), MY_REMOTE_STRINGS.askTimeoutHint(), 'askTimeoutMs'),
    timeoutRow(MY_REMOTE_STRINGS.approvalTimeoutLabel(), MY_REMOTE_STRINGS.approvalTimeoutHint(), 'approvalTimeoutMs'),
  )
}

/** 保存行：保存按钮 + 成功 / 失败提示（写操作必须给反馈，禁止静默）。 */
function myRemoteSaveRow(draft, token, onSaved, saved, failed, setSaved, setFailed) {
  return createElement(
    'div',
    { className: 'dsh-my-remote-actions' },
    createElement(
      'button',
      {
        'data-role': 'settings-save',
        className: 'dsh-my-remote-btn',
        onClick: () => myRemoteSave(myRemoteBuildPayload(draft, token), onSaved, setSaved, setFailed),
      },
      MY_REMOTE_STRINGS.save(),
    ),
    saved ? createElement('span', { className: 'dsh-my-remote-saved' }, MY_REMOTE_STRINGS.saved()) : null,
    failed ? createElement('span', { className: 'dsh-my-remote-error' }, MY_REMOTE_STRINGS.saveFailed()) : null,
  )
}

// ── 页签注册 ───────────────────────────────────────────────────────────────

/**
 * 注册设置页签。两处刻意的写法：
 *  - `ctx.get('slots', false)`：**必须传 strict=false** —— cordis 的
 *    `ctx.get(name, strict = true)` 在服务提供者 fiber 尚未 active（首屏）时返回
 *    undefined，页签会消失到下次 HMR；只有 strict=false 才拿得到实例。
 *  - 服务缺失（精简上下文 / 老宿主）时静默跳过：设置页是增强，不能因为拿不到
 *    slots 就让整个 client 挂掉。
 */
function attachSettingsTab(ctx) {
  // 样式注入位置在任何早退分支之前（服务判空 / HMR 时样式不会丢）。
  installStyles(ctx, 'data-dsh-my-remote-settings', MY_REMOTE_SETTINGS_STYLES, 'dsh-my-remote: settings styles')
  const slots = typeof ctx.get === 'function' ? ctx.get('slots', false) : undefined
  if (slots === undefined || slots === null) return
  ctx.effect(() => {
    slots.inject('settings.plugins.tab', () =>
      slots.register(
        {
          name: 'settings.plugins.tab',
          id: MY_REMOTE_SETTINGS_TAB_ID,
          order: 93,
          // 惰性：宿主靠重注册跟随语言切换，这里每次取都按当前语言判定。
          label: () => MY_REMOTE_STRINGS.tabLabel(),
        },
        MyRemoteSettingsView,
      ),
    )
    return undefined
  }, 'dsh-my-remote: settings tab registration')
}

    // 插件入口：只注册设置页签（attachSettingsTab 由上面的片段声明、同处本作用域）。
    // 刻意**不声明 inject: ['slots']**：设置页是增强能力，用 ctx.get('slots', false)
    // 主动查询并在缺失时静默跳过——硬 inject 会让本 client 在没有 slots 的宿主上
    // 永远 PENDING。
    module.exports.apply = function apply(ctx) {
      attachSettingsTab(ctx)
    }

    return module.exports
  },
})
