/**
 * dsh-session-title-gen — 设置页配置面（issue #385）：8 项配置的类型 / 默认值 / 规整。
 *
 * 纯逻辑模块（无 IO）：apply 侧用 {@link resolveConfig} 把 patch 行的 `config` 规整为
 * **生效值**；设置页侧用 {@link normalizeConfigPatch} 把 PUT payload 规整为下一次生效值。
 * 两者共用同一份 {@link DEFAULT_SETTINGS}，保证「设置页显示的默认值」与「运行时回退值」
 * 不会漂移（issue #385 验收项「非法值只忽略该字段并回退默认」）。
 *
 * 口径（与 README / docs/会话标题自动生成 记录一致）：
 *  - `enabled` 默认 true，只有显式 false 才禁用 —— 配置面不能让插件静默失效；
 *  - `template` 默认 `[{workspace}] {description}`，空串回退默认模板；
 *  - `provider` / `model` 默认 `''`（空串 = 跟随会话请求路由，不指定）；
 *  - 4 个数字项默认 80 / 4096 / 64 / 30000，非正整数一律回退默认。
 */
import type { ConfigDict } from 'dsh-shared'
import { DEFAULT_TEMPLATE } from './title.js'
import type { TitleConfig } from './title.js'

/** 应用层配置（cordis.patch.yml 插件行的 `config`；字段全可选）。 */
export interface Config {
  enabled?: boolean
  template?: string
  provider?: string
  model?: string
  maxTitleBytes?: number
  maxInputBytes?: number
  maxOutputTokens?: number
  timeoutMs?: number
}

/** 设置页配置（GET/PUT payload 的形状）：8 项全必填，`''` 表示「跟随会话」。 */
export interface SettingsConfig {
  enabled: boolean
  template: string
  provider: string
  model: string
  maxTitleBytes: number
  maxInputBytes: number
  maxOutputTokens: number
  timeoutMs: number
}

/** 8 项配置的默认值（唯一来源：apply 回退 / 设置页回填 / PUT 非法字段回退共用）。 */
export const DEFAULT_SETTINGS: SettingsConfig = {
  enabled: true,
  template: DEFAULT_TEMPLATE,
  provider: '',
  model: '',
  maxTitleBytes: 80,
  maxInputBytes: 4096,
  maxOutputTokens: 64,
  timeoutMs: 30000,
}

/** 设置页暴露的 8 个字段名（GET 契约的键集合；PUT 至少含其一才算一次可应用的提交）。 */
export const SETTINGS_FIELDS = [
  'enabled',
  'template',
  'provider',
  'model',
  'maxTitleBytes',
  'maxInputBytes',
  'maxOutputTokens',
  'timeoutMs',
] as const

/** 布尔字段规整：只认布尔，其余（含字符串 "false"）回退 fallback。 */
function normalizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 非空字符串规整：非字符串 / 空串回退 fallback（template 用）。 */
function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback
}

