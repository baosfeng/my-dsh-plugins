/**
 * dsh-my-observability — 审计持久化层（磁盘 I/O 与格式规整）。
 *
 * 设计要点（修复 9/2 磁盘写入风暴的根因）：
 *  - **append-only**：新事件以 JSON Lines 追加到 `audit.jsonl`（每次落盘
 *    只写新增事件字节，不再全量重写整个状态文件——旧实现每次防抖落盘
 *    都把全部事件 JSON.stringify 重写一遍，事件流持续时每小时数 GB）；
 *  - **周期 compact**：追加行数达到 COMPACT_LINES 阈值时，把内存状态
 *    原子快照重写 jsonl（tmp+rename），保证文件大小有界、启动加载不回归；
 *  - **旧格式迁移**：升级前 `audit.json`（整文件 JSON）存在时自动读取并
 *    在首次快照后移除（rename 为 .migrated 备份），行为兼容；
 *  - **加载规整**：单行解析失败跳过（不崩溃）；每会话/全局上限在加载时
 *    与运行时一致生效。
 */
import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
/** 每会话事件上限（运行时与加载规整共用）。 */
export const MAX_EVENTS_PER_SESSION = 2000;
/** 全局事件上限（运行时与加载规整共用）。 */
export const MAX_TOTAL_EVENTS = 20000;
/** 追加行数达到该值触发一次 compact（文件大小有界）。 */
export const COMPACT_LINES = 5000;
/** 数据根目录：$DSH_HOME（fallback 家目录）。 */
function dataHome() {
    const home = process.env.DSH_HOME;
    return typeof home === 'string' && home !== '' ? home : homedir();
}
/** 追加日志文件路径（新格式）。 */
export function jsonlFile() {
    return join(dataHome(), 'observability', 'audit.jsonl');
}
/** 兼容的旧格式文件路径（0.1.x 整文件 JSON）。 */
export function legacyFile() {
    return join(dataHome(), 'observability', 'audit.json');
}
/** 事件结构校验（时间/会话/类型为合理形态）。 */
function isValidEvent(event) {
    const target = event;
    return (target !== null &&
        typeof target === 'object' &&
        typeof target.time === 'number' &&
        typeof target.sessionId === 'string' &&
        typeof target.type === 'string');
}
/**
 * 加载后的状态规整：按会话桶过滤非法事件 + 每会话截断 + 全局超限时
 * 按最早活动会话整桶轮转淘汰（与运行时 appendEvent/evictOldest 语义一致）。
 * 桶形态兼容两种：jsonl 解析的数组桶，与旧格式的 { events } 对象桶。
 */
export function normalizeLoaded(bySession) {
    const sessionBuckets = {};
    for (const [sessionId, bucket] of Object.entries(bySession)) {
        const raw = Array.isArray(bucket)
            ? bucket
            : Array.isArray(bucket?.events)
                ? bucket.events
                : [];
        const events = raw.filter(isValidEvent).slice(-MAX_EVENTS_PER_SESSION);
        if (events.length > 0)
            sessionBuckets[sessionId] = { events };
    }
    let total = 0;
    for (const bucket of Object.values(sessionBuckets))
        total += bucket.events.length;
    if (total > MAX_TOTAL_EVENTS) {
        const ordered = Object.keys(sessionBuckets).sort((a, b) => firstTimeOf(sessionBuckets[a]) - firstTimeOf(sessionBuckets[b]));
        for (const sessionId of ordered) {
            if (total <= MAX_TOTAL_EVENTS)
                break;
            total -= sessionBuckets[sessionId].events.length;
            delete sessionBuckets[sessionId];
        }
    }
    return { version: 1, bySession: sessionBuckets };
}
function firstTimeOf(bucket) {
    return bucket.events[0].time;
}
/** 解析 jsonl 文本 → { bySession, lines }（非法行跳过；lines 为有效+无效总行数）。 */
export function parseJsonl(text) {
    const bySession = {};
    let lines = 0;
    for (const line of text.split('\n')) {
        lines += 1;
        if (line === '')
            continue;
        try {
            const event = JSON.parse(line);
            if (!isValidEvent(event))
                continue;
            const bucket = bySession[event.sessionId] ?? (bySession[event.sessionId] = []);
            bucket.push(event);
        }
        catch {
            // 截断/损坏行跳过
        }
    }
    return { bySession, lines };
}
/** 解析旧格式（整文件 JSON）→ { bySession, lines }；结构非法返回 null。 */
export function parseLegacy(text) {
    try {
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object')
            return null;
        const bySession = parsed.bySession;
        if (typeof bySession !== 'object' || bySession === null)
            return null;
        return { bySession: bySession, lines: Object.keys(bySession).length };
    }
    catch {
        return null;
    }
}
/**
 * 加载持久化状态：优先 jsonl；否则旧格式（标记 migrated）；
 * 都缺失返回空状态。文件不存在或损坏均回退（migrated 仅合法旧文件触发）。
 */
export async function loadPersisted(file, legacy) {
    const jsonl = await readFile(file, 'utf8')
        .then((text) => ({ kind: 'jsonl', text }))
        .catch(() => null);
    if (jsonl !== null) {
        const parsed = parseJsonl(jsonl.text);
        return { state: normalizeLoaded(parsed.bySession), migrated: false, lines: parsed.lines };
    }
    const old = await readFile(legacy, 'utf8')
        .then((text) => parseLegacy(text))
        .catch(() => null);
    if (old !== null) {
        return { state: normalizeLoaded(old.bySession), migrated: true, lines: old.lines };
    }
    return { state: { version: 1, bySession: {} }, migrated: false, lines: 0 };
}
/** 原子快照写（tmp+rename）：compact 用。快照内容为 jsonl 行（每行一个事件），
 *  保证重启加载与增补追加读取同一格式。 */
export async function writeSnapshot(file, state, logger, prefix) {
    const dir = dirname(file);
    const tmp = `${file}.tmp-${process.pid}`;
    try {
        await mkdir(dir, { recursive: true });
        await writeFile(tmp, stateToLines(state), 'utf8');
        await rename(tmp, file);
    }
    catch (error) {
        logger?.warn(`${prefix} snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/** 内存状态 → jsonl 行文本（按会话桶串联，桶内保持事件原序）。 */
function stateToLines(state) {
    const lines = [];
    for (const bucket of Object.values(state.bySession ?? {})) {
        if (!Array.isArray(bucket?.events))
            continue;
        for (const event of bucket.events)
            lines.push(JSON.stringify(event));
    }
    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}
/** 追加写入（jsonl 行）；目录自动创建。 */
export async function appendLines(file, text, logger, prefix) {
    try {
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, text, 'utf8');
    }
    catch (error) {
        logger?.warn(`${prefix} append failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/** 迁移完成后移除旧格式文件（rename 为 .migrated 备份；缺失忽略）。 */
export async function removeLegacyAfterMigration(legacy) {
    try {
        await rename(legacy, `${legacy}.migrated`);
    }
    catch {
        // 文件不存在或已移除：忽略
    }
}
