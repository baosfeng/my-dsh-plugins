/**
 * release-concurrency.mjs — 发版批量/门禁并发调度（issue #246）。
 *
 * 发版原来是严格串行：N 个插件 = N × 单插件耗时（实测 3 插件 44.6s = 17.7+13.0+13.9）。
 * 本模块提供有界并发调度，把「N × 单个」压到接近 max，同时**不改变失败语义**：
 *
 *   1. 所有任务都会被执行完（一个失败不影响其余）——与 release.mjs 既有批量语义一致；
 *   2. 返回结果按**输入顺序**排列，调用方按原顺序汇总/报告，输出可复现；
 *   3. 任何任务抛错都被捕获成 `{ status: 'rejected' }`，绝不 reject 整个调度——
 *      失败判定留给调用方（fail-closed 的判定权不交给调度器）。
 *
 * 并发度默认 3：与 AGENTS.md「最多 3 个子 agent 并行」的资源口径一致；实测 3 个隔离
 * 验证实例并发墙钟 10.2s（单个 ~10.1s，几乎无劣化），3 是可解释的上界。
 */

/** 并发度上界：本机实测 8 路无额外收益且会与其它 agent 争抢资源（见 #240 基线）。 */
export const MAX_CONCURRENCY = 8
/** 默认并发度。 */
export const DEFAULT_CONCURRENCY = 3

/**
 * 解析并发度：非法/越界输入回落到默认值并夹到 [1, MAX_CONCURRENCY]。
 * 非交互环境下宁可保守（默认 3）也不放大到任务数，避免把机器打爆。
 *
 * @param {string|number|undefined} raw 命令行取值（--concurrency N）
 * @param {number} taskCount 任务总数（单任务时强制 1，避免无意义并发）
 * @param {{ fallback?: number, max?: number }} [options]
 * @returns {number} 1..max 之间的整数
 */
export function normalizeConcurrency(raw, taskCount, options = {}) {
  const fallback = options.fallback ?? DEFAULT_CONCURRENCY
  const max = options.max ?? MAX_CONCURRENCY
  const count = Number.isInteger(taskCount) && taskCount > 0 ? taskCount : 1
  if (count === 1) return 1
  // 只认纯十进制整数：'1.5.2' / '3abc' 这类垃圾输入一律回落默认值，
  // 不做 parseInt 的「取前导数字」宽容解析（那会让 --concurrency 3abc 静默变 3）。
  const text = String(raw ?? '').trim()
  const wants = /^\d+$/.test(text) ? Number.parseInt(text, 10) : 0
  const wanted = wants > 0 ? wants : fallback
  return Math.max(1, Math.min(wanted, max, count))
}

/**
 * 有界并发执行：最多 limit 个 worker 同时运行，全部跑完才 resolve。
 *
 * 不 reject：每个任务的结果是 `{ status: 'fulfilled', value }` 或
 * `{ status: 'rejected', reason }`，与 Promise.allSettled 同形且保序。
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => R | Promise<R>} worker
 * @returns {Promise<Array<{status: 'fulfilled', value: R} | {status: 'rejected', reason: unknown}>>}
 */
export async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : []
  const size = Math.max(1, Math.min(Number.isInteger(limit) && limit > 0 ? limit : 1, list.length || 1))
  const results = new Array(list.length)
  let next = 0

  const runOne = async () => {
    while (next < list.length) {
      const index = next
      next += 1
      try {
        results[index] = { status: 'fulfilled', value: await worker(list[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(size, list.length) }, runOne))
  return results
}
