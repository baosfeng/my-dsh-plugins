/**
 * dsh-my-notify — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（on / effect / get / webServer / logger）。
 * DSH 运行时模块（cordis / webServer）由宿主提供，本声明是插件与运行时
 * 之间的类型契约——新 TS 插件照抄本文件，按需扩展。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** Cordis 事件监听器（DSH 事件如 agent/status、tools/pre-execute）。 */
export type EventHandler = (...args: never[]) => void | Promise<void>

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** 监听 DSH 事件；返回 disposer。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void | Promise<void>): () => void
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 读取可选服务（未加载返回 undefined）。 */
  get<T>(name: string): T | undefined
  /** webServer 服务（inject 声明后可用）。 */
  webServer?: WebServerService
  /** 日志器。 */
  logger: Logger
}

/** webServer 服务（HTTP 路由注册）。 */
export interface WebServerService {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void
  }): () => void
}

/** DSH HTTP 请求（node:http IncomingMessage 的最小契约）。 */
export interface ServerRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  on(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
}

/** DSH HTTP 响应（node:http ServerResponse 的最小契约）。 */
export interface ServerResponse {
  writeHead(statusCode: number, headers?: Record<string, string>): void
  write(chunk: string): void
  end(chunk?: string): void
  on(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
  destroy(): void
}

/** 日志器接口。 */
export interface Logger {
  warn(message: string): void
  info(message: string): void
  error(message: string): void
}

/** 通知帧（SSE 广播 + webhook 推送）。 */
export interface NoticeFrame {
  kind: 'end' | 'ask' | 'approval' | 'remote'
  sessionId?: string
  title?: string
  note?: string
  toolName?: string
  agentType?: 'top' | 'subagent'
  tokens?: TokenUsage | null
  duration?: number | null
  sessionUrl?: string
  question?: string
  questions?: string[]
  time?: number
}

/** Token 用量。 */
export interface TokenUsage {
  input?: number
  output?: number
  total?: number
}

/** Webhook 配置。 */
export interface WebhookConfig {
  name: string
  channel: 'wecom' | 'feishu' | 'dingtalk' | 'generic'
  url: string
  secret?: string
  events?: string[]
  enabled?: boolean
  msgType?: 'text' | 'markdown' | 'post'
  template?: string
}

/** 通知选项（运行时配置）。 */
export interface NotifyOptions {
  end: boolean
  ask: boolean
  approval: boolean
  subagentEnd: boolean
  askMode: 'full' | 'summary'
  webBaseUrl: string
  apiToken: string
  dedupeMs: number
  webhooks: WebhookConfig[]
}

/** 插件应用层配置（cordis.patch.yml 的 config 字段）。 */
export interface PluginConfig {
  end?: boolean
  ask?: boolean
  approval?: boolean
  subagentEnd?: boolean
  askMode?: 'full' | 'summary'
  webBaseUrl?: string
  apiToken?: string
  dedupeMs?: number
  webhooks?: WebhookConfig[]
}

/** sessionTitle 服务快照。 */
export interface SessionTitleSnapshot {
  title?: string
}

/** sessionTitle 服务。 */
export interface SessionTitleService {
  get(session: unknown): SessionTitleSnapshot | undefined
}

/** 会话 header。 */
export interface SessionHeader {
  origin?: string
  delegationDepth?: number
  parentSession?: string
  cwd?: string
}

/** 会话对象。 */
export interface Session {
  id: string
  header?: SessionHeader
  [key: string]: unknown
}

/** Agent 对象。 */
export interface Agent {
  id: string
  session?: Session
  options?: { subagentDepth?: number }
  [key: string]: unknown
}

/** Token 计量桶。 */
export interface TokenBucket {
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    reasoningTokens: number
  }
  requests: number
  startedAt: number
}

/** Token 计量摘要。 */
export interface TokenSummary {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  requests: number
  startedAt: number
}

/** Token 计量器。 */
export interface TokenMeter {
  track(sessionId: string, event: unknown): void
  summary(sessionId: string): TokenSummary | undefined
  drop(sessionId: string): void
}

/** 通知总线。 */
export interface NoticeBus {
  clients: Set<SseClient>
  emitNotice(notice: NoticeFrame): void
  startHeartbeat(): void
  stopHeartbeat(): void
}

/** SSE 客户端。 */
export interface SseClient {
  response: ServerResponse
}

/** Webhook 失败记录。 */
export interface WebhookFailure {
  time: number
  webhookName: string
  channel: string
  url: string
  error: string
  attempts: number
}

/** 失败记录日志。 */
export interface FailureLog {
  add(failure: WebhookFailure): void
  list(): WebhookFailure[]
}

/** Webhook 存储。 */
export interface WebhookStore {
  failures: FailureLog
  load(): WebhookConfig[]
  save(webhooks: WebhookConfig[]): Promise<void>
}

/** Webhook 推送依赖注入。 */
export interface PusherDeps {
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  onFailure?: (failure: WebhookFailure) => void
  formatOpts?: { askFull?: boolean }
  timeoutMs?: number
}

/** 签名结果。 */
export interface SignResult {
  query: Record<string, string>
  body: unknown
}
