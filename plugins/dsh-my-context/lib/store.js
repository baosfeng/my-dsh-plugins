/**
 * dsh-my-context — session context stats store.
 *
 * 会话上下文统计的内存态 + 持久化：
 *  - 按会话隔离（bySession 分桶），查询/追加都限定在单个会话内；
 *  - 每会话请求记录上限（MAX_REQUESTS_PER_SESSION，FIFO 淘汰）与告警上限
 *    （MAX_ALERTS_PER_SESSION），防无限膨胀；
 *  - 持久化 $DSH_HOME/context/context.json（防抖 500ms + 原子写
 *    tmp+rename + teardown flush），启动时异步加载（加载完成前的事件
 *    缓冲在 pending，加载后回放），重启后完整恢复。
 *
 * 持久化实现见 persist.js（attachPersistence 挂载 load/persist/dispose）。
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { MAX_REQUESTS_PER_SESSION, MAX_ALERTS_PER_SESSION, MAX_OVERFLOWS_PER_SESSION } from './constants.js';
import { createState, createSession, zeroUsage } from './state.js';
import { attachPersistence } from './persist.js';
/** 统计数据文件：$DSH_HOME/context/context.json（fallback ~/.dsh/…）。 */
export function stateFile() {
    const home = process.env.DSH_HOME;
    const base = typeof home === 'string' && home !== '' ? home : homedir();
    return join(base, 'context', 'context.json');
}
/**
 * 创建上下文统计存储：{ state, updateHeader, updateContext, addMessage,
 * recordRequest, startTurn, recordAlert, session, sessions, dispose }。
 * 所有写操作在状态加载完成前缓冲（不丢事件）；dispose 冲刷未落盘数据。
 */
