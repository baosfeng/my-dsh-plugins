/**
 * dsh-my-opencode-session-header — DSH 运行时类型声明（server 端，手写最小契约）。
 *
 * 插件只消费 ctx 的 on / effect / logger 与 llm/stream waterfall 参数；
 * DSH 运行时（cordis Context）由宿主提供，本文件是插件与运行时之间的契约。
 * 本文件为 .d.ts（纯类型，无产物）；源码经 `import type ... from './types.js'` 引用。
 */

/** 日志器（插件只用 warn / info）。 */
export interface Logger {
  info?(message: string): void
  warn(message: string): void
}

/** 事件监听器（waterfall 事件末参为 next）。 */
export type EventListener = (...args: any[]) => unknown

/** DSH server 端 Context 最小契约。 */
export interface DshContext {
  logger: Logger
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 注册事件监听（返回 disposer）。 */
  on(event: string, listener: EventListener): () => void
}
