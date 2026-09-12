/**
 * dsh-my-guard — alert store.
 *
 * 告警记录的内存态 + 持久化：
 *  - 全局告警列表（每条带 sessionId/type/severity），FIFO 上限
 *    MAX_ALERTS 防膨胀；
 *  - 持久化 $DSH_HOME/guard/alerts.json（防抖 500ms + **dsh-shared 快照原语**
 *    atomicWriteJson：紧凑 JSON + 字节上限护栏 + 拦截计数可观测 + teardown flush），
 *    启动时异步加载（加载完成前的事件缓冲在 pending，加载后回放），重启后完整恢复；
 *    加载 + 回放的完成由 whenReady() 给出**确定性信号**——查询方等它，不要等墙钟
 *    （固定 sleep 在 CI 高负载下会随机漏掉尚未加载的历史，见 docs/踩坑/）；
 *    teardown 若发生在加载完成前，会等合并完成再落盘，避免用缺历史的状态覆盖磁盘；
 *  - confirm(id) 标记告警已确认（用户确认机制）。
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteJson } from 'dsh-shared';
import { MAX_ALERTS } from './constants.js';
/** 日志前缀（快照被护栏拦截时 warn）。 */
const PREFIX = '[dsh-my-guard]';
/**
 * 快照字节上限：MAX_ALERTS(500) 条 × 单条告警上界（命令/路径片段截断后 ≤ 数 KB）
 * → 4MB 是安全上界。显式高于 shared 默认 1MB：投毒扫描的告警会带文件路径与
 * 依赖名，批量命中时单条可达数 KB，用默认 1MB 会拦下正常快照（拦下=丢状态）。
 */
const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;
/** 告警数据文件：$DSH_HOME/guard/alerts.json（fallback ~/.dsh/…）。 */
export function stateFile() {
    const home = process.env.DSH_HOME;
    const base = typeof home === 'string' && home !== '' ? home : homedir();
    return join(base, 'guard', 'alerts.json');
}
/** 初始空状态。 */
function createState() {
    return { version: 1, alerts: [] };
}
/**
 * 创建告警存储：{ state, record, alerts, count, confirm, whenReady, dispose }。
 * record 在状态加载完成前缓冲（不丢告警）；whenReady 是「加载 + 缓冲回放完成」
 * 的确定性信号（查询方等它，而不是等一段墙钟时间）；dispose 冲刷未落盘数据。
 */
export function createStore(ctx, deps = {}) {
    const state = createState();
    let markReady = () => { };
    const readyPromise = new Promise((resolve) => {
        markReady = resolve;
    });
    const handle = {
        ctx,
        file: stateFile(),
        store: { state },
        pending: [],
        ready: false,
        readyPromise,
        markReady,
        disposed: false,
        persistTimer: null,
        dirtyChain: Promise.resolve(),
        seq: 0,
        deps: { readFile: deps.readFile ?? defaultReadFile, writeFile: deps.writeFile },
        writeState: (target) => writeSnapshot(target),
    };
    const store = {
        state,
        record: (alert) => record(handle, alert),
        alerts: (sessionId, type, limit) => alertsOf(handle, sessionId, type, limit),
        count: () => countOf(handle),
        confirm: (id) => confirmOf(handle, id),
        whenReady: () => handle.readyPromise,
        dispose: () => dispose(handle),
    };
    void handle.deps
        .readFile(handle.file)
        .then((text) => onLoaded(handle, text))
        .catch(() => onLoaded(handle, ''));
    return store;
}
/** 默认加载实现：读持久化文件（失败由调用方 catch 回退空状态）。 */
function defaultReadFile(file) {
    return readFile(file, 'utf8');
}
/**
 * 落盘实现：默认 dsh-shared 的 atomicWriteJson（tmp+rename 原子写 + 自动建目录 +
 * 紧凑 JSON + 字节上限 + 被拦计数），测试注入 deps.writeFile 时走注入实现
 * （注入点保留：测试要确定性观察落盘快照序列）。
 */
