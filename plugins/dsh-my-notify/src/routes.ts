/**
 * dsh-my-notify — /notify/api 路由（SSE 长连接 + 远程 hook + 信息查询 +
 * 配置读写 + 出站 webhook 状态）。
 *
 * 所有请求先做 loopback 信任围栏（与 /api 网关一致的契约）；stream 为
 * EventSource 长连接（心跳保活，卸载清理），trigger 为远程 webhook（可选
 * apiToken 校验），info 返回当前触发开关，config 读写配置（含 webhooks），
 * webhooks 返回出站 webhook 列表 + 失败记录（设置页可见）。
 */
import { isTrustedApiRequest, header, readJsonBody, writeJson, writeError } from 'dsh-shared'
import type {
  DshContext,
  NoticeBus,
  NoticeFrame,
  NotifyOptions,
  ServerRequest,
  ServerResponse,
  WebhookConfig,
  WebhookStore,
} from './types.js'

/** 配置变更回调。 */
type OnConfigChange = (next: Partial<NotifyOptions>) => Promise<void>

/** 注册 /notify/api 路由与心跳清理（两个 effect，各自返回 disposer）。 */
export function registerNotifyRoutes(
  ctx: DshContext,
  options: NotifyOptions,
  bus: NoticeBus,
  onConfigChange: OnConfigChange,
  emitNotice: (notice: NoticeFrame) => void,
  webhookStore: WebhookStore,
): void {
  const webRuntime = ctx.get ? (ctx.get('webRuntime') as { trustedHosts?: string[] } | undefined) : undefined
  const trustedHosts =
    webRuntime !== undefined && webRuntime !== null && Array.isArray(webRuntime.trustedHosts)
      ? webRuntime.trustedHosts
      : []
  const fence = (request: ServerRequest) => isTrustedApiRequest(request, trustedHosts)

  ctx.effect(
    () =>
      ctx.webServer!.register({
        kind: 'prefix',
        path: '/notify/api',
        handler: apiHandler(fence, options, bus, onConfigChange, emitNotice, webhookStore),
      }),
    'dsh-my-notify: /notify/api routes',
  )

  // 卸载时清理心跳（客户端集合随各 response close 自动清空）。
  ctx.effect(() => bus.stopHeartbeat, 'dsh-my-notify: heartbeat teardown')
}

// ── 路由分派 ─────────────────────────────────────────────────────────────

