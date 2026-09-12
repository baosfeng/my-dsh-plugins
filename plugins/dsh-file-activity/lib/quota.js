/** 每会话路径上限（LRU：超限淘汰最久未活动路径）。 */
const MAX_PATHS_PER_SESSION = 300;
/** 全局路径上限（跨会话总条目数）。 */
const MAX_PATHS_TOTAL = 20000;
/** 会话数上限（淘汰最久未活动会话）。 */
const MAX_SESSIONS = 64;
/** 每会话 recent 历史条目上限（LRU，保持既有语义）。 */
export const RECENT_LIMIT = 5;
/** 日志前缀（淘汰 warn 可见）。 */
export const LOG_PREFIX = '[dsh-file-activity]';
/** 默认配额。 */
export function defaultLimits() {
    return { maxPathsPerSession: MAX_PATHS_PER_SESSION, maxPathsTotal: MAX_PATHS_TOTAL, maxSessions: MAX_SESSIONS };
}
/** 用默认值补齐（undefined / 非有限值回退默认）。 */
export function normalizeLimits(input) {
    const pick = (value, fallback) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
    return {
        maxPathsPerSession: pick(input?.maxPathsPerSession, MAX_PATHS_PER_SESSION),
        maxPathsTotal: pick(input?.maxPathsTotal, MAX_PATHS_TOTAL),
        maxSessions: pick(input?.maxSessions, MAX_SESSIONS),
    };
}
/** 空淘汰计数。 */
export function emptyEvicted() {
    return { sessions: 0, paths: 0, pathsTotal: 0 };
}
/** 空会话桶。 */
export function createSession() {
    return { known: {}, counts: {}, recent: [] };
}
/** 计数器最近活动时间（lastSeen → firstSeen → 0）。 */
function lastSeenOf(counters) {
    if (counters === undefined || counters === null)
        return 0;
    if (typeof counters.lastSeen === 'number')
        return counters.lastSeen;
    if (typeof counters.firstSeen === 'number')
        return counters.firstSeen;
    return 0;
}
/** 会话最近活动时间：recent 最新条目时间与所有计数器 lastSeen 的最大值。 */
function activityOf(session) {
    let newest = 0;
    if (Array.isArray(session.recent)) {
        for (const entry of session.recent) {
            if (typeof entry?.time === 'number' && entry.time > newest)
                newest = entry.time;
        }
    }
    for (const counters of Object.values(session.counts ?? {})) {
        const at = lastSeenOf(counters);
        if (at > newest)
            newest = at;
    }
    return newest;
}
/** 淘汰日志节流：首次 + 每 10 次（避免长会话下 warn 刷屏，但绝不静默）。 */
function shouldLogEvicted(total) {
    return total === 1 || total % 10 === 0;
}
/** 全局路径总数。 */
export function countPaths(state) {
    let total = 0;
    for (const session of Object.values(state.sessions))
        total += Object.keys(session.counts).length;
    return total;
}
/** 单个会话内路径超限：LRU 淘汰 lastSeen 最旧者（known/counts 同步）。 */
export function enforceSessionPathLimit(session, sessionId, limits, evicted, logger) {
    const overflow = Object.keys(session.counts).length - limits.maxPathsPerSession;
    if (overflow <= 0)
        return;
    const oldest = Object.entries(session.counts)
        .map(([path, counters]) => ({ path, lastSeen: lastSeenOf(counters) }))
        .sort((a, b) => a.lastSeen - b.lastSeen)
        .slice(0, overflow);
    for (const item of oldest) {
        delete session.counts[item.path];
        delete session.known[item.path];
    }
    evicted.paths += overflow;
    if (shouldLogEvicted(evicted.paths)) {
        logger?.warn(LOG_PREFIX +
            ' evict path: ' +
            overflow +
            ' LRU path(s) from session ' +
            sessionId +
            ' (cap=' +
            limits.maxPathsPerSession +
            ', evicted=' +
            evicted.paths +
            ')');
    }
}
/** 全局路径超限：LRU 淘汰全局 lastSeen 最旧者（跨会话扫描，known/counts 同步）。 */
export function enforceTotalPathLimit(state, limits, evicted, logger) {
    const overflow = countPaths(state) - limits.maxPathsTotal;
    if (overflow <= 0)
        return;
    const candidates = [];
    for (const [sessionId, session] of Object.entries(state.sessions)) {
        for (const [path, counters] of Object.entries(session.counts)) {
            candidates.push({ sessionId, path, lastSeen: lastSeenOf(counters) });
        }
    }
    candidates.sort((a, b) => a.lastSeen - b.lastSeen);
    let removed = 0;
    for (const item of candidates) {
        if (removed >= overflow)
            break;
        const session = state.sessions[item.sessionId];
        if (session === undefined || session.counts[item.path] === undefined)
            continue;
        delete session.counts[item.path];
        delete session.known[item.path];
        removed += 1;
    }
    evicted.pathsTotal += removed;
    if (shouldLogEvicted(evicted.pathsTotal)) {
        logger?.warn(LOG_PREFIX +
            ' evict path: ' +
            removed +
            ' LRU path(s) globally (cap=' +
            limits.maxPathsTotal +
            ', evicted=' +
            evicted.pathsTotal +
            ')');
    }
}
/** 会话数超限：淘汰最久未活动会话（整会话桶删除，known/counts/recent 一并释放）。 */
export function enforceSessionLimit(state, limits, evicted, logger) {
    const overflow = Object.keys(state.sessions).length - limits.maxSessions;
    if (overflow <= 0)
        return;
    const oldest = Object.entries(state.sessions)
        .map(([sessionId, session]) => ({ sessionId, activity: activityOf(session) }))
        .sort((a, b) => a.activity - b.activity)
        .slice(0, overflow);
    for (const item of oldest)
        delete state.sessions[item.sessionId];
    evicted.sessions += overflow;
    if (shouldLogEvicted(evicted.sessions)) {
        logger?.warn(LOG_PREFIX +
            ' evict session: ' +
            overflow +
            ' least-recently-active session(s) (cap=' +
            limits.maxSessions +
            ', evicted=' +
            evicted.sessions +
            ')');
    }
}
/**
 * 运行时记录后的配额执行顺序：全局路径 → 单会话路径 → 会话数。
 * 淘汰计数累加到 evicted（调用方负责写入 state.stats 并落日志）。
 */
export function enforceQuota(state, sessionId, limits, evicted, logger) {
    enforceTotalPathLimit(state, limits, evicted, logger);
    const session = state.sessions[sessionId];
    if (session !== undefined)
        enforceSessionPathLimit(session, sessionId, limits, evicted, logger);
    enforceSessionLimit(state, limits, evicted, logger);
}
