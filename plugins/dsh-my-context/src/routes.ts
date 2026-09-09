/**
 * dsh-my-context — /context/api routes.
 *
 * 所有请求先做 loopback 信任围栏（与 /api 网关一致的契约）。方法分派：
 *  - GET  /status                  — 状态 + 预算配置 + 溢出阈值配置
 *  - GET  /sessions                — 有统计的会话列表
 *  - GET  /session?sessionId=      — 会话统计详情（构成/请求/告警/溢出预警）
 *  - GET  /alerts?sessionId=       — 预算告警列表（最新在前）
 *  - GET  /overflows?sessionId=    — 上下文溢出预警列表（最新在前）
 *  - POST /budget                  — 更新预算配置（body { perTurn, perSession, mode }）
 *  - POST /overflow                — 更新溢出阈值（body { warnThreshold, alertThreshold }）
 */
import { isTrustedApiRequest, readJsonBody, writeError, writeJson } from 'dsh-shared'
import { normalizeBudgetConfig } from './budget.js'
import { normalizeOverflowConfig } from './overflow.js'
import type { DshContext, ServerRequest, ServerResponse } from './types.js'
import type { StoreType } from './events.js'

/** 注册 /context/api 路由（effect 持有 disposer）。 */
export function registerContextRoutes(
  ctx: DshContext,
  store: StoreType,
  options: {
    current: { perTurn: number; perSession: number; mode: 'warn' | 'deny' }
    overflow: { warnThreshold: number; alertThreshold: number }
  }
): void {
  const webRuntime = ctx.get ? ctx.get('webRuntime') : undefined
  const trustedHosts =
    webRuntime !== undefined && webRuntime !== null && Array.isArray((webRuntime as Record<string, unknown>).trustedHosts)
      ? (webRuntime as Record<string, unknown>).trustedHosts as string[]
      : []
  const fence = (request: ServerRequest) => isTrustedApiRequest(request, trustedHosts)

  ctx.effect(
    () =>
      ctx.webServer!.register({
        kind: 'prefix',
        path: '/context/api',
        handler: apiHandler(fence, store, options),
      }),
    'dsh-my-context: /context/api routes',
  )
}

