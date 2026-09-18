/**
 * dsh-mermaid-render — `/mermaid-render/api` 配置路由（issue #383 宿主设置面板）。
 *
 * 设置页可视化编辑 → 保存 → `PUT /mermaid-render/api/config` → 写回 profile
 * patch 文件（持久化）+ 更新内存（立即生效）：host 半据新值撤销/注册
 * systemPrompt section，不等热重载。
 *
 * 前缀与静态资源路由 `/mermaid-render/assets` 同族（`/mermaid/...` 是另一个
 * 插件的名字空间，不用它以免语义含混）。
 *
 * 安全：所有请求先做 loopback 信任围栏（与 /api 网关一致的契约，复用
 * dsh-shared 的 isTrustedApiRequest）——配置仅本机可读写。
 *
 * 本文件编译为 lib/routes.js（产物必须提交，CI 只跑产物、不跑构建）。
 */
import { isTrustedApiRequest, readJsonBody, writeError, writeJson } from 'dsh-shared'
import { normalizeConfigPayload } from './config.js'
import type { MermaidConfigState } from './config.js'
import type { DshContext, ServerRequest, ServerResponse } from './types.js'

/**
 * API 前缀（仅本模块使用）。**跨半边契约**：client 端 part
 * （src/client/settings.ts 的 MERMAID_SETTINGS_API）必须与之保持一致 ——
 * 两边无法互相 import（client 是 bundle 片段），故由测试用字面量同时钉住两侧。
 */
const API_PREFIX = '/mermaid-render/api'

/** 配置变更回调（host 半接线：持久化 + 内存 + section 重同步）。 */
export type OnConfigChange = (next: MermaidConfigState) => Promise<void>

/** 注册 `/mermaid-render/api` 前缀路由（一个 effect，disposer 随 fiber 卸载）。 */
export function registerConfigRoutes(ctx: DshContext, state: MermaidConfigState, onConfigChange: OnConfigChange): void {
  const fence = createFence(ctx)
  ctx.effect(
    () =>
      ctx.webServer?.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: apiHandler(fence, state, onConfigChange),
      }),
    'dsh-mermaid-render: /mermaid-render/api routes',
  )
}

/**
 * loopback 信任围栏。`ctx.get` 用可选调用：精简上下文（测试桩 / 老宿主）里
 * 没有 get 时退化成「只信 loopback」，而不是抛错让整条 client/host 挂掉。
 */
function createFence(ctx: DshContext): (request: ServerRequest) => boolean {
  const runtime = ctx.get?.<{ trustedHosts?: string[] }>('webRuntime')
  const trustedHosts = Array.isArray(runtime?.trustedHosts) ? runtime.trustedHosts : []
  return (request) => isTrustedApiRequest(request, trustedHosts)
}

/** 统一 handler：围栏 → 方法分派 → 404 / 错误兜底。 */
function apiHandler(
  fence: (request: ServerRequest) => boolean,
  state: MermaidConfigState,
  onConfigChange: OnConfigChange,
): (request: ServerRequest, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (!fence(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const url = new URL(request.url ?? '/', 'http://dsh.internal')
    const method = url.pathname.startsWith(`${API_PREFIX}/`) ? url.pathname.slice(API_PREFIX.length + 1) : undefined
    try {
      if (await dispatch(method, request, response, state, onConfigChange)) return
      writeJson(response, 404, { ok: false, error: { message: 'unknown dsh-mermaid-render API method' } })
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
  state: MermaidConfigState,
  onConfigChange: OnConfigChange,
): Promise<boolean> {
  if (method !== 'config') return false
  if (request.method === 'GET') {
    writeJson(response, 200, { ok: true, value: { injectPrompt: state.injectPrompt } })
    return true
  }
  if (request.method === 'PUT') {
    await handleConfigPut(request, response, onConfigChange)
    return true
  }
  return false
}

/** 保存配置：归一化（非法值按默认 true）→ 持久化 + 内存（onConfigChange）。 */
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
  writeJson(response, 200, { ok: true, value: next })
}
