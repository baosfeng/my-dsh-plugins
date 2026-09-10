/**
 * dsh-my-opencode-session-header — 会话头取值。
 *
 * 确定性是硬要求：同一会话（同一 sessionId）在跨轮次 / 压缩 / 重试 / 重启
 * 之后必须得到同一个值，不同会话得到不同值——纯函数实现，无状态、无随机。
 */
import type { ValueMode } from './config.js'

/** 裸 UUID（大小写不敏感）。 */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * 计算会话头取值。
 * @param sessionId - llm/stream options.sessionId（会话稳定 id）。
 * @param mode - uuid（提取裸 UUID，无则回退原串）或 raw（原始会话 id）。
 */
export function sessionValueOf(sessionId: string, mode: ValueMode): string {
  if (mode === 'raw') return sessionId
  const match = UUID_PATTERN.exec(sessionId)
  return match === null ? sessionId : match[0]
}
