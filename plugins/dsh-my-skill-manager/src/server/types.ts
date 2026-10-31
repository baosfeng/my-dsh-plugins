/**
 * dsh-my-skill-manager — 宿主运行时类型契约（server 端最小集合）。
 *
 * 插件只依赖宿主的少量 API：skills / webServer / sessions / logger /
 * on / effect。DSH 的 cordis、webServer、skills 服务由宿主提供，这里手写
 * 最小结构契约，避免把宿主类型包作为依赖安装。
 *
 * 与宿主实现的对应关系（DSH 0.2.x）：
 *  - `ctx.skills.list({ cwd })` → SkillSummary[]（含 path / invocation /
 *    source / provider）；`ctx.skills.get(name, { cwd })` → SkillDefinition。
 *  - `ctx.skills.registerProvider(create)` → 返回 unregister disposer；控制面
 *    `control.invalidate()` 让目录缓存立即失效。
 *  - `tools/pre-execute` 事件：(execution, next) → next() 的链式拦截器。
 *  - 信任源：webStartup.trustedHosts + webServer.host（dsh-shared 封装）。
 */

/** HTTP 请求头（node:http IncomingMessage.headers 的最小契约）。 */
export interface IncomingHeaders {
  [name: string]: string | string[] | undefined
}

/** DSH HTTP 请求（node:http IncomingMessage 的最小契约 + 可读流）。 */
export interface ServerRequest extends AsyncIterable<string> {
  url?: string
  method?: string
  headers: IncomingHeaders
}

/** DSH HTTP 响应（node:http ServerResponse 的最小契约）。 */
export interface ServerResponse {
  writeHead(statusCode: number, headers?: Record<string, string | number | readonly string[]>): void
  end(chunk?: string): void
}

/** 日志器（与 dsh-shared 的 Logger 兼容）。 */
export interface Logger {
  warn(message: string): void
  info?(message: string): void
  error?(message: string): void
}

/** skill 的调用能力（宿主 invocation 策略）。 */
export interface SkillInvocationPolicy {
  modelInvocable: boolean
  userInvocable: boolean
}

/** `ctx.skills.list()` 返回的一条摘要。 */
export interface SkillSummary {
  /** 有实体文件时由 provider 提供的绝对路径。 */
  path?: string
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocationPolicy
  source: string
  provider: string
}

/** provider 注册进 registry 的候选条目（rank 越小优先级越高）。 */
export interface SkillCandidate extends SkillSummary {
  rank: number
  locator?: unknown
}

/** `ctx.skills.get()` 返回的完整 skill（含正文）。 */
export interface SkillDefinition extends SkillSummary {
  content: string
}

/** provider 的查询上下文（cwd 用于项目敏感发现，signal 用于取消）。 */
export interface SkillLookupOptions {
  cwd?: string | undefined
  signal?: AbortSignal | undefined
}

/** registry 读取选项：在查询上下文之上再带调用方作用域。 */
export interface SkillViewOptions extends SkillLookupOptions {
  scope?: unknown
}

/** provider 注册时借到的生命周期/失效控制面。 */
export interface SkillProviderControl {
  readonly signal?: AbortSignal
  invalidate(): void
}

/** 插件注册进 skills 服务的 provider。 */
export interface SkillProvider {
  readonly name: string
  list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]>
  get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined>
}

/** skills 服务（注册 provider / 合并目录 / 加载正文）。 */
export interface SkillsService {
  registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void
  list(options?: SkillViewOptions): Promise<SkillSummary[]>
  /** 宿主实现为可取属性，usage 统计据此包装。 */
  get?: (name: string, options?: SkillViewOptions) => Promise<SkillDefinition | undefined>
}

/** webServer 的 prefix 路由注册选项。 */
export interface WebServerRoute {
  kind: 'prefix'
  path: string
  handler: (request: ServerRequest, response: ServerResponse) => void | Promise<void>
}

/** webServer 服务（路由注册 + 监听地址）。 */
export interface WebServerService {
  /** 监听地址字面量（DSH 0.2.1 起为具体 IP；信任围栏据此放行浏览器直连）。 */
  host?: string
  register(options: WebServerRoute): () => void
}

/** 旧宿主（≤0.2.0）的 webRuntime 服务；仅作为围栏兜底来源保留。 */
export interface WebRuntimeService {
  trustedHosts?: readonly string[]
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
  /** skills 服务（inject 声明后可用）。 */
  skills?: SkillsService
  /** webServer 服务（inject 声明后可用）。 */
  webServer?: WebServerService
  /** 旧宿主的 webRuntime 服务（DSH 0.2.1 已移除，仅兼容兜底）。 */
  webRuntime?: WebRuntimeService
  /** sessions 服务（会话 cwd 查询）。 */
  sessions?: SessionsService
  /** 日志器。 */
  logger?: Logger
  /** 读取可选服务（webStartup 等）。 */
  get?<T = unknown>(name: string, strict?: boolean): T | undefined
  /** 监听 DSH 事件；返回 disposer。 */
  on(event: string, handler: (...args: unknown[]) => unknown): () => void
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
}
