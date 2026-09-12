/**
 * dsh-file-activity — 加载规整与配额收敛（issue #197）。
 *
 * 旧状态文件（全量 JSON 快照）可能远超新上限：首次升级启动即按配额收敛，
 * 淘汰动作同样计数 + warn，不做静默丢弃。
 */
import { RECENT_LIMIT, countPaths, emptyEvicted, enforceSessionLimit, enforceSessionPathLimit, enforceTotalPathLimit, } from './quota.js';
/** NUL 字符（路径合法性判定，禁止内嵌空字节）。 */
const NUL = String.fromCharCode(0);
/** 计数器规整：非法值归零、时间戳可选保留。 */
function sanitizeCounters(raw) {
    if (raw === null || typeof raw !== 'object')
        return null;
    const num = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
    const counters = { read: num(raw.read), create: num(raw.create), modify: num(raw.modify) };
    if (typeof raw.firstSeen === 'number')
        counters.firstSeen = raw.firstSeen;
    if (typeof raw.lastSeen === 'number')
        counters.lastSeen = raw.lastSeen;
    return counters;
}
/** recent 规整：过滤非法条目 → 时间降序 → 按 path 去重 → 截断到 RECENT_LIMIT。 */
function normalizeRecent(raw) {
    const seen = new Set();
    const valid = raw.filter((entry) => typeof entry?.path === 'string' && entry.path !== '' && !entry.path.includes(NUL));
    valid.sort((a, b) => (typeof b.time === 'number' ? b.time : 0) - (typeof a.time === 'number' ? a.time : 0));
    const out = [];
    for (const entry of valid) {
        if (seen.has(entry.path))
            continue;
        seen.add(entry.path);
        out.push({
            path: entry.path,
            op: String(entry.op ?? 'read'),
            time: typeof entry.time === 'number' ? entry.time : 0,
        });
        if (out.length >= RECENT_LIMIT)
            break;
    }
    return out;
}
/** counts 规整：非法 path / 非法计数器丢弃。 */
function normalizeCounts(raw) {
    const counts = {};
    let dropped = 0;
    for (const [path, rawCounters] of Object.entries(raw ?? {})) {
        if (typeof path !== 'string' || path === '' || path.includes(NUL)) {
            dropped += 1;
            continue;
        }
        const counters = sanitizeCounters(rawCounters);
        if (counters === null) {
            dropped += 1;
            continue;
        }
        counts[path] = counters;
    }
    return { counts, dropped };
}
/** known 与 counts 对齐（非法条目丢弃、缺失项按 firstSeen 补齐）。 */
function alignKnown(raw, counts) {
    const known = {};
    let changed = false;
    for (const [path, at] of Object.entries(raw ?? {})) {
        if (typeof at === 'number' && path !== '' && !path.includes(NUL))
            known[path] = at;
        else
            changed = true;
    }
    if (Object.keys(known).length !== Object.keys(counts).length)
        changed = true;
    for (const path of Object.keys(counts)) {
        if (typeof known[path] === 'number')
            continue;
        known[path] = counts[path].firstSeen ?? 0;
    }
    return { known, changed };
}
/** 会话规整：recent 去重截断 → counts 过滤 → known 与 counts 对齐 → 单会话 LRU 上限。 */
function trimSession(raw, sessionId, limits, evicted, logger) {
    const rawRecent = Array.isArray(raw.recent) ? raw.recent : [];
    const recent = normalizeRecent(rawRecent);
    const { counts, dropped } = normalizeCounts(raw.counts);
    const { known, changed } = alignKnown(raw.known, counts);
    const session = { known, counts, recent };
    const before = Object.keys(counts).length;
    enforceSessionPathLimit(session, sessionId, limits, evicted, logger);
    const trimmed = recent.length !== rawRecent.length || dropped > 0 || changed || Object.keys(session.counts).length !== before;
    return { session, trimmed };
}
/**
 * 加载后按配额规整（旧状态文件可能远超上限：首次升级启动即收敛到边界）。
 * 顺序：逐会话规整 → 会话数上限 → 全局路径上限。
 */
export function trimToQuota(loaded, limits, logger) {
    const evicted = emptyEvicted();
    let trimmed = false;
    const sessions = {};
    for (const [sessionId, raw] of Object.entries(loaded.sessions ?? {})) {
        if (raw === null || typeof raw !== 'object' || sessionId === '') {
            trimmed = true;
            continue;
        }
        const result = trimSession(raw, sessionId, limits, evicted, logger);
        if (result.trimmed)
            trimmed = true;
        sessions[sessionId] = result.session;
    }
    const state = { version: 1, sessions, stats: { evicted } };
    const sessionsBefore = Object.keys(sessions).length;
    enforceSessionLimit(state, limits, evicted, logger);
    if (Object.keys(state.sessions).length !== sessionsBefore)
        trimmed = true;
    const pathsBefore = countPaths(state);
    enforceTotalPathLimit(state, limits, evicted, logger);
    if (countPaths(state) !== pathsBefore)
        trimmed = true;
    if (evicted.sessions + evicted.paths + evicted.pathsTotal > 0)
        trimmed = true;
    return { state, trimmed, evicted };
}
