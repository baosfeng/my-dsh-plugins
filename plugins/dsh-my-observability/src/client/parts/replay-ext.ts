// ── 审计视图扩展：搜索 / 组合过滤 / 导出 / 统计 / 高亮（replay.js 拆出）────
// 依赖 replay.js（REPLAY_POLL_MS 等常量与 loadReplayData/EventRow）与
// audit-view.js 纯函数（applyAuditFilter 等）。始终以 function 声明提升。

const REPLAY_POLL_MS = 5000
const ALL_SESSIONS = '*'
const EXPORT_LIMIT_ALL = 20000

/** `datetime-local` 值 → 毫秒时间戳（空/非法返回 undefined）。 */
function datetimeToMs(value: any): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

/** 是否有活动过滤条件（决定无匹配/空状态展示）。 */
function hasActiveFilter(criteria: any): boolean {
  return (
    criteria.keyword !== '' ||
    criteria.result !== '' ||
    criteria.timeStart !== undefined ||
    criteria.timeEnd !== undefined ||
    criteria.type !== ''
  )
}

/** 命中关键词高亮（`mark` 包裹命中段；无关键词时原样文本）。 */
function HighlightText({ text, keyword }: { text: string; keyword?: string }): unknown {
  const segments = highlightSegments(text, keyword)
  return createElement(
    'span',
    null,
    segments.map((seg, index) =>
      seg.hit ? createElement('mark', { key: index, className: 'dsh-my-observability-mark' }, seg.text) : seg.text,
    ),
  )
}

/** 搜索 / 组合过滤栏：关键词 + 时间范围 + 成功/失败。 */
/** 搜索框行（含清除按钮）。 */
function SearchInput({
  keyword,
  onKeyword,
  onClear,
}: {
  keyword: string
  onKeyword: (value: string) => void
  onClear: () => void
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-search-row' },
    createElement('input', {
      className: 'dsh-my-observability-input',
      type: 'search',
      value: keyword,
      placeholder: strings.searchPlaceholder(),
      onChange: (e) => onKeyword(e.target.value),
    }),
    keyword !== ''
      ? createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-observability-iconbtn',
            'aria-label': strings.clearFilters(),
            title: strings.clearFilters(),
            onClick: onClear,
          },
          icon.close(15),
        )
      : null,
  )
}

/** 时间范围行（开始/结束，datetime-local）。 */
function TimeRangeInput({
  timeStart,
  onTimeStart,
  timeEnd,
  onTimeEnd,
}: {
  timeStart: string
  onTimeStart: (value: string) => void
  timeEnd: string
  onTimeEnd: (value: string) => void
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-time-row' },
    createElement('label', { className: 'dsh-my-observability-time-label' }, strings.timeStartLabel()),
    createElement('input', {
      className: 'dsh-my-observability-input dsh-my-observability-time-input',
      type: 'datetime-local',
      value: timeStart,
      onChange: (e) => onTimeStart(e.target.value),
    }),
    createElement('label', { className: 'dsh-my-observability-time-label' }, strings.timeEndLabel()),
    createElement('input', {
      className: 'dsh-my-observability-input dsh-my-observability-time-input',
      type: 'datetime-local',
      value: timeEnd,
      onChange: (e) => onTimeEnd(e.target.value),
    }),
  )
}

/** 成功/失败结果过滤组。 */
function ResultFilter({ result, onResult }: { result: string; onResult: (value: string) => void }): unknown {
  const options = [
    ['', strings.filterAllResult()],
    ['success', strings.filterSuccess()],
    ['fail', strings.filterFail()],
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
          className: `dsh-my-observability-chip${result === value ? ' dsh-my-observability-chip-active' : ''}`,
          'aria-pressed': result === value,
          onClick: () => onResult(value),
        },
        label,
      ),
    ),
  )
}

/** 搜索 / 组合过滤栏：关键词 + 时间范围 + 成功/失败。 */
function SearchFilterBar({
  keyword,
  onKeyword,
  timeStart,
  onTimeStart,
  timeEnd,
  onTimeEnd,
  result,
  onResult,
  onClear,
}: {
  keyword: string
  onKeyword: (value: string) => void
  timeStart: string
  onTimeStart: (value: string) => void
  timeEnd: string
  onTimeEnd: (value: string) => void
  result: string
  onResult: (value: string) => void
  onClear: () => void
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-toolbar' },
    createElement(SearchInput, { keyword, onKeyword, onClear }),
    createElement(TimeRangeInput, { timeStart, onTimeStart, timeEnd, onTimeEnd }),
    createElement(ResultFilter, { result, onResult }),
  )
}

/** 导出栏：导出范围选择（当前会话/全部会话）+ JSON/CSV 按钮 + 统计开关。 */
function ExportBar({
  scope,
  onScope,
  onExportJson,
  onExportCsv,
  showStats,
  onToggleStats,
  disabled,
}: {
  scope: string
  onScope: (value: string) => void
  onExportJson: () => void
  onExportCsv: () => void
  showStats: boolean
  onToggleStats: () => void
  disabled: boolean
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-export' },
    createElement(
      'div',
      { className: 'dsh-my-observability-toolbar-row' },
      createElement(
        'select',
        {
          className: 'dsh-my-observability-select',
          value: scope,
          disabled,
          onChange: (e) => onScope(e.target.value),
        },
        createElement('option', { value: 'session' }, strings.scopeSession()),
        createElement('option', { value: 'all' }, strings.scopeAll()),
      ),
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-observability-btn', disabled, onClick: onExportJson },
        strings.exportJson(),
      ),
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-observability-btn', disabled, onClick: onExportCsv },
        strings.exportCsv(),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-observability-btn',
          'aria-pressed': showStats,
          onClick: onToggleStats,
        },
        strings.statsTitle(),
      ),
    ),
  )
}

