// ── 轨迹回放面板（时间轴）──────────────────────────────────────────
// 拆分的审计视图组件（搜索/组合过滤/导出/统计/高亮/hook）位于
// replay-ext.js 片段（见 client.src.js 占位符顺序）。

/** 请求插件 API（非 2xx 抛错；返回响应 JSON 的 value 字段）。 */
function apiJson(path, options) {
  return fetch(path, options).then(async (res) => {
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
    return data.value
  })
}

/** 事件类型 → 中文标签。 */
function typeLabel(event) {
  switch (event.type) {
    case 'agent_status':
      return strings.typeAgentStatus()
    case 'llm_stream':
      return strings.typeLlmStream()
    case 'tool_call':
      return strings.typeToolCall()
    case 'tool_result':
      return strings.typeToolResult()
    case 'plugin_event':
      return strings.typePluginEvent()
    default:
      return event.type
  }
}

/** 事件类型 → 视觉类别（徽标/图标/节点共用，颜色语义一致）：
 *  status=info / llm=warn / call=accent / result=success / fail=danger /
 *  plugin=info（插件事件复用 info 色，图标区分）。 */
function typeKind(event) {
  if (event.type === 'agent_status') return 'status'
  if (event.type === 'llm_stream') return 'llm'
  if (event.type === 'tool_call') return 'call'
  if (event.type === 'plugin_event') return 'plugin'
  return event.data?.ok === false ? 'fail' : 'result'
}

