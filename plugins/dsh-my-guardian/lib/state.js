/**
 * dsh-my-guardian — state management: constants, persisted state (state.json)
 * and the candidate file (cordis.staged.json) helpers.
 *
 * All file writes are atomic (tmp + rename) and never throw to callers — the
 * guardian must never take the process down over a persistence failure.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteJson, createWriteScheduler } from 'dsh-shared';
/** Consecutive failures before an entry freezes (manual retry required). */
export const FREEZE_LIMIT = 3;
/** Keep at most this many diagnostic events in the state. */
export const EVENT_LIMIT = 20;
/** How many characters of an error message to keep in state. */
export const ERROR_SNIP = 300;
/** 日志前缀（落盘护栏 warn 用）。 */
const PREFIX = '[dsh-my-guardian]';
/**
 * 状态快照字节上限（护栏兜底，issue #198 收尾）：events ≤ EVENT_LIMIT(20) 条
 * （每条消息截断到 ERROR_SNIP=300 字符），staged/promoted 条目数 = 受管插件数
 * （数十量级），单条 config 大小由用户配置决定 → 4MB 是保守上限。
 * 超限**拒绝写入并 warn**（保留上一份完好快照），不再随条目增长无界放大磁盘占用。
 */
const STATE_MAX_BYTES = 4 * 1024 * 1024;
/** 候选文件字节上限（同上；条目来自扫描结果，数量级与受管插件数一致）。 */
const STAGED_MAX_BYTES = 4 * 1024 * 1024;
/** 启动预检报告字节上限（issues 条目数 = 受管插件数）。 */
const REPORT_MAX_BYTES = 4 * 1024 * 1024;
/** Guardian state dir: $DSH_HOME/guardian (fallback: ~/.dsh/guardian). */
function guardianDir() {
    const home = process.env.DSH_HOME;
    if (typeof home === 'string' && home !== '')
        return join(home, 'guardian');
    return join(homedir(), '.dsh', 'guardian');
}
/**
 * Persist the startup-roster pre-check report (issue #144) atomically at
 * $DSH_HOME/guardian/startup-issues.json. The report is written even when
 * the roster is healthy (empty issues + checkedAt) so the file doubles as a
 * "last checked" marker; missing/corrupt file only means "never written".
 * Never throws to callers — the guardian must not take the process down.
 */
