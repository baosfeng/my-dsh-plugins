/**
 * dsh-my-remote — 设置页的字段模型（规整 / 合并 / 快照；issue #385）。
 *
 * 纯逻辑模块（无 IO、无 HTTP）：设置页暴露的 4 项 —— `apiToken`（掩码）/
 * `askTimeoutMs` / `approvalTimeoutMs` / `webhooks[]` —— 的默认值、校验与合并规则
 * 集中在这里，供端点、持久化与测试共用同一口径。
 *
 * 三条硬规则（都是验收项）：
 *  1. **非法值只忽略该字段并回退当前值，不整单拒绝**：一次提交四项，因一个字段
 *     非法丢掉其它合法修改，用户会误以为保存无效。
 *  2. **apiToken 掩码**：GET 只回 `apiTokenSet` 布尔，绝不回显明文；PUT 未提交
 *     （缺失 / 空串）= 不修改，保持原值。
 *  3. **headers 是设置页不暴露的字段**：按名称从原有条目继承，避免「改一次 url
 *     就把用户手写的鉴权头抹掉」。
 */
import type { ResolvedOptions, ServerRequest, WebhookConfig } from './types.js'
import type { ConfigDict } from './settings-yaml.js'

/** webhook 事件白名单（与 channels.ts 的事件 kind 一致）。 */
const EVENT_KINDS = new Set(['ask', 'approval', 'end'])

/** 设置页可写字段（GET 的 value 形状；**绝不含 apiToken 明文**）。 */
export interface SettingsSnapshot {
  apiTokenSet: boolean
  askTimeoutMs: number
  approvalTimeoutMs: number
  webhooks: Array<Pick<WebhookConfig, 'name' | 'url' | 'events' | 'enabled'>>
}

/** 设置端点的读写回调（由 index.ts 绑定生效 options、持久化与围栏）。 */
export interface SettingsPort {
  snapshot(): SettingsSnapshot
  save(payload: Record<string, unknown>): Promise<SaveResult>
  trusted(request: ServerRequest): boolean
}

/** 设置端点的依赖（由 index.ts 注入当前生效 options / 围栏 / 落盘）。 */
export interface SettingsDeps {
  options: ResolvedOptions
  fence: (request: ServerRequest) => boolean
  /** 落盘（合并该行已有配置由 settings-store 负责）。 */
  persist: (payload: Record<string, unknown>, next: ResolvedOptions) => Promise<void>
}

/** 保存结果（handler 据此映射状态码）。 */
export type SaveResult = { ok: true; value: SettingsSnapshot } | { ok: false; status: number }

/** 生效配置 → 设置页快照（apiToken 只回是否已配置）。 */
export function settingsSnapshot(options: ResolvedOptions): SettingsSnapshot {
  return {
    apiTokenSet: options.apiToken !== '',
    askTimeoutMs: normalizeTimeout(options.askTimeoutMs),
    approvalTimeoutMs: normalizeTimeout(options.approvalTimeoutMs),
    webhooks: (options.webhooks ?? []).map((webhook) => ({
      name: webhook.name,
      url: webhook.url,
      events: webhook.events,
      enabled: webhook.enabled,
    })),
  }
}

/** PUT payload 形状校验：非对象返回 undefined（调用方回 400 且不落盘）。 */
export function normalizeSettingsPayload(payload: unknown): Record<string, unknown> | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  return payload as Record<string, unknown>
}

/** 超时规整：非负整数生效，其余（负数 / NaN / 字符串）回退 fallback。 */
function normalizeTimeout(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
}

/** payload + 当前生效配置 → 新生效配置（逐字段规整，非法 / 缺失回退当前值）。 */
export function mergeSettings(payload: Record<string, unknown>, current: ResolvedOptions): ResolvedOptions {
  const token = payload.apiToken
  const webhooks = normalizeWebhooks(payload.webhooks, current.webhooks ?? [])
  return {
    end: current.end,
    ask: current.ask,
    approval: current.approval,
    apiToken: typeof token === 'string' && token !== '' ? token : current.apiToken,
    askTimeoutMs: normalizeTimeout(payload.askTimeoutMs, current.askTimeoutMs),
    approvalTimeoutMs: normalizeTimeout(payload.approvalTimeoutMs, current.approvalTimeoutMs),
    webhooks: webhooks ?? current.webhooks,
  }
}

/**
 * 保存即热生效：**原地**把新值写进 options 对象。
 *
 * 为什么是原地而不是替换引用：events.ts / channels.ts / routes.ts 在 apply 时捕获
 * 的是同一个 options 对象，替换引用只能让后来者的查询生效，已挂载的监听器仍读旧
 * 配置（表现为「保存成功但事件照旧推给旧 webhook」）。
 */
export function applySettings(options: ResolvedOptions, payload: Record<string, unknown>): ResolvedOptions {
  const next = mergeSettings(payload, options)
  options.apiToken = next.apiToken
  options.askTimeoutMs = next.askTimeoutMs
  options.approvalTimeoutMs = next.approvalTimeoutMs
  options.webhooks = next.webhooks
  return next
}

