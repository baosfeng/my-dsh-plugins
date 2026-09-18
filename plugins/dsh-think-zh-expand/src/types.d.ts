/**
 * dsh-think-zh-expand — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（systemPrompt.section / root /
 * inject（局部等待服务）/ effect）。
 * DSH 运行时模块（cordis / systemPrompt）由宿主提供，本声明是插件与运行时
 * 之间的类型契约——新 TS 插件照抄本文件，按需扩展。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** systemPrompt 服务（inject 声明后可用）。 */
  systemPrompt: SystemPromptService
  /** 可选 logger（日志输出）。 */
  logger?: Logger
  /**
   * 常驻 root ctx（cordis `src/context.ts` 的 `ctx.root`，与宿主同生命周期）。
   * profile 插件自身的 fiber 在 apply 结束后会被 loader 回收，其上的 effect
   * 随之注销；需要长期存活的注册（如 HTTP 路由）必须挂 root。
   */
  root?: DshContext
  /**
   * 局部等待服务就绪：deps 全部就绪才执行 callback（**服务晚到也补执行**），
   * 始终缺失则 callback 不执行且不抛错 —— 故无该服务的 profile（tui/headless）
   * 下只是不注册，不影响插件其它能力。
   *
   * 不要用 `ctx.get(name)` 一次性取服务代替它：cordis 的 get 带严格就绪检查
   * （provider fiber 非 ACTIVE 即返回 undefined）且没有重试，服务晚到就永久错过。
   */
  inject: (names: readonly string[], callback: (scope: DshContext) => void) => unknown
  /** effect：disposer 随**当前 ctx 所属 fiber** 释放而执行（cordis 的 ctx 一定提供）。 */
  effect: (callback: () => void | (() => void), label?: string) => void
  /** webServer 服务：经 `ctx.inject(['webServer'], cb)` 的 scope 上可用。 */
  webServer?: WebServerService
}

/** DSH webServer 服务（HTTP 路由注册；issue #355 配置读取通道）。 */
export interface WebServerService {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** HTTP 请求最小契约（node http IncomingMessage 的子集）。 */
export interface ServerRequest {
  method?: string
  url?: string
  headers?: unknown
}

/** HTTP 响应最小契约（node http ServerResponse 的子集）。 */
export interface ServerResponse {
  writeHead(status: number, headers: Record<string, string>): void
  end(payload?: string): void
}

/** systemPrompt 服务（system-prompt section 注册）。 */
export interface SystemPromptService {
  section(options: { name: string; order?: number; text: string }): () => void
}

/** DSH logger（可选）。 */
export interface Logger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}
