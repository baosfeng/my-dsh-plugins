/**
 * dsh-md-render — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（effect / get / webServer / systemPrompt /
 * logger）。DSH 运行时模块（cordis / webServer / systemPrompt）由宿主提供，本声明是
 * 插件与运行时之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** 注册副作用（返回 disposer，随 fiber teardown 自动卸载）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 读取可选服务（未加载返回 undefined；cordis Context 内建方法）。 */
  get?<T = unknown>(name: string): T | undefined
  /** webServer 服务（HTTP 路由 / 静态资源）。 */
  webServer?: WebServerService
  /** systemPrompt 服务（system-prompt section 注册）。 */
  systemPrompt?: SystemPromptService
  /** 日志器。 */
  logger?: Logger
}

/** webServer 服务（HTTP 路由注册）。 */
export interface WebServerService {
  /** 注册路由；返回 disposer。 */
  register(options: {
    kind: 'prefix'
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** systemPrompt 服务（system-prompt section 注册）。 */
export interface SystemPromptService {
  /** 注册一条有序 section；同名重复注册会抛错。返回 disposer。 */
  section(options: { name: string; order: number; text: string | (() => string) }): () => void
}

/** 日志器。 */
export interface Logger {
  info(msg: string): void
  warn(msg: string): void
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
  end(chunk?: string | Uint8Array): void
}
