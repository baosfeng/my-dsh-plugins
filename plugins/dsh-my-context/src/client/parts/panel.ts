// ── 上下文透镜面板 ──────────────────────────────────────────────────
const CONTEXT_POLL_MS: number = 5000

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
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  } catch {
    return ''
  }
}

/** KV 缓存命中率：cacheRead / (input + cacheRead)，无数据返回 0。 */
function cacheHitRate(usage?: CtxUsage): number {
  const read = usage?.cacheReadTokens || 0
  const input = usage?.inputTokens || 0
  const total = read + input
  return total > 0 ? read / total : 0
}

/** 构成分类 → 标签。 */
function compositionLabel(key: string): string {
  const labels = {
    system: strings.catSystem(),
    tools: strings.catTools(),
    user: strings.catUser(),
    inject: strings.catInject(),
    assistant: strings.catAssistant(),
    tool: strings.catTool(),
  }
  return labels[key] || key
}

/** 单个统计项（值 + 标签）。 */
function Stat({ value, label }: CtxStatProps) {
  return createElement(
    'div',
    { className: 'dso-stat' },
    createElement('div', { className: 'dso-stat-value' }, value),
    createElement('div', { className: 'dso-stat-label' }, label),
  )
}

/** 模型徽标（无模型返回 null）。 */
function modelBadge(session: CtxSession) {
  if (session.model === '') return null
  return createElement('span', { className: 'dso-time' }, `${strings.model()} ${session.model}`)
}

/** 上下文窗口备注（无窗口返回 null）。 */
function windowNote(session: CtxSession) {
  if (session.contextWindow <= 0) return null
  return createElement(
    'div',
    { className: 'dso-feedback' },
    `${strings.contextWindow()} ${session.contextWindow.toLocaleString()}`,
  )
}

/** 概览卡片：累计 token + 缓存命中率 + 模型/上下文窗口。 */
function OverviewCard({ session }: CtxOverviewCardProps) {
  const usage = session.usage || {}
  // 累计消耗 = 输入 + 输出（每次请求的新增 token）；
  // cacheRead/cacheWrite 是缓存计价项，逐轮重复累加会虚高（曾把累计
  // token 显示到窗口的多倍），因此不计入"累计"。
  const total = (usage.inputTokens || 0) + (usage.outputTokens || 0)
  return createElement(
    'div',
    { className: 'dso-card' },
    createElement(
      'div',
      { className: 'dso-card-head' },
      createElement('span', { className: 'dso-card-title' }, strings.overview()),
      modelBadge(session),
    ),
    createElement(
      'div',
      { className: 'dso-stat-row' },
      createElement(Stat, { value: strings.tokens(total), label: strings.totalTokens() }),
      createElement(Stat, {
        value: strings.percent(cacheHitRate(usage)),
        label: strings.cacheHitRate(),
      }),
    ),
    createElement(
      'div',
      { className: 'dso-stat-row' },
      createElement(Stat, {
        value: strings.tokens(usage.inputTokens || 0),
        label: strings.inputTokens(),
      }),
      createElement(Stat, {
        value: strings.tokens(usage.outputTokens || 0),
        label: strings.outputTokens(),
      }),
      createElement(Stat, {
        value: strings.tokens(usage.cacheReadTokens || 0),
        label: strings.cacheRead(),
      }),
    ),
    windowNote(session),
  )
}

/** 构成条：按类型展示 token 占比（水平条形）。 */
function CompositionBar({ composition }: CtxCompositionBarProps) {
  const keys = ['system', 'tools', 'user', 'inject', 'assistant', 'tool']
  const total = keys.reduce((sum, key) => sum + (composition[key] || 0), 0)
  if (total <= 0) return createElement('div', { className: 'dso-empty' }, strings.empty())
  const rows = keys
    .filter((key) => (composition[key] || 0) > 0)
    .map((key) => {
      const value = composition[key] || 0
      const width = `${Math.max(2, Math.round((value / total) * 100))}%`
      return createElement(
        'div',
        { key, className: 'dso-comp-row' },
        createElement('span', { className: 'dso-comp-label' }, compositionLabel(key)),
        createElement(
          'div',
          { className: 'dso-comp-track' },
          createElement('div', { className: `dso-comp-fill dso-comp-${key}`, style: { width } }),
        ),
        createElement('span', { className: 'dso-comp-value' }, strings.tokens(value)),
      )
    })
  return createElement('div', { className: 'dso-comp' }, rows)
}

