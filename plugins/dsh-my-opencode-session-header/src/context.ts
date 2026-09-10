/**
 * dsh-my-opencode-session-header — 会话上下文（AsyncLocalStorage）与流包装。
 *
 * pi-ai 的 Models.streamSimple() 是惰性的：真正发 HTTP 发生在消费（迭代）
 * 流时。因此包装 generator 的**每次** next()/return() 都必须在
 * `sessionContext.run(store, ...)` 内执行，否则 fetch 侧读不到会话上下文。
 *
 * 注意：handler 本身必须是同步函数（返回流对象），async handler 会把
 * waterfall 返回值变成 Promise，破坏下游 `yield*` 委托（见踩坑
 * docs/踩坑/llm流async处理器误用.md）。
 */
import { AsyncLocalStorage } from 'node:async_hooks'

/** 一次推理请求的会话上下文。 */
export interface SessionStore {
  /** llm/stream options.provider（路由判定的 provider 白名单）。 */
  provider: string
  /** 已按 valueMode 计算好的会话头值（确定性）。 */
  value: string
}

/** 请求期会话上下文存储（模块级单例：插件实例共用无害）。 */
export const sessionContext = new AsyncLocalStorage<SessionStore>()

/** 异步迭代器最小契约。 */
interface AsyncIteratorLike {
  next(): Promise<IteratorResult<unknown>>
  return?(value?: unknown): Promise<IteratorResult<unknown>>
}

/**
 * 用会话上下文包装推理流；非异步可迭代对象原样返回（绝不破坏调用方）。
 */
export function wrapStreamWithContext(store: SessionStore, stream: unknown): unknown {
  const iterator = iteratorOf(stream)
  if (iterator === undefined) return stream
  return iterateWithContext(store, iterator)
}

/** 取异步迭代器（失败返回 undefined，由调用方原样透传）。 */
function iteratorOf(stream: unknown): AsyncIteratorLike | undefined {
  if (stream === null || typeof stream !== 'object') return undefined
  const factory = (stream as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator]
  if (typeof factory !== 'function') return undefined
  try {
    return factory.call(stream) as AsyncIteratorLike
  } catch {
    return undefined
  }
}

/** 逐 chunk 透传；每次 next()/return() 都在会话上下文内执行。 */
async function* iterateWithContext(store: SessionStore, iterator: AsyncIteratorLike): AsyncGenerator<unknown> {
  try {
    for (;;) {
      const result = await sessionContext.run(store, () => iterator.next())
      if (result.done === true) return result.value
      yield result.value
    }
  } finally {
    // 消费方 early break（return()）或异常时，关闭内层流，避免流泄漏。
    await closeInner(store, iterator)
  }
}

/** 关闭内层迭代器（失败静默：关闭错误不得影响消费方）。 */
async function closeInner(store: SessionStore, iterator: AsyncIteratorLike): Promise<void> {
  try {
    if (typeof iterator.return === 'function') await sessionContext.run(store, () => iterator.return?.(undefined))
  } catch {
    /* 内层流已终止或拒绝关闭：忽略 */
  }
}
