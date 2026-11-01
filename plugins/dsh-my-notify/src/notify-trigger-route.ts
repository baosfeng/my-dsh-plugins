/**
 * dsh-my-notify — 远程触发路由（POST /notify/api/trigger）。
 *
 * 拆分自原 routes.ts（文件尺寸门禁）：任意本机进程（或经反向代理 + 配置
 * apiToken 的远程服务）触发一条 `kind: remote` 通知，与内建触发共用同一条
 * SSE 广播通道。用户显式给出的 title / body 优先于 messages.remote 模板。
 */
import { header, readJsonBody, writeJson } from 'dsh-shared'
import { sessionUrlOf } from './listeners.js'
import type { NoticeFrame, NotifyOptions, ServerRequest, ServerResponse } from './types.js'

/** 远程 hook：apiToken 校验 + JSON body → 广播 remote 通知。 */
export async function handleTrigger(
  request: ServerRequest,
  response: ServerResponse,
  options: NotifyOptions,
  emitNotice: (notice: NoticeFrame) => void,
): Promise<void> {
  if (!isAuthorized(request, options)) {
    writeJson(response, 403, {
      ok: false,
      error: { code: 'forbidden', message: 'invalid x-notify-token' },
    })
    return
  }
  const payload = await readJsonBody(request as unknown as AsyncIterable<string>)
  emitNotice(remoteNotice(payload, options))
  writeJson(response, 200, { ok: true })
}

/** apiToken 校验：未配置 token 时放行；配置后要求 x-notify-token 一致。 */
function isAuthorized(request: ServerRequest, options: NotifyOptions): boolean {
  if (options.apiToken === '') return true
  return header(request.headers, 'x-notify-token') === options.apiToken
}

/** 构造 remote 通知帧（显式 title / body 标记 preserve，不被模板覆盖）。 */
function remoteNotice(payload: Record<string, unknown>, options: NotifyOptions): NoticeFrame {
  const title = typeof payload.title === 'string' ? payload.title : ''
  const body = typeof payload.body === 'string' ? payload.body : ''
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
  return {
    kind: 'remote',
    sessionId,
    title,
    note: body,
    // 远程触发同样带会话链接（卡片「查看会话」按钮依赖它）
    sessionUrl: sessionUrlOf(sessionId, options.webBaseUrl),
    preserve: preserveOf(title, body),
  }
}

/** 显式字段列表：非空才标记 preserve（用户显式值优先于模板）。 */
function preserveOf(title: string, body: string): Array<'title' | 'note'> {
  const preserve: Array<'title' | 'note'> = []
  if (title !== '') preserve.push('title')
  if (body !== '') preserve.push('note')
  return preserve
}
