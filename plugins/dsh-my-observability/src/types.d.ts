/**
 * dsh-my-observability — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只消费 ctx 的少量 API（webServer / webRuntime / logger /
 * effect / on / get / serial）与 HTTP 请求/响应对象。DSH 运行时
 * （cordis Context、宿主 webServer / webRuntime / pluginInventory 服务）由宿主提供，
 * 本文件是插件与运行时之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** 日志器（dsh-shared Logger 的超集：插件只用 warn）。 */
export interface Logger {
  warn(message: string): void
  info?(message: string): void
  error?(message: string): void
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

/** webServer 服务（HTTP 路由注册）。 */
export interface WebServerService {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void
  }): () => void
}

/** 事件监听器（cordis 派发参数形态不一：waterfall 事件末参为 next）。 */
export type EventListener = (...args: any[]) => unknown

/** agents 服务（可选：AI 审查增强用，不可用时降级）。 */
export interface AgentsService {
  create(options: { sessionId: string; meta?: unknown; agentOptions?: unknown }): Promise<AgentHandle>
}

/** 审查 agent 句柄。 */
export interface AgentHandle {
  agent: {
    followup(message: unknown): void
    whenIdle(): Promise<unknown>
    session?: unknown
  }
  dispose(): Promise<void>
}

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** webServer 服务（inject 声明后可用）：HTTP 路由注册。 */
  webServer: WebServerService
  /** 日志器。 */
  logger: Logger
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 注册事件监听（返回 disposer）。 */
  on(event: string, listener: EventListener): () => void
  /** 读取可选服务（webRuntime / agents / pluginInventory 等，未激活时 undefined）。 */
  get<T = unknown>(name: string, strict?: boolean): T | undefined
  /**
   * 事件分发。收集监听器返回值必须用 `serial`（顺序 await，返回首个
   * 非 null/false/undefined 的返回值）：`emit` 同步派发不收集返回值，
   * `parallel` 只处理异常、不返回结果（宿主 @deepseek-ai/cordis 实测）。
   */
  serial(event: string, ...args: unknown[]): Promise<unknown>
}
