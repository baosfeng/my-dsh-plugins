/**
 * dsh-file-activity — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只消费 ctx 的少量 API（webServer / webRuntime /
 * sessions / logger / on / effect）与 HTTP 请求/响应对象。DSH 运行时
 * （cordis Context、webServer/webRuntime/sessions 服务）由宿主提供，
 * 本文件是插件与运行时之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** HTTP 请求头（node:http IncomingMessage.headers 的最小契约）。 */
export interface IncomingHeaders {
  [header: string]: string | string[] | undefined
}

/**
 * DSH HTTP 请求（node:http IncomingMessage 的最小契约 + 可读流）。
 *
 * 继承 AsyncIterable<string>：dsh-shared 的 readJsonBody 按异步可迭代对象
 * 读取 body（真实 IncomingMessage 产出 Buffer，字符串契约覆盖两者）。
 */
export interface ServerRequest extends AsyncIterable<string> {
  url?: string
  method?: string
  headers: IncomingHeaders
}

/** DSH HTTP 响应（node:http ServerResponse 的最小契约）。 */
export interface ServerResponse {
  writeHead(statusCode: number, headers?: Record<string, string | number | readonly string[]>): void
  /** 媒体路由直接写 Buffer（Uint8Array 覆盖 Buffer）。 */
  end(chunk?: string | Uint8Array): void
}

/** 日志器（与 dsh-shared 的 Logger 兼容）。 */
export interface Logger {
  warn(message: string): void
  info?(message: string): void
  error?(message: string): void
}

/** webServer 服务（HTTP 路由注册）。 */
export interface WebServerService {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** webRuntime 服务（信任围栏的可信 host 列表）。 */
export interface WebRuntimeService {
  trustedHosts: string[]
}

/** 会话对象（只用到 header.cwd）。 */
export interface SessionLike {
  header?: { cwd?: unknown }
}

/** sessions 服务。 */
export interface SessionsService {
  get(id: string): SessionLike | undefined
}

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** webServer 服务（inject 声明后可用）。 */
  webServer: WebServerService
  /** webRuntime 服务（信任围栏）。 */
  webRuntime: WebRuntimeService
  /** sessions 服务（会话 cwd 查询）。 */
  sessions: SessionsService
  /** 日志器（宿主未注入时由 dsh-shared 静默跳过日志）。 */
  logger?: Logger
  /** 监听 DSH 事件；返回 disposer。handler 实参由各事件的运行时契约决定。 */
  on(event: string, handler: (...args: any[]) => unknown): () => void
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
}

// ── 状态模型（$DSH_HOME/file-activity.json）────────────────────────────────

/** 一条历史记录（按 path 去重的 LRU 条目）。 */
export interface RecentEntry {
  path: string
  op: string
  time: number
}

/**
 * 单个文件的计数器。firstSeen / lastSeen 在首次 bumpCount 时写入，因此
 * 旧状态文件里可能缺失（读取侧按可选处理）。
 */
export interface Counters {
  read: number
  create: number
  modify: number
  firstSeen?: number
  lastSeen?: number
}

/** 单会话状态：known（首次接触时间）+ counts（计数器）+ recent（LRU 历史）。 */
export interface SessionState {
  known: Record<string, number>
  counts: Record<string, Counters>
  recent: RecentEntry[]
}

/** 内存中的状态文档（createState 产出的完整形态）。 */
export interface ActivityState {
  version: number
  sessions: Record<string, SessionState>
}

/** 加载自磁盘的原始状态（字段可能缺失/非法，trimLoadedState 负责归一化）。 */
export interface LoadedState {
  version: number
  sessions?: Record<string, SessionState> | null
}

// ── store ─────────────────────────────────────────────────────────────────

/** 状态加载完成前缓冲的记录。 */
export interface PendingRecord {
  sessionId: string
  path: string
  op: string
  time?: number
}

/** 对外暴露的 store（路由处理器始终读取实时 state 引用）。 */
export interface ActivityStore {
  state: ActivityState
  record(sessionId: string, path: string, op: string, time?: number): boolean
  schedulePersist(): void
  dispose(): void
}

/** createStore 内部句柄（生命周期状态 + 持久化调度）。 */
export interface StoreHandle {
  ctx: DshContext
  file: string
  store: ActivityStore
  pending: PendingRecord[]
  ready: boolean
  persistTimer: ReturnType<typeof setTimeout> | null
  dirtyChain: Promise<unknown>
  persistNow(): void
  persistSoon(): void
}

// ── bash 意图解析 ──────────────────────────────────────────────────────────

/** 一个已 tokenize 的词（text 为去引号后的内容，safe 为可静态解析标志）。 */
export interface BashToken {
  text: string
  safe: boolean
}

/** 解析出的文件操作（路径已解析为绝对路径）。 */
export interface BashOp {
  op: string
  path: string
}

// ── fs/observed 事件 ───────────────────────────────────────────────────────

/** 观察到的工具执行者（agent 工具调用的 actor）。 */
export interface FsActor {
  name: string
  agent?: { id?: unknown }
  arguments?: { file_path?: unknown } | null
}
