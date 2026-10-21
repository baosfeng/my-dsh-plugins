// ── 围栏语言索引（client 半，双源互补的**主源**）：会话事件流 ────────────
// 非空代码块不带 language-*、banner 只显示 shiki 认识的语言名 —— mermaid / mmd /
// 无语言块在 DOM 里完全同形，只能靠事件流原文的哈希查表（host 半不读历史，本表读
// eventSource 全量窗口，是历史会话 + 冷启动唯一命中来源）。映射：hash(规范化代码)
// → 文档序候选（含 '' = 确证无语言）；多候选按文档序 FIFO，数量不符 → undefined。
// 流式：live-chunk text-delta 拼接后解析围栏，闭合位进 byHash、未闭合尾进 liveOpen。
// 降级：取不到 sessions / 异常 → 空表，调用方退回 DOM 契约 + host 索引。
// 依赖注入 ctx.get('sessions', false)；不读 fiber、不写官方 style / class / aria。

/** 已解析事件的上限（性能护栏：seen 集合规模）。 */
const MAX_FENCE_EVENTS = 20000
/** 单段 markdown 的扫描上限（字符）；超出不参与建表。 */
const MAX_FENCE_MARKDOWN_CHARS = 400000
/** 单块代码内容上限（字符）；超出不参与建表（下游同样会拒绝超长块）。 */
const MAX_FENCE_CODE_CHARS = 200000
/** 歧义消解时一次枚举的代码块上限（性能护栏）。 */
const MAX_ORDER_SCAN_BLOCKS = 4000
/** 围栏语言索引（模块级；按会话 + 事件源 revision 增量维护）。 */
interface FenceEntry {
  lang: string
  closed: boolean
}
/** 一条流式文本的增量状态（live-chunk text-delta 拼接；closed = 已登记的闭合哈希）。 */
interface LiveFenceState {
  text: string
  closed: Set<string>
}

interface FenceIndex {
  sessionId: string
  revision: number
  /** hash → 文档序候选（含 closed 位） */
  byHash: Map<string, FenceEntry[]>
  /** 已解析事件 seq（流式期间每批只解析新事件） */
  seen: Set<number>
  /** 流式文本（turn:step:attemptId → 拼接文本） */
  live: Map<string, LiveFenceState>
  /** 当前未闭合尾（hash → lang），用于「明确未闭合」判定 */
  liveOpen: Map<string, { hash: string; lang: string }>
  /** 已登记闭合围栏数（只增；闭合时触发重扫） */
  closedCount: number
}

function emptyFenceIndex(): FenceIndex {
  return {
    sessionId: '',
    revision: -1,
    byHash: new Map(),
    seen: new Set(),
    live: new Map(),
    liveOpen: new Map(),
    closedCount: 0,
  }
}

let fenceIndex: FenceIndex = emptyFenceIndex()

/** 重置为空表（已是空表直接返回，避免每批重分配 Map / Set）。 */
function resetFenceIndex(): void {
  if (typeof dropFenceSubscription === 'function') dropFenceSubscription()
  if (fenceIndex.revision === -1) return
  fenceIndex = emptyFenceIndex()
}
/** 规范化：CRLF → LF、去行尾空白、去尾部空行（**两端必须用同一函数**）。 */
function fenceNormalize(code: string): string {
  return String(code ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n+$/, '')
}
/** 内容哈希（长度前缀 + djb2，复用 context-markdown.ts 的 contextHash；空内容 → 空串）。 */
function fenceHash(code: string): string {
  if (typeof code !== 'string' || code === '') return ''
  return code.length.toString(36) + ':' + contextHash(code)
}
/** info string → 语言标记（首个空白分隔的 token，小写；无则空串）。 */
function fenceInfoLang(info: string): string {
  const token = String(info ?? '')
    .trim()
    .split(/\s+/)[0]
  return token === undefined ? '' : token.toLowerCase()
}
/** 保守围栏解析（闭栏 = 同字符、不短于开栏的纯围栏行）；只用于白名单语言匹配。 */
function collectFences(
  text: string,
  sink: (lang: string, code: string) => void,
  onOpen?: (lang: string, code: string) => void,
): void {
  const lines = String(text ?? '').split(/\r?\n/)
  let open: { ch: string; len: number; lang: string; line: number } | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i])
    if (m === null) continue
    if (open === null) {
      open = { ch: m[1].charAt(0), len: m[1].length, lang: fenceInfoLang(m[2]), line: i }
      continue
    }
    if (m[1].charAt(0) !== open.ch || m[1].length < open.len || m[2].trim() !== '') continue
    sink(open.lang, lines.slice(open.line + 1, i).join('\n'))
    open = null
  }
  if (open !== null && onOpen !== undefined) onOpen(open.lang, lines.slice(open.line + 1).join('\n'))
}
/** 收下一段围栏块（空内容 / 超长不计入 —— 下游同样会拒绝它们）。 */
function pushFenceEntry(index: FenceIndex, hash: string, lang: string, closed: boolean): void {
  if (hash === '') return
  const list = index.byHash.get(hash)
  if (list === undefined) index.byHash.set(hash, [{ lang: lang, closed: closed }])
  else list.push({ lang: lang, closed: closed })
  if (closed) index.closedCount += 1
}

