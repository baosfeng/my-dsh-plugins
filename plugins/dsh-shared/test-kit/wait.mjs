/**
 * 仓库级统一「就绪等待」工具（issue #335）—— dsh-shared/test-kit/wait.mjs
 *
 * ## 为什么要有这个文件（而不是各插件各写一份）
 *
 * 「固定 sleep 等异步」这一个根因在 CI 上**复发过 5 次**（#310 host-smoke /
 * #313 host-mutation·host-emit·host-edge / #317 / 以及 #335 的 dsh-my-context
 * host-mutation.mjs:345）。每次修法都一样：实现侧补就绪信号 + 测试侧改条件轮询。
 * 但每次都是**在出事的插件里重新实现一遍**——本次扫描发现仓库里已有 **4 份**
 * 语义不同、名字不同（`waitFor` / `waitUntil` / `waitReady`）、失败行为不同
 * （有的抛错、有的静默返回 false）的轮询工具。重复实现 = 下一个插件出问题时
 * 重新发明一次，且新写的那份大概率漏掉「超时报出等的是什么条件」。
 *
 * 所以：**新测试一律从这里 import**，不要再写第三份轮询。
 *
 * ## 判据（选哪个 API）
 *
 * | 要等的东西                                   | 用什么                            |
 * | -------------------------------------------- | --------------------------------- |
 * | 异步结果**出现**（加载完成、文件落盘、信号） | `waitFor(...)` 或实现侧 `whenReady()` |
 * | 让出事件循环（等已排队的 microtask/macrotask） | `yieldLoop()`                     |
 * | **真实时间语义**（防抖窗口本身）/ **断言某事没发生** | `sleepFor(理由, ms)`        |
 *
 * `sleepFor` 的第一参数是**必填的理由字符串**：它把「我不知道什么时候完成」这个
 * 事实写在代码里，评审时能直接看到。裸 `setTimeout(300)` 由
 * `scripts/check-test-sleeps.mjs` 在 CI 拦截（新增点必须带 `// sleep-ok: 理由`）。
 *
 * ## 为什么不是一个更长的 sleep
 *
 * 固定等待有两个坏处：快了不省（大多数用例几十毫秒就落定），慢了假失败
 * （CI 容器高负载）。`waitFor` 条件满足即返回（更快），条件不满足时**抛错并说明
 * 等的是什么条件**（更可诊断）——等待语义只加强不削弱。
 */

/** 让出事件循环：等已经排队的 microtask / 一轮 macrotask 跑完。
 *
 *  与负载无关（`setTimeout(0)` 必然晚于已排队的 microtask），**不表达任何条件**，
 *  所以只适用于「触发方是同步的、只需等折返」的场景。要等异步副作用请用 `waitFor`。 */
export function yieldLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 固定时长等待——**第一参数必须是理由**（负向断言观察窗 / 防抖窗口语义）。
 *
 *  ⚠️ 典型误用：`await sleepFor('等落盘', 200)`。落盘是**异步副作用**，该等的是
 *  「文件已包含 X」这种可观测条件（`waitFor`），不是一段时间。理由里出现
 *  「等落盘/等加载/等就绪」这类词时，请改用 `waitFor` 或实现侧的 `whenReady()`。 */
export function sleepFor(reason, ms) {
  if (typeof reason !== 'string' || reason.trim().length < 4) {
    throw new Error('sleepFor(reason, ms)：必须给出等待理由（说明为什么无法用条件轮询）')
  }
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 把 predicate 源码压成一行短描述（超时报错里告诉人"等的是什么条件"）。 */
function describe(predicate) {
  const text = String(predicate).replace(/\s+/g, ' ').trim()
  return text.length > 120 ? text.slice(0, 117) + '...' : text
}

/**
 * 轮询直到 predicate 为真，返回该真值；超时抛错（**带条件描述**，不静默过期）。
 *
 * predicate 可以为 async。默认 5s 超时（远大于任何正常落盘/加载耗时，但远小于
 * vitest 的 5s 单测超时——超时后抛出的是「等了什么、等了多久」而不是裸 timeout）。
 */
export async function waitFor(predicate, { timeout = 5000, interval = 10, message } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() >= deadline) {
      throw new Error(`waitFor 超时：${message ?? `等待条件成立：${describe(predicate)}`}（${timeout}ms 内未满足）`)
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}

/**
 * 等文件内容满足 predicate（`readFileSync` 失败 → 视为尚未就绪，继续轮询）。
 * 落盘断言的标准写法：`await waitForFile(file, (text) => text.includes('"m":1'))`。
 */
export async function waitForFile(file, predicate, options = {}) {
  const { readFileSync } = await import('node:fs')
  return waitFor(() => {
    try {
      return predicate(readFileSync(file, 'utf8'))
    } catch {
      return undefined
    }
  }, options)
}
