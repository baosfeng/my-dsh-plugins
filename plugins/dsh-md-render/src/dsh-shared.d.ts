/**
 * dsh-shared 模块类型声明（最小契约）。
 *
 * dsh-shared 尚未发布 TS 类型；本文件声明插件实际使用的导出，
 * 避免 `Could not find a declaration file for module 'dsh-shared'`。
 */
declare module 'dsh-shared' {
  /** 获取当前 profile 名。 */
  export function currentProfile(): string

  /** 获取指定 profile 的 patch 文件路径。 */
  export function patchFileOf(profile: string): string

  /** 写入配置到 patch 文件（持久化）。 */
  export function writePatchConfig(filePath: string, id: string, config: Record<string, unknown>): Promise<void>

  /** 判断请求是否来自受信来源（loopback 信任围栏）。 */
  export function isTrustedApiRequest(
    request: { headers: Record<string, string | string[] | undefined> },
    trustedHosts: string[],
  ): boolean

  /** 读取请求 JSON body。 */
  export function readJsonBody(request: {
    url?: string
    method?: string
    headers: Record<string, string | string[] | undefined>
  }): Promise<unknown>

  /** 写 JSON 响应。 */
  export function writeJson(
    response: { writeHead(status: number, headers?: Record<string, string>): void; end(chunk?: string): void },
    status: number,
    body: unknown,
  ): void

  /** 写错误响应。 */
  export function writeError(
    response: { writeHead(status: number, headers?: Record<string, string>): void; end(chunk?: string): void },
    error: Error,
  ): void

  /** 从 patch 文本中提取指定 id 的配置。 */
  export function extractConfig(patchText: string, id: string): Record<string, unknown> | null
}
