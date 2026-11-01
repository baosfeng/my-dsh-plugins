import { buildVars } from './vars.js';
import { render } from './template.js';
/** 默认文案（五类事件；占位符即新语法变量）。 */
export const DEFAULT_MESSAGES = {
    end: { title: '{{session.title}}', body: '{{event.note}}' },
    ask: { title: '{{session.title}}', body: '{{ask.summary}}' },
    approval: { title: '{{session.title}}', body: '{{approval.reason}}' },
    subagentEnd: { title: '{{session.title}}', body: '{{event.note}}' },
    remote: { title: '{{session.title}}', body: '{{event.note}}' },
};
/** 文案键（事件类型 + 子代理 end 独立成键）。 */
const MESSAGE_KEYS = ['end', 'ask', 'approval', 'subagentEnd', 'remote'];
/**
 * 把用户配置的 messages 逐字段合并到默认文案（fail-open：非字符串 / 空串
 * 一律回退默认值，非法对象回退全部默认值）。
 *
 * @example
 *   resolveMessages({ end: { title: '会话结束' } }).end
 *   // → { title: '会话结束', body: '{{event.note}}' }
 */
export function resolveMessages(value) {
    const result = cloneDefaults();
    if (value === null || typeof value !== 'object')
        return result;
    const source = value;
    for (const key of MESSAGE_KEYS) {
        const item = source[key];
        if (item === null || typeof item !== 'object')
            continue;
        const templates = item;
        result[key] = {
            title: pickTemplate(templates.title, DEFAULT_MESSAGES[key].title),
            body: pickTemplate(templates.body, DEFAULT_MESSAGES[key].body),
        };
    }
    return result;
}
/** 深拷贝默认文案（避免调用方改到常量）。 */
function cloneDefaults() {
    return {
        end: { ...DEFAULT_MESSAGES.end },
        ask: { ...DEFAULT_MESSAGES.ask },
        approval: { ...DEFAULT_MESSAGES.approval },
        subagentEnd: { ...DEFAULT_MESSAGES.subagentEnd },
        remote: { ...DEFAULT_MESSAGES.remote },
    };
}
/** 单个模板取值：非字符串 / 空串 → 默认模板。 */
function pickTemplate(value, fallback) {
    return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}
/**
 * 事件 → 文案键：end 且 agentType 为 subagent 时用 subagentEnd 模板，
 * 未知事件回退 remote。
 */
export function messageKeyOf(kind, agentType) {
    if (kind === 'end')
        return agentType === 'subagent' ? 'subagentEnd' : 'end';
    if (kind === 'subagentEnd' || kind === 'ask' || kind === 'approval' || kind === 'remote')
        return kind;
    return 'remote';
}
/**
 * 渲染一条通知帧的 title / note（fail-open：异常时原样返回入参）。
 *
 * @example
 *   renderNoticeMessages({ kind: 'end', title: '演示项目' }, resolveMessages({}), { channel: 'browser' })
 *   // → { title: '演示项目', note: '' }
 */
export function renderNoticeMessages(notice, messages, context = {}) {
    try {
        const template = messages[messageKeyOf(notice.kind, notice.agentType)];
        const vars = buildVars({
            ...notice,
            channel: context.channel ?? '',
            pluginVersion: context.pluginVersion ?? '',
        });
        const preserve = Array.isArray(notice.preserve) ? notice.preserve : [];
        return {
            ...notice,
            // 用户显式给出的 title / body 优先于模板（远程触发契约），不被覆盖
            title: preserve.includes('title') ? notice.title : render(template.title, vars),
            note: preserve.includes('note') ? notice.note : render(template.body, vars),
        };
    }
    catch {
        // 渲染尽力而为：任何异常都回退原始帧，绝不打断推送路径
        return notice;
    }
}
