const HIGH = 'high';
/** 是否高严重级（决定是否推送）。 */
export function isHighSeverity(alert) {
    return alert !== null && typeof alert === 'object' && alert.severity === HIGH;
}
/** 冷却键：按告警类型（同类型告警冷却，防刷屏）。 */
export function cooldownKeyOf(alert) {
    const obj = alert;
    const type = obj?.type;
    return typeof type === 'string' && type !== '' ? type : 'other';
}
/** 构造 notify trigger payload（sessionId / title / body）。 */
export function buildPayload(alert) {
    const obj = alert;
    const message = typeof obj?.message === 'string' ? obj.message : '';
    return {
        sessionId: typeof obj?.sessionId === 'string' ? obj.sessionId : '',
        title: `安全告警：${message}`,
        body: message,
    };
}
/** 冷却是否已到期（无记录视为到期）。 */
export function cooldownDue(lastAt, now, cooldownMs) {
    if (lastAt === undefined || lastAt === null)
        return true;
    return now - lastAt >= cooldownMs;
}
/** 构造通知器。send 缺省走 fetch；now 缺省 Date.now（测试可注入）。 */
export function createNotifier({ options, baseUrl, token, send, now, }) {
    const lastSentAt = new Map();
    const clock = typeof now === 'function' ? now : Date.now;
    const dispatch = typeof send === 'function' ? send : defaultSend;
    return {
        notify(alert) {
            if (options?.notifyEnabled !== true)
                return { sent: false, reason: 'disabled' };
            if (!isHighSeverity(alert))
                return { sent: false, reason: 'not-high' };
            if (typeof baseUrl !== 'string' || baseUrl === '')
                return { sent: false, reason: 'no-base-url' };
            const key = cooldownKeyOf(alert);
            const nowMs = clock();
            if (!cooldownDue(lastSentAt.get(key), nowMs, options.notifyCooldownMs)) {
                return { sent: false, reason: 'cooldown' };
            }
            const payload = buildPayload(alert);
            void Promise.resolve(dispatch(baseUrl, payload, token)).catch(() => { });
            lastSentAt.set(key, nowMs);
            return { sent: true };
        },
        /** 冷却状态（测试断言：某类型的 lastSentAt / 是否被冷却）。 */
        state() {
            const map = {};
            for (const [key, value] of lastSentAt)
                map[key] = value;
            return map;
        },
    };
}
/** 默认推送：loopback 请求 notify 触发接口（可选 token）。 */
async function defaultSend(baseUrl, payload, token) {
    const headers = { 'content-type': 'application/json' };
    if (typeof token === 'string' && token !== '')
        headers['x-notify-token'] = token;
    await fetch(`${baseUrl}/notify/api/trigger`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
}