/** 构造 /notify/api 统一 handler：fence → 方法分派 → 404/错误兜底。 */
function apiHandler(
  fence: (request: ServerRequest) => boolean,
  options: NotifyOptions,
  bus: NoticeBus,
  onConfigChange: OnConfigChange,
  emitNotice: (notice: NoticeFrame) => void,
  webhookStore: WebhookStore,
) {
  return async (request: ServerRequest, response: ServerResponse): Promise<void> => {
    if (!fence(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    // URL 解析与 fence 同层（畸形 url 异常向上传播，与 /api 网关一致）
    const url = new URL(request.url ?? '/', 'http://dsh.internal')
    const pathname = url.pathname
    const method = pathname.startsWith('/notify/api/') ? pathname.slice('/notify/api/'.length) : undefined
    try {
      const handled = await dispatchMethod(
        method,
        request,
        response,
        options,
        bus,
        onConfigChange,
        emitNotice,
        webhookStore,
      )
      if (!handled) {
        writeJson(response, 404, {
          ok: false,
          error: { message: 'unknown dsh-my-notify API method' },
        })
      }
    } catch (error) {
      writeError(response, error)
    }
  }
}

// ── 各路由 handler ──────────────────────────────────────────────────────

/** 方法 + 请求动词匹配（降低 dispatchMethod 分支复杂度）。 */
function isMethod(method: string | undefined, request: ServerRequest, name: string, verb: string): boolean {
  return method === name && request.method === verb
}

/** 按 method 分派到具体 handler；未识别返回 false（调用方回 404）。 */
async function dispatchMethod(
  method: string | undefined,
  request: ServerRequest,
  response: ServerResponse,
  options: NotifyOptions,
  bus: NoticeBus,
  onConfigChange: OnConfigChange,
  emitNotice: (notice: NoticeFrame) => void,
  webhookStore: WebhookStore,
): Promise<boolean> {
  if (isMethod(method, request, 'stream', 'GET')) {
    handleStream(response, bus)
    return true
  }
  if (isMethod(method, request, 'trigger', 'POST')) {
    await handleTrigger(request, response, options, emitNotice)
    return true
  }
  if (isMethod(method, request, 'info', 'GET')) {
    writeJson(response, 200, { ok: true, value: infoValue(options) })
    return true
  }
  if (isMethod(method, request, 'config', 'GET')) {
    writeJson(response, 200, { ok: true, value: configValue(options) })
    return true
  }
  if (isMethod(method, request, 'config', 'PUT')) {
    await handleConfigPut(request, response, onConfigChange)
    return true
  }
  if (isMethod(method, request, 'webhooks', 'GET')) {
    writeJson(response, 200, { ok: true, value: webhooksValue(options, webhookStore) })
    return true
  }
  return false
}

/** SSE 长连接：EventSource 消费；断开清理订阅集合；首次订阅启动心跳。 */
function handleStream(response: ServerResponse, bus: NoticeBus): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  response.write('retry: 3000\n\n')
  const client = { response }
  bus.clients.add(client)
  const onClose = () => {
    bus.clients.delete(client)
    response.removeListener?.('close', onClose)
  }
  response.on('close', onClose)
  bus.startHeartbeat()
}

/** 远程 hook：任意进程/webhook 触发通知（apiToken 校验 + JSON body）。 */
async function handleTrigger(
  request: ServerRequest,
  response: ServerResponse,
  options: NotifyOptions,
  emitNotice: (notice: NoticeFrame) => void,
): Promise<void> {
  const token = header(request.headers, 'x-notify-token')
  if (options.apiToken !== '' && token !== options.apiToken) {
    writeJson(response, 403, {
      ok: false,
      error: { code: 'forbidden', message: 'invalid x-notify-token' },
    })
    return
  }
  const payload = await readJsonBody(request as unknown as AsyncIterable<string>)
  emitNotice({
    kind: 'remote',
    sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : '',
    title: typeof payload.title === 'string' ? payload.title : '',
    note: typeof payload.body === 'string' ? payload.body : '',
  })
  writeJson(response, 200, { ok: true })
}

/** 信息查询：当前触发开关（apiToken 只暴露是否启用，绝不暴露值）。 */
function infoValue(options: NotifyOptions) {
  return {
    end: options.end,
    ask: options.ask,
    approval: options.approval,
    subagentEnd: options.subagentEnd,
    remoteEnabled: true,
    apiToken: options.apiToken !== '',
    dedupeMs: options.dedupeMs,
    askMode: options.askMode,
  }
}

/** 配置查询：当前生效配置（设置页表单回填；apiToken 为明文，仅本机可读）。 */
function configValue(options: NotifyOptions) {
  return {
    end: options.end,
    ask: options.ask,
    approval: options.approval,
    subagentEnd: options.subagentEnd,
    apiToken: options.apiToken,
    dedupeMs: options.dedupeMs,
    askMode: options.askMode,
    webBaseUrl: options.webBaseUrl,
    webhooks: options.webhooks,
  }
}

/** 出站 webhook 状态：当前配置列表 + 失败记录（设置页可见）。 */
function webhooksValue(options: NotifyOptions, webhookStore: WebhookStore) {
  return {
    webhooks: options.webhooks,
    failures: webhookStore?.failures?.list() ?? [],
  }
}

/** 渠道白名单。 */
const CHANNELS = new Set(['wecom', 'feishu', 'dingtalk', 'generic'])

/** 事件白名单。 */
const EVENT_KINDS = new Set(['end', 'ask', 'approval', 'remote'])

/** 非空字符串判定。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** 校验并规整配置 payload（部分字段合法，缺失字段不校验）；非法输入返回 undefined。 */
function normalizeConfig(payload: unknown): Partial<NotifyOptions> | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const p = payload as Record<string, unknown>
  const result: Record<string, unknown> = {}
  const booleans = normalizeBooleans(p, ['end', 'ask', 'approval', 'subagentEnd'])
  if (booleans === undefined) return undefined
  Object.assign(result, booleans)
  const apiToken = normalizeStringField(p, 'apiToken')
  if (apiToken === undefined) return undefined
  Object.assign(result, apiToken)
  const webBaseUrl = normalizeStringField(p, 'webBaseUrl')
  if (webBaseUrl === undefined) return undefined
  Object.assign(result, webBaseUrl)
  const askMode = normalizeAskMode(p)
  if (askMode === undefined) return undefined
  Object.assign(result, askMode)
  const dedupeMs = normalizeDedupeMs(p)
  if (dedupeMs === undefined) return undefined
  Object.assign(result, dedupeMs)
  const webhooks = normalizeWebhooksField(p)
  if (webhooks === undefined) return undefined
  Object.assign(result, webhooks)
  return result as Partial<NotifyOptions>
}

