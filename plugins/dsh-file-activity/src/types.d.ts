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

/** 淘汰计数（入口配额可观测，issue #197：淘汰而非静默丢弃）。 */
export interface EvictedStats {
  /** 被淘汰的会话数（超会话数上限，整桶 LRU）。 */
  sessions: number
  /** 被淘汰的单会话路径数（超每会话上限，LRU）。 */
  paths: number
  /** 被淘汰的全局路径数（超全局上限，LRU）。 */
  pathsTotal: number
}

/** 状态文档内的运行统计。 */
export interface ActivityStats {
  evicted: EvictedStats
}

/** 内存中的状态文档（createState 产出的完整形态）。 */
export interface ActivityState {
  version: number
  sessions: Record<string, SessionState>
  stats: ActivityStats
}

/** 持久化落盘统计（写放大看板口径：含 compact 快照的累计真实落盘字节）。 */
export interface PersistStats {
  bytesWritten: number
  writes: number
  events: number
  fileBytes: number
}

/** 对外暴露的资源上界与淘汰计数（资源冒烟/看门狗读取）。 */
export interface StoreStats {
  bytesWritten: number
  writes: number
  persistEvents: number
  fileBytes: number
  evictedSessions: number
  evictedPaths: number
  evictedPathsTotal: number
  maxSessions: number
  maxPathsPerSession: number
  maxPathsTotal: number
  pathCount: number
}

/** 配额参数（可覆盖，便于测试与后续配置化）。 */
export interface QuotaLimits {
  maxPathsPerSession: number
  maxPathsTotal: number
  maxSessions: number
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
  /** 资源上界 + 淘汰计数 + 落盘统计（写放大断言/看门狗读取）。 */
  stats(): StoreStats
  dispose(): void
}

/** jsonlAppender 的最小契约（dsh-shared/lib/jsonl.js 的结构化子集）。 */
export interface AppenderHandle {
  append(value: unknown): void
  flush(): Promise<unknown>
  snapshot(lines: string[]): Promise<unknown>
  dispose(): Promise<unknown>
  /** 各 appender 字段名略有差异（dsh-shared 用 total），读取侧统一兜底。 */
  stats(): { bytesWritten?: number; writes?: number; total?: number; events?: number; fileBytes?: number }
}

/** appender 工厂（默认 dsh-shared 的 jsonlAppender；测试可注入以精确测写放大）。 */
export type AppenderFactory = (
  file: string,
  options: {
    flushMs: number
    compactLines: number
    logger?: Logger
    prefix: string
    onCompact: () => Promise<unknown> | unknown
  },
) => AppenderHandle

/** 增量持久化编排句柄（persist.ts 的 createPersist 产出）。 */
export interface PersistHandle {
  file: string
  appender: AppenderHandle
  append(record: RecordFact): void
  compact(state: ActivityState): Promise<boolean>
  flush(): Promise<unknown>
  dispose(): Promise<unknown>
}

/** 增量持久化编排句柄（persist.ts 的 createPersist 产出）。 */
export interface PersistHandle {
  file: string
  appender: AppenderHandle
  append(record: RecordFact): void
  compact(state: ActivityState): Promise<boolean>
  flush(): Promise<unknown>
  dispose(): Promise<unknown>
}

/** createStore 的可注入依赖（appender 用于写放大实测，limits 用于配额化测试）。 */
export interface StoreDeps {
  appender?: AppenderFactory
  limits?: Partial<QuotaLimits>
  flushMs?: number
  compactLines?: number
}

/** 一条已应用到内存、待增量落盘的记录事实。 */
export interface RecordFact {
  sessionId: string
  path: string
  op: string
  time: number
}

/** createStore 内部句柄（生命周期状态 + 增量持久化调度）。 */
export interface StoreHandle {
  ctx: DshContext
  file: string
  store: ActivityStore
  pending: PendingRecord[]
  ready: boolean
  limits: QuotaLimits
  evicted: EvictedStats
  /** 已应用但尚未落盘的事件事实（防抖窗口合并）。 */
  facts: RecordFact[]
  flushTimer: ReturnType<typeof setTimeout> | null
  /** 增量持久化编排（createPersist 产出）。 */
  persist: PersistHandle | null
  dirtyChain: Promise<unknown>
  /** 当前 compact 触发行阈值（随快照体积自适应）。 */
  compactLines: number
  /** 上次 compact 时的累计事件行数。 */
  compactedEvents: number
  /** 阈值是否由外部固定（测试注入时不再自适应）。 */
  compactLinesFixed: boolean
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
