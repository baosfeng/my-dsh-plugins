/**
 * dsh-file-activity — JSON Lines 增量持久化（issue #197 写放大整改）。
 *
 * 为什么是增量 append（方案 A）而不是「节流后的全量快照」：本插件状态是
 * 累积字典，旧实现每次防抖落盘都 JSON.stringify 整个状态（审计实测单次
 * 1,396,407 B / 写放大 3,665×）。一次记录的信息量恰好等于状态增量（一条
 * 事件 = 一次 fold），所以增量落盘字节 ≈ 事件本体字节。
 *
 * 数据不丢的论证：
 *  - 事件行 `{s,p,o,t}` 携带重放所需的全部信息（会话 / 路径 / 操作 / 时间）；
 *    冷启动按行序重放 = 运行时状态的精确重现（delete 行同样可重放）；
 *  - 行阈值触发 compact：用**当前内存态**生成快照行（元信息行 + 每会话一行
 *    `{s,d}` + 结束行）并原子重写（tmp+rename），文件大小有界、启动不回归；
 *  - 崩溃安全：append 是 O(新增) 的，最坏丢最后一个防抖窗口（≤ flushMs）；
 *    compact 由 rename 保证原子（旧文件或新文件，不会半截）。
 *
 * 护栏（显式，不再裸奔）：
 *  - `minIntervalMs`：快照超过阈值体积后生效的最小写间隔（分级节流）；
 *  - `maxBytes`：快照字节硬上限（超限拒绝写 + warn，不静默）；
 *  - `compactLines`：追加行阈值（按状态体积自适应，文件大小因此有界）。
 */
import { jsonlAppender } from 'dsh-shared'
import { LOG_PREFIX } from './quota.js'
import type { ActivityState, AppenderFactory, AppenderHandle, DshContext, Logger, PersistHandle } from './types.js'

/** 追加落盘的防抖窗口（高频突发合并成一次 append）。 */
const FLUSH_MS = 500
/** 追加行数阈值（默认；createStore 按状态体积自适应上调）。 */
const COMPACT_LINES = 3000
/** compact 快照字节硬上限（状态上界 ~2MB；超限拒绝写并告警）。 */
const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024
/** 快照超过该体积后才启用最小写间隔（小快照高频重写成本可忽略）。 */
const SNAPSHOT_THROTTLE_MIN_BYTES = 64 * 1024
/** 快照最小写间隔：体积每翻倍 +1s（大快照低频重写，写放大有界）。 */
const SNAPSHOT_MIN_INTERVAL_MS = 1000

/** 一条记录 → 事件行（键序固定 s/p/o/t：落盘字节 = 事件本体字节）。 */
function eventLine(record: { sessionId: string; path: string; op: string; time: number }): string {
  return JSON.stringify({ s: record.sessionId, p: record.path, o: record.op, t: record.time })
}

/** compact 快照行组：元信息行（含统计）+ 每会话一行 + 结束行（结束行让尾部事件区显式开始）。 */
function snapshotLines(state: ActivityState): string[] {
  const lines = [JSON.stringify({ m: 1, v: state.version, t: Date.now(), stats: state.stats })]
  for (const [sessionId, session] of Object.entries(state.sessions)) {
    lines.push(JSON.stringify({ s: sessionId, d: session }))
  }
  lines.push('=')
  return lines
}

/** createPersist 选项。 */
export interface PersistOptions {
  file: string
  ctx: DshContext
  /** appender 工厂（默认 dsh-shared 的 jsonlAppender；测试注入以精确测字节）。 */
  factory?: AppenderFactory
  flushMs?: number
  compactLines?: number
  snapshotMinIntervalMs?: number
  snapshotMaxBytes?: number
}

/**
 * 建立持久化编排：append 走 jsonl 增量；达行阈值时 appender 调 onCompact，
 * 宿主用**实时 state**（stateOf 回调）生成快照行并原子重写。
 */
