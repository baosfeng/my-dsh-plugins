/**
 * dsh-task-reliability — completion verifier & restart resume.
 *
 * 依赖 util.js（withTimeout/userMessage）、text.js（lastAssistantText/
 * summarizeSession）与 constants.js。会话结束后启动独立校验 agent 判断
 * 任务完成度；插件启动时恢复休眠前未完成的任务。
 */
import { withTimeout, userMessage } from './util.js';
import { lastAssistantText, summarizeSession } from './text.js';
import { DIRECT_CONTINUE_TEXT, RESUME_CONTINUE_TEXT, VERIFY_TIMEOUT_MS, WAKE_CONTINUE_TEXT } from './constants.js';
import { PLUGIN_EVENTS } from './emit.js';
function verifyPrompt(task, summary) {
    return `你是一个任务完成度校验员。请阅读以下任务与当前会话进展，判断任务是否已经真正完成。

任务：${task.description}

会话最近进展：
${summary}

请严格只输出一个 JSON 对象（不要输出其他内容）：
{"done": true 或 false, "reason": "完成或未完成的简明原因（50 字以内）"}

判断标准：任务的所有要求是否都已被满足；如果还有未完成、未验证、或中途中断的部分，done 必须为 false。`;
}
function verifyServiceReady(agents) {
    return agents !== undefined && agents !== null && typeof agents.create === 'function';
}
/** 校验失败/不可用时的降级路径：直接以继续文本唤醒主 agent。 */
function continueDirect(ctx, task, agent, save, emit) {
    task.status = 'active';
    agent.followup(userMessage(DIRECT_CONTINUE_TEXT(task.description)));
    task.loopCount += 1;
    task.updatedAt = Date.now();
    save();
    ctx.logger?.warn?.(`[dsh-task-reliability] 完成度校验降级为直接继续（taskId=${task.id}，sessionId=${agent.id}，原因=校验服务不可用或校验失败）`);
    emit?.(PLUGIN_EVENTS.VERIFY, {
        sessionId: task.sessionId,
        action: 'verify-degrade',
        reason: 'verifier-unavailable',
        taskId: task.id,
    });
}
async function sessionSummary(ctx, agent, task) {
    const sessionQuery = ctx.get('sessionQuery');
    if (sessionQuery === undefined || sessionQuery === null || typeof sessionQuery.readSession !== 'function')
        return task.description;
    try {
        const log = await sessionQuery.readSession(agent.id);
        return summarizeSession(log, task.description);
    }
    catch {
        return task.description;
    }
}
async function spawnVerifier(agents, task, agent) {
    try {
        return await agents.create({
            sessionId: `verify-${task.id}`,
            meta: { origin: 'subagent', delegationDepth: 1 },
            agentOptions: {
                ...(agent.options?.provider !== undefined ? { provider: agent.options.provider } : {}),
                ...(agent.options?.model !== undefined ? { model: agent.options.model } : {}),
            },
        });
    }
    catch {
        return undefined;
    }
}
async function collectConclusion(handle, task, summary) {
    try {
        handle.agent.followup(userMessage(verifyPrompt(task, summary)));
        await withTimeout(handle.agent.whenIdle(), VERIFY_TIMEOUT_MS);
        return parseConclusion(lastAssistantText(handle.agent.session));
    }
    catch {
        return undefined;
    }
}
async function disposeHandle(handle) {
    try {
        await handle.dispose();
    }
    catch {
        // dispose is best-effort
    }
}
/** 校验未完成：携带结论（若有）唤醒主 agent 继续。 */
function continueWithConclusion(task, agent, save, conclusion, emit) {
    task.status = 'active';
    const reason = conclusion?.reason !== undefined && conclusion.reason !== '' ? conclusion.reason : '';
    agent.followup(userMessage(reason !== ''
        ? `【任务校验】校验员判断任务尚未完成：${reason}。请继续完成剩余部分。`
        : DIRECT_CONTINUE_TEXT(task.description)));
    task.loopCount += 1;
    save();
    emit?.(PLUGIN_EVENTS.VERIFY, {
        sessionId: task.sessionId,
        action: 'verify-continue',
        reason: reason !== '' ? reason : 'not-done',
        taskId: task.id,
        verifyCount: task.verifyCount,
    });
}
/** 校验通过结案：标记 done + 日志 + 事件（issue #155/#154）。 */
function concludeDone(ctx, task, agent, save, emit, conclusion) {
    task.status = 'done';
    save();
    ctx.logger?.info?.(`[dsh-task-reliability] 完成度校验通过，任务结案（taskId=${task.id}，sessionId=${agent.id}，原因=${conclusion.reason || '无'}）`);
    emit?.(PLUGIN_EVENTS.VERIFY, {
        sessionId: task.sessionId,
        action: 'verify-done',
        reason: conclusion.reason !== '' ? conclusion.reason : 'done',
        taskId: task.id,
        verifyCount: task.verifyCount,
    });
}
/** 校验未完成日志（issue #155）。 */
function logVerifyContinue(ctx, task, agent, conclusion) {
    ctx.logger?.info?.(`[dsh-task-reliability] 完成度校验未完成，唤醒继续（taskId=${task.id}，sessionId=${agent.id}，原因=${conclusion?.reason || '无结论'}）`);
}
/** 完整校验流程：创建校验 agent → 收集结论 → done 结案或唤醒继续。 */
export async function runVerification(ctx, store, task, agent, save, emit) {
    const agents = ctx.get('agents');
    if (!verifyServiceReady(agents))
        return continueDirect(ctx, task, agent, save, emit);
    const summary = await sessionSummary(ctx, agent, task);
    const handle = await spawnVerifier(agents, task, agent);
    if (handle === undefined)
        return continueDirect(ctx, task, agent, save, emit);
    emit?.(PLUGIN_EVENTS.VERIFY, {
        sessionId: task.sessionId,
        action: 'verify-start',
        reason: 'session-idle',
        taskId: task.id,
    });
    const conclusion = await collectConclusion(handle, task, summary);
    await disposeHandle(handle);
    task.verifyCount += 1;
    task.updatedAt = Date.now();
    if (conclusion?.done === true) {
        concludeDone(ctx, task, agent, save, emit, conclusion);
        return;
    }
    logVerifyContinue(ctx, task, agent, conclusion);
    continueWithConclusion(task, agent, save, conclusion, emit);
}
function parseConclusion(text) {
    if (typeof text !== 'string' || text === '')
        return undefined;
    try {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start)
            return undefined;
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (parsed === null || typeof parsed !== 'object')
            return undefined;
        return {
            done: parsed.done === true,
            reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : '',
        };
    }
    catch {
        return undefined;
    }
}
// ── 重启恢复 ───────────────────────────────────────────────────────────────
function resumeServiceReady(agents) {
    return agents !== undefined && agents !== null && typeof agents.resume === 'function';
}
/** 取回 agent：live 直接复用，否则 resume；失败标记任务 failed。 */
async function tryResumeAgent(agents, task) {
    try {
        const live = agents.get(task.sessionId);
        if (live !== undefined)
            return live;
        const handle = await agents.resume({
            resumeSessionId: task.sessionId,
            agentOptions: {},
        });
        return handle.agent;
    }
    catch {
        task.status = 'failed';
        task.updatedAt = Date.now();
        return undefined;
    }
}
function wakeAgent(task, agent) {
    try {
        agent.followup(userMessage(RESUME_CONTINUE_TEXT(task.description)));
        task.resumeAt = Date.now();
        task.updatedAt = Date.now();
    }
    catch {
        // followup is best-effort; keep the task active for a later attempt
    }
}
/** 扫描活动任务并恢复（resumeAt 幂等，已恢复过的任务跳过）。 */
export async function resumeActiveTasks(ctx, store, save, emit) {
    const agents = ctx.get('agents');
    if (!resumeServiceReady(agents))
        return;
    for (const task of store.tasks) {
        if (task.status !== 'active')
            continue;
        if (task.resumeAt !== 0)
            continue;
        const agent = await tryResumeAgent(agents, task);
        if (agent === undefined)
            continue;
        wakeAgent(task, agent);
        ctx.logger?.info?.(`[dsh-task-reliability] 重启恢复任务（taskId=${task.id}，sessionId=${task.sessionId}，注入继续指令）`);
        emit?.(PLUGIN_EVENTS.RESUME, {
            sessionId: task.sessionId,
            action: 'resume-task',
            reason: 'restart',
            taskId: task.id,
        });
    }
    save();
}
// ── 任务停滞看门狗（issue #34）────────────────────────────────────────────
/**
 * 唤醒单个停滞任务：live agent 直接复用，否则 resume；注入唤醒继续指令并
 * 刷新活动时间。与重启恢复不同，唤醒失败不标记 failed（网络/会话暂时不可用
 * 时留给下一次看门狗轮询重试）。返回是否成功唤醒（/task continue 复用）。
 */
