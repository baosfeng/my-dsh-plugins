/**
 * dsh-my-remote — /remote/api 路由（远程指令入站 + 状态/审计查询 + 设置页端点）。
 *
 * 所有请求先做 loopback 信任围栏（dsh-shared isTrustedApiRequest，与 /api
 * 网关一致的契约；配置 apiToken 后 command 写操作额外要求 x-remote-token
 * 头，供经反向代理/中转服务的远程调用）。
 *
 * 端点：
 *  - GET  /remote/api/info     — 插件开关（apiToken 是否启用等，不暴露值）
 *  - GET  /remote/api/status   — 状态快照（活动会话 / pending ask / approval）
 *  - GET  /remote/api/audit    — 操作审计日志（远程控制操作留痕）
 *  - POST /remote/api/command  — 远程指令统一入口（answer/approve/continue，
 *    指令白名单见 commands.js）
 *  - GET  /remote/api/settings — 设置页读当前配置（apiToken 只回是否已配置）
 *  - PUT  /remote/api/settings — 设置页保存（写回 profile patch + 立即热生效）
 *
 * 安全：fence（loopback）→ token（写操作）→ 白名单（commands.js）→ 审计。
 * token 失败也记审计（溯源：未知来源的尝试同样留痕）。
 *
 * **注册契约**（issue #385；真实环境「路由恒 404」的修复依据）：
 *  1. 经 `ctx.root.inject(['webServer'], cb)` **局部等待**服务，不用
 *     `ctx.get('webServer')` 一次性取值 —— cordis 的 get 带严格就绪检查
 *     （provider fiber 非 ACTIVE 即 undefined）且**没有重试**，webServer 晚于本插件
 *     就绪时永久错过，路由从未注册 → 404。
 *  2. 注册承载在**常驻 root**（`ctx.root ?? ctx`）上 —— profile 插件自身 fiber 在
 *     apply 结束后被 loader 回收，挂在它上面的 `ctx.effect` 会一并注销（路由消失）。
 *  3. 以 root 为键去重：root 常驻意味着上一轮注册不会自动消失，而宿主
 *     `WebServer.register` 对重复 (kind, path) 直接抛错 → 先撤上一轮再注册。
 */
import { isTrustedApiRequest, header, readJsonBody, writeJson, writeError } from 'dsh-shared'
import { processCommand, statusSnapshot } from './commands.js'
import { SETTINGS_ROUTE_PREFIX, createSettingsHandler } from './settings.js'
import type { SettingsPort } from './settings.js'
import type { DshContext, ServerRequest, ServerResponse, SharedContext, WebServerService } from './types.js'

/** 既有远程指令路由路径（命令/状态/审计）。 */
const API_ROUTE_PATH = '/remote/api'

/** 已注册路由的 disposer（以常驻 root ctx 为键，用于重复 apply 去重）。 */
const routeDisposers = new WeakMap<object, Array<() => void>>()

/** 从 ctx / scope 取 webServer（晚就绪时为 undefined，由 inject 回调重入保证可用）。 */
function webServerOf(source: { webServer?: WebServerService }): WebServerService | undefined {
  return source.webServer
}

/** 挂载两条路由（既有 /remote/api + 新 /remote/api/settings）；已注册过先撤。 */
function mountRoutes(hostCtx: object, scope: DshContext, shared: SharedContext, port: SettingsPort): void {
  for (const dispose of routeDisposers.get(hostCtx) ?? []) dispose()
  scope.effect(() => {
    const webServer = webServerOf(scope)
    if (webServer === undefined) return undefined
    const registered = [
      webServer.register({ kind: 'prefix', path: API_ROUTE_PATH, handler: apiHandler(fenceOf(shared), shared) }),
      webServer.register({ kind: 'prefix', path: SETTINGS_ROUTE_PREFIX, handler: createSettingsHandler(port) }),
    ]
    routeDisposers.set(hostCtx, registered)
    // 关键：effect 回调必须**返回** disposer（返回 undefined = 去掉副作用注册）。
    return () => {
      if (routeDisposers.get(hostCtx) === registered) routeDisposers.delete(hostCtx)
      for (const dispose of registered) dispose()
    }
  }, 'dsh-my-remote: /remote/api routes')
}

/** 注册 /remote/api 路由（含设置页端点）；无 webServer 的 profile 下不注册。 */
export function registerRemoteRoutes(ctx: DshContext, shared: SharedContext, port: SettingsPort): void {
  const hostCtx = ctx.root ?? ctx
  if (typeof hostCtx.inject !== 'function') {
    // 极简 / 老宿主 ctx 没有 inject：降级为直接注册（webServer 已就绪时照常工作）。
    mountRoutes(hostCtx, ctx, shared, port)
    return
  }
  try {
    hostCtx.inject(['webServer'], (scope) => mountRoutes(hostCtx, scope as unknown as DshContext, shared, port))
  } catch (error) {
    // inactive ctx 上建 inject 子 fiber 可能抛错：降级为直接注册，绝不 fatal。
    ctx.logger?.warn(`[dsh-my-remote] webServer 局部注入失败，尝试直接注册路由：${String(error)}`)
    mountRoutes(hostCtx, ctx, shared, port)
  }
}

