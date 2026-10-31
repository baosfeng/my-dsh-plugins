/**
 * dsh-my-memory — agent 记忆的元数据索引（issue #502）。
 *
 * `index.json` 是**系统独占**的事实来源：创建时间、最后读取时间、读取次数、
 * 归档时间。agent 通过工具**读不到也写不到**它——这正是遗忘机制可信的前提：
 * 若 agent 能改 `lastReadAt`，它就能让死记忆永生，遗忘形同虚设。
 *
 * 文件形状：
 *   { "files": { "user.md": { "createdAt", "updatedAt", "lastReadAt", "readCount", "archivedAt?" } } }
 *
 * 缺失/损坏一律降级为空索引（与 store.ts 的防御式读取一致），绝不因元数据
 * 损坏丢掉正文。
 */
import { readFile } from 'node:fs/promises';
import { atomicWriteJson } from 'dsh-shared';
import { indexFile } from './paths.js';
/** 空条目（首次出现时的时间戳基准）。 */
function freshMeta(now) {
    return { createdAt: now, updatedAt: now, lastReadAt: 0, readCount: 0 };
}
/** 读取并解析索引文件；缺失/损坏 → 空索引（正文仍在，元数据从此刻重建）。 */
async function readIndex() {
    try {
        const raw = JSON.parse(await readFile(indexFile(), 'utf8'));
        if (raw === null || typeof raw !== 'object' || !('files' in raw))
            return { files: {}, projects: {} };
        const files = raw.files;
        const projects = raw.projects;
        return {
            files: files !== null && typeof files === 'object' ? files : {},
            projects: projects !== null && typeof projects === 'object' ? projects : {},
        };
    }
    catch {
        return { files: {}, projects: {} };
    }
}
/** 写入时间戳；同时清掉归档标记——重新写入即复活（归档副本不参与可见性）。 */
function markWritten(meta, at) {
    meta.updatedAt = at;
    delete meta.archivedAt;
}
/** 清除归档标记（面板「恢复」用：正文已搬回原位，元数据同步复活）。 */
function clearArchived(meta) {
    delete meta.archivedAt;
}
/** 读取时间戳 + 计数自增（遗忘机制的唯一事实来源）。 */
function markRead(meta, at) {
    meta.lastReadAt = at;
    meta.readCount += 1;
}
/** 归档时间戳。 */
function markArchivedAt(meta, at) {
    meta.archivedAt = at;
}
/** 删除一条元数据并落盘（面板「删除记忆」用）。 */
async function dropIn(cache, name, load, persist) {
    await load();
    delete cache.files[name];
    await persist();
}
/** 记录项目名（值未变时不落盘，避免读放大）。 */
async function rememberProjectIn(cache, id, label, load, persist) {
    if (id === '' || label === '')
        return;
    await load();
    const projects = (cache.projects ??= {});
    if (projects[id] === label)
        return;
    projects[id] = label;
    await persist();
}
/** agent 记忆元数据索引的读写门面。 */
export function createIndexStore({ logger } = {}) {
    let cache = { files: {}, projects: {} };
    let loaded = false;
    const persist = async () => {
        try {
            await atomicWriteJson(indexFile(), cache, logger, '[dsh-my-memory] agent-memory index', {
                minIntervalMs: 0,
            });
        }
        catch (error) {
            logger?.warn(`agent-memory: 元数据写入失败（正文不受影响）：${String(error)}`);
        }
    };
    const load = async () => {
        if (loaded)
            return cache;
        loaded = true;
        cache = await readIndex();
        return cache;
    };
    /** 取或建一条元数据（原地更新 cache）。 */
    const ensure = (name, now) => {
        const existing = cache.files[name];
        if (existing !== undefined)
            return existing;
        const created = freshMeta(now);
        cache.files[name] = created;
        return created;
    };
    /** 统一的「改一条元数据再落盘」入口。 */
    const mutate = async (name, apply, now = Date.now()) => {
        await load();
        apply(ensure(name, now), now);
        await persist();
    };
    return {
        load,
        state: () => cache,
        metaOf: (name) => cache.files[name],
        touchWrite: (name, now) => mutate(name, markWritten, now),
        touchRead: (name, now) => mutate(name, markRead, now),
        markArchived: (name, now) => mutate(name, markArchivedAt, now),
        markRestored: (name, now) => mutate(name, clearArchived, now),
        drop: (name) => dropIn(cache, name, load, persist),
        projectNames: () => cache.projects ?? {},
        rememberProject: (id, label) => rememberProjectIn(cache, id, label, load, persist),
        flush: persist,
    };
}
