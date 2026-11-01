/**
 * dsh-my-notify — 预览类路由（GET variables / POST preview）。
 *
 * 拆分自原 routes.ts（文件尺寸门禁）：本文件是设置页「实时预览」的数据源——
 * 变量目录 + 用样例数据（或 sample 覆盖）渲染一次，返回
 * `{ card, text, vars }`（card 为飞书卡片 JSON，text 为该渠道正文，
 * vars 为该次渲染的变量快照，供 UI 悬浮展示变量值）。
 */
import { readJsonBody, writeJson } from 'dsh-shared';
import { VAR_GROUPS, buildVars } from './notify/vars.js';
import { render } from './notify/template.js';
import { buildFeishuCard } from './notify/card.js';
import { normalizeCard } from './notify/config.js';
import { DEFAULT_MESSAGES, messageKeyOf } from './notify/defaults.js';
import { fieldLabelOf, fieldVarOf, messageLine } from './notify/channels.js';
import { CHANNELS, EVENT_KINDS } from './notify-config-route.js';
/** 变量目录（设置页变量库面板）。 */
export function variablesValue() {
    return VAR_GROUPS;
}
/**
 * 预览：按 kind / channel 用样例数据（或 sample 覆盖）渲染一次，返回
 * `{ card, text, vars }`。
 */
export async function handlePreview(request, response, options) {
    const payload = (await readJsonBody(request));
    writeJson(response, 200, { ok: true, value: buildPreview(payload, options) });
}
/** 构造预览结果（纯计算，路由与测试共用）。 */
function buildPreview(payload, options) {
    const p = payload ?? {};
    const kind = pickKind(p.kind);
    const channel = pickChannel(p.channel);
    const notice = mergeSample(SAMPLE_NOTICES[kind] ?? SAMPLE_NOTICES.end, p.sample);
    const time = timeOf(notice);
    const vars = buildVars({ ...notice, channel, time });
    const key = messageKeyOf(kind, notice.agentType);
    const context = {
        title: previewTitle(p, options.messages, key, vars),
        text: previewText(p, options.messages, key, vars, notice),
        vars,
        time,
    };
    return { card: previewCard(p.card, kind, notice, context), text: context.text, vars };
}
/** 预览事件类型：白名单内原样，否则回退 end。 */
function pickKind(value) {
    return typeof value === 'string' && EVENT_KINDS.has(value) ? value : 'end';
}
/** 预览渠道：白名单内原样，否则回退 feishu。 */
function pickChannel(value) {
    return typeof value === 'string' && CHANNELS.has(value) ? value : 'feishu';
}
/** 预览时间：样本指定值优先，否则当前时间。 */
function timeOf(notice) {
    return typeof notice.time === 'number' ? notice.time : Date.now();
}
/** 标题：显式 titleTemplate 优先，空渲染结果回退 messages 模板。 */
function previewTitle(payload, messages, key, vars) {
    const explicit = render(stringOf(payload.titleTemplate), vars);
    return explicit !== '' ? explicit : render(messages[key].title, vars);
}
/**
 * 正文：显式 bodyTemplate（或旧 template）优先；用户改过 messages[key].body
 * 时用它；否则回退渠道默认富格式（否则预览只剩一行摘要，看不到 token / 耗时 / 链接）。
 */
