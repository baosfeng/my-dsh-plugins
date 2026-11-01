/**
 * dsh-my-notify — 配置类路由（GET info / GET+PUT config / GET webhooks）
 * 与配置规整（fail-open）。
 *
 * 拆分自原 routes.ts（文件尺寸门禁）：本文件只负责「配置的读写与校验」，
 * 路由注册壳在 routes.ts，预览/变量在 notify-preview-route.ts，远程触发在
 * notify-trigger-route.ts。
 *
 * 校验口径：
 *  - 顶层字段（开关 / token / dedupeMs / askMode / webhooks / quietHours）非法
 *    时整批 400（保持历史行为）；
 *  - 高级字段（sound / toast / system / messages）与 webhook 新字段
 *    （titleTemplate / bodyTemplate / card / retry）逐项 fail-open：坏值回退
 *    默认值，不丢弃整条配置。
 */
import { readJsonBody, writeJson } from 'dsh-shared';
import { VAR_GROUPS } from './notify/vars.js';
import { normalizeMessages, normalizeSound, normalizeSystem, normalizeToast } from './notify/config.js';
import { resolveMessages } from './notify/defaults.js';
/** 渠道白名单。 */
export const CHANNELS = new Set(['wecom', 'feishu', 'dingtalk', 'generic']);
/** 事件白名单（含子代理结束 subagentEnd，与 messages / 设置页勾选一致）。 */
export const EVENT_KINDS = new Set(['end', 'ask', 'approval', 'remote', 'subagentEnd']);
/** 渠道 → 允许的消息类型（generic 恒为 text；非法值回 text，绝不把 interactive 改写）。 */
const MSG_TYPES = {
    wecom: ['text', 'markdown'],
    dingtalk: ['text', 'markdown'],
    feishu: ['text', 'post', 'interactive'],
};
/** 飞书卡片配色白名单（13 色，与 notify/card.ts 的 CARD_COLORS 一致）。 */
const CARD_TEMPLATES = new Set([
    'blue',
    'wathet',
    'turquoise',
    'green',
    'yellow',
    'orange',
    'red',
    'carmine',
    'violet',
    'purple',
    'indigo',
    'grey',
    'default',
]);
/** 卡片字段白名单：设计器短键（token/duration/tool/question/link）+ 变量全名。 */
const CARD_FIELD_KEYS = new Set([
    'token',
    'duration',
    'tool',
    'question',
    'link',
    ...VAR_GROUPS.flatMap((group) => group.items.map((item) => item.name)),
]);
/** 信息查询：当前触发开关（apiToken 只暴露是否启用，绝不暴露值）。 */
export function infoValue(options) {
    return {
        end: options.end,
        ask: options.ask,
        approval: options.approval,
        subagentEnd: options.subagentEnd,
        remoteEnabled: true,
        apiToken: options.apiToken !== '',
        dedupeMs: options.dedupeMs,
        askMode: options.askMode,
        quietHours: options.quietHours,
    };
}
/** 配置查询：当前生效配置（设置页表单回填；apiToken 为明文，仅本机可读）。 */
export function configValue(options) {
    return {
        end: options.end,
        ask: options.ask,
        approval: options.approval,
        subagentEnd: options.subagentEnd,
        apiToken: options.apiToken,
        dedupeMs: options.dedupeMs,
        askMode: options.askMode,
        webBaseUrl: options.webBaseUrl,
        webhooks: options.webhooks,
        quietHours: options.quietHours,
        sound: options.sound,
        toast: options.toast,
        system: options.system,
        messages: options.messages,
    };
}
/** 出站 webhook 状态：当前配置列表 + 失败记录（设置页可见）。 */
export function webhooksValue(options, webhookStore) {
    return {
        webhooks: options.webhooks,
        failures: webhookStore?.failures?.list() ?? [],
    };
}
/** 保存配置：校验 → 持久化 + 更新内存 + 重载监听器（onConfigChange）。 */
export async function handleConfigPut(request, response, onConfigChange) {
    const payload = await readJsonBody(request);
    const next = normalizeConfig(payload);
    if (next === undefined) {
        writeJson(response, 400, { ok: false, error: { message: 'invalid config' } });
        return;
    }
    await onConfigChange(next);
    writeJson(response, 200, { ok: true });
}
/** 校验并规整配置 payload（部分字段合法，缺失字段不校验）；非法输入返回 undefined。 */
function normalizeConfig(payload) {
    if (payload === null || typeof payload !== 'object')
        return undefined;
    const p = payload;
    const result = {};
    const booleans = normalizeBooleans(p, ['end', 'ask', 'approval', 'subagentEnd']);
    if (booleans === undefined)
        return undefined;
    Object.assign(result, booleans);
    const apiToken = normalizeStringField(p, 'apiToken');
    if (apiToken === undefined)
        return undefined;
    Object.assign(result, apiToken);
    const webBaseUrl = normalizeStringField(p, 'webBaseUrl');
    if (webBaseUrl === undefined)
        return undefined;
    Object.assign(result, webBaseUrl);
    const askMode = normalizeAskMode(p);
    if (askMode === undefined)
        return undefined;
    Object.assign(result, askMode);
    const dedupeMs = normalizeDedupeMs(p);
    if (dedupeMs === undefined)
        return undefined;
    Object.assign(result, dedupeMs);
    const webhooks = normalizeWebhooksField(p);
    if (webhooks === undefined)
        return undefined;
    Object.assign(result, webhooks);
    const quietHours = normalizeQuietHoursField(p);
    if (quietHours === undefined)
        return undefined;
    Object.assign(result, quietHours);
    // 高级配置（sound / toast / system / messages）：逐字段 fail-open ——
    // 坏字段回退默认值、不拒绝整个请求，避免手写配置让保存整批失败。
    Object.assign(result, normalizeAdvanced(p));
    return result;
}
/** 规整 sound / toast / system / messages（缺失字段跳过；坏值回退默认值）。 */
function normalizeAdvanced(payload) {
    const result = {};
    if (payload.sound !== undefined)
        result.sound = normalizeSound(payload.sound);
    if (payload.toast !== undefined)
        result.toast = normalizeToast(payload.toast);
    if (payload.system !== undefined)
        result.system = normalizeSystem(payload.system);
    if (payload.messages !== undefined)
        result.messages = resolveMessages(normalizeMessages(payload.messages));
    return result;
}
/** 规整 askMode（full/summary）；缺失跳过；非法返回 undefined。 */
function normalizeAskMode(payload) {
    if (payload.askMode === undefined)
        return {};
    if (payload.askMode !== 'full' && payload.askMode !== 'summary')
        return undefined;
    return { askMode: payload.askMode };
}
/** 规整布尔字段组（缺失跳过；任一非法返回 undefined）。 */
function normalizeBooleans(payload, keys) {
    const result = {};
    for (const key of keys) {
        if (payload[key] === undefined)
            continue;
        if (typeof payload[key] !== 'boolean')
            return undefined;
        result[key] = payload[key];
    }
    return result;
}
/** 规整字符串字段（缺失返回空对象；非法返回 undefined）。 */
function normalizeStringField(payload, key) {
    if (payload[key] === undefined)
        return {};
    if (typeof payload[key] !== 'string')
        return undefined;
    return { [key]: payload[key] };
}
/** 规整 dedupeMs（缺失返回空对象；非法返回 undefined）。 */
function normalizeDedupeMs(payload) {
    if (payload.dedupeMs === undefined)
        return {};
    if (!Number.isFinite(payload.dedupeMs))
        return undefined;
    return { dedupeMs: payload.dedupeMs };
}
/** 规整 webhooks 字段（缺失返回空对象；非法返回 undefined）。 */
function normalizeWebhooksField(payload) {
    if (payload.webhooks === undefined)
        return {};
    const webhooks = normalizeWebhooks(payload.webhooks);
    if (webhooks === undefined)
        return undefined;
    return { webhooks };
}
/** 校验 webhooks 数组（对象数组，逐项规整）；任一非法返回 undefined。 */
function normalizeWebhooks(value) {
    if (!Array.isArray(value))
        return undefined;
    const result = [];
    for (const item of value) {
        const webhook = normalizeWebhook(item);
        if (webhook === undefined)
            return undefined;
        result.push(webhook);
    }
    return result;
}
/** 校验单个 webhook 的必填与白名单字段；通过后交给 composeWebhook 组装。 */
function normalizeWebhook(item) {
    if (item === null || typeof item !== 'object')
        return undefined;
    const w = item;
    if (!isNonEmptyString(w.name))
        return undefined;
    if (!isNonEmptyString(w.url))
        return undefined;
    const channel = w.channel ?? 'generic';
    if (!CHANNELS.has(channel))
        return undefined;
    const events = normalizeEvents(w.events);
    if (events === undefined)
        return undefined;
    return composeWebhook(w, channel, events);
}
/**
 * 组装 webhook：模板字段非空才落字段，card / retry 逐项 fail-open 规整——
 * 坏值回退默认值，而不是丢弃整条配置或整体 400（设置页卡片设计器不被清空）。
 */
