// ── i18n ──────────────────────────────────────────────────────────────
function isZh() {
  try {
    return (navigator.language || 'en').toLowerCase().startsWith('zh')
  } catch {
    return false
  }
}

const strings = {
  title: () => (isZh() ? '插件守护' : 'Plugin Guardian'),
  safeMode: () => (isZh() ? '安全模式' : 'Safe mode'),
  safeModeDesc: () =>
    isZh()
      ? '开启后所有候选/已转正插件（候选区 cordis.staged.json 中的条目）都不再加载，用于快速恢复环境。注意：安全模式只作用于启动后挂载的候选插件；若插件直接写进启动名册（cordis.patch.yml / profile），DSH 启动时仍是 all-or-nothing——请把新插件先放进候选区。'
      : 'Skips every staged/promoted plugin mount — fast recovery. Note: this only covers entries mounted after boot (cordis.staged.json); plugins in the boot roster (cordis.patch.yml / profile) are still all-or-nothing — put new plugins in the staged file first.',
  staged: () => (isZh() ? '候选' : 'staged'),
  promoted: () => (isZh() ? '转正' : 'promoted'),
  entries: () => (isZh() ? '插件条目' : 'Plugin entries'),
  empty: () => (isZh() ? '暂无候选插件' : 'No staged plugins'),
  emptyHint: () =>
    isZh()
      ? '新插件请写入 cordis.staged.json（与 cordis.patch.yml 同目录），启动后自动加载'
      : 'Add entries to cordis.staged.json next to cordis.patch.yml — they load on startup',
  running: () => (isZh() ? '运行中' : 'running'),
  pending: () => (isZh() ? '待加载' : 'pending'),
  failed: () => (isZh() ? '失败' : 'failed'),
  frozen: () => (isZh() ? '冻结' : 'frozen'),
  retry: () => (isZh() ? '重试' : 'Retry'),
  remove: () => (isZh() ? '移除' : 'Remove'),
  removeConfirm: () => (isZh() ? '移除该插件条目？' : 'Remove this plugin entry?'),
  removeConfirmDesc: () =>
    isZh()
      ? '将从名册中卸载并移除，候选区文件不受影响'
      : 'Unmounts and drops it from the roster; the staged file is untouched',
  cancel: () => (isZh() ? '取消' : 'Cancel'),
  confirmRemove: () => (isZh() ? '确认移除' : 'Remove'),
  expandError: () => (isZh() ? '错误详情' : 'Error details'),
  collapseError: () => (isZh() ? '收起' : 'Collapse'),
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  events: () => (isZh() ? '最近事件' : 'Recent events'),
  attempts: (n) => (isZh() ? `失败 ${n} 次` : `failed ×${n}`),
  frozenHint: () =>
    isZh()
      ? '已冻结：连续失败停止自动重试——点击刷新按钮手动重试，或移除该条目'
      : 'Frozen: auto-retry stopped after repeated failures — retry manually or remove the entry',
  failureDependency: () => (isZh() ? '依赖缺失' : 'Dependency'),
  failureCode: () => (isZh() ? '代码错误' : 'Code error'),
  failureOther: () => (isZh() ? '其他' : 'Other'),
  installHint: () => (isZh() ? '安装建议' : 'Install'),
  // ── startup-roster issues (issue #144) ─────────────────────────────────
  startupIssues: () => (isZh() ? '启动区问题' : 'Startup roster issues'),
  startupIssueFix: () => (isZh() ? '修复' : 'Fix'),
  startupIssueRemove: () => (isZh() ? '移除' : 'Remove'),
  startupIssueUnresolvable: () => (isZh() ? '包不可解析' : 'Unresolvable'),
  startupIssueDependency: () => (isZh() ? '依赖缺失' : 'Dependency'),
  startupIssueDuplicate: () => (isZh() ? '重复 id' : 'Duplicate id'),
}

// ── api ───────────────────────────────────────────────────────────────
async function api(path, body) {
  const response = await fetch(
    `/guardian/api/${path}`,
    body === undefined
      ? { headers: { accept: 'application/json' } }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  const payload = await response.json().catch(() => ({ ok: false, error: { message: 'bad response' } }))
  if (!payload.ok) throw new Error(payload.error?.message ?? 'request failed')
  return payload.value
}

function formatTime(time) {
  if (typeof time !== 'number' || !Number.isFinite(time)) return ''
  const date = new Date(time)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function statusLabel(status) {
  switch (status) {
    case 'running':
      return strings.running()
    case 'pending':
      return strings.pending()
    case 'failed':
      return strings.failed()
    case 'frozen':
      return strings.frozen()
    default:
      return status
  }
}

/** Failure-classification badge label (issue #86): dependency / code / other. */
function failureTypeLabel(type) {
  switch (type) {
    case 'dependency':
      return strings.failureDependency()
    case 'code':
      return strings.failureCode()
    case 'other':
      return strings.failureOther()
    default:
      return type
  }
}

// ── event log ─────────────────────────────────────────────────────────
// Event type → badge label + color variant (mirrors the dfa-op chip style).
const EVENT_LABELS = {
  promote: () => (isZh() ? '转正' : 'Promoted'),
  'entry-init': () => (isZh() ? '初始化' : 'Init'),
  'entry-dispose': () => (isZh() ? '释放' : 'Disposed'),
  quarantine: () => (isZh() ? '隔离' : 'Quarantined'),
  freeze: () => (isZh() ? '冻结' : 'Frozen'),
  'update-failed': () => (isZh() ? '更新失败' : 'Update failed'),
  safe: () => (isZh() ? '安全模式' : 'Safe mode'),
  'safe-mode': () => (isZh() ? '安全模式' : 'Safe mode'),
  skip: () => (isZh() ? '跳过' : 'Skipped'),
  'startup-issue': () => (isZh() ? '启动区问题' : 'Startup issue'),
}

/** Badge color variant for an event type; unknown types fall back to the
 *  neutral tertiary chip. */
function eventVariant(type) {
  switch (type) {
    case 'promote':
      return 'success'
    case 'entry-init':
      return 'accent'
    case 'quarantine':
    case 'update-failed':
    case 'startup-issue':
      return 'danger'
    case 'freeze':
    case 'safe':
    case 'safe-mode':
      return 'warn'
    default:
      return 'neutral'
  }
}

/** Startup-issue badge label (issue #144): unresolvable / dependency / dup. */
function startupIssueLabel(type) {
  switch (type) {
    case 'unresolvable':
      return strings.startupIssueUnresolvable()
    case 'dependency':
      return strings.startupIssueDependency()
    case 'duplicate-id':
      return strings.startupIssueDuplicate()
    default:
      return type
  }
}

function eventLabel(type) {
  return (EVENT_LABELS[type] ?? (() => type))()
}