export function createStore(ctx) {
    const store = { state: createState() };
    const handle = {
        ctx: ctx,
        file: stateFile(),
        store: store,
        pending: [],
        ready: false,
        persistTimer: null,
        dirtyChain: Promise.resolve(),
        seq: 0,
    };
    store.updateHeader = (sessionId, header) => mutate(handle, sessionId, (s) => applyHeader(s, header));
    store.updateContext = (sessionId, info) => mutate(handle, sessionId, (s) => applyContext(s, info));
    store.addMessage = (sessionId, category, tokens) => mutate(handle, sessionId, (s) => {
        ;
        s.composition[category] += numberOr(tokens, 0);
    });
    store.recordRequest = (sessionId, request) => mutate(handle, sessionId, (s) => applyRequest(s, request));
    store.startTurn = (sessionId, turn) => mutate(handle, sessionId, (s) => {
        s.turnUsage = { turn: numberOr(turn, 0), ...zeroUsage() };
    });
    store.recordAlert = (sessionId, alert) => mutate(handle, sessionId, (s) => {
        s.alerts.push({ id: nextId(handle), time: Date.now(), ...alert });
        if (s.alerts.length > MAX_ALERTS_PER_SESSION) {
            s.alerts.splice(0, s.alerts.length - MAX_ALERTS_PER_SESSION);
        }
    });
    store.recordOverflow = (sessionId, overflow) => mutate(handle, sessionId, (s) => {
        s.overflows.push({ id: nextId(handle), time: Date.now(), ...overflow });
        if (s.overflows.length > MAX_OVERFLOWS_PER_SESSION) {
            s.overflows.splice(0, s.overflows.length - MAX_OVERFLOWS_PER_SESSION);
        }
    });
    store.session = (sessionId) => sessionOf(handle, sessionId);
    store.sessions = () => sessionsOf(handle);
    store.dispose = () => dispose(handle);
    attachPersistence(handle);
    return store;
}
/** 请求头更新：system/tools 构成 = 当前请求头估算（覆盖式）。 */
function applyHeader(session, header) {
    session.header = {
        system: typeof header.system === 'string' ? header.system : '',
        tools: Array.isArray(header.tools) ? header.tools : [],
        systemTokens: numberOr(header.systemTokens, 0),
        toolsTokens: numberOr(header.toolsTokens, 0),
    };
    session.composition.system = session.header.systemTokens;
    session.composition.tools = session.header.toolsTokens;
    if (typeof header.model === 'string' && header.model !== '')
        session.model = header.model;
    if (typeof header.provider === 'string' && header.provider !== '')
        session.provider = header.provider;
}
/** 请求上下文更新（模型/提供方/上下文窗口）。 */
function applyContext(session, info) {
    if (typeof info.model === 'string' && info.model !== '')
        session.model = info.model;
    if (typeof info.provider === 'string' && info.provider !== '')
        session.provider = info.provider;
    if (typeof info.contextWindow === 'number' && info.contextWindow > 0)
        session.contextWindow = info.contextWindow;
}
/** 记录一次模型请求：累加真实 usage + 快照构成进请求记录。 */
function applyRequest(session, request) {
    const usage = request.usage;
    if (usage !== null && typeof usage === 'object') {
        addUsage(session.usage, usage);
        addUsage(session.turnUsage, usage);
    }
    const prompt = promptOf(usage);
    const output = numberOr(usage?.outputTokens, 0);
    const cacheRead = numberOr(usage?.cacheReadTokens, 0);
    const cacheWrite = numberOr(usage?.cacheWriteTokens, 0);
    const composition = session.composition;
    // 当前上下文长度 = 最近一次请求的 prompt（含缓存命中部分）；
    // 历史累计 usage 会把每轮重复的 cacheRead 累加，导致占用比例虚高。
    session.lastPromptTokens = prompt;
    session.requests.push({
        turn: numberOr(request.turn, 0),
        step: numberOr(request.step, 0),
        time: Date.now(),
        prompt,
        output,
        cacheRead,
        cacheWrite,
        total: prompt + output,
        system: composition.system,
        tools: composition.tools,
        user: composition.user,
        inject: composition.inject,
        assistant: composition.assistant,
        tool: composition.tool,
    });
    if (session.requests.length > MAX_REQUESTS_PER_SESSION) {
        session.requests.splice(0, session.requests.length - MAX_REQUESTS_PER_SESSION);
    }
}
/** 查询会话统计（深拷贝，防调用方篡改内部状态）。 */
function sessionOf(handle, sessionId) {
    const session = handle.store.state.bySession[sessionId];
    if (session === undefined)
        return undefined;
    return JSON.parse(JSON.stringify(session));
}
/** 有统计的会话列表（按最后活动时间倒序）。 */
function sessionsOf(handle) {
    const entries = Object.entries(handle.store.state.bySession);
    const list = entries
        .map(([sessionId, session]) => ({
        sessionId,
        requests: session.requests.length,
        alerts: session.alerts.length,
        lastTime: session.updatedAt,
    }))
        .filter((entry) => entry.requests > 0 || entry.alerts > 0);
    list.sort((a, b) => b.lastTime - a.lastTime);
    return list;
}
/** 通用变更入口：取桶 → 应用变更 → 标记时间 → 调度持久化。 */
function mutate(handle, sessionId, apply) {
    if (typeof sessionId !== 'string' || sessionId === '')
        return;
    const run = () => {
        const state = handle.store.state;
        const session = state.bySession[sessionId] ?? (state.bySession[sessionId] = createSession(sessionId));
        apply(session);
        session.updatedAt = Date.now();
        handle.persistSoon?.();
    };
    if (handle.ready)
        run();
    else
        handle.pending.push(run);
}
/** 请求 prompt token：input + cacheRead + cacheWrite（disjoint 还原）。 */
function promptOf(usage) {
    if (usage === null || typeof usage !== 'object')
        return 0;
    return numberOr(usage.inputTokens, 0) + numberOr(usage.cacheReadTokens, 0) + numberOr(usage.cacheWriteTokens, 0);
}
/** 累加 usage 到目标桶。 */
function addUsage(target, usage) {
    target.inputTokens += numberOr(usage.inputTokens, 0);
    target.outputTokens += numberOr(usage.outputTokens, 0);
    target.cacheReadTokens += numberOr(usage.cacheReadTokens, 0);
    target.cacheWriteTokens += numberOr(usage.cacheWriteTokens, 0);
    target.reasoningTokens += numberOr(usage.reasoningTokens, 0);
}
function numberOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
/** 告警自增 id。 */
function nextId(handle) {
    handle.seq += 1;
    return handle.seq;
}
/** 卸载冲刷：清定时器 + 回放未就绪缓冲 + 立即落盘。 */
function dispose(handle) {
    if (handle.persistTimer !== null) {
        clearTimeout(handle.persistTimer);
        handle.persistTimer = null;
    }
    if (!handle.ready) {
        const pending = handle.pending.splice(0);
        for (const run of pending)
            run();
    }
    handle.persistNow?.();
    void handle.dirtyChain;
}
