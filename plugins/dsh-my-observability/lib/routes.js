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
 */
import { isTrustedApiRequest, readJsonBody, writeJson, writeError } from 'dsh-shared'
import { gitStatus, gitDiff, gitCommit } from './git.js'
import { parseDiff } from './diff.js'
import { reviewRules } from './review.js'
import { runAiReview } from './ai.js'

/** 注册 /observability/api 路由（effect 持有 disposer）。 */
export function registerObservabilityRoutes(ctx, store, monitor, options) {
  const webRuntime = ctx.get ? ctx.get('webRuntime') : undefined
  const trustedHosts =
    webRuntime !== undefined && webRuntime !== null && Array.isArray(webRuntime.trustedHosts)
      ? webRuntime.trustedHosts
      : []
  const fence = (request) => isTrustedApiRequest(request, trustedHosts)

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/observability/api',
        handler: apiHandler(ctx, fence, store, monitor, options),
      }),
    'dsh-my-observability: /observability/api routes',
  )
}

/** 统一 handler：fence → 方法分派 → 404/错误兜底。 */
function apiHandler(ctx, fence, store, monitor, options) {
  return async (request, response) => {
    if (!fence(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const url = new URL(request.url ?? '/', 'http://dsh.internal')
    const pathname = url.pathname
    const method = pathname.startsWith('/observability/api/') ? pathname.slice('/observability/api/'.length) : undefined
    try {
      const handled = await dispatchMethod(method, request, response, url, ctx, store, monitor, options)
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
function isMethod(method, request, name, verb) {
  return method === name && request.method === verb
}

/** 按 method 分派到具体 handler；未识别返回 false（调用方回 404）。 */
async function dispatchMethod(method, request, response, url, ctx, store, monitor, options) {
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
  if (isMethod(method, request, 'plugin-status', 'GET')) {
    await handlePluginStatus(ctx, response)
    return true
  }
  if (isMethod(method, request, 'errors', 'GET')) {
    writeJson(response, 200, { ok: true, value: store.events(null, 'plugin_error', limitOf(url)) })
    return true
  }
  return false
}

// ── handlers ───────────────────────────────────────────────────────────────

/** 状态：审计统计 + 功能开关（aiReview 只暴露开关）。 */
function statusValue(store, options) {
  return {
    auditCount: store.count(),
    sessions: store.sessions().length,
    aiReview: options.aiReview !== false,
    gitEnabled: true,
  }
}

/**
 * 插件状态聚合：广播 plugin:status-query 事件，收集所有插件状态。
 * 每个插件返回 { plugin, config, running, lastActions }（config 脱敏，lastActions ≤5）。
 * 超时 3s 未响应的插件标记为 { plugin, running: false, error: 'timeout' }。
 */
async function handlePluginStatus(ctx, response) {
  const TIMEOUT_MS = 3000
  const results = []
  try {
    // 广播查询事件，带超时
    const statuses = await Promise.allSettled(
      (ctx.bundler?.plugins ?? []).map(async (p) => {
        const name = p.name ?? p.constructor?.name ?? 'unknown'
        try {
          const result = await Promise.race([
            ctx.emit('plugin:status-query', { plugin: name }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
          ])
          return result ?? { plugin: name, running: true, config: {}, lastActions: [] }
        } catch {
          return { plugin: name, running: false, error: 'timeout' }
        }
      }),
    )
    for (const s of statuses) {
      results.push(s.status === 'fulfilled' ? s.value : { plugin: 'unknown', running: false, error: 'rejected' })
    }
  } catch {
    // bundler 不可用时返回空列表
  }
  writeJson(response, 200, { ok: true, value: results })
}

/** git status：非仓库路径 400。 */
async function handleGitStatus(response, repoPath) {
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
async function handleGitDiff(response, repoPath, staged) {
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
async function handleGitCommit(request, response) {
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
async function handleReview(ctx, request, response, options) {
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
  const report = reviewRules(parseDiff(diffResult.text))
  report.ai = await aiOutcome(ctx, payload, options, diffResult.text, report)
  writeJson(response, 200, { ok: true, value: report })
}

/** AI 审查开关判定：配置开启 + 请求未显式关闭 → 运行（失败降级）。 */
async function aiOutcome(ctx, payload, options, diffText, report) {
  if (options.aiReview === false) return { enabled: false }
  if (payload.aiReview === false) return { enabled: false }
  return runAiReview(ctx, diffText, report, options.aiTimeoutMs)
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

function queryOf(url, name) {
  return url.searchParams.get(name) ?? ''
}

function repoOf(url) {
  const repo = url.searchParams.get('repo')
  return typeof repo === 'string' ? repo : ''
}

function limitOf(url) {
  const raw = url.searchParams.get('limit')
  const parsed = raw === null ? 0 : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
