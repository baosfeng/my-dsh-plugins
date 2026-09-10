/**
 * dsh-my-observability — AI-augmented diff review (optional).
 *
 * 规则引擎（lib/review.js）给出确定性结果后，若 agents 服务可用且配置
 * 开启 aiReview，创建独立审查 agent 阅读增量 diff 并输出 JSON 结论：
 *  - 成功：报告追加 { enabled, verdict, summary, topIssues }
 *  - 超时 / agents 不可用 / 结论解析失败：降级 { enabled, failed, note }，
 *    规则引擎结果不受影响（AI 是增强，不是门禁）
 *
 * 参考 dsh-task-reliability 的校验 agent 模式（agents.create + whenIdle
 * 超时 + dispose）。
 */
import { randomUUID } from 'node:crypto';
import { withTimeout, userMessage } from 'dsh-shared';
import { REVIEW_TIMEOUT_MS } from './constants.js';
/** diff 送入 prompt 的最大长度（截断防 token 爆炸）。 */
const AI_DIFF_MAX = 8000;
/** 运行 AI 审查（尽力而为；任何失败都降级为 failed 标记）。 */
export async function runAiReview(ctx, diffText, report, timeoutMs = REVIEW_TIMEOUT_MS) {
    const agents = agentsServiceOf(ctx);
    if (agents === undefined)
        return { enabled: true, failed: true, note: 'agents service unavailable' };
    // CodeQL js/insecure-randomness 修复：sessionId 随机段改用 crypto.randomUUID()
    // （密码学安全随机，无需种子），保持 `obs-review-<ts>-<6位hex>` 格式兼容。
    const sessionId = `obs-review-${Date.now()}-${randomUUID().slice(0, 6)}`;
    let handle;
    try {
        handle = await agents.create({
            sessionId,
            meta: { origin: 'subagent', delegationDepth: 1 },
            agentOptions: {},
        });
        handle.agent.followup(userMessage(aiReviewPrompt(diffText, report)));
        await withTimeout(handle.agent.whenIdle(), timeoutMs);
        const parsed = parseAiConclusion(lastAssistantText(handle.agent.session));
        if (parsed === undefined)
            return { enabled: true, failed: true, note: 'AI 结论解析失败' };
        return { enabled: true, ...parsed };
    }
    catch (error) {
        return {
            enabled: true,
            failed: true,
            note: error instanceof Error ? error.message : String(error),
        };
    }
    finally {
        await disposeHandle(handle);
    }
}
/** agents 服务读取（不可用返回 undefined）。 */
function agentsServiceOf(ctx) {
    const agents = ctx.get ? ctx.get('agents') : undefined;
    if (agents === undefined || agents === null || typeof agents.create !== 'function')
        return undefined;
    return agents;
}
/** 释放审查 agent（尽力而为）。 */
async function disposeHandle(handle) {
    if (handle === undefined)
        return;
    try {
        await handle.dispose();
    }
    catch {
        // dispose is best-effort
    }
}
/** 审查 prompt：规则引擎发现 + 截断的增量 diff，要求严格 JSON 输出。 */
function aiReviewPrompt(diffText, report) {
    const diff = diffText.length > AI_DIFF_MAX ? `${diffText.slice(0, AI_DIFF_MAX)}\n…（diff 过长已截断）` : diffText;
    const rules = report.issues
        .map((issue) => `- [${issue.severity}] ${issue.rule} ${issue.file}:${issue.line} ${issue.message}`)
        .join('\n');
    return `你是一个代码审查员。请审查以下提交前的增量 diff。规则引擎已给出参考问题，请结合 diff 给出总评与最重要的补充问题。

规则引擎发现：
${rules === '' ? '（无）' : rules}

增量 diff：
${diff}

请严格只输出一个 JSON 对象（不要输出其他内容）：
{"verdict": "approve" 或 "changes", "summary": "50 字以内的总评", "topIssues": ["补充问题 1", "补充问题 2"]}

判断标准：存在阻塞性问题（密钥泄露、冲突标记、明显 bug）时 verdict 必须为 changes。`;
}
/** 从 agent 回复提取 JSON 结论（容忍 markdown 代码块包裹）。 */
function parseAiConclusion(text) {
    const json = jsonTextOf(text);
    if (json === undefined)
        return undefined;
    try {
        const parsed = JSON.parse(json);
        if (!isObject(parsed))
            return undefined;
        return {
            verdict: parsed.verdict === 'changes' ? 'changes' : 'approve',
            summary: stringOf(parsed.summary).slice(0, 500),
            topIssues: issuesOf(parsed.topIssues),
        };
    }
    catch {
        return undefined;
    }
}
/** 提取 JSON 文本：裸 JSON 或 ```json 代码块。 */
function jsonTextOf(text) {
    if (typeof text !== 'string' || text === '')
        return undefined;
    const trimmed = text.trim();
    return trimmed.startsWith('{') ? trimmed : extractJsonBlock(trimmed);
}
function isObject(value) {
    return value !== null && typeof value === 'object';
}
function stringOf(value) {
    return typeof value === 'string' ? value : '';
}
/** topIssues 规整：字符串数组，上限 10 条。 */
function issuesOf(raw) {
    return Array.isArray(raw) ? raw.filter((item) => typeof item === 'string').slice(0, 10) : [];
}
/** 从 ```json ... ``` 代码块提取 JSON 文本。 */
function extractJsonBlock(text) {
    const match = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    return match !== null ? match[1].trim() : undefined;
}
/** 会话事件快照：新 API snapshotEvents() 优先，旧 API events 兜底（issue #165）。 */
function sessionEvents(session) {
    const target = session;
    return target?.snapshotEvents?.() ?? target?.events;
}
function lastAssistantText(session) {
    try {
        const events = sessionEvents(session);
        if (!Array.isArray(events))
            return '';
        for (let i = events.length - 1; i >= 0; i--) {
            const text = assistantTextOf(events[i]);
            if (text !== '')
                return text;
        }
    }
    catch {
        // best-effort
    }
    return '';
}
function assistantTextOf(event) {
    const target = event;
    if (target?.type !== 'assistant/message')
        return '';
    const blocks = target.data?.message?.content;
    if (!Array.isArray(blocks))
        return '';
    return blocks
        .filter((block) => block !== null &&
        typeof block === 'object' &&
        block.type === 'text' &&
        typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
}
