/**
 * dsh-shared — async / message helpers（由 dsh-task-reliability / dsh-my-observability
 * 的 util.js、ai.js 抽取合并，issue #45）。
 */

/** 超时包装：ms 内未 settle 则 resolve undefined（不 reject）。 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms)
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(undefined)
      },
    )
  })
}

/** 用户消息结构（agent.steer / followup 用）。 */
export interface UserMessage {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'user' }
}

/** 构造 user 角色消息（agent.steer / followup 用）。 */
export function userMessage(text: string): UserMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}
