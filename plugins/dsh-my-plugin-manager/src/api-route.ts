/**
 * dsh-my-plugin-manager — /my-plugin-manager/api route handler.
 *
 * 能力边界（只提供官方插件管理**没有**的增量）：
 *  - GET /my-plugin-manager/api/search?q=…        → npm registry 市场关键词搜索；
 *  - GET /my-plugin-manager/api/detail?name=…     → 插件详情（README/版本/依赖/月下载量）；
 *  - GET /my-plugin-manager/api/updates           → `dsh plugin outdated --json`（更新检查）。
 *
 * 安装 / 卸载 / 启停 / 清单管理**不属于本插件**：官方默认内置（侧边栏插件页、
 * tool-plugin-manager 的 list_plugins/set_plugin、`dsh plugin` CLI），设置页只读是
 * 官方刻意的设计，本插件不再在其上叠一层可写管理。
 * Every request passes the trust fence first; responses are JSON with
 * cache-control: no-cache.
 */
import { writeError, writeJson } from 'dsh-shared'
import { outdatedPlugins } from './manage.js'
import { fetchPackageDetail, searchNpmPlugins } from './registry.js'
import type { DshContext, Logger, ServerRequest, ServerResponse } from './types.js'

/** createApiHandler 的依赖（由 index.ts 的 apply 组装）。 */
export interface ApiHandlerDeps {
  /** DSH server Context（logger）。 */
  ctx: DshContext
  /** 当前 profile 名（`dsh plugin --profile <p> outdated` 用）。 */
  profile: string
  /** 信任围栏（dsh-shared isTrustedApiRequest）。 */
  fence: (request: ServerRequest) => boolean
}

/** 一条路由方法：期望的 HTTP method + 执行函数。 */
interface RouteSpec {
  method: string
  run: (url: URL, request: ServerRequest, response: ServerResponse) => void | Promise<void>
}

export function createApiHandler({
  ctx,
  profile,
  fence,
}: ApiHandlerDeps): (request: ServerRequest, response: ServerResponse) => Promise<void> {
  const logger = ctx.logger
  const handlers: Record<string, RouteSpec> = {
    search: { method: 'GET', run: (url, request, response) => handleSearch(url, response) },
    detail: { method: 'GET', run: (url, request, response) => handleDetail(url, response, logger) },
    updates: {
      method: 'GET',
      run: (url, request, response) => handleUpdates(profile, response, logger),
    },
  }
  return async (request: ServerRequest, response: ServerResponse): Promise<void> => {
    if (!fence(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const url = new URL(request.url ?? '/', 'http://dsh.internal')
    try {
      const method = apiMethodOf(url)
      const spec = method === undefined ? undefined : handlers[method]
      if (spec === undefined || spec.method !== request.method) {
        writeJson(response, 404, {
          ok: false,
          error: { message: 'unknown my-plugin-manager API method' },
        })
        return
      }
      await spec.run(url, request, response)
    } catch (error) {
      writeError(response, error)
    }
  }
}

/** Strip the /my-plugin-manager/api/ prefix; undefined for anything else. */
function apiMethodOf(url: URL): string | undefined {
  const pathname = url.pathname
  return pathname.startsWith('/my-plugin-manager/api/') ? pathname.slice('/my-plugin-manager/api/'.length) : undefined
}

/** GET /search?q=… — npm registry market search. */
async function handleSearch(url: URL, response: ServerResponse): Promise<void> {
  const query = url.searchParams.get('q') ?? ''
  const size = Number(url.searchParams.get('size') ?? 30)
  if (query.trim() === '') {
    writeJson(response, 200, { ok: true, value: { results: [] } })
    return
  }
  const results = await searchNpmPlugins(query.trim(), safeSize(size))
  writeJson(response, 200, { ok: true, value: { results } })
}

/** GET /detail?name=…&version=… — package detail (README/versions/deps). */
async function handleDetail(url: URL, response: ServerResponse, logger: Logger | undefined): Promise<void> {
  const name = url.searchParams.get('name') ?? ''
  const version = url.searchParams.get('version') ?? ''
  if (name.trim() === '') {
    writeJson(response, 400, { ok: false, error: { message: 'name is required' } })
    return
  }
  try {
    const detail = await fetchPackageDetail(name.trim(), version.trim())
    writeJson(response, 200, { ok: true, value: detail })
  } catch (error) {
    logger?.warn(
      `[dsh-my-plugin-manager] 插件详情加载失败（name=${name.trim()}，原因=${error instanceof Error ? error.message : String(error)}）`,
    )
    writeJson(response, 200, {
      ok: false,
      error: { message: String(messageOf(error) ?? 'failed to load plugin detail') },
    })
  }
}

/** 未知异常的 message（非对象/无 message 视为未提供）。 */
function messageOf(error: unknown): unknown {
  return (error as { message?: unknown } | null | undefined)?.message
}

/** GET /updates — pnpm outdated --json parsed into a flat list. */
async function handleUpdates(profile: string, response: ServerResponse, logger: Logger | undefined): Promise<void> {
  const result = await outdatedPlugins(profile)
  if (!result.ok) {
    logger?.warn(`[dsh-my-plugin-manager] 更新检查失败（原因=${result.error}）`)
    writeJson(response, 200, { ok: true, value: { outdated: [], error: result.error } })
    return
  }
  logger?.info(`[dsh-my-plugin-manager] 更新检查完成（可更新=${result.outdated.length} 个）`)
  writeJson(response, 200, { ok: true, value: { outdated: result.outdated } })
}

/** Clamp the search size to 1..50. */
function safeSize(size: number): number {
  if (!Number.isFinite(size) || size < 1) return 30
  return Math.min(size, 50)
}
