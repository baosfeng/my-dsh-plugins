/**
 * dsh-my-skill-manager — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（skills / webServer / webRuntime /
 * sessions / logger / on / effect）。DSH 运行时模块（cordis / webServer /
 * skills 服务）由宿主提供，本声明是插件与运行时之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** HTTP 请求头（node:http IncomingMessage.headers 的最小契约）。 */
export interface IncomingHeaders {
  [header: string]: string | string[] | undefined
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

/** 官方 skill 目录条目（catalog candidate / list 结果的最小契约）。 */
export interface SkillCatalogEntry {
  name: string
  description?: string
  source?: string
  provider?: string
  rank?: number
  invocation?: { modelInvocable: boolean; userInvocable: boolean }
}

/** skill provider 注册回调收到的控制面（配置变化时 invalidate 触发重算）。 */
export interface SkillProviderControl {
  invalidate(): void
}

/** 插件注册进 skills 服务的 provider。 */
export interface SkillProvider {
  name: string
  list(options?: { cwd?: string }): Promise<SkillCatalogEntry[]>
  get(name?: string, options?: unknown): Promise<undefined>
}

/** skills 服务（注册 provider / 合并目录 / 加载正文）。 */
export interface SkillsService {
  registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void
  list(options?: { cwd?: string }): Promise<SkillCatalogEntry[]>
  /** 可被包装（usage 统计）：宿主实现为可取属性。 */
  get?: (name: string, options?: unknown) => Promise<unknown>
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
  webServer: WebServerService
  /** webRuntime 服务（信任围栏）。 */
  webRuntime: WebRuntimeService
  /** sessions 服务（会话 cwd 查询）。 */
  sessions: SessionsService
  /** 日志器。 */
  logger?: Logger
  /** 监听 DSH 事件；返回 disposer。 */
  on(event: string, handler: (...args: unknown[]) => unknown): () => void
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
}
