/**
 * dsh-my-observability — 设置页配置端点（GET/PUT /observability/api/config，issue #383）。
 *
 * 设置 → 插件 → 可观测性 面板只暴露 README 已记录的 `aiReview` /
 * `aiTimeoutMs` 两项；其余字段（aiProvider / aiModel / aiCwd /
 * resourceIntervalMs / resourceLimits）继续由用户在 cordis.patch.yml 手写，
 * 设置页保存不得连带覆盖它们。
 *
 * 写回复用 dsh-shared 的配置持久化原语（currentProfile / patchFileOf /
 * writePatchConfig），并**先合并该条目已有键**：writePatchConfig 的语义是
 * 「删除同 id 旧条目 → 追加新条目」，只写两项会把用户手写的其余配置一起删掉
 * （数据破坏，issue #383 验收项「不写坏配置」）。
 */
import { readFile } from 'node:fs/promises'
import { currentProfile, extractConfig, patchFileOf, readJsonBody, writeJson, writePatchConfig } from 'dsh-shared'
import type { ConfigDict } from 'dsh-shared'
import type { ServerRequest, ServerResponse } from './types.js'

/** 设置页可写配置（ObservabilityOptions 中暴露到设置页的两项）。 */
export interface SettingsConfig {
  aiReview: boolean
  aiTimeoutMs: number
}

/** aiTimeoutMs 默认值（与 src/index.ts buildOptions 的兜底共用同一口径）。 */
const DEFAULT_AI_TIMEOUT_MS = 60000

/**
 * 写回行 id：必须与 plugins/dsh-my-observability/cordis.patch.yml 里的插件行
 * id 一致——loader 按行 id 匹配配置，id 不符会新增孤儿行、原行配置不变。
 */
const CONFIG_ROW_ID = 'observability'

/** aiTimeoutMs 规整：非数字 / 非有限 / 非正 → 回退默认（绝不把 0/NaN 写进 patch）。
 *  导出供 src/index.ts 的 buildOptions 复用，保证「默认值口径」只有一处定义。
 *  （其余仅本文件内部使用的符号不导出：knip 会把无外部引用的导出判为 dead code。） */
export function normalizeTimeout(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_AI_TIMEOUT_MS
}

/** 当前生效配置（GET 的 value，也是设置页表单的回填源）。 */
function configValueOf(options: SettingsConfig): SettingsConfig {
  return { aiReview: options.aiReview !== false, aiTimeoutMs: normalizeTimeout(options.aiTimeoutMs) }
}

/**
 * 校验 + 规整 PUT payload：非对象 → undefined（调用方回 400）。
 *
 * 非法**字段**只忽略该字段、不整单拒绝：设置页一次提交两项，因一个字段非法
 * 而丢掉另一项合法修改，用户会误以为保存无效（issue #383 验收项「非法值回退
 * 默认」）；aiTimeoutMs 非法时回退默认而非保留旧值，与 README 记录的默认口径
 * 一致。
 */
function normalizeConfigPatch(payload: unknown, current: SettingsConfig): SettingsConfig | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const raw = payload as Record<string, unknown>
  const next: SettingsConfig = { aiReview: current.aiReview, aiTimeoutMs: current.aiTimeoutMs }
  if (typeof raw.aiReview === 'boolean') next.aiReview = raw.aiReview
  if (raw.aiTimeoutMs !== undefined) next.aiTimeoutMs = normalizeTimeout(raw.aiTimeoutMs)
  return next
}

/** 读取 patch 文件中该行已有的 config 块（文件不存在 / 解析失败 → 空对象）。 */
async function readExistingConfig(file: string): Promise<ConfigDict> {
  try {
    return extractConfig(await readFile(file, 'utf8'), CONFIG_ROW_ID) ?? {}
  } catch {
    return {}
  }
}

/** 写回 profile 层 patch 文件：合并已有键后整体重写（保留用户手写的其他配置）。 */
export async function persistSettingsConfig(config: SettingsConfig): Promise<void> {
  const file = patchFileOf(currentProfile())
  const existing = await readExistingConfig(file)
  await writePatchConfig(file, CONFIG_ROW_ID, { ...existing, ...config })
}

/**
 * 分派配置端点：GET 返回当前生效值；PUT 校验 → 写回 + 即时生效。
 * 未匹配（含其他动词）返回 false，交由调用方回 404（保持既有路由契约）。
 */
export async function dispatchConfigRoutes(
  method: string | undefined,
  request: ServerRequest,
  response: ServerResponse,
  options: SettingsConfig,
  onChange: (next: SettingsConfig) => Promise<void>,
): Promise<boolean> {
  if (method !== 'config') return false
  if (request.method === 'GET') {
    writeJson(response, 200, { ok: true, value: configValueOf(options) })
    return true
  }
  if (request.method !== 'PUT') return false
  const next = normalizeConfigPatch(await readJsonBody(request), configValueOf(options))
  if (next === undefined) {
    writeJson(response, 400, { ok: false, error: { message: 'invalid config' } })
    return true
  }
  await onChange(next)
  writeJson(response, 200, { ok: true, value: next })
  return true
}