function collectInto(index: FenceIndex, lang: string, code: string): void {
  pushFenceEntry(index, fenceHash(fenceNormalize(code)), lang, true)
}
/** 内容块数组 → 文本段（只认 string 的 text 字段；其它块类型原样跳过）。 */
function pushTexts(out: string[], content: unknown): void {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const text = (block as { text?: unknown }).text
    if (typeof text !== 'string') continue
    if (text.length > MAX_FENCE_MARKDOWN_CHARS) continue
    out.push(text)
  }
}
/** 事件里的 markdown 原文段（assistant 的 text / reasoning + user 的 text）。 */
function eventMarkdowns(event: Record<string, unknown>): string[] {
  const out: string[] = []
  const data = (event.data ?? {}) as Record<string, unknown>
  if (event.type === 'assistant/message') {
    const message = (data.message ?? {}) as Record<string, unknown>
    pushTexts(out, message.content)
  } else if (event.type === 'user/message') {
    pushTexts(out, data.content)
  }
  return out
}
/** 事件流条目 → 原始 Session 事件（非 durable 事件条目返回 null）。 */
function eventOf(entry: unknown): Record<string, unknown> | null {
  const record = entry as { type?: unknown; event?: unknown } | null
  if (record === null || record === undefined || record.type !== 'event') return null
  return record.event !== null && typeof record.event === 'object' ? (record.event as Record<string, unknown>) : null
}
/**
 * 增量吸收事件窗口：只解析**没见过 seq** 的事件（流式期间窗口每批都会被重发，
 * 全量重扫 markdown 会把 CPU 拖垮）；非 durable / 非消息事件同样记账后跳过。
 */
function absorbFences(index: FenceIndex, entries: readonly unknown[]): void {
  for (const entry of entries) {
    if (index.seen.size >= MAX_FENCE_EVENTS) return
    const event = eventOf(entry)
    if (event === null) continue
    const seq = Number(event.seq)
    if (Number.isFinite(seq)) {
      if (index.seen.has(seq)) continue
      index.seen.add(seq)
    }
    if (event.type === 'assistant/live-chunk') {
      absorbLiveChunk(index, event)
      continue
    }
    if (event.surfaceOp !== 'append') continue
    for (const markdown of eventMarkdowns(event)) {
      collectFences(markdown, (lang, code) => collectInto(index, lang, code))
    }
  }
}
/**
 * 流式增量：assistant/live-chunk 的 text-delta 是流式原文（StreamChunk，
 * packages/llm/llm/src/types.ts:472）。拼接后只在出现围栏标记时重解析一次。
 */