/** 事件类型 → 类型图标（共享线性图标集，stroke=currentColor）。 */
function typeIcon(event) {
  const kind = typeKind(event)
  if (kind === 'status') return icon.clock(15)
  if (kind === 'llm') return icon.file(15)
  if (kind === 'call') return icon.external(15)
  if (kind === 'plugin') return icon.alert(15)
  if (kind === 'fail') return icon.close(15)
  return icon.check(15)
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

/** agent 类型标记 → 中文。 */
function agentTypeText(agentType) {
  if (agentType === 'top') return strings.agentTop()
  if (agentType === 'subagent') return strings.agentSub()
  return strings.agentUnknown()
}

/** 模型流阶段 → 中文。 */
function phaseText(phase) {
  if (phase === 'start') return strings.phaseStart()
  if (phase === 'end') return strings.phaseEnd()
  if (phase === 'error') return strings.phaseError()
  return phase
}

/** agent 状态事件摘要。 */
function agentMeta(data) {
  return `状态 ${data.status} · ${agentTypeText(data.agentType)}`
}

/** 模型流事件摘要（开始/结束/错误 + 统计）。 */
function llmMeta(data) {
  const stats = data.phase === 'start' ? '' : ` · ${data.chunks} chunks / ${data.chars} chars / ${data.ms}ms`
  const error = data.message !== undefined ? `：${data.message}` : ''
  return `${phaseText(data.phase)}${stats}${error}`
}

/** 工具调用事件摘要（名称 + 参数摘要）。 */
function toolCallMeta(data) {
  const args = data.args && data.args.summary !== undefined ? ` — ${data.args.summary}` : ''
  return `${data.name}${args}`
}

/** 工具结果事件摘要（名称 + 成败 + 耗时）。 */
function toolResultMeta(data) {
  const result = data.ok === false ? strings.toolFail() : strings.toolOk()
  return `${data.name} · ${result} · ${data.ms}ms`
}

/** 插件事件摘要（插件名 · 事件名 · 动作；issue #154）。 */
function pluginEventMeta(data) {
  const action = typeof data.action === 'string' && data.action !== '' ? data.action : data.event
  return `${data.plugin} · ${data.event} · ${action}`
}

/** 事件 → 摘要文本（单行，尽力而为）。 */
function eventMeta(event) {
  const data = event.data || {}
  if (event.type === 'agent_status') return agentMeta(data)
  if (event.type === 'llm_stream') return llmMeta(data)
  if (event.type === 'tool_call') return toolCallMeta(data)
  if (event.type === 'tool_result') return toolResultMeta(data)
  if (event.type === 'plugin_event') return pluginEventMeta(data)
  return ''
}

/** 插件事件详情行（原因 + 参数键值对；非插件事件返回 null 不可展开）。 */
function eventDetail(event) {
  if (event?.type !== 'plugin_event') return null
  const data = event.data || {}
  const rows = []
  if (typeof data.reason === 'string' && data.reason !== '') {
    rows.push(
      createElement(
        'div',
        { key: 'reason', className: 'dsh-my-observability-detail-row' },
        createElement('span', { className: 'dsh-my-observability-detail-key' }, strings.detailReason()),
        createElement('span', { className: 'dsh-my-observability-detail-value' }, data.reason),
      ),
    )
  }
  if (data.params !== null && typeof data.params === 'object') {
    for (const [key, value] of Object.entries(data.params)) {
      rows.push(
        createElement(
          'div',
          { key, className: 'dsh-my-observability-detail-row' },
          createElement('span', { className: 'dsh-my-observability-detail-key' }, key),
          createElement('span', { className: 'dsh-my-observability-detail-value' }, String(value)),
        ),
      )
    }
  }
  return rows.length > 0 ? rows : null
}

/** 单条事件行：节点圆点 + 类型图标 + 徽标/时间 + 摘要（hover/active 反馈）。
 *  摘要命中关键词时以 mark 高亮；插件事件可点击展开详情（原因/参数）。 */
function EventRow({ event, keyword }) {
  const meta = eventMeta(event)
  const kind = typeKind(event)
  const detail = eventDetail(event)
  const [open, setOpen] = useState(false)
  return createElement(
    'button',
    {
      className: 'dsh-my-observability-event',
      type: 'button',
      'aria-expanded': detail !== null ? open : undefined,
      onClick: detail !== null ? () => setOpen(!open) : undefined,
    },
    createElement('span', { className: `dsh-my-observability-node dsh-my-observability-node-${kind}` }),
    createElement(
      'span',
      { className: `dsh-my-observability-event-icon dsh-my-observability-icon-${kind}` },
      typeIcon(event),
    ),
    createElement(
      'span',
      { className: 'dsh-my-observability-event-body' },
      createElement(
        'span',
        { className: 'dsh-my-observability-event-head' },
        createElement(
          'span',
          { className: `dsh-my-observability-badge dsh-my-observability-badge-${kind}` },
          typeLabel(event),
        ),
        createElement('span', { className: 'dsh-my-observability-time' }, timeText(event.time)),
      ),
      meta !== ''
        ? createElement(
            'span',
            { className: 'dsh-my-observability-event-meta' },
            createElement(HighlightText, { text: meta, keyword }),
          )
        : null,
      detail !== null && open ? createElement('div', { className: 'dsh-my-observability-event-detail' }, detail) : null,
    ),
  )
}

/** 类型过滤按钮组（aria-pressed 选中态；plugin 过滤插件事件，issue #154）。 */
function TypeFilter({ filter, onFilter }) {
  const options = [
    ['', strings.filterAll()],
    ['agent_status', strings.filterStatus()],
    ['llm_stream', strings.filterLlm()],
    ['tool', strings.filterTools()],
    ['plugin', strings.filterPlugin()],
  ]
  return createElement(
    'div',
    { className: 'dsh-my-observability-filters' },
    options.map(([value, label]) =>
      createElement(
        'button',
        {
          key: value,
          type: 'button',
          className: `dsh-my-observability-chip${filter === value ? ' dsh-my-observability-chip-active' : ''}`,
          'aria-pressed': filter === value,
          onClick: () => onFilter(value),
        },
        label,
      ),
    ),
  )
}

/** 拉取会话列表与事件（选中为空时自动选当前/首个会话）。 */
async function loadReplayData(selected, currentSession, setters) {
  try {
    const list = await apiJson('/observability/api/sessions')
    setters.setSessions(list)
    if (selected === '' && list.length > 0) {
      const preferred = list.some((s) => s.sessionId === currentSession) ? currentSession : list[0].sessionId
      setters.setSelected(preferred)
      return
    }
    const query =
      selected !== ''
        ? `/observability/api/events?sessionId=${encodeURIComponent(selected)}&limit=300`
        : '/observability/api/events?limit=0'
    setters.setEvents(await apiJson(query))
    setters.setError('')
  } catch (err) {
    setters.setError(err instanceof Error ? err.message : String(err))
  } finally {
    setters.setLoading(false)
  }
}

/** 下拉选项文案：可读标题（首条用户消息）优先，无标题回退 UUID 短显；
 *  附加事件数与时间，用户一眼看出"哪个对话"。 */
function sessionOptionLabel(s) {
  const title = typeof s.title === 'string' && s.title !== '' ? s.title : strings.sessionFallback(shortId(s.sessionId))
  return `${title} · ${strings.eventCount(s.count)}`
}

/** 会话 id 短显示（UUID 取前 8 位）。 */
function shortId(sessionId) {
  return typeof sessionId === 'string' && sessionId.length > 8 ? `${sessionId.slice(0, 8)}…` : sessionId || ''
}

/** 工具栏：会话选择 + 手动刷新 + 类型过滤。 */
function ReplayToolbar({ sessions, selected, onSelect, filter, onFilter, onRefresh }) {
  return createElement(
    'div',
    { className: 'dsh-my-observability-toolbar' },
    createElement(
      'div',
      { className: 'dsh-my-observability-toolbar-row' },
      createElement(
        'select',
        {
          className: 'dsh-my-observability-select',
          value: selected,
          disabled: sessions.length === 0,
          onChange: (e) => onSelect(e.target.value),
        },
        sessions.length === 0
          ? createElement('option', { value: '' }, strings.allSessions())
          : sessions.map((s) =>
              createElement('option', { key: s.sessionId, value: s.sessionId }, sessionOptionLabel(s)),
            ),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-observability-iconbtn',
          'aria-label': strings.refresh(),
          title: strings.refresh(),
          onClick: onRefresh,
        },
        icon.refresh(15),
      ),
    ),
    createElement(TypeFilter, { filter, onFilter }),
  )
}

