/**
 * dsh-my-context — session state shapes (pure factories).
 *
 * 会话统计状态的结构定义与工厂函数。store.js（内存态）与 persist.js
 * （持久化规整）共用，避免两者互相 import 造成循环依赖。
 */

/** 初始空状态。 */
export function createState(): { version: number; bySession: Record<string, unknown> } {
  return { version: 1, bySession: {} }
}

/** 空 usage 桶（disjoint 计数：inputTokens 不含 cacheRead）。 */
export function zeroUsage(): {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
} {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
}

/** 空构成（估算 token 分类）。 */
export function zeroComposition(): {
  system: number
  tools: number
  user: number
  inject: number
  assistant: number
  tool: number
} {
  return { system: 0, tools: 0, user: 0, inject: 0, assistant: 0, tool: 0 }
}

/** 创建会话桶（惰性初始化）。 */
export function createSession(sessionId: string): {
  sessionId: string
  model: string
  provider: string
  contextWindow: number
  usage: ReturnType<typeof zeroUsage>
  turnUsage: { turn: number } & ReturnType<typeof zeroUsage>
  composition: ReturnType<typeof zeroComposition>
  lastPromptTokens: number
  requests: unknown[]
  header: { system: string; tools: unknown[]; systemTokens: number; toolsTokens: number }
  alerts: unknown[]
  overflows: unknown[]
  updatedAt: number
} {
  return {
    sessionId,
    model: '',
    provider: '',
    contextWindow: 0,
    usage: zeroUsage(),
    turnUsage: { turn: 0, ...zeroUsage() },
    composition: zeroComposition(),
    // 最近一次请求的上下文长度（prompt = input + cacheRead + cacheWrite），
    // 溢出预警/上下文占用以此为准——历史累计 usage 含每轮重复的 cacheRead，
    // 不能作为"当前上下文占用"。
    lastPromptTokens: 0,
    requests: [],
    header: { system: '', tools: [], systemTokens: 0, toolsTokens: 0 },
    alerts: [],
    overflows: [],
    updatedAt: 0,
  }
}
