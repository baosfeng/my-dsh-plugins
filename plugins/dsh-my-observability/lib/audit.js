/**
 * dsh-my-observability — agent event audit listeners.
 *
 * 只读观察 DSH 生命周期事件并记录审计日志（agent 行为可追溯）：
 *  - `agent/status`        → `agent_status`（状态变化，含顶层/子代理标记）
 *  - `llm/stream`          → `llm_stream`（流开始/结束/错误 + chunk/字符统计；
 *                            waterfall，包装流透传全部 chunk）
 *  - `tools/pre-execute`   → `tool_call`（工具调用开始 + 参数摘要；透传 next）
 *  - `tools/execute`       → `tool_result`（工具结果 ok/失败 + 耗时；透传 next）
 *  - 插件事件（issue #154）→ `plugin_event`（插件关键行为：干预/ask 决策/
 *                            救场/校验/恢复，含插件名/事件名/动作/原因/参数）
 *
 * ⚠️ llm/stream 监听器必须保持同步函数：cordis waterfall 不 await listener
 * 返回值，next() 同步返回流；async listener 会让消费方（vision-toolkit 等
 * yield* 委托）拿到 Promise 而崩溃。tools/* 同理必须调用 next()。
 */
import { MAX_ARG_KEYS, MAX_TEXT_LEN } from './constants.js';
/**
 * 采集的插件事件名（按插件前缀显式注册，不依赖 cordis 通配符行为）。
 * 与 dsh-task-reliability/lib/emit.js 的 PLUGIN_EVENTS 保持一致；
 * 未来推广到其他插件（dsh-my-guardian 等）在此追加。
 */
const PLUGIN_EVENT_NAMES = [
    'task-reliability/intervention',
    'task-reliability/ask-decision',
    'task-reliability/rescue',
    'task-reliability/verify',
    'task-reliability/resume',
];
/** 注册全部审计监听；返回 disposer 数组（全部经 ctx.on 注册）。 */
export function attachAuditListeners(ctx, record) {
    return [
        ctx.on('session/event', (session, event) => handleSessionEvent(session, event, record)),
        ctx.on('agent/status', (payload) => handleStatus(payload, record)),
        ctx.on('llm/stream', (options, next) => handleStream(options, next, record)),
        ctx.on('tools/pre-execute', (exec, next) => handlePreExecute(exec, next, record)),
        ctx.on('tools/execute', (exec, next) => handleExecute(exec, next, record)),
        ...PLUGIN_EVENT_NAMES.map((name) => ctx.on(name, (payload) => handlePluginEvent(name, payload, record))),
    ];
}
/** 插件事件名 → 插件名（前缀补 dsh-，如 task-reliability → dsh-task-reliability）。 */
function pluginNameOf(name) {
    const prefix = name.split('/')[0];
    return prefix === '' ? name : `dsh-${prefix}`;
}
/** 插件事件名 → 事件名（去掉前缀，如 task-reliability/intervention → intervention）。 */
function eventNameOf(name) {
    const parts = name.split('/');
    return parts.length > 1 ? parts.slice(1).join('/') : name;
}
/** 插件事件 payload → 参数摘要（除 sessionId/action/reason 外的字段；字符串截断防膨胀）。 */
function summarizeParams(payload) {
    const params = {};
    for (const [key, value] of Object.entries(payload ?? {})) {
        if (key === 'sessionId' || key === 'action' || key === 'reason')
            continue;
        if (typeof value === 'string')
            params[key] = truncate(value);
        else if (typeof value === 'number' || typeof value === 'boolean')
            params[key] = value;
    }
    return params;
}
/**
 * 插件事件 → plugin_event 审计事件（与现有事件同时间线/同过滤/同导出）。
 * 无 sessionId 的插件事件不记录（与 agent_status 等一致）。
 */
function handlePluginEvent(name, payload, record) {
    const sessionId = payload?.sessionId;
    if (typeof sessionId !== 'string' || sessionId === '')
        return;
    const { type, data } = buildPluginEventData(name, payload);
    record({ type, sessionId, data });
}
function buildPluginEventData(name, payload) {
    const data = {
        plugin: pluginNameOf(name),
        event: eventNameOf(name),
        action: truncate(String(payload?.action ?? '')),
        reason: truncate(String(payload?.reason ?? '')),
        params: summarizeParams(payload),
    };
    const error = typeof payload?.error === 'string' && payload.error !== '' ? truncate(payload.error) : null;
    if (error !== null)
        data.error = error;
    return { type: error !== null ? 'plugin_error' : 'plugin_event', data };
}
/**
 * session/event → user_message 事件（会话标题来源）。
 * 轨迹回放面板需要"对话可读标题"而非 UUID：从每个会话真实用户的首条
 * 消息截断生成（跳过插件注入消息），面板 sessionsOf 取最早一条作为
 * title。不作为独立存储字段，走现有事件通路，重启后自然恢复。
 */
