/**
 * dsh-shared — 资源看门狗原语（issue #198 第三批）。
 *
 * 审计缺口：dsh-my-observability 里有一份**插件私有**的 resource-monitor +
 * resource-rules（15s 采样 CPU/RSS/受监控文件字节/写入速率 → 阈值判定 → 连续
 * 3 次超限降级停落盘 / 连续 3 次正常恢复）。任何需要「资源超限自动降级」的
 * 插件都只能把这份状态机抄一遍（docs/共享工具包/概述.md 的清单里这条一直挂着
 * 「未落地」）。本文件把它抽成可复用原语，并把 observability 改成消费方——
 * 抽出来没人用的库等于没抽。
 *
 * 三层职责：
 *  1. **采样**（宿主职责）：`collect(previous, now)` 返回本窗口指标。采样必须
 *     **廉价且同步**（statSync / process.cpuUsage 量级，15s 一次 <0.01% CPU）——
 *     采样本身放大被监控对象就违背了监控的初衷；
 *  2. **判定**（resource-rules.ts 纯函数）：`evaluateResourceAlerts` 告警、
 *     `shouldEnterDegrade` / `shouldExitDegrade` 连续确认（防抖动）；
 *  3. **状态机 + 呼叫宿主**（本文件）：连续 enterConfirmCount 次关键阈值超限 →
 *     降级（onDegrade）；连续 exitConfirmCount 次正常 → 恢复（onRecover）。
 *     降级中不重复触发；回调异常只 warn（宿主回调炸掉不能带崩看门狗）。
 *
 * ⚠️ 适用边界与反例：
 *  - 适用：**持续运行逻辑的自动降级**（持久化 / 轮询 / 后台任务）——判定是纯
 *    函数、阈值可配置、降级动作由宿主决定（L1 提高节流 / L2 停止落盘 / L3 降采样）；
 *  - 不适用：一次性操作的资源检查（直接算大小/限流即可，不需要状态机）；
 *  - 不适用：把「告警」当「降级」——只有**磁盘类关键阈值**（write-rate /
 *    file-size）触发降级；CPU/内存超限只告警（正常大请求峰值会误伤，见
 *    resource-rules.ts 的 isCriticalOverLimit）；
 *  - 降级期间宿主仍必须保证内存有界（本原语只发信号，不管内存）；
 *  - 恢复必须做一次全量快照补齐（内存=真相），否则降级窗口的数据永久缺失；
 *  - 采样源必须同步且廉价：把「递归扫目录」这类 O(n) 采样塞进 collect 会让
 *    监控自身成为热点（observability 的 $DSH_HOME 字节维度就是这样，属于已知
 *    存量代价，新接入方不要复制）。
 *
 * 五维预算（resource-budget-review）：采样 15s 一次、单次 O(1)（statSync +
 * cpuUsage）；ring buffer 固定 historySize（默认 60）条 → 内存 O(60)，不随运行
 * 时长增长；无网络、自身无磁盘写。
 */
import { statSync } from 'node:fs'
import {
  DEFAULT_GUARD_CONFIRM_COUNT,
  DEFAULT_RESOURCE_LIMITS,
  evaluateResourceAlerts,
  shouldEnterDegrade,
  shouldExitDegrade,
} from './resource-rules.js'
import type { ResourceLimits, ResourceAlert } from './resource-rules.js'
import type { ResourceSample } from './resource-guard-types.js'
import type { Logger } from './types.js'

// 一处导入即可拿到「采样 + 判定 + 状态机」：判定纯函数在 resource-rules.ts，
// 这里 re-export 方便消费方（observability 等）只依赖一个模块。
export {
  DEFAULT_RESOURCE_LIMITS,
  DEFAULT_GUARD_CONFIRM_COUNT,
  evaluateResourceAlerts,
  shouldEnterDegrade,
  shouldExitDegrade,
} from './resource-rules.js'
export type { ResourceSample } from './resource-guard-types.js'

