/**
 * dsh-my-observability — audit log view helpers (pure functions).
 *
 * 轨迹回放面板的搜索 / 组合过滤 / 导出（JSON/CSV）/ 统计的纯逻辑，无副作用、
 * 不依赖 React 与 cordis（可被 vitest 直接导入单测），仅供 client 端在已加载
 * 的审计事件数据上做视图变换。DSH ModuleLoader 不支持相对路径 require，client
 * 侧经 scripts/build.mjs 把本文件（剥离 `export` 前缀）作为片段拼接进
 * lib/client.js 的 factory 作用域，因此本文件约定：
 *  - 只用 `export function`（单行形式），不用 export 块 / export default；
 *  - 顶层没有 import / 副作用；
 *  - 不读取 strings —— 涉及界面文案的默认值集中在此，client 如需 i18n 覆盖
 *    通过参数传入。
 */

/** 事件类型 → 中文标签（CSV 默认；client 可传 labels 覆盖）。非导出常量。 */
const DEFAULT_CSV_LABELS = Object.freeze({
  time: '时间',
  type: '类型',
  tool: '工具',
  result: '结果',
  typeMap: Object.freeze({
    agent_status: 'agent 状态',
    llm_stream: '模型流',
    tool_call: '工具调用',
    tool_result: '工具结果',
  }),
  ok: '成功',
  fail: '失败',
  error: '错误',
})

const MAX_STATS_TOP = 50

/** 两位补零。 */
function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 毫秒时间戳 → `YYYY-MM-DD HH:MM:SS`（本地时区）；非法输入返回空串。 */
export function formatTime(time) {
  if (typeof time !== 'number' || !Number.isFinite(time)) return ''
  const d = new Date(time)
  if (Number.isNaN(d.getTime())) return ''
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  return `${date} ${clock}`
}

/** agent 状态事件的搜索片段。 */
function agentStatusParts(data) {
  return [data.status, data.agentType].filter((part) => typeof part === 'string')
}

/** 模型流事件的搜索片段（含错误消息）。 */
function llmParts(data) {
  const parts = [data.phase]
  if (typeof data.message === 'string' && data.message !== '') parts.push(data.message)
  return parts
}

/** 工具调用事件的搜索片段（工具名 + 参数键 + 参数摘要）。 */
function toolCallParts(data) {
  const parts = []
  if (typeof data.name === 'string') parts.push(data.name)
  if (Array.isArray(data.args?.keys)) parts.push(...data.args.keys)
  if (typeof data.args?.summary === 'string' && data.args.summary !== '') parts.push(data.args.summary)
  return parts
}

/** 工具结果事件的搜索片段（工具名 + 成败）。 */
function toolResultParts(data) {
  const parts = []
  if (typeof data.name === 'string') parts.push(data.name)
  parts.push(data.ok === false ? '失败' : '成功')
  return parts
}

/** 插件事件（issue #154）的搜索片段（插件名/事件名/动作/原因/参数值）。 */
function pluginEventParts(data) {
  const parts = []
  if (typeof data.plugin === 'string') parts.push(data.plugin)
  if (typeof data.event === 'string') parts.push(data.event)
  if (typeof data.action === 'string') parts.push(data.action)
  if (typeof data.reason === 'string') parts.push(data.reason)
  if (data.params !== null && typeof data.params === 'object') {
    for (const value of Object.values(data.params)) {
      if (typeof value === 'string' && value !== '') parts.push(value)
    }
  }
  return parts
}

/** 事件类型 → 搜索片段收集函数（查表消分支）。 */
const PARTS_COLLECTORS = {
  agent_status: agentStatusParts,
  llm_stream: llmParts,
  tool_call: toolCallParts,
  tool_result: toolResultParts,
  plugin_event: pluginEventParts,
}

/** 提取事件可用于关键词匹配的文本（工具名/参数摘要/错误信息/状态/阶段等）。 */
export function searchableText(event) {
  const data = event && event.data ? event.data : {}
  const parts = [event?.type, event?.sessionId]
  const collector = PARTS_COLLECTORS[event?.type]
  if (collector !== undefined) parts.push(...collector(data))
  return parts
    .filter((part) => typeof part === 'string')
    .join(' ')
    .toLowerCase()
}

/** 事件是否命中关键词（不区分大小写；空关键词视为命中全部）。 */
export function matchesKeyword(event, keyword) {
  const kw = String(keyword ?? '')
    .trim()
    .toLowerCase()
  if (kw === '') return true
  return searchableText(event).includes(kw)
}

/** 返回 `true` 表示事件具备失败语义（工具失败 / 模型流出错）。 */
function isFailEvent(event) {
  if (event?.type === 'tool_result') return event.data?.ok === false
  if (event?.type === 'llm_stream') return event.data?.phase === 'error'
  return false
}

/** 归一化过滤条件（时间转为闭区间数值；空值透传）。 */
function normalizeCriteria(criteria) {
  const start =
    typeof criteria.timeStart === 'number' && Number.isFinite(criteria.timeStart) ? criteria.timeStart : undefined
  const end = typeof criteria.timeEnd === 'number' && Number.isFinite(criteria.timeEnd) ? criteria.timeEnd : undefined
  return { type: criteria.type ?? '', keyword: criteria.keyword ?? '', result: criteria.result ?? '', start, end }
}