export function createPersist(options: PersistOptions, stateOf: () => ActivityState): PersistHandle {
  const logger: Logger | undefined = options.ctx.logger
  const guard = {
    file: options.file,
    minIntervalMs: options.snapshotMinIntervalMs ?? SNAPSHOT_MIN_INTERVAL_MS,
    maxBytes: options.snapshotMaxBytes ?? SNAPSHOT_MAX_BYTES,
    logger,
  }
  let handle: AppenderHandle
  handle = (options.factory ?? defaultAppender)(options.file, {
    flushMs: options.flushMs ?? FLUSH_MS,
    compactLines: options.compactLines ?? COMPACT_LINES,
    logger,
    prefix: LOG_PREFIX,
    onCompact: () => writeSnapshot(handle, stateOf(), guard),
  })
  return {
    file: options.file,
    appender: handle,
    append: (record) => handle.append(JSON.parse(eventLine(record)) as unknown),
    compact: (state) => writeSnapshot(handle, state, guard),
    flush: () => handle.flush(),
    dispose: () => handle.dispose(),
  }
}

/** 快照护栏参数 + 目标文件。 */
interface SnapshotGuard {
  file: string
  minIntervalMs: number
  maxBytes: number
  logger?: Logger
}

/** 文件最近一次成功快照时间（节流窗口用）。 */
const lastSnapshotAt = new Map<string, number>()

/** 分级节流：小快照不受最小间隔约束（否则 compact 会被自己节流掉）。 */
function throttleFor(file: string, bytes: number, guard: SnapshotGuard): number {
  if (bytes <= SNAPSHOT_THROTTLE_MIN_BYTES) return 0
  const factor = Math.max(1, Math.ceil(Math.log2(bytes / SNAPSHOT_THROTTLE_MIN_BYTES)))
  return guard.minIntervalMs * factor
}

/** 护栏判定：被拦时 warn 并返回 true（调用方跳过写盘，不静默）。 */
function guarded(guard: SnapshotGuard, bytes: number, now: number): boolean {
  if (bytes > guard.maxBytes) {
    guard.logger?.warn(
      LOG_PREFIX + ' compact rejected (' + bytes + 'B > maxBytes=' + guard.maxBytes + '): ' + guard.file,
    )
    return true
  }
  const window = throttleFor(guard.file, bytes, guard)
  if (window > 0 && now - (lastSnapshotAt.get(guard.file) ?? 0) < window) {
    guard.logger?.warn(LOG_PREFIX + ' compact throttled (minIntervalMs=' + window + '): ' + guard.file)
    return true
  }
  return false
}

/**
 * 原子 compact 快照：走 dsh-shared jsonlAppender 的 snapshot（tmp+rename 原子
 * 重写 + 清挂起队列 + 计入 stats）；护栏由本层显式判定，拦截/失败均返回 false
 * 并告警（不静默）。
 */
async function writeSnapshot(handle: AppenderHandle, state: ActivityState, guard: SnapshotGuard): Promise<boolean> {
  const lines = snapshotLines(state)
  const bytes = Buffer.byteLength(lines.join('\n') + '\n', 'utf8')
  if (guarded(guard, bytes, Date.now())) return false
  lastSnapshotAt.set(guard.file, Date.now())
  try {
    await handle.snapshot(lines)
    return true
  } catch (error) {
    guard.logger?.warn(LOG_PREFIX + ' compact failed: ' + (error instanceof Error ? error.message : String(error)))
    return false
  }
}

/** appender 统计（缺接口/字段名差异时回退 0，绝不产生 NaN —— NaN 会让预算判断失效）。 */
export function readAppenderStats(appender: AppenderHandle): { bytesWritten: number; writes: number; events: number } {
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  try {
    const stats = appender.stats() as { bytesWritten?: unknown; writes?: unknown; total?: unknown; events?: unknown }
    // dsh-shared jsonlAppender 暴露 total（累计追加行数），兼容 events 命名。
    return {
      bytesWritten: num(stats.bytesWritten),
      writes: num(stats.writes),
      events: num(stats.total ?? stats.events),
    }
  } catch {
    return { bytesWritten: 0, writes: 0, events: 0 }
  }
}

/** 默认 appender：dsh-shared 的 jsonlAppender（增量 append + 防抖 + compact 回调）。 */
function defaultAppender(
  file: string,
  options: {
    flushMs: number
    compactLines: number
    logger?: Logger
    prefix: string
    onCompact: () => Promise<unknown> | unknown
  },
): AppenderHandle {
  return jsonlAppender(file, options) as unknown as AppenderHandle
}