/** 工具调用统计视图（Top N 调用次数 + 失败率）。 */
function StatsPanel({ events }: { events: any[] }): unknown {
  const stats = computeToolStats(events, 5)
  if (stats.length === 0)
    return createElement('div', { className: 'dsh-my-observability-stats-empty' }, strings.statsEmpty())
  return createElement(
    'div',
    { className: 'dsh-my-observability-stats' },
    createElement('div', { className: 'dsh-my-observability-stats-title' }, strings.statsTitle()),
    createElement(
      'table',
      { className: 'dsh-my-observability-stats-table' },
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          createElement('th', null, strings.statsTool()),
          createElement('th', null, strings.statsCalls()),
          createElement('th', null, strings.statsFailRate()),
        ),
      ),
      createElement(
        'tbody',
        null,
        stats.map((s) =>
          createElement(
            'tr',
            { key: s.tool },
            createElement('td', null, s.tool),
            createElement('td', null, String(s.calls)),
            createElement('td', null, `${(s.failRate * 100).toFixed(1)}%`),
          ),
        ),
      ),
    ),
  )
}

/** 无匹配状态（搜索/过滤条件命中 0 条）。 */
function NoMatchesState(): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-empty' },
    createElement('span', { className: 'dsh-my-observability-empty-icon' }, icon.search(20)),
    createElement('span', null, strings.noMatches()),
  )
}

/** 触发浏览器下载（Blob + a[download]）。 */
function downloadAudit(content: string, format: string): void {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
  const filename = `${strings.exportFileName()}-${stamp}.${format}`
  const mime = format === 'json' ? 'application/json' : 'text/csv;charset=utf-8'
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 拉取全部会话事件（导出范围「全部会话」用），并应用当前过滤条件。 */
async function allSessionEvents(criteria: any): Promise<any[]> {
  const all = await apiJson(
    `/observability/api/events?sessionId=${encodeURIComponent(ALL_SESSIONS)}&limit=${EXPORT_LIMIT_ALL}`,
  )
  return applyAuditFilter(all, criteria)
}

/** 导出：依据范围（当前会话=过滤后结果 / 全部会话=拉取后过滤）生成并下载。 */
async function runExport(
  format: string,
  scope: string,
  filtered: any[],
  criteria: any,
  onError: (message: string) => void,
): Promise<void> {
  try {
    const dataEvents = scope === 'session' ? filtered : await allSessionEvents(criteria)
    downloadAudit(format === 'json' ? auditToJson(dataEvents) : auditToCsv(dataEvents), format)
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err))
  }
}

/** 轨迹回放面板的数据状态：会话列表 + 选中 + 事件 + 轮询 + 加载/错误。
 *  隐藏时暂停轮询，可见时按 REPLAY_POLL_MS 拉取并自动选当前会话。 */
function useReplayDataState(props: any): any {
  const currentSession = props?.scope?.sessionId || ''
  const visible = props?.visible !== false
  const [sessions, setSessions] = useState([])
  const [selected, setSelected] = useState('')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [resource, setResource] = useState(null)

  // 资源采样轮询（写放大/资源超限预警；可见时 15s 一次，隐藏暂停）
  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    const tick = () => {
      if (alive)
        apiJson('/observability/api/resources')
          .then(setResource)
          .catch(() => {})
    }
    tick()
    const timer = setInterval(tick, RESOURCE_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    const setters = { setSessions, setSelected, setEvents, setError, setLoading }
    const tick = () => {
      if (alive) void loadReplayData(selected, currentSession, setters)
    }
    tick()
    const timer = setInterval(tick, REPLAY_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [visible, selected, currentSession, reloadTick])

  const retry = () => {
    setError('')
    setLoading(true)
    setReloadTick((tick) => tick + 1)
  }

  return {
    currentSession,
    resource,
    sessions,
    selected,
    events,
    loading,
    error,
    setSessions,
    setSelected,
    setEvents,
    setLoading,
    setError,
    retry,
  }
}

/** 轨迹回放面板的视图状态：过滤条件（类型/关键词/时间/成功失败）+ 导出范围 +
 *  统计开关，及派生值（过滤结果 / 高亮行 / 可导出）。 */
function useReplayState(props: any): any {
  const data = useReplayDataState(props)
  const [filter, setFilter] = useState('')
  const [keyword, setKeyword] = useState('')
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')
  const [result, setResult] = useState('')
  const [scope, setScope] = useState('session')
  const [showStats, setShowStats] = useState(false)

  const clearFilters = () => {
    setKeyword('')
    setTimeStart('')
    setTimeEnd('')
    setResult('')
    setFilter('')
  }

  const criteria = {
    type: filter,
    keyword,
    timeStart: datetimeToMs(timeStart),
    timeEnd: datetimeToMs(timeEnd),
    result,
  }
  const filtered = applyAuditFilter(data.events, criteria)
  const hasFilter = hasActiveFilter(criteria)
  const rows = filtered.map((event, index) => createElement(EventRow, { key: event.id ?? index, event, keyword }))
  const canExport = !data.loading && data.events.length > 0
  const onExport = (format: string) => void runExport(format, scope, filtered, criteria, data.setError)

  return {
    resource: data.resource,
    sessions: data.sessions,
    selected: data.selected,
    events: data.events,
    loading: data.loading,
    error: data.error,
    filter,
    keyword,
    timeStart,
    timeEnd,
    result,
    scope,
    showStats,
    setSelected: data.setSelected,
    setFilter,
    setKeyword,
    setTimeStart,
    setTimeEnd,
    setResult,
    setScope,
    setShowStats,
    retry: data.retry,
    clearFilters,
    filtered,
    hasFilter,
    rows,
    canExport,
    onExport,
  }
}
