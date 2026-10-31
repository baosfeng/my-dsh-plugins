/**
 * dsh-my-memory — API route types.
 *
 * 定义 API 路由处理器相关的类型。
 */
import type { MemoryStore, StoreInstance } from './memory-types.js'
import type { PromptStoreInstance } from './prompt-types.js'
import type { AgentMemoryRouteDeps } from './agent-memory/route.js'

export type { MemoryStore, StoreInstance }

/** DSH HTTP 请求（node:http IncomingMessage 的最小契约）。 */
export interface ServerRequest {
  url?: string
  headers: Record<string, string | string[] | undefined>
  method?: string
  [Symbol.asyncIterator](): AsyncIterator<string>
}

/** DSH HTTP 响应（node:http ServerResponse 的最小契约）。 */
export interface ServerResponse {
  writeHead(statusCode: number, headers?: Record<string, string>): void
  end(chunk?: string): void
}

/** 会话信息接口。 */
export interface SessionInfo {
  header?: {
    cwd?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** 会话服务接口。 */
export interface SessionsService {
  get(id: string): SessionInfo | undefined
}

/** 日志服务接口。 */
export interface LoggerService {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

/** API 配置接口。 */
export interface ApiConfig {
  maxEntryLength?: number
  maxDescLength?: number
}

/** 信任检查函数类型。 */
export type FenceFunction = (request: ServerRequest) => boolean

/** API 处理器参数接口。 */
export interface ApiHandlerParams {
  globalStore: StoreInstance
  getProjectStore: (cwd: string) => Promise<StoreInstance>
  /** 全局提示词 store（issue #465）：与记忆 store 并列但完全独立。 */
  promptsStore: PromptStoreInstance
  fence: FenceFunction
  sessions?: SessionsService
  config?: ApiConfig
  logger?: LoggerService
  /** agent 记忆的路由依赖（issue #502）：正文 store + 元数据 index。 */
  agentMemoryDeps: AgentMemoryRouteDeps
}

/** 路由请求参数接口。 */
export interface RouteRequestParams {
  globalStore: StoreInstance
  getProjectStore: (cwd: string) => Promise<StoreInstance>
  promptsStore: PromptStoreInstance
  sessions?: SessionsService
  config?: ApiConfig
  logger?: LoggerService
  /** agent 记忆的路由依赖（issue #502）：正文 store + 元数据 index。 */
  agentMemoryDeps: AgentMemoryRouteDeps
}

/** 写操作负载接口。 */
export interface WritePayload {
  confirmed?: boolean
  scope?: 'global' | 'project'
  cwd?: string
  action?: 'add' | 'update' | 'delete'
  id?: string
  desc?: string
  [key: string]: unknown
}

/** 写操作验证结果接口。 */
export interface WriteGateResult {
  status: number
  message: string
}

/** 应用写操作结果接口。 */
export interface ApplyWriteResult {
  status: number
  message: string
}

/** API 响应接口。 */
export interface ApiResponse {
  ok: boolean
  value?: unknown
  error?: {
    code?: string
    message: string
  }
}
