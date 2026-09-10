/**
 * dsh-my-observability — audit event store（内存态 + 增量持久化编排）。
 *
 * 持久化策略（修复 9/2 写放大磁盘风暴：
 * 旧实现每次防抖落盘都把全部事件 JSON.stringify 全量重写审计文件，
 * 事件流持续时每小时数 GB 写入）：
 *  - 追加式：新事件 JSON 行入队，防抖批量 append 到 `audit.jsonl`
 *    （落盘字节 ≈ 事件本体字节，O(新增) 而非 O(全量)）；
 *  - 周期 compact：追加行数达阈值时原子快照重写（文件大小有界，
 *    启动加载不回归），快照前后台事件不丢不重；
 *  - 旧格式兼容：升级前 `audit.json` 自动迁移（读取 + 快照 + 备份移除）；
 *  - 每会话 2000 / 全局 20000 上限在内存与加载规整处一致生效。
 *
 * 磁盘 I/O 与格式规整在 store-persist.js。
 */
import {
  jsonlFile,
  legacyFile,
  loadPersisted,
  writeSnapshot,
  appendLines,
  removeLegacyAfterMigration,
  normalizeLoaded,
  MAX_EVENTS_PER_SESSION,
  MAX_TOTAL_EVENTS,
  COMPACT_LINES,
} from './store-persist.js'
import type { AuditEvent, AuditState, LoadResult, PersistLogger, SessionBucket } from './store-persist.js'

const FLUSH_INTERVAL_MS = 500
const COMPACT_DEBOUNCE_MS = 300
const PREFIX = '[dsh-my-observability]'

/** 记录事件的最小输入（id/time 由 store 分配）。 */
export interface RecordInput {
  sessionId: string
  type: string
  data?: Record<string, unknown>
}

/** 会话摘要（面板下拉用）。 */
export interface SessionInfo {
  sessionId: string
  count: number
  lastTime: number
  title: string
}

/** 审计存储。 */
export interface AuditStore {
  state: AuditState
  record(event: RecordInput): AuditEvent
  events(sessionId: string | null, type?: string | null, limit?: number): AuditEvent[]
  sessions(): SessionInfo[]
  count(): number
  setPersistEnabled(enabled: boolean): void
  dispose(): Promise<void>
}

/** 存储上下文（只用 logger）。 */
export interface StoreContext {
  logger?: PersistLogger
}

/** 内部句柄（编排状态）。 */
interface StoreHandle {
  ctx: StoreContext
  file: string
  legacy: string
  store: AuditStore
  pending: AuditEvent[]
  ready: boolean
  lineQueue: string[]
  queuedLines: number
  total: number
  flushTimer: NodeJS.Timeout | null
  compactTimer: NodeJS.Timeout | null
  compacting: boolean
  migrated: boolean
  persistEnabled: boolean
  dirtyChain: Promise<void>
  seq?: number
}

/** 初始空状态。 */
function createState(): AuditState {
  return { version: 1, bySession: {} }
}

/** 创建审计存储：{ record, events, sessions, count, dispose }。
 *  record 在状态加载完成前缓冲（不丢事件）；dispose 冲刷未落盘数据。 */
export function createStore(ctx: StoreContext): AuditStore {
  const store = { state: createState() } as AuditStore
  const handle: StoreHandle = {
    ctx,
    file: jsonlFile(),
    legacy: legacyFile(),
    store,
    pending: [],
    ready: false,
    lineQueue: [],
    queuedLines: 0,
    total: 0,
    flushTimer: null,
    compactTimer: null,
    compacting: false,
    migrated: false,
    persistEnabled: true,
    dirtyChain: Promise.resolve(),
  }
  store.record = (event) => record(handle, event)
  store.events = (sessionId, type, limit) => eventsOf(handle, sessionId, type, limit)
  store.sessions = () => sessionsOf(handle)
  store.count = () => countOf(handle)
  store.setPersistEnabled = (enabled) => setPersistEnabled(handle, enabled)
  store.dispose = () => dispose(handle)
  void loadPersisted(handle.file, handle.legacy).then((result) => onLoaded(handle, result))
  return store
}

/** 追加一条审计事件（自动分配 id/时间戳）；未就绪时缓冲。 */
function record(handle: StoreHandle, event: RecordInput): AuditEvent {
  const item: AuditEvent = { id: nextId(handle), time: Date.now(), ...event }
  if (!handle.ready) {
    handle.pending.push(item)
    return item
  }
  enqueueRecord(handle, item)
  scheduleFlush(handle)
  return item
}

/** 事件入内存桶 + 排队待落盘行（回放与运行时共用，保证回放也落盘）。
 *  降级（persistEnabled=false）时事件照常入内存桶（有 FIFO 上限保护），
 *  但不排队落盘行、不触发 flush——写盘完全停止，恢复时全量快照补齐。 */