/** provider/model 规整：字符串（含空串 = 跟随会话）生效，其余回退 ''。 */
function normalizeFollow(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

/** 数字字段规整：只有正整数生效（0 / 负数 / NaN / 字符串一律回退默认）。 */
function normalizePositiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

/**
 * 单个字段取值：payload 里**有**该键 → 规整（非法值回退 fallback）；**没有**该键 → 保留
 * 当前生效值。这样「非法字段只忽略该字段」与「部分提交不清空其它字段」同时成立。
 */
function pick<T>(
  raw: Record<string, unknown>,
  key: string,
  current: T,
  fallback: T,
  normalize: (value: unknown, fallback: T) => T,
): T {
  return key in raw ? normalize(raw[key], fallback) : current
}

/** 应用层配置 → 生效值（8 项全必填；缺省 / 非法一律回退 {@link DEFAULT_SETTINGS}）。 */
export function resolveConfig(config?: Config | null): SettingsConfig {
  const source: Config = config ?? {}
  return {
    enabled: source.enabled !== false,
    template: normalizeString(source.template, DEFAULT_SETTINGS.template),
    provider: normalizeFollow(source.provider, DEFAULT_SETTINGS.provider),
    model: normalizeFollow(source.model, DEFAULT_SETTINGS.model),
    maxTitleBytes: normalizePositiveInt(source.maxTitleBytes, DEFAULT_SETTINGS.maxTitleBytes),
    maxInputBytes: normalizePositiveInt(source.maxInputBytes, DEFAULT_SETTINGS.maxInputBytes),
    maxOutputTokens: normalizePositiveInt(source.maxOutputTokens, DEFAULT_SETTINGS.maxOutputTokens),
    timeoutMs: normalizePositiveInt(source.timeoutMs, DEFAULT_SETTINGS.timeoutMs),
  }
}

/** payload 是否至少包含一个 8 项字段（`{}` / 空 body 不算一次可应用的提交 → 400）。 */
function hasSettingsField(raw: Record<string, unknown>): boolean {
  return SETTINGS_FIELDS.some((field) => field in raw)
}

/**
 * PUT payload → 生效值：非对象（null / 数组 / 标量）或**不含任何 8 项字段**（空 body /
 * `{}`）返回 undefined，调用方回 400 且**不落盘**；对象内**非法字段只忽略该字段并回退
 * 默认**（不整单拒绝——设置页一次提交 8 项，因一项非法而丢掉其余 7 项合法修改，用户会
 * 误以为保存无效）。
 */
export function normalizeConfigPatch(payload: unknown, current: SettingsConfig): SettingsConfig | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const raw = payload as Record<string, unknown>
  if (!hasSettingsField(raw)) return undefined
  return {
    enabled: pick(raw, 'enabled', current.enabled, DEFAULT_SETTINGS.enabled, normalizeBool),
    template: pick(raw, 'template', current.template, DEFAULT_SETTINGS.template, normalizeString),
    provider: pick(raw, 'provider', current.provider, DEFAULT_SETTINGS.provider, normalizeFollow),
    model: pick(raw, 'model', current.model, DEFAULT_SETTINGS.model, normalizeFollow),
    maxTitleBytes: pick(
      raw,
      'maxTitleBytes',
      current.maxTitleBytes,
      DEFAULT_SETTINGS.maxTitleBytes,
      normalizePositiveInt,
    ),
    maxInputBytes: pick(
      raw,
      'maxInputBytes',
      current.maxInputBytes,
      DEFAULT_SETTINGS.maxInputBytes,
      normalizePositiveInt,
    ),
    maxOutputTokens: pick(
      raw,
      'maxOutputTokens',
      current.maxOutputTokens,
      DEFAULT_SETTINGS.maxOutputTokens,
      normalizePositiveInt,
    ),
    timeoutMs: pick(raw, 'timeoutMs', current.timeoutMs, DEFAULT_SETTINGS.timeoutMs, normalizePositiveInt),
  }
}

/** 生效值 → 标题生成配置：空串 provider/model 转 undefined（走会话请求路由）。 */
export function toTitleConfig(settings: SettingsConfig): TitleConfig {
  return {
    template: settings.template,
    provider: settings.provider === '' ? undefined : settings.provider,
    model: settings.model === '' ? undefined : settings.model,
    maxTitleBytes: settings.maxTitleBytes,
    maxInputBytes: settings.maxInputBytes,
    maxOutputTokens: settings.maxOutputTokens,
    timeoutMs: settings.timeoutMs,
  }
}

/** 落盘形状：8 项中空串 provider/model **不写键**（保持 patch 文件干净，读回时空串）。 */
function patchEntries(next: SettingsConfig): ConfigDict {
  const entries: ConfigDict = {
    enabled: next.enabled,
    template: next.template,
    maxTitleBytes: next.maxTitleBytes,
    maxInputBytes: next.maxInputBytes,
    maxOutputTokens: next.maxOutputTokens,
    timeoutMs: next.timeoutMs,
  }
  if (next.provider !== '') entries.provider = next.provider
  if (next.model !== '') entries.model = next.model
  return entries
}

/**
 * 合并落盘条目：保留该行**用户手写的其它键**（如 `disabled`、私有实验字段），只覆盖本次
 * 提交的 8 项；provider/model 置空则删除该键（否则旧值留在文件里被读回，形成「设置页显示空、
 * 实际仍生效」的幽灵配置）。调用方负责先读该行已有 config（见 config-routes.ts）。
 */
export function mergePatchEntries(existing: ConfigDict, next: SettingsConfig): ConfigDict {
  const merged: ConfigDict = { ...existing }
  if (next.provider === '') delete merged.provider
  if (next.model === '') delete merged.model
  return { ...merged, ...patchEntries(next) }
}
