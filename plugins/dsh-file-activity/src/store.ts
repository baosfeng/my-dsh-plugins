/**
 * Store lifecycle for file activity: async state load with buffering of
 * records that arrive before it completes, incremental JSON Lines persistence
 * (append + threshold compact; issue #197) and a teardown flush. The exposed
 * store object carries a live `state` reference so route handlers always read
 * the current document.
 */
import { createState, foldRecord, loadState, mapOp, stateFile } from './state.js'
import { createPersist, readAppenderStats } from './persist.js'
import {
  defaultLimits,
  emptyEvicted,
  enforceQuota,
  normalizeLimits,
  type EvictedStats,
  type QuotaLimits,
} from './quota.js'
import { statSync } from 'node:fs'
import type {
  ActivityState,
  ActivityStore,
  DshContext,
  RecordFact,
  StoreDeps,
  StoreHandle,
  StoreStats,
} from './types.js'

/** compact 触发下限：快照成本必须远小于触发区间的事件流字节（写放大 ≤ 1.6 的关键）。 */
const MIN_COMPACT_LINES = 20000
/** compact 触发行上限（文件大小上界 ≈ 上限行字节 + 快照字节）。 */
const MAX_COMPACT_LINES = 60000
/** 事件行平均字节（保守估计；用于把快照字节折算成"应当攒多少行再 compact"）。 */
const AVG_EVENT_BYTES = 80

/**
 * 自适应 compact 行阈值：快照越大，攒的事件行越多才 compact ——
 * 目标让单次 compact 的快照成本 ≤ 触发区间事件流字节的 ~10%。
 */
function compactLinesFor(stateBytes: number): number {
  const scaled = Math.ceil((stateBytes * 12) / AVG_EVENT_BYTES)
  return Math.min(MAX_COMPACT_LINES, Math.max(MIN_COMPACT_LINES, scaled))
}

/** Build the per-apply store: { state, record, schedulePersist, stats, dispose }. */
export function createStore(ctx: DshContext, deps: StoreDeps = {}): ActivityStore {
  const limits: QuotaLimits = normalizeLimits(deps.limits)
  const store: ActivityStore = {
    state: createState(),
    record: () => false,
    schedulePersist: () => {},
    stats: () => zeroStats(limits),
    dispose: () => {},
  }
  const handle: StoreHandle = {
    ctx,
    file: stateFile(),
    store,
    pending: [],
    ready: false,
    limits,
    evicted: emptyEvicted(),
    facts: [],
    flushTimer: null,
    persist: null,
    dirtyChain: Promise.resolve(),
    compactLines: deps.compactLines ?? MIN_COMPACT_LINES,
    compactedEvents: 0,
    compactLinesFixed: deps.compactLines !== undefined,
  }
  handle.persist = createPersist(
    {
      file: handle.file,
      ctx,
      factory: deps.appender,
      flushMs: deps.flushMs,
      // 内部阈值禁用：compact 完全由本层按「快照字节 / 事件字节」预算调度。
      compactLines: Number.MAX_SAFE_INTEGER,
    },
    () => handle.store.state,
  )
  store.record = (sessionId: string, path: string, op: string, time?: number) =>
    record(handle, sessionId, path, op, time)
  store.schedulePersist = () => enqueueFlush(handle, true)
  store.stats = () => snapshotStats(handle)
  store.dispose = () => dispose(handle)
  void loadState(handle.file, limits, ctx.logger).then((loaded) => onLoaded(handle, loaded))
  return store
}

/** 空统计（加载完成前）。 */
function zeroStats(limits: QuotaLimits): StoreStats {
  return {
    bytesWritten: 0,
    writes: 0,
    persistEvents: 0,
    fileBytes: 0,
    evictedSessions: 0,
    evictedPaths: 0,
    evictedPathsTotal: 0,
    maxSessions: limits.maxSessions,
    maxPathsPerSession: limits.maxPathsPerSession,
    maxPathsTotal: limits.maxPathsTotal,
    pathCount: 0,
  }
}

/** 当前资源统计（落盘字节 + 淘汰计数 + 上限，供资源冒烟/看门狗读取）。 */
function snapshotStats(handle: StoreHandle): StoreStats {
  const persist = handle.persist
  const ioStats = persist === null ? { bytesWritten: 0, writes: 0, events: 0 } : readAppenderStats(persist.appender)
  return {
    bytesWritten: ioStats.bytesWritten,
    writes: ioStats.writes,
    persistEvents: ioStats.events,
    fileBytes: fileBytesOf(handle.file),
    evictedSessions: handle.evicted.sessions,
    evictedPaths: handle.evicted.paths,
    evictedPathsTotal: handle.evicted.pathsTotal,
    maxSessions: handle.limits.maxSessions,
    maxPathsPerSession: handle.limits.maxPathsPerSession,
    maxPathsTotal: handle.limits.maxPathsTotal,
    pathCount: countPaths(handle.store.state),
  }
}