/** 加载中状态（旋转刷新图标 + 次级色文案，不阻塞布局）。 */
function LoadingState() {
  return createElement(
    'div',
    { className: 'dsh-my-observability-state' },
    icon.refresh(14),
    createElement('span', null, strings.loading()),
  )
}

/** 空状态（图标 + 主文案 + hint 两行结构）。 */
function EmptyState() {
  return createElement(
    'div',
    { className: 'dsh-my-observability-empty' },
    createElement('span', { className: 'dsh-my-observability-empty-icon' }, icon.clock(20)),
    createElement('span', null, strings.emptyEvents()),
    createElement('span', { className: 'dsh-my-observability-empty-hint' }, strings.emptyEventsHint()),
  )
}

/** 错误状态（错误色文案 + 重试按钮）。 */
function ErrorState({ message, onRetry }) {
  return createElement(
    'div',
    { className: 'dsh-my-observability-error' },
    createElement('span', { className: 'dsh-my-observability-error-text' }, `${strings.loadError()}：${message}`),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-observability-iconbtn',
        'aria-label': strings.retry(),
        title: strings.retry(),
        onClick: onRetry,
      },
      icon.refresh(15),
    ),
  )
}

/** 轨迹回放主面板：会话选择 + 类型过滤 + 搜索/组合过滤 + 导出 + 统计 + 时间轴。
 *  状态与派生值集中在 replay-ext.js 的 useReplayState；本组件只拼装视图。
 *  面板可见时轮询、隐藏时暂停。 */
function ReplayPanel(props) {
  const s = useReplayState(props)
  return createElement(
    'div',
    { className: 'dsh-my-observability-panel' },
    createElement(ResourcePanel, { resource: s.resource }),
    createElement(ReplayToolbar, {
      sessions: s.sessions,
      selected: s.selected,
      onSelect: s.setSelected,
      filter: s.filter,
      onFilter: s.setFilter,
      onRefresh: s.retry,
    }),
    createElement(SearchFilterBar, {
      keyword: s.keyword,
      onKeyword: s.setKeyword,
      timeStart: s.timeStart,
      onTimeStart: s.setTimeStart,
      timeEnd: s.timeEnd,
      onTimeEnd: s.setTimeEnd,
      result: s.result,
      onResult: s.setResult,
      onClear: s.clearFilters,
    }),
    createElement(ExportBar, {
      scope: s.scope,
      onScope: s.setScope,
      onExportJson: () => void s.onExport('json'),
      onExportCsv: () => void s.onExport('csv'),
      showStats: s.showStats,
      onToggleStats: () => s.setShowStats((value) => !value),
      disabled: !s.canExport,
    }),
    s.error !== '' ? createElement(ErrorState, { message: s.error, onRetry: s.retry }) : null,
    s.loading && s.error === '' ? createElement(LoadingState, null) : null,
    !s.loading && s.error === '' && s.filtered.length === 0
      ? s.hasFilter
        ? createElement(NoMatchesState, null)
        : createElement(EmptyState, null)
      : null,
    s.showStats ? createElement(StatsPanel, { events: s.filtered }) : null,
    createElement('div', { className: 'dsh-my-observability-timeline' }, s.rows),
  )
}
