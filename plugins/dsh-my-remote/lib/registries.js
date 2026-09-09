/**
 * dsh-my-remote — 待处理注册表（事件层与指令层的中枢）。
 *
 * ask 注册表：ask 事件发生时登记（推送给外部通道），远程回答到达时按
 * sessionId 决议；approval 注册表同理，按 sessionId 决议
 * 'allowed-once' / 'rejected'。
 *
 * 注册表条目带 waitFor promise——事件层用 Promise.race([next(), entry.waitFor])
 * 等待本机（next()）或远程（决议）的先后结果；指令层 resolve/decide 时
 * settle waitFor，事件层据此短路并返回远程结果给 DSH 流程。
 *
 * 语义：
 *  - 决议（resolve/decide）后条目即从 Map 删除（单次消费，防重放：
 *    同一 sessionId 的第二次回答拿不到条目，返回 not-found）。
 *  - 同会话已有 pending 条目时重复 register 返回 false（事件层据此
 *    透传 next()，防御同会话并发 ask/approval 的异常形态）。
 *  - cleanSession 在会话结束（agent/status idle）时对未决议条目按
 *    fail-closed 决议（approval → 'rejected'，ask → expired 语义），
 *    防会话结束后远程指令绕行。
 *
 * 全部为纯内存结构（无 IO / 无持久化 / 无轮询），事件驱动，资源影响为零：
 * 无磁盘写入、无定时器、内存上界 = 并发 pending 条目数（通常 ≤ 会话数）。
 */
import { randomUUID } from 'node:crypto';
/** 未知会话或已消费的决议错误码。 */
export const NOT_FOUND = 'not-found';
/** 会话结束时对未决议 approval 的 fail-closed 决议。 */
export const SESSION_END_OUTCOME = 'rejected';
/** 会话结束时对未决议 ask 的回答标记（事件层据此 deny 而不继续执行）。 */
export const SESSION_END_ANSWER = { expired: true };
/** 创建单次决议信号：waitFor promise + settle 函数（settle 只能触发一次）。 */
function createSignal() {
    let settle;
    const waitFor = new Promise((resolve) => {
        settle = resolve;
    });
    return { waitFor, settle };
}
/**
 * 创建 ask 注册表。
 */
export function createAskRegistry() {
    /** sessionId → ask 条目（仅 pending，决议即删除）。 */
    const entries = new Map();
    /**
     * 登记新 ask。
     * @returns 条目（含 waitFor），同会话已有 pending 时返回 undefined。
     */
    function register(sessionId, questions, payload) {
        if (typeof sessionId !== 'string' || sessionId === '')
            return undefined;
        if (entries.has(sessionId))
            return undefined;
        const signal = createSignal();
        const entry = {
            id: randomUUID(),
            sessionId,
            questions: Array.isArray(questions) ? questions : [],
            payload,
            answer: undefined,
            at: Date.now(),
            ...signal,
        };
        entries.set(sessionId, entry);
        return entry;
    }
    /**
     * 远程回答：按 sessionId 决议 ask（answers 为裸数组，settle waitFor 并
     * 删除条目）。
     */
    function resolve(sessionId, answers) {
        const entry = entries.get(sessionId);
        if (entry === undefined)
            return { ok: false, code: NOT_FOUND };
        entry.answer = answers;
        entries.delete(sessionId);
        entry.settle(entry);
        return { ok: true, answer: answers };
    }
    /** 只读查看某会话当前 pending ask（未决议才返回条目，拷贝）。 */
    function peek(sessionId) {
        const entry = entries.get(sessionId);
        if (entry === undefined)
            return undefined;
        return { id: entry.id, sessionId: entry.sessionId, at: entry.at };
    }
    /** 会话结束清理：未决议 ask 按 expired 语义 settle（事件层据此 deny）。 */
    function cleanSession(sessionId) {
        const entry = entries.get(sessionId);
        if (entry === undefined)
            return;
        entry.answer = SESSION_END_ANSWER;
        entries.delete(sessionId);
        entry.settle(entry);
    }
    /** 全部 pending ask（状态查询用；拷贝防外部篡改）。 */
    function listPending() {
        return [...entries.values()].map((entry) => ({
            id: entry.id,
            sessionId: entry.sessionId,
            at: entry.at,
        }));
    }
    return { register, resolve, peek, cleanSession, listPending };
}
/**
 * 创建 approval 注册表。
 */
export function createApprovalRegistry() {
    /** sessionId → approval 条目（仅 pending，决议即删除）。 */
    const entries = new Map();
    /** 登记新 approval；同会话已有 pending 时返回 undefined。 */
    function register(sessionId, request) {
        if (typeof sessionId !== 'string' || sessionId === '')
            return undefined;
        if (entries.has(sessionId))
            return undefined;
        const signal = createSignal();
        const entry = {
            id: randomUUID(),
            sessionId,
            request,
            outcome: undefined,
            at: Date.now(),
            ...signal,
        };
        entries.set(sessionId, entry);
        return entry;
    }
    /**
     * 远程批准/拒绝：按 sessionId 决议（settle waitFor 并删除条目）。
     */
    function decide(sessionId, outcome) {
        const entry = entries.get(sessionId);
        if (entry === undefined)
            return { ok: false, code: NOT_FOUND };
        entry.outcome = outcome;
        entries.delete(sessionId);
        entry.settle(entry);
        return { ok: true, outcome };
    }
    /** 只读查看某会话当前 pending approval（拷贝）。 */
    function peek(sessionId) {
        const entry = entries.get(sessionId);
        if (entry === undefined)
            return undefined;
        return { id: entry.id, sessionId: entry.sessionId, at: entry.at };
    }
    /** 会话结束清理：未决议 approval 按 fail-closed（rejected）决议。 */
    function cleanSession(sessionId) {
        const entry = entries.get(sessionId);
        if (entry === undefined)
            return;
        entry.outcome = SESSION_END_OUTCOME;
        entries.delete(sessionId);
        entry.settle(entry);
    }
    /** 全部 pending approval（状态查询用；拷贝防外部篡改）。 */
    function listPending() {
        return [...entries.values()].map((entry) => ({
            id: entry.id,
            sessionId: entry.sessionId,
            at: entry.at,
        }));
    }
    return { register, decide, peek, cleanSession, listPending };
}