/** 默认采样间隔（ms）。 */
export const DEFAULT_GUARD_INTERVAL_MS = 15000

/** 默认历史样本数（ring buffer 上限）。 */
export const DEFAULT_GUARD_HISTORY_SIZE = 60

/** 采样快照（采样值 + 历史 + 告警 + 降级标记）。 */
export type ResourceSnapshot<M extends ResourceSample = ResourceSample> = M & {
  history: M[]
  alerts: ResourceAlert[]
  degraded: boolean
}

/** 快照骨架（降级标记由状态机填）。 */
type SnapshotBase<M extends ResourceSample> = M & { history: M[]; alerts: ResourceAlert[] }

/** 看门狗统计（可观测性：采样/降级/恢复/告警计数）。 */
export interface ResourceGuardStats {
  samples: number
  degraded: number
  recovered: number
  alerts: number
}

/** 看门狗选项。 */
export interface ResourceGuardOptions<M extends ResourceSample = ResourceSample> {
  /** 采样源（宿主注入）：返回本窗口指标；previous 为上一窗口样本（首个为 null）。 */
  collect: (previous: M | null, now: number) => M
  /** 阈值覆盖（浅合并默认值）。 */
  limits?: Partial<ResourceLimits>
  /** 采样间隔（ms），默认 {@link DEFAULT_GUARD_INTERVAL_MS}。 */
  intervalMs?: number
  /** 历史 ring buffer 上限，默认 {@link DEFAULT_GUARD_HISTORY_SIZE}。 */
  historySize?: number
  /** 连续确认次数（进入降级），默认 {@link DEFAULT_GUARD_CONFIRM_COUNT}。 */
  enterConfirmCount?: number
  /** 连续确认次数（退出降级），默认 {@link DEFAULT_GUARD_CONFIRM_COUNT}。 */
  exitConfirmCount?: number
  /** 进入降级（宿主在此执行降级动作，如停止落盘）。 */
  onDegrade?: (snapshot: ResourceSnapshot<M>) => void
  /** 退出降级（宿主在此恢复并做一次全量快照补齐）。 */
  onRecover?: (snapshot: ResourceSnapshot<M>) => void
  /** 日志器（回调异常 warn）。 */
  logger?: Logger
  /** 日志前缀。 */
  prefix?: string
  /** 时钟注入（测试确定性；默认 Date.now）。 */
  now?: () => number
}

/** 资源看门狗句柄。 */
export interface ResourceGuard<M extends ResourceSample = ResourceSample> {
  /** 采样一次并返回快照（同步；采样源必须是廉价同步函数）。 */
  sample: () => ResourceSnapshot<M>
  /** 启动周期采样（幂等，返回定时器句柄）。 */
  start: () => ReturnType<typeof setInterval> | null
  /** 停止周期采样（幂等）。 */
  stop: () => void
  /** 当前是否处于降级。 */
  isDegraded: () => boolean
  /** 历史样本副本（ring buffer）。 */
  history: () => M[]
  /** 统计快照。 */
  stats: () => ResourceGuardStats
}

/** 采样源签名（宿主自定义采样：进程/文件/业务指标）。 */
export type ResourceSampler<M extends ResourceSample = ResourceSample> = (previous: M | null, now: number) => M

interface GuardState<M extends ResourceSample> {
  timer: ReturnType<typeof setInterval> | null
  lastSample: M | null
  history: M[]
  degraded: boolean
  stats: ResourceGuardStats
}

interface GuardDeps<M extends ResourceSample> {
  collect: (previous: M | null, now: number) => M
  limits: ResourceLimits
  intervalMs: number
  historySize: number
  enterConfirmCount: number
  exitConfirmCount: number
  onDegrade?: (snapshot: ResourceSnapshot<M>) => void
  onRecover?: (snapshot: ResourceSnapshot<M>) => void
  logger?: Logger
  prefix: string
  now: () => number
}

