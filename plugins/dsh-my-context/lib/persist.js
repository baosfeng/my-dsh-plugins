/**
 * dsh-my-context — store persistence (load / parse / atomic write).
 *
 * 挂载到 store handle 的持久化能力：
 *  - 启动异步加载 $DSH_HOME/context/context.json（结构不合法回退空状态）；
 *  - 防抖 500ms + 原子写 tmp+rename（经 dirtyChain 串行化）；
 *  - 加载完成前 handle.pending 缓冲的变更在加载后回放（不丢事件）。
 */
import { readFile } from 'node:fs/promises';
import { atomicWriteJson } from 'dsh-shared';
import { createState, createSession, zeroUsage, zeroComposition } from './state.js';
import { MAX_REQUESTS_PER_SESSION, MAX_ALERTS_PER_SESSION, MAX_OVERFLOWS_PER_SESSION } from './constants.js';
/** 防抖间隔（ms）。 */
const PERSIST_DEBOUNCE_MS = 500;
/** 挂载持久化到 store handle（load 异步启动；dispose 冲刷）。 */
export function attachPersistence(handle) {
    handle.persistSoon = () => persistSoon(handle);
    handle.persistNow = () => persistNow(handle);
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
        persistSoon(handle);
}
/** 把当前 state 中已产生的会话合并进磁盘状态（防 dispose 回放后覆盖丢失）。 */
function mergeCurrent(current, parsed) {
    for (const [sessionId, session] of Object.entries(current.bySession)) {
        if (session.updatedAt === 0)
            continue;
        parsed.bySession[sessionId] = session;
    }
}
/** 解析已持久化的状态（结构不合法时回退空状态）。 */
function parseLoaded(text) {
    if (text === undefined || text === null || text === '')
        return undefined;
    try {
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object' || typeof parsed.bySession !== 'object')
            return undefined;
        const state = createState();
        for (const [sessionId, raw] of Object.entries(parsed.bySession)) {
            const session = normalizeSession(sessionId, raw);
            if (session !== undefined)
                state.bySession[sessionId] = session;
        }
        return state;
    }
    catch {
        return undefined;
    }
}
/** 会话结构规整：过滤非法字段，回退默认值。 */
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
        session.requests = rawObj.requests.slice(-MAX_REQUESTS_PER_SESSION);
    if (Array.isArray(rawObj.alerts))
        session.alerts = rawObj.alerts.slice(-MAX_ALERTS_PER_SESSION);
    if (Array.isArray(rawObj.overflows))
        session.overflows = rawObj.overflows.slice(-MAX_OVERFLOWS_PER_SESSION);
    // 旧版本数据没有 lastPromptTokens：从最近一次请求快照回填（`prompt` 字段同上）。
    copyNumber(session, rawObj, 'lastPromptTokens');
    if (session.lastPromptTokens === 0) {
        const last = session.requests[session.requests.length - 1];
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
    if (typeof raw[key] === 'object' && raw[key] !== null)
        target[key] = { ...fallback, ...raw[key] };
}
/** 原子写当前状态（经 dirtyChain 串行化；自动建目录）。 */
function persistNow(handle) {
    handle.dirtyChain = handle.dirtyChain
        .then(() => atomicWriteJson(handle.file, handle.store.state, handle.ctx.logger, '[dsh-my-context]'))
        .catch(() => { });
}
/** 防抖调度持久化。 */
function persistSoon(handle) {
    if (handle.persistTimer !== null)
        return;
    handle.persistTimer = setTimeout(() => {
        handle.persistTimer = null;
        persistNow(handle);
    }, PERSIST_DEBOUNCE_MS);
}
