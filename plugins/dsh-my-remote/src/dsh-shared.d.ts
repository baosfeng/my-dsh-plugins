/**
 * dsh-shared 模块类型声明（最小契约，不安装 cordis 类型包）。
 */
declare module 'dsh-shared' {
  import type { ServerRequest, ServerResponse } from './types.js'

  /** 读取字符串型请求头（非字符串视为缺失）。 */
  export function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined

  /** 请求是否通过信任围栏（loopback 或受信权威 + 同源校验）。 */
  export function isTrustedApiRequest(request: ServerRequest, trustedHosts: string[]): boolean

  /** 读取 JSON 请求体（bounded）。 */
  export function readJsonBody(request: ServerRequest): Promise<unknown>

  /** 写 JSON 响应。 */
  export function writeJson(response: ServerResponse, status: number, value: unknown): void

  /** 写错误响应。 */
  export function writeError(response: ServerResponse, error: unknown): void

  /** 构造 user 角色消息。 */
  export function userMessage(text: string): Record<string, unknown>

  /** 超时包装。 */
  export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined>
}
