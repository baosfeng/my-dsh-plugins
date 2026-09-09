/** 顶层会话判定：只有明确无任何子代理标记的会话才视为顶层。 */
export function isTopLevelAgent(agent) {
    if (agent === null || typeof agent !== 'object')
        return false;
    const a = agent;
    const session = a.session;
    const header = session?.header;
    if (header === undefined || header === null)
        return false;
    return !hasSubagentMarker(header, a.options);
}
/** 任一子代理标记命中即子代理（持久化标记 + 运行时深度 + 派生父会话）。 */
function hasSubagentMarker(header, options) {
    if (header.origin === 'subagent')
        return true;
    if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0)
        return true;
    if (typeof options?.subagentDepth === 'number' && options.subagentDepth > 0)
        return true;
    return typeof header.parentSession === 'string' && header.parentSession !== '';
}
/** 会话标题：sessionTitle 快照优先，回退 cwd 末段，再回退空串。 */
export function titleOf(ctx, agent) {
    try {
        const a = agent;
        const session = a?.session;
        const snapshotTitle = titleSnapshot(ctx, session);
        if (snapshotTitle !== '')
            return snapshotTitle;
        return cwdName(session);
    }
    catch {
        // title is best-effort; never let lookup break the event path
        return '';
    }
}
/** sessionTitle 快照标题（可选服务必须经 ctx.get 读取；失败返回空串）。 */
function titleSnapshot(ctx, session) {
    const titleService = ctx.get?.('sessionTitle');
    const snapshot = titleService?.get?.(session);
    if (snapshot !== undefined && snapshot !== null && typeof snapshot.title === 'string' && snapshot.title !== '') {
        return snapshot.title;
    }
    return '';
}
/** cwd 末段作为标题回退（去尾斜杠；无 cwd 返回空串）。 */
function cwdName(session) {
    const header = session?.header;
    const cwd = header?.cwd;
    if (typeof cwd === 'string' && cwd !== '') {
        const norm = cwd.replace(/\/+$/, '');
        const idx = norm.lastIndexOf('/');
        const name = idx === -1 ? norm : norm.slice(idx + 1);
        if (name !== '')
            return name;
    }
    return '';
}
/**
 * ask 问题结构化：questions 参数 → 外部通道可渲染、远程回答可匹配的列表。
 * 每题保留 id/header/question/options（label 列表），丢弃无关字段。
 */
export function askQuestionsOf(argumentsValue) {
    const questions = argumentsValue?.questions;
    if (!Array.isArray(questions) || questions.length === 0)
        return [];
    return questions
        .map(structuredQuestion)
        .filter((q) => q !== null);
}
/** 单个问题结构化：id + header/question 全文 + options 标签（尽力而为）。 */
function structuredQuestion(question) {
    if (question === null || typeof question !== 'object')
        return null;
    const q = question;
    const id = typeof q.id === 'string' && q.id !== '' ? q.id : '';
    const header = typeof q.header === 'string' ? q.header : '';
    const text = typeof q.question === 'string' ? q.question : '';
    const options = Array.isArray(q.options)
        ? q.options
            .filter((option) => option !== null &&
            typeof option === 'object' &&
            typeof option.label === 'string')
            .map((option) => option.label)
        : [];
    if (id === '' && text === '')
        return null;
    return { id, header, question: text, options };
}