function enqueueRecord(handle: StoreHandle, item: AuditEvent): void {
  appendEvent(handle, item)
  if (!handle.persistEnabled) return
  handle.lineQueue.push(JSON.stringify(item))
  handle.queuedLines += 1
  if (handle.queuedLines >= COMPACT_LINES) scheduleCompact(handle)
}

/**
 * 落盘开关（资源看门狗降级用）：
 *  - false（降级）：停止落盘——清空待写行（内存 state 仍在，不丢），停 flush。
 *  - true（恢复）：立即 compact 全量快照（内存=真相，补齐降级窗口事件），恢复增量。
 */
function setPersistEnabled(handle: StoreHandle, enabled: boolean): void {
  if (handle.persistEnabled === enabled) return
  handle.persistEnabled = enabled
  if (handle.flushTimer !== null) {
    clearTimeout(handle.flushTimer)
    handle.flushTimer = null
  }
  handle.lineQueue = []
  handle.queuedLines = 0
  if (enabled) compactNow(handle)
}

/** 全部会话事件：合并各会话并按时间正序（sessionId='*'）。 */
function eventsAllOf(handle: StoreHandle, type?: string | null, limit?: number): AuditEvent[] {
  let all: AuditEvent[] = []
  for (const bucket of Object.values(handle.store.state.bySession)) {
    if (Array.isArray(bucket.events)) all.push(...bucket.events)
  }
  all.sort((a, b) => a.time - b.time)
  if (type !== undefined && type !== null && type !== '') {
    all = all.filter((event) => event.type === type)
  }
  const capped = typeof limit === 'number' && limit > 0 ? all.slice(-limit) : all
  return capped.map((event) => ({ ...event }))
}

/** 查询会话事件（正序时间轴；type 可选过滤；limit 限制条数）。
 *  sessionId === '*' 表示全部会话；空字符串（''）保持既有语义返回空数组。 */
function eventsOf(handle: StoreHandle, sessionId: string | null, type?: string | null, limit?: number): AuditEvent[] {
  if (sessionId === '*') return eventsAllOf(handle, type, limit)
  const bucket = handle.store.state.bySession[sessionId as string]?.events
  if (!Array.isArray(bucket)) return []
  let list = bucket
  if (type !== undefined && type !== null && type !== '') {
    list = list.filter((event) => event.type === type)
  }
  const capped = typeof limit === 'number' && limit > 0 ? list.slice(-limit) : list
  return capped.map((event) => ({ ...event }))
}

/** 有审计事件的会话列表（按最后活动时间倒序，含事件数与可读标题）。 */
function sessionsOf(handle: StoreHandle): SessionInfo[] {
  const entries = Object.entries(handle.store.state.bySession)
  const list = entries
    .map(([sessionId, bucket]) => ({
      sessionId,
      count: bucket.events.length,
      lastTime: bucket.events.length > 0 ? bucket.events[bucket.events.length - 1].time : 0,
      title: sessionTitleOf(bucket),
    }))
    .filter((entry) => entry.count > 0)
  list.sort((a, b) => b.lastTime - a.lastTime)
  return list
}

/** 会话标题：最早一条 user_message 事件的文本（无则空串，面板回退 UUID 短显）。 */
function sessionTitleOf(bucket: SessionBucket): string {
  for (const event of bucket.events) {
    const text = event.data?.text
    if (event.type === 'user_message' && typeof text === 'string' && text !== '') {
      return text
    }
  }
  return ''
}

/** 全部会话事件总数（O(1) 计数）。 */
function countOf(handle: StoreHandle): number {
  return handle.total
}

/** 事件自增 id（跨会话单调）。 */
function nextId(handle: StoreHandle): number {
  handle.seq = (handle.seq ?? 0) + 1
  return handle.seq
}

/** 追加事件到会话桶：FIFO 淘汰 + 全局上限轮转淘汰（维护 O(1) 计数）。 */
function appendEvent(handle: StoreHandle, event: AuditEvent): void {
  const state = handle.store.state
  const bucket = state.bySession[event.sessionId] ?? (state.bySession[event.sessionId] = { events: [] })
  bucket.events.push(event)
  handle.total += 1
  if (bucket.events.length > MAX_EVENTS_PER_SESSION) {
    const removed = bucket.events.splice(0, bucket.events.length - MAX_EVENTS_PER_SESSION).length
    handle.total -= removed
  }
  if (handle.total > MAX_TOTAL_EVENTS) evictOldest(handle)
}