async function writeSnapshot(handle) {
    if (handle.deps.writeFile !== undefined) {
        await handle.deps.writeFile(handle.file, JSON.stringify(handle.store.state));
        return;
    }
    atomicWriteJson(handle.file, handle.store.state, ctxLogger(handle.ctx), PREFIX, {
        // 节奏由本插件的 500ms 防抖 + dirtyChain 串行链负责（显式承担，见 resource-budget-review）
        minIntervalMs: 0,
        maxBytes: SNAPSHOT_MAX_BYTES,
    });
}
/** 取宿主 logger（快照被拦时 warn）；不可用返回 undefined（护栏仍生效）。 */
function ctxLogger(ctx) {
    const logger = ctx?.logger;
    if (typeof logger?.warn !== 'function')
        return undefined;
    return { warn: (message) => logger.warn?.(message) };
}
/** 追加一条告警（自动分配 id/时间戳）；未就绪时缓冲。 */
function record(handle, alert) {
    const item = { id: nextId(handle), time: Date.now(), confirmed: false, ...alert };
    if (!handle.ready) {
        handle.pending.push(item);
        return item;
    }
    appendAlert(handle, item);
    persistSoon(handle);
    return item;
}
/** 查询告警（type 可选过滤；limit 限制条数；倒序=最新在前）。 */
function alertsOf(handle, sessionId, type, limit) {
    let list = handle.store.state.alerts;
    if (sessionId !== undefined && sessionId !== null && sessionId !== '') {
        list = list.filter((alert) => alert.sessionId === sessionId);
    }
    if (type !== undefined && type !== null && type !== '') {
        list = list.filter((alert) => alert.type === type);
    }
    const capped = typeof limit === 'number' && limit > 0 ? list.slice(-limit) : list;
    return [...capped].reverse().map((alert) => ({ ...alert }));
}
/** 告警总数（供状态展示/测试断言）。 */
function countOf(handle) {
    return handle.store.state.alerts.length;
}
/** 标记告警已确认；返回是否找到并更新。 */
function confirmOf(handle, id) {
    const alert = handle.store.state.alerts.find((item) => item.id === id);
    if (alert === undefined)
        return false;
    if (!alert.confirmed) {
        alert.confirmed = true;
        alert.confirmedAt = Date.now();
        persistSoon(handle);
    }
    return true;
}
/** 告警自增 id。 */
function nextId(handle) {
    handle.seq += 1;
    return handle.seq;
}
/** 追加告警：FIFO 淘汰超上限的最旧告警。 */
function appendAlert(handle, item) {
    handle.store.state.alerts.push(item);
    if (handle.store.state.alerts.length > MAX_ALERTS) {
        handle.store.state.alerts.splice(0, handle.store.state.alerts.length - MAX_ALERTS);
    }
}
/** 状态加载完成：解析/规整 + 合并本进程已产生的告警 + 回放缓冲 + 落盘。
 *  markReady 放在合并/回放**之后**：whenReady 返回即保证缓冲告警已并入 state，
 *  查询结果与「加载耗时」无关（不再需要调用方猜一个 sleep 时长）。 */
function onLoaded(handle, text) {
    const parsed = parseLoaded(text);
    if (parsed !== undefined) {
        mergeCurrent(handle.store.state, parsed);
        // 原地替换 alerts 数组：store.state 引用已被外部持有（AlertStore.state），
        // 整体换对象会让外部持有者永远停在旧数组上
        handle.store.state.alerts = parsed.alerts;
    }
    handle.ready = true;
    const pending = handle.pending.splice(0);
    for (const item of pending)
        appendAlert(handle, item);
    handle.markReady();
    if (!handle.disposed && (pending.length > 0 || parsed !== undefined))
        persistSoon(handle);
}
/** 把当前 state 中已产生的告警合并进磁盘状态（防加载期间记录/落盘的告警丢失）。 */
function mergeCurrent(current, parsed) {
    if (current.alerts.length > 0)
        parsed.alerts.push(...current.alerts);
}
/** 解析已持久化的状态（结构不合法时回退空状态）。 */
function parseLoaded(text) {
    if (text === undefined || text === null || text === '')
        return undefined;
    try {
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.alerts))
            return undefined;
        const state = createState();
        state.alerts = parsed.alerts.filter(isValidAlert).slice(-MAX_ALERTS);
        return state;
    }
    catch {
        return undefined;
    }
}
/** 告警结构校验（时间/类型/消息为合理形态）。 */
function isValidAlert(alert) {
    return (alert !== null &&
        typeof alert === 'object' &&
        typeof alert.time === 'number' &&
        typeof alert.type === 'string' &&
        typeof alert.message === 'string');
}
/** 落盘当前状态（经 dirtyChain 串行化；写失败静默）。 */
function persistNow(handle) {
    handle.dirtyChain = handle.dirtyChain
        .then(() => handle.writeState(handle))
        .catch(() => { });
}
/** 防抖（500ms）调度持久化。 */
function persistSoon(handle) {
    if (handle.persistTimer !== null)
        return;
    handle.persistTimer = setTimeout(() => {
        handle.persistTimer = null;
        persistNow(handle);
    }, 500);
}
/** 卸载冲刷：清定时器 + 落盘；加载尚未完成时**等加载合并完成再落盘**——
 *  否则会拿「缺磁盘历史」的内存状态覆盖磁盘，真实 teardown（进程随后退出，
 *  防抖写不再发生）时历史告警永久丢失。 */
function dispose(handle) {
    handle.disposed = true;
    if (handle.persistTimer !== null) {
        clearTimeout(handle.persistTimer);
        handle.persistTimer = null;
    }
    if (!handle.ready) {
        void handle.readyPromise.then(() => persistNow(handle));
        return;
    }
    persistNow(handle);
}
