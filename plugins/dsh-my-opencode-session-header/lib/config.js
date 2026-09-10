/**
 * dsh-my-opencode-session-header — 配置解析与校验。
 *
 * cordis 插件 config 的运行时校验：空数组 / 非法值一律抛出明确错误
 * （loader 启动即失败，不静默降级成"插件没生效但又没提示"）。
 */
const DEFAULT_PROVIDERS = ['opencode', 'opencode-go'];
const DEFAULT_HOSTS = ['opencode.ai'];
const DEFAULT_HEADER_NAME = 'x-opencode-session';
/** 主机名形态（裸主机名，无 scheme / 端口 / 路径）。 */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
/** HTTP 头名 token 形态（RFC 7230）。 */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** 构造带插件前缀的配置错误。 */
export function configError(message) {
    return new Error(`[opencode-session-header] ${message}`);
}
/** 解析并校验插件配置（非法值抛错）。 */
export function resolveConfig(config) {
    const source = (config ?? {});
    return {
        enabled: booleanOf(source.enabled, 'enabled', true),
        providers: stringListOf(source.providers, 'providers', DEFAULT_PROVIDERS),
        hosts: hostListOf(source.hosts),
        headerName: headerNameOf(source.headerName),
        valueMode: valueModeOf(source.valueMode),
        override: booleanOf(source.override, 'override', false),
    };
}
/** 布尔字段校验（缺省用 fallback）。 */
function booleanOf(value, field, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'boolean')
        throw configError(`config.${field} must be a boolean`);
    return value;
}
/** 非空字符串数组字段校验（缺省用 fallback）。 */
function stringListOf(value, field, fallback) {
    if (value === undefined)
        return [...fallback];
    if (!Array.isArray(value) || value.length === 0) {
        throw configError(`config.${field} must be a non-empty array of strings`);
    }
    for (const item of value) {
        if (typeof item !== 'string' || item === '')
            throw configError(`config.${field} entries must be non-empty strings`);
    }
    return value;
}
/** hosts 字段：非空数组 + 每项必须是裸主机名。 */
function hostListOf(value) {
    const hosts = stringListOf(value, 'hosts', DEFAULT_HOSTS);
    for (const host of hosts) {
        if (!HOST_PATTERN.test(host))
            throw configError(`config.hosts entries must be bare host names (got "${host}")`);
    }
    return hosts;
}
/** headerName 字段：合法 HTTP 头名。 */
function headerNameOf(value) {
    if (value === undefined)
        return DEFAULT_HEADER_NAME;
    if (typeof value !== 'string' || !HEADER_NAME_PATTERN.test(value)) {
        throw configError('config.headerName must be a valid HTTP header name');
    }
    return value;
}
/** valueMode 字段：uuid | raw。 */
function valueModeOf(value) {
    if (value === undefined)
        return 'uuid';
    if (value !== 'uuid' && value !== 'raw')
        throw configError('config.valueMode must be "uuid" or "raw"');
    return value;
}
