/**
 * dsh-my-remote — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（on / effect / get / webServer / logger）。
 * DSH 运行时模块（cordis / webServer）由宿主提供，本声明是插件与运行时
 * 之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** DSH HTTP 请求（node:http IncomingMessage 的最小契约）。 */
export interface ServerRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
}

/** DSH HTTP 响应（node:http ServerResponse 的最小契约）。 */
export interface ServerResponse {
  writeHead(statusCode: number, headers?: Record<string, string>): void
  end(chunk?: string): void
}

/** webServer 服务（HTTP 路由注册）。 */
export interface WebServerService {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Cordis 事件监听器。 */
export type EventHandler = (...args: any[]) => any

/** agents 服务（会话管理）。 */
export interface AgentsService {
  roots(): any[]
  get(id: string): any | undefined
}

/** sessionTitle 服务（会话标题快照）。 */
export interface SessionTitleService {
  get(session: any): { title?: string } | undefined
}

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** 监听 DSH 事件；返回 disposer。 */
  on(event: string, handler: EventHandler): () => void
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 读取可选服务（未加载返回 undefined）。 */
  get<T = unknown>(name: string): T | undefined
  /** webServer 服务（inject 声明后可用）。 */
  webServer?: WebServerService
  /** 日志器。 */
  logger?: {
    warn(msg: string): void
    info(msg: string): void
    error(msg: string): void
  }
}

/** webhook 配置。 */
export interface WebhookConfig {
  name: string
  url: string
  events?: string[]
  enabled?: boolean
  headers?: Record<string, string>
}

/** 插件配置（应用层 config 覆盖）。 */
export interface PluginConfig {
  end?: boolean
  ask?: boolean
  approval?: boolean
  apiToken?: string
  webhooks?: WebhookConfig[]
  askTimeoutMs?: number
  approvalTimeoutMs?: number
}

/** 规整后的 options。 */
export interface ResolvedOptions {
  end: boolean
  ask: boolean
  approval: boolean
  apiToken: string
  webhooks: WebhookConfig[]
  askTimeoutMs: number
  approvalTimeoutMs: number
}

/** 注册表条目（ask）。 */
export interface AskEntry {
  id: string
  sessionId: string
  questions: unknown[]
  payload: unknown
  answer: unknown
  at: number
  waitFor: Promise<AskEntry>
  settle: (entry: AskEntry) => void
}

/** 注册表条目（approval）。 */
export interface ApprovalEntry {
  id: string
  sessionId: string
  request: unknown
  outcome: string | undefined
  at: number
  waitFor: Promise<ApprovalEntry>
  settle: (entry: ApprovalEntry) => void
}

/** ask 注册表。 */
export interface AskRegistry {
  register(sessionId: string, questions: unknown[], payload: unknown): AskEntry | undefined
  resolve(sessionId: string, answers: unknown[]): { ok: true; answer: unknown[] } | { ok: false; code: string }
  peek(sessionId: string): { id: string; sessionId: string; at: number } | undefined
  cleanSession(sessionId: string): void
  listPending(): { id: string; sessionId: string; at: number }[]
}

/** approval 注册表。 */
export interface ApprovalRegistry {
  register(sessionId: string, request: unknown): ApprovalEntry | undefined
  decide(sessionId: string, outcome: string): { ok: true; outcome: string } | { ok: false; code: string }
  peek(sessionId: string): { id: string; sessionId: string; at: number } | undefined
  cleanSession(sessionId: string): void
  listPending(): { id: string; sessionId: string; at: number }[]
}

/** 审计日志条目。 */
export interface AuditEntry {
  time: number
  action: string
  sessionId: string
  source: string
  ok: boolean
  detail: string
}

/** 审计日志。 */
export interface AuditLog {
  record(entry: Partial<AuditEntry>): void
  list(): AuditEntry[]
  limit: number
}

/** 渠道控制器。 */
export interface Channels {
  dispatch(event: Record<string, unknown>): void
  failures: { list(): ChannelFailure[] }
  list(): WebhookConfig[]
}

/** 渠道失败记录。 */
export interface ChannelFailure {
  time: number
  webhookName: string
  url: string
  error: string
  attempts?: number
}

/** 共享上下文（事件层与路由层共享）。 */
export interface SharedContext {
  ctx: DshContext
  options: ResolvedOptions
  logger: DshContext['logger']
  askRegistry: AskRegistry
  approvalRegistry: ApprovalRegistry
  audit: AuditLog
  channels: Channels
  titleOf: (ctx: DshContext, agent: any) => string
  isTopLevelAgent: (agent: any) => boolean
}
