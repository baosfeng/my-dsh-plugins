// ── 安全护栏面板 ────────────────────────────────────────────────────
const GUARD_POLL_MS = 5000

/** 请求插件 API（非 2xx 抛错；返回响应 JSON 的 value 字段）。 */
function apiJson(path: string, options?: RequestInit): Promise<any> {
  return fetch(path, options).then(async (res) => {
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
    return data.value
  })
}

/** 时间戳 → HH:MM:SS。 */
function timeText(time: number | string): string {
  try {
    const date = new Date(time)
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  } catch {
    return ''
  }
}

/** 告警类型 → 中文标签。 */
function alertTypeLabel(type: string): string {
  if (type === 'destructive') return strings.typeDestructive()
  if (type === 'poison') return strings.typePoison()
  if (type === 'injection') return strings.typeInjection()
  return type
}

/** 严重度 → 中文标签。 */
function severityLabel(severity: string): string {
  if (severity === 'high') return strings.sevHigh()
  if (severity === 'medium') return strings.sevMedium()
  return strings.sevLow()
}

/** 告警类型 → 视觉类别（类型图标/徽章/颜色共用，语义一致）：
 *  destructive=danger（trash 图标）/ poison=warn（alert 图标）/ injection=info（alert 图标）。 */
function alertKind(alert: GuardAlert): string {
  if (alert.type === 'destructive') return 'danger'
  if (alert.type === 'poison') return 'warn'
  return 'info'
}

/** 告警类型 → 类型图标（共享线性图标集，stroke=currentColor）。 */
function alertTypeIcon(alert: GuardAlert): unknown {
  if (alert.type === 'destructive') return icon.trash(15)
  return icon.alert(15)
}

/** 告警 meta 行：命令/文件/规则 id + 会话短标识。 */
function AlertMeta({ alert }: GuardAlertProps) {
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
function AlertDetails({ alert }: GuardAlertProps) {
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
function AlertRow({ alert, onConfirm }: GuardAlertRowProps) {
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
function shortSessionId(sessionId?: string): string {
  return typeof sessionId === 'string' && sessionId.length > 8 ? sessionId.slice(0, 8) + '…' : sessionId || ''
}

/** 拉取告警列表。 */
async function loadAlerts(setters: GuardAlertSetters): Promise<void> {
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
async function confirmAlert(id: number, setAlerts: GuardAlertSetters['setAlerts']): Promise<void> {
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
function ScanResult({ result }: GuardScanResultProps) {
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
async function runScan(target: string, setters: GuardScanSetters): Promise<void> {
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
  const [result, setResult] = useState<GuardScanResult | null>(null)
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
function PromptResult({ hits }: GuardPromptResultProps) {
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
  const [hits, setHits] = useState<GuardRuleHit[] | null>(null)
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
function GuardPanel(props: GuardPanelProps) {
  const visible = props.visible !== false
  const [alerts, setAlerts] = useState<GuardAlert[]>([])
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
