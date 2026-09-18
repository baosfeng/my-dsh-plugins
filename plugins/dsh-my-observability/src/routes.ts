/**
 * dsh-my-observability — /observability/api routes.
 *
 * 所有请求先做 loopback 信任围栏（与 /api 网关一致的契约）。方法分派：
 *  - GET  /sessions                — 有审计事件的会话列表
 *  - GET  /events?sessionId&type&limit — 会话事件（时间轴正序）
 *  - GET  /status                  — 审计统计 + 功能开关
 *  - GET  /git/status?repo=        — 仓库状态（分支 + 变更）
 *  - GET  /git/diff?repo=&staged=  — 差异文本
 *  - POST /git/commit              — 类型化提交（Conventional Commits）
 *  - POST /review                  — 增量 diff 审查（规则引擎 + 可选 AI）
 *  - GET/PUT /config               — 设置页配置读写（aiReview / aiTimeoutMs）
 */
import { isTrustedApiRequest, readJsonBody, writeJson, writeError } from 'dsh-shared'
import { dispatchConfigRoutes } from './config-routes.js'
import { gitStatus, gitDiff, gitCommit } from './git.js'
import { parseDiff } from './diff.js'
import { reviewRules } from './review.js'
import { runAiReview } from './ai.js'
import type { AiReviewOutcome } from './ai.js'
import type { ReviewReport } from './review.js'
import type { AuditStore } from './store.js'
import type { ResourceMonitor } from './resource-monitor.js'
import type { DshContext, ServerRequest, ServerResponse } from './types.js'

/** 插件配置（应用层 config 覆盖后的形态）。 */
export interface ObservabilityOptions {
  aiReview: boolean
  aiTimeoutMs: number
  aiProvider?: string
  aiModel?: string
  aiCwd?: string
}

/** 信任围栏。 */
type Fence = (request: ServerRequest) => boolean

/** 注册 /observability/api 路由（effect 持有 disposer）。 */
export function registerObservabilityRoutes(
  ctx: DshContext,
  store: AuditStore,
  monitor: ResourceMonitor,
  options: ObservabilityOptions,
  onConfigChange: (next: Pick<ObservabilityOptions, 'aiReview' | 'aiTimeoutMs'>) => Promise<void>,
): void {
  const webRuntime = ctx.get ? ctx.get<{ trustedHosts?: string[] }>('webRuntime') : undefined
  const trustedHosts =
    webRuntime !== undefined && webRuntime !== null && Array.isArray(webRuntime.trustedHosts)
      ? webRuntime.trustedHosts
      : []
  const fence: Fence = (request) => isTrustedApiRequest(request, trustedHosts)

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/observability/api',
        handler: apiHandler(ctx, fence, store, monitor, options, onConfigChange),
      }),
    'dsh-my-observability: /observability/api routes',
  )
}

