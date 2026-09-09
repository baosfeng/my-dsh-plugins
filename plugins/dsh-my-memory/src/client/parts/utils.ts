// ── utils: pure display helpers (summary / relative time / sort) ──────────
// 纯展示层辅助函数：不触碰服务端状态，供客户端视图使用并可被单测直接调用。
// 概要/详情两级展示为纯展示层（issue #105）：列表显示概要（首句/语义截断），
// 点击展开查看完整详情——存储保留完整 desc，展示层只做概要计算。
// 服务端同款逻辑见 lib/memory-text.js（summarizeDesc / firstSentence）。
const TRUNCATE_LEN: number = 60

/** 默认建议单条记忆长度（字符，与服务端 maxEntryLength 默认一致；面板实际
 *  值来自 GET /my-memory/api/config，取不到时回落此默认）。 */
const DEFAULT_ENTRY_LIMIT: number = 50

/** 句子边界：中英文句末标点 + 分号 + 换行（省略号吸收入前一句）。 */
const SENTENCE_BOUNDARY: RegExp = /[。！？!?；;\n….]+/u

/** 取一段文本的首句（含边界标点；连续省略号/标点并入前一句）；无边界时整段。 */
function firstSentence(text: unknown): string {
  const value = String(text ?? '')
  const match = SENTENCE_BOUNDARY.exec(value)
  if (match === null) return value
  let end = match.index + 1
  while (end < value.length && SENTENCE_BOUNDARY.test(value[end])) end += 1
  return value.slice(0, end)
}

/** 语义截断长条目（issue #105 概要/详情两级展示）：多句条目列表**总是**显示
 *  概要（首句），不截断在句子中间；单句条目仅在超长时退化为字符截断。
 *  返回 { text, truncated }——truncated 为 true 表示有可展开的详情（多句或超长）。 */
function truncateText(text: unknown, max: number = TRUNCATE_LEN): { text: string; truncated: boolean } {
  const value = String(text ?? '').trim()
  const first = firstSentence(value)
  if (first === value) {
    if (value.length <= max) return { text: value, truncated: false }
    return { text: `${value.slice(0, max)}…`, truncated: true }
  }
  if (first.length <= max) return { text: first, truncated: true }
  return { text: `${first.slice(0, max)}…`, truncated: true }
}

/** 更新时间相对化：「刚刚」「n 分钟前」「n 小时前」「n 天前」，超过 30 天回退绝对时间。 */
function relativeTime(ts: number | string): string {
  const time = Number(ts)
  if (!Number.isFinite(time)) return ''
  const diff = Date.now() - time
  if (diff < 0) return strings.updatedAt(time) // 未来时间（时钟偏移）回退绝对时间
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return strings.justNow()
  if (minutes < 60) return strings.minutesAgo(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return strings.hoursAgo(hours)
  const days = Math.floor(hours / 24)
  if (days < 30) return strings.daysAgo(days)
  return strings.updatedAt(time)
}

/** 按更新时间排序（dir: 'desc' 最新在顶 / 'asc' 最旧在顶）；返回新数组，不改原列表。 */
function sortMemories<T extends { updatedAt: number }>(items: T[], dir: 'desc' | 'asc' = 'desc'): T[] {
  const copy = items.slice()
  copy.sort((a, b) => (dir === 'asc' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt))
  return copy
}

/** 是否超过建议长度上限（保存/输入时的精简提示用）。 */
function isOverEntryLimit(text: unknown, max: number = DEFAULT_ENTRY_LIMIT): boolean {
  return String(text ?? '').length > max
}

// 导出纯函数供单测直接断言（插件只消费 apply，多余导出在 client 端无副作用）。
exports.truncateText = truncateText
exports.firstSentence = firstSentence
exports.relativeTime = relativeTime
exports.sortMemories = sortMemories
exports.isOverEntryLimit = isOverEntryLimit
exports.DEFAULT_ENTRY_LIMIT = DEFAULT_ENTRY_LIMIT
exports.TRUNCATE_LEN = TRUNCATE_LEN