export async function wakeStalledTask(ctx, task, save, emit) {
    const agents = ctx.get('agents');
    if (!resumeServiceReady(agents))
        return false;
    let agent;
    try {
        const live = agents.get(task.sessionId);
        agent =
            live !== undefined
                ? live
                : (await agents.resume({
                    resumeSessionId: task.sessionId,
                    agentOptions: {},
                })).agent;
    }
    catch {
        return false;
    }
    if (agent === undefined)
        return false;
    try {
        agent.followup(userMessage(WAKE_CONTINUE_TEXT(task.description)));
        task.updatedAt = Date.now();
    }
    catch {
        // followup is best-effort; keep the task active for a later attempt
        return false;
    }
    save();
    ctx.logger?.info?.(`[dsh-task-reliability] 看门狗唤醒停滞任务（taskId=${task.id}，sessionId=${task.sessionId}，注入继续指令）`);
    emit?.(PLUGIN_EVENTS.RESCUE, {
        sessionId: task.sessionId,
        action: 'wake-stalled',
        reason: 'stall-timeout',
        taskId: task.id,
    });
    return true;
}
/**
 * 扫描停滞的活动任务（最后活动时间超过阈值）并逐个唤醒。
 * 第 5 参数兼容两种调用：函数 = emit（index.js 传入），数字 = now（测试直调）。
 */
export async function runWatchdog(ctx, store, save, options, emitOrNow, now) {
    const emit = typeof emitOrNow === 'function' ? emitOrNow : undefined;
    const at = typeof emitOrNow === 'number' ? emitOrNow : (now ?? Date.now());
    for (const task of store.tasks) {
        if (task.status !== 'active')
            continue;
        if (at - task.updatedAt < options.stallTimeoutMs)
            continue;
        await wakeStalledTask(ctx, task, save, emit);
    }
}
