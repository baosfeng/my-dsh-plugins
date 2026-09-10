/**
 * dsh-my-opencode-session-header — 配置解析与校验。
 *
 * cordis 插件 config 的运行时校验：空数组 / 非法值一律抛出明确错误
 * （loader 启动即失败，不静默降级成"插件没生效但又没提示"）。
 */

/** 会话头取值形态：uuid = 提取会话 id 中的裸 UUID（无则回退原串）；raw = 原始会话 id。 */
export type ValueMode = 'uuid' | 'raw'

/** 插件配置（cordis.patch.yml 的 config / profile 覆盖）。 */
export interface Config {
  /** 总开关（默认 true）。 */
  enabled?: boolean
  /** 命中哪些 provider 路由才注入（默认 opencode / opencode-go）。 */
  providers?: string[]
  /** 命中哪些主机（含子域）才注入（默认 opencode.ai）。 */
  hosts?: string[]
  /** 注入的请求头名（默认 x-opencode-session）。 */
  headerName?: string
  /** 取值形态（默认 uuid）。 */
  valueMode?: ValueMode
  /** 已有同名头时是否覆盖（默认 false = 不覆盖）。 */
  override?: boolean
}

/** 解析后的完整配置（所有字段必填）。 */
export interface ResolvedConfig {
  enabled: boolean
  providers: readonly string[]
  hosts: readonly string[]
  headerName: string
  valueMode: ValueMode
  override: boolean
}

const DEFAULT_PROVIDERS: readonly string[] = ['opencode', 'opencode-go']
const DEFAULT_HOSTS: readonly string[] = ['opencode.ai']
const DEFAULT_HEADER_NAME = 'x-opencode-session'

/** 主机名形态（裸主机名，无 scheme / 端口 / 路径）。 */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i

/** HTTP 头名 token 形态（RFC 7230）。 */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** 构造带插件前缀的配置错误。 */
export function configError(message: string): Error {
  return new Error(`[opencode-session-header] ${message}`)
}

/** 解析并校验插件配置（非法值抛错）。 */
export function resolveConfig(config: Config | null | undefined): ResolvedConfig {
  const source = (config ?? {}) as Record<string, unknown>
  return {
    enabled: booleanOf(source.enabled, 'enabled', true),
    providers: stringListOf(source.providers, 'providers', DEFAULT_PROVIDERS),
    hosts: hostListOf(source.hosts),
    headerName: headerNameOf(source.headerName),
    valueMode: valueModeOf(source.valueMode),
    override: booleanOf(source.override, 'override', false),
  }
}

/** 布尔字段校验（缺省用 fallback）。 */
function booleanOf(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw configError(`config.${field} must be a boolean`)
  return value
}

/** 非空字符串数组字段校验（缺省用 fallback）。 */
function stringListOf(value: unknown, field: string, fallback: readonly string[]): string[] {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.length === 0) {
    throw configError(`config.${field} must be a non-empty array of strings`)
  }
  for (const item of value) {
    if (typeof item !== 'string' || item === '') throw configError(`config.${field} entries must be non-empty strings`)
  }
  return value as string[]
}

/** hosts 字段：非空数组 + 每项必须是裸主机名。 */
function hostListOf(value: unknown): string[] {
  const hosts = stringListOf(value, 'hosts', DEFAULT_HOSTS)
  for (const host of hosts) {
    if (!HOST_PATTERN.test(host)) throw configError(`config.hosts entries must be bare host names (got "${host}")`)
  }
  return hosts
}

/** headerName 字段：合法 HTTP 头名。 */
function headerNameOf(value: unknown): string {
  if (value === undefined) return DEFAULT_HEADER_NAME
  if (typeof value !== 'string' || !HEADER_NAME_PATTERN.test(value)) {
    throw configError('config.headerName must be a valid HTTP header name')
  }
  return value
}

/** valueMode 字段：uuid | raw。 */
function valueModeOf(value: unknown): ValueMode {
  if (value === undefined) return 'uuid'
  if (value !== 'uuid' && value !== 'raw') throw configError('config.valueMode must be "uuid" or "raw"')
  return value
}