export async function writeStartupIssuesFile(payload) {
    // 走 shared 快照原语（原子写 + 显式 4MB 上限 + 拦截计数）；失败只 warn，
    // 不上抛——报告是诊断产物，不能因此让 guardian 启动失败。
    await atomicWriteJson(join(guardianDir(), 'startup-issues.json'), payload, undefined, PREFIX, {
        minIntervalMs: 0,
        maxBytes: REPORT_MAX_BYTES,
    });
}
/** Empty state document. */
export function createState() {
    return { version: 1, safeMode: false, staged: {}, promoted: {}, events: [] };
}
/** Load persisted state (missing/corrupt file → fresh state). */
export async function loadState() {
    try {
        const raw = await readFile(join(guardianDir(), 'state.json'), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object' && parsed.version === 1)
            return parsed;
    }
    catch {
        // first run or unreadable file: start fresh
    }
    return createState();
}
/** 状态文件绝对路径（$DSH_HOME/guardian/state.json）。 */
function stateFilePath() {
    return join(guardianDir(), 'state.json');
}
/**
 * 状态落盘（issue #198 收尾：接入 dsh-shared 原语，不再自写串行链）：
 *  - `createWriteScheduler`：防抖 500ms + 最小间隔 1s + 串行链 + `drain()` 确定性就绪信号。
 *    原实现每次 persistSoon 立即排一次全量写（mount 链上 5 处调用 → 多次写放大）；
 *  - `atomicWriteJson`：tmp+rename 原子写 + **显式 4MB 字节上限** + 拦截计数
 *    （`atomicWriteStats()`）与 warn（不静默）；
 *  - teardown 收尾（#438）：`beginClosingWrites()` 打开**收尾写入窗口** →
 *    `settleClosingWrites()` 用「强写 + 让出宏任务」循环排空窗口（判据是收尾写活动静止，
 *    不是墙钟猜测），返回时最终快照必已落盘、窗口随即关闭 —— 此后 persistSoon 一律失效
 *    （#217：不让旧实例覆盖下一个实例的状态）。
 *    为什么需要窗口：宿主卸载整树时同批 disposer 由 `Promise.all` 并发执行、顺序无保证
 *    （vendor/cordis 的 fiber `_unload`），任一 entry 的 `loader/partial-dispose` 都可能
 *    晚于本实例的收尾快照到达；「只落一次快照 + 之后无 flush 钩子」的旧实现会让它永久丢失。
 */
/** 收尾排空的最大轮数（有界：异常情况下退出体验也不能被无限拖长）。 */
const CLOSING_MAX_ROUNDS = 6;
/** 收尾排空收敛所需的「连续无新写入」轮数（每轮 = 一次强写 + 一次宏任务让出）。 */
const CLOSING_QUIET_ROUNDS = 2;
/**
 * 让出一轮宏任务（不做任何时长假设）：给「同批并发 disposer」的微任务/宏任务链推进机会。
 * 收尾排空靠「原子写（真实 IO）+ 让出」推进，而不是用固定 sleep 猜时长
 * （见 plugins/dsh-shared/test-kit/wait.mjs 与 scripts/check-test-sleeps.mjs）。
 */
function yieldMacrotask() {
    return new Promise((resolve) => setImmediate(resolve));
}
export function createPersister(shared, logger) {
    const scheduler = createWriteScheduler({
        debounceMs: 500,
        // 与 atomicWriteJson 默认节流窗口一致（调度间隔 < 护栏窗口会拦下正常节奏）
        minIntervalMs: 1000,
        logger,
        prefix: PREFIX,
        // 节奏**单一来源**：调度器负责防抖 + 最小间隔，快照原语 `minIntervalMs: 0` 关节流。
        // 若两处都启用 1s 节流，`drain()`（非 force）的写会被原语节流拒掉 → 调度器重排耗尽后
        // 放弃 → 状态永不落盘（实测：guardian 的 promote 流程读盘断言失败）。
        write: ({ force }) => atomicWriteJson(stateFilePath(), shared.state, logger, PREFIX, {
            force,
            minIntervalMs: 0,
            maxBytes: STATE_MAX_BYTES,
        }),
    });
    /**
     * 收尾写入窗口（#438）：teardown 开始（disposed=true）后，同批并发 disposer 仍可能
     * emit loader/partial-dispose。窗口内 persistSoon 只记账（不排调度器的防抖写），
     * 由 settleClosingWrites() 的「强写 + 让出」循环排空并落盘。
     */
    let closing = false;
    let closingDirty = false;
    const persistSoon = () => {
        if (closing) {
            // 收尾窗口内：先记账，settleClosingWrites() 会把它排空落盘
            closingDirty = true;
            return;
        }
        // teardown 已开始且不在收尾窗口：本实例的任何延迟写都不该落到共享 state.json 上
        if (shared.disposed)
            return;
        scheduler.schedule();
    };
    /** 收尾强写（teardown 专用）：绕过 disposed 守卫 force 写一次并等落盘完成。 */
    const persistFinal = () => scheduler.flush();
    /** 确定性 drain 信号：resolve 时所有挂起/在飞快照（含防抖窗口内的）都已落盘。 */
    const flush = () => scheduler.drain();
    /** 打开收尾写入窗口（#438）：teardown 第一步调用（与 disposed=true 同步）。 */
    const beginClosingWrites = () => {
        closing = true;
    };
    /**
     * 排空收尾窗口并关闭它（#438）。
     *
     * 每轮 = 一次强写（真实原子写，必然让出多个事件循环轮次）+ 一次宏任务让出，
     * 之后检查窗口内是否又有新写入；**连续 CLOSING_QUIET_ROUNDS 轮无新写入**即收敛。
     * 判据是「收尾写活动静止」这一可观测事实，不是墙钟猜测；轮数有上界，退出体验不被拖长。
     */
    const settleClosingWrites = async () => {
        closing = true;
        let quiet = 0;
        try {
            for (let round = 0; round < CLOSING_MAX_ROUNDS && quiet < CLOSING_QUIET_ROUNDS; round += 1) {
                closingDirty = false;
                await persistFinal();
                await yieldMacrotask();
                quiet = closingDirty ? 0 : quiet + 1;
            }
        }
        finally {
            // 窗口关闭：此后 persistSoon 一律失效（#217：旧实例不得覆盖下一个实例的快照）
            closing = false;
        }
    };
    return { persistSoon, persistFinal, flush, beginClosingWrites, settleClosingWrites };
}
/** Read the candidate file; missing/corrupt → []. */
export async function readStagedFile(file) {
    try {
        const raw = await readFile(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
            return parsed;
    }
    catch {
        // missing or malformed: treat as empty
    }
    return [];
}
/**
 * Write the candidate file atomically. Returns an error object or null.
 * 走 shared 快照原语（紧凑 JSON：消除原 `JSON.stringify(entries, null, 2)` 的缩进放大；
 * 显式 4MB 上限；`minIntervalMs: 0` 因为这是挂载流程里的显式低频写，节奏由调用方决定）。
 */
export async function writeStagedFile(file, entries) {
    const written = await atomicWriteJson(file, entries, undefined, PREFIX, {
        minIntervalMs: 0,
        maxBytes: STAGED_MAX_BYTES,
    });
    return written ? null : new Error('staged file write blocked by shared guardrails (byte limit / IO)');
}
/** Shorten an error for the state record. */
export function errorSnip(error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    return message.length > ERROR_SNIP ? `${message.slice(0, ERROR_SNIP)}…` : message;
}
