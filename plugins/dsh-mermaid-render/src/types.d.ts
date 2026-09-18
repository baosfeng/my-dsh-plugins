/**
 * dsh-mermaid-render — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（systemPrompt.section / webServer.register /
 * ctx.get / logger）。DSH 运行时模块（cordis / systemPrompt）由宿主提供，本声明是
 * 插件与运行时之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** systemPrompt 服务（inject 声明后可用）。 */
  systemPrompt?: SystemPromptService
  /** webServer 服务（静态文件路由）。 */
  webServer?: WebServerService
  /** 注册副作用（返回 disposer，随 fiber teardown 自动卸载）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 读取可选服务（未加载返回 undefined；cordis Context 内建方法）。 */
  get?<T = unknown>(name: string): T | undefined
  /** 日志器。 */
  logger?: {
    info(msg: string): void
    warn(msg: string): void
    error(msg: string): void
  }
}

/** systemPrompt 服务（system-prompt section 注册）。 */
export interface SystemPromptService {
  /** 注册一条有序 section；同名重复注册会抛错。返回 disposer。 */
  section(options: { name: string; order: number; text: string | (() => string) }): () => void
}

/** webServer 服务（HTTP 路由注册）。 */
export interface WebServerService {
  /** 注册路由；返回 disposer。 */
  register(options: {
    kind: string
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void | Promise<void>
  }): () => void
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
