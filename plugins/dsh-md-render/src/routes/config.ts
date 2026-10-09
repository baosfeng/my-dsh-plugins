/**
 * dsh-md-render — `/md-render/api` 配置路由（合并后唯一一条配置路径）。
 *
 * 设置页可视化 → 保存 → `PUT /md-render/api/config` → 写回 profile patch 文件
 * （持久化，先合并行内已有键）+ 更新内存（立即生效）：host 半据新值撤销/重注册
 * systemPrompt section，不等 patch 热重载。
 *
 * **不做旧路径兼容**（issue #463 决策）：`/md/api`、`/think-zh-expand/api`、
 * `/mermaid-render/api` 一律 404。三条路径都是包内 host↔client 私有契约，host 与
 * client 同包同版本发布，不存在错配窗口。
 *
 * 安全：所有请求先做 loopback 信任围栏（复用 dsh-shared 的 isTrustedApiRequest）——
 * 配置仅本机可读写。
 *
 * 本文件编译为 lib/routes/config.js（产物必须提交）。
 */
import { isTrustedApiRequest, readJsonBody, writeError, writeJson } from 'dsh-shared'
import { normalizeConfigPayload } from '../config.js'
import { CONFIG_API_PREFIX } from './paths.js'
import type { ConfigPatch, MdRenderConfig } from '../config.js'
import type { DshContext, ServerRequest, ServerResponse } from '../types.js'

/**
 * API 前缀来自**单一真源** `src/routes/paths.ts`：client 端（`lib/client.js` 片段，
 * 不能 import host 代码）的同名常量由 `scripts/build.mjs` 构建期注入同一批值，
 * 两侧不可能各写一份（防回归测试见 test/route-single-source.mjs）。
 */
export { CONFIG_API_PREFIX }

/** 配置变更回调（host 半接线：持久化 + 内存 + section 重同步）。 */
export type OnConfigChange = (next: ConfigPatch) => Promise<void>

/**
 * 注册配置路由。**挂常驻 root fiber**（`ctx.root ?? ctx`）+ WeakMap 去重：
 * 插件自身 fiber 被 profile 回收时路由会静默 404（仓库已记录该坑），且重复 apply
 * 不能重复注册（test/registration-idempotent.mjs 钉住）。
 */
export function registerConfigRoutes(ctx: DshContext, current: MdRenderConfig, onConfigChange: OnConfigChange): void {
  const fence = createFence(ctx)
  const target = residentTarget(ctx)
  const disposers = routeDisposers.get(target) ?? new Map<string, () => void>()
  routeDisposers.set(target, disposers)
  if (disposers.has(CONFIG_API_PREFIX)) return
  disposers.set(
    CONFIG_API_PREFIX,
    target.effect(
      () =>
        target.webServer?.register({
          kind: 'prefix',
          path: CONFIG_API_PREFIX,
          handler: apiHandler(fence, current, onConfigChange),
        }),
      'dsh-md-render: /md-render/api routes',
    ) as unknown as () => void,
  )
}

/** 已注册路由的 disposer（按常驻 root 去重；WeakMap 不阻止 GC）。 */
const routeDisposers = new WeakMap<object, Map<string, () => void>>()

/** 常驻注册承载：root fiber 优先（插件 fiber 会被 profile 回收）。 */
function residentTarget(ctx: DshContext): DshContext & { effect: DshContext['effect'] } {
  const root = (ctx as { root?: DshContext }).root
  return (root ?? ctx) as DshContext & { effect: DshContext['effect'] }
}

/** loopback 信任围栏（ctx.get 可选调用：精简上下文退化成「只信 loopback」）。 */
function createFence(ctx: DshContext): (request: ServerRequest) => boolean {
  const runtime = ctx.get?.<{ trustedHosts?: string[] }>('webRuntime')
  const trustedHosts = Array.isArray(runtime?.trustedHosts) ? runtime.trustedHosts : []
  return (request) => isTrustedApiRequest(request, trustedHosts)
}

/** 统一 handler：围栏 → 方法分派 → 404 / 错误兜底。 */
function apiHandler(
  fence: (request: ServerRequest) => boolean,
  current: MdRenderConfig,
  onConfigChange: OnConfigChange,
): (request: ServerRequest, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (!fence(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const url = new URL(request.url ?? '/', 'http://dsh.internal')
    const method = url.pathname.startsWith(`${CONFIG_API_PREFIX}/`)
      ? url.pathname.slice(CONFIG_API_PREFIX.length + 1)
      : undefined
    try {
      if (await dispatch(method, request, response, current, onConfigChange)) return
      writeJson(response, 404, { ok: false, error: { message: 'unknown dsh-md-render API method' } })
    } catch (error) {
      writeError(response, error as Error)
    }
  }
}

/** 按 method + 动词分派；未识别返回 false（调用方回 404）。 */
async function dispatch(
  method: string | undefined,
  request: ServerRequest,
  response: ServerResponse,
  current: MdRenderConfig,
  onConfigChange: OnConfigChange,
): Promise<boolean> {
  if (method !== 'config') return false
  if (request.method === 'GET') {
    writeJson(response, 200, { ok: true, value: current })
    return true
  }
  if (request.method === 'PUT') {
    await handleConfigPut(request, response, onConfigChange)
    return true
  }
  return false
}

/** 保存配置：归一化（非法 → 400 且不落盘）→ 持久化 + 内存（onConfigChange）。 */
async function handleConfigPut(
  request: ServerRequest,
  response: ServerResponse,
  onConfigChange: OnConfigChange,
): Promise<void> {
  const next = normalizeConfigPayload(await readJsonBody(request))
  if (next === undefined) {
    writeJson(response, 400, { ok: false, error: { message: 'invalid config' } })
    return
  }
  await onConfigChange(next)
  writeJson(response, 200, { ok: true })
}