function absorbLiveChunk(index: FenceIndex, event: Record<string, unknown>): void {
  const data = (event.data ?? {}) as Record<string, unknown>
  const chunk = data.chunk as { type?: unknown; text?: unknown } | undefined
  if (chunk === undefined || chunk === null || chunk.type !== 'text-delta' || typeof chunk.text !== 'string') return
  if (index.live.size > 64) index.live.clear() // 会话异常增长时的护栏（正常 ≤ 每轮 1 条）
  const key = String(data.turn) + ':' + String(data.step) + ':' + String(data.attemptId)
  const prev = index.live.get(key)
  const state: LiveFenceState = prev === undefined ? { text: '', closed: new Set() } : prev
  state.text += chunk.text
  index.live.set(key, state)
  if (chunk.text.indexOf('`') >= 0 || chunk.text.indexOf('~') >= 0) registerLiveFences(index, key, state)
}
/** 解析一段流式原文的围栏：已闭合 → byHash（按哈希去重）；未闭合尾 → liveOpen。 */
function registerLiveFences(index: FenceIndex, key: string, state: LiveFenceState): void {
  let hasOpen = false
  collectFences(
    state.text,
    (lang, code) => {
      const hash = fenceHash(fenceNormalize(code))
      if (hash === '' || state.closed.has(hash)) return
      state.closed.add(hash)
      pushFenceEntry(index, hash, lang, true)
    },
    (lang, code) => {
      const hash = fenceHash(fenceNormalize(code))
      if (hash === '') return
      hasOpen = true
      index.liveOpen.set(key, { hash: hash, lang: lang })
    },
  )
  if (!hasOpen) index.liveOpen.delete(key)
}
/** 安全取属性（null / undefined / 标量 → undefined）——宿主契约缺失时只降级不抛。 */
function propOf(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
}
/** 会话列表行是否被主视图持有（与官方 dsh-client-ui-session 同一判据：retainedBy.mainView > 0）。 */
function isMainViewRow(row: unknown): boolean {
  return Number(propOf(propOf(row, 'retainedBy'), 'mainView')) > 0
}
/** 当前主视图会话 id；列表结构不符 / 没有主视图会话 → ''（调用方退回空表）。 */
function mainSessionId(sessions: Record<string, unknown>): string {
  const list = sessions.list
  if (list === undefined || typeof propOf(list, 'getSnapshot') !== 'function') return ''
  const state = (list as { getSnapshot: () => unknown }).getSnapshot()
  const byId = propOf(state, 'byId')
  if (byId === undefined || byId === null || typeof byId !== 'object') return ''
  for (const row of Object.values(byId as Record<string, unknown>)) {
    if (isMainViewRow(row)) return String(propOf(row, 'id') ?? '')
  }
  return ''
}
/** ctx.get('sessions', false)：cordis 4 免 inject 读服务；strict=false 容忍首屏未 active。 */
function sessionsService(ctx: unknown): Record<string, unknown> | null {
  if (ctx === null || typeof ctx !== 'object') return null
  const get = (ctx as { get?: unknown }).get
  if (typeof get !== 'function') return null
  try {
    const service = (get as (name: string, strict?: boolean) => unknown).call(ctx, 'sessions', false)
    return service !== null && typeof service === 'object' ? (service as Record<string, unknown>) : null
  } catch (_e) {
    return null
  }
}
/** 当前主视图会话的事件源（SessionEventSource）；任一步取不到返回 null。 */
function currentEventSource(ctx: unknown): { sessionId: string; source: Record<string, unknown> } | null {
  const sessions = sessionsService(ctx)
  if (sessions === null) return null
  try {
    const id = mainSessionId(sessions)
    if (id === '') return null
    const binding = (sessions.binding as ((sid: string) => unknown) | undefined)?.call(sessions, id)
    const source =
      binding === null || binding === undefined ? undefined : (binding as { eventSource?: unknown }).eventSource
    if (source === null || source === undefined || typeof source !== 'object') return null
    return { sessionId: id, source: source as Record<string, unknown> }
  } catch (_e) {
    return null
  }
}
/** 事件窗口快照 { sessionId, revision, entries }；取不到返回 null。 */
function fenceEventWindow(ctx: unknown): { sessionId: string; revision: number; entries: readonly unknown[] } | null {
  const current = currentEventSource(ctx)
  if (current === null) return null
  try {
    const getSnapshot = current.source.getSnapshot as (() => unknown) | undefined
    if (typeof getSnapshot !== 'function') return null
    const snapshot = getSnapshot.call(current.source) as { entries?: unknown; revision?: unknown } | null
    if (snapshot === null || snapshot === undefined || !Array.isArray(snapshot.entries)) return null
    return {
      sessionId: current.sessionId,
      revision: Number(snapshot.revision) || 0,
      entries: snapshot.entries as readonly unknown[],
    }
  } catch (_e) {
    return null
  }
}
/** 事件窗口 → 索引（只刷新，不装配订阅；订阅回调也走这里）。 */
function refreshFenceLangIndexOnly(ctx: unknown): void {
  try {
    const win = fenceEventWindow(ctx)
    if (win === null) {
      resetFenceIndex()
      return
    }
    if (win.sessionId === fenceIndex.sessionId && win.revision === fenceIndex.revision) return
    if (win.sessionId !== fenceIndex.sessionId) resetFenceIndex()
    fenceIndex.sessionId = win.sessionId
    fenceIndex.revision = win.revision
    absorbFences(fenceIndex, win.entries)
  } catch (_e) {
    resetFenceIndex()
  }
}
/** 已登记闭合围栏数（订阅回调用它判断是否有新闭合）。 */
function fenceClosedCountOf(): number {
  return fenceIndex.closedCount
}
/** 按需刷新语言表；订阅装配在 mermaid-scan（流式闭合可能没有 DOM mutation 事件）。 */
function refreshFenceLangIndex(ctx: unknown): void {
  refreshFenceLangIndexOnly(ctx)
  if (typeof ensureFenceSubscription === 'function') ensureFenceSubscription(ctx)
}
/** 块源码（官方 <pre>.textContent 的规范化形式）；空 / 超长 / 结构不符 → null。 */
function fenceBlockCode(block: Element): string | null {
  if (block === null || block === undefined || typeof block.querySelector !== 'function') return null
  const pre = block.querySelector('pre')
  const text = pre === null || pre === undefined ? '' : (pre.textContent ?? '')
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_FENCE_CODE_CHARS) return null
  return fenceNormalize(text)
}
/** 块所属的会话滚动容器（歧义消解只在同一容器内比较文档序）。 */
function fenceScopeOf(block: Element): Element | null {
  const closest = block.closest
  if (typeof closest !== 'function') return null
  const scope = closest.call(block, '[data-conversation-scroll]')
  if (scope === null || scope === undefined) return null
  return typeof scope.querySelectorAll === 'function' ? scope : null
}

