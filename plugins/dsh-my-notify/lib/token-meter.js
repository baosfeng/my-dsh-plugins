/**
 * dsh-my-notify — 会话 token 计量（issue #109）。
 *
 * 只读观察 DSH `session/event` 事件，在 `assistant/message` 时累加真实
 * usage（inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens /
 * reasoningTokens，与 dsh-my-context 的数据来源 / 字段一致），按会话
 * 隔离。end 通知构造时据此产出 token 消耗（输入 / 输出 / 总计）。
 *
 * 会话耗时：以该会话首次观察到可计量事件的时间作为 start，到 end 通知
 * 时的 `now` 之差。若会话没有任何 usage 记录（拿不到数据），summary 返回
 * 空（调用方据此标注「不可用」，绝不硬造）。
 *
 * 全部为纯状态函数（无需 ctx）；`track` 幂等、`summary` 只读、`drop`
 * 在 end 通知后释放桶避免内存膨胀。
 */
/** 当前总 token：inputTokens + outputTokens（消费口径，不含缓存命中注入）。 */
function totalOf(usage) {
    return usage.inputTokens + usage.outputTokens;
}
/** 创建会话 token 计量器：track / summary / drop。 */
export function createTokenMeter() {
    const bySession = new Map();
    /**
     * 观察一次 session/event：assistant/message 且带真实 usage 时累加。
     * 首次记录会话活动时间（会话耗时的 start 参考点）。
     */
    function track(sessionId, event) {
        if (typeof sessionId !== 'string' || sessionId === '')
            return;
        const e = event;
        const usage = e?.type === 'assistant/message' ? e?.data?.usage : undefined;
        if (usage === null || typeof usage !== 'object')
            return;
        const u = usage;
        const bucket = bySession.get(sessionId) ?? initBucket();
        bucket.usage.inputTokens += numberOr(u.inputTokens, 0);
        bucket.usage.outputTokens += numberOr(u.outputTokens, 0);
        bucket.usage.cacheReadTokens += numberOr(u.cacheReadTokens, 0);
        bucket.usage.cacheWriteTokens += numberOr(u.cacheWriteTokens, 0);
        bucket.usage.reasoningTokens += numberOr(u.reasoningTokens, 0);
        bucket.requests += 1;
        bySession.set(sessionId, bucket);
    }
    /** 会话 token 摘要：{ input, output, cacheRead, total, requests, startedAt }。 */
    function summary(sessionId) {
        const bucket = bySession.get(sessionId);
        if (bucket === undefined)
            return undefined;
        const usage = bucket.usage;
        return {
            input: usage.inputTokens,
            output: usage.outputTokens,
            cacheRead: usage.cacheReadTokens,
            cacheWrite: usage.cacheWriteTokens,
            total: totalOf(usage),
            requests: bucket.requests,
            startedAt: bucket.startedAt,
        };
    }
    /** 删除会话桶（end 通知构造后调用，释放内存）。 */
    function drop(sessionId) {
        bySession.delete(sessionId);
    }
    return { track, summary, drop };
}
/** 新建会话桶（记录首次活动时间）。 */
function initBucket() {
    return {
        usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
        },
        requests: 0,
        startedAt: Date.now(),
    };
}
/** 非有限负数不累加（与 dsh-my-context numberOr 一致）。 */
function numberOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