function composeWebhook(w, channel, events) {
    const result = {
        name: w.name,
        channel: channel,
        url: w.url,
        secret: typeof w.secret === 'string' ? w.secret : '',
        events,
        enabled: w.enabled !== false,
        msgType: normalizeMsgType(channel, w.msgType),
        template: strOrEmpty(w.template),
        card: normalizeWebhookCard(w.card),
        retry: normalizeWebhookRetry(w.retry),
    };
    const titleTemplate = normalizeTemplate(w.titleTemplate);
    if (titleTemplate !== undefined)
        result.titleTemplate = titleTemplate;
    const bodyTemplate = normalizeTemplate(w.bodyTemplate);
    if (bodyTemplate !== undefined)
        result.bodyTemplate = bodyTemplate;
    return result;
}
/** 消息类型：按渠道白名单；generic 恒 text；非法值回 text（interactive 不被改写）。 */
function normalizeMsgType(channel, value) {
    const allowed = MSG_TYPES[channel];
    if (allowed === undefined || typeof value !== 'string')
        return 'text';
    return (allowed.includes(value) ? value : 'text');
}
/** 模板字段：非字符串或空白 → undefined（不落空串，避免覆盖默认文案）。 */
function normalizeTemplate(value) {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
/** 卡片配置：schemaVersion / 13 色配色 / 字段白名单 / @ 列表 / 开关，逐项回退默认。 */
function normalizeWebhookCard(value) {
    const v = isRecord(value) ? value : {};
    return {
        schemaVersion: v.schemaVersion === '1.0' ? '1.0' : '2.0',
        // 空串 / 非法值 = 未指定配色（留空而不是写 'default'）——否则 card.ts 会把
        // 'default' 当显式色，按事件自动配色（accentByKind）永久失效
        template: typeof v.template === 'string' && CARD_TEMPLATES.has(v.template) ? v.template : '',
        fields: normalizeCardFields(v.fields),
        buttonText: strOrEmpty(v.buttonText),
        mentionOpenIds: normalizeMentionIds(v.mentionOpenIds),
        mentionAll: v.mentionAll === true,
        accentByKind: v.accentByKind !== false,
    };
}
/** 卡片字段：只保留白名单项（去空白 / 去重 / 上限 10），非数组回空数组。 */
function normalizeCardFields(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const result = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const key = item.trim();
        if (key === '' || !CARD_FIELD_KEYS.has(key) || seen.has(key))
            continue;
        seen.add(key);
        result.push(key);
        if (result.length >= 10)
            break;
    }
    return result;
}
/** @ 列表：只保留非空、无空白与 `<>=&` 的 id（防注入），上限 20。 */
function normalizeMentionIds(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const result = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const id = item.trim();
        if (id === '' || id.length > 64 || /[\s<>=&]/.test(id) || seen.has(id))
            continue;
        seen.add(id);
        result.push(id);
        if (result.length >= 20)
            break;
    }
    return result;
}
/** 重试配置：attempts 0-5（默认 3）、backoffMs 100-60000（默认 1000）；坏值回默认。 */
function normalizeWebhookRetry(value) {
    const v = isRecord(value) ? value : {};
    return {
        attempts: clampInt(v.attempts, 3, 0, 5),
        backoffMs: clampInt(v.backoffMs, 1000, 100, 60_000),
    };
}
/** 整数取值：非有限回退 fallback，否则夹到 [min, max]。 */
function clampInt(value, fallback, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
}
/** 对象判定。 */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** 字符串字段规整：缺失/非字符串回退空串。 */
function strOrEmpty(value) {
    return typeof value === 'string' ? value : '';
}
/** 校验事件选择（EVENT_KINDS 子集，去重）；缺省空数组 = 全部。 */
function normalizeEvents(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        return undefined;
    for (const event of value) {
        if (!EVENT_KINDS.has(event))
            return undefined;
    }
    return [...new Set(value)];
}
/** 规整免打扰字段（缺失返回空对象；非法返回 undefined）。 */
function normalizeQuietHoursField(payload) {
    if (payload.quietHours === undefined)
        return {};
    const qh = normalizeQuietHours(payload.quietHours);
    if (qh === undefined)
        return undefined;
    return { quietHours: qh };
}
/** 校验 quietHours 对象；非法返回 undefined。 */
function normalizeQuietHours(value) {
    if (value === null || typeof value !== 'object')
        return undefined;
    const q = value;
    if (typeof q.enabled !== 'boolean')
        return undefined;
    if (!isHHmm(q.start) || !isHHmm(q.end))
        return undefined;
    return { enabled: q.enabled, start: q.start, end: q.end };
}
/** "HH:mm" 格式校验（含值范围：小时 0-23，分钟 0-59）。 */
function isHHmm(value) {
    if (typeof value !== 'string')
        return false;
    const m = /^(\d{2}):(\d{2})$/.exec(value);
    if (!m)
        return false;
    return Number(m[1]) <= 23 && Number(m[2]) <= 59;
}
/** 非空字符串判定。 */
function isNonEmptyString(value) {
    return typeof value === 'string' && value !== '';
}