/** 块在会话滚动容器内、与其内容同哈希的块中的文档序与总数；取不到返回 null。 */
function sameHashPosition(block: Element, hash: string): { index: number; count: number } | null {
  const scope = fenceScopeOf(block)
  if (scope === null) return null
  const blocks = Array.from(scope.querySelectorAll('div.md-code-block'))
  if (blocks.length > MAX_ORDER_SCAN_BLOCKS) return null
  let index = -1
  let count = 0
  for (const candidate of blocks) {
    const code = fenceBlockCode(candidate)
    if (code === null || fenceHash(code) !== hash) continue
    if (candidate === block) index = count
    count += 1
  }
  return index < 0 ? null : { index, count }
}

/** 歧义哈希：按 DOM 文档序取第 N 个候选；DOM 内同哈希块数与候选数不符 → 整块放弃。 */
function fenceLangAtDocumentOrder(block: Element, hash: string, langs: string[]): string | undefined {
  const position = sameHashPosition(block, hash)
  if (position === null || position.count !== langs.length || position.index >= langs.length) return undefined
  return langs[position.index]
}

/** 块的围栏语言（事件流哈希表）；取不到 / 有歧义 → undefined，绝不猜。 */
function fenceLangOf(block: Element): string | undefined {
  try {
    const entry = fenceIndex.byHash.size === 0 ? null : fenceBlockCode(block)
    if (entry === null) return undefined
    const hash = fenceHash(entry)
    const entries = hash === '' ? undefined : fenceIndex.byHash.get(hash)
    if (entries === undefined || entries.length === 0) return undefined
    const langs = entries.filter((item) => item.closed).map((item) => item.lang)
    if (langs.length === 0) return undefined
    const first = langs[0]
    if (langs.every((lang) => lang === first)) return first
    return fenceLangAtDocumentOrder(block, hash, langs)
  } catch (_e) {
    return undefined
  }
}

/** 围栏信任信息：语言 + 是否已闭合（流式「闭合即渲染」的唯一判据）。 */
interface FenceTrust {
  lang: string
  closed: boolean
}

/** 按源码查围栏信任：闭合 true / 未闭合尾 false / 查不到或歧义 undefined。 */
function fenceFactsOfText(source: string): FenceTrust | undefined {
  try {
    const code = fenceNormalize(source)
    const hash = code === '' ? '' : fenceHash(code)
    if (hash === '') return undefined
    const entries = fenceIndex.byHash.get(hash)
    if (entries !== undefined && entries.length > 0) {
      const first = entries[0].lang
      return entries.every((item) => item.lang === first) ? { lang: first, closed: true } : undefined
    }
    for (const open of fenceIndex.liveOpen.values()) {
      if (open.hash === hash) return { lang: open.lang, closed: false }
    }
    return undefined
  } catch (_e) {
    return undefined
  }
}

exports.MAX_FENCE_EVENTS = MAX_FENCE_EVENTS
exports.MAX_FENCE_CODE_CHARS = MAX_FENCE_CODE_CHARS
exports.fenceNormalize = fenceNormalize
exports.fenceHash = fenceHash
exports.fenceInfoLang = fenceInfoLang
exports.collectFences = collectFences
exports.refreshFenceLangIndex = refreshFenceLangIndex
exports.resetFenceIndex = resetFenceIndex
exports.fenceIndexSize = () => fenceIndex.byHash.size
exports.fenceLangOf = fenceLangOf
exports.fenceFactsOfText = fenceFactsOfText
exports.fenceClosedCountOf = fenceClosedCountOf
exports.currentEventSource = currentEventSource
exports.refreshFenceLangIndexOnly = refreshFenceLangIndexOnly
exports.registerLiveFences = registerLiveFences
exports.absorbLiveChunk = absorbLiveChunk
