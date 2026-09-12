/**
 * dsh-my-context — session state shapes (pure factories).
 *
 * 会话统计状态的结构定义与工厂函数。store.js（内存态）与 persist.js
 * （持久化规整）共用，避免两者互相 import 造成循环依赖。
 *
 * 资源护栏（issue #198）：容器**默认有界**——bySession 用 boundedMap（会话数
 * LRU 上限），每会话数组用 boundList（FIFO 上限 + 淘汰计数），不再是裸数组/裸对象。
 */
import { boundList, boundedMap } from 'dsh-shared';
import { MAX_ALERTS_PER_SESSION, MAX_OVERFLOWS_PER_SESSION, MAX_REQUESTS_PER_SESSION, MAX_SESSIONS, } from './constants.js';
/** 空 usage 桶（disjoint 计数：inputTokens 不含 cacheRead）。 */
export function zeroUsage() {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
    };
}
/** 空构成（估算 token 分类）。 */
export function zeroComposition() {
    return { system: 0, tools: 0, user: 0, inject: 0, assistant: 0, tool: 0 };
}
/** 初始空状态（bySession 有界：会话数超上限淘汰最久未使用）。 */
export function createState() {
    return { version: 1, bySession: boundedMap({ maxSize: MAX_SESSIONS }) };
}
/** 创建会话桶（惰性初始化；三个明细数组均为有界 FIFO 列表）。 */
export function createSession(sessionId) {
    return {
        sessionId,
        model: '',
        provider: '',
        contextWindow: 0,
        usage: zeroUsage(),
        turnUsage: { turn: 0, ...zeroUsage() },
        composition: zeroComposition(),
        // 最近一次请求的上下文长度（prompt = input + cacheRead + cacheWrite），
        // 溢出预警/上下文占用以此为准——历史累计 usage 含每轮重复的 cacheRead，
        // 不能作为"当前上下文占用"。
        lastPromptTokens: 0,
        requests: boundList({ maxSize: MAX_REQUESTS_PER_SESSION }),
        header: { system: '', tools: [], systemTokens: 0, toolsTokens: 0 },
        alerts: boundList({ maxSize: MAX_ALERTS_PER_SESSION }),
        overflows: boundList({ maxSize: MAX_OVERFLOWS_PER_SESSION }),
        updatedAt: 0,
    };
}
