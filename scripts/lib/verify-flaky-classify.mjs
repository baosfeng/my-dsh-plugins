/**
 * 「失败是否疑似并发/负载伪影」的判定（issue #402 抽出为纯函数以便单测）。
 *
 * 背景：全量 verify 的插件测试池默认并发 6（另有检查项并发 4）。高负载下 CPU/IO 被争用，
 * 异步链的墙钟时间被拉长，而用例的等待预算若与墙钟解耦就会提前耗尽 —— 表现为纯断言失败：
 *   · dsh-my-guardian  test/host-boot-readiness.mjs：`for (200 次) await setImmediate` 忙等
 *     事件循环轮转次数，而非真实墙钟（CI run 36120528494 实证：
 *     `AssertionError: initialScan 已完成（API 已注册）`）；
 *   · dsh-my-observability test/host-resource.mjs：固定 `setTimeout 40ms` 猜「初始化已完成」，
 *     负载高时返回体里 cpuPercent 仍非 number → `AssertionError`。
 *
 * 这类失败**不含**任何 IO/超时特征词，旧正则判不出来 → 跳过串行复测 → 直接判红挡推送。
 * 故补一条：npm test 阶段的纯断言失败在并发 > 1 时同样按「疑似并发冲突」处理，
 * 走一次串行复测；复测仍失败即判真红，且复测翻转在报告里显式打印（可见、不静默）。
 */

/**
 * 多进程并发跑同一插件测试的报错特征。
 * 依据 docs/踩坑/README.md：并发跑同一插件时两个 vitest 会争用该插件的
 * coverage/ 与临时目录，表现为 coverage 写入异常 / EACCES / ENOENT / EPERM，或带
 * testTimeout 的联网用例超时（dsh-my-guard 曾出现 5013ms 误报）。
 */
export const CONCURRENCY_CONFLICT_RE =
  /coverage|EACCES|ENOENT|EPERM|ETXTBSY|EBUSY|ENOTEMPTY|EEXIST|resource busy|already in use|testTimeout|Timed out in \d+\s*ms|timed out after/i

/**
 * 纯断言失败特征（issue #402）。与 CONCURRENCY_CONFLICT_RE 不同，它**本身**不是并发证据，
 * 只在「跑测试的池 + 并发 > 1」时作为「不可信信号」触发一次串行复测。
 */
export const ASSERTION_FAILURE_RE = /AssertionError/i

/**
 * 断言失败「在并发下不可信」的阶段（方案 B'：把 #402 的判据从插件池推广到检查项池）。
 *
 *   · `npm test`      —— 插件测试池（runOnePlugin 的 stage）。
 *   · `test-scripts`  —— 检查项池里的 `npm run test:scripts`：**自身就是 vitest + coverage**，
 *     与插件测试池同源同形态（实测在并发体下出 `ENOENT coverage/...` / 时序断言假红，
 *     隔离复跑全绿），故与 npm test 同等对待。
 *
 * 刻意用**白名单**而不是「所有检查项」：typecheck / lint / format / knip / docs 这类确定性检查
 * 的断言失败与并发无关，命中即真回归 —— 给它们加复测就是把真实回归多花一次墙钟再报红。
 */
export const ASSERTION_UNTRUSTED_STAGES = new Set(['npm test', 'test-scripts'])

/**
 * 该失败是否「疑似并发冲突」。单步超时也算：被争用/负载拖慢的典型表现就是超时。
 * @param {{ timedOut?: boolean, stage?: string, out?: string, error?: string }} result
 */
export const looksLikeConcurrencyConflict = (result) => {
  if (result?.timedOut) return true
  const text = `${result?.out ?? ''}\n${result?.error ?? ''}`
  if (CONCURRENCY_CONFLICT_RE.test(text)) return true
  // issue #402：测试池里的纯断言失败在并发下不可信（等待预算与墙钟解耦）。
  // node --check / typecheck 等确定性阶段的失败不在此列 —— 语法/构建错误与并发无关，必须立即判红。
  return ASSERTION_UNTRUSTED_STAGES.has(result?.stage) && ASSERTION_FAILURE_RE.test(text)
}
