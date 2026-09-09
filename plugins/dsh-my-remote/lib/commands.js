/**
 * dsh-my-remote — 指令层：入站远程指令的处理与白名单。
 *
 * 动作白名单（安全：未知动作一律拒绝并记审计）：
 *  - answer   回答 ask（sessionId + answers[{id, selected, custom?}]）
 *  - approve  批准/拒绝 approval（sessionId + outcome）
 *  - continue 继续会话（sessionId + message，agent.steer 注入用户消息）
 *
 * status / audit 为查询（不写入；状态查询仅供外部通道/客户端查看）。
 * 所有写指令与未知动作尝试都写入操作审计（时间/动作/sessionId/结果/来源），
 * 远程控制比通知更敏感，操作留痕是安全验收之一。
 */
import { userMessage } from 'dsh-shared';
/** 可执行指令白名单。 */
export const COMMANDS = new Set(['answer', 'approve', 'continue']);
/** 合法的 approval outcome（与 DSH OUTCOMES 一致，'allowed-once' 是批准）。 */
const OUTCOMES = new Set(['allowed-once', 'rejected']);
/**
 * 处理远程指令：校验参数 → 分发 → 操作审计。
 */
export function processCommand(shared, action, payload, meta = {}) {
    const audit = (extra = {}) => shared.audit.record({ action, ...meta, ...extra });
    if (typeof action !== 'string' || !COMMANDS.has(action)) {
        audit({ ok: false, sessionId: payload?.sessionId ?? '', detail: 'unknown command' });
        shared.logger?.warn(`[dsh-my-remote] 收到未知远程指令（action=${String(action)}，source=${sourceOf(meta)}）`);
        return { ok: false, error: `unknown command: ${action}` };
    }
    const body = payload ?? {};
    let result;
    if (action === 'answer')
        result = answerCommand(shared, body, audit);
    else if (action === 'approve')
        result = approveCommand(shared, body, audit);
    else
        result = continueCommand(shared, body, audit);
    logCommand(shared, action, body, result, meta);
    return result;
}
/** 指令来源（meta.source 回退 'local'）。 */
function sourceOf(meta) {
    return meta.source ?? 'local';
}
/** 指令处理日志（统一 [dsh-my-remote] 前缀，issue #155）。 */
function logCommand(shared, action, body, result, meta) {
    shared.logger?.info(`[dsh-my-remote] 远程指令已处理（action=${action}，sessionId=${body?.sessionId ?? ''}，ok=${result.ok}，source=${sourceOf(meta)}）`);
}
/** answer：按 sessionId 决议 ask（answers 参数规整后交注册表）。 */
function answerCommand(shared, body, audit) {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const answers = normalizeAnswers(body.answers);
    if (sessionId === '' || answers === undefined) {
        audit({ ok: false, sessionId, detail: 'invalid payload' });
        return { ok: false, error: 'invalid answer payload' };
    }
    const result = shared.askRegistry.resolve(sessionId, answers);
    audit({
        ok: result.ok,
        sessionId,
        detail: result.ok ? `answered ${answers.length} question(s)` : result.code,
    });
    if (!result.ok)
        return { ok: false, error: `no pending ask for session ${sessionId}` };
    return { ok: true, result: { sessionId, answered: answers.length } };
}
/** approve：按 sessionId 决议 approval（outcome 白名单校验）。 */
function approveCommand(shared, body, audit) {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const outcome = typeof body.outcome === 'string' ? body.outcome : '';
    if (sessionId === '' || !OUTCOMES.has(outcome)) {
        audit({ ok: false, sessionId, detail: 'invalid payload' });
        return { ok: false, error: 'invalid approve payload' };
    }
    const result = shared.approvalRegistry.decide(sessionId, outcome);
    audit({
        ok: result.ok,
        sessionId,
        detail: result.ok ? `outcome ${outcome}` : result.code,
    });
    if (!result.ok)
        return { ok: false, error: `no pending approval for session ${sessionId}` };
    return { ok: true, result: { sessionId, outcome } };
}
/** continue：找到会话 agent 并 steer 注入用户消息（尽力而为）。 */
function continueCommand(shared, body, audit) {
    const input = normalizeContinue(body);
    if (input === null) {
        audit({ ok: false, sessionId: '', detail: 'invalid payload' });
        return { ok: false, error: 'invalid continue payload' };
    }
    const agent = agentOf(shared, input.sessionId);
    if (agent === undefined) {
        audit({ ok: false, sessionId: input.sessionId, detail: 'no live agent' });
        return { ok: false, error: `no live agent for session ${input.sessionId}` };
    }
    const error = steerMessage(agent, input.message);
    audit({
        ok: error === '',
        sessionId: input.sessionId,
        detail: error === '' ? `steered "${input.message.slice(0, 60)}…"` : error,
    });
    if (error !== '')
        return { ok: false, error: `steer failed: ${error}` };
    return { ok: true, result: { sessionId: input.sessionId, steered: true } };
}
/** continue 参数规整：sessionId/message 均合法才返回，否则 null。 */
function normalizeContinue(body) {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    const message = typeof body?.message === 'string' && body.message !== '' ? body.message.slice(0, 2000) : '';
    if (sessionId === '' || message === '')
        return null;
    return { sessionId, message };
}
/** steer 注入用户消息：成功返回空串，失败返回错误文本（尽力而为）。 */
function steerMessage(agent, message) {
    try {
        ;
        agent.steer(userMessage(message));
        return '';
    }
    catch (reason) {
        return reason instanceof Error ? reason.message : String(reason);
    }
}
/** 状态快照：活动顶层会话 + 待处理 ask/approval（外部通道/手机查询）。 */
export function statusSnapshot(shared) {
    const agents = agentsService(shared);
    const sessions = [];
    if (agents !== undefined) {
        for (const agent of rootsOf(agents)) {
            sessions.push({
                sessionId: agent?.id ?? '',
                title: titleOfAgent(shared, agent),
                pendingAsk: shared.askRegistry.peek(agent?.id) ?? null,
                pendingApproval: shared.approvalRegistry.peek(agent?.id) ?? null,
            });
        }
    }
    return {
        sessions,
        asks: shared.askRegistry.listPending(),
        approvals: shared.approvalRegistry.listPending(),
        time: Date.now(),
    };
}
/** agents 服务（可选；无服务时状态查询降级为空）。 */
function agentsService(shared) {
    const agents = shared.ctx.get?.('agents');
    return agents === undefined || agents === null ? undefined : agents;
}
/** 活动顶层会话（拷贝防篡改）。 */
function rootsOf(agents) {
    if (typeof agents.roots !== 'function')
        return [];
    try {
        return agents.roots();
    }
    catch {
        return [];
    }
}
/** 按 sessionId 取活体 agent（continue 指令用，尽力而为）。 */
function agentOf(shared, sessionId) {
    const agents = agentsService(shared);
    if (agents === undefined || typeof agents.get !== 'function')
        return undefined;
    try {
        return agents.get(sessionId);
    }
    catch {
        return undefined;
    }
}
/** 会话标题（复用事件层 helper；失败回退空串）。 */
function titleOfAgent(shared, agent) {
    try {
        return shared.titleOf(shared.ctx, agent);
    }
    catch {
        return '';
    }
}
/** answers 参数规整：{ id, selected[], custom? }[] 校验；非法返回 undefined。 */
function normalizeAnswers(value) {
    if (!Array.isArray(value) || value.length === 0)
        return undefined;
    const answers = [];
    for (const answer of value) {
        if (answer === null || typeof answer !== 'object')
            return undefined;
        const a = answer;
        if (typeof a.id !== 'string')
            return undefined;
        const selected = Array.isArray(a.selected)
            ? a.selected.filter((item) => typeof item === 'string')
            : [];
        const custom = typeof a.custom === 'string' ? a.custom : undefined;
        answers.push(custom === undefined ? { id: a.id, selected } : { id: a.id, selected, custom });
    }
    return answers;
}