/** 类型过滤（'tool' 表示 tool_call + tool_result；'plugin' 表示 plugin_event）。 */
function passType(type, filterType) {
  if (filterType === '') return true
  if (filterType === 'tool') return type === 'tool_call' || type === 'tool_result'
  if (filterType === 'plugin') return type === 'plugin_event'
  return type === filterType
}

/** 时间范围闭区间。 */
function passTime(time, start, end) {
  if (start !== undefined && time < start) return false
  if (end !== undefined && time > end) return false
  return true
}

/** 成功/失败过滤：只作用于有成败语义的事件，其余事件透传。 */
function passResult(event, result) {
  if (result === '') return true
  if (result === 'success') return !isFailEvent(event)
  if (result === 'fail') return isFailEvent(event)
  return true
}

/** 组合过滤：类型（tool 表示 tool_call+tool_result）+ 时间范围 + 成功/失败 + 关键词。
 *  criteria: { type, timeStart, timeEnd, result, keyword } */
export function applyAuditFilter(events, criteria = {}) {
  const ctx = normalizeCriteria(criteria)
  return (events ?? []).filter(
    (event) =>
      passType(event.type, ctx.type) &&
      passTime(event.time, ctx.start, ctx.end) &&
      passResult(event, ctx.result) &&
      matchesKeyword(event, ctx.keyword),
  )
}

/** CSV 单元格转义：含逗号/引号/换行时用双引号包裹并转义内嵌引号。 */
export function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 事件的工具名（仅 tool_call/tool_result；否则空）。 */
export function toolNameOf(event) {
  if (event?.type === 'tool_call' || event?.type === 'tool_result') return String(event.data?.name ?? '')
  return ''
}

/** 事件的结果摘要（成功/失败/错误；其余空）。 */
export function resultTextOf(event, labels = DEFAULT_CSV_LABELS) {
  if (event?.type === 'tool_result') return event.data?.ok === false ? labels.fail : labels.ok
  if (event?.type === 'llm_stream' && event.data?.phase === 'error') return labels.error
  return ''
}

/** 生成 CSV 摘要（表头：时间/类型/工具/结果）。labels 可覆盖默认中文。
 *  返回不含换行结尾符的 CSV 文本。 */
export function auditToCsv(events, labels = DEFAULT_CSV_LABELS) {
  const typeMap = labels.typeMap ?? {}
  const header = [labels.time, labels.type, labels.tool, labels.result]
  const lines = [header.map(csvCell).join(',')]
  for (const event of events ?? []) {
    const typeLabel = typeMap[event.type] ?? String(event.type)
    const row = [formatTime(event.time), typeLabel, toolNameOf(event), resultTextOf(event, labels)]
    lines.push(row.map(csvCell).join(','))
  }
  return lines.join('\n')
}

/** 生成 JSON 完整数据（缩进默认 2）。 */
export function auditToJson(events, space = 2) {
  return JSON.stringify(events ?? [], null, space)
}

/** 事件是否为工具类（tool_call / tool_result）。 */
function isToolEvent(event) {
  return event?.type === 'tool_call' || event?.type === 'tool_result'
}

/** 把单条工具事件计入聚合（调用次数 / 失败次数）。 */
function bumpTool(byTool, event, name) {
  const entry = byTool.get(name) ?? { tool: name, calls: 0, fails: 0 }
  if (event.type === 'tool_call') entry.calls += 1
  if (event.type === 'tool_result' && event.data?.ok === false) entry.fails += 1
  byTool.set(name, entry)
}

/** 按工具名聚合调用次数与失败次数。 */
function aggregateToolStats(events) {
  const byTool = new Map()
  for (const event of events ?? []) {
    if (!isToolEvent(event)) continue
    const name = String(event.data?.name ?? '')
    if (name === '') continue
    bumpTool(byTool, event, name)
  }
  return byTool
}

/** 聚合结果 → 排序 + 失败率列表。 */
function rankTools(byTool) {
  return [...byTool.values()]
    .map((entry) => ({ ...entry, failRate: entry.calls > 0 ? entry.fails / entry.calls : 0 }))
    .sort((a, b) => b.calls - a.calls || b.fails - a.fails || a.tool.localeCompare(b.tool))
}

/** 工具调用统计：每个工具调用次数 + 失败率（topN 截断，默认 5）。
 *  返回 [{ tool, calls, fails, failRate }] 按调用次数降序。 */
export function computeToolStats(events, topN = 5) {
  const n = typeof topN === 'number' && topN > 0 ? Math.min(topN, MAX_STATS_TOP) : 5
  return rankTools(aggregateToolStats(events)).slice(0, n)
}

/** 把 text 按 keyword 切成 [ { text, hit } ] 分段（用于命中关键词高亮）。
 *  空关键词返回整段未命中。 */
export function highlightSegments(text, keyword) {
  const raw = String(text ?? '')
  const kw = String(keyword ?? '')
    .trim()
    .toLowerCase()
  if (kw === '') return [{ text: raw, hit: false }]
  const lower = raw.toLowerCase()
  const out = []
  let cursor = 0
  for (;;) {
    const idx = lower.indexOf(kw, cursor)
    if (idx === -1) {
      if (cursor < raw.length) out.push({ text: raw.slice(cursor), hit: false })
      break
    }
    if (idx > cursor) out.push({ text: raw.slice(cursor, idx), hit: false })
    out.push({ text: raw.slice(idx, idx + kw.length), hit: true })
    cursor = idx + kw.length
  }
  return out.length === 0 ? [{ text: raw, hit: false }] : out
}
