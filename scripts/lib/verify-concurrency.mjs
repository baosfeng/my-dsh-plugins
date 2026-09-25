/**
 * 自适应并发度（issue #418）—— verify 并发池的**负载预算**。
 *
 * ## 为什么需要
 * 原实现把并发度硬编码：插件测试固定 6 路、检查项固定 4 路，且每一路 `npm test` 内部的
 * vitest 还会按 availableParallelism()-1 再开 worker。在 10 核机上「6 路 × 最多 9 worker」≈
 * 最多约 54 个 node 进程，叠加检查项池 4 路 —— 实测把 1 分钟 load 顶到 99.63（观测区间 36~99），
 * 而门禁纪律阈值是 核数×1.5 = 15。自造的负载反过来让时序敏感用例假红（#402）。
 *
 * ## 策略（issue #418 方案 A）
 *   1. 显式 `VERIFY_CONCURRENCY` / `VERIFY_CHECK_CONCURRENCY` **永远优先** —— 用户意图不被静默改写；
 *   2. 否则按核数推导 base = clamp(floor(cpus/2), 1, 上界)，上界 = 插件测试 6 / 检查项 4
 *      （6 与 4 是 #188 / #330 的实测最优值；这里只把它们从「固定值」变成「核数不允许时更低」）；
 *   3. 再叠 load 熔断（方向恒定 fail-safe：只会**降低**并发）：
 *      · load1 > cpus×1.5 → 1（串行）
 *      · load1 > cpus     → max(1, floor(base/2))
 *
 * ## fail-closed
 * 任何输入（cpus=0 / load=NaN / 负数 / 垃圾字符串）都返回 **≥1** 的整数 —— 并发降低只会
 * 「变慢」，绝不会「漏跑」。本模块绝不返回 0。
 *
 * 纯函数（无 IO、不读环境变量），故可在单测里注入 cpus/load1 覆盖全部分支，
 * 不需要制造真实高负载（见 scripts/test/verify-concurrency.test.mjs）。
 */

/** 各池的上界（#188/#330 实测最优）——自适应只会取 ≤ 它的值。 */
export const CONCURRENCY_LIMITS = {
  plugin: { base: 6, max: 8 },
  check: { base: 4, max: 8 },
}

/** 并发度下限：串行。任何情况下不得低于它（慢而不漏，绝不跳过）。 */
export const MIN_CONCURRENCY = 1

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

/** 报告里的人类可读数字：整数原样，小数保留 2 位（load 平均值的原始精度很长）。 */
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))))

/** 核数归一化：非正整数（0 / 负数 / NaN / 非数字）→ 1（最保守）。 */
export function normalizeCpus(cpus) {
  const n = Number(cpus)
  return Number.isInteger(n) && n >= 1 ? n : 1
}

/** load 归一化：非有限或非正 → 0（视为「无负载信息」，不触发熔断）。 */
export function normalizeLoad(load1) {
  const n = Number(load1)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * 显式覆盖是否有效：必须是 1..max 的整数。
 * invalid 保留原始输入，供上层打印提示 —— 非法值**不静默**回落。
 */
export function parseRequested(requested, max) {
  if (requested === undefined || requested === null || requested === '') return { ok: false }
  // 必须是**纯整数字面量**：'1.5' 会被 parseInt 截断成 1，不能算作显式覆盖（单测钉住）
  const text = String(requested).trim()
  if (!/^\d+$/.test(text)) return { ok: false, invalid: text }
  const n = Number(text)
  if (n >= MIN_CONCURRENCY && n <= max) return { ok: true, value: n }
  return { ok: false, invalid: text }
}

/**
 * 解析实际生效的并发度。
 * @param {{ requested?: string|number|null, kind?: 'plugin'|'check', cpus?: number, load1?: number }} input
 * @returns {{ value: number, mode: 'explicit'|'adaptive'|'load-half'|'load-serial', reason: string, cpus: number, load1: number, base: number, invalidRequested?: string }}
 */
export function resolveConcurrency({ requested = null, kind = 'plugin', cpus, load1 } = {}) {
  const limits = CONCURRENCY_LIMITS[kind] ?? CONCURRENCY_LIMITS.plugin
  const cores = normalizeCpus(cpus)
  const load = normalizeLoad(load1)

  const parsed = parseRequested(requested, limits.max)
  if (parsed.ok) {
    return {
      value: parsed.value,
      mode: 'explicit',
      reason: `显式覆盖 ${parsed.value}`,
      cpus: cores,
      load1: load,
      base: parsed.value,
    }
  }

  const base = clamp(Math.floor(cores / 2), MIN_CONCURRENCY, limits.base)
  const common = {
    cpus: cores,
    load1: load,
    base,
    ...(parsed.invalid === undefined ? {} : { invalidRequested: parsed.invalid }),
  }

  if (load > cores * 1.5) {
    return {
      ...common,
      value: MIN_CONCURRENCY,
      mode: 'load-serial',
      reason: `load ${fmt(load)} > 核数×1.5（${fmt(cores * 1.5)}）→ 降为串行`,
    }
  }
  if (load > cores) {
    return {
      ...common,
      value: Math.max(MIN_CONCURRENCY, Math.floor(base / 2)),
      mode: 'load-half',
      reason: `load ${fmt(load)} > 核数（${cores}）→ 并发减半`,
    }
  }
  return { ...common, value: base, mode: 'adaptive', reason: `按核数 ${cores} 推导` }
}

/** 报告用的一句话描述（可见、不静默；降级时带上原因）。 */
export function describeConcurrency(label, decision) {
  const origin =
    decision.mode === 'explicit' ? '显式覆盖' : `自适应：核数 ${decision.cpus} / load ${fmt(decision.load1)}`
  const degrade = decision.mode === 'load-serial' || decision.mode === 'load-half' ? `，${decision.reason}` : ''
  return `${label}并发 ${decision.value}（${origin}${degrade}）`
}
