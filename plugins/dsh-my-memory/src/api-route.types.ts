/**
 * dsh-my-memory — API route types.
 *
 * 定义 API 路由处理器相关的类型。
 */
import type { MemoryStore, StoreInstance, CandidateStoreInstance } from './memory-types.js'

export type { MemoryStore, StoreInstance, CandidateStoreInstance }

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
  candidatesStore: CandidateStoreInstance | null | undefined
  fence: FenceFunction
  sessions?: SessionsService
  config?: ApiConfig
  logger?: LoggerService
}

/** 路由请求参数接口。 */
export interface RouteRequestParams {
  globalStore: StoreInstance
  getProjectStore: (cwd: string) => Promise<StoreInstance>
  candidatesStore: CandidateStoreInstance | null | undefined
  sessions?: SessionsService
  config?: ApiConfig
  logger?: LoggerService
}

/** 候选路由参数接口。 */
export interface CandidateRouteParams {
  candidatesStore: CandidateStoreInstance | null | undefined
  globalStore: StoreInstance
  getProjectStore: (cwd: string) => Promise<StoreInstance>
  logger?: LoggerService
}

/** 候选解析结果接口。 */
export interface ResolveCandidateResult {
  ok: false
  status: number
  message: string
}

/** 候选解析成功结果接口。 */
export interface ResolveCandidateSuccess {
  ok: true
  candidate: unknown
  id: string
}

/** 候选解析联合类型。 */
export type ResolveCandidateOutcome = ResolveCandidateResult | ResolveCandidateSuccess

/** 候选合并结果接口。 */
export interface MergeCandidateResult {
  ok: false
  status: number
  message: string
}

/** 候选合并成功结果接口。 */
export interface MergeCandidateSuccess {
  ok: true
  scope: 'global' | 'project'
  cwd: string
  item: unknown
  outcome: string
}

/** 候选合并联合类型。 */
export type MergeCandidateOutcome = MergeCandidateResult | MergeCandidateSuccess

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
