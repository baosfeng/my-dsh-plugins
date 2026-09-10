/**
 * dsh-task-reliability — DSH 运行时类型声明（server 端最小契约）。
 *
 * 手写最小契约：插件只用到 ctx 的少量 API（on / effect / get / inject /
 * emit / logger / webServer），以及 agents / sessionQuery / goals / approval /
 * commands / webRuntime 等可选服务。DSH 运行时（cordis Context 与各服务）
 * 由宿主提供，本声明是插件与运行时之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */
import type { IncomingHeaders, ServerResponse as SharedServerResponse, UserMessage } from 'dsh-shared'

/** 自由结构对象（DSH 运行时事件载荷 / 工具参数等）。 */
export type AnyObject = Record<string, any>

/** HTTP 响应（与 dsh-shared 的 writeJson/writeError 同一契约）。 */
export type ServerResponse = SharedServerResponse

/** HTTP 请求（node:http IncomingMessage 最小契约；readJsonBody 要求 AsyncIterable）。 */
export interface ServerRequest {
  url?: string
  method?: string
  headers: IncomingHeaders
  [Symbol.asyncIterator](): AsyncIterator<string>
}

/** webServer 服务（HTTP 路由注册）。 */
export interface WebServerService {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** webRuntime 服务（信任围栏的 trustedHosts 来源）。 */
export interface WebRuntimeService {
  trustedHosts?: string[]
}

/** 日志器（DSH 注入的 ctx.logger；方法一律可选调用）。 */
export interface LoggerLike {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

/** 会话头（顶层会话判定）。 */
export interface SessionHeader {
  origin?: string
  delegationDepth?: number
}

/** 会话（事件快照读取：snapshotEvents 新 API，events 旧 API 兜底）。 */
export interface SessionLike {
  header?: SessionHeader | null
  snapshotEvents?: () => any[]
  events?: any[]
}

/** agent 句柄（steer/followup 注入、whenIdle 等待、options 取 provider/model）。 */
export interface AgentLike {
  id: string
  session?: SessionLike
  options?: { provider?: string; model?: string }
  steer(message: UserMessage): void
  followup(message: UserMessage): void
  whenIdle(): Promise<unknown>
}

/** agents 服务（创建校验 agent / 恢复会话 / 取活动 agent）。 */
export interface AgentsService {
  create(options: AnyObject): Promise<AgentHandle>
  resume(options: AnyObject): Promise<AgentHandle>
  get(id: string): AgentLike | undefined
}

/** agents.create / agents.resume 返回的句柄。 */
export interface AgentHandle {
  agent: AgentLike
  dispose?: () => Promise<void> | void
}

/** sessionQuery 服务（读取会话日志）。 */
export interface SessionQueryService {
  readSession(sessionId: string): Promise<unknown>
}

/** goals 服务（活动 goal 目标文本，自动跟踪用）。 */
export interface GoalsService {
  get(agent: AgentLike): { objective?: string } | undefined
}

/** approval 服务（审批策略切换，自主决策模式用）。 */
export interface ApprovalService {
  setPolicy(agent: AgentLike, policy: string): void
}

/** commands 服务（/task 斜杠命令注册）。 */
export interface CommandsService {
  register(options: AnyObject): () => void
}

/** DSH server 端 Context（cordis Context 最小契约）。 */
export interface DshContext {
  /** 监听 DSH 事件（waterfall / serial 监听器）。 */
  on(event: string, handler: (...args: any[]) => any): () => void
  /** 注册副作用；回调返回 disposer 时由 fiber 卸载时调用。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 读取可选服务（未加载返回 undefined）。 */
  get<T = any>(name: string): T | undefined
  /** 等待服务就绪后执行回调（子 fiber 持有注册 disposer）。 */
  inject(names: string[], callback: (scope: any) => void): void
  /** 发出事件（结构化插件事件出口）。 */
  emit(event: string, ...args: any[]): void
  logger?: LoggerLike
  webServer?: WebServerService
  commands?: CommandsService
}

// ── 任务注册表数据模型（store.ts）─────────────────────────────────────────

/** 任务状态：active（跟踪中）/ checking（校验中）/ done / paused / failed。 */
export type TaskStatus = 'active' | 'checking' | 'done' | 'paused' | 'failed'

/** 任务模式：direct（直接继续）/ verify（会话结束后校验）。 */
export type TaskMode = 'direct' | 'verify'

/** 任务来源：manual（手动注册）/ auto（自动跟踪）。 */
export type TaskSource = 'manual' | 'auto'

/** 持久化任务条目。 */
export interface Task {
  id: string
  sessionId: string
  description: string
  status: TaskStatus
  mode: TaskMode
  source: TaskSource
  loopCount: number
  verifyCount: number
  lastSteerAt: number
  resumeAt: number
  createdAt: number
  updatedAt: number
}

/** 待确认问题条目（自主决策 / ask 超时拦截记录）。 */
export interface Question {
  id: string
  sessionId: string
  question: string
  answer?: string
  createdAt?: number
  answeredAt?: number
}

/** 模式状态（持久化）。 */
export interface StoreMode {
  tracking: boolean
  verify: boolean
  autopilot: boolean
  sessionAutopilot: Record<string, boolean>
}

/** 持久化注册表结构（$DSH_HOME/task-reliability.json）。 */
export interface Store {
  version: number
  tasks: Task[]
  questions: Question[]
  mode: StoreMode
}

/** registerTask 入参。 */
export interface TaskInput {
  sessionId?: unknown
  description?: unknown
  mode?: unknown
  source?: unknown
}

/** 注册/结案结果（判别联合：ok 为 true 时携带 task）。 */
export type TaskResult = { ok: true; task: Task } | { ok: false; error: string }

/** 回答待确认问题结果。 */
export type QuestionResult = { ok: true; question: Question } | { ok: false; error: string }

// ── 插件运行时配置（index.ts buildOptionsFrom）─────────────────────────────

/** 规整后的插件 options（应用层 config 覆盖 + 默认值）。 */
export interface ResolvedOptions {
  apiToken: string
  retryMax: number
  maxLoop: number
  maxVerify: number
  retryableCodes: Set<string>
  retryBaseMs: number
  autopilot: boolean
  steerCooldownMs: number
  saveDebounceMs: number
  resumeGraceMs: number
  rateMaxActions: number
  askTimeoutMs: number
  autopilotGraceMs: number
  watchdogIntervalMs: number
  stallTimeoutMs: number
  repeatSimThreshold: number
  repeatConsecutive: number
  repeatMaxPerSession: number
  toolLoopConsecutive: number
  toolLoopWindow: number
  toolLoopBuffer: number
  toolLoopReadonlyTools: Set<string>
  noProgressRounds: number
  notifyOnLoop: boolean
  notifyUrl: string
  rescueOnTruncation: boolean
  rescueMaxPerSession: number
  rescueCooldownMs: number
}

/** 可序列化 options（写入 patch 文件 / API 回填）。 */
export interface PlainConfig {
  apiToken: string
  retryMax: number
  maxLoop: number
  maxVerify: number
  retryableCodes: string[]
  retryBaseMs: number
  autopilot: boolean
  steerCooldownMs: number
  saveDebounceMs: number
  resumeGraceMs: number
  rateMaxActions: number
  askTimeoutMs: number
  autopilotGraceMs: number
  watchdogIntervalMs: number
  stallTimeoutMs: number
  rescueOnTruncation: boolean
  rescueMaxPerSession: number
  rescueCooldownMs: number
}

// ── 会话级运行时状态 ──────────────────────────────────────────────────────

/** 循环打断类型（思考重复 / 工具序列 / 无进展）。 */
export type RepeatKind = 'reason' | 'tool' | 'progress'

/** 产出跟踪（无进展检测）。 */
export interface ProgressState {
  seenOutput: boolean
  productCount: number
  lastProduct: number | null
  stallCount: number
}

/** 思考/工具循环检测状态（会话级，内存态）。 */
export interface RepeatState {
  count: number
  gaveUp: boolean
  notified: boolean
  lastKind: RepeatKind | null
  pendingBreak: RepeatKind | null
  pendingBreakTurn: number | null
  turnSeq: number
  toolCalls: ToolCall[]
  progress: ProgressState
  /** finish chunk 的 reason（FinishReason，用于 max-tokens 截断判定）。 */
  lastFinish?: { kind?: string } | null
}

/** 工具调用记录（工具名 + 参数摘要）。 */
export interface ToolCall {
  name: string
  arg: string
}

/** 输出未完成救场状态（会话级，内存态）。 */
export interface RescueState {
  count: number
  lastRescueAt: number
}

/** 请求级重试计数（按会话 + 时间窗）。 */
export interface RetryBucket {
  windowStart: number
  count: number
}

// ── 结构化插件事件与装配上下文 ────────────────────────────────────────────

/** 插件事件出口（emit.js，best-effort）。 */
export type EmitFn = (name: string, payload: AnyObject) => void

/** 所有子模块共享的可变运行时上下文（index.js createShared 构建）。 */
export interface SharedContext {
  ctx: DshContext
  options: ResolvedOptions
  dir: string
  store: Store
  save: () => void
  saver: { save: () => void; cancel: () => void }
  fence: (request: ServerRequest) => boolean
  emit: EmitFn
  retryBuckets: Map<string, RetryBucket>
  repeatStates: Map<string, RepeatState>
  rescueStates: Map<string, RescueState>
  errorMarks: Map<string, number>
  actionLog: number[]
  resumeTimer: NodeJS.Timeout | null
  watchdogTimer: NodeJS.Timeout | null
  /** 设置页保存配置（index.js apply 注入）。 */
  saveConfig: (payload: Record<string, unknown>) => Promise<void>
}

// ── 工具/事件载荷（DSH 运行时最小契约）─────────────────────────────────────

/** `tools/pre-execute` / `tools/execute` 的 exec 载荷。 */
export interface ExecLike {
  name?: string
  arguments?: unknown
  agent: AgentLike
}

/** waterfall 监听器的 next()（返回流 / 工具结果 / 继续执行）。 */
export type NextFn = (...args: any[]) => any

/** 请求失败载荷（agent/request-error）。 */
export interface RequestErrorPayload {
  failure?: { code?: string }
  agent?: AgentLike
  signal?: { aborted?: boolean }
}

/** /task 命令调用上下文。 */
export interface CommandInvocation {
  rawInput: string
  agent: AgentLike
}

/** /task 命令执行结果。 */
export interface CommandResult {
  kind: 'success' | 'error'
  text: string
}
