/**
 * dsh-my-context — event listeners.
 *
 * 只读观察 DSH 会话事件并统计上下文（不改变流程）：
 *  - `session/event` (session, event)：处理 request/header（system+tools
 *    估算）、request/context（模型/上下文窗口）、user/message（user/inject
 *    构成）、assistant/message（assistant 构成 + 真实 usage 记录请求）、
 *    tool/result（tool 构成）、turn/start（轮内计数重置）；
 *  - `agent/pre-step` (payload, next)：预算拦截点——超限时 warn 记录告警
 *    透传 next()，deny 返回 { kind: 'reject' } 结束本轮（blocked）。
 *
 * ⚠️ waterfall 契约：agent/pre-step 监听器必须先 await next() 拿到下游
 * 决策再决定是否覆盖；warn 模式一律原样返回下游决策。绝不吞掉 next()。
 */
import { estimateMessage, estimateSystem, estimateTools, isEmptyMessage } from './meter.js';
import { checkBudget } from './budget.js';
import { overflowLevel, isOverflowing } from './overflow.js';
/** 告警冷却（同一会话同一 scope 的重复告警间隔，防刷屏）。 */
const ALERT_COOLDOWN_MS = 60000;
/** 注册全部上下文监听；返回 disposer 数组（全部经 ctx.on 注册）。 */
export function attachContextListeners(ctx, store, options) {
    const cooldown = new Map();
    const overflowCooldown = new Map();
    return [
        ctx.on('session/event', (...args) => {
            const [session, event] = args;
            handleSessionEvent(session, event, store);
        }),
        ctx.on('agent/pre-step', (...args) => {
            const [payload, next] = args;
            return handlePreStep(payload, next, store, options, cooldown, overflowCooldown);
        }),
    ];
}
/** session/event → 上下文统计（只读观察，无返回值）。 */
function handleSessionEvent(session, event, store) {
    const sessionId = session?.id;
    if (typeof sessionId !== 'string' || sessionId === '')
        return;
    const handler = EVENT_HANDLERS[event?.type];
    if (handler !== undefined)
        handler(store, sessionId, event?.data);
}
/** 事件类型 → 处理器映射（switch 替代，控制复杂度）。 */
const EVENT_HANDLERS = {
    'request/header': (store, sessionId, data) => handleHeader(store, sessionId, data),
    'request/context': (store, sessionId, data) => store.updateContext(sessionId, {
        model: data?.model,
        provider: data?.provider,
        contextWindow: data?.contextWindow,
    }),
    'user/message': (store, sessionId, data) => store.addMessage(sessionId, isInjection(data?.source) ? 'inject' : 'user', estimateMessage(data)),
    'assistant/message': (store, sessionId, data) => handleAssistant(store, sessionId, data),
    'tool/result': (store, sessionId, data) => store.addMessage(sessionId, 'tool', estimateMessage(data?.message)),
    'turn/start': (store, sessionId, data) => store.startTurn(sessionId, data?.turn),
};
/** request/header：system prompt + tools 估算 + 模型路由。 */
function handleHeader(store, sessionId, data) {
    const header = data?.header;
    if (header === null || typeof header !== 'object')
        return;
    const system = typeof header.system === 'string' ? header.system : '';
    const tools = Array.isArray(header.tools) ? header.tools : [];
    store.updateHeader(sessionId, {
        system,
        tools,
        systemTokens: estimateSystem(system),
        toolsTokens: estimateTools(tools),
        model: header.config?.model,
        provider: header.config?.provider,
    });
}
/** assistant/message：assistant 构成 + 真实 usage 记录请求。 */
function handleAssistant(store, sessionId, data) {
    const message = data?.message;
    if (!isEmptyMessage(message))
        store.addMessage(sessionId, 'assistant', estimateMessage(message));
    if (data?.usage !== null &&
        typeof data?.usage === 'object') {
        store.recordRequest(sessionId, {
            turn: data.turn,
            step: data.step,
            usage: data.usage,
        });
    }
}
/** agent/pre-step：预算检查 → warn 告警 / deny 拦截；溢出预警（不阻塞）。 */
async function handlePreStep(payload, next, store, options, cooldown, overflowCooldown) {
    const sessionId = payload?.agent?.id;
    if (typeof sessionId !== 'string' || sessionId === '')
        return next();
    const session = store.session(sessionId);
    if (session === undefined)
        return next();
    recordOverflowIfNeeded(store, session, options, overflowCooldown);
    const decision = checkBudget(session.usage, session.turnUsage, options.current);
    if (decision.ok)
        return next();
    const blocked = options.current.mode === 'deny';
    if (withinCooldown(cooldown, sessionId, decision.scope)) {
        return blocked ? { kind: 'reject' } : next();
    }
    cooldown.set(`${sessionId}:${decision.scope}`, Date.now());
    store.recordAlert(sessionId, {
        kind: 'budget',
        scope: decision.scope,
        limit: decision.limit,
        used: decision.used,
        mode: options.current.mode,
        blocked,
    });
    return blocked ? { kind: 'reject' } : next();
}
/** 溢出分级命中预警级别时记录预警事件（同一会话同一级别 60s 冷却）。 */
function recordOverflowIfNeeded(store, session, options, cooldown) {
    // 口径 = 当前上下文长度（最近一次请求 prompt），而非历史累计 usage：
    // 累计 usage 中 cacheRead 每轮重复累加，会把占用虚高到数倍于窗口。
    const outcome = overflowLevel(session.lastPromptTokens, session.contextWindow, options.overflow);
    if (!isOverflowing(outcome.level))
        return;
    const scope = `overflow:${outcome.level}`;
    if (withinCooldown(cooldown, session.sessionId, scope))
        return;
    cooldown.set(`${session.sessionId}:${scope}`, Date.now());
    store.recordOverflow(session.sessionId, {
        kind: 'overflow',
        level: outcome.level,
        ratio: outcome.ratio,
        used: outcome.used,
        window: outcome.window,
        threshold: outcome.threshold,
    });
}
/** 告警冷却判定：冷却期内返回 true（不重复记录）。 */
function withinCooldown(cooldown, sessionId, scope) {
    const last = cooldown.get(`${sessionId}:${scope}`);
    return typeof last === 'number' && Date.now() - last < ALERT_COOLDOWN_MS;
}
/** 注入判定：source.kind 非 'user' 或带 form 的注入来源。 */
export function isInjection(source) {
    return (source !== null &&
        typeof source === 'object' &&
        ((typeof source.kind === 'string' &&
            source.kind !== '' &&
            source.kind !== 'user') ||
            typeof source.form === 'string'));
}
