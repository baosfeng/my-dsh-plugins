/**
 * dsh-my-memory — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（on / effect / get / webServer）。
 * DSH 运行时模块（cordis / webServer）由宿主提供，本声明是插件与运行时
 * 之间的类型契约——新 TS 插件照抄本文件，按需扩展。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** Cordis 事件监听器（DSH 事件如 session/start、agent/status）。 */
export type EventHandler = (...args: unknown[]) => void

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** 监听 DSH 事件；返回 disposer。 */
  on(event: string, handler: EventHandler): () => void
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 读取可选服务（未加载返回 undefined）。 */
  get<T>(name: string): T | undefined
  /** webServer 服务（inject 声明后可用）。 */
  webServer?: WebServerService
  /** webRuntime 服务（信任主机列表）。 */
  webRuntime?: WebRuntimeService
  /** sessions 服务（会话管理）。 */
  sessions?: SessionsService
  /** systemPrompt 服务（系统提示词管理）。 */
  systemPrompt?: SystemPromptService
  /** tools 服务（工具管理）。 */
  tools?: ToolsService
  /** logger 服务（日志）。 */
  logger?: LoggerService
}

/** webServer 服务（HTTP 路由注册）。 */
export interface WebServerService {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void
  }): () => void
}

/** webRuntime 服务（信任主机列表）。 */
export interface WebRuntimeService {
  trustedHosts: string[]
}

/** sessions 服务（会话管理）。 */
export interface SessionsService {
  get(id: string): unknown
}

/** systemPrompt 服务（系统提示词管理）。 */
export interface SystemPromptService {
  /** 添加系统提示词片段；返回 disposer。 */
  add(content: string, priority?: number): () => void
}

/** tools 服务（工具管理）。 */
export interface ToolsService {
  /** 注册工具；返回 disposer。 */
  register(options: {
    name: string
    description: string
    parameters?: unknown
    execute: (params: unknown) => Promise<unknown>
  }): () => void
  /** 注册工具执行前钩子。 */
  on(event: 'tools/pre-execute', handler: (params: unknown) => unknown): () => void
}

/** logger 服务（日志）。 */
export interface LoggerService {
  warn(msg: string): void
  info(msg: string): void
  error(msg: string): void
}

/** DSH HTTP 请求（node:http IncomingMessage 的最小契约）。 */
export interface ServerRequest {
  url?: string
  headers: Record<string, string | string[] | undefined>
  method?: string
}

/** DSH HTTP 响应（node:http ServerResponse 的最小契约）。 */
export interface ServerResponse {
  writeHead(statusCode: number, headers?: Record<string, string>): void
  end(chunk?: string): void
}

/** 记忆条目结构。 */
export interface MemoryEntry {
  id: string
  content: string
  category?: string
  source?: string
  confidence?: number
  updatedAt?: string
  relatedIds?: string[]
  history?: Array<{
    content: string
    updatedAt: string
    category?: string
  }>
  status?: 'active' | 'archived' | 'pending'
}

/** 候选记忆条目结构。 */
export interface CandidateMemoryEntry {
  id: string
  content: string
  source: string
  sessionId: string
  createdAt: string
  status: 'pending' | 'confirmed' | 'dismissed'
}

/** 记忆存储结构。 */
export interface MemoryStore {
  entries: MemoryEntry[]
  version: number
  lastUpdated: string
}

/** 候选记忆存储结构。 */
export interface CandidateStore {
  candidates: CandidateMemoryEntry[]
  version: number
  lastUpdated: string
}