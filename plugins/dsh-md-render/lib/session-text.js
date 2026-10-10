/** content block 的文本（type 为 `text` / `reasoning` 且 `text` 是字符串）。 */
function textOfBlock(block) {
    if (block === null || typeof block !== 'object')
        return '';
    const { type, text } = block;
    if (type !== 'text' && type !== 'reasoning')
        return '';
    return typeof text === 'string' ? text : '';
}
/** 单条消息 → 逐 content block 记录围栏；返回登记的块数。 */
export function recordMessage(index, message) {
    const content = message?.content;
    if (!Array.isArray(content))
        return 0;
    let fences = 0;
    for (const block of content) {
        const text = textOfBlock(block);
        if (text !== '')
            fences += index.record(text);
    }
    return fences;
}
/** session/event → 记录围栏（事件结构不符 → 0；任何异常都不冒泡到事件总线）。 */
export function recordSessionEvent(index, event) {
    if (event === null || typeof event !== 'object')
        return 0;
    const { type, data } = event;
    try {
        if (type === 'user/message')
            return recordMessage(index, data);
        if (type === 'assistant/message')
            return recordMessage(index, data?.message);
        return 0;
    }
    catch {
        return 0;
    }
}
