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
