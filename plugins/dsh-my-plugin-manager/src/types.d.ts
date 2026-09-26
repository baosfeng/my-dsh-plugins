/**
 * dsh-my-plugin-manager — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只消费 ctx 的少量 API（webServer / webRuntime / logger / effect）
 * 与 HTTP 请求/响应对象。DSH 运行时（cordis Context）由宿主提供，本文件是插件与
 * 运行时之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** webServer 服务（inject 声明后可用）：HTTP 路由注册。 */
  webServer: WebServerService
  /** webRuntime 服务：受信权威列表（信任围栏用）。 */
  webRuntime: { trustedHosts: string[] }
  /** 日志器（可选：宿主未注入时静默跳过日志）。 */
  logger?: Logger
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 读取可选服务（strict = false 时按「服务是否已提供」判断）。 */
  get<T = unknown>(name: string, strict?: boolean): T | undefined
}

/** webServer 服务（HTTP 路由注册）。 */
export interface WebServerService {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void
  }): () => void
}

/** 日志器。 */
export interface Logger {
  warn(msg: string): void
  info(msg: string): void
  error(msg: string): void
}

/**
 * DSH HTTP 请求（node:http IncomingMessage 的最小契约）。
 *
 * 继承 AsyncIterable<string>：dsh-shared 的 readJsonBody 按异步可迭代对象
 * 读取 body（真实 IncomingMessage 产出 Buffer，字符串契约覆盖两者）。
 */
export interface ServerRequest extends AsyncIterable<string> {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
}

/** DSH HTTP 响应（node:http ServerResponse 的最小契约）。 */
export interface ServerResponse {
  writeHead(statusCode: number, headers?: Record<string, string | number | readonly string[]>): void
  end(chunk?: string): void
}