/** 校验正数参数（fail-fast，避免静默 0 值让看门狗失效）。 */
function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('createResourceGuard: ' + name + ' 必须为正数，got ' + String(value))
  }
}

/** 创建资源看门狗（见文件头「三层职责」与适用边界）。 */
export function createResourceGuard<M extends ResourceSample = ResourceSample>(
  options: ResourceGuardOptions<M>,
): ResourceGuard<M> {
  const intervalMs = options.intervalMs ?? DEFAULT_GUARD_INTERVAL_MS
  const historySize = options.historySize ?? DEFAULT_GUARD_HISTORY_SIZE
  const enterConfirmCount = options.enterConfirmCount ?? DEFAULT_GUARD_CONFIRM_COUNT
  const exitConfirmCount = options.exitConfirmCount ?? DEFAULT_GUARD_CONFIRM_COUNT
  assertPositive(intervalMs, 'intervalMs')
  assertPositive(historySize, 'historySize')
  assertPositive(enterConfirmCount, 'enterConfirmCount')
  assertPositive(exitConfirmCount, 'exitConfirmCount')
  if (typeof options.collect !== 'function') throw new TypeError('createResourceGuard: collect 必须为函数')
  const deps: GuardDeps<M> = {
    collect: options.collect,
    limits: { ...DEFAULT_RESOURCE_LIMITS, ...(options.limits ?? {}) },
    intervalMs,
    historySize,
    enterConfirmCount,
    exitConfirmCount,
    onDegrade: options.onDegrade,
    onRecover: options.onRecover,
    logger: options.logger,
    prefix: options.prefix ?? '[resource-guard]',
    now: options.now ?? Date.now,
  }
  const state: GuardState<M> = { timer: null, lastSample: null, history: [], degraded: false, stats: emptyStats() }
  const guard: ResourceGuard<M> = {
    sample: () => sampleOnce(state, deps),
    start: () => startSampling(state, deps, guard),
    stop: () => stopSampling(state),
    isDegraded: () => state.degraded,
    history: () => [...state.history],
    stats: () => ({ ...state.stats }),
  }
  return guard
}

/** 统计初值。 */
function emptyStats(): ResourceGuardStats {
  return { samples: 0, degraded: 0, recovered: 0, alerts: 0 }
}

/**
 * 采样一次：首个样本只作基线（无窗口数据 → 不告警、不进历史），之后入历史
 * （ring buffer 有界）→ 更新降级状态机 → 返回快照。
 */
function sampleOnce<M extends ResourceSample>(state: GuardState<M>, deps: GuardDeps<M>): ResourceSnapshot<M> {
  const at = deps.now()
  const previous = state.lastSample
  const metrics = deps.collect(previous, at)
  const sample = { ...metrics, time: metrics.time ?? at } as M
  state.stats.samples += 1
  if (previous === null) {
    state.lastSample = sample
    return { ...sample, history: [], alerts: [], degraded: state.degraded }
  }
  state.history.push(sample)
  if (state.history.length > deps.historySize) {
    state.history.splice(0, state.history.length - deps.historySize)
  }
  state.lastSample = sample
  const alerts = evaluateResourceAlerts(sample, deps.limits)
  state.stats.alerts += alerts.length
  const base = { ...sample, history: [...state.history], alerts }
  updateDegradeState(state, deps, base)
  return { ...base, degraded: state.degraded }
}

/** 降级状态机：未降级且连续超限 → 降级（回调）；已降级且连续正常 → 恢复（回调）。 */
function updateDegradeState<M extends ResourceSample>(
  state: GuardState<M>,
  deps: GuardDeps<M>,
  base: SnapshotBase<M>,
): void {
  if (!state.degraded && shouldEnterDegrade(state.history, deps.limits, deps.enterConfirmCount)) {
    state.degraded = true
    state.stats.degraded += 1
    invokeCallback(deps, 'onDegrade', deps.onDegrade, { ...base, degraded: true })
  } else if (state.degraded && shouldExitDegrade(state.history, deps.limits, deps.exitConfirmCount)) {
    state.degraded = false
    state.stats.recovered += 1
    invokeCallback(deps, 'onRecover', deps.onRecover, { ...base, degraded: false })
  }
}

