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

/** Cordis 事件监听器（DSH 事件如 session/created、agent/status）。 */
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

/** cordis 结构化日志消息（ctx.logger.exporter 的导出器收到的记录；args 未格式化）。 */
export interface LogMessage {
  /** 严重级别：error / info / warn / debug。 */
  type: string
  /** 派生自 fiber 的 logger 名（同一 ctx 打出的消息同名）。 */
  name?: string
  /** 原始参数：首参是格式串，其余是占位符实参。 */
  args?: unknown[]
}

/** cordis 日志导出器（结构化日志 sink；levels.default 为 verbosity 阈值）。 */
export interface LogExporter {
  levels?: Record<string, number>
  export(message: LogMessage): void
}

/** logger 服务。 */
export interface LoggerService {
  warn(msg: string): void
  info(msg: string): void
  error(msg: string): void
  /**
   * 注册日志导出器（DSH 0.1.7-rc.2 删除了 hmr/config-update-failed 事件后的
   * 降级观测通道）。返回随注册 fiber 释放的退订器；老/最小 ctx 可能没有。
   */
  exporter?(exporter: LogExporter): unknown
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
