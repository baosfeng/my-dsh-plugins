/**
 * dsh-my-notify — 出站 webhook 推送调度（issue #92）。
 *
 * dispatchWebhooks 按配置遍历 webhooks（启用 + 事件匹配）异步推送；
 * pushWebhook 单条推送：formatMessage → sign → POST（5s 超时）→ 失败
 * 重试（3 次指数退避 1s/2s/4s）→ 全部失败记录（onFailure 回调）。
 *
 * 依赖注入（deps）：fetchImpl / now / sleep / onFailure 均可注入，单测
 * 无需真实网络与等待；生产默认 global fetch + setTimeout。
 */
import { formatMessage, sign } from './adapters.js';
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
/** 第 attempt 次重试的退避时长（attempt 从 1 开始）。 */
export function backoffMs(attempt) {
    return BACKOFF_BASE_MS * 2 ** (attempt - 1);
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
/**
 * 推送单条 webhook：成功返回 { ok: true, attempts }；重试耗尽返回
 * { ok: false, ...failure } 并回调 onFailure（失败记录）。
 */
export async function pushWebhook(webhook, notice, deps = {}) {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const now = deps.now ?? Date.now;
    const sleep = deps.sleep ?? defaultSleep;
    const onFailure = deps.onFailure;
    const body = formatMessage(webhook, notice, deps.formatOpts);
    const { query, body: finalBody } = sign(webhook, webhook?.secret, body, now());
    const url = buildUrl(webhook?.url ?? '', query);
    let lastError = null;
    for (let attempt = 0; attempt <= RETRY_MAX; attempt += 1) {
        if (attempt > 0)
            await sleep(backoffMs(attempt));
        try {
            const ok = await postWithTimeout(fetchImpl, url, finalBody, deps.timeoutMs ?? TIMEOUT_MS);
            if (ok)
                return { ok: true, attempts: attempt + 1 };
            lastError = new Error(`HTTP ${ok}`);
        }
        catch (error) {
            lastError = error;
        }
    }
    const failure = {
        time: now(),
        webhookName: typeof webhook?.name === 'string' ? webhook.name : '',
        channel: (typeof webhook?.channel === 'string' ? webhook.channel : '') ||
            (typeof webhook?.type === 'string'
                ? String(webhook.type)
                : ''),
        url,
        error: lastError instanceof Error ? lastError.message : String(lastError),
        attempts: RETRY_MAX + 1,
    };
    onFailure?.(failure);
    return { ok: false, ...failure };
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
