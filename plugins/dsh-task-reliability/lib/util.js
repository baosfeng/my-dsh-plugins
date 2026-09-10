export { withTimeout, userMessage } from 'dsh-shared';
export function randomId(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function header(headers, name) {
    const value = headers[name];
    return typeof value === 'string' ? value : undefined;
}
/** 文本块类型守卫（content blocks 里的 { type: 'text', text } 块）。 */
export function isTextBlock(block) {
    if (block === null || typeof block !== 'object')
        return false;
    const candidate = block;
    return candidate.type === 'text' && typeof candidate.text === 'string';
}
/** 从消息 content blocks 提取文本并拼接（带 trim）。 */
export function blocksText(blocks) {
    if (!Array.isArray(blocks))
        return '';
    return blocks
        .filter((block) => isTextBlock(block))
        .map((block) => block.text)
        .join('\n')
        .trim();
}
/** options → 可序列化纯对象（retryableCodes Set → 数组），供 patch 文件写入/API 回填。 */
export function configToPlain(options) {
    return {
        apiToken: options.apiToken,
        retryMax: options.retryMax,
        maxLoop: options.maxLoop,
        maxVerify: options.maxVerify,
        retryableCodes: [...options.retryableCodes],
        retryBaseMs: options.retryBaseMs,
        autopilot: options.autopilot,
        steerCooldownMs: options.steerCooldownMs,
        saveDebounceMs: options.saveDebounceMs,
        resumeGraceMs: options.resumeGraceMs,
        rateMaxActions: options.rateMaxActions,
        askTimeoutMs: options.askTimeoutMs,
        autopilotGraceMs: options.autopilotGraceMs,
        watchdogIntervalMs: options.watchdogIntervalMs,
        stallTimeoutMs: options.stallTimeoutMs,
        rescueOnTruncation: options.rescueOnTruncation,
        rescueMaxPerSession: options.rescueMaxPerSession,
        rescueCooldownMs: options.rescueCooldownMs,
    };
}