function previewText(payload, messages, key, vars, notice) {
    const bodyTemplate = strOr(stringOf(payload.bodyTemplate), stringOf(payload.template));
    if (bodyTemplate !== '')
        return render(bodyTemplate, vars);
    const custom = messages[key].body !== DEFAULT_MESSAGES[key].body;
    return custom ? render(messages[key].body, vars) : messageLine(notice);
}
/** 卡片：card 配置 fail-open 规整后交给 buildFeishuCard。 */
function previewCard(value, kind, notice, context) {
    const card = normalizeCard(value);
    return buildFeishuCard({
        kind,
        agentType: notice.agentType,
        title: context.title,
        content: context.text,
        fields: resolvePreviewFields(card.fields ?? [], context.vars),
        buttonText: card.buttonText ?? '',
        sessionUrl: typeof notice.sessionUrl === 'string' ? notice.sessionUrl : '',
        mentionOpenIds: card.mentionOpenIds ?? [],
        mentionAll: card.mentionAll === true,
        template: card.template ?? '',
        accentByKind: card.accentByKind !== false,
        schemaVersion: card.schemaVersion === '1.0' ? '1.0' : '2.0',
        time: context.time,
    });
}
/** 预览字段：card.fields 变量名 → 值快照（缺值跳过，与真实推送一致）。 */
function resolvePreviewFields(names, vars) {
    const fields = [];
    for (const name of names) {
        const value = vars[fieldVarOf(name)];
        if (value === undefined || value.trim() === '')
            continue;
        fields.push({ label: fieldLabelOf(name), value });
    }
    return fields;
}
/** 预览样例：四类事件（end 的子代理形态由 sample.agentType 切换）。 */
const SAMPLE_NOTICES = {
    end: {
        kind: 'end',
        sessionId: 'ses_demo',
        title: '演示项目',
        note: '',
        agentType: 'top',
        tokens: { input: 1200, output: 800, total: 2000, cacheRead: 300, cacheWrite: 100, reasoning: 50, requests: 3 },
        duration: 83,
        sessionUrl: 'https://dsh.local/sessions/ses_demo',
        cwd: '/Users/me/demo',
        model: 'deepseek-v4',
        provider: 'deepseek',
        preset: 'default',
    },
    ask: {
        kind: 'ask',
        sessionId: 'ses_demo',
        title: '演示项目',
        note: '确认部署',
        agentType: 'top',
        question: '问题 1：确认部署到生产环境？',
        questions: ['确认部署到生产环境？'],
    },
    approval: {
        kind: 'approval',
        sessionId: 'ses_demo',
        title: '演示项目',
        note: 'sandbox escalation',
        toolName: 'bash',
        agentType: 'top',
    },
    remote: { kind: 'remote', sessionId: '', title: '演示项目', note: '构建成功', agentType: 'top' },
};
/** sample 覆盖字段的取值类型（不合类型的样本值直接忽略，绝不让预览抛错）。 */
const SAMPLE_FIELD_KINDS = {
    sessionId: 'string',
    title: 'string',
    note: 'string',
    toolName: 'string',
    agentType: 'string',
    sessionUrl: 'string',
    question: 'string',
    cwd: 'string',
    model: 'string',
    provider: 'string',
    preset: 'string',
    parentId: 'string',
    duration: 'numberOrNull',
    time: 'number',
    questions: 'list',
    tokens: 'tokens',
};
/** 可被 sample 覆盖的字段（顺序即覆盖顺序）。 */
const SAMPLE_FIELDS = Object.keys(SAMPLE_FIELD_KINDS);
/** sample 覆盖：逐字段按类型替换（类型不符的样本值忽略）。 */
function mergeSample(base, sample) {
    if (sample === null || typeof sample !== 'object')
        return { ...base };
    const source = sample;
    const out = { ...base };
    for (const key of SAMPLE_FIELDS) {
        const value = source[key];
        if (value === undefined)
            continue;
        if (acceptSampleValue(key, value))
            out[key] = value;
    }
    return out;
}
/** 样本值类型判定：按 SAMPLE_FIELD_KINDS 声明的类型接受。 */
function acceptSampleValue(key, value) {
    const kind = SAMPLE_FIELD_KINDS[key];
    if (kind === 'string')
        return typeof value === 'string';
    if (kind === 'number')
        return typeof value === 'number' && Number.isFinite(value);
    if (kind === 'numberOrNull')
        return value === null || isFiniteNumber(value);
    if (kind === 'list')
        return Array.isArray(value);
    if (kind === 'tokens')
        return value === null || isRecord(value);
    return false;
}
/** 有限数值判定。 */
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
/** 对象判定（排除 null / 数组）。 */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** 字符串取值：非字符串回退空串。 */
function stringOf(value) {
    return typeof value === 'string' ? value : '';
}
/** 优先值：first 非空用 first，否则用 fallback。 */
function strOr(first, fallback) {
    return first !== '' ? first : fallback;
}
