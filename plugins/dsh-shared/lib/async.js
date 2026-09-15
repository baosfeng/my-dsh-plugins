/**
 * dsh-shared — async / message helpers（由 dsh-task-reliability / dsh-my-observability
 * 的 util.js、ai.js 抽取合并，issue #45）。
 */
import { randomUUID } from 'node:crypto';
/** 超时包装：ms 内未 settle 则 resolve undefined（不 reject）。 */
export function withTimeout(promise, ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), ms);
        Promise.resolve(promise).then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, () => {
            clearTimeout(timer);
            resolve(undefined);
        });
    });
}
/** 构造 user 角色消息（agent.steer / followup 用）。 */
export function userMessage(text) {
    // CodeQL js/insecure-randomness 修复：改用 crypto.randomUUID()
    // （密码学安全随机，无种子碰撞风险）
    return {
        id: `msg-${randomUUID().replace(/-/g, '')}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
    };
}
