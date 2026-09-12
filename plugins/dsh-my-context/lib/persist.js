/**
 * dsh-my-context — store persistence (load / parse / atomic write).
 *
 * 挂载到 store handle 的持久化能力（issue #198：接入 dsh-shared 资源护栏原语）：
 *  - 启动异步加载 $DSH_HOME/context/context.json（结构不合法回退空状态；
 *    磁盘存量会话超上限时按 updatedAt 保留最近的 MAX_SESSIONS 个）；
 *  - 写入调度用 createWriteScheduler（防抖 500ms + 最小间隔 1s + 串行链），
 *    `drain()` 作为确定性就绪信号（store.whenPersisted()）；
 *  - 落盘用 atomicWriteJson（默认护栏 1s/1MB + 显式 8MB 字节上限，状态自身有界）；
 *  - 加载完成前 handle.pending 缓冲的变更在加载后回放（不丢事件）。
 */
import { readFile } from 'node:fs/promises';
import { atomicWriteJson, createWriteScheduler } from 'dsh-shared';
import { createState, createSession, zeroUsage, zeroComposition } from './state.js';
import { PERSIST_DEBOUNCE_MS, PERSIST_MAX_BYTES, PERSIST_MIN_INTERVAL_MS } from './constants.js';
/** 挂载持久化到 store handle（load 异步启动；dispose 冲刷）。 */
export function attachPersistence(handle) {
    const scheduler = createWriteScheduler({
        debounceMs: PERSIST_DEBOUNCE_MS,
        minIntervalMs: PERSIST_MIN_INTERVAL_MS,
        logger: handle.ctx.logger,
        prefix: '[dsh-my-context]',
        write: ({ force }) => atomicWriteJson(handle.file, handle.store.state, handle.ctx.logger, '[dsh-my-context]', {
            force,
            maxBytes: PERSIST_MAX_BYTES,
        }),
    });
    handle.persistSoon = () => scheduler.schedule();
    handle.persistNow = () => scheduler.flush();
    handle.drainWrites = () => scheduler.drain();
    void readFile(handle.file, 'utf8')
        .then((text) => onLoaded(handle, text))
        .catch(() => onLoaded(handle, ''));
}
/** 状态加载完成：解析/规整 + 合并本进程已产生的变更 + 回放缓冲 + 落盘。 */
function onLoaded(handle, text) {
    const parsed = parseLoaded(text);
    if (parsed !== undefined) {
        mergeCurrent(handle.store.state, parsed);
        handle.store.state = parsed;
    }
    handle.ready = true;
    const pending = handle.pending.splice(0);
    for (const run of pending)
        run();
    if (pending.length > 0 || parsed !== undefined)
        handle.persistSoon?.();
}
/** 把当前 state 中已产生的会话合并进磁盘状态（防 dispose 回放后覆盖丢失）。 */
function mergeCurrent(current, parsed) {
    for (const [sessionId, session] of current.bySession) {
        if (session.updatedAt === 0)
            continue;
        parsed.bySession.set(sessionId, session);
    }
}
/** 根结构校验：必须是含 bySession 对象的 JSON 对象（数组也算对象，与原实现一致）。 */
function hasSessionsRoot(parsed) {
    if (parsed === null || parsed === undefined || typeof parsed !== 'object')
        return false;
    const bySession = parsed.bySession;
    return bySession !== null && typeof bySession === 'object';
}
/** 解析已持久化的状态（结构不合法时回退空状态）。 */
function parseLoaded(text) {
    if (text === undefined || text === null || text === '')
        return undefined;
    try {
        const parsed = JSON.parse(text);
        if (!hasSessionsRoot(parsed))
            return undefined;
        const state = createState();
        // 按 updatedAt 升序灌入：Map 迭代序 = 活跃序，超上限时淘汰最旧会话
        // （磁盘上可能残留旧版本写入的无限会话，加载即收敛到上限内）。
        for (const session of collectSessions(parsed.bySession)) {
            state.bySession.set(session.sessionId, session);
        }
        return state;
    }
    catch {
        return undefined;
    }
}
/** 规整磁盘会话并按 updatedAt 升序返回。 */
function collectSessions(raw) {
    const sessions = [];
    for (const [sessionId, value] of Object.entries(raw)) {
        const session = normalizeSession(sessionId, value);
        if (session !== undefined)
            sessions.push(session);
    }
    sessions.sort((a, b) => a.updatedAt - b.updatedAt);
    return sessions;
}
/** 会话结构规整：过滤非法字段，回退默认值；明细数组有界（FIFO 保留最新 N 条）。 */
function normalizeSession(sessionId, raw) {
    if (raw === null || typeof raw !== 'object')
        return undefined;
    const session = createSession(sessionId);
    const rawObj = raw;
    copyString(session, rawObj, 'model');
    copyString(session, rawObj, 'provider');
    copyNumber(session, rawObj, 'contextWindow');
    copyNumber(session, rawObj, 'updatedAt');
    copyObject(session, rawObj, 'usage', zeroUsage());
    copyObject(session, rawObj, 'turnUsage', { turn: 0, ...zeroUsage() });
    copyObject(session, rawObj, 'composition', zeroComposition());
    copyObject(session, rawObj, 'header', session.header);
    if (Array.isArray(rawObj.requests))
        session.requests.pushAll(rawObj.requests);
    if (Array.isArray(rawObj.alerts))
        session.alerts.pushAll(rawObj.alerts);
    if (Array.isArray(rawObj.overflows))
        session.overflows.pushAll(rawObj.overflows);
    // 旧版本数据没有 lastPromptTokens：从最近一次请求快照回填（`prompt` 字段同上）。
    copyNumber(session, rawObj, 'lastPromptTokens');
    if (session.lastPromptTokens === 0) {
        const last = session.requests.items()[session.requests.size - 1];
        if (last !== undefined && typeof last.prompt === 'number')
            session.lastPromptTokens = last.prompt;
    }
    return session;
}
/** 复制字符串字段（非字符串忽略）。 */
function copyString(target, raw, key) {
    if (typeof raw[key] === 'string')
        target[key] = raw[key];
}
/** 复制数字字段（非数字忽略）。 */
function copyNumber(target, raw, key) {
    if (typeof raw[key] === 'number')
        target[key] = raw[key];
}
/** 复制对象字段（非对象忽略；默认值兜底）。 */
function copyObject(target, raw, key, fallback) {
    if (typeof raw[key] === 'object' && raw[key] !== null) {
        ;
        target[key] = {
            ...fallback,
            ...raw[key],
        };
    }
}
