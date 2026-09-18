/**
 * dsh-my-remote — 设置页端点（设置 → 插件 → 远程控制；issue #385）。
 *
 * 暴露 4 项配置的可视化编辑：`apiToken`（掩码）/ `askTimeoutMs` /
 * `approvalTimeoutMs` / `webhooks[]`（列表编辑器）。其余字段（end / ask / approval
 * 事件开关、webhook 的自定义 headers）继续由用户在 cordis.patch.yml 手写 ——
 * **保存不得连带覆盖它们**。
 *
 * 模块分工：
 *  - settings-model.ts：字段规整 / 合并 / 快照（纯逻辑）
 *  - settings-yaml.ts ：该行 config 的 YAML 读写（含 extractConfig 解析不了的嵌套列表）
 *  - settings-store.ts：写回 profile patch（先合并已有键）
 *  - 本文件          ：常量、HTTP handler、端口装配
 *
 * 安全：端点与 /remote/api 共用同一 loopback + trustedHosts 围栏；GET 绝不回显
 * apiToken 明文（只回 `apiTokenSet`）；PUT 未提交 / 空串的 token 保持原值。
 */
import { readJsonBody, writeJson } from 'dsh-shared'
import type { ServerRequest, ServerResponse } from './types.js'
import { applySettings, mergeSettings, normalizeSettingsPayload, settingsSnapshot } from './settings-model.js'
import type { SaveResult, SettingsDeps, SettingsPort, SettingsSnapshot } from './settings-model.js'
export type { SettingsDeps } from './settings-model.js'

export { persistSettings, SETTINGS_ROW_ID } from './settings-store.js'
export { readRowConfig } from './settings-yaml.js'
export type { SettingsPort, SettingsSnapshot } from './settings-model.js'

/**
 * 设置端点前缀。**刻意与既有 `/remote/api` 分开**：宿主 `WebServer.register` 对
 * 重复 (kind, path) 直接抛错，两条 prefix 路由同址会让后一条注册失败（实测：
 * 设置路由用 `/remote/api` → `webserver: duplicate prefix route "/remote/api"`）。
 * 围栏与信任上下文复用同一契约（loopback + trustedHosts），只是路径独立。
 */
export const SETTINGS_ROUTE_PREFIX = '/remote/settings/api'

/** 设置端点路径（GET 读 / PUT 写）。 */
export const SETTINGS_ROUTE_PATH = `${SETTINGS_ROUTE_PREFIX}/settings`

/** token 掩码（client 端「已配置」提示用；服务端只回 apiTokenSet，不回值）。 */
export const TOKEN_MASK = '••••••••'

/**
 * 设置端点读写端口（GET 快照 / PUT 保存 + 立即热生效）。
 *
 * 保存顺序刻意是「先落盘、后改内存」：落盘失败时内存生效值保持原样，
 * 绝不出现「界面显示已保存、重启后配置回滚」的假成功。
 */
export function createSettingsPort(deps: SettingsDeps): SettingsPort {
  return {
    snapshot: () => settingsSnapshot(deps.options),
    trusted: deps.fence,
    save: (payload) => runSave(deps, payload),
  }
}

/** 保存：合并 → 落盘 → 原地更新内存；落盘失败回 500（内存不被污染）。 */
async function runSave(deps: SettingsDeps, payload: Record<string, unknown>): Promise<SaveResult> {
  const next = mergeSettings(payload, deps.options)
  try {
    await deps.persist(payload, next)
  } catch {
    return { ok: false, status: 500 }
  }
  applySettings(deps.options, payload)
  return { ok: true, value: settingsSnapshot(deps.options) }
}

/** PUT 处理结果：200 + 快照 / 400 非法 payload / 500 落盘失败。 */
type PutOutcome = { status: number; value?: SettingsSnapshot }

/** 请求路径是否命中设置端点。 */
function isSettingsPath(request: ServerRequest): boolean {
  return new URL(request.url ?? '/', 'http://dsh.internal').pathname === SETTINGS_ROUTE_PATH
}

/** PUT 请求体 → 保存（非法 payload 400 / 落盘失败 500）。 */
async function handleSettingsPut(request: ServerRequest, port: SettingsPort): Promise<PutOutcome> {
  let payload: Record<string, unknown> | undefined
  try {
    payload = normalizeSettingsPayload(await readJsonBody(request))
  } catch {
    payload = undefined
  }
  if (payload === undefined) return { status: 400 }
  const saved = await port.save(payload)
  return saved.ok ? { status: 200, value: saved.value } : { status: saved.status }
}

/** 构造设置端点 handler：围栏 → GET 回快照 / PUT 保存 → 未知 path·方法 404。 */
export function createSettingsHandler(port: SettingsPort) {
  return async (request: ServerRequest, response: ServerResponse): Promise<void> => {
    if (!port.trusted(request)) {
      writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    if (isSettingsPath(request) && request.method === 'GET') {
      writeJson(response, 200, { ok: true, value: port.snapshot() })
      return
    }
    if (isSettingsPath(request) && request.method === 'PUT') {
      writePutOutcome(response, await handleSettingsPut(request, port))
      return
    }
    writeJson(response, 404, { ok: false, error: { message: 'unknown dsh-my-remote settings API method' } })
  }
}

/** PUT 结果 → HTTP 响应（成功回快照，失败回 ok:false + 原因）。 */
function writePutOutcome(response: ServerResponse, outcome: PutOutcome): void {
  if (outcome.status === 200) {
    writeJson(response, 200, { ok: true, value: outcome.value })
    return
  }
  const message = outcome.status === 400 ? 'invalid config' : 'config write failed'
  writeJson(response, outcome.status, { ok: false, error: { message } })
}
