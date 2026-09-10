/**
 * dsh-my-guard — /guard/api routes.
 *
 * 所有请求先做 loopback 信任围栏（与 /api 网关一致的契约）。方法分派：
 *  - GET  /status                  — 状态 + 护栏配置
 *  - GET  /alerts?sessionId&type&limit — 告警列表（最新在前）
 *  - POST /scan                    — 投毒扫描（body { target: 包名或路径 }）
 *  - POST /scan-prompt             — 提示注入检测（body { text }）
 *  - POST /alerts/confirm          — 确认告警（body { id }，用户确认机制）
 */
import { resolveAndScan, localPathOf } from './poison.js'
import { detectPromptInjection } from './injection.js'
import { DESTRUCTIVE_PATTERNS } from './constants.js'
import { decideDestructive, rawRulesOf } from './custom-rules.js'
import type {
  DshContext,
  ServerRequest,
  ServerResponse,
  AlertStore,
  GuardOptions,
  SaveConfigPayload,
  SaveConfigResult,
} from './types.js'

/** 配置保存控制接口。 */
interface SaveControl {
  saveConfig?: (next: SaveConfigPayload) => Promise<SaveConfigResult>
}

/** 注册 /guard/api 路由（effect 持有 disposer）。 */
export function registerGuardRoutes(
  ctx: DshContext,
  store: AlertStore,
  options: GuardOptions,
  control?: SaveControl,
): void {
  const webRuntime = ctx.get ? ctx.get<{ trustedHosts?: string[] }>('webRuntime') : undefined
  const trustedHosts =
    webRuntime !== undefined && webRuntime !== null && Array.isArray(webRuntime.trustedHosts)
      ? webRuntime.trustedHosts
      : []
  const fence = (request: ServerRequest) => isTrustedApiRequest(request, trustedHosts)

  ctx.effect(
    () =>
      ctx.webServer?.register({
        kind: 'prefix',
        path: '/guard/api',
        handler: apiHandler(fence, store, options, control),
      }) ?? (() => {}),
    'dsh-my-guard: /guard/api routes',
  )
}

/** 信任围栏检查（loopback / trustedHosts / sec-fetch-site）。 */
function isTrustedApiRequest(request: ServerRequest, trustedHosts: string[]): boolean {
  // 拒绝跨站请求（sec-fetch-site: cross-site）
  const secFetchSite = request.headers['sec-fetch-site']
  if (secFetchSite === 'cross-site') return false

  const host = request.headers.host
  if (typeof host !== 'string') return false
  try {
    const hostname = new URL(`http://${host}`).hostname
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true
    return trustedHosts.includes(hostname)
  } catch {
    return false
  }
}