/** 信任围栏：loopback 或 webRuntime.trustedHosts 配置的受信权威。 */
function fenceOf(shared: SharedContext): (request: ServerRequest) => boolean {
  const webRuntime = shared.ctx.get?.('webRuntime') as { trustedHosts?: string[] } | undefined
  const trustedHosts =
    webRuntime !== undefined && webRuntime !== null && Array.isArray(webRuntime.trustedHosts)
      ? webRuntime.trustedHosts
      : []
  return (request: ServerRequest) => isTrustedApiRequest(request, trustedHosts)
}

/** 统一 handler：fence → 方法/动词分派 → 404/异常兜底。 */
function apiHandler(fence: (request: ServerRequest) => boolean, shared: SharedContext) {
  return async (request: ServerRequest, response: ServerResponse) => {
    if (!fence(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const url = new URL(request.url ?? '/', 'http://dsh.internal')
    const pathname = url.pathname
    const method = pathname.startsWith('/remote/api/') ? pathname.slice('/remote/api/'.length) : undefined
    try {
      const handled = await dispatchMethod(method, request, response, shared)
      if (!handled) {
        writeJson(response, 404, {
          ok: false,
          error: { message: 'unknown dsh-my-remote API method' },
        })
      }
    } catch (error) {
      writeError(response, error)
    }
  }
}

/** 按 method + 请求动词分派到具体 handler；未识别返回 false。 */
async function dispatchMethod(
  method: string | undefined,
  request: ServerRequest,
  response: ServerResponse,
  shared: SharedContext,
): Promise<boolean> {
  if (method === undefined) return false
  if (request.method === 'GET') return dispatchGet(method, response, shared)
  if (request.method === 'POST' && method === 'command') {
    await handleCommand(request, response, shared)
    return true
  }
  return false
}

/** GET 端点分派（info/status/audit）。 */
function dispatchGet(method: string, response: ServerResponse, shared: SharedContext): boolean {
  if (method === 'info') {
    writeJson(response, 200, { ok: true, value: infoValue(shared) })
    return true
  }
  if (method === 'status') {
    writeJson(response, 200, { ok: true, value: statusSnapshot(shared) })
    return true
  }
  if (method === 'audit') {
    writeJson(response, 200, { ok: true, value: { entries: shared.audit.list() } })
    return true
  }
  return false
}

/** 插件信息：开关 + apiToken 是否启用（绝不暴露值）。 */
function infoValue(shared: SharedContext): Record<string, unknown> {
  return {
    end: shared.options.end,
    ask: shared.options.ask,
    approval: shared.options.approval,
    apiToken: shared.options.apiToken !== '',
    webhooks: (shared.options.webhooks ?? []).length,
    askTimeoutMs: shared.options.askTimeoutMs,
    approvalTimeoutMs: shared.options.approvalTimeoutMs,
  }
}

/** 远程指令：token 校验 → 读取 body → 指令处理（含审计）。 */
async function handleCommand(request: ServerRequest, response: ServerResponse, shared: SharedContext): Promise<void> {
  const token = header(request.headers, 'x-remote-token')
  if (shared.options.apiToken !== '' && token !== shared.options.apiToken) {
    shared.audit.record({
      action: 'command',
      sessionId: '',
      source: sourceOf(request),
      ok: false,
      detail: 'invalid x-remote-token',
    })
    writeJson(response, 403, {
      ok: false,
      error: { code: 'forbidden', message: 'invalid x-remote-token' },
    })
    return
  }
  let body: Record<string, unknown>
  try {
    body = (await readJsonBody(request)) as Record<string, unknown>
  } catch {
    shared.audit.record({ action: 'command', source: sourceOf(request), ok: false, detail: 'invalid json body' })
    writeJson(response, 400, { ok: false, error: { message: 'invalid json body' } })
    return
  }
  const result = processCommand(shared, typeof body?.action === 'string' ? body.action : '', body ?? {}, {
    time: Date.now(),
    source: sourceOf(request),
  })
  if (!result.ok) {
    writeJson(response, 400, { ok: false, error: { message: result.error } })
    return
  }
  writeJson(response, 200, { ok: true, value: result.result })
}

/** 审计来源：x-forwarded-for 优先（经代理时真实客户端），回退 'local'。 */
function sourceOf(request: ServerRequest): string {
  const forwarded = header(request.headers, 'x-forwarded-for')
  if (forwarded !== undefined && forwarded !== '') return forwarded.split(',')[0].trim()
  return 'local'
}
