/**
 * dsh-shared — 资源阈值判定（纯函数，issue #198 第三批）。
 *
 * 口径与 skill resource-budget-review 的五维表一致：写放大/CPU/内存超限在
 * 采样数据上提前暴露，告警可查询。纯函数便于单测、便于消费方（observability
 * 等）做配置覆盖（浅合并 ResourceLimits）。
 *
 * 关键阈值（触发降级）只有磁盘两条：write-rate / file-size。CPU/内存超限只
 * 告警——正常大请求峰值会误伤落盘降级（见 {@link isCriticalOverLimit}）。
 */
import type { ResourceSample } from './resource-guard-types.js'

/** 资源阈值。 */
export interface ResourceLimits {
  /** 写入速率上限（字节/小时）。 */
  writeRateBytesPerHour: number
  /** 受监控文件大小上限（字节）。 */
  fileBytes: number
  /** 本进程 CPU 均值上限（百分比，单核折算）。 */
  cpuPercent: number
  /** 本进程 RSS 上限（字节）。 */
  memoryBytes: number
}

/** 单条告警。 */
export interface ResourceAlert {
  rule: string
  level: 'error' | 'warn'
  message: string
  value: number
  limit: number
}

/** 默认阈值（DSH 插件场景，来源 resource-budget-review 五维表）。 */
export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  /** 写入速率上限：50 MB/小时。 */
  writeRateBytesPerHour: 50 * 1024 * 1024,
  /** 受监控文件大小上限：50 MB（compact/轮转后应远小于此）。 */
  fileBytes: 50 * 1024 * 1024,
  /** 本进程 CPU 均值上限：10%（单核折算）。 */
  cpuPercent: 10,
  /** 本进程 RSS 上限：500 MB。 */
  memoryBytes: 500 * 1024 * 1024,
}

/** 默认连续确认次数（进入降级 / 退出降级共用，防抖动）。 */
export const DEFAULT_GUARD_CONFIRM_COUNT = 3

/** 采样数据 → 告警列表（顺序固定：write-rate / file-size / cpu / memory）。 */
export function evaluateResourceAlerts(
  sample: ResourceSample,
  limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS,
): ResourceAlert[] {
  const alerts: ResourceAlert[] = []
  if (typeof sample.writeRateBytesPerHour === 'number' && sample.writeRateBytesPerHour > limits.writeRateBytesPerHour) {
    alerts.push({
      rule: 'write-rate',
      level: 'error',
      message: `写入速率 ${fmtMB(sample.writeRateBytesPerHour)}/h 超过上限 ${fmtMB(limits.writeRateBytesPerHour)}/h（写放大风险）`,
      value: sample.writeRateBytesPerHour,
      limit: limits.writeRateBytesPerHour,
    })
  }
  if (typeof sample.fileBytes === 'number' && sample.fileBytes > limits.fileBytes) {
    alerts.push({
      rule: 'file-size',
      level: 'error',
      message: `文件 ${fmtMB(sample.fileBytes)} 超过上限 ${fmtMB(limits.fileBytes)}（请检查 compact/轮转）`,
      value: sample.fileBytes,
      limit: limits.fileBytes,
    })
  }
  if (typeof sample.cpuPercent === 'number' && sample.cpuPercent > limits.cpuPercent) {
    alerts.push({
      rule: 'cpu',
      level: 'warn',
      message: `本进程 CPU ${Math.round(sample.cpuPercent)}% 超过上限 ${limits.cpuPercent}%`,
      value: sample.cpuPercent,
      limit: limits.cpuPercent,
    })
  }
  if (typeof sample.memoryBytes === 'number' && sample.memoryBytes > limits.memoryBytes) {
    alerts.push({
      rule: 'memory',
      level: 'warn',
      message: `本进程内存 ${fmtMB(sample.memoryBytes)} 超过上限 ${fmtMB(limits.memoryBytes)}`,
      value: sample.memoryBytes,
      limit: limits.memoryBytes,
    })
  }
  return alerts
}

/**
 * 关键阈值判定：磁盘写放大风险主导（write-rate / file-size 任一超限即算）。
 * CPU/内存超限只告警不降级。
 */
function isCriticalOverLimit(sample: ResourceSample, limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS): boolean {
  return (
    (sample.writeRateBytesPerHour ?? 0) > limits.writeRateBytesPerHour || (sample.fileBytes ?? 0) > limits.fileBytes
  )
}

/** 降级判定（纯函数）：最近 confirmCount 个样本**全部**关键阈值超限。 */
export function shouldEnterDegrade(
  history: ResourceSample[],
  limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS,
  confirmCount: number = DEFAULT_GUARD_CONFIRM_COUNT,
): boolean {
  return everyRecent(history, confirmCount, (sample) => isCriticalOverLimit(sample, limits))
}

/** 恢复判定（纯函数）：最近 confirmCount 个样本**全部**关键阈值正常。 */
export function shouldExitDegrade(
  history: ResourceSample[],
  limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS,
  confirmCount: number = DEFAULT_GUARD_CONFIRM_COUNT,
): boolean {
  return everyRecent(history, confirmCount, (sample) => !isCriticalOverLimit(sample, limits))
}

/** 最近 confirmCount 个样本是否**全部**满足 predicate（不足 confirmCount → false，冷启动保护）。 */
function everyRecent(
  history: ResourceSample[],
  confirmCount: number,
  predicate: (sample: ResourceSample) => boolean,
): boolean {
  const recent = history.slice(-confirmCount)
  if (recent.length < confirmCount) return false
  return recent.every(predicate)
}

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