/** 统一 handler：fence → 方法分派 → 404/错误兜底。 */
function apiHandler(
  ctx: DshContext,
  fence: Fence,
  store: AuditStore,
  monitor: ResourceMonitor,
  options: ObservabilityOptions,
  onConfigChange: (next: Pick<ObservabilityOptions, 'aiReview' | 'aiTimeoutMs'>) => Promise<void>,
): (request: ServerRequest, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (!fence(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const url = new URL(request.url ?? '/', 'http://dsh.internal')
    const pathname = url.pathname
    const method = pathname.startsWith('/observability/api/') ? pathname.slice('/observability/api/'.length) : undefined
    try {
      // 查询语义与「磁盘历史加载耗时」解耦：就绪前不派发，避免读到半加载
      // 状态（曾经的 CI flaky：固定 40ms sleep 赌 readFile 跑完，慢机器上
      // 查询读到 0 条事件 → 0 !== 1）。whenReady 就绪后立即 resolve，无延迟。
      await store.whenReady()
      const handled = await dispatchMethod(method, request, response, url, ctx, store, monitor, options, onConfigChange)
      if (!handled) {
        writeJson(response, 404, {
          ok: false,
          error: { message: 'unknown dsh-my-observability API method' },
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
  ctx: DshContext,
  store: AuditStore,
  monitor: ResourceMonitor,
  options: ObservabilityOptions,
  onConfigChange: (next: Pick<ObservabilityOptions, 'aiReview' | 'aiTimeoutMs'>) => Promise<void>,
): Promise<boolean> {
  if (await dispatchCore(method, request, response, url, ctx, store, monitor, options)) return true
  if (dispatchExtended(method, request, response, url, ctx, store)) return true
  return dispatchConfigRoutes(method, request, response, options, onConfigChange)
}

/** 核心路由（复杂度 ≤10）。 */
async function dispatchCore(
  method: string | undefined,
  request: ServerRequest,
  response: ServerResponse,
  url: URL,
  ctx: DshContext,
  store: AuditStore,
  monitor: ResourceMonitor,
  options: ObservabilityOptions,
): Promise<boolean> {
  if (isMethod(method, request, 'sessions', 'GET')) {
    writeJson(response, 200, { ok: true, value: store.sessions() })
    return true
  }
  if (isMethod(method, request, 'resources', 'GET')) {
    writeJson(response, 200, { ok: true, value: monitor.sample() })
    return true
  }
  if (isMethod(method, request, 'events', 'GET')) {
    writeJson(response, 200, {
      ok: true,
      value: store.events(queryOf(url, 'sessionId'), queryOf(url, 'type'), limitOf(url)),
    })
    return true
  }
  if (isMethod(method, request, 'status', 'GET')) {
    writeJson(response, 200, { ok: true, value: statusValue(store, options) })
    return true
  }
  if (isMethod(method, request, 'git/status', 'GET')) {
    await handleGitStatus(response, repoOf(url))
    return true
  }
  if (isMethod(method, request, 'git/diff', 'GET')) {
    await handleGitDiff(response, repoOf(url), url.searchParams.get('staged') === '1')
    return true
  }
  if (isMethod(method, request, 'git/commit', 'POST')) {
    await handleGitCommit(request, response)
    return true
  }
  if (isMethod(method, request, 'review', 'POST')) {
    await handleReview(ctx, request, response, options)
    return true
  }
  return false
}

/** 扩展路由（#154/#155 新增）。 */
function dispatchExtended(
  method: string | undefined,
  request: ServerRequest,
  response: ServerResponse,
  url: URL,
  ctx: DshContext,
  store: AuditStore,
): boolean {
  if (isMethod(method, request, 'plugin-status', 'GET')) {
    void handlePluginStatus(ctx, response)
    return true
  }
  if (isMethod(method, request, 'errors', 'GET')) {
    handleErrors(store, url, response)
    return true
  }
  return false
}

// ── handlers ───────────────────────────────────────────────────────────────

/** 状态：审计统计 + 功能开关（aiReview 只暴露开关）。 */
function statusValue(
  store: AuditStore,
  options: ObservabilityOptions,
): { auditCount: number; sessions: number; aiReview: boolean; gitEnabled: boolean } {
  return {
    auditCount: store.count(),
    sessions: store.sessions().length,
    aiReview: options.aiReview !== false,
    gitEnabled: true,
  }
}

/** 聚合查询默认超时（3s）：超时未响应的插件标记 { running: false, error: 'timeout' }。 */
export const PLUGIN_STATUS_TIMEOUT_MS = 3000

/** 监听方返回的聚合状态（自研契约：{ ok: true, value: { plugin, running, … } }）。 */
interface PluginStatusValue {
  plugin?: string
  running?: boolean
  [key: string]: unknown
}

/** 超时哨兵（区分「超时」与「监听方返回值恰好是 undefined」）。 */
const STATUS_TIMEOUT = Symbol('plugin-status-timeout')

/**
 * 读取插件清单（机会性：服务未激活时 ctx.get 返回 undefined → 空清单）。
 *
 * 官方服务是 `ctx.pluginInventory`（host 半边），`list()` 是 **async**——
 * 同步解引用 `entries` 会抛错。清单名取 `entry.moduleName`（**完整包名**），
 * 因为监听方正是按完整包名比对自己。
 */
async function readPluginNames(ctx: DshContext): Promise<string[]> {
  const service = ctx.get<{ list(): Promise<{ entries?: { moduleName?: string }[] }> }>('pluginInventory')
  if (service === undefined || service === null) return []
  try {
    const snapshot = await service.list()
    return (snapshot?.entries ?? [])
      .map((entry) => entry.moduleName)
      .filter((name): name is string => typeof name === 'string' && name !== '')
  } catch {
    return []
  }
}

/** 从分发结果挑出匹配本插件的 value（`ok === true` 且 `value.plugin` 同名）。 */
function pickStatusValue(collected: unknown, name: string): PluginStatusValue | undefined {
  for (const item of Array.isArray(collected) ? collected : [collected]) {
    const response = item as { ok?: boolean; value?: PluginStatusValue } | null | undefined
    if (response?.ok === true && response.value?.plugin === name) return response.value
  }
  return undefined
}

/**
 * 单插件状态查询：用 `ctx.serial` 收集监听方返回值。
 *
 * cordis 三种派发对返回值的处理各不相同（本机 @deepseek-ai/cordis@4.0.2 实测）：
 * `emit` 同步派发**不收集**；`parallel` 只处理异常、**不返回结果**（Promise<void>）；
 * 只有 `serial` 顺序 await 并返回首个非 null/false/undefined 的返回值。逐插件
 * 查询时非匹配监听方一律 `return undefined`，因此 serial 恰好命中唯一那一条。
 * 无匹配响应一律如实标记（`no-response`），**绝不编造 running: true**。
 */
async function queryPluginStatus(
  ctx: DshContext,
  name: string,
  timeoutMs: number,
): Promise<PluginStatusValue | { plugin: string; running: false; error: string }> {
  // 期望态包装成永不 reject：超时后已丢弃的分发不得变成 unhandled rejection。
  const dispatch = Promise.resolve()
    .then(() => ctx.serial('plugin:status-query', { plugin: name }))
    .then(
      (value) => value,
      () => undefined,
    )
  const timer = new Promise<typeof STATUS_TIMEOUT>((resolve) => {
    const handle = setTimeout(() => resolve(STATUS_TIMEOUT), timeoutMs)
    handle.unref?.()
  })
  const outcome = await Promise.race([dispatch, timer])
  if (outcome === STATUS_TIMEOUT) return { plugin: name, running: false, error: 'timeout' }
  return pickStatusValue(outcome, name) ?? { plugin: name, running: false, error: 'no-response' }
}

/**
 * 插件状态聚合：按插件清单逐个查询 `plugin:status-query`，汇总监听方真实状态。
 * 每条为监听方返回的 { plugin, config, running, stats?, lastActions? }；超时 3s
 * 未响应标 { running: false, error: 'timeout' }，无匹配响应标 no-response。
 * 清单不可用（服务未激活）时返回空列表 `{ ok: true, value: [] }`。
 */
export async function handlePluginStatus(
  ctx: DshContext,
  response: ServerResponse,
  timeoutMs = PLUGIN_STATUS_TIMEOUT_MS,
): Promise<void> {
  const names = await readPluginNames(ctx)
  const results = await Promise.all(names.map((name) => queryPluginStatus(ctx, name, timeoutMs)))
  writeJson(response, 200, { ok: true, value: results })
}

/** 错误事件查询（#155 错误上报统一）：返回 plugin_error 类型事件。 */
function handleErrors(store: AuditStore, url: URL, response: ServerResponse): void {
  writeJson(response, 200, { ok: true, value: store.events(null, 'plugin_error', limitOf(url)) })
}

/** git status：非仓库路径 400。 */
async function handleGitStatus(response: ServerResponse, repoPath: string): Promise<void> {
  if (repoPath === '') {
    writeJson(response, 400, { ok: false, error: { message: 'repo query param required' } })
    return
  }
  const result = await gitStatus(repoPath)
  if (!result.ok) {
    writeJson(response, 400, { ok: false, error: result.error })
    return
  }
  writeJson(response, 200, { ok: true, value: result })
}

/** git diff：非仓库路径 400。 */
async function handleGitDiff(response: ServerResponse, repoPath: string, staged: boolean): Promise<void> {
  if (repoPath === '') {
    writeJson(response, 400, { ok: false, error: { message: 'repo query param required' } })
    return
  }
  const result = await gitDiff(repoPath, staged)
  if (!result.ok) {
    writeJson(response, 400, { ok: false, error: result.error })
    return
  }
  writeJson(response, 200, { ok: true, value: { text: result.text } })
}

/** 类型化提交：body { repoPath, type, scope, description, body }。 */
async function handleGitCommit(request: ServerRequest, response: ServerResponse): Promise<void> {
  const payload = await readJsonBody(request)
  const repoPath = typeof payload.repoPath === 'string' ? payload.repoPath : ''
  if (repoPath === '') {
    writeJson(response, 400, { ok: false, error: { message: 'repoPath required' } })
    return
  }
  const result = await gitCommit(repoPath, payload)
  if (!result.ok) {
    writeJson(response, 400, { ok: false, error: result.error })
    return
  }
  writeJson(response, 200, {
    ok: true,
    value: { hash: result.hash, message: result.message, summary: result.summary },
  })
}

/** 增量 diff 审查：规则引擎 + 可选 AI 增强（失败不影响规则结果）。 */
async function handleReview(
  ctx: DshContext,
  request: ServerRequest,
  response: ServerResponse,
  options: ObservabilityOptions,
): Promise<void> {
  const payload = await readJsonBody(request)
  const repoPath = typeof payload.repoPath === 'string' ? payload.repoPath : ''
  if (repoPath === '') {
    writeJson(response, 400, { ok: false, error: { message: 'repoPath required' } })
    return
  }
  const staged = payload.staged === true
  const diffResult = await gitDiff(repoPath, staged)
  if (!diffResult.ok) {
    writeJson(response, 400, { ok: false, error: diffResult.error })
    return
  }
  const report: ReviewReport & { ai?: AiReviewOutcome } = reviewRules(parseDiff(diffResult.text))
  report.ai = await aiOutcome(ctx, payload, options, diffResult.text, report)
  writeJson(response, 200, { ok: true, value: report })
}

/** AI 审查开关判定：配置开启 + 请求未显式关闭 → 运行（失败降级）。 */
async function aiOutcome(
  ctx: DshContext,
  payload: Record<string, unknown>,
  options: ObservabilityOptions,
  diffText: string,
  report: ReviewReport,
): Promise<AiReviewOutcome> {
  if (options.aiReview === false) return { enabled: false }
  if (payload.aiReview === false) return { enabled: false }
  return runAiReview(ctx, diffText, report, options.aiTimeoutMs, {
    provider: options.aiProvider,
    model: options.aiModel,
    cwd: options.aiCwd,
  })
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

const queryOf = (url: URL, name: string): string => url.searchParams.get(name) ?? ''
const repoOf = (url: URL): string => url.searchParams.get('repo') ?? ''

function limitOf(url: URL): number {
  const raw = url.searchParams.get('limit')
  const parsed = raw === null ? 0 : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
