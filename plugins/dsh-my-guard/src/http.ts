/**
 * dsh-my-guard — HTTP helpers（/guard/api 请求解析 + 响应写法）。
 *
 * 抽出的原因：设置页配置端点（config-api.ts）与路由分派（routes.ts）都要
 * 同一套请求体解析与响应写法；各自留一份实现时，读法一旦分叉就可能把坏值
 * 写进 profile patch（本次设置页需求的核心风险）。
 */
import type { ServerRequest, ServerResponse } from './types.js'

/** 读取查询参数（缺失回空串）。 */
export function queryOf(url: URL, name: string): string {
  return url.searchParams.get(name) ?? ''
}

/** 解析 limit 查询参数（非正整数回 0 = 不限）。 */
export function limitOf(url: URL): number {
  const raw = url.searchParams.get('limit')
  const parsed = raw === null ? 0 : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** 读取 JSON 请求体。 */
export async function readJsonBody(request: ServerRequest): Promise<Record<string, unknown>> {
  const chunks: string[] = []
  const req = request as unknown as {
    [key: string]: unknown
    [Symbol.asyncIterator]?: () => AsyncIterator<string>
    on?: (event: string, handler: (chunk: Buffer) => void) => void
  }
  // 支持 async iterator（测试 mock）或 Node.js 可读流
  if (typeof req[Symbol.asyncIterator] === 'function') {
    const iterator = req[Symbol.asyncIterator]!()
    let result = await iterator.next()
    while (!result.done) {
      chunks.push(typeof result.value === 'string' ? result.value : String(result.value))
      result = await iterator.next()
    }
  } else if (typeof req.on === 'function') {
    await new Promise<void>((resolve, reject) => {
      const buffers: Buffer[] = []
      req.on!.call(req, 'data', (chunk: Buffer) => buffers.push(chunk))
      req.on!.call(req, 'end', () => {
        chunks.push(Buffer.concat(buffers).toString('utf8'))
        resolve()
      })
      req.on!.call(req, 'error', reject)
    })
  }
  const body = chunks.join('')
  return body ? JSON.parse(body) : {}
}

/** 写 JSON 响应。 */
export function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

/** 写错误响应。 */
export function writeError(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  writeJson(response, 500, { ok: false, error: { message } })
}
