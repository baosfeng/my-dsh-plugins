/**
 * dsh-task-reliability — session text extraction.
 *
 * 依赖 util.js（blocksText）与 constants.js（SUMMARY_MAX_CHARS）。
 * 顶层会话判定、最后一条 assistant 文本读取与会话摘要拼接。
 */
import { blocksText, isTextBlock } from './util.js';
import { SUMMARY_MAX_CHARS } from './constants.js';
/** 顶层会话判定：跳过子代理（subagent）会话，只保障用户直接查看的会话。 */
export function isTopLevelAgent(agent) {
    const header = agent?.session?.header;
    if (header === undefined || header === null)
        return false;
    if (header.origin === 'subagent')
        return false;
    if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0)
        return false;
    return true;
}
/** 文本块拼接（不 trim，保持 lastAssistantText 原始语义）。 */
function textBlocksOf(blocks) {
    if (!Array.isArray(blocks))
        return '';
    return blocks
        .filter((block) => isTextBlock(block))
        .map((block) => block.text)
        .join('\n');
}
/** 单条事件的 assistant 文本（非 assistant 消息返回空串）。 */
function assistantTextOf(event) {
    if (event?.type !== 'assistant/message')
        return '';
    const message = event.data?.message;
    if (message === undefined || message === null)
        return '';
    const blocks = message.content;
    if (!Array.isArray(blocks))
        return '';
    return textBlocksOf(blocks);
}
/** 从后向前扫描事件，返回第一条非空 assistant 文本。 */
function scanEvents(events) {
    for (let i = events.length - 1; i >= 0; i--) {
        const text = assistantTextOf(events[i]);
        if (text !== '')
            return text;
    }
    return '';
}
/** 会话事件快照：新 API snapshotEvents() 优先，旧 API events 兜底（issue #165）。 */
export function sessionEvents(session) {
    return session?.snapshotEvents?.() ?? session?.events;
}
/** 会话最后一条 assistant 文本消息（校验 agent 结论读取）。 */
export function lastAssistantText(session) {
    try {
        const events = sessionEvents(session);
        if (!Array.isArray(events))
            return '';
        return scanEvents(events);
    }
    catch {
        // best-effort
    }
    return '';
}
/** 单条事件的可读文本（user/assistant 前缀 + 截断 600 字符）。 */
function eventText(event) {
    const type = event?.type;
    if (type !== 'user/message' && type !== 'assistant/message')
        return '';
    const content = event?.data?.message?.content;
    if (content === undefined)
        return '';
    const text = blocksText(content);
    if (text === '')
        return '';
    return type === 'user/message' ? `用户: ${text.slice(0, 600)}` : `助手: ${text.slice(0, 600)}`;
}
/** 会话摘要：拼接最近用户消息与 assistant 文本（截断）。 */
export function summarizeSession(session, desc) {
    const parts = [];
    try {
        const events = sessionEvents(session);
        if (Array.isArray(events)) {
            const tail = events.slice(-40);
            for (const event of tail) {
                const text = eventText(event);
                if (text !== '')
                    parts.push(text);
            }
        }
    }
    catch {
        // best-effort
    }
    let summary = parts.join('\n');
    if (summary.length > SUMMARY_MAX_CHARS)
        summary = summary.slice(-SUMMARY_MAX_CHARS);
    return summary === '' ? `（无法读取会话历史）任务描述：${desc}` : summary;
}
