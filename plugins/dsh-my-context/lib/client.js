/**
 * dsh-my-context — client half (browser). SOURCE TEMPLATE.
 *
 * 提供侧边栏页签「上下文透镜」（dsh-my-context:context）：
 *  - 概览卡片：累计 token（输入/输出/缓存命中）+ KV 缓存命中率 + 模型；
 *  - 上下文构成条：system/tools/user/inject/assistant/tool 分类占比；
 *  - 请求记录列表：每次请求的 prompt/output token 与缓存命中率；
 *  - 预算设置：每轮/每会话 token 上限 + 提醒/拦截模式（POST /context/api/budget）；
 *  - 预算告警列表：超限记录（提醒/拦截）。
 *
 * 面板可见（visible）时轮询（CONTEXT_POLL_MS），隐藏时暂停（省请求）。
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 *
 * BUILD NOTE: 本文件是模板源码，不是 DSH 实际服务的文件。scripts/build.mjs 先用
 * tsconfig.client.json 把 src/client/parts/*.ts 编译成 lib/parts/*.js（i18n /
 * panel / overflow / styles 四个片段，均为无 import/export 的纯函数声明文本，
 * 共享 factory 作用域），再经下方 __PART_*__ 占位符（函数式 replaceAll，避免
 * $&/$1 特殊解释）拼接进 factory 作用域，写出 lib/client.js —— 即 DSH 实际
 * 服务的产物。产物必须提交；CI 只对产物执行 node --check（见 .github/workflows/ci.yml）。
 *
 * parts 顺序固定（build.mjs 的 pieces）：i18n → panel → overflow → styles。
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-context',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    // ── parts（scripts/build.mjs 拼接；顺序固定）───────────────────────
    'use strict'
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
  tabTitle: () => (isZh() ? '上下文透镜' : 'Context'),
  allSessions: () => (isZh() ? '全部会话' : 'All sessions'),
  noSessions: () =>
    isZh()
      ? '暂无会话统计——开始一段对话后，上下文占用会出现在这里'
      : 'No session stats yet — context usage will appear here after a conversation',
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  overview: () => (isZh() ? '概览' : 'Overview'),
  totalTokens: () => (isZh() ? '累计 token' : 'Total tokens'),
  inputTokens: () => (isZh() ? '输入' : 'Input'),
  outputTokens: () => (isZh() ? '输出' : 'Output'),
  cacheRead: () => (isZh() ? '缓存命中' : 'Cache read'),
  cacheWrite: () => (isZh() ? '缓存写入' : 'Cache write'),
  cacheHitRate: () => (isZh() ? 'KV 缓存命中率' : 'KV cache hit rate'),
  contextWindow: () => (isZh() ? '上下文窗口' : 'Context window'),
  model: () => (isZh() ? '模型' : 'Model'),
  composition: () => (isZh() ? '上下文构成' : 'Composition'),
  catSystem: () => (isZh() ? '系统提示' : 'System'),
  catTools: () => (isZh() ? '工具' : 'Tools'),
  catUser: () => (isZh() ? '用户' : 'User'),
  catInject: () => (isZh() ? '注入' : 'Injected'),
  catAssistant: () => (isZh() ? '助手' : 'Assistant'),
  catTool: () => (isZh() ? '工具结果' : 'Tool results'),
  requests: () => (isZh() ? '请求记录' : 'Requests'),
  noRequests: () => (isZh() ? '暂无请求记录' : 'No requests yet'),
  turnStep: (turn, step) => (isZh() ? `轮 ${turn} · 步 ${step}` : `turn ${turn} · step ${step}`),
  prompt: () => (isZh() ? '提示' : 'Prompt'),
  output: () => (isZh() ? '输出' : 'Output'),
  budget: () => (isZh() ? '预算' : 'Budget'),
  budgetPerTurn: () => (isZh() ? '每轮上限' : 'Per-turn limit'),
  budgetPerSession: () => (isZh() ? '每会话上限' : 'Per-session limit'),
  budgetOff: () => (isZh() ? '不限制' : 'Unlimited'),
  modeWarn: () => (isZh() ? '提醒' : 'Warn'),
  modeDeny: () => (isZh() ? '拦截' : 'Deny'),
  save: () => (isZh() ? '保存' : 'Save'),
  saved: () => (isZh() ? '已保存' : 'Saved'),
  saveError: () => (isZh() ? '保存失败' : 'Save failed'),
  alerts: () => (isZh() ? '预算告警' : 'Budget alerts'),
  noAlerts: () => (isZh() ? '暂无预算告警' : 'No budget alerts'),
  alertTurn: () => (isZh() ? '每轮超限' : 'Turn limit exceeded'),
  alertSession: () => (isZh() ? '每会话超限' : 'Session limit exceeded'),
  alertBlocked: () => (isZh() ? '已拦截' : 'Blocked'),
  alertWarned: () => (isZh() ? '已提醒' : 'Warned'),
  // ── 上下文溢出预警（issue #87）──────────────────────────────────
  contextUsage: () => (isZh() ? '上下文占用' : 'Context usage'),
  contextUsageUnknown: () => (isZh() ? '上下文窗口未知' : 'Context window unknown'),
  levelNormal: () => (isZh() ? '正常' : 'Normal'),
  levelWarn: () => (isZh() ? '预警' : 'Warning'),
  levelAlert: () => (isZh() ? '告警' : 'Alert'),
  levelCritical: () => (isZh() ? '严重' : 'Critical'),
  overflowSection: () => (isZh() ? '溢出预警' : 'Overflow alerts'),
  noOverflows: () => (isZh() ? '暂无溢出预警' : 'No overflow alerts'),
  overflowRatio: () => (isZh() ? '已用占比' : 'Usage'),
  overflowThreshold: (n) => (isZh() ? `阈值 ${(n * 100).toFixed(0)}%` : `threshold ${(n * 100).toFixed(0)}%`),
  suggestTitle: (level) => {
    if (isZh()) {
      if (level === 'critical') return '建议：上下文接近上限，开启新会话'
      if (level === 'alert') return '建议：尽快压缩或开启新会话'
      return '建议：留意上下文占用'
    }
    if (level === 'critical') return 'Suggestion: context near limit, start a new session'
    if (level === 'alert') return 'Suggestion: compact soon or start a new session'
    return 'Suggestion: watch context usage'
  },
  suggestNewSession: () => (isZh() ? '开启新会话，归档当前上下文' : 'Start a new session and archive this context'),
  suggestCompact: () =>
    isZh() ? '总结/压缩历史对话后再继续' : 'Summarize/compact the conversation history before continuing',
  suggestComposition: (list) =>
    isZh() ? `查看上下文构成占比（${list} 占比最高）` : `Review composition shares (${list} dominate)`,
  warnThresholdLabel: () => (isZh() ? '预警阈值' : 'Warn threshold'),
  alertThresholdLabel: () => (isZh() ? '告警阈值' : 'Alert threshold'),
  overflowConfig: () => (isZh() ? '溢出阈值' : 'Overflow thresholds'),
  tokens: (n) => (isZh() ? `${n.toLocaleString()} tokens` : `${n.toLocaleString()} tokens`),
  percent: (n) => `${(n * 100).toFixed(1)}%`,
  empty: () => (isZh() ? '（空）' : '(empty)'),
}

    'use strict'
// ── 上下文透镜面板 ──────────────────────────────────────────────────
const CONTEXT_POLL_MS = 5000
/** 请求插件 API（非 2xx 抛错；返回响应 JSON 的 value 字段）。 */
function apiJson(path, options) {
  return fetch(path, options).then(async (res) => {
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
    return data.value
  })
}
/** 时间戳 → HH:MM:SS。 */
function timeText(time) {
  try {
    const date = new Date(time)
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  } catch {
    return ''
  }
}
/** KV 缓存命中率：cacheRead / (input + cacheRead)，无数据返回 0。 */
function cacheHitRate(usage) {
  const read = usage?.cacheReadTokens || 0
  const input = usage?.inputTokens || 0
  const total = read + input
  return total > 0 ? read / total : 0
}
/** 构成分类 → 标签。 */
function compositionLabel(key) {
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
function Stat({ value, label }) {
  return createElement(
    'div',
    { className: 'dso-stat' },
    createElement('div', { className: 'dso-stat-value' }, value),
    createElement('div', { className: 'dso-stat-label' }, label),
  )
}
/** 模型徽标（无模型返回 null）。 */
function modelBadge(session) {
  if (session.model === '') return null
  return createElement('span', { className: 'dso-time' }, `${strings.model()} ${session.model}`)
}
/** 上下文窗口备注（无窗口返回 null）。 */
function windowNote(session) {
  if (session.contextWindow <= 0) return null
  return createElement(
    'div',
    { className: 'dso-feedback' },
    `${strings.contextWindow()} ${session.contextWindow.toLocaleString()}`,
  )
}
/** 概览卡片：累计 token + 缓存命中率 + 模型/上下文窗口。 */
function OverviewCard({ session }) {
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
function CompositionBar({ composition }) {
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
function RequestRow({ request }) {
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
function RequestList({ requests }) {
  if (requests.length === 0) return createElement('div', { className: 'dso-empty' }, strings.noRequests())
  const rows = [...requests].reverse().map((request, index) => createElement(RequestRow, { key: index, request }))
  return createElement('div', { className: 'dso-timeline' }, rows)
}
/** 预算输入行（数字输入 + 标签）。 */
function BudgetField({ label, value, onChange }) {
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
async function saveBudget(payload, setBusy, setFeedback, onSaved) {
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
function BudgetSettings({ budget, onSaved }) {
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
function AlertList({ alerts }) {
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
async function loadContextData(sessionId, setters) {
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
function sessionSections(session) {
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
function statusNote(error, loading, session) {
  if (error !== '') return createElement('div', { className: 'dso-empty' }, `${strings.loadError()}：${error}`)
  if (loading) return createElement('div', { className: 'dso-empty' }, strings.loading())
  if (session === null) return createElement('div', { className: 'dso-empty' }, strings.noSessions())
  return null
}
/** 上下文透镜主面板：会话选择 + 概览 + 构成 + 请求 + 预算（可见时轮询）。 */
function ContextPanel(props) {
  const visible = props.visible !== false
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState('')
  const [session, setSession] = useState(null)
  const [budget, setBudget] = useState({ perTurn: 0, perSession: 0, mode: 'warn' })
  const [overflow, setOverflow] = useState({ warnThreshold: 0.8, alertThreshold: 0.9 })
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

    'use strict'
// ── 上下文溢出预警（issue #87）────────────────────────────────────
// 用量比例 + 分级预警（80/90/95%）进度条、压缩建议卡、预警记录列表、
// 阈值配置。与 server lib/overflow.js 语义一致（比值口径 = 当前上下文
// 长度/contextWindow，其中"当前上下文长度"取最近一次请求的 prompt——
// 历史累计 usage 含每轮重复的 cacheRead，会导致占用虚高数倍）；
// client 无相对 import，分级逻辑在此本地复刻。
/** 当前上下文长度（最近一次请求 prompt；旧数据回退最近请求快照）。 */
function contextUsage(session) {
  if (typeof session?.lastPromptTokens === 'number' && session.lastPromptTokens > 0) {
    return session.lastPromptTokens
  }
  const requests = session?.requests || []
  const last = requests[requests.length - 1]
  return typeof last?.prompt === 'number' ? last.prompt : 0
}
/** 非负有限比例，夹到 [0,1]。 */
function ratioTo(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
/** 用量比例分级：normal / warn / alert / critical。 */
function overflowLevelOf(ratio, overflow) {
  const warn = ratioTo(overflow?.warnThreshold, 0.8)
  const alert = ratioTo(overflow?.alertThreshold, 0.9)
  if (ratio >= 0.95) return 'critical'
  if (ratio >= alert) return 'alert'
  if (ratio >= warn) return 'warn'
  return 'normal'
}
/** 当前会话用量表：{ used, window, ratio, level }。 */
function usageMeter(session, overflow) {
  const window = session.contextWindow || 0
  const used = contextUsage(session)
  const ratio = window > 0 ? used / window : 0
  return { used, window, ratio, level: overflowLevelOf(ratio, overflow) }
}
/** 级别 → 标签。 */
function overflowLevelLabel(level) {
  const labels = {
    normal: strings.levelNormal(),
    warn: strings.levelWarn(),
    alert: strings.levelAlert(),
    critical: strings.levelCritical(),
  }
  return labels[level] || strings.levelNormal()
}
/** 前 N 个占比最高的构成分类（[{label, percent}]）。 */
function topComposition(composition, count) {
  const keys = ['system', 'tools', 'user', 'inject', 'assistant', 'tool']
  const items = keys
    .filter((key) => (composition[key] || 0) > 0)
    .map((key) => ({ key, label: compositionLabel(key), value: composition[key] || 0 }))
    .sort((a, b) => b.value - a.value)
  const total = items.reduce((sum, it) => sum + it.value, 0)
  if (total <= 0) return []
  return items.slice(0, count).map((it) => ({ label: it.label, percent: strings.percent(it.value / total) }))
}
/** 上下文占用卡：进度条（级别色）+ 级别徽标 + 压缩建议。 */
function ContextUsageCard({ session, overflow }) {
  const meter = usageMeter(session, overflow)
  const width = `${Math.min(100, meter.ratio * 100)}%`
  const bar =
    meter.window > 0
      ? [
          createElement(
            'div',
            { className: 'dso-usage-track' },
            createElement('div', { className: `dso-usage-fill dso-usage-${meter.level}`, style: { width } }),
          ),
          createElement(
            'div',
            { className: 'dso-usage-meta' },
            `${strings.tokens(meter.used)} / ${strings.tokens(meter.window)} · ${strings.overflowRatio()} ${strings.percent(meter.ratio)}`,
          ),
        ]
      : createElement('div', { className: 'dso-empty' }, strings.contextUsageUnknown())
  return createElement(
    'div',
    { className: 'dso-card' },
    createElement(
      'div',
      { className: 'dso-card-head' },
      createElement('span', { className: 'dso-card-title' }, strings.contextUsage()),
      createElement('span', { className: `dso-badge dso-overflow-${meter.level}` }, overflowLevelLabel(meter.level)),
    ),
    bar,
    createElement(CompressSuggestions, { meter, session }),
  )
}
/** 压缩建议卡（非 normal 级别展示）。 */
function CompressSuggestions({ meter, session }) {
  if (meter.level === 'normal') return null
  const top = topComposition(session.composition, 2)
  const items = [strings.suggestNewSession(), strings.suggestCompact()]
  if (top.length > 0) items.push(strings.suggestComposition(top.map((t) => t.label).join('、')))
  return createElement(
    'div',
    { className: 'dso-suggest' },
    createElement('div', { className: 'dso-suggest-title' }, strings.suggestTitle(meter.level)),
    createElement(
      'ul',
      { className: 'dso-suggest-list' },
      items.map((text) => createElement('li', { key: text }, text)),
    ),
  )
}
/** 溢出预警记录列表（最新在前）。 */
function OverflowList({ overflows }) {
  if (overflows.length === 0) return createElement('div', { className: 'dso-empty' }, strings.noOverflows())
  const rows = [...overflows].reverse().map((item) => {
    const meta = `${strings.tokens(item.used)} / ${strings.tokens(item.window)} · ${strings.overflowRatio()} ${strings.percent(item.ratio)} · ${strings.overflowThreshold(item.threshold)}`
    return createElement(
      'div',
      { key: item.id, className: `dso-alert dso-alert-${item.level === 'critical' ? 'danger' : 'warn'}` },
      createElement(
        'div',
        { className: 'dso-alert-head' },
        createElement('span', { className: 'dso-badge dso-badge-overflow' }, overflowLevelLabel(item.level)),
        createElement('span', { className: 'dso-time' }, timeText(item.time)),
      ),
      createElement('div', { className: 'dso-alert-msg' }, meta),
    )
  })
  return createElement('div', { className: 'dso-timeline' }, rows)
}
/** 溢出预警区块（标题 + 记录列表）。 */
function OverflowSection({ overflows }) {
  return createElement(
    'div',
    { className: 'dso-section' },
    createElement('div', { className: 'dso-section-title' }, strings.overflowSection()),
    createElement(OverflowList, { overflows }),
  )
}
/** 阈值输入行（百分比数字 + 标签）。 */
function ThresholdField({ label, value, onChange }) {
  return createElement(
    'div',
    { className: 'dso-repo-row' },
    createElement('input', {
      className: 'dso-input dso-budget-input',
      type: 'number',
      min: 0,
      max: 100,
      value,
      onChange: (e) => onChange(e.target.value),
    }),
    createElement('span', { className: 'dso-time' }, label),
  )
}
/** 保存溢出阈值配置。 */
async function saveOverflow(payload, setBusy, setFeedback, onSaved) {
  setBusy(true)
  setFeedback('')
  try {
    await apiJson('/context/api/overflow', {
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
/** 溢出阈值配置：预警/告警阈值输入 + 保存。 */
function OverflowSettings({ overflow, onSaved }) {
  const [warn, setWarn] = useState(String((overflow.warnThreshold || 0.8) * 100))
  const [alert, setAlert] = useState(String((overflow.alertThreshold || 0.9) * 100))
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const save = () =>
    void saveOverflow(
      { warnThreshold: Number(warn) / 100, alertThreshold: Number(alert) / 100 },
      setBusy,
      setFeedback,
      onSaved,
    )
  return createElement(
    'div',
    { className: 'dso-section' },
    createElement('div', { className: 'dso-section-title' }, strings.overflowConfig()),
    createElement(ThresholdField, { label: strings.warnThresholdLabel(), value: warn, onChange: setWarn }),
    createElement(ThresholdField, { label: strings.alertThresholdLabel(), value: alert, onChange: setAlert }),
    createElement(
      'div',
      { className: 'dso-repo-row' },
      createElement('button', { className: 'dso-btn dso-btn-primary', disabled: busy, onClick: save }, strings.save()),
    ),
    feedback !== '' ? createElement('div', { className: 'dso-feedback' }, feedback) : null,
  )
}

    'use strict'
// ── 样式（DSH 语义 token，随 activation 注入 / teardown 卸载）──────
const STYLES = `
.dso-panel{display:flex;flex-direction:column;gap:10px;padding:12px;color:var(--dsw-alias-label-primary)}
.dso-toolbar{display:flex;flex-direction:column;gap:8px}
.dso-select{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px}
.dso-input{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px}
.dso-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dso-card{display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px}
.dso-card-head{display:flex;align-items:center;gap:8px;justify-content:space-between}
.dso-card-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dso-stat-row{display:flex;gap:8px;flex-wrap:wrap}
.dso-stat{display:flex;flex-direction:column;gap:2px;flex:1;min-width:90px}
.dso-stat-value{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dso-stat-label{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dso-comp{display:flex;flex-direction:column;gap:6px}
.dso-comp-row{display:flex;align-items:center;gap:8px}
.dso-comp-label{flex:none;width:64px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dso-comp-track{flex:1;height:10px;background:var(--dsw-alias-bg-layer-1);border-radius:5px;overflow:hidden}
.dso-comp-fill{height:100%;border-radius:5px}
.dso-comp-system{background:var(--dsw-alias-state-info-primary)}
.dso-comp-tools{background:var(--dsw-alias-state-warn-primary)}
.dso-comp-user{background:var(--dsw-alias-interactive-primary)}
.dso-comp-inject{background:var(--dsw-alias-state-error-primary)}
.dso-comp-assistant{background:var(--dsw-alias-state-success-primary)}
.dso-comp-tool{background:var(--dsw-alias-label-tertiary)}
.dso-comp-value{flex:none;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dso-timeline{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto}
.dso-request{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px}
.dso-request-head{display:flex;align-items:center;gap:8px;justify-content:space-between}
.dso-request-meta{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.6;margin-top:2px}
.dso-badge{flex:none;font:var(--dsw-font-xxxs-strong-11);border-radius:4px;padding:1px 6px}
.dso-badge-llm{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)}
.dso-badge-budget{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
.dso-time{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dso-empty{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);text-align:center;padding:16px 8px;line-height:1.7}
.dso-section{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}
.dso-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dso-repo-row{display:flex;gap:8px;align-items:center}
.dso-budget-input{flex:none;width:110px}
.dso-budget-mode{flex:none;width:96px}
.dso-btn{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 12px;cursor:pointer}
.dso-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dso-btn:disabled{opacity:.5;cursor:default}
.dso-btn-primary{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-interactive-primary);
  background:color-mix(in srgb, var(--dsw-alias-interactive-primary) 16%, transparent)}
.dso-feedback{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);word-break:break-all;line-height:1.5}
.dso-alert{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px}
.dso-alert-danger{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent)}
.dso-alert-warn{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent)}
.dso-alert-head{display:flex;align-items:center;gap:8px;justify-content:space-between}
.dso-alert-msg{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);line-height:1.5;margin-top:2px}
.dso-usage{display:flex;flex-direction:column;gap:4px}
.dso-usage-track{height:10px;background:var(--dsw-alias-bg-layer-1);border-radius:5px;overflow:hidden}
.dso-usage-fill{height:100%;border-radius:5px;transition:width .3s ease}
.dso-usage-normal{background:var(--dsw-alias-interactive-primary)}
.dso-usage-warn{background:var(--dsw-alias-state-warn-primary)}
.dso-usage-alert{background:var(--dsw-alias-state-error-primary)}
.dso-usage-critical{background:var(--dsw-alias-state-error-primary)}
.dso-usage-meta{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dso-overflow-normal{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)}
.dso-overflow-warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)}
.dso-overflow-alert{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
.dso-overflow-critical{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
.dso-suggest{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}
.dso-suggest-title{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);margin-bottom:4px}
.dso-suggest-list{margin:0;padding-left:18px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.6}
.dso-badge-overflow{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
`
function injectStyles() {
  if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-my-context', 'styles')
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style)
  }
}


    // ── 插件体：样式注入 + 页签注册 ─────────────────────────────────────
    exports.inject = ['betterSidebar']

    exports.apply = function apply(ctx) {
      ctx.effect(() => injectStyles(), 'dsh-my-context: styles')
      const service = ctx.betterSidebar
      if (service === undefined) return
      ctx.effect(
        () =>
          service.registerTab({
            id: 'dsh-my-context:context',
            title: () => strings.tabTitle(),
            order: 43,
            single: true,
            component: (props) => createElement(ContextPanel, props),
          }),
        'dsh-my-context: context tab registration',
      )
    }

    return module.exports
  },
})
