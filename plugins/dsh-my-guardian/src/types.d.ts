/**
 * dsh-my-guardian — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（on / effect / get / logger / timer / loader）。
 * DSH 运行时模块（cordis / webServer）由宿主提供，本声明是插件与运行时
 * 之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** Cordis 事件监听器（DSH 事件如 session/start、agent/status）。 */
export type EventHandler = (...args: unknown[]) => void

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
    handler: (request: ServerRequest, response: ServerResponse) => void
  }): () => void
}

/** webRuntime 服务（信任主机列表）。 */
export interface WebRuntimeService {
  trustedHosts: string[]
}

/** loader 服务（插件加载树）。 */
export interface LoaderEntry {
  subtree?: LoaderTree
  options?: { id?: string; name?: string; disabled?: boolean }
  disabled?: boolean
  id?: string
}

export interface LoaderTree {
  filename?: string
  root: {
    create(options: { id: string; name: string; config?: unknown }): Promise<void>
    remove(id: string): Promise<void>
  }
  store?: Record<string, unknown>
  entries(): Iterable<LoaderEntry>
}

export interface LoaderService {
  entries(): Iterable<LoaderEntry>
}

/** timer 服务（定时器）。 */
export interface TimerService {
  interval(callback: () => void, ms: number): void
}

/** logger 服务。 */
export interface LoggerService {
  warn(msg: string): void
  info(msg: string): void
  error(msg: string): void
}

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** 监听 DSH 事件；返回 disposer。 */
  on(event: string, handler: EventHandler): () => void
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 读取可选服务（未加载返回 undefined）。 */
  get<T>(name: string): T | undefined
  /** 日志。 */
  logger?: LoggerService
  /** loader 服务。 */
  loader: LoaderService
  /** timer 服务。 */
  timer: TimerService
  /** webServer 服务（可选）。 */
  webServer?: WebServerService
  /** webRuntime 服务（可选）。 */
  webRuntime?: WebRuntimeService
}
