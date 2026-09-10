// ── 上下文溢出预警（issue #87）────────────────────────────────────
// 用量比例 + 分级预警（80/90/95%）进度条、压缩建议卡、预警记录列表、
// 阈值配置。与 server lib/overflow.js 语义一致（比值口径 = 当前上下文
// 长度/contextWindow，其中"当前上下文长度"取最近一次请求的 prompt——
// 历史累计 usage 含每轮重复的 cacheRead，会导致占用虚高数倍）；
// client 无相对 import，分级逻辑在此本地复刻。

/** 当前上下文长度（最近一次请求 prompt；旧数据回退最近请求快照）。 */
function contextUsage(session: CtxSession): number {
  if (typeof session?.lastPromptTokens === 'number' && session.lastPromptTokens > 0) {
    return session.lastPromptTokens
  }
  const requests = session?.requests || []
  const last = requests[requests.length - 1]
  return typeof last?.prompt === 'number' ? last.prompt : 0
}

/** 非负有限比例，夹到 [0,1]。 */
function ratioTo(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** 用量比例分级：normal / warn / alert / critical。 */
function overflowLevelOf(ratio: number, overflow: CtxOverflowConfig): string {
  const warn = ratioTo(overflow?.warnThreshold, 0.8)
  const alert = ratioTo(overflow?.alertThreshold, 0.9)
  if (ratio >= 0.95) return 'critical'
  if (ratio >= alert) return 'alert'
  if (ratio >= warn) return 'warn'
  return 'normal'
}

/** 当前会话用量表：{ used, window, ratio, level }。 */
function usageMeter(session: CtxSession, overflow: CtxOverflowConfig): CtxMeter {
  const window = session.contextWindow || 0
  const used = contextUsage(session)
  const ratio = window > 0 ? used / window : 0
  return { used, window, ratio, level: overflowLevelOf(ratio, overflow) }
}

/** 级别 → 标签。 */
function overflowLevelLabel(level: string): string {
  const labels = {
    normal: strings.levelNormal(),
    warn: strings.levelWarn(),
    alert: strings.levelAlert(),
    critical: strings.levelCritical(),
  }
  return labels[level] || strings.levelNormal()
}

/** 前 N 个占比最高的构成分类（[{label, percent}]）。 */
function topComposition(composition: CtxComposition, count: number): { label: string; percent: string }[] {
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
function ContextUsageCard({ session, overflow }: CtxContextUsageCardProps) {
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
function CompressSuggestions({ meter, session }: CtxCompressSuggestionsProps) {
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
function OverflowList({ overflows }: CtxOverflowListProps) {
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
function OverflowSection({ overflows }: CtxOverflowSectionProps) {
  return createElement(
    'div',
    { className: 'dso-section' },
    createElement('div', { className: 'dso-section-title' }, strings.overflowSection()),
    createElement(OverflowList, { overflows }),
  )
}

/** 阈值输入行（百分比数字 + 标签）。 */
function ThresholdField({ label, value, onChange }: CtxThresholdFieldProps) {
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
async function saveOverflow(
  payload: { warnThreshold: number; alertThreshold: number },
  setBusy: (busy: boolean) => void,
  setFeedback: (feedback: string) => void,
  onSaved: () => void,
): Promise<void> {
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
function OverflowSettings({ overflow, onSaved }: CtxOverflowSettingsProps) {
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