/** 全局超限：从最早活动的会话整桶淘汰，直到回到上限内。 */
function evictOldest(handle: StoreHandle): void {
  const state = handle.store.state
  const sessions = Object.entries(state.bySession)
    .filter(([, bucket]) => bucket.events.length > 0)
    .sort((a, b) => firstTimeOf(a[1]) - firstTimeOf(b[1]))
  for (const [sessionId, bucket] of sessions) {
    if (handle.total <= MAX_TOTAL_EVENTS) break
    handle.total -= bucket.events.length
    delete state.bySession[sessionId]
  }
}

function firstTimeOf(bucket: SessionBucket): number {
  return bucket.events.length > 0 ? bucket.events[0].time : 0
}

/** 状态加载完成：合并本进程已产生的事件（防 dispose 回放被覆盖）+ 回放缓冲 + 迁移/紧凑调度。 */
function onLoaded(handle: StoreHandle, result: LoadResult): void {
  const parsed = result.state
  mergeCurrentEvents(handle.store.state, parsed)
  const normalized = normalizeLoaded(parsed.bySession)
  handle.store.state = normalized
  handle.total = countOfState(normalized)
  handle.ready = true
  const pending = handle.pending.splice(0)
  for (const item of pending) enqueueRecord(handle, item)
  if (pending.length > 0) scheduleFlush(handle)
  handle.migrated = result.migrated
  if (result.migrated || result.lines >= COMPACT_LINES) scheduleCompact(handle)
}

/** 把 load 完成前（或 dispose 回放时）已进入内存的事件合并进加载状态：后到的事件追加于桶尾。 */
function mergeCurrentEvents(current: AuditState, parsed: AuditState): void {
  for (const [sessionId, bucket] of Object.entries(current.bySession ?? {})) {
    if (!Array.isArray(bucket.events) || bucket.events.length === 0) continue
    const target = parsed.bySession[sessionId] ?? (parsed.bySession[sessionId] = { events: [] })
    target.events.push(...bucket.events)
  }
}

function countOfState(state: AuditState): number {
  let total = 0
  for (const bucket of Object.values(state.bySession ?? {})) {
    if (Array.isArray(bucket?.events)) total += bucket.events.length
  }
  return total
}

/** 防抖批量追加落盘（一次 append 全部待写行）。 */
function scheduleFlush(handle: StoreHandle): void {
  if (handle.flushTimer !== null) return
  handle.flushTimer = setTimeout(() => {
    handle.flushTimer = null
    flushNow(handle)
  }, FLUSH_INTERVAL_MS)
}

function flushNow(handle: StoreHandle): void {
  if (handle.lineQueue.length === 0 || !handle.persistEnabled) return
  const text = `${handle.lineQueue.join('\n')}\n`
  handle.lineQueue = []
  handle.dirtyChain = handle.dirtyChain.then(() => appendLines(handle.file, text, handle.ctx.logger, PREFIX))
}

/** 防抖紧凑调度（合并短时间多次触发）。 */
function scheduleCompact(handle: StoreHandle): void {
  if (handle.compactTimer !== null || handle.compacting) return
  handle.compactTimer = setTimeout(() => {
    handle.compactTimer = null
    compactNow(handle)
  }, COMPACT_DEBOUNCE_MS)
}

/** 原子快照重写 jsonl（内存 state 全量；含未 flush 行 → 排队行清空防重复）。 */
function compactNow(handle: StoreHandle): void {
  if (handle.compacting) return
  handle.compacting = true
  if (handle.flushTimer !== null) {
    clearTimeout(handle.flushTimer)
    handle.flushTimer = null
  }
  handle.lineQueue = []
  handle.queuedLines = 0
  const migrated = handle.migrated
  handle.migrated = false
  const file = handle.file
  const legacy = handle.legacy
  handle.dirtyChain = handle.dirtyChain
    .then(async () => {
      await writeSnapshot(file, handle.store.state, handle.ctx.logger, PREFIX)
      if (migrated) await removeLegacyAfterMigration(legacy)
    })
    .finally(() => {
      handle.compacting = false
    })
}

/** 卸载冲刷：清定时器 + 回放未就绪缓冲 + 立即落盘（迁移兜底）。
 *  返回落盘链 promise：调用方 await 可保证冲刷完成（卸载/退出时事件
 *  不丢）；fire-and-forget 调用亦兼容（触发后异步落盘）。 */
function dispose(handle: StoreHandle): Promise<void> {
  if (handle.flushTimer !== null) {
    clearTimeout(handle.flushTimer)
    handle.flushTimer = null
  }
  if (handle.compactTimer !== null) {
    clearTimeout(handle.compactTimer)
    handle.compactTimer = null
  }
  if (!handle.ready) {
    const pending = handle.pending.splice(0)
    for (const item of pending) enqueueRecord(handle, item)
  }
  flushNow(handle)
  if (handle.migrated || handle.queuedLines >= COMPACT_LINES) compactNow(handle)
  return handle.dirtyChain
}
