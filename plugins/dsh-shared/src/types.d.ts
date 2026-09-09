/**
 * dsh-shared — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：本库是纯工具库，不依赖 DSH 运行时。
 * 仅声明 HTTP 相关的最小类型（node:http IncomingMessage/ServerResponse 的子集）。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** HTTP 请求头（node:http IncomingMessage.headers 的最小契约）。 */
export interface IncomingHeaders {
  [header: string]: string | string[] | undefined
}

/** HTTP 请求（node:http IncomingMessage 的最小契约）。 */
export interface IncomingRequest {
  url?: string
  headers: IncomingHeaders
}

/** HTTP 响应（node:http ServerResponse 的最小契约）。 */
export interface ServerResponse {
  writeHead(statusCode: number, headers?: Record<string, string | number | readonly string[]>): void
  end(chunk?: string): void
}

/** 可序列化的 JSON 值。 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** 日志器接口（仅 warn，与实际使用一致）。 */
export interface Logger {
  warn(message: string): void
}

/** 配置对象（YAML 子集可解析的值类型）。 */
export type ConfigValue = string | number | boolean | null | ConfigValue[]

/** 配置字典。 */
export interface ConfigDict {
  [key: string]: ConfigValue
}
