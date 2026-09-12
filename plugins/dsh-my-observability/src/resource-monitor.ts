/**
 * dsh-my-observability — 资源采样监控 + 降级看门狗（**dsh-shared 原语的消费方**）。
 *
 * 第三批（issue #198）：本文件原本是插件私有的看门狗实现（采样 → 阈值判定 →
 * 连续确认降级/恢复），现已改为 `dsh-shared` 的 `createResourceGuard` 消费方——
 * 抽出来的原语必须有人真的用，否则等于没抽。
 *
 * 保留的插件职责（宿主特有，不进 shared）：
 *  - **采样源**：`createProcessSampler`（CPU/RSS/审计文件字节/写入速率）
 *    + `$DSH_HOME` 目录总字节这个插件特有维度；
 *  - **降级动作**：由 index.ts 的 onDegrade/onRecover 决定（停落盘 / 恢复 + 全量快照）。
 *
 * 行为等价（改造前后逐条对齐，见 test/host-resource-guard.mjs）：
 *  - 采样间隔默认 15s；历史 ring buffer 60 样本；
 *  - 首个样本无窗口 → 不告警、不进历史，仅作后续窗口的 prev；
 *  - 关键阈值只有 write-rate / file-size；CPU/内存超限只告警不降级；
 *  - 连续 3 次超限 → 降级；连续 3 次正常 → 恢复；降级中不重复触发回调。
 *
 * 资源开销：采样 15s 一次、<0.01% CPU；history 固定 60 条（不随运行时长增长）。
 * 已知存量代价：`homeBytes` 维度每次采样递归扫 $DSH_HOME（O(文件数)），
 * 新接入方不要复制这个维度（见 shared README 的采样边界）。
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createProcessSampler, createResourceGuard } from 'dsh-shared'
import type {
  Logger,
  ResourceGuard,
  ResourceGuardStats,
  ResourceSample,
  ResourceSampler,
  ResourceSnapshot as GuardSnapshot,
} from 'dsh-shared'
import { jsonlFile } from './store-persist.js'

const DEFAULT_INTERVAL_MS = 15000

/** 监控器选项（`collect`/`now` 先于实现存在，供确定性测试注入）。 */
export interface ResourceMonitorOptions {
  intervalMs?: number
  limits?: Record<string, number>
  onDegrade?: (snapshot: ResourceSnapshot) => void
  onRecover?: (snapshot: ResourceSnapshot) => void
  /** 采样源覆盖（默认进程 + 审计文件 + $DSH_HOME 字节）。 */
  collect?: ResourceSampler
  /** 时钟覆盖（测试确定性）。 */
  now?: () => number
  /** 历史样本上限（默认 60）。 */
  historySize?: number
  /** 进入降级的连续确认次数（默认 3）。 */
  enterConfirmCount?: number
  /** 退出降级的连续确认次数（默认 3）。 */
  exitConfirmCount?: number
}

/** 一次采样快照（采样值 + 历史 + 告警 + 降级标记）。 */
export type ResourceSnapshot = GuardSnapshot<ResourceSample>

/** 监控器句柄。 */
export interface ResourceMonitor {
  sample(): ResourceSnapshot
  start(): NodeJS.Timeout | null
  stop(): void
  isDegraded(): boolean
  /** 历史样本副本（ring buffer）。 */
  history(): ResourceSample[]
  /** 看门狗统计（采样/降级/恢复/告警计数）。 */
  stats(): ResourceGuardStats
  /** 底层原语句柄（诊断/测试用）。 */
  guard(): ResourceGuard<ResourceSample>
}

/** 日志器最小契约（回调异常 warn 用）。 */
interface MonitorCtx {
  logger?: { warn?: (message: string) => void }
}

/** 创建资源监控器：{ sample, start, stop, isDegraded }（薄适配 dsh-shared 看门狗）。 */
export function createResourceMonitor(ctx: unknown, options: ResourceMonitorOptions = {}): ResourceMonitor {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const collect = options.collect ?? defaultSampler(home)
  // 配置容错保持与改造前一致：非法 intervalMs 回退默认（而不是 fail-fast 让插件起不来）
  const intervalMs =
    Number.isFinite(options.intervalMs) && (options.intervalMs as number) > 0
      ? (options.intervalMs as number)
      : DEFAULT_INTERVAL_MS
  const guard = createResourceGuard<ResourceSample>({
    collect,
    limits: options.limits,
    intervalMs,
    historySize: options.historySize,
    enterConfirmCount: options.enterConfirmCount,
    exitConfirmCount: options.exitConfirmCount,
    now: options.now,
    onDegrade: (snapshot) => options.onDegrade?.(snapshot),
    onRecover: (snapshot) => options.onRecover?.(snapshot),
    logger: ctxLogger(ctx),
    prefix: '[dsh-my-observability]',
  })
  return {
    sample: () => guard.sample(),
    start: () => guard.start(),
    stop: () => guard.stop(),
    isDegraded: () => guard.isDegraded(),
    history: () => guard.history(),
    stats: () => guard.stats(),
    guard: () => guard,
  }
}

/** 取宿主的 logger（回调异常 warn 用）；不可用则返回 undefined（看门狗不因此失效）。 */
function ctxLogger(ctx: unknown): Logger | undefined {
  const logger = (ctx as MonitorCtx | null)?.logger
  if (typeof logger?.warn !== 'function') return undefined
  return { warn: (message: string) => logger.warn?.(message) }
}

/** 默认采样源：进程维度 + 审计文件字节/写入速率 + $DSH_HOME 总字节。 */
function defaultSampler(home: string): ResourceSampler {
  return createProcessSampler({
    file: jsonlFile(),
    extra: () => ({ homeBytes: dshHomeSize(home) }),
  })
}

/** 递归计算目录总字节（best-effort，跳过不可达文件）。 */
function dshHomeSize(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        total += dshHomeSize(full)
      } else if (entry.isFile()) {
        try {
          total += statSync(full).size
        } catch {
          // 文件不可达
        }
      }
    }
  } catch {
    // 目录不可达
  }
  return total
}
