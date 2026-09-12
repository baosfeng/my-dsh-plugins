/**
 * 测试等待工具（issue #188：消除固定 sleep 造成的 20s+ 测试墙钟）。
 *
 * 两件事分开：
 *   · settle()：让出事件循环，等同步 record 之后的异步折返
 *     （lib/store.js：state 加载完成后 record 是**同步**更新内存态的，
 *     唯一异步折返是 createStore 里的 loadState().then(onLoaded)）；
 *   · waitUntil()/waitReady()/waitStateFile()：**轮询可观测条件**代替「固定等 N 毫秒」——
 *     提前满足就提前返回，条件不满足时最多等到 timeout，语义比固定 sleep 更强（不是更弱）。
 */
import { readFileSync, statSync } from 'node:fs'

export const settle = async (rounds = 3, delayMs = 1) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, delayMs))
}

/** 轮询直到 predicate 成立；超时返回 false（由调用方断言，不静默通过）。 */
export const waitUntil = async (predicate, { timeoutMs = 5000, intervalMs = 10 } = {}) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/**
 * 等 store 的异步 state 加载落定：onLoaded 必然把 store.state 换成新对象
 * （lib/store.js: handle.store.state = loaded.state），用「引用变化」当就绪信号。
 */
export const waitReady = (store, { timeoutMs = 5000 } = {}) => {
  const initial = store.state
  return waitUntil(() => store.state !== initial, { timeoutMs, intervalMs: 5 })
}

/** 状态文件当前字节数（不存在返回 -1，便于轮询里区分「还没落盘」）。 */
export const fileBytes = (file) => {
  try {
    return statSync(file).size
  } catch {
    return -1
  }
}

/** 状态文件文本（不存在返回 ''）。 */
export const fileText = (file) => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** 等状态文件出现且非空（append 落盘的完成信号）。 */
export const waitStateFile = (file, { timeoutMs = 5000 } = {}) => waitUntil(() => fileBytes(file) > 0, { timeoutMs })

/** 等状态文件里出现某个标记（如 compact 快照元信息行 '"m":1'）。 */
export const waitFileContains = (file, needle, { timeoutMs = 5000 } = {}) =>
  waitUntil(() => fileText(file).includes(needle), { timeoutMs })
