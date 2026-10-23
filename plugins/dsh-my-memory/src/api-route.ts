/**
 * dsh-my-memory — /my-memory/api route handler.
 *
 *  - GET  /my-memory/api/memory?scope=global|project&cwd=… → the memory
 *    items of one scope (read-only; project scope resolves the project root
 *    from cwd);
 *  - GET  /my-memory/api/session?sessionId=… → the session's working
 *    directory ('' when the session has none) — the settings panel uses it
 *    to auto-load the current project's memory on open (issue #104), the
 *    same session-cwd resolution as the memory_query tool;
 *  - POST /my-memory/api/memory → a write operation (add / update / delete).
 *    Every write MUST carry `confirmed: true` — the user-consent marker the
 *    settings panel sets only after its custom confirmation UI (delete is
 *    red, save is green). A write without the marker is refused with 400:
 *    memory must never change silently.
 *  - GET  /my-memory/api/config → the entry-length guidance the settings
 *    panel uses for concise-input hints (`maxEntryLength`, `maxDescLength`,
 *    issue #105). Writes keep the FULL desc in storage — the panel and the
 *    injection summarize for display only.
 *
 * Every request passes the trust fence first; responses are JSON with
 * cache-control: no-cache.
 */
import { readJsonBody, writeError, writeJson } from 'dsh-shared'
import { findProjectRoot } from 'dsh-shared'
import { routePrompts } from './prompts-route.js'
import { DEFAULT_MAX_DESC_LENGTH, DEFAULT_MAX_ENTRY_LENGTH } from './memory-text.js'
import type { StoreInstance } from './memory-types.js'
import type {
  ApiConfig,
  ApiHandlerParams,
  ApplyWriteResult,
  FenceFunction,
  LoggerService,
  RouteRequestParams,
  ServerRequest,
  ServerResponse,
  SessionsService,
  WriteGateResult,
  WritePayload,
} from './api-route.types.js'

/** The cwd query parameter, normalized to undefined when absent. */
function cwdOf(url: URL): string | undefined {
  const cwd = url.searchParams.get('cwd') ?? ''
  return cwd !== '' ? cwd : undefined
}

