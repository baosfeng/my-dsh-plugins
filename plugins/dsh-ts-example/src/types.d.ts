/**
 * dsh-ts-example — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（on / effect / get / webServer）。
 * DSH 运行时模块（cordis / webServer）由宿主提供，本声明是插件与运行时
 * 之间的类型契约——新 TS 插件照抄本文件，按需扩展。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** Cordis 事件监听器（DSH 事件如 session/start、agent/status）。 */
export type EventHandler = (...args: unknown[]) => void

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /**
   * 监听 DSH 事件；返回 disposer。
   * @param options - cordis 监听器选项；\`global: true\` 跳过 scope 过滤（跨 scope 观察宿主事件的必要条件）。
   */
  on(event: string, handler: EventHandler, options?: { global?: boolean }): () => void
  /**
   * cordis 根 Context（常驻）。
   *
   * ⚠️ 教学要点（issue #242 实测）：profile 插件的 fiber 会被 loader 回收，
   * 注册在插件自身 ctx 上的监听器/路由会随之**静默消失**（无报错）。注册必须
   * 挂到本 ctx。未提供该字段的旧宿主退回插件自身 ctx。
   */
  root?: DshContext
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 读取可选服务（未加载返回 undefined）。 */
  get<T>(name: string): T | undefined
  /** webServer 服务（inject 声明后可用）。 */
  webServer?: WebServerService
}

/** webServer 服务（HTTP 路由注册）。 */
export interface WebServerService {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void
  }): () => void
}

/** DSH HTTP 请求（node:http IncomingMessage 的最小契约）。 */
export interface ServerRequest {
  url?: string
  headers: Record<string, string | string[] | undefined>
}

/** DSH HTTP 响应（node:http ServerResponse 的最小契约）。 */
export interface ServerResponse {
  writeHead(statusCode: number, headers?: Record<string, string>): void
  end(chunk?: string): void
}
