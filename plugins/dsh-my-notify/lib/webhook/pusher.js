/**
 * dsh-my-notify — 出站 webhook 推送调度（issue #92）。
 *
 * dispatchWebhooks 按配置遍历 webhooks（启用 + 事件匹配）异步推送；
 * pushWebhook 单条推送：formatMessage → sign → POST（5s 超时）→ 失败
 * 重试（3 次指数退避 1s/2s/4s）→ 全部失败记录（onFailure 回调）。
 *
 * 依赖注入（deps）：fetchImpl / now / sleep / onFailure 均可注入，单测
 * 无需真实网络与等待；生产默认 global fetch + setTimeout。
 *
 * 结构（每个函数圈复杂度 ≤10）：pushContext 组装请求上下文 →
 * attemptLoop 走重试链 → failureOf 生成失败记录，pushWebhook 只做串联。
 */
import { formatMessage, sign, toTimestampSeconds } from './adapters.js';
import { normalizeRetry } from '../notify/config.js';
/** 单次请求超时（毫秒）。 */
export const TIMEOUT_MS = 5000;
/** 失败后最大重试次数（共 1 + RETRY_MAX 次尝试）。 */
export const RETRY_MAX = 3;
/** 退避基数（毫秒）：第 n 次重试等待 base * 2^(n-1)。 */
const BACKOFF_BASE_MS = 1000;
/** 默认退避等待（真实 setTimeout）。 */
function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * 第 attempt 次重试的退避时长（attempt 从 1 开始；base 为基数，默认 1s）。
 *
 * @example
 *   backoffMs(1) // → 1000
 *   backoffMs(3, 500) // → 2000
 */
export function backoffMs(attempt, base = BACKOFF_BASE_MS) {
    return base * 2 ** (attempt - 1);
}
/** webhook 是否启用（enabled 缺省视为启用）。 */
function isEnabled(webhook) {
    return webhook?.enabled !== false;
}
/** 事件是否匹配：events 为空视为匹配全部。 */
function matchesEvents(webhook, kind) {
    const events = webhook?.events;
    if (!Array.isArray(events) || events.length === 0)
        return true;
    return events.includes(kind);
}
/**
 * 按配置分发通知到所有匹配 webhook（异步推送，不阻塞事件路径）。
 * 返回 Promise.allSettled 结果（调用方 fire-and-forget 或 await 测试）。
 */
export function dispatchWebhooks(webhooks, notice, deps = {}) {
    const tasks = [];
    for (const webhook of webhooks ?? []) {
        if (!isEnabled(webhook))
            continue;
        if (!matchesEvents(webhook, notice?.kind))
            continue;
        tasks.push(pushWebhook(webhook, notice, deps));
    }
    return Promise.allSettled(tasks);
}
/** 组装推送上下文：格式化 → 秒级加签 → 拼 URL → 读重试配置。 */
function pushContext(webhook, notice, deps) {
    const now = deps.now ?? Date.now;
    const signed = signRequest(webhook, formatMessage(webhook, notice, deps.formatOpts), now);
    const retry = normalizeRetry(webhook?.retry);
    return {
        fetchImpl: deps.fetchImpl ?? fetch,
        now,
        sleep: deps.sleep ?? defaultSleep,
        url: signed.url,
        body: signed.body,
        timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
        maxAttempts: retry.attempts ?? RETRY_MAX,
        backoff: retry.backoffMs ?? BACKOFF_BASE_MS,
    };
}
/** 加签并拼接最终 URL（时间戳按秒级换算，见 toTimestampSeconds）。 */
function signRequest(webhook, body, now) {
    // 加签时间戳必须是**秒级**：now() 给的是毫秒，先换算再签（否则线上校验失败）
    const { query, body: finalBody } = sign(webhook, webhook?.secret, body, toTimestampSeconds(now()));
    return { url: buildUrl(webhook?.url ?? '', query), body: finalBody };
}
/** 走完重试链：第 n 次退避后重发，成功即返回。 */
async function attemptLoop(context) {
    let lastError = null;
    for (let attempt = 0; attempt <= context.maxAttempts; attempt += 1) {
        if (attempt > 0)
            await context.sleep(backoffMs(attempt, context.backoff));
        const sent = await sendOnce(context);
        if (sent.ok)
            return { ok: true, attempts: attempt + 1, error: null };
        lastError = sent.error;
    }
    return { ok: false, attempts: context.maxAttempts + 1, error: lastError };
}
/** 单次发送：网络异常 / 超时 / 非 2xx 都归为失败（不抛出）。 */
async function sendOnce(context) {
    try {
        const ok = await postWithTimeout(context.fetchImpl, context.url, context.body, context.timeoutMs);
        return { ok, error: ok ? null : new Error(`HTTP ${ok}`) };
    }
    catch (error) {
        return { ok: false, error };
    }
}
/**
 * 推送单条 webhook：成功返回 { ok: true, attempts }；重试耗尽返回
 * { ok: false, ...failure } 并回调 onFailure（失败记录）。
 */
export async function pushWebhook(webhook, notice, deps = {}) {
    const context = pushContext(webhook, notice, deps);
    const outcome = await attemptLoop(context);
    if (outcome.ok)
        return { ok: true, attempts: outcome.attempts };
    const failure = failureOf(webhook, context, outcome);
    deps.onFailure?.(failure);
    return { ok: false, ...failure };
}
/** 失败记录（webhook 名 / 渠道 / URL / 错误 / 尝试次数）。 */
function failureOf(webhook, context, outcome) {
    return {
        time: context.now(),
        webhookName: nameOf(webhook),
        channel: channelOf(webhook),
        url: context.url,
        error: errorText(outcome.error),
        attempts: outcome.attempts,
    };
}
/** webhook 名称（缺失回退空串）。 */
function nameOf(webhook) {
    const w = webhook;
    return typeof w?.name === 'string' ? w.name : '';
}
/** 渠道标识：channel 优先，回退 type 别名，再回退空串。 */
function channelOf(webhook) {
    const w = webhook;
    const channel = typeof w?.channel === 'string' ? w.channel : '';
    if (channel !== '')
        return channel;
    return typeof w?.type === 'string' ? w.type : '';
}
/** 错误文本：Error 取 message，其余转字符串。 */
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
/** POST JSON 到目标 URL（AbortController 超时；res.ok 为成功判定）。 */
async function postWithTimeout(fetchImpl, url, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        return response.ok;
    }
    finally {
        clearTimeout(timer);
    }
}
/** 把签名 query 参数追加到 URL（保留已有 query）。 */
export function buildUrl(base, query) {
    const keys = Object.keys(query ?? {});
    if (keys.length === 0)
        return base;
    const url = new URL(base);
    for (const key of keys)
        url.searchParams.set(key, query[key]);
    return url.toString();
}
