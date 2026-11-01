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
  /** 监听地址字面量（DSH 0.2.1+；信任围栏的 bindHost 来源）。 */
  host?: string
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
  /** 会话工作目录（模板变量 session.cwd）。 */
  cwd?: string
  /** 模型名（模板变量 session.model）。 */
  model?: string
  /** 模型供应商（模板变量 session.provider）。 */
  provider?: string
  /** agent preset 名（模板变量 session.preset）。 */
  preset?: string
  /** 父会话 id（模板变量 session.parentId）。 */
  parentId?: string
  /** 显式值不被 messages 模板覆盖的字段（远程触发的用户指定 title / body）。 */
  preserve?: Array<'title' | 'note'>
}

/** Token 用量（含缓存 / 推理 / 请求数；模板变量 tokens.* 的取值来源）。 */
export interface TokenUsage {
  input?: number
  output?: number
  total?: number
  /** 缓存命中 token 数。 */
  cacheRead?: number
  /** 缓存写入 token 数。 */
  cacheWrite?: number
  /** 推理 token 数。 */
  reasoning?: number
  /** assistant 消息条数（请求数）。 */
  requests?: number
}

/** 免打扰时间段配置。 */
export interface QuietHours {
  enabled: boolean
  start: string // "HH:mm" 格式，如 "23:00"
  end: string // "HH:mm" 格式，如 "08:00"
}

/** 飞书卡片配置（msgType = interactive 时生效）。 */
export interface CardConfig {
  /** 卡片结构版本：'2.0'（默认）或 '1.0'。 */
  schemaVersion?: '2.0' | '1.0'
  /** 头部配色（13 色之一）；accentByKind 为 true 时被事件配色覆盖。 */
  template?: string
  /** 卡片字段列表：模板变量名（如 tokens.text），仅显示列出的项。 */
  fields?: string[]
  /** 跳转按钮文案（配置 session.url 时渲染 open_url 按钮）。 */
  buttonText?: string
  /** @ 的 open_id / user_id 列表（空项自动剥离）。 */
  mentionOpenIds?: string[]
  /** 是否 @ 所有人。 */
  mentionAll?: boolean
  /** 按事件类型自动配色（默认 true）。 */
  accentByKind?: boolean
}

/** 推送重试配置。 */
export interface RetryConfig {
  /** 失败后最大重试次数（默认 3）。 */
  attempts?: number
  /** 退避基数（毫秒，默认 1000，按指数增长）。 */
  backoffMs?: number
}

/** Webhook 配置。 */
export interface WebhookConfig {
  name: string
  channel: 'wecom' | 'feishu' | 'dingtalk' | 'generic'
  url: string
  secret?: string
  events?: string[]
  enabled?: boolean
  /** 消息类型；'interactive' 仅飞书支持（卡片）。 */
  msgType?: 'text' | 'markdown' | 'post' | 'interactive'
  /** 旧版整段模板（bodyTemplate 未配置时生效，兼容旧配置）。 */
  template?: string
  /** 标题模板（为空回退会话标题）。 */
  titleTemplate?: string
  /** 正文模板（为空回退默认富格式正文）。 */
  bodyTemplate?: string
  /** 飞书卡片配置（msgType = interactive 时生效）。 */
  card?: CardConfig
  /** 重试配置（缺省 3 次 / 1s 指数退避）。 */
  retry?: RetryConfig
}

/** 提示音配置。 */
export interface SoundConfig {
  enabled: boolean
  /** 音色预设标识（由 client 端解释）。 */
  preset: string
  /** 音量 0-1。 */
  volume: number
}

/** 页面 toast 配置。 */
export interface ToastConfig {
  enabled: boolean
  /** 停留时长（毫秒）。 */
  durationMs: number
  /** 出现位置。 */
  position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top' | 'bottom'
  /** 最大堆叠条数。 */
  maxStack: number
}

/** 系统通知配置。 */
export interface SystemConfig {
  enabled: boolean
  /** 是否常驻（需用户手动关闭）。 */
  requireInteraction: boolean
}

/** 单条事件文案模板（title / body 均可含变量占位符）。 */
export interface MessageTemplate {
  title: string
  body: string
}

/** 五类事件的文案模板（含 subagentEnd 与 remote）。 */
export interface MessagesConfig {
  end?: Partial<MessageTemplate>
  ask?: Partial<MessageTemplate>
  approval?: Partial<MessageTemplate>
  subagentEnd?: Partial<MessageTemplate>
  remote?: Partial<MessageTemplate>
}

/** 填充默认值后的文案模板（运行时生效值）。 */
export interface ResolvedMessages {
  end: MessageTemplate
  ask: MessageTemplate
  approval: MessageTemplate
  subagentEnd: MessageTemplate
  remote: MessageTemplate
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
  quietHours: QuietHours
  /** 提示音配置。 */
  sound: SoundConfig
  /** 页面 toast 配置。 */
  toast: ToastConfig
  /** 系统通知配置。 */
  system: SystemConfig
  /** 五类事件文案模板（已填充默认值）。 */
  messages: ResolvedMessages
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
  quietHours?: QuietHours
  /** 提示音配置（部分字段，缺失回退默认值）。 */
  sound?: Partial<SoundConfig>
  /** 页面 toast 配置（部分字段，缺失回退默认值）。 */
  toast?: Partial<ToastConfig>
  /** 系统通知配置（部分字段，缺失回退默认值）。 */
  system?: Partial<SystemConfig>
  /** 五类事件文案模板（部分字段，缺失回退默认文案）。 */
  messages?: MessagesConfig
  /** 扁平持久化字段（patch 文件写入/读取）。 */
  quietHoursEnabled?: boolean
  quietHoursStart?: string
  quietHoursEnd?: string
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
  /** 推理 token 数（模板变量 tokens.reasoning）。 */
  reasoning?: number
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
