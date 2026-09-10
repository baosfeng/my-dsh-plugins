/**
 * dsh-my-skill-manager — skill usage statistics (issue #91).
 *
 * 记录每个 skill 被加载/使用的情况：使用次数累计 + 最近使用时间 + 使用来源
 * （model = 模型通过 skill 工具加载；user = 用户 /name 手势注入等）。
 *
 * 持久化：$DSH_HOME/skills.usage.json（fallback ~/.dsh/skills.usage.json），
 * 防抖 500ms + 原子写（tmp+rename，经 dirtyChain 串行化），重启不丢。
 * 启动异步加载：结构不合法回退空状态；加载完成前 record 的变更缓冲在
 * pending 队列，加载后回放（不丢事件）。
 *
 * 数据形状：
 *   { "skills": { "<name>": { "count": N, "lastUsedAt": ts, "lastSource": "model"|"user" } } }
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { atomicWriteJson } from 'dsh-shared';
/** 防抖间隔（ms）。 */
const PERSIST_DEBOUNCE_MS = 500;
/** 全局使用统计文件：$DSH_HOME/skills.usage.json（fallback ~/.dsh/...）。 */
export function usageFile() {
    const home = process.env.DSH_HOME;
    if (typeof home === 'string' && home !== '')
        return `${home}/skills.usage.json`;
    return `${homedir()}/.dsh/skills.usage.json`;
}
/** 创建使用统计 store（异步加载启动；readyPromise 在加载完成后 resolve）。 */
export function createUsageStore({ file, logger }) {
    const core = {
        file,
        logger,
        byName: new Map(),
        ready: false,
        pending: [],
        persistTimer: null,
        dirtyChain: Promise.resolve(),
    };
    // 属性顺序与迁移前一致：core 字段先建，readyPromise/_resolveReady 后挂。
    const store = core;
    store.readyPromise = new Promise((resolve) => {
        store._resolveReady = resolve;
    });
    void readFile(file, 'utf8')
        .then((text) => onLoaded(store, text))
        .catch(() => onLoaded(store, ''));
    return store;
}
/** 状态加载完成：解析/规整 + 合并本进程已产生的变更 + 回放缓冲 + 落盘。 */
function onLoaded(store, text) {
    const parsed = parseLoaded(text);
    if (parsed !== undefined) {
        // 磁盘数据为基底，内存已有变更（加载完成前 record 的）覆盖。
        for (const [name, entry] of Object.entries(parsed)) {
            if (!store.byName.has(name))
                store.byName.set(name, entry);
        }
    }
    store.ready = true;
    store._resolveReady();
    const pending = store.pending.splice(0);
    for (const run of pending)
        run();
    if (pending.length > 0 || parsed !== undefined)
        persistSoon(store);
}
/** 解析已持久化的统计（结构不合法时回退 undefined）。 */
function parseLoaded(text) {
    if (text === undefined || text === null || text === '')
        return undefined;
    try {
        const parsed = JSON.parse(text);
        const skills = parsed?.skills;
        if (skills === null || typeof skills !== 'object')
            return undefined;
        const result = {};
        for (const [name, raw] of Object.entries(skills)) {
            const entry = normalizeEntry(raw);
            if (entry !== undefined)
                result[name] = entry;
        }
        return result;
    }
    catch {
        return undefined;
    }
}
/** 条目结构规整：过滤非法字段，回退默认值；count <= 0 的条目丢弃。 */
function normalizeEntry(raw) {
    if (raw === null || typeof raw !== 'object')
        return undefined;
    const source = raw;
    const count = typeof source.count === 'number' && Number.isFinite(source.count) ? Math.floor(source.count) : 0;
    if (count <= 0)
        return undefined;
    const lastUsedAt = typeof source.lastUsedAt === 'number' && Number.isFinite(source.lastUsedAt) ? source.lastUsedAt : 0;
    const lastSource = source.lastSource === 'model' ? 'model' : 'user';
    return { count, lastUsedAt, lastSource };
}
/** 记录一次 skill 使用：次数 +1、更新最近时间与来源，防抖持久化。 */
export function recordUsage(store, name, source) {
    const entry = store.byName.get(name) ?? { count: 0, lastUsedAt: 0, lastSource: 'user' };
    entry.count += 1;
    entry.lastUsedAt = Date.now();
    entry.lastSource = source === 'model' ? 'model' : 'user';
    store.byName.set(name, entry);
    if (store.ready)
        persistSoon(store);
    else
        store.pending.push(() => persistSoon(store));
}
/** 当前统计快照：{ name: { count, lastUsedAt, lastSource } }。 */
export function usageSnapshot(store) {
    const result = {};
    for (const [name, entry] of store.byName) {
        result[name] = { count: entry.count, lastUsedAt: entry.lastUsedAt, lastSource: entry.lastSource };
    }
    return result;
}
/** 立即冲刷持久化（dispose 时调用；返回落盘 Promise）。 */
export function flushUsage(store) {
    if (store.persistTimer !== null) {
        clearTimeout(store.persistTimer);
        store.persistTimer = null;
    }
    return persistNow(store);
}
/** 原子写当前状态（经 dirtyChain 串行化；自动建目录）。 */
function persistNow(store) {
    store.dirtyChain = store.dirtyChain
        .then(() => atomicWriteJson(store.file, { skills: usageSnapshot(store) }, store.logger, '[dsh-my-skill-manager]'))
        .catch(() => { });
    return store.dirtyChain;
}
/** 防抖调度持久化。 */
function persistSoon(store) {
    if (store.persistTimer !== null)
        return;
    store.persistTimer = setTimeout(() => {
        store.persistTimer = null;
        persistNow(store);
    }, PERSIST_DEBOUNCE_MS);
}