/** 状态文件当前字节数（不存在返回 0）。 */
function fileBytesOf(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/** 全局路径总数（内存有界断言口径）。 */
function countPaths(state: ActivityState): number {
  let total = 0
  for (const session of Object.values(state.sessions)) total += Object.keys(session.counts).length
  return total
}

/** 把淘汰计数合并进 state.stats（state 是落盘真相，两者必须一致）。 */
function mergeEvicted(state: ActivityState, evicted: EvictedStats): void {
  state.stats.evicted = { sessions: evicted.sessions, paths: evicted.paths, pathsTotal: evicted.pathsTotal }
}

/**
 * State loaded: mark ready, drain buffered records, then rewrite the file in
 * the JSON Lines format when anything changed — trimmed (caps/old history) or
 * legacy (升级前的单行全量 JSON 快照). 只读不写的“纯加载”不产生任何写盘。
 */
function onLoaded(
  handle: StoreHandle,
  loaded: { state: ActivityState; trimmed: boolean; evicted: EvictedStats; legacy: boolean },
): void {
  handle.store.state = loaded.state
  handle.evicted = { ...loaded.evicted }
  mergeEvicted(handle.store.state, handle.evicted)
  handle.ready = true
  const drained = drainPending(handle)
  if (drained || loaded.trimmed || loaded.legacy) {
    flushFacts(handle)
    schedulePersist(handle)
  }
}

/** Apply every record buffered before the state load finished (deferred flush). */
function drainPending(handle: StoreHandle): boolean {
  const drained = handle.pending.splice(0)
  if (drained.length === 0) return false
  handle.ready = false
  for (const item of drained) {
    const fact = applyToState(handle, item.sessionId, mapOp(item.op), item.path, item.time)
    if (fact !== null) handle.facts.push(fact)
  }
  handle.ready = true
  return true
}

/** 记录一条操作（状态未就绪时缓冲；非法记录不入内存）。 */
function record(handle: StoreHandle, sessionId: string, path: string, op: string, time?: number): boolean {
  if (!handle.ready) {
    handle.pending.push({ sessionId, path, op, time })
    return true
  }
  const fact = applyToState(handle, sessionId, mapOp(op), path, time)
  if (fact === null) return false
  handle.facts.push(fact)
  enqueueFlush(handle, false)
  return true
}

/** 应用一条记录到内存态并执行入口配额（非法记录返回 null）。 */
function applyToState(
  handle: StoreHandle,
  sessionId: string,
  op: string,
  path: string,
  time?: number,
): RecordFact | null {
  const folded = foldRecord(handle.store.state, sessionId, path, op, time)
  if (folded === null) return null
  // 配额只在「新增条目」时可能被突破：命中已记录路径/删除不触发扫描（热路径 O(1)）。
  if (!folded.created && !folded.newPath)
    return { sessionId, path, op, time: typeof time === 'number' ? time : Date.now() }
  const before = handle.evicted
  const evicted = emptyEvicted()
  enforceQuota(handle.store.state, sessionId, handle.limits, evicted, handle.ctx.logger)
  if (evicted.sessions + evicted.paths + evicted.pathsTotal > 0) {
    handle.evicted = {
      sessions: before.sessions + evicted.sessions,
      paths: before.paths + evicted.paths,
      pathsTotal: before.pathsTotal + evicted.pathsTotal,
    }
    mergeEvicted(handle.store.state, handle.evicted)
  }
  return { sessionId, path, op, time: typeof time === 'number' ? time : Date.now() }
}

/** 防抖排空：窗口内所有事件合并成一次 appendFile（写放大 ≤ 1 + 小系数）。 */
function enqueueFlush(handle: StoreHandle, immediate: boolean): void {
  if (immediate) {
    flushFacts(handle)
    return
  }
  if (handle.flushTimer !== null) return
  handle.flushTimer = setTimeout(() => {
    handle.flushTimer = null
    flushFacts(handle)
  }, 500)
}

/** 把挂起记录以 JSON Lines 增量追加落盘（O(事件字节)）。 */
function flushFacts(handle: StoreHandle): void {
  if (handle.flushTimer !== null) {
    clearTimeout(handle.flushTimer)
    handle.flushTimer = null
  }
  const persist = handle.persist
  const facts = handle.facts.splice(0)
  if (persist === null || facts.length === 0) return
  for (const fact of facts) persist.append(fact)
  handle.dirtyChain = handle.dirtyChain.then(() => persist.flush()).catch(() => {})
  maybeCompact(handle)
}

/**
 * 预算驱动的 compact：累计追加行数达到阈值时原子快照一次（文件大小有界），
 * 阈值随快照体积自适应 —— 保证 compact 写入摊薄到足够多的事件行上。
 */
function maybeCompact(handle: StoreHandle): void {
  const persist = handle.persist
  if (persist === null) return
  const total = readAppenderStats(persist.appender).events
  if (total - handle.compactedEvents < handle.compactLines) return
  handle.compactedEvents = total
  handle.dirtyChain = handle.dirtyChain
    .then(() => persist.compact(handle.store.state))
    .then(() => {
      if (handle.compactLinesFixed) return
      handle.compactLines = compactLinesFor(Buffer.byteLength(JSON.stringify(handle.store.state)))
    })
    .catch(() => {})
}

/** 显式调度（schedulePersist：行冲刷 + 原子快照，文件大小有界）。 */
function schedulePersist(handle: StoreHandle): void {
  const persist = handle.persist
  if (persist === null) return
  flushFacts(handle)
  handle.dirtyChain = handle.dirtyChain.then(() => persist.compact(handle.store.state)).catch(() => {})
}

/** Tear down on unload: flush pending lines + compact once (memory = truth). */
function dispose(handle: StoreHandle): void {
  if (handle.flushTimer !== null) {
    clearTimeout(handle.flushTimer)
    handle.flushTimer = null
  }
  const persist = handle.persist
  if (persist === null) return
  for (const fact of handle.facts.splice(0)) persist.append(fact)
  handle.dirtyChain = handle.dirtyChain
    .then(() => persist.flush())
    .then(() => persist.dispose())
    .then(() => persist.compact(handle.store.state))
    .catch(() => {})
}
