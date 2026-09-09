/** 单次推送超时（毫秒）。 */
const PUSH_TIMEOUT_MS = 5000;
/** 失败后最大重试次数（共 1 + RETRY_MAX 次尝试）。 */
export const RETRY_MAX = 2;
/** 退避基数（毫秒）：第 n 次重试等待 base * 2^(n-1)）。 */
const BACKOFF_BASE_MS = 500;
/** 默认退避等待（真实 setTimeout）。 */
function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    return kind !== undefined && events.includes(kind);
}
/**
 * 创建渠道控制器：遍历配置 webhooks 异步下行事件 + 失败记录。
 * webhooks 配置：{ name, url, events?, enabled?, headers? }（headers 为
 * 可选附加请求头，如中转服务自定义鉴权头）。
 */
export function createChannels(options, deps = {}) {
    /** 失败记录（环形缓冲，最新在前）。 */
    const failures = [];
    const cap = 50;
    /** 记录一条失败（超限丢最旧）。 */
    function addFailure(failure) {
        failures.unshift(failure);
        if (failures.length > cap)
            failures.pop();
    }
    /** 下行事件：匹配的 webhook 各自异步推送（fire-and-forget）。 */
    function dispatch(event) {
        const hooks = options.webhooks ?? [];
        for (const webhook of hooks) {
            if (!isEnabled(webhook))
                continue;
            if (!matchesEvents(webhook, event?.kind))
                continue;
            void pushEvent(webhook, event, deps).then((result) => {
                if (!result.ok) {
                    addFailure(result.failure);
                    deps.logger?.warn(`[dsh-my-remote] webhook 推送失败（webhook=${result.failure?.webhookName ?? ''}，url=${result.failure?.url ?? ''}，原因=${result.failure?.error ?? ''}）`);
                }
            }, () => {
                addFailure({
                    time: Date.now(),
                    webhookName: typeof webhook.name === 'string' ? webhook.name : '',
                    url: typeof webhook.url === 'string' ? webhook.url : '',
                    error: 'unexpected push failure',
                });
                deps.logger?.warn(`[dsh-my-remote] webhook 推送异常失败（webhook=${typeof webhook.name === 'string' ? webhook.name : ''}，url=${typeof webhook.url === 'string' ? webhook.url : ''}）`);
            });
        }
    }
    return {
        dispatch,
        failures: { list: () => [...failures] },
        list: () => hooksOf(options),
    };
}
/** 只读当前 webhook 配置（不含失败记录）。 */
function hooksOf(options) {
    return Array.isArray(options.webhooks) ? options.webhooks.slice() : [];
}
/**
 * 推送单条事件到目标 URL：成功 { ok: true, attempts }；重试耗尽返回
 * { ok: false, failure }（failure 记录进控制器）。
 */
export async function pushEvent(webhook, event, deps = {}) {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const sleep = deps.sleep ?? defaultSleep;
    const url = webhook?.url;
    if (typeof url !== 'string' || url === '') {
        return { ok: false, failure: failureOf(webhook, '', 'empty webhook url', 0) };
    }
    let lastError = null;
    for (let attempt = 0; attempt <= RETRY_MAX; attempt += 1) {
        if (attempt > 0)
            await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        const outcome = await attemptOnce(fetchImpl, url, event, deps.timeoutMs, webhook);
        if (outcome.ok)
            return { ok: true, attempts: attempt + 1 };
        lastError = outcome.error;
    }
    const failure = failureOf(webhook, url, errorText(lastError), RETRY_MAX + 1);
    return { ok: false, failure };
}
/** 单次推送尝试：成功 { ok: true }；失败 { ok: false, error }（不抛）。 */
async function attemptOnce(fetchImpl, url, event, timeoutMs, webhook) {
    try {
        const ok = await postWithTimeout(fetchImpl, url, event, timeoutMs ?? PUSH_TIMEOUT_MS, webhook?.headers);
        if (ok)
            return { ok: true, error: null };
        return { ok: false, error: new Error(`HTTP ${ok}`) };
    }
    catch (error) {
        return { ok: false, error };
    }
}
/** 错误文本（Error 取 message，其余字符串化）。 */
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
/** 构造失败记录（供控制器入库）。 */
function failureOf(webhook, url, error, attempts) {
    return {
        time: Date.now(),
        webhookName: typeof webhook?.name === 'string' ? webhook.name : '',
        url,
        error,
        attempts,
    };
}
/** POST JSON 到目标 URL（AbortController 超时；res.ok 为成功判定）。 */
async function postWithTimeout(fetchImpl, url, body, timeoutMs, extraHeaders) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { 'content-type': 'application/json' };
    if (extraHeaders !== null && typeof extraHeaders === 'object') {
        for (const [key, value] of Object.entries(extraHeaders)) {
            if (typeof value === 'string')
                headers[key] = value;
        }
    }
    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        return response.ok;
    }
    finally {
        clearTimeout(timer);
    }
}