/** 单条请求记录（轮/步 + prompt/output + 缓存命中率）。 */
function RequestRow({ request }: CtxRequestRowProps) {
  const rate = cacheHitRate({
    inputTokens: request.prompt - request.cacheRead - request.cacheWrite,
    cacheReadTokens: request.cacheRead,
  })
  return createElement(
    'div',
    { className: 'dso-request' },
    createElement(
      'div',
      { className: 'dso-request-head' },
      createElement('span', { className: 'dso-badge dso-badge-llm' }, strings.turnStep(request.turn, request.step)),
      createElement('span', { className: 'dso-time' }, timeText(request.time)),
    ),
    createElement(
      'div',
      { className: 'dso-request-meta' },
      `${strings.prompt()} ${request.prompt.toLocaleString()} · ${strings.output()} ${request.output.toLocaleString()} · ${strings.cacheHitRate()} ${strings.percent(rate)}`,
    ),
  )
}

/** 请求列表（最新在前）。 */
function RequestList({ requests }: CtxRequestListProps) {
  if (requests.length === 0) return createElement('div', { className: 'dso-empty' }, strings.noRequests())
  const rows = [...requests].reverse().map((request, index) => createElement(RequestRow, { key: index, request }))
  return createElement('div', { className: 'dso-timeline' }, rows)
}

/** 预算输入行（数字输入 + 标签）。 */
function BudgetField({ label, value, onChange }: CtxBudgetFieldProps) {
  return createElement(
    'div',
    { className: 'dso-repo-row' },
    createElement('input', {
      className: 'dso-input dso-budget-input',
      type: 'number',
      min: 0,
      value,
      placeholder: strings.budgetOff(),
      onChange: (e) => onChange(e.target.value),
    }),
    createElement('span', { className: 'dso-time' }, label),
  )
}

