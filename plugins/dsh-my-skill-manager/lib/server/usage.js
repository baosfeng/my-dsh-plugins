/**
 * dsh-my-skill-manager — skill 使用统计。
 *
 * 计数口径：包装 `ctx.skills.get()`——正文被加载（模型 skill 工具 / 用户
 * `/name` 手势注入）即计一次；来源判定由 `tools/pre-execute` 标记：命中
 * skill 工具的调用记 model，其余记 user。
 *
 * 落盘：`$DSH_HOME/skills.usage.json`（缺省 ~/.dsh/…），防抖 500ms + 最小
 * 间隔 1s（dsh-shared createWriteScheduler 串行链）+ 原子写（tmp + rename）。
 * 启动异步加载；加载完成前的计数缓冲后回放，不丢事件；drain() 是确定性
 * 就绪信号。
 *
 * 数据形状：
 *   { "skills": { "<name>": { "count": N, "lastUsedAt": ts, "lastSource": "model"|"user" } } }
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteJson, createWriteScheduler } from 'dsh-shared';
import { dshHome } from './config-store.js';
/** 统计文件名。 */
export const USAGE_FILE_NAME = 'skills.usage.json';
/** 防抖窗口（ms）。 */
const USAGE_DEBOUNCE_MS = 500;
/** 最小写间隔（ms）：与 atomicWriteJson 默认护栏窗口对齐。 */
const USAGE_MIN_INTERVAL_MS = 1000;
/** 统计文件路径。 */
export function usageFile() {
    return join(dshHome(), USAGE_FILE_NAME);
}
/** 条目规整：count <= 0 或结构非法返回 undefined。 */
function normalizeUsageEntry(raw) {
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
/** 解析统计文件内容（结构不合法 → undefined）。 */
function parseUsageSnapshot(text) {
    if (text === undefined || text === null || text === '')
        return undefined;
    try {
        const parsed = JSON.parse(text);
        const skills = parsed?.skills;
        if (skills === null || typeof skills !== 'object')
            return undefined;
        const snapshot = {};
        for (const [name, raw] of Object.entries(skills)) {
            const entry = normalizeUsageEntry(raw);
            if (entry !== undefined)
                snapshot[name] = entry;
        }
        return snapshot;
    }
    catch {
        return undefined;
    }
}
/** 由内存 Map 生成快照（拷贝，调用方可安全序列化）。 */
function snapshotOf(byName) {
    const snapshot = {};
    for (const [name, entry] of byName)
        snapshot[name] = { ...entry };
    return snapshot;
}
/** 创建统计 store（异步加载启动；record 在加载完成前进入缓冲）。 */
export function createUsageStore(options) {
    const byName = new Map();
    const buffered = [];
    const now = options.now ?? (() => Date.now());
    let loaded = false;
    let resolveReady = () => { };
    const readyPromise = new Promise((resolve) => {
        resolveReady = resolve;
    });
    const scheduler = createWriteScheduler({
        debounceMs: options.debounceMs ?? USAGE_DEBOUNCE_MS,
        minIntervalMs: options.minIntervalMs ?? USAGE_MIN_INTERVAL_MS,
        logger: options.logger,
        prefix: '[dsh-my-skill-manager]',
        // 节奏由调度器负责（含 drain 的排队写），落盘原语关节流避免双护栏互相拒绝。
        write: ({ force }) => atomicWriteJson(options.file, { skills: snapshotOf(byName) }, options.logger, '[dsh-my-skill-manager]', {
            force,
            minIntervalMs: 0,
        }),
    });
    const schedule = () => {
        if (loaded)
            scheduler.schedule();
        else
            buffered.push(() => scheduler.schedule());
    };
    const finishLoad = (parsed) => {
        if (parsed !== undefined) {
            // 磁盘数据为基底；加载完成前内存里的变更优先。
            for (const [name, entry] of Object.entries(parsed)) {
                if (!byName.has(name))
                    byName.set(name, entry);
            }
        }
        loaded = true;
        resolveReady();
        const pending = buffered.splice(0);
        for (const run of pending)
            run();
        if (parsed !== undefined || pending.length > 0)
            scheduler.schedule();
    };
    void readFile(options.file, 'utf8')
        .then((text) => finishLoad(parseUsageSnapshot(text)))
        .catch(() => finishLoad(undefined));
    return {
        file: options.file,
        ready: () => readyPromise,
        snapshot: () => snapshotOf(byName),
        record: (name, source) => {
            const entry = byName.get(name) ?? { count: 0, lastUsedAt: 0, lastSource: 'user' };
            entry.count += 1;
            entry.lastUsedAt = now();
            entry.lastSource = source === 'model' ? 'model' : 'user';
            byName.set(name, entry);
            schedule();
        },
        drain: async () => {
            await readyPromise;
            await scheduler.drain();
        },
        flush: async () => {
            await readyPromise;
            await scheduler.flush();
        },
    };
}
/** 创建模型调用标记器。 */
export function createModelCallTracker() {
    let pending = null;
    return {
        mark: (name) => {
            pending = name;
        },
        claim: (name) => {
            if (pending !== name)
                return false;
            pending = null;
            return true;
        },
    };
}
/** 包装 `skills.get`：正文加载成功即计数（来源由标记器判定）；返回还原函数。 */
export function wrapSkillGet(skills, usage, tracker) {
    const original = skills.get;
    if (typeof original !== 'function')
        return () => { };
    const bound = original.bind(skills);
    skills.get = async (name, options) => {
        const skill = await bound(name, options);
        const fromModel = tracker?.claim(name) ?? false;
        if (skill !== undefined)
            usage.record(name, fromModel ? 'model' : 'user');
        return skill;
    };
    return () => {
        skills.get = original;
    };
}
