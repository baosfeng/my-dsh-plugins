/**
 * State model + persistence loading for file activity.
 *
 * 状态（recent 历史 + 每文件计数）按会话保存，持久化为 **JSON Lines** 增量日志
 * （issue #197：旧实现每次防抖落盘全量重写 → 写放大 3,665×）：
 *  - 事件行 `{"s","p","o","t"}`：一条记录一行，落盘字节 ≈ 事件本体字节；
 *  - compact 快照行：`~` 元信息行 + 每会话一行 `{"s","d"}` + `=` 结束行，
 *    由宿主在行阈值触发时原子重写（文件大小有界、启动加载可重建）。
 *
 * 加载是防御性的：缺失 / 损坏 / 版本不符 → 空状态；单行解析失败跳过。
 * 兼容升级前的单行全量 JSON 快照（整文件 JSON 解析成功即按老结构读取）。
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createSession, defaultLimits, emptyEvicted } from './quota.js';
import { trimToQuota } from './quota-trim.js';
/** 快照元信息行标记 / 快照结束行标记（非会话数据行）。 */
const META = '~';
const END = '=';
/** NUL 字符（路径合法性判定）。 */
const NUL = String.fromCharCode(0);
/** State file: $DSH_HOME/file-activity.json（JSON Lines 格式）。 */
export function stateFile() {
    const home = process.env.DSH_HOME;
    if (typeof home === 'string' && home !== '')
        return `${home}/file-activity.json`;
    return `${homedir()}/.dsh/file-activity.json`;
}
/** Empty state document. */
export function createState() {
    return { version: 1, sessions: {}, stats: { evicted: emptyEvicted() } };
}
/** 整文件 JSON（升级前的全量快照格式）。结构不符返回 null。 */
export function parseLegacySnapshot(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        return null;
    const doc = parsed;
    if (doc.version !== 1 || doc.sessions === null || typeof doc.sessions !== 'object')
        return null;
    return { sessions: doc.sessions, legacy: true };
}
/** 事件行（记录行）：`{"s","p","o","t"}`；非记录行返回 null。 */
function parseRecordLine(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return null;
    const row = value;
    if (typeof row.s !== 'string' || typeof row.p !== 'string')
        return null;
    if (row.s === '' || row.p === '')
        return null;
    return { sessionId: row.s, path: row.p, op: String(row.o ?? 'read'), time: typeof row.t === 'number' ? row.t : 0 };
}
/**
 * 解析状态文件全部行 → { snapshot, records }：
 *  - snapshot：最后一次 compact 的会话表（`{s,d}` 行，取最后出现者）；
 *  - records：文件内全部事件行（含快照之前的行；重放时快照优先，事件行幂等重放）。
 */
