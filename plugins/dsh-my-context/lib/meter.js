/**
 * dsh-my-context — token estimation (pure functions).
 *
 * 与 DSH 官方 token-meter（dsh-token-meter/estimate.ts）一致的固定密度
 * 估算：~4 字符 ≈ 1 token，每个 content block +4，每条消息 +4 role framing。
 * 用于在真实 usage 缺失时估算上下文构成（system/tools/user/inject/
 * assistant/tool 分类），以及请求总 token 的构成拆分。
 */
const CHARS_PER_TOKEN = 4;
const BLOCK_OVERHEAD = 4;
const ROLE_OVERHEAD = 4;
/** 纯文本估算：ceil(len/4) + block 开销。 */
export function estimateText(text) {
    if (typeof text !== 'string' || text.length === 0)
        return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
}
/** 递归估算 content blocks（text/reasoning/tool-call/tool-result/image/其他）。 */
export function estimateBlocks(blocks) {
    if (!Array.isArray(blocks))
        return 0;
    let tokens = 0;
    for (const block of blocks) {
        if (block === null || typeof block !== 'object') {
            tokens += BLOCK_OVERHEAD;
            continue;
        }
        const obj = block;
        switch (obj.type) {
            case 'text':
            case 'reasoning':
                tokens += estimateText(obj.text);
                break;
            case 'tool-call':
                tokens += estimateText(obj.name) + estimateText(obj.arguments) + BLOCK_OVERHEAD;
                break;
            case 'tool-result':
                tokens += estimateBlocks(obj.content) + BLOCK_OVERHEAD;
                break;
            default:
                tokens += estimateText(JSON.stringify(block)) + BLOCK_OVERHEAD;
        }
    }
    return tokens;
}
/** 单条消息估算：content blocks + role framing（空 content 计 0）。 */
export function estimateMessage(message) {
    if (message === null || typeof message !== 'object')
        return 0;
    const obj = message;
    if (!Array.isArray(obj.content) || obj.content.length === 0)
        return 0;
    return estimateBlocks(obj.content) + ROLE_OVERHEAD;
}
/** system prompt 估算：文本 + role framing。 */
export function estimateSystem(text) {
    if (typeof text !== 'string' || text.length === 0)
        return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD;
}
/** 工具数组整体估算（与 dsh token-meter 的 whole-array price 一致）。 */
export function estimateTools(tools) {
    if (!Array.isArray(tools) || tools.length === 0)
        return 0;
    return Math.ceil(JSON.stringify(tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
}
/** 单个工具 schema 估算（top-tools 展示用）。 */
export function estimateToolSchema(tool) {
    if (tool === null || typeof tool !== 'object')
        return 0;
    return Math.ceil(JSON.stringify(tool).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
}
/** 消息是否为空（无 content 或 content 为空数组）。 */
export function isEmptyMessage(message) {
    return (message === null || typeof message !== 'object' || !Array.isArray(message.content) || message.content.length === 0);
}
