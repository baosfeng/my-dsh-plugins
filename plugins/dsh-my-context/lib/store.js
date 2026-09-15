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
 *    加载后回放），重启后完整恢复。
 *
 * **就绪信号（issue #335 同族第 5 例的修复）**——两种就绪必须分开：
 *  - `store.whenReady()`：**加载就绪**。磁盘状态已合并 + 缓冲变更已回放之后 resolve；
 *    `await` 之后 `session()/sessions()/stats()` 的查询结果与磁盘 IO 耗时无关。
 *  - `store.whenPersisted()`：**落盘就绪**。等价于 `whenReady()` + 写链 drain，
 *    返回后「此刻内存态的变更」必已落盘。
 *  此前只有 `whenPersisted()`（= 裸 drain），加载未完成时它**立即 resolve**，
 *  于是测试只能靠 `await settle(80)` 赌 readFile 回调跑完 —— CI 容器高负载下必输。
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
 * 等 store 加载就绪（issue #335）——**所有读路径在查询前都要过这一关**。
 *
 * 为什么必须有：`store.session()` 在加载未完成时返回 `undefined`，而
 * `handlePreStep` 这类读路径原本遇到 `undefined` 会**静默 `return next()`**
 * ——预算超限既不告警也不拦截。也就是说「启动期是否拦住第一次超预算请求」
 * 取决于 readFile 回调有没有抢在事件前面，这是不折不扣的生产缺陷（不只是测试 flake），
 * 且表现是**静默降级**，没有任何日志。`await whenReadyOf(store)` 之后查询语义
 * 与 IO 耗时无关；就绪后 whenReady() 立即 resolve，无可感知延迟。
 *
 * 容错：store 没有 whenReady（老 mock / 其它实现的 store）时按「已就绪」处理，
 * 不引入新的失败面。
 */
export async function whenReadyOf(store) {
    const ready = store?.whenReady;
    if (typeof ready === 'function')
        await ready.call(store);
}
/**
 * 创建上下文统计存储：{ state, updateHeader, updateContext, addMessage,
 * recordRequest, startTurn, recordAlert, recordOverflow, session, sessions,
 * stats, whenReady, whenPersisted, dispose }。
 * 所有写操作在状态加载完成前缓冲（不丢事件）；dispose 冲刷未落盘数据。
 */
export function createStore(ctx) {
    const store = { state: createState() };
    // 加载就绪信号（issue #335）：在 attachPersistence 发起 readFile **之前**建好 promise，
    // 由 onLoaded 在「磁盘状态合并 + pending 回放」之后 resolve —— createStore 返回后
    // 调用方立刻就能 await，不存在「信号还没建好」的窗口。
    let markReady = () => { };
    const readyPromise = new Promise((resolve) => {
        markReady = resolve;
    });
    const handle = {
        ctx: ctx,
        file: stateFile(),
        store: store,
        pending: [],
        ready: false,
        dirty: false,
        seq: 0,
        readyPromise,
        markReady,
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
    // 加载就绪（issue #335）：await 之后查询必已包含磁盘状态 + 全部缓冲变更。
    store.whenReady = () => handle.readyPromise;
    // 落盘就绪：先等加载（否则变更还在 pending，drain 无事可做），再 drain 写链。
    // 这样「await whenPersisted() ⇒ 此刻的变更已落盘」才名副其实。
    store.whenPersisted = () => handle.readyPromise.then(() => handle.drainWrites?.() ?? undefined);
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
        handle.dirty = true;
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
/**
 * 卸载冲刷：立即强写（scheduler.flush，跳过防抖/节流窗口）。
 *
 * 两条 fail-safe（issue #335），都是「不要用不完整的快照覆盖磁盘」：
 *  1. 加载**未完成**时不直接回放 pending 再写盘：那时内存态里只有本进程刚产生的
 *     变更、**没有磁盘历史**，落盘等于用残缺快照覆盖历史（真实 teardown 后进程退出，
 *     防抖写不再发生 → 历史永久丢失）。改为等 `readyPromise` ——`onLoaded` 会把磁盘
 *     历史合并进来、回放 pending，再强写。
 *  2. 本实例**从未产生变更**时不写盘：scheduler.flush 的契约是「无变更也写一次」，
 *     但对一个只读启动的实例，写出去的是空/陈旧快照 —— 多实例共享同一状态文件时
 *     会直接覆盖别处写入的数据（实测：插件自身实例 teardown 时的空快照覆盖测试实例
 *     刚写的会话，重启恢复用例因此读到空）。
 *
 * 返回落盘 Promise，调用方可以 await 到「确已落盘」（不 await 时与原先的
 * fire-and-forget 行为一致）。
 */
function dispose(handle) {
    if (!handle.ready) {
        // 等加载合并后再写；并且**仍然要 drain**：onLoaded 会 persistSoon() 排一个防抖
        // 写，不 drain 就会在测试删掉临时目录之后才落盘（ENOTEMPTY / 幽灵目录）。
        return handle.readyPromise.then(async () => {
            if (handle.dirty)
                await handle.persistNow?.();
            await handle.drainWrites?.();
        });
    }
    if (handle.dirty)
        void handle.persistNow?.();
    return handle.drainWrites?.() ?? Promise.resolve();
}