export function parseStateFileText(text) {
    const snapshot = {};
    const records = [];
    for (const entry of parseStateEntries(text)) {
        if (entry.kind === 'record') {
            records.push(entry.record);
            continue;
        }
        const session = toSession(entry.data);
        if (session !== null)
            snapshot[entry.sessionId] = session;
    }
    return { snapshot, records };
}
/** 非负数字兜底。 */
function numOr0(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
/** 单行 JSON 解析（空行 / 损坏行 / 非对象 → null）。 */
function parseJsonLine(raw) {
    const line = raw.trim();
    if (line === '')
        return null;
    try {
        const value = JSON.parse(line);
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value
            : null;
    }
    catch {
        return null;
    }
}
/** 一行 → 状态文件条目（快照行 `{s,d}` 或事件行 `{s,p,o,t}`）。 */
function toEntry(row) {
    const data = row.d;
    if (typeof row.s === 'string' && row.s !== '' && data !== null && typeof data === 'object' && !Array.isArray(data)) {
        return { kind: 'snapshot', sessionId: row.s, data };
    }
    const record = parseRecordLine(row);
    return record === null ? null : { kind: 'record', record };
}
/** 按行序解析状态文件：快照行（`{s,d}`）与事件行（`{s,p,o,t}`）保持文件顺序。 */
function parseStateEntries(text) {
    const entries = [];
    for (const raw of text.split('\n')) {
        const row = parseJsonLine(raw);
        if (row === null)
            continue;
        const entry = toEntry(row);
        if (entry !== null)
            entries.push(entry);
    }
    return entries;
}
/** 元信息行（`{"m":1,...}`）：单行 JSON，独立于文件整体结构（兼容单行全量快照）。 */
const META_LINE = /\{"m":1[^\n]*\}/;
/** 从文本中提取快照统计（历次淘汰计数）。 */
function extractSnapshotStats(text) {
    const match = META_LINE.exec(text);
    if (match === null)
        return undefined;
    try {
        const meta = JSON.parse(match[0]);
        if (meta.stats === null || typeof meta.stats !== 'object')
            return undefined;
        return meta.stats;
    }
    catch {
        return undefined;
    }
}
/** 非数组的普通对象判定。 */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** known 表规整（非数字时间 / 非法 path 丢弃）。 */
function toKnown(raw) {
    const known = {};
    if (!isPlainObject(raw))
        return known;
    for (const [path, at] of Object.entries(raw)) {
        if (typeof at === 'number' && path !== '' && !path.includes(NUL))
            known[path] = at;
    }
    return known;
}
/** counts 表规整（非法 path / 非法计数器丢弃）。 */
function toCounts(raw) {
    const counts = {};
    if (!isPlainObject(raw))
        return counts;
    for (const [path, value] of Object.entries(raw)) {
        if (path === '' || path.includes(NUL))
            continue;
        const counters = sanitizeCounters(value);
        if (counters !== null)
            counts[path] = counters;
    }
    return counts;
}
/** recent 列表规整（非法条目丢弃）。 */
function toRecent(raw) {
    const recent = [];
    if (!Array.isArray(raw))
        return recent;
    for (const entry of raw) {
        if (!isPlainObject(entry))
            continue;
        const path = entry.path;
        if (typeof path !== 'string' || path === '' || path.includes(NUL))
            continue;
        recent.push({ path, op: String(entry.op ?? 'read'), time: typeof entry.time === 'number' ? entry.time : 0 });
    }
    return recent;
}
/** 会话数据规整（结构非法返回 null）。 */
function toSession(raw) {
    if (!isPlainObject(raw))
        return null;
    return { known: toKnown(raw.known), counts: toCounts(raw.counts), recent: toRecent(raw.recent) };
}
/** 计数器防御性读取（非法结构返回 null）。 */
function sanitizeCounters(raw) {
    if (!isPlainObject(raw))
        return null;
    const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    const counters = { read: num(raw.read), create: num(raw.create), modify: num(raw.modify) };
    if (typeof raw.firstSeen === 'number')
        counters.firstSeen = raw.firstSeen;
    if (typeof raw.lastSeen === 'number')
        counters.lastSeen = raw.lastSeen;
    return counters;
}
/**
 * Load persisted state (missing/corrupt file → fresh state), then converge to
 * the entry caps（旧文件可能远超新上限：加载即按 LRU 淘汰并告警）。
 * 返回 { state, trimmed, evicted }。
 */
export async function loadState(file, limits = defaultLimits(), logger) {
    let text = '';
    try {
        text = await readFile(file, 'utf8');
    }
    catch {
        return { state: createState(), trimmed: false, evicted: emptyEvicted(), legacy: false };
    }
    const legacy = parseLegacySnapshot(text);
    const sessions = legacy === null ? sessionsOfJsonl(text) : sessionsOfLegacy(legacy);
    const result = trimToQuota({ version: 1, sessions }, limits, logger);
    return { ...mergeSnapshotStats(result, legacy?.stats ?? extractSnapshotStats(text)), legacy: legacy !== null };
}
/** 旧格式（整文件 JSON 快照）→ 会话表。 */
function sessionsOfLegacy(legacy) {
    const sessions = {};
    for (const [sessionId, raw] of Object.entries(legacy.sessions)) {
        const session = toSession(raw);
        if (session !== null)
            sessions[sessionId] = session;
    }
    return sessions;
}
/** JSON Lines → 会话表（快照行建立基线，事件行按序重放 = 运行时状态的精确重现）。 */
function sessionsOfJsonl(text) {
    const state = createState();
    for (const entry of parseStateEntries(text)) {
        if (entry.kind === 'snapshot') {
            const session = toSession(entry.data);
            if (session !== null)
                state.sessions[entry.sessionId] = session;
            continue;
        }
        foldRecord(state, entry.record.sessionId, entry.record.path, entry.record.op, entry.record.time);
    }
    return state.sessions;
}
/** 历次淘汰计数随快照持久化：重启后计数不归零（可观测性连续）。 */
function mergeSnapshotStats(result, stats) {
    if (stats === undefined)
        return result;
    result.evicted = {
        sessions: numOr0(stats.evicted?.sessions) + result.evicted.sessions,
        paths: numOr0(stats.evicted?.paths) + result.evicted.paths,
        pathsTotal: numOr0(stats.evicted?.pathsTotal) + result.evicted.pathsTotal,
    };
    result.state.stats.evicted = { ...result.evicted };
    return result;
}
/** Map a raw operation kind (tool name or client op) to 'read' | 'write' | 'edit' | 'delete'. */
export function mapOp(op) {
    switch (op) {
        case 'write':
            return 'write';
        case 'edit':
        case 'str_replace_editor':
            return 'edit';
        case 'delete':
            return 'delete';
        case 'read':
        case 'read_image':
        default:
            return 'read';
    }
}
/** 记录目标合法性：两个 id 均为非空字符串（path 不含 NUL）。 */
function isValidRecordTarget(sessionId, path) {
    return (typeof sessionId === 'string' && sessionId !== '' && typeof path === 'string' && path !== '' && !path.includes(NUL));
}
/** 'write' → create/modify by the known-file registry; 'edit' → modify; else read. */
function classifyOp(op, knownTime) {
    if (op === 'write')
        return knownTime ? 'modify' : 'create';
    if (op === 'edit')
        return 'modify';
    return 'read';
}
/** Increment the matching counter and refresh firstSeen/lastSeen. */
function bumpCount(counts, finalOp, firstSeen, timestamp) {
    if (finalOp === 'create')
        counts.create += 1;
    else if (finalOp === 'modify')
        counts.modify += 1;
    else
        counts.read += 1;
    counts.firstSeen = firstSeen;
    counts.lastSeen = timestamp;
}
/** Newest-first LRU history: one entry per path, cap at RECENT_LIMIT. */
function pushRecent(recent, path, op, time) {
    const existing = recent.findIndex((entry) => entry.path === path);
    if (existing !== -1)
        recent.splice(existing, 1);
    recent.unshift({ path, op, time });
    if (recent.length > 5)
        recent.length = 5;
}
/** 'delete': the file no longer exists on disk — drop it from stats and the
 *  known-file registry, and record a single delete history entry. */
function applyDelete(session, path, timestamp) {
    delete session.counts[path];
    delete session.known[path];
    pushRecent(session.recent, path, 'delete', timestamp);
    return true;
}
/**
 * Fold one observed operation into the state (no persistence side effects; the
 * caller persists the corresponding JSON Lines event).
 * 'write' is classified create vs modify through the per-session known-file
 * registry (first contact = create, later writes = modify); edits are always
 * modifies. 'delete' removes the file from stats entirely and records a single
 * delete history entry. Returns the created session bucket when newly added.
 */
export function foldRecord(state, sessionId, path, op, time) {
    if (!isValidRecordTarget(sessionId, path))
        return null;
    const created = state.sessions[sessionId] === undefined;
    const session = state.sessions[sessionId] ?? (state.sessions[sessionId] = createSession());
    const timestamp = typeof time === 'number' ? time : Date.now();
    if (op === 'delete') {
        applyDelete(session, path, timestamp);
        return { session, created, newPath: false };
    }
    const firstSeen = typeof session.known[path] === 'number' ? session.known[path] : timestamp;
    const finalOp = classifyOp(op, session.known[path]);
    session.known[path] = firstSeen;
    const existing = session.counts[path];
    const counts = existing ?? (session.counts[path] = { read: 0, create: 0, modify: 0 });
    bumpCount(counts, finalOp, firstSeen, timestamp);
    pushRecent(session.recent, path, finalOp, timestamp);
    return { session, created, newPath: existing === undefined };
}
/**
 * Whether `path` appears in this session's recorded file activity (counts or
 * recent). The media route authorizes EXACTLY these paths — the record itself
 * is the permission: the agent actually touched the file, so previewing it is
 * expected, while arbitrary unrecorded paths stay refused.
 */
export function isRecordedPath(state, sessionId, path) {
    const session = state.sessions[sessionId];
    if (session === undefined)
        return false;
    if (session.counts !== undefined && typeof session.counts[path] === 'object' && session.counts[path] !== null)
        return true;
    // Deleted files no longer exist on disk — a delete history entry must not
    // authorize media preview for them.
    if (Array.isArray(session.recent))
        return session.recent.some((entry) => entry.path === path && entry.op !== 'delete');
    return false;
}
