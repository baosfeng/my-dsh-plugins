/**
 * 轮询工具（issue #188b）：把固定 sleep 换成「轮询可观测条件」。
 *
 * 为什么不是「缩短 sleep」：固定等待有两个坏处——① 快了一分不省（大多数用例其实
 * 50~200ms 就落定了），② 慢的时候（CI 负载高）会假失败或假通过。轮询在条件满足时
 * 立即返回，条件不满足时等到 timeout 后由原断言照常判红——**等待语义只加强不削弱**。
 *
 * store 已暴露 whenReady()（lib/store.js: store.whenReady = () => handle.readyPromise），
 * 需要「等 store 异步加载完成」的地方优先用它，比任何时间猜测都准。
 */
import { existsSync, readFileSync } from 'node:fs'

/** 轮询直到 predicate 成立；超时返回 false（由调用方断言，不静默通过）。 */
export const waitUntil = async (predicate, { timeoutMs = 8000, intervalMs = 15 } = {}) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** 文件当前行数（不存在/不可读返回 0，便于轮询里表达「还没落盘」）。 */
const fileLines = (file) => {
  try {
    if (!existsSync(file)) return 0
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line !== '').length
  } catch {
    return 0
  }
}

/** 等文件行数达到期望值（落盘/compact 的完成信号）。 */
export const waitFileLines = (file, expected, opts) => waitUntil(() => fileLines(file) === expected, opts)