/** 保存预算配置。 */
async function saveBudget(
  payload: { perTurn: number; perSession: number; mode: string },
  setBusy: (busy: boolean) => void,
  setFeedback: (feedback: string) => void,
  onSaved: () => void,
): Promise<void> {
  setBusy(true)
  setFeedback('')
  try {
    await apiJson('/context/api/budget', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setFeedback(strings.saved())
    onSaved()
  } catch (err) {
    setFeedback(`${strings.saveError()}：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    setBusy(false)
  }
}

/** 预算设置：每轮/每会话上限 + 模式 + 保存。 */
function BudgetSettings({ budget, onSaved }: CtxBudgetSettingsProps) {
  const [perTurn, setPerTurn] = useState(String(budget.perTurn || 0))
  const [perSession, setPerSession] = useState(String(budget.perSession || 0))
  const [mode, setMode] = useState(budget.mode || 'warn')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const save = () =>
    void saveBudget(
      {
        perTurn: Number(perTurn) || 0,
        perSession: Number(perSession) || 0,
        mode,
      },
      setBusy,
      setFeedback,
      onSaved,
    )
  return createElement(
    'div',
    { className: 'dso-section' },
    createElement('div', { className: 'dso-section-title' }, strings.budget()),
    createElement(BudgetField, {
      label: strings.budgetPerTurn(),
      value: perTurn,
      onChange: setPerTurn,
    }),
    createElement(BudgetField, {
      label: strings.budgetPerSession(),
      value: perSession,
      onChange: setPerSession,
    }),
    createElement(
      'div',
      { className: 'dso-repo-row' },
      createElement(
        'select',
        {
          className: 'dso-select dso-budget-mode',
          value: mode,
          onChange: (e) => setMode(e.target.value),
        },
        createElement('option', { value: 'warn' }, strings.modeWarn()),
        createElement('option', { value: 'deny' }, strings.modeDeny()),
      ),
      createElement('button', { className: 'dso-btn dso-btn-primary', disabled: busy, onClick: save }, strings.save()),
    ),
    feedback !== '' ? createElement('div', { className: 'dso-feedback' }, feedback) : null,
  )
}

/** 预算告警列表（最新在前）。 */
function AlertList({ alerts }: CtxAlertListProps) {
  if (alerts.length === 0) return createElement('div', { className: 'dso-empty' }, strings.noAlerts())
  const rows = alerts.map((alert) => {
    const scope = alert.scope === 'turn' ? strings.alertTurn() : strings.alertSession()
    const action = alert.blocked ? strings.alertBlocked() : strings.alertWarned()
    return createElement(
      'div',
      { key: alert.id, className: `dso-alert dso-alert-${alert.blocked ? 'danger' : 'warn'}` },
      createElement(
        'div',
        { className: 'dso-alert-head' },
        createElement('span', { className: 'dso-badge dso-badge-budget' }, scope),
        createElement('span', { className: 'dso-time' }, timeText(alert.time)),
      ),
      createElement(
        'div',
        { className: 'dso-alert-msg' },
        `${strings.tokens(alert.used)} / ${strings.tokens(alert.limit)} · ${action}`,
      ),
    )
  })
  return createElement('div', { className: 'dso-timeline' }, rows)
}

/** 拉取会话列表 + 状态 + 当前会话统计。 */
async function loadContextData(sessionId: string, setters: CtxSetters): Promise<void> {
  const list = await apiJson('/context/api/sessions')
  setters.setSessions(list)
  if (sessionId === '' && list.length > 0) setters.setSessionId(list[0].sessionId)
  const status = await apiJson('/context/api/status')
  setters.setBudget(status.budget)
  setters.setOverflow(status.overflow || { warnThreshold: 0.8, alertThreshold: 0.9 })
  if (sessionId !== '') {
    const stats = await apiJson(`/context/api/session?sessionId=${encodeURIComponent(sessionId)}`)
    setters.setSession(stats)
  }
}

/** 会话区块：构成 + 请求 + 告警（无会话返回 null）。 */
function sessionSections(session: CtxSession | null) {
  if (session === null) return null
  return [
    createElement(
      'div',
      { key: 'comp', className: 'dso-section' },
      createElement('div', { className: 'dso-section-title' }, strings.composition()),
      createElement(CompositionBar, { composition: session.composition }),
    ),
    createElement(
      'div',
      { key: 'req', className: 'dso-section' },
      createElement('div', { className: 'dso-section-title' }, strings.requests()),
      createElement(RequestList, { requests: session.requests }),
    ),
    createElement(
      'div',
      { key: 'alerts', className: 'dso-section' },
      createElement('div', { className: 'dso-section-title' }, strings.alerts()),
      createElement(AlertList, { alerts: session.alerts }),
    ),
  ]
}

/** 状态提示：错误 / 加载中 / 空状态（无提示返回 null）。 */
function statusNote(error: string, loading: boolean, session: CtxSession | null) {
  if (error !== '') return createElement('div', { className: 'dso-empty' }, `${strings.loadError()}：${error}`)
  if (loading) return createElement('div', { className: 'dso-empty' }, strings.loading())
  if (session === null) return createElement('div', { className: 'dso-empty' }, strings.noSessions())
  return null
}

/** 上下文透镜主面板：会话选择 + 概览 + 构成 + 请求 + 预算（可见时轮询）。 */
function ContextPanel(props: CtxContextPanelProps) {
  const visible = props.visible !== false
  const [sessions, setSessions] = useState<CtxSessionListItem[]>([])
  const [sessionId, setSessionId] = useState('')
  const [session, setSession] = useState<CtxSession | null>(null)
  const [budget, setBudget] = useState<CtxBudget>({ perTurn: 0, perSession: 0, mode: 'warn' })
  const [overflow, setOverflow] = useState<CtxOverflowConfig>({ warnThreshold: 0.8, alertThreshold: 0.9 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    const setters = { setSessions, setSessionId, setSession, setBudget, setOverflow, setError, setLoading }
    const tick = () => {
      loadContextData(sessionId, setters)
        .catch((err) => {
          if (alive) setError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }
    tick()
    const timer = setInterval(tick, CONTEXT_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [visible, sessionId])

  const options = sessions.map((s) => createElement('option', { key: s.sessionId, value: s.sessionId }, s.sessionId))
  return createElement(
    'div',
    { className: 'dso-panel' },
    createElement(
      'div',
      { className: 'dso-toolbar' },
      createElement(
        'select',
        {
          className: 'dso-select',
          value: sessionId,
          onChange: (e) => setSessionId(e.target.value),
        },
        createElement('option', { value: '' }, strings.allSessions()),
        options,
      ),
    ),
    statusNote(error, loading, session),
    session !== null ? createElement(OverviewCard, { session }) : null,
    session !== null ? createElement(ContextUsageCard, { session, overflow }) : null,
    sessionSections(session),
    session !== null ? createElement(OverflowSection, { overflows: session.overflows }) : null,
    createElement(OverflowSettings, { overflow, onSaved: () => {} }),
    createElement(BudgetSettings, { budget, onSaved: () => {} }),
  )
}
