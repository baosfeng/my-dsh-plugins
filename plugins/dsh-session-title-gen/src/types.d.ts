/**
 * dsh-session-title-gen — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（on / effect / logger / llm）。
 * DSH 运行时模块（cordis / llm）由宿主提供，本声明是插件与运行时
 * 之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

// ── Cordis 事件监听器 ───────────────────────────────────────────────

/** Cordis 事件监听器（DSH 事件如 session/start、agent/status）。 */
export type EventHandler = (...args: unknown[]) => void

// ── DSH server 端 Context（cordis Context 的最小契约）──────────────

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /**
   * 监听 DSH 事件；返回 disposer。
   * @param options - cordis 监听器选项；`global: true` 跳过 scope 过滤
   *   （`@deepseek-ai/dsh-scope`），是跨 scope 观察宿主事件的必要条件。
   */
  on(event: string, handler: EventHandler, options?: { global?: boolean }): () => void
  /**
   * cordis 根 Context。宿主会话事件在 root 的 events 服务上派发，而 profile
   * 插件的 ctx.events 与之隔离（issue #232：实测 `ctx.events !== ctx.root.events`），
   * 跨 scope 监听必须注册到 root。旧宿主不提供该字段时退回插件自身 ctx。
   */
  root?: DshContext
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 日志器。 */
  logger?: Logger
  /** LLM 服务（inject 声明后可用）。 */
  llm: LlmService
}

/** 最小日志器契约。 */
export interface Logger {
  warn(message: string): void
  info(message: string): void
}

// ── LLM 服务 ────────────────────────────────────────────────────────

/** LLM 流式调用选项。 */
export interface LlmStreamOptions {
  provider: string
  model: string
  messages: LlmMessage[]
  system?: string
  maxTokens?: number
  sessionId?: string
  purpose?: string
  signal?: AbortSignal
}

/** LLM 消息。 */
export interface LlmMessage {
  role: 'user' | 'assistant' | 'system'
  content: LlmContentBlock[]
}

/** LLM 内容块。 */
export interface LlmContentBlock {
  type: 'text'
  text: string
}

/** LLM 流式 chunk。 */
export interface LlmStreamChunk {
  type: 'text-delta' | 'finish' | 'reasoning-delta' | 'usage'
  index?: number
  text?: string
  reason?: {
    kind?: 'stop' | 'error' | string
    failure?: { message?: string; code?: string }
  }
}

/** LLM 服务。 */
export interface LlmService {
  stream(options: LlmStreamOptions): AsyncIterable<LlmStreamChunk>
}

// ── Session 相关类型 ────────────────────────────────────────────────

/** 会话对象（最小契约）。 */
export interface Session {
  id: string
  header?: { cwd?: string }
  /**
   * 会话事件数组。DSH 0.1.5-rc.1 起该属性已变 private，运行时为 undefined；
   * 兼容旧宿主保留为可选，读取一律走 {@link Session.snapshotEvents} 回退链
   * （见 title.ts 的 sessionEvents）。
   */
  events?: SessionEvent[]
  /**
   * 公开的事件快照读取入口（DSH 0.1.5-rc.1+），返回按 log 顺序的已提交事件。
   */
  snapshotEvents?(): readonly SessionEvent[]
  append(type: string, data: unknown): SessionEvent
  requestHeader?(): { config?: SessionRequestConfig } | undefined
}

/** 会话请求配置。 */
export interface SessionRequestConfig {
  provider?: string
  model?: string
}

/** 会话事件。 */
export interface SessionEvent {
  type: string
  seq: number
  time?: number
  data: SessionEventData
}

/** 会话事件数据（通用形状）。 */
export interface SessionEventData {
  title?: string
  messageSeqs?: number[]
  source?: {
    kind?: string
    provider?: string
    model?: unknown
  }
  content?: ContentBlock[]
}

/** 内容块。 */
export interface ContentBlock {
  type: string
  text?: string
}

// ── 用户消息事件源 ──────────────────────────────────────────────────

/** user/message 事件的 source。 */
export interface UserMessageSource {
  kind: 'user' | 'plugin' | string
  plugin?: string
}