/** 规整 askMode（full/summary）；缺失跳过；非法返回 undefined。 */
function normalizeAskMode(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  if (payload.askMode === undefined) return {}
  if (payload.askMode !== 'full' && payload.askMode !== 'summary') return undefined
  return { askMode: payload.askMode }
}

/** 规整布尔字段组（缺失跳过；任一非法返回 undefined）。 */
function normalizeBooleans(payload: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    if (payload[key] === undefined) continue
    if (typeof payload[key] !== 'boolean') return undefined
    result[key] = payload[key]
  }
  return result
}

/** 规整字符串字段（缺失返回空对象；非法返回 undefined）。 */
function normalizeStringField(payload: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  if (payload[key] === undefined) return {}
  if (typeof payload[key] !== 'string') return undefined
  return { [key]: payload[key] }
}

/** 规整 dedupeMs（缺失返回空对象；非法返回 undefined）。 */
function normalizeDedupeMs(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  if (payload.dedupeMs === undefined) return {}
  if (!Number.isFinite(payload.dedupeMs)) return undefined
  return { dedupeMs: payload.dedupeMs }
}

/** 规整 webhooks 字段（缺失返回空对象；非法返回 undefined）。 */
function normalizeWebhooksField(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  if (payload.webhooks === undefined) return {}
  const webhooks = normalizeWebhooks(payload.webhooks)
  if (webhooks === undefined) return undefined
  return { webhooks }
}

/** 校验 webhooks 数组（对象数组，逐项规整）；任一非法返回 undefined。 */
function normalizeWebhooks(value: unknown): WebhookConfig[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result: WebhookConfig[] = []
  for (const item of value) {
    const webhook = normalizeWebhook(item)
    if (webhook === undefined) return undefined
    result.push(webhook)
  }
  return result
}

/** 校验单个 webhook：名称/URL 必填，渠道/事件白名单，缺省补默认值。 */
function normalizeWebhook(item: unknown): WebhookConfig | undefined {
  if (item === null || typeof item !== 'object') return undefined
  const w = item as Record<string, unknown>
  if (!isNonEmptyString(w.name)) return undefined
  if (!isNonEmptyString(w.url)) return undefined
  const channel = (w.channel as string) ?? 'generic'
  if (!CHANNELS.has(channel)) return undefined
  const events = normalizeEvents(w.events)
  if (events === undefined) return undefined
  return {
    name: w.name,
    channel: channel as WebhookConfig['channel'],
    url: w.url,
    secret: typeof w.secret === 'string' ? w.secret : '',
    events,
    enabled: w.enabled !== false,
    msgType: (['markdown', 'post'].includes(w.msgType as string) ? w.msgType : 'text') as WebhookConfig['msgType'],
    template: strOrEmpty(w.template),
  }
}

/** 字符串字段规整：缺失/非字符串回退空串。 */
function strOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 校验事件选择（end/ask/approval/remote 子集，去重）；缺省空数组 = 全部。 */
function normalizeEvents(value: unknown): string[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  for (const event of value) {
    if (!EVENT_KINDS.has(event as string)) return undefined
  }
  return [...new Set(value as string[])]
}

/** 保存配置：校验 → 持久化 + 更新内存 + 重载监听器（onConfigChange）。 */
async function handleConfigPut(
  request: ServerRequest,
  response: ServerResponse,
  onConfigChange: OnConfigChange,
): Promise<void> {
  const payload = await readJsonBody(request as unknown as AsyncIterable<string>)
  const next = normalizeConfig(payload)
  if (next === undefined) {
    writeJson(response, 400, { ok: false, error: { message: 'invalid config' } })
    return
  }
  await onConfigChange(next)
  writeJson(response, 200, { ok: true })
}

// ── HTTP helpers（与仓库其它插件的路由写法一致）─────────────────────────
