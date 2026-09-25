/**
 * verify-timeout.mjs —— verify-local 的超时配置解析（fail-closed）。
 *
 * 为什么单独成模块：超时上限是 pre-push 的**唯一止血阀**（脚本绝不能静默挂死，见
 * verify-local.mjs 头部「超时与快速失败」）。旧实现有两个 fail-open / 静默形态：
 *   · 解析层把 \`VERIFY_STEP_TIMEOUT=0\`（以及 off/false/no/disable…）当成「关闭上限」，
 *     执行层再用 \`if (timeoutMs > 0)\` 静默不设上限 —— 非交互环境里「配置为 0」= 「无限制放行」；
 *   · 非法值（\`abc\`）静默回落默认值，把配置错误藏起来。
 * 两者都改为硬失败：AGENTS.md「写操作默认拒绝（fail-closed）」的同类形态是
 * 「非交互环境不得把『未配置 / 配置为 0』当成『无限制放行』」。
 *
 * 契约（每个分支都有单测，见 scripts/test/verify-timeout-parse.test.mjs）：
 *   未配置（undefined / null）   → { ok: true, seconds: null } —— 调用方回落默认值（默认值恒 > 0）
 *   正秒数（'300' / '45' / 0.6） → { ok: true, seconds }（四舍五入后必须 ≥ 1 秒）
 *   显式关闭关键字 none / off    → { ok: true, seconds: 0 } —— 语义清晰，必须显式写出来
 *   其它一切（0 / 负数 / 空串 / 空格 / 'abc' / 'false' / 'disable'）
 *                                → { ok: false, message } —— 调用方报错退出，绝不静默放行
 */

/** 唯一的「显式关闭」关键字。刻意不含 0 / false / no / disable —— 它们语义含糊且历史上正是 fail-open 来源。 */
export const CLOSE_KEYWORDS = ['none', 'off']

/** 执行层防线：timeoutMs 必须是非负整数毫秒（0 只允许表示「已显式关闭」，绝不允许来自 NaN / 负数）。 */
export function isValidTimeoutMs(value) {
  return Number.isInteger(value) && value >= 0
}

/**
 * 非法超时配置的统一报错文本：回显非法值 + 合法范围 + 正确的关闭方式。
 * 报错必须「可自愈」——只说不合法而不给出路，使用者会退回 0（= 重新打开 fail-open）。
 */
export function timeoutConfigError({ name, raw, closeForm = `${name}=none`, hint = '' }) {
  const shown = raw === undefined || raw === null ? '(未设置)' : JSON.stringify(String(raw))
  return (
    `[verify] ${name} 配置非法：${shown} —— 合法值是正秒数（如 30 / 120 / 900）；` +
    `确实需要「无上限」时请用显式开关 ${closeForm}，不要用 0。` +
    `把 0 / 空 / 非法值当作「关闭上限」会让 pre-push 在挂死时无人终止（fail-open）。` +
    (hint ? ` ${hint}` : '')
  )
}

/**
 * 解析「秒」配置。
 * @param {string|number|null|undefined} raw 环境变量或参数的原始值
 * @returns {{ ok: true, seconds: number|null } | { ok: false, message: string }}
 */
export function parseTimeoutSeconds(raw) {
  if (raw === undefined || raw === null) return { ok: true, seconds: null }
  const text = String(raw).trim().toLowerCase()
  if (CLOSE_KEYWORDS.includes(text)) return { ok: true, seconds: 0 }
  const value = Number(text)
  const seconds = Math.round(value)
  // 空串、NaN、负数、以及「四舍五入后变成 0」的小数（如 0.4）全部非法：
  // 任何能悄悄变成 0 的路径都是「无上限放行」，必须挡在解析层。
  if (text !== '' && Number.isFinite(value) && seconds >= 1) return { ok: true, seconds }
  return { ok: false, message: timeoutConfigError({ name: '', raw }) }
}
