/**
 * dsh-think-zh-expand — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（systemPrompt.section /
 * 可选 get（webServer）/ effect）。
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
   * 可选取服务：**不**声明 inject（缺服务时返回 undefined 或抛错，
   * 由调用方兜底）——非 web profile 下不能因为缺 webServer 而 apply 失败。
   */
  get?: <T>(name: string) => T | undefined
  /** 可选 effect（资源随 fiber teardown 卸载）。 */
  effect?: (callback: () => void | (() => void), label?: string) => void
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
