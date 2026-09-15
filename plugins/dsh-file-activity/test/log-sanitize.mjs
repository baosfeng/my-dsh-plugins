/**
 * e2e 日志字段净化（#314 js/log-injection 回归点）。
 *
 * 为什么不内联在 e2e-cdp.mjs 里：该脚本启动真实 Chrome、不能进 CI，注入面就
 * 没有防回归测试。把净化逻辑放这里，e2e-cdp.mjs 与 log-sanitize.test.mjs
 * 共用**同一份实现**——测试跑的就是线上那份净化，不是复制品。
 *
 * 两道处理都不做的话会怎样：e2e 打印的是 `PROBE_URL`（`process.env.PROBE_URL`）、
 * CDP/页面返回的文本、`error.message`，其中任意换行都能结束当前行并伪造一条
 * `[e2e] …` 日志，误导排查。
 */

/** 净化单个字段：折平换行/行分隔符 → 转义其余控制字符（含 `\t`）→ 引号界定一行。 */
export function sanitizeLogField(value) {
  // 第 1 步：U+2028/U+2029 在部分终端/编辑器里同样断行，一并折平。
  const flattened = String(value).replace(/[\r\n\u2028\u2029]/g, ' ')
  // 第 2 步：JSON.stringify 转义剩余控制字符；引号让正文里的 `[e2e] …` 只能待在
  // 被界定的一行内，无法自成一条日志记录（String(undefined) 已排除 undefined 分支）。
  return JSON.stringify(flattened) ?? '"[unprintable]"'
}
