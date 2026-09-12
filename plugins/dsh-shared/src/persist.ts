/**
 * dsh-shared — atomic JSON persistence（由 dsh-file-activity / dsh-my-context /
 * dsh-my-guard / dsh-my-observability 的 store/persist 原子写逻辑抽取合并，
 * issue #45）。
 *
 * ⚠️ 适用边界（quality-gates #11 / resource-budget-review，issue #198 收紧）：
 *  - 本函数是「全量快照」原语，**只适用于低频全量写**（配置 / 状态快照）；
 *  - **事件流型数据禁止用快照原语**（写放大 = 状态大小 / 事件大小，数百~数千倍，
 *    正是 #126 写放大事故的根因）——高频增量必须用 jsonlAppender（lib/jsonl.ts）；
 *  - 反例：按事件持续重写整个审计日志 / 会话明细；正例：每轮对话后写一次统计快照。
 *
 * 🛡️ 默认安全（issue #198）：**不传 options 也有护栏**——minIntervalMs 默认 1000ms
 * （节流窗口内重复写被拒）、maxBytes 默认 1MB（巨型对象被拒）。放宽必须显式：
 *  - `minIntervalMs: 0` 关闭节流（调用方显式承担节奏责任）；
 *  - `maxBytes: N` 提高字节上限（调用方证明状态自身有界）；
 *  - `force: true` 跳过**节流**（仅用于退出前冲刷 / 用户显式保存的「立即落盘」），
 *    字节上限仍然生效。
 *
 * 被拦截**绝不静默**：warn + 模块级计数（atomicWriteStats()，资源观测可读）+
 * 可选 onBlocked 回调（调用方据此重排重试，例：createWriteScheduler）。
 * 返回值：true = 已落盘；false = 被护栏拦截或写失败（调用方必须处理，不能当成功）。
 */

import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Logger } from './types.js'

/** 默认节流窗口（ms）：调用方未显式指定 minIntervalMs 时的护栏。 */
export const DEFAULT_MIN_INTERVAL_MS = 1000

/** 默认单次写字节上限：调用方未显式指定 maxBytes 时的护栏（1 MB）。 */
export const DEFAULT_MAX_BYTES = 1024 * 1024

/** 原子写选项。 */
export interface AtomicWriteOptions {
  /** 节流窗口（毫秒）：窗口内重复写入被跳过；默认 {@link DEFAULT_MIN_INTERVAL_MS}。 */
  minIntervalMs?: number
  /** 最大字节数：超过则拒绝写入；默认 {@link DEFAULT_MAX_BYTES}。 */
  maxBytes?: number
  /** 跳过**节流**（字节上限仍生效）：退出前冲刷 / 用户显式保存；默认 false。 */
  force?: boolean
  /** 被拦截回调（同步）：调用方据此重排/重试或上报指标。 */
  onBlocked?: (info: AtomicWriteBlocked) => void
}

/** 拦截信息：原因 + 文件 + 实际字节 + 生效上限。 */
export interface AtomicWriteBlocked {
  file: string
  reason: 'throttled' | 'too-large'
  bytes: number
  limit: number
}

/** 护栏累计计数（进程级，供资源观测；只增不减）。 */
export interface AtomicWriteStats {
  /** 成功落盘次数。 */
  writes: number
  /** 成功落盘字节数。 */
  bytesWritten: number
  /** 被节流窗口拦截次数。 */
  throttled: number
  /** 被字节上限拒绝次数。 */
  rejected: number
  /** 写盘失败次数（IO 错误）。 */
  failed: number
}

const stats: AtomicWriteStats = { writes: 0, bytesWritten: 0, throttled: 0, rejected: 0, failed: 0 }

/** 读取护栏累计计数快照（外部资源观测用；调用方以差值为准）。 */
export function atomicWriteStats(): AtomicWriteStats {
  return { ...stats }
}

/** 最近一次成功写盘时间（按文件）；minIntervalMs 节流窗口用。 */
const lastWriteAt = new Map<string, number>()

/** 写前护栏判定：通过返回 null，否则返回拦截原因。 */
function blockReason(
  file: string,
  bytes: number,
  options: AtomicWriteOptions,
): { reason: AtomicWriteBlocked['reason']; limit: number } | null {
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (options.force !== true && minIntervalMs > 0 && Date.now() - (lastWriteAt.get(file) ?? 0) < minIntervalMs) {
    return { reason: 'throttled', limit: minIntervalMs }
  }
  if (bytes > maxBytes) return { reason: 'too-large', limit: maxBytes }
  return null
}

/** 拦截上报：计数 + warn + onBlocked 回调（绝不静默跳过）。 */
function reportBlocked(
  file: string,
  bytes: number,
  blocked: { reason: AtomicWriteBlocked['reason']; limit: number },
  options: AtomicWriteOptions,
  logger: Logger | undefined,
  prefix: string,
): void {
  if (blocked.reason === 'throttled') {
    stats.throttled += 1
    logger?.warn(`${prefix} write throttled (minIntervalMs=${blocked.limit}): ${file}`)
  } else {
    stats.rejected += 1
    logger?.warn(`${prefix} write rejected (${bytes}B > maxBytes=${blocked.limit}): ${file}`)
  }
  options.onBlocked?.({ file, reason: blocked.reason, bytes, limit: blocked.limit })
}

/**
 * 原子写 JSON 快照（tmp+rename，自动建目录）；失败仅告警不抛出。
 * 默认护栏：1s 节流 + 1MB 字节上限（见文件头「默认安全」）。
 * 调用方负责调度节奏：推荐用 createWriteScheduler（防抖 + 最小间隔 + drain）。
 * 返回 true=已写盘；false=被护栏拦截或写失败（调用方必须处理）。
 */
export async function atomicWriteJson(
  file: string,
  value: unknown,
  logger: Logger | undefined,
  prefix: string,
  options: AtomicWriteOptions = {},
): Promise<boolean> {
  const text = JSON.stringify(value)
  const bytes = Buffer.byteLength(text, 'utf8')
  const blocked = blockReason(file, bytes, options)
  if (blocked !== null) {
    reportBlocked(file, bytes, blocked, options, logger, prefix)
    return false
  }
  const tmp = `${file}.tmp-${process.pid}`
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, file)
    lastWriteAt.set(file, Date.now())
    stats.writes += 1
    stats.bytesWritten += bytes
    return true
  } catch (error) {
    stats.failed += 1
    logger?.warn(`${prefix} persist failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
