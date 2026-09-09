/**
 * dsh-shared — HTTP helpers shared by plugin routes: bounded JSON body
 * reading and JSON responses. 由各插件 lib/http.js 抽取合并（issue #45），
 * 行为与抽取前逐字节一致。
 */

import type { ServerResponse } from './types.js'

/** Read a JSON request body (bounded). */
export async function readJsonBody(request: AsyncIterable<string>): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 1_000_000) throw new Error('request body too large')
  }
  if (body === '') return {}
  return JSON.parse(body) as Record<string, unknown>
}

export function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const payload = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-cache' })
  response.end(payload)
}

export function writeError(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  writeJson(response, 400, { ok: false, error: { message } })
}
