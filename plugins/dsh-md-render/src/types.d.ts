/**
 * dsh-md-render — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（on / effect / get / webServer / logger）。
 * DSH 运行时模块（cordis / webServer）由宿主提供，本声明是插件与运行时
 * 之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** 监听 DSH 事件；返回 disposer。 */
  on(event: string, handler: (...args: unknown[]) => void): () => void
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 读取可选服务（未加载返回 undefined）。 */
  get<T = unknown>(name: string): T | undefined
  /** webServer 服务（inject 声明后可用）。 */
  webServer?: WebServerService
  /** 日志器。 */
  logger?: Logger
}

/** webServer 服务（HTTP 路由注册）。 */
export interface WebServerService {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void
  }): () => void
}

/** 配置值类型（开关为布尔，选择项为字符串）。 */
export type ConfigValue = Record<string, boolean | string>

/** 日志器。 */
export interface Logger {
  warn(msg: string): void
  info(msg: string): void
  error(msg: string): void
}

/** DSH HTTP 请求（node:http IncomingMessage 的最小契约）。 */
export interface ServerRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  /** 流式读取 body：dsh-shared 的 readJsonBody 要求 AsyncIterable<string>。 */
  [Symbol.asyncIterator](): AsyncIterator<string>
}

/** DSH HTTP 响应（node:http ServerResponse 的最小契约）。 */
export interface ServerResponse {
  writeHead(statusCode: number, headers?: Record<string, string>): void
  end(chunk?: string): void
}
