/**
 * dsh-my-notify — DSH 生命周期事件监听（只读观察）。
 *
 * 监听 agent/status（idle → end）、tools/pre-execute（ask_user_question →
 * ask）、approval/request（→ approval）。waterfall 事件一律透传 next()，
 * 绝不改变工具/审批流程；按 options 开关决定注册哪些监听。
 *
 * 子代理策略（issue #26）：end 通知默认只推顶层会话；`subagentEnd: true`
 * 后子代理完成也推送，通知带 `agentType: 'subagent'` 标记与「子代理」标题
 * 前缀。ask/approval 始终只推顶层（行为不变）。
 *
 * `subagentEnd` 过滤集中在下游 emitNotice 出口（issue #112）：子代理 end
 * 这里始终产出 `agentType: 'subagent'` 帧，是否广播（SSE + webhook）由
 * emitNotice 按全局开关决定，SSE 与 webhook 双通道一致。
 */
import { isTopLevelAgent, titleOf, subagentTitleOf, askNoteOf, askQuestionsOf, askFullNoteOf } from './session.js';
import { createTokenMeter } from './token-meter.js';
/**
 * 注册三类事件监听 + 会话 token 计量，通知统一交给 emitNotice。
 * tokenMeter 由调用方（index.js）创建并跨配置重载共享，保证 end 通知能取到
 * 全量累计 usage。返回 disposer 数组。
 */
export function attachListeners(ctx, options, emitNotice, tokenMeter = createTokenMeter()) {
    const disposers = [];
    disposers.push(attachTokenMeterListener(ctx, tokenMeter));
    if (options.end)
        disposers.push(attachEndListener(ctx, options, emitNotice, tokenMeter));
    if (options.ask)
        disposers.push(attachAskListener(ctx, emitNotice));
    if (options.approval)
        disposers.push(attachApprovalListener(ctx, emitNotice));
    return disposers;
}
/** session/event 计量：assistant/message 真实 usage 按会话累加（只读观察）。 */
function attachTokenMeterListener(ctx, tokenMeter) {
    return ctx.on('session/event', (session, event) => tokenMeter.track(session?.id ?? '', event));
}
/** agent/status idle → end 通知（顶层无条件；子代理由 emitNotice 按 subagentEnd 过滤）。 */
function attachEndListener(ctx, options, emitNotice, tokenMeter) {
    return ctx.on('agent/status', (payload) => {
        const p = payload;
        if (p.status !== 'idle')
            return;
        const agent = p.agent;
        if (!agent)
            return;
        const sessionId = agent.id;
        const summary = tokenMeter.summary(sessionId);
        const notice = {
            kind: 'end',
            sessionId,
            title: isTopLevelAgent(agent) ? titleOf(ctx, agent) : subagentTitleOf(ctx, agent),
            agentType: isTopLevelAgent(agent) ? 'top' : 'subagent',
            tokens: summaryToTokens(summary),
            duration: summaryToDuration(summary),
            sessionUrl: sessionUrlOf(sessionId, options?.webBaseUrl),
        };
        tokenMeter.drop(sessionId);
        emitNotice(notice);
    });
}
/** tools/pre-execute 命中 ask_user_question → ask 通知（透传 next）。 */
function attachAskListener(ctx, emitNotice) {
    return ctx.on('tools/pre-execute', async (exec, next) => {
        const e = exec;
        if (e !== undefined && e !== null && e.name === 'ask_user_question') {
            const agent = e.agent;
            if (agent && isTopLevelAgent(agent)) {
                emitNotice({
                    kind: 'ask',
                    sessionId: agent.id,
                    title: titleOf(ctx, agent),
                    note: askNoteOf(e.arguments),
                    question: askFullNoteOf(e.arguments),
                    questions: askQuestionsOf(e.arguments),
                    agentType: 'top',
                });
            }
        }
        return next();
    });
}
/** approval/request → approval 通知（透传 next）。 */
function attachApprovalListener(ctx, emitNotice) {
    return ctx.on('approval/request', async (req, next) => {
        const r = req;
        if (r !== undefined && r !== null && isTopLevelAgent(r.agent)) {
            emitNotice({
                kind: 'approval',
                sessionId: r.agent.id,
                title: titleOf(ctx, r.agent),
                note: typeof r.reason === 'string' ? r.reason : '',
                toolName: typeof r.toolName === 'string' ? r.toolName : '',
                agentType: 'top',
            });
        }
        return next();
    });
}
/** token 计量 → token 消耗字段（全 0 / 无数据 → null，标注「不可用」不硬造）。 */
function summaryToTokens(summary) {
    if (summary === undefined)
        return null;
    const input = nonNegative(summary.input);
    const output = nonNegative(summary.output);
    const total = nonNegative(summary.total);
    if (input === 0 && output === 0 && total === 0)
        return null;
    return { input, output, total };
}
/** token 计量 → 会话耗时（秒；无起点参考 → null）。 */
function summaryToDuration(summary) {
    if (summary === undefined || typeof summary.startedAt !== 'number')
        return null;
    const seconds = (Date.now() - summary.startedAt) / 1000;
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
/**
 * 会话链接：配置了 webBaseUrl 时拼 `/sessions/<id>`，否则空串（模板变量可回退）。
 * 去尾斜杠用一次遍历定位（无正则回溯，CodeQL js/polynomial-redos，issue 修复）。
 */
function sessionUrlOf(sessionId, webBaseUrl) {
    if (typeof webBaseUrl !== 'string' || webBaseUrl === '')
        return '';
    let end = webBaseUrl.length;
    while (end > 0 && webBaseUrl[end - 1] === '/')
        end--;
    const base = end === webBaseUrl.length ? webBaseUrl : webBaseUrl.slice(0, end);
    return `${base}/sessions/${sessionId}`;
}
/** 非负数值，非法回退 0。 */
function nonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
