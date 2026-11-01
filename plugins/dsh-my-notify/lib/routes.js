/**
 * dsh-my-notify — /notify/api 路由注册壳（SSE 长连接 + 方法分派）。
 *
 * 所有请求先做 loopback 信任围栏（与 /api 网关一致的契约；来源：dsh-shared
 * createTrustFence —— `webStartup.trustedHosts` + `webServer.host`，旧宿主
 * 回退 `webRuntime`）。本文件只做「注册 + 分派 + SSE」，具体 handler 按职责
 * 拆到同级模块（文件尺寸门禁）：
 *  - notify-config-route.ts   — GET info / GET+PUT config / GET webhooks（含配置规整）
 *  - notify-preview-route.ts  — GET variables / POST preview
 *  - notify-trigger-route.ts  — POST trigger（远程 hook）
 */
import { createTrustFence, writeJson, writeError } from 'dsh-shared';
import { configValue, handleConfigPut, infoValue, webhooksValue } from './notify-config-route.js';
import { handlePreview, variablesValue } from './notify-preview-route.js';
import { handleTrigger } from './notify-trigger-route.js';
/** 注册 /notify/api 路由与心跳清理（两个 effect，各自返回 disposer）。 */
export function registerNotifyRoutes(ctx, options, bus, onConfigChange, emitNotice, webhookStore) {
    const fence = createTrustFence(ctx);
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/notify/api',
        handler: apiHandler(fence, options, bus, onConfigChange, emitNotice, webhookStore),
    }), 'dsh-my-notify: /notify/api routes');
    // 卸载时清理心跳（客户端集合随各 response close 自动清空）。
    ctx.effect(() => bus.stopHeartbeat, 'dsh-my-notify: heartbeat teardown');
}
/** 构造 /notify/api 统一 handler：fence → 方法分派 → 404/错误兜底。 */
function apiHandler(fence, options, bus, onConfigChange, emitNotice, webhookStore) {
    return async (request, response) => {
        if (!fence(request)) {
            writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
            return;
        }
        // URL 解析与 fence 同层（畸形 url 异常向上传播，与 /api 网关一致）
        const url = new URL(request.url ?? '/', 'http://dsh.internal');
        const pathname = url.pathname;
        const method = pathname.startsWith('/notify/api/') ? pathname.slice('/notify/api/'.length) : undefined;
        try {
            const handled = await dispatchMethod(method, request, response, options, bus, onConfigChange, emitNotice, webhookStore);
            if (!handled) {
                writeJson(response, 404, {
                    ok: false,
                    error: { message: 'unknown dsh-my-notify API method' },
                });
            }
        }
        catch (error) {
            writeError(response, error);
        }
    };
}
/** 方法 + 请求动词匹配（降低 dispatchMethod 分支复杂度）。 */
function isMethod(method, request, name, verb) {
    return method === name && request.method === verb;
}
/** 按 method 分派到具体 handler；未识别返回 false（调用方回 404）。 */
async function dispatchMethod(method, request, response, options, bus, onConfigChange, emitNotice, webhookStore) {
    if (isMethod(method, request, 'stream', 'GET')) {
        handleStream(response, bus);
        return true;
    }
    if (isMethod(method, request, 'trigger', 'POST')) {
        await handleTrigger(request, response, options, emitNotice);
        return true;
    }
    if (isMethod(method, request, 'info', 'GET')) {
        writeJson(response, 200, { ok: true, value: infoValue(options) });
        return true;
    }
    if (isMethod(method, request, 'config', 'GET')) {
        writeJson(response, 200, { ok: true, value: configValue(options) });
        return true;
    }
    if (isMethod(method, request, 'config', 'PUT')) {
        await handleConfigPut(request, response, onConfigChange);
        return true;
    }
    if (isMethod(method, request, 'webhooks', 'GET')) {
        writeJson(response, 200, { ok: true, value: webhooksValue(options, webhookStore) });
        return true;
    }
    if (isMethod(method, request, 'variables', 'GET')) {
        writeJson(response, 200, { ok: true, value: variablesValue() });
        return true;
    }
    if (isMethod(method, request, 'preview', 'POST')) {
        await handlePreview(request, response, options);
        return true;
    }
    return false;
}
/** SSE 长连接：EventSource 消费；断开清理订阅集合；首次订阅启动心跳。 */
function handleStream(response, bus) {
    response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
    });
    response.write('retry: 3000\n\n');
    const client = { response };
    bus.clients.add(client);
    const onClose = () => {
        bus.clients.delete(client);
        response.removeListener?.('close', onClose);
    };
    response.on('close', onClose);
    bus.startHeartbeat();
}