/** webhooks 字段规整：未提交 / 非数组 → undefined（保持当前值）。 */
function normalizeWebhooks(raw: unknown, current: WebhookConfig[]): WebhookConfig[] | undefined {
  if (raw === undefined || !Array.isArray(raw)) return undefined
  const byName = new Map(current.map((webhook) => [webhook.name, webhook]))
  return raw
    .map((entry) => normalizeWebhook(entry, byName.get(nameOf(entry))))
    .filter((entry): entry is WebhookConfig => entry !== undefined)
}

/** 条目名称（非对象 / 非字符串 → 空串）。 */
function nameOf(raw: unknown): string {
  if (raw === null || typeof raw !== 'object') return ''
  const name = (raw as Record<string, unknown>).name
  return typeof name === 'string' ? name : ''
}

/**
 * 单条 webhook 规整：name / url 必填（非字符串 → 丢弃该条，不整单拒绝）；
 * events 只保留白名单 kind；enabled 只认布尔；headers 未提交时按名称继承原条目。
 */
function normalizeWebhook(raw: unknown, previous: WebhookConfig | undefined): WebhookConfig | undefined {
  const entry = asEntry(raw)
  const basics = entry === undefined ? undefined : webhookBasics(entry)
  if (basics === undefined) return undefined
  const next: WebhookConfig = { ...basics }
  const events = normalizeEvents(entry!.events)
  if (events !== undefined) next.events = events
  if (typeof entry!.enabled === 'boolean') next.enabled = entry!.enabled
  const headers = headerEntries(entry!.headers) ?? previous?.headers
  if (headers !== undefined) next.headers = headers
  return next
}

/** 非空对象 → 字典（null / 数组 / 标量 → undefined）。 */
function asEntry(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  return raw as Record<string, unknown>
}

/** 名称 + url 必填（任一缺失 / 非字符串 → undefined = 丢弃该条）。 */
function webhookBasics(entry: Record<string, unknown>): WebhookConfig | undefined {
  const name = typeof entry.name === 'string' ? entry.name : ''
  const url = typeof entry.url === 'string' ? entry.url : ''
  return name === '' || url === '' ? undefined : { name, url }
}

/** events 白名单过滤（非数组 / 全被过滤 → undefined = 保持缺省「全部事件」）。 */
function normalizeEvents(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const events = raw.filter((event): event is string => EVENT_KINDS.has(event as string))
  return events.length > 0 ? events : undefined
}

/** headers 对象 → 字符串字典（非对象 / 无字符串值 → undefined）。 */
function headerEntries(raw: unknown): Record<string, string> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 本次提交的字段 → 该行 config 片段。
 *
 * 四项**都写**，但未提交的字段写「该行原有值」而不是生效值：既让文件始终完整可读
 * （重启后 loader 读到的就是这四个值），又不会用生效值覆盖用户手写内容（实测教训：
 * 只改 askTimeoutMs 却把生效值里空的 webhooks 写回 → 手写 webhook 整段丢失）。
 */
export function settingsPatch(
  payload: Record<string, unknown>,
  next: ResolvedOptions,
  existing: ConfigDict,
): ConfigDict {
  const submitted = payload.webhooks !== undefined
  return {
    apiToken: submittedToken(payload, next, existing),
    askTimeoutMs: payload.askTimeoutMs !== undefined ? next.askTimeoutMs : scalarOr(existing.askTimeoutMs, 0),
    approvalTimeoutMs:
      payload.approvalTimeoutMs !== undefined ? next.approvalTimeoutMs : scalarOr(existing.approvalTimeoutMs, 0),
    webhooks: submitted ? webhookEntries(next.webhooks ?? [], existing) : existingWebhooks(existing),
  }
}

/** token「未提交 / 空串 → 不修改」：保留该行原值，该行没有才用当前生效值。 */
function submittedToken(payload: Record<string, unknown>, next: ResolvedOptions, existing: ConfigDict): string {
  const submitted = payload.apiToken
  if (typeof submitted === 'string' && submitted !== '') return submitted
  return typeof existing.apiToken === 'string' ? existing.apiToken : next.apiToken
}

/** 该行原有标量值（缺失 / 非整数 → fallback）。 */
function scalarOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback
}

/** 该行原有 webhooks（非数组 → 空数组）。 */
function existingWebhooks(existing: ConfigDict): ConfigDict[] {
  return Array.isArray(existing.webhooks) ? (existing.webhooks as ConfigDict[]) : []
}

/**
 * 生效 webhook 列表 → 可序列化条目。
 *
 * headers 是设置页**刻意不暴露**的字段（可能含鉴权头）：GET 不回显它，提交时自然
 * 缺该键，故按**名称**从该行原有条目继承。
 */
function webhookEntries(webhooks: WebhookConfig[], existing: ConfigDict): ConfigDict[] {
  const previous = new Map(existingWebhooks(existing).map((entry) => [String(entry.name ?? ''), entry]))
  return webhooks.map((webhook) => {
    const entry: ConfigDict = { name: webhook.name, url: webhook.url }
    if (webhook.events !== undefined) entry.events = webhook.events
    if (webhook.enabled !== undefined) entry.enabled = webhook.enabled
    const headers = webhook.headers ?? previous.get(webhook.name)?.headers
    if (headers !== undefined) entry.headers = headers
    return entry
  })
}
