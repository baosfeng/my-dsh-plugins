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
  /** 监听 DSH 事件；返回 disposer。 */
  on(event: string, handler: EventHandler): () => void
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
  events: SessionEvent[]
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
