/**
 * /file-activity/api route handler: record (POST), stats (GET), clear (POST).
 * Every request passes the trust fence first; responses are JSON with
 * cache-control: no-cache.
 */
import { readJsonBody, writeError, writeJson } from 'dsh-shared'
import { sessionCwdOf } from './cwd.js'
import { mapOp } from './state.js'
import type { ActivityStore, Counters, DshContext, ServerRequest, ServerResponse } from './types.js'

/** createApiHandler 的依赖：ctx + store + 信任围栏。 */
export interface ApiHandlerOptions {
  ctx: DshContext
  store: ActivityStore
  fence: (request: ServerRequest) => boolean
}

export function createApiHandler({
  ctx,
  store,
  fence,
}: ApiHandlerOptions): (request: ServerRequest, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (!fence(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const url = new URL(request.url ?? '/', 'http://dsh.internal')
    const method = apiMethodOf(url)
    try {
      if (method === 'record' && request.method === 'POST') {
        await handleRecord(store, request, response)
        return
      }
      if (method === 'stats' && request.method === 'GET') {
        handleStats(ctx, store, url, response)
        return
      }
      if (method === 'clear' && request.method === 'POST') {
        await handleClear(store, request, response)
        return
      }
      writeJson(response, 404, {
        ok: false,
        error: { message: 'unknown file-activity API method' },
      })
    } catch (error) {
      writeError(response, error)
    }
  }
}

/** Strip the /file-activity/api/ prefix; undefined for anything else. */
function apiMethodOf(url: URL): string | undefined {
  const pathname = url.pathname
  return pathname.startsWith('/file-activity/api/') ? pathname.slice('/file-activity/api/'.length) : undefined
}

/** POST /file-activity/api/record — client-reported sidebar operation. */
async function handleRecord(store: ActivityStore, request: ServerRequest, response: ServerResponse): Promise<void> {
  const payload = await readJsonBody(request)
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
  const path = typeof payload.path === 'string' ? payload.path : ''
  const op = typeof payload.op === 'string' ? payload.op : 'read'
  store.record(sessionId, path, mapOp(op), Date.now())
  writeJson(response, 200, { ok: true })
}

/** GET /file-activity/api/stats — recent + counts + session cwd. */
function handleStats(ctx: DshContext, store: ActivityStore, url: URL, response: ServerResponse): void {
  const sessionId = url.searchParams.get('sessionId') ?? ''
  // Session working directory, for client-side relative-path display.
  const cwd = sessionCwdOf(ctx, sessionId)
  const session = store.state.sessions[sessionId]
  if (session === undefined) {
    writeJson(response, 200, { ok: true, value: { recent: [], counts: {}, cwd } })
    return
  }
  // Snapshot the leaf fields only — no live objects cross the wire.
  const recent = session.recent.map((entry) => ({
    path: entry.path,
    op: entry.op,
    time: entry.time,
  }))
  const counts: Record<string, Counters> = {}
  for (const [path, counter] of Object.entries(session.counts)) {
    counts[path] = {
      read: counter.read,
      create: counter.create,
      modify: counter.modify,
      firstSeen: counter.firstSeen,
      lastSeen: counter.lastSeen,
    }
  }
  writeJson(response, 200, { ok: true, value: { recent, counts, cwd } })
}

/** POST /file-activity/api/clear — wipe one session's records (persisted). */
async function handleClear(store: ActivityStore, request: ServerRequest, response: ServerResponse): Promise<void> {
  const payload = await readJsonBody(request)
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
  if (sessionId !== '' && store.state.sessions[sessionId] !== undefined) {
    delete store.state.sessions[sessionId]
    store.schedulePersist()
  }
  writeJson(response, 200, { ok: true })
}
