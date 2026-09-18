import { DEFAULT_TEMPLATE } from './title.js';
/** 8 项配置的默认值（唯一来源：apply 回退 / 设置页回填 / PUT 非法字段回退共用）。 */
export const DEFAULT_SETTINGS = {
    enabled: true,
    template: DEFAULT_TEMPLATE,
    provider: '',
    model: '',
    maxTitleBytes: 80,
    maxInputBytes: 4096,
    maxOutputTokens: 64,
    timeoutMs: 30000,
};
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
];
/** 布尔字段规整：只认布尔，其余（含字符串 "false"）回退 fallback。 */
function normalizeBool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
/** 非空字符串规整：非字符串 / 空串回退 fallback（template 用）。 */
function normalizeString(value, fallback) {
    return typeof value === 'string' && value !== '' ? value : fallback;
}
/** provider/model 规整：字符串（含空串 = 跟随会话）生效，其余回退 ''。 */
function normalizeFollow(value, fallback) {
    return typeof value === 'string' ? value.trim() : fallback;
}
/** 数字字段规整：只有正整数生效（0 / 负数 / NaN / 字符串一律回退默认）。 */
function normalizePositiveInt(value, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}
/**
 * 单个字段取值：payload 里**有**该键 → 规整（非法值回退 fallback）；**没有**该键 → 保留
 * 当前生效值。这样「非法字段只忽略该字段」与「部分提交不清空其它字段」同时成立。
 */
function pick(raw, key, current, fallback, normalize) {
    return key in raw ? normalize(raw[key], fallback) : current;
}
/** 应用层配置 → 生效值（8 项全必填；缺省 / 非法一律回退 {@link DEFAULT_SETTINGS}）。 */
export function resolveConfig(config) {
    const source = config ?? {};
    return {
        enabled: source.enabled !== false,
        template: normalizeString(source.template, DEFAULT_SETTINGS.template),
        provider: normalizeFollow(source.provider, DEFAULT_SETTINGS.provider),
        model: normalizeFollow(source.model, DEFAULT_SETTINGS.model),
        maxTitleBytes: normalizePositiveInt(source.maxTitleBytes, DEFAULT_SETTINGS.maxTitleBytes),
        maxInputBytes: normalizePositiveInt(source.maxInputBytes, DEFAULT_SETTINGS.maxInputBytes),
        maxOutputTokens: normalizePositiveInt(source.maxOutputTokens, DEFAULT_SETTINGS.maxOutputTokens),
        timeoutMs: normalizePositiveInt(source.timeoutMs, DEFAULT_SETTINGS.timeoutMs),
    };
}
/** payload 是否至少包含一个 8 项字段（`{}` / 空 body 不算一次可应用的提交 → 400）。 */
function hasSettingsField(raw) {
    return SETTINGS_FIELDS.some((field) => field in raw);
}
/**
 * PUT payload → 生效值：非对象（null / 数组 / 标量）或**不含任何 8 项字段**（空 body /
 * `{}`）返回 undefined，调用方回 400 且**不落盘**；对象内**非法字段只忽略该字段并回退
 * 默认**（不整单拒绝——设置页一次提交 8 项，因一项非法而丢掉其余 7 项合法修改，用户会
 * 误以为保存无效）。
 */
export function normalizeConfigPatch(payload, current) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
        return undefined;
    const raw = payload;
    if (!hasSettingsField(raw))
        return undefined;
    return {
        enabled: pick(raw, 'enabled', current.enabled, DEFAULT_SETTINGS.enabled, normalizeBool),
        template: pick(raw, 'template', current.template, DEFAULT_SETTINGS.template, normalizeString),
        provider: pick(raw, 'provider', current.provider, DEFAULT_SETTINGS.provider, normalizeFollow),
        model: pick(raw, 'model', current.model, DEFAULT_SETTINGS.model, normalizeFollow),
        maxTitleBytes: pick(raw, 'maxTitleBytes', current.maxTitleBytes, DEFAULT_SETTINGS.maxTitleBytes, normalizePositiveInt),
        maxInputBytes: pick(raw, 'maxInputBytes', current.maxInputBytes, DEFAULT_SETTINGS.maxInputBytes, normalizePositiveInt),
        maxOutputTokens: pick(raw, 'maxOutputTokens', current.maxOutputTokens, DEFAULT_SETTINGS.maxOutputTokens, normalizePositiveInt),
        timeoutMs: pick(raw, 'timeoutMs', current.timeoutMs, DEFAULT_SETTINGS.timeoutMs, normalizePositiveInt),
    };
}
/** 生效值 → 标题生成配置：空串 provider/model 转 undefined（走会话请求路由）。 */
export function toTitleConfig(settings) {
    return {
        template: settings.template,
        provider: settings.provider === '' ? undefined : settings.provider,
        model: settings.model === '' ? undefined : settings.model,
        maxTitleBytes: settings.maxTitleBytes,
        maxInputBytes: settings.maxInputBytes,
        maxOutputTokens: settings.maxOutputTokens,
        timeoutMs: settings.timeoutMs,
    };
}
/** 落盘形状：8 项中空串 provider/model **不写键**（保持 patch 文件干净，读回时空串）。 */
function patchEntries(next) {
    const entries = {
        enabled: next.enabled,
        template: next.template,
        maxTitleBytes: next.maxTitleBytes,
        maxInputBytes: next.maxInputBytes,
        maxOutputTokens: next.maxOutputTokens,
        timeoutMs: next.timeoutMs,
    };
    if (next.provider !== '')
        entries.provider = next.provider;
    if (next.model !== '')
        entries.model = next.model;
    return entries;
}
/**
 * 合并落盘条目：保留该行**用户手写的其它键**（如 `disabled`、私有实验字段），只覆盖本次
 * 提交的 8 项；provider/model 置空则删除该键（否则旧值留在文件里被读回，形成「设置页显示空、
 * 实际仍生效」的幽灵配置）。调用方负责先读该行已有 config（见 config-routes.ts）。
 */
export function mergePatchEntries(existing, next) {
    const merged = { ...existing };
    if (next.provider === '')
        delete merged.provider;
    if (next.model === '')
        delete merged.model;
    return { ...merged, ...patchEntries(next) };
}