function handleSessionEvent(session, event, record) {
    if (event === null || typeof event !== 'object' || event.type !== 'user/message')
        return;
    const message = event.data;
    if (isPluginMessage(message))
        return;
    const sessionId = session?.id;
    if (typeof sessionId !== 'string' || sessionId === '')
        return;
    const text = userTextOf(message);
    if (text === '')
        return;
    record({ type: 'user_message', sessionId, data: { text: truncate(text) } });
}
/** 是否为插件注入的消息（非真实用户输入，不作为标题）。 */
function isPluginMessage(message) {
    const source = message?.source;
    return source !== null && typeof source === 'object' && source.kind === 'plugin';
}
/** 从 user message 提取文本（content 中全部 text block 拼接）。 */
function userTextOf(message) {
    if (message === null || typeof message !== 'object')
        return '';
    const content = message.content;
    if (!Array.isArray(content))
        return '';
    const parts = [];
    for (const block of content) {
        if (block !== null &&
            typeof block === 'object' &&
            block.type === 'text' &&
            typeof block.text === 'string') {
            parts.push(block.text);
        }
    }
    return parts.join(' ').trim();
}
/** agent/status → agent_status 事件（含顶层/子代理标记）。 */
function handleStatus(payload, record) {
    const agent = payload?.agent;
    if (agent === null || typeof agent !== 'object')
        return;
    record({
        type: 'agent_status',
        sessionId: typeof agent.id === 'string' ? agent.id : '',
        data: { status: String(payload?.status ?? ''), agentType: agentTypeOf(agent) },
    });
}
/** llm/stream → 包装流（同步返回；无 sessionId 时原样透传）。 */
function handleStream(options, next, record) {
    const sessionId = typeof options?.sessionId === 'string' ? options.sessionId : '';
    if (sessionId === '')
        return next();
    const stream = next();
    return wrapStream(sessionId, stream, record);
}
/** tools/pre-execute → tool_call 事件（透传 next）。 */
async function handlePreExecute(exec, next, record) {
    if (exec !== null && typeof exec === 'object' && typeof exec.agent?.id === 'string') {
        record({
            type: 'tool_call',
            sessionId: exec.agent.id,
            data: { name: String(exec.name ?? ''), args: summarizeArguments(exec.arguments) },
        });
    }
    return next();
}
/** tools/execute → tool_result 事件（透传 next 结果）。 */
async function handleExecute(exec, next, record) {
    const sessionId = exec?.agent?.id;
    const name = exec?.name;
    if (typeof sessionId !== 'string' || sessionId === '')
        return next();
    const startedAt = Date.now();
    const result = await next();
    record({
        type: 'tool_result',
        sessionId,
        data: {
            name: String(name ?? ''),
            ok: isToolOk(result),
            ms: Date.now() - startedAt,
        },
    });
    return result;
}
/** 顶层/子代理标记（白名单化：任何子代理标记命中即 subagent）。 */
function agentTypeOf(agent) {
    const header = agent.session?.header;
    if (header === undefined || header === null)
        return 'unknown';
    if (header.origin === 'subagent')
        return 'subagent';
    if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0)
        return 'subagent';
    return typeof agent.options?.subagentDepth === 'number' && agent.options.subagentDepth > 0 ? 'subagent' : 'top';
}
/** 工具结果 ok 判定：非对象视为成功；error 字段非空视为失败。 */
function isToolOk(result) {
    if (result === null || typeof result !== 'object')
        return true;
    const error = result.error;
    if (error === undefined || error === null)
        return true;
    return typeof error === 'object' && Object.keys(error).length === 0;
}
/** 参数摘要：键列表（上限）+ 主要文本参数摘要（上限），防审计膨胀。 */
function summarizeArguments(args) {
    if (args === null || typeof args !== 'object')
        return { keys: [] };
    const keys = Object.keys(args).slice(0, MAX_ARG_KEYS);
    const summary = textSummaryOf(args);
    return summary === '' ? { keys } : { keys, summary };
}
/** 主要文本参数（command/message/content/question 等）的截断摘要。 */
function textSummaryOf(args) {
    for (const key of ['command', 'message', 'content', 'question', 'description', 'prompt']) {
        const value = args[key];
        if (typeof value === 'string' && value !== '')
            return truncate(value);
    }
    return '';
}
/** 截断长文本（保留首段，去换行）。 */
function truncate(text) {
    const oneLine = text.split('\n')[0].trim();
    return oneLine.length > MAX_TEXT_LEN ? `${oneLine.slice(0, MAX_TEXT_LEN)}…` : oneLine;
}
/** 包装 llm 流：透传全部 chunk，记录开始/结束/错误统计。 */
function wrapStream(sessionId, stream, record) {
    let chunks = 0;
    let chars = 0;
    const startedAt = Date.now();
    record({ type: 'llm_stream', sessionId, data: { phase: 'start' } });
    return (async function* () {
        try {
            for await (const chunk of stream) {
                chunks += 1;
                if (chunk !== null && typeof chunk === 'object' && typeof chunk.text === 'string') {
                    chars += chunk.text.length;
                }
                yield chunk;
            }
            record({
                type: 'llm_stream',
                sessionId,
                data: streamSummary('end', startedAt, chunks, chars),
            });
        }
        catch (error) {
            record({
                type: 'llm_stream',
                sessionId,
                data: streamSummary('error', startedAt, chunks, chars, error),
            });
            throw error;
        }
    })();
}
/** 流结束/错误统计（错误消息截断）。 */
function streamSummary(phase, startedAt, chunks, chars, error) {
    const summary = {
        phase,
        chunks,
        chars,
        ms: Date.now() - startedAt,
    };
    if (error !== undefined) {
        const message = error instanceof Error ? error.message : String(error);
        summary.message = message.length > MAX_TEXT_LEN ? `${message.slice(0, MAX_TEXT_LEN)}…` : message;
    }
    return summary;
}
