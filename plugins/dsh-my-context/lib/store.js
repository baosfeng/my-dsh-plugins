/**
 * dsh-my-context — session context stats store.
 *
 * 会话上下文统计的内存态 + 持久化：
 *  - 按会话隔离（bySession 分桶），查询/追加都限定在单个会话内；
 *  - 内存**默认有界**（issue #198 接入 dsh-shared 有界容器原语）：
 *    bySession 会话数上限 MAX_SESSIONS（LRU 淘汰最久未使用）、每会话请求记录
 *    MAX_REQUESTS_PER_SESSION、告警 MAX_ALERTS_PER_SESSION、溢出 MAX_OVERFLOWS_PER_SESSION
 *    （FIFO 淘汰），淘汰计数经 store.stats() 可观测；
 *  - 持久化 $DSH_HOME/context/context.json（写入调度防抖 500ms + 最小间隔 1s +
 *    串行链 + teardown flush），启动时异步加载（加载完成前的事件缓冲在 pending，
 *    加载后回放），重启后完整恢复；store.whenPersisted() 是确定性就绪信号。
 *
 * 持久化实现见 persist.js（attachPersistence 挂载 load/persist/scheduler）。
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
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
 * recordRequest, startTurn, recordAlert, recordOverflow, session, sessions,
 * stats, whenPersisted, dispose }。
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
    });
    store.recordOverflow = (sessionId, overflow) => mutate(handle, sessionId, (s) => {
        s.overflows.push({ id: nextId(handle), time: Date.now(), ...overflow });
    });
    store.session = (sessionId) => sessionOf(handle, sessionId);
    store.sessions = () => sessionsOf(handle);
    store.stats = () => resourceStats(handle);
    store.whenPersisted = () => handle.drainWrites?.() ?? Promise.resolve();
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
/** 记录一次模型请求：累加真实 usage + 快照构成进请求记录（FIFO 上限由 boundList 保证）。 */
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
}
/** 查询会话统计（深拷贝，防调用方篡改内部状态；LRU：读取即刷新活跃序）。 */
function sessionOf(handle, sessionId) {
    const session = handle.store.state.bySession.get(sessionId);
    if (session === undefined)
        return undefined;
    return JSON.parse(JSON.stringify(session));
}
/** 有统计的会话列表（按最后活动时间倒序）。 */
function sessionsOf(handle) {
    const list = [...handle.store.state.bySession.entries()]
        .map(([sessionId, session]) => ({
        sessionId,
        requests: session.requests.size,
        alerts: session.alerts.size,
        lastTime: session.updatedAt,
    }))
        .filter((entry) => entry.requests > 0 || entry.alerts > 0);
    list.sort((a, b) => b.lastTime - a.lastTime);
    return list;
}
/** 资源护栏统计：会话数 + 各级淘汰计数（资源观测/告警用）。 */
function resourceStats(handle) {
    const bySession = handle.store.state.bySession;
    let evictedRequests = 0;
    let evictedAlerts = 0;
    let evictedOverflows = 0;
    for (const session of bySession.values()) {
        evictedRequests += session.requests.evicted;
        evictedAlerts += session.alerts.evicted;
        evictedOverflows += session.overflows.evicted;
    }
    return {
        sessions: bySession.size,
        maxSessions: bySession.maxSize,
        evictedSessions: bySession.evicted,
        evictedRequests,
        evictedAlerts,
        evictedOverflows,
    };
}
/** 通用变更入口：取桶（LRU 刷新）→ 应用变更 → 标记时间 → 调度持久化。 */
function mutate(handle, sessionId, apply) {
    if (typeof sessionId !== 'string' || sessionId === '')
        return;
    const run = () => {
        const state = handle.store.state;
        let session = state.bySession.get(sessionId);
        if (session === undefined) {
            session = createSession(sessionId);
            state.bySession.set(sessionId, session);
        }
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
/** 卸载冲刷：回放未就绪缓冲 + 立即强写（scheduler.flush，跳过防抖/节流窗口）。 */
function dispose(handle) {
    if (!handle.ready) {
        const pending = handle.pending.splice(0);
        for (const run of pending)
            run();
    }
    void handle.persistNow?.();
}