/** 宿主回调异常只 warn：回调炸掉不能带崩看门狗状态机。 */
function invokeCallback<M extends ResourceSample>(
  deps: GuardDeps<M>,
  name: string,
  callback: ((snapshot: ResourceSnapshot<M>) => void) | undefined,
  snapshot: ResourceSnapshot<M>,
): void {
  if (typeof callback !== 'function') return
  try {
    callback(snapshot)
  } catch (error) {
    deps.logger?.warn(deps.prefix + ' ' + name + ' callback failed: ' + errorText(error))
  }
}

/** 启动周期采样（幂等；unref 让看门狗不阻止进程退出）。 */
function startSampling<M extends ResourceSample>(
  state: GuardState<M>,
  deps: GuardDeps<M>,
  guard: ResourceGuard<M>,
): ReturnType<typeof setInterval> | null {
  if (state.timer === null) {
    state.timer = setInterval(() => {
      guard.sample()
    }, deps.intervalMs)
    if (typeof state.timer.unref === 'function') state.timer.unref()
  }
  return state.timer
}

/** 停止周期采样（幂等）。 */
function stopSampling<M extends ResourceSample>(state: GuardState<M>): void {
  if (state.timer !== null) {
    clearInterval(state.timer)
    state.timer = null
  }
}

/**
 * 进程 + 文件采样器（observability 这类宿主的默认采样源）：
 * CPU（窗口内 user+sys 单核折算）/ RSS / 受监控文件字节 / 写入速率（字节/小时）。
 * `extra` 供宿主追加自定义维度（如 $DSH_HOME 总字节）。
 * 首个样本无窗口 → cpuPercent / writeRateBytesPerHour 记 0。
 */
export interface ProcessSamplerOptions {
  /** 受监控文件路径（缺失/不可达 → 0 字节，不抛错）。 */
  file: string
  /** 额外维度（宿主特有；抛错时忽略，不影响主维度）。 */
  extra?: (now: number) => Record<string, number>
}

/** 创建进程 + 文件采样器（见 {@link ProcessSamplerOptions}）。 */
export function createProcessSampler(options: ProcessSamplerOptions): ResourceSampler {
  let lastCpu = process.cpuUsage()
  return (previous, now) => {
    const cpu = process.cpuUsage()
    const cpuDelta = cpu.user - lastCpu.user + (cpu.system - lastCpu.system) // µs
    lastCpu = cpu
    const memoryBytes = process.memoryUsage().rss
    let fileBytes = 0
    try {
      fileBytes = statSync(options.file).size
    } catch {
      // 受监控文件尚未创建：字节为 0
    }
    let extra: Record<string, number> = {}
    try {
      extra = options.extra?.(now) ?? {}
    } catch {
      // 自定义维度不可达：忽略
    }
    if (previous === null) {
      return { time: now, cpuPercent: 0, memoryBytes, fileBytes, writeRateBytesPerHour: 0, ...extra }
    }
    const deltaMs = Math.max(now - (previous.time ?? now), 1)
    const byteDelta = fileBytes - (previous.fileBytes ?? 0)
    return {
      time: now,
      // CPU 单核折算：cpuDelta(µs) / deltaMs(ms) / 1000 → 百分比（×100）
      cpuPercent: (cpuDelta / 1000 / deltaMs) * 100,
      memoryBytes,
      fileBytes,
      writeRateBytesPerHour: byteDelta > 0 ? (byteDelta / deltaMs) * 3600 * 1000 : 0,
      ...extra,
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
