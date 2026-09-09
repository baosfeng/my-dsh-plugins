/**
 * dsh-my-guard — prompt injection detection（提示注入检测）。
 *
 * 纯函数检测引擎 + 会话监听：
 *  - detectPromptInjection(text) — 规则 + 启发式检测（INJECTION_RULES），
 *    返回命中规则列表 [{ id, severity, message }]；
 *  - extractUserText(message)    — 从 user/message 的 data 提取文本；
 *  - attachInjectionListener     — 监听 `session/event` 的 user/message
 *    （过滤插件注入消息），命中规则时逐条记录告警。
 */
import { INJECTION_RULES } from './constants.js';
/** 注册提示注入检测监听器；返回 disposer。 */
export function attachInjectionListener(ctx, recordAlert) {
    return ctx.on('session/event', (session, event) => {
        handleSessionEvent(session, event, recordAlert);
    });
}
/** 处理单个 session/event：user/message 命中规则时逐条记录告警。 */
function handleSessionEvent(session, event, recordAlert) {
    if (event === null || typeof event !== 'object' || event.type !== 'user/message')
        return;
    const message = event.data;
    if (isPluginInjected(message))
        return;
    const text = extractUserText(message);
    if (text === '')
        return;
    const hits = detectPromptInjection(text);
    if (hits.length === 0)
        return;
    recordHits(hits, sessionIdOf(session), text, recordAlert);
}
/** 逐条记录命中告警（detail 带规则 id、命中原文与规则说明，供面板展示）。 */
function recordHits(hits, sessionId, text, recordAlert) {
    for (const hit of hits) {
        recordAlert({
            type: 'injection',
            sessionId,
            severity: hit.severity,
            message: hit.message,
            detail: { rule: hit.id, snippet: truncateText(text), explain: hit.explain || '' },
        });
    }
}
/** 从 session 提取 id（无 id 返回空串）。 */
function sessionIdOf(session) {
    return session !== null && typeof session === 'object' && typeof session.id === 'string'
        ? session.id
        : '';
}
/** 是否为插件注入的消息（source.kind === 'plugin'，非真实用户输入）。 */
export function isPluginInjected(message) {
    const obj = message;
    const source = obj?.source;
    return source !== null && typeof source === 'object' && source.kind === 'plugin';
}
/** 从 user/message 的 data 提取文本（content 中全部 text block 拼接）。 */
export function extractUserText(message) {
    if (message === null || typeof message !== 'object')
        return '';
    const content = message.content;
    if (!Array.isArray(content))
        return '';
    const parts = [];
    for (const block of content) {
        if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
            parts.push(block.text);
        }
    }
    return parts.join(' ');
}
/**
 * 提示注入检测：返回命中规则列表（无命中返回空数组）。
 *
 * 误报豁免：`discussable` 规则（如"越狱"/"禁用安全机制"字样在普通提问
 * 里也会匹配正则——"为什么会有越狱告警"）在整条消息是**元讨论**（谈
 * 论/询问护栏、告警、规则本身）且**不含强令词**时豁免；强令词（忽略/
 * 覆盖/扮演/你是系统管理员…）保留告警，真正的注入指令不受影响。
 */
export function detectPromptInjection(text) {
    if (typeof text !== 'string' || text === '')
        return [];
    const metaDiscussionOnly = isMetaDiscussion(text);
    const hits = [];
    for (const rule of INJECTION_RULES) {
        if (rule.re.test(text)) {
            if (metaDiscussionOnly && rule.discussable === true && !isDirective(text))
                continue;
            hits.push({
                id: rule.id,
                severity: rule.severity,
                message: rule.message,
                explain: rule.explain || '',
            });
        }
    }
    return hits;
}
/** 元讨论特征：文本在谈论/询问护栏告警、规则、检测本身（而非在下指令）。 */
export function isMetaDiscussion(text) {
    return (typeof text === 'string' &&
        text !== '' &&
        /告警|误报|规则|检测|命中|触发|什么意思|为什么|为何|这是什么|是不是|会不会|讨论|科普|案例|举例|解释|说明|聊聊|怎么(回事|看)|啥意思|\b(what|why|explain|alerts?|rules?|detect|trigger|false\s*positive|discuss)\b/i.test(text));
}
/** 强令特征：要求模型即刻执行/改写的明确指令词（攻击性语境）。 */
export function isDirective(text) {
    return (typeof text === 'string' &&
        text !== '' &&
        /忽略|覆盖|override|ignore|disregard|假装|扮演|pretend|act\s+as|你是(系统|管理员|root)|你现在是|do\s+anything|system\s+prompt|立即|马上|立刻|现在就|现在给我|现在开始|现在执行/i.test(text));
}
/** 文本截断（去换行，限长）。 */
export function truncateText(text) {
    const oneLine = text.split('\n')[0].trim();
    return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}
