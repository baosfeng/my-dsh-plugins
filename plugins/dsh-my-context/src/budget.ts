/**
 * dsh-my-context — budget governance (pure functions).
 *
 * 预算控制：每轮（turn）/每会话（session）token 上限检查。
 *  - total = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
 *    （disjoint 计数还原为完整用量）；
 *  - perTurn / perSession 为 0 表示不限制；
 *  - 超限结果 { ok: false, scope, limit, used } 由 events.js 决定
 *    warn（记录告警）或 deny（agent/pre-step 拒绝）。
 */

/** 计算一次 usage 桶的完整 token 总量（disjoint 还原）。 */
export function usageTotal(usage: Record<string, unknown>): number {
  if (usage === null || typeof usage !== 'object') return 0
  return num(usage.inputTokens) + num(usage.outputTokens) + num(usage.cacheReadTokens) + num(usage.cacheWriteTokens)
}

/**
 * 预算检查：返回 { ok: true } 或 { ok: false, scope, limit, used }。
 * 每轮优先于每会话（先命中哪个返回哪个）。
 */
export function checkBudget(
  usage: Record<string, unknown>,
  turnUsage: Record<string, unknown>,
  options: { perTurn?: number; perSession?: number }
): { ok: true } | { ok: false; scope: 'turn' | 'session'; limit: number; used: number } {
  const perTurn = num(options?.perTurn)
  const perSession = num(options?.perSession)
  if (perTurn > 0) {
    const used = usageTotal(turnUsage)
    if (used > perTurn) return { ok: false, scope: 'turn', limit: perTurn, used }
  }
  if (perSession > 0) {
    const used = usageTotal(usage)
    if (used > perSession) return { ok: false, scope: 'session', limit: perSession, used }
  }
  return { ok: true }
}

/** 预算配置校验：非法值回退默认（0=不限制，mode 回退 warn）。 */
export function normalizeBudgetConfig(config: unknown): {
  perTurn: number
  perSession: number
  mode: 'warn' | 'deny'
} {
  const source = config !== null && typeof config === 'object' ? config as Record<string, unknown> : {}
  return {
    perTurn: limitOf(source.perTurn),
    perSession: limitOf(source.perSession),
    mode: source.mode === 'deny' ? 'deny' : 'warn',
  }
}

/** 非负整数上限（非法/负数回退 0=不限制）。 */
function limitOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}