export function createApiHandler({
  globalStore,
  getProjectStore,
  promptsStore,
  fence,
  sessions,
  config,
  logger,
}: ApiHandlerParams): (request: ServerRequest, response: ServerResponse) => Promise<void> {
  return async (request: ServerRequest, response: ServerResponse): Promise<void> => {
    if (!fence(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const url = new URL(request.url ?? '/', 'http://dsh.internal')
    try {
      await routeRequest(url, request, response, {
        globalStore,
        getProjectStore,
        promptsStore,
        sessions,
        config,
        logger,
      })
    } catch (error) {
      writeError(response, error)
    }
  }
}

/** Dispatch one request to the matching handler by path + method. */
async function routeRequest(
  url: URL,
  request: ServerRequest,
  response: ServerResponse,
  { globalStore, getProjectStore, promptsStore, sessions, config, logger }: RouteRequestParams,
): Promise<void> {
  // 提示词是**独立端点**（不复用 /memory）；分派在自己的模块里，与记忆分支无耦合。
  if (await routePrompts(url, request, response, { promptsStore, logger })) return
  if (url.pathname.endsWith('/config') && request.method === 'GET') {
    handleConfig(config, response)
    return
  }
  if (url.pathname.endsWith('/session') && request.method === 'GET') {
    await handleSession(sessions, url, response)
    return
  }
  if (url.pathname.endsWith('/memory') && request.method === 'GET') {
    await handleList(url, response, globalStore, getProjectStore)
    return
  }
  if (url.pathname.endsWith('/memory') && request.method === 'POST') {
    await handleWrite(request, response, globalStore, getProjectStore, logger)
    return
  }
  writeJson(response, 404, { ok: false, error: { message: 'unknown my-memory API method' } })
}

/** GET /config — the entry-length guidance for the panel (issue #105). */
function handleConfig(config: ApiConfig | undefined, response: ServerResponse): void {
  writeJson(response, 200, {
    ok: true,
    value: {
      maxEntryLength: config?.maxEntryLength ?? DEFAULT_MAX_ENTRY_LENGTH,
      maxDescLength: config?.maxDescLength ?? DEFAULT_MAX_DESC_LENGTH,
    },
  })
}

/** GET /session — the session's working directory ('' when none). The settings
 *  panel auto-loads the current project memory from it (issue #104), the same
 *  session-cwd resolution the memory_query tool uses. */
async function handleSession(sessions: SessionsService | undefined, url: URL, response: ServerResponse): Promise<void> {
  const sessionId = url.searchParams.get('sessionId')
  const session = typeof sessionId === 'string' && sessionId !== '' ? sessions?.get(sessionId) : undefined
  const cwd = session?.header?.cwd
  writeJson(response, 200, { ok: true, value: { cwd: typeof cwd === 'string' && cwd !== '' ? cwd : '' } })
}

/** GET /memory — one scope's items (global, or project resolved from cwd). */
async function handleList(
  url: URL,
  response: ServerResponse,
  globalStore: StoreInstance,
  getProjectStore: (cwd: string) => Promise<StoreInstance>,
): Promise<void> {
  const scope = url.searchParams.get('scope') ?? 'global'
  const cwd = cwdOf(url)
  if (scope !== 'global' && scope !== 'project') {
    writeJson(response, 400, {
      ok: false,
      error: { message: 'scope must be "global" or "project"' },
    })
    return
  }
  if (scope === 'project' && cwd === undefined) {
    writeJson(response, 400, { ok: false, error: { message: 'project scope requires a cwd' } })
    return
  }
  const store = scope === 'global' ? globalStore : await getProjectStore(cwd!)
  const projectRoot = scope === 'project' ? await findProjectRoot(cwd!) : ''
  writeJson(response, 200, {
    ok: true,
    value: { scope, cwd: cwd ?? '', projectRoot, items: store.list() },
  })
}

/** POST /memory — add / update / delete, gated on the user-consent marker. */
async function handleWrite(
  request: ServerRequest,
  response: ServerResponse,
  globalStore: StoreInstance,
  getProjectStore: (cwd: string) => Promise<StoreInstance>,
  logger?: LoggerService,
): Promise<void> {
  const payload = await readJsonBody(request)
  const gate = writeGate(payload)
  if (gate !== null) {
    writeJson(response, gate.status, { ok: false, error: { message: gate.message } })
    return
  }
  const store =
    payload.scope === 'global' ? globalStore : await getProjectStore(typeof payload.cwd === 'string' ? payload.cwd : '')
  const outcome = await applyWrite(store, payload)
  if (outcome !== null) {
    writeJson(response, outcome.status, { ok: false, error: { message: outcome.message } })
    return
  }
  logger?.info(
    `[dsh-my-memory] API 写操作完成（action=${payload.action}，scope=${payload.scope}，itemId=${payload.id ?? ''}）`,
  )
  writeJson(response, 200, { ok: true, value: { items: store.list() } })
}

/** Validate the write payload; returns a rejection or null when it passes. */
function writeGate(payload: WritePayload): WriteGateResult | null {
  if (payload.confirmed !== true) {
    return { status: 400, message: 'write requires confirmed: true (user consent)' }
  }
  if (payload.scope !== 'global' && payload.scope !== 'project') {
    return { status: 400, message: 'scope must be "global" or "project"' }
  }
  const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : undefined
  if (payload.scope === 'project' && cwd === undefined) {
    return { status: 400, message: 'project scope requires a cwd' }
  }
  payload.cwd = cwd
  return null
}

/** Apply one write action to a store; returns a rejection or null on success. */
async function applyWrite(store: StoreInstance, payload: WritePayload): Promise<ApplyWriteResult | null> {
  if (payload.action === 'add') return applyAdd(store, payload)
  if (payload.action === 'update') return applyUpdate(store, payload)
  if (payload.action === 'delete') return applyDelete(store, payload)
  return { status: 400, message: 'action must be "add", "update" or "delete"' }
}

/** Add one memory item (desc required). */
async function applyAdd(store: StoreInstance, payload: WritePayload): Promise<ApplyWriteResult | null> {
  const desc = typeof payload.desc === 'string' ? payload.desc.trim() : ''
  if (desc === '') return { status: 400, message: 'add requires a non-empty desc' }
  await store.add(desc)
  return null
}

/** Update one memory item (id + desc required). */
async function applyUpdate(store: StoreInstance, payload: WritePayload): Promise<ApplyWriteResult | null> {
  const id = typeof payload.id === 'string' ? payload.id : ''
  const desc = typeof payload.desc === 'string' ? payload.desc.trim() : ''
  if (id === '' || desc === '') return { status: 400, message: 'update requires id and a non-empty desc' }
  if ((await store.update(id, desc)) === null) return { status: 404, message: 'memory item not found' }
  return null
}

/** Delete one memory item (id required). */
async function applyDelete(store: StoreInstance, payload: WritePayload): Promise<ApplyWriteResult | null> {
  const id = typeof payload.id === 'string' ? payload.id : ''
  if (id === '') return { status: 400, message: 'delete requires an id' }
  if (!(await store.remove(id))) return { status: 404, message: 'memory item not found' }
  return null
}