/** 统一 handler：fence → 方法分派 → 404/错误兜底。 */
function apiHandler(
  fence: (request: ServerRequest) => boolean,
  store: AlertStore,
  options: GuardOptions,
  control?: SaveControl,
) {
  return async (request: ServerRequest, response: ServerResponse): Promise<void> => {
    if (!fence(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const url = new URL(request.url ?? '/', 'http://dsh.internal')
    const pathname = url.pathname
    const method = pathname.startsWith('/guard/api/') ? pathname.slice('/guard/api/'.length) : undefined
    try {
      const handled = await dispatchMethod(method, request, response, url, store, options, control)
      if (!handled) {
        writeJson(response, 404, {
          ok: false,
          error: { message: 'unknown dsh-my-guard API method' },
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
  store: AlertStore,
  options: GuardOptions,
  control?: SaveControl,
): Promise<boolean> {
  if (isMethod(method, request, 'status', 'GET')) {
    writeJson(response, 200, { ok: true, value: statusValue(store, options) })
    return true
  }
  if (isMethod(method, request, 'alerts', 'GET')) {
    writeJson(response, 200, {
      ok: true,
      value: store.alerts(queryOf(url, 'sessionId'), queryOf(url, 'type'), limitOf(url)),
    })
    return true
  }
  if (isMethod(method, request, 'scan', 'POST')) {
    await handleScan(request, response)
    return true
  }
  if (isMethod(method, request, 'scan-prompt', 'POST')) {
    await handleScanPrompt(request, response)
    return true
  }
  if (isMethod(method, request, 'alerts/confirm', 'POST')) {
    await handleConfirm(request, response, store)
    return true
  }
  if (isMethod(method, request, 'rules', 'GET')) {
    writeJson(response, 200, { ok: true, value: rulesValue(options) })
    return true
  }
  if (isMethod(method, request, 'rules/test', 'POST')) {
    await handleRulesTest(request, response, options)
    return true
  }
  if (isMethod(method, request, 'rules', 'POST')) {
    await handleRulesSave(request, response, control)
    return true
  }
  return false
}

// ── handlers ───────────────────────────────────────────────────────────────

/** 状态：告警统计 + 护栏配置。 */
function statusValue(store: AlertStore, options: GuardOptions) {
  return {
    alertCount: store.count(),
    mode: options.mode,
    poisonScan: options.poisonScan,
    injection: options.injection,
    customRulesCount: Array.isArray(options.customRules) ? options.customRules.length : 0,
    notifyEnabled: options.notifyEnabled === true,
    notifyCooldownMs: options.notifyCooldownMs,
  }
}

/** 规则列表：内置规则 + 用户自定义规则（设置页展示 + 测试）。 */
function rulesValue(options: GuardOptions) {
  return {
    builtin: DESTRUCTIVE_PATTERNS.map((pattern) => ({
      id: pattern.id,
      source: 'builtin',
      message: pattern.message,
    })),
    custom: rawRulesOf(options.customRules),
    notifyEnabled: options.notifyEnabled === true,
    notifyCooldownMs: options.notifyCooldownMs,
  }
}

/** 规则测试：输入命令 → 返回命中的内置/自定义规则 + 合并决策。 */
async function handleRulesTest(request: ServerRequest, response: ServerResponse, options: GuardOptions): Promise<void> {
  const payload = await readJsonBody(request)
  const command = typeof payload.command === 'string' ? payload.command : ''
  if (command === '') {
    writeJson(response, 400, { ok: false, error: { message: 'command required' } })
    return
  }
  const hits = []
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.re.test(command)) {
      hits.push({ id: pattern.id, source: 'builtin', mode: options.mode, severity: 'high', message: pattern.message })
    }
  }
  for (const rule of options.customRules) {
    if (rule.regex.test(command)) {
      hits.push({
        id: rule.id,
        source: 'custom',
        mode: rule.mode !== '' ? rule.mode : options.mode,
        severity: rule.severity,
        message: rule.message,
      })
    }
  }
  const decision = decideDestructive(command, options)
  writeJson(response, 200, {
    ok: true,
    value: {
      command,
      hits,
      decision: decision === null ? null : { mode: decision.mode, severity: decision.severity },
    },
  })
}

/** 保存自定义规则 + 通知设置：校验 → 持久化 patch → 更新内存（saveConfig）。 */
async function handleRulesSave(request: ServerRequest, response: ServerResponse, control?: SaveControl): Promise<void> {
  if (control === undefined || typeof control.saveConfig !== 'function') {
    writeJson(response, 400, { ok: false, error: { message: 'config not available' } })
    return
  }
  const payload = await readJsonBody(request)
  const next: SaveConfigPayload = {
    customRules: payload.customRules as unknown[] | undefined,
    notifyEnabled: payload.notifyEnabled as boolean | undefined,
    notifyCooldownMs: payload.notifyCooldownMs as number | undefined,
  }
  const result = await control.saveConfig(next)
  writeJson(response, 200, { ok: true, value: result })
}

/** 投毒扫描：body { target }（包名或本地路径/tarball 路径）。 */
async function handleScan(request: ServerRequest, response: ServerResponse): Promise<void> {
  const payload = await readJsonBody(request)
  const target = typeof payload.target === 'string' ? payload.target.trim() : ''
  if (target === '') {
    writeJson(response, 400, { ok: false, error: { message: 'target required' } })
    return
  }
  const result = await scanTarget(target)
  if (!result.ok) {
    writeJson(response, 400, { ok: false, error: { message: result.error } })
    return
  }
  writeJson(response, 200, { ok: true, value: result })
}

/** 提示注入检测：body { text }。 */
async function handleScanPrompt(request: ServerRequest, response: ServerResponse): Promise<void> {
  const payload = await readJsonBody(request)
  const text = typeof payload.text === 'string' ? payload.text : ''
  if (text === '') {
    writeJson(response, 400, { ok: false, error: { message: 'text required' } })
    return
  }
  writeJson(response, 200, { ok: true, value: { hits: detectPromptInjection(text) } })
}

/** 确认告警：body { id }。 */
async function handleConfirm(request: ServerRequest, response: ServerResponse, store: AlertStore): Promise<void> {
  const payload = await readJsonBody(request)
  const id = payload.id
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    writeJson(response, 400, { ok: false, error: { message: 'id required' } })
    return
  }
  writeJson(response, 200, { ok: true, value: { confirmed: store.confirm(id) } })
}

/** 扫描目标：tarball 路径解压扫；本地路径/包名经 resolveAndScan。 */
async function scanTarget(target: string) {
  if (target.endsWith('.tgz') || target.endsWith('.tar.gz')) {
    const { scanTarball } = await import('./poison.js')
    return scanTarball(target)
  }
  const local = localPathOf(target)
  if (local !== '') return resolveAndScan(local)
  return resolveAndScan(target)
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

function queryOf(url: URL, name: string): string {
  return url.searchParams.get(name) ?? ''
}

function limitOf(url: URL): number {
  const raw = url.searchParams.get('limit')
  const parsed = raw === null ? 0 : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** 读取 JSON 请求体。 */
async function readJsonBody(request: ServerRequest): Promise<Record<string, unknown>> {
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
function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

/** 写错误响应。 */
function writeError(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  writeJson(response, 500, { ok: false, error: { message } })
}