/** 统一 handler：fence → 方法分派 → 404/错误兜底。 */
function apiHandler(
  fence: (request: ServerRequest) => boolean,
  store: StoreType,
  options: {
    current: { perTurn: number; perSession: number; mode: 'warn' | 'deny' }
    overflow: { warnThreshold: number; alertThreshold: number }
  }
): (request: ServerRequest, response: ServerResponse) => Promise<void> {
  return async (request: ServerRequest, response: ServerResponse) => {
    if (!fence(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const url = new URL(request.url ?? '/', 'http://dsh.internal')
    const pathname = url.pathname
    const method = pathname.startsWith('/context/api/') ? pathname.slice('/context/api/'.length) : undefined
    try {
      const handled = await dispatchMethod(method, request, response, url, store, options)
      if (!handled) {
        writeJson(response, 404, {
          ok: false,
          error: { message: 'unknown dsh-my-context API method' },
        })
      }
    } catch (error) {
      writeError(response, error)
    }
  }
}

/** 方法 + 请求动词匹配。 */
function isMethod(method: string | undefined, request: ServerRequest, name: string, verb: string): boolean {
  return method === name && request.method === verb
}

/** 按 method 分派到具体 handler；未识别返回 false（调用方回 404）。 */
async function dispatchMethod(
  method: string | undefined,
  request: ServerRequest,
  response: ServerResponse,
  url: URL,
  store: StoreType,
  options: {
    current: { perTurn: number; perSession: number; mode: 'warn' | 'deny' }
    overflow: { warnThreshold: number; alertThreshold: number }
  }
): Promise<boolean> {
  if (isMethod(method, request, 'status', 'GET')) {
    writeJson(response, 200, { ok: true, value: statusValue(store, options) })
    return true
  }
  if (isMethod(method, request, 'sessions', 'GET')) {
    writeJson(response, 200, { ok: true, value: store.sessions() })
    return true
  }
  if (isMethod(method, request, 'session', 'GET')) {
    await handleSession(response, store, queryOf(url, 'sessionId'))
    return true
  }
  if (isMethod(method, request, 'alerts', 'GET')) {
    writeJson(response, 200, { ok: true, value: alertsOf(store, queryOf(url, 'sessionId')) })
    return true
  }
  if (isMethod(method, request, 'overflows', 'GET')) {
    writeJson(response, 200, { ok: true, value: overflowsOf(store, queryOf(url, 'sessionId')) })
    return true
  }
  if (isMethod(method, request, 'budget', 'POST')) {
    await handleBudget(request, response, options)
    return true
  }
  if (isMethod(method, request, 'overflow', 'POST')) {
    await handleOverflow(request, response, options)
    return true
  }
  return false
}

// ── handlers ───────────────────────────────────────────────────────────────

/** 状态：会话数 + 预算配置 + 溢出阈值配置。 */
function statusValue(
  store: StoreType,
  options: {
    current: { perTurn: number; perSession: number; mode: 'warn' | 'deny' }
    overflow: { warnThreshold: number; alertThreshold: number }
  }
): {
  sessions: number
  budget: { perTurn: number; perSession: number; mode: 'warn' | 'deny' }
  overflow: { warnThreshold: number; alertThreshold: number }
} {
  return {
    sessions: store.sessions().length,
    budget: { ...options.current },
    overflow: { ...options.overflow },
  }
}

/** 会话统计详情：sessionId 缺失 400。 */
async function handleSession(response: ServerResponse, store: StoreType, sessionId: string): Promise<void> {
  if (sessionId === '') {
    writeJson(response, 400, { ok: false, error: { message: 'sessionId query param required' } })
    return
  }
  const session = store.session(sessionId)
  if (session === undefined) {
    writeJson(response, 404, { ok: false, error: { message: 'session not found' } })
    return
  }
  writeJson(response, 200, { ok: true, value: session })
}

/** 告警列表（最新在前）。 */
function alertsOf(store: StoreType, sessionId: string): unknown[] {
  const list = store.session(sessionId)?.alerts as unknown[] ?? []
  return [...list].reverse()
}

/** 溢出预警列表（最新在前）。 */
function overflowsOf(store: StoreType, sessionId: string): unknown[] {
  const list = store.session(sessionId)?.overflows as unknown[] ?? []
  return [...list].reverse()
}

/** 更新预算配置：body { perTurn, perSession, mode }（非法值回退默认）。 */
async function handleBudget(
  request: ServerRequest,
  response: ServerResponse,
  options: {
    current: { perTurn: number; perSession: number; mode: 'warn' | 'deny' }
    overflow: { warnThreshold: number; alertThreshold: number }
  }
): Promise<void> {
  const payload = await readJsonBody(request as unknown as AsyncIterable<string>)
  options.current = normalizeBudgetConfig(payload)
  writeJson(response, 200, { ok: true, value: { budget: { ...options.current } } })
}

/** 更新溢出阈值：body { warnThreshold, alertThreshold }（非法值回退默认）。 */
async function handleOverflow(
  request: ServerRequest,
  response: ServerResponse,
  options: {
    current: { perTurn: number; perSession: number; mode: 'warn' | 'deny' }
    overflow: { warnThreshold: number; alertThreshold: number }
  }
): Promise<void> {
  const payload = await readJsonBody(request as unknown as AsyncIterable<string>)
  options.overflow = normalizeOverflowConfig(payload)
  writeJson(response, 200, { ok: true, value: { overflow: { ...options.overflow } } })
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

function queryOf(url: URL, name: string): string {
  return url.searchParams.get(name) ?? ''
}