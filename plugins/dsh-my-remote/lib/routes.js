/**
 * dsh-my-remote — /remote/api 路由（远程指令入站 + 状态/审计查询）。
 *
 * 所有请求先做 loopback 信任围栏（dsh-shared isTrustedApiRequest，与 /api
 * 网关一致的契约；配置 apiToken 后 command 写操作额外要求 x-remote-token
 * 头，供经反向代理/中转服务的远程调用）。
 *
 * 端点：
 *  - GET  /remote/api/info     — 插件开关（apiToken 是否启用等，不暴露值）
 *  - GET  /remote/api/status   — 状态快照（活动会话 / pending ask / approval）
 *  - GET  /remote/api/audit    — 操作审计日志（远程控制操作留痕）
 *  - POST /remote/api/command  — 远程指令统一入口（answer/approve/continue，
 *    指令白名单见 commands.js）
 *
 * 安全：fence（loopback）→ token（写操作）→ 白名单（commands.js）→ 审计。
 * token 失败也记审计（溯源：未知来源的尝试同样留痕）。
 */
import { isTrustedApiRequest, header, readJsonBody, writeJson, writeError } from 'dsh-shared';
import { processCommand, statusSnapshot } from './commands.js';
/** 注册 /remote/api 路由（ctx.effect 持有 disposer）。 */
export function registerRemoteRoutes(ctx, shared) {
    const webRuntime = ctx.get?.('webRuntime');
    const trustedHosts = webRuntime !== undefined && webRuntime !== null && Array.isArray(webRuntime.trustedHosts)
        ? webRuntime.trustedHosts
        : [];
    const fence = (request) => isTrustedApiRequest(request, trustedHosts);
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/remote/api',
        handler: apiHandler(fence, shared),
    }), 'dsh-my-remote: /remote/api routes');
}
/** 统一 handler：fence → 方法/动词分派 → 404/异常兜底。 */
function apiHandler(fence, shared) {
    return async (request, response) => {
        if (!fence(request)) {
            writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
            return;
        }
        const url = new URL(request.url ?? '/', 'http://dsh.internal');
        const pathname = url.pathname;
        const method = pathname.startsWith('/remote/api/') ? pathname.slice('/remote/api/'.length) : undefined;
        try {
            const handled = await dispatchMethod(method, request, response, shared);
            if (!handled) {
                writeJson(response, 404, {
                    ok: false,
                    error: { message: 'unknown dsh-my-remote API method' },
                });
            }
        }
        catch (error) {
            writeError(response, error);
        }
    };
}
/** 按 method + 请求动词分派到具体 handler；未识别返回 false。 */
async function dispatchMethod(method, request, response, shared) {
    if (method === undefined)
        return false;
    if (request.method === 'GET')
        return dispatchGet(method, response, shared);
    if (request.method === 'POST' && method === 'command') {
        await handleCommand(request, response, shared);
        return true;
    }
    return false;
}
/** GET 端点分派（info/status/audit）。 */
function dispatchGet(method, response, shared) {
    if (method === 'info') {
        writeJson(response, 200, { ok: true, value: infoValue(shared) });
        return true;
    }
    if (method === 'status') {
        writeJson(response, 200, { ok: true, value: statusSnapshot(shared) });
        return true;
    }
    if (method === 'audit') {
        writeJson(response, 200, { ok: true, value: { entries: shared.audit.list() } });
        return true;
    }
    return false;
}
/** 插件信息：开关 + apiToken 是否启用（绝不暴露值）。 */
function infoValue(shared) {
    return {
        end: shared.options.end,
        ask: shared.options.ask,
        approval: shared.options.approval,
        apiToken: shared.options.apiToken !== '',
        webhooks: (shared.options.webhooks ?? []).length,
        askTimeoutMs: shared.options.askTimeoutMs,
        approvalTimeoutMs: shared.options.approvalTimeoutMs,
    };
}
/** 远程指令：token 校验 → 读取 body → 指令处理（含审计）。 */
async function handleCommand(request, response, shared) {
    const token = header(request.headers, 'x-remote-token');
    if (shared.options.apiToken !== '' && token !== shared.options.apiToken) {
        shared.audit.record({
            action: 'command',
            sessionId: '',
            source: sourceOf(request),
            ok: false,
            detail: 'invalid x-remote-token',
        });
        writeJson(response, 403, {
            ok: false,
            error: { code: 'forbidden', message: 'invalid x-remote-token' },
        });
        return;
    }
    let body;
    try {
        body = (await readJsonBody(request));
    }
    catch {
        shared.audit.record({ action: 'command', source: sourceOf(request), ok: false, detail: 'invalid json body' });
        writeJson(response, 400, { ok: false, error: { message: 'invalid json body' } });
        return;
    }
    const result = processCommand(shared, typeof body?.action === 'string' ? body.action : '', body ?? {}, {
        time: Date.now(),
        source: sourceOf(request),
    });
    if (!result.ok) {
        writeJson(response, 400, { ok: false, error: { message: result.error } });
        return;
    }
    writeJson(response, 200, { ok: true, value: result.result });
}
/** 审计来源：x-forwarded-for 优先（经代理时真实客户端），回退 'local'。 */
function sourceOf(request) {
    const forwarded = header(request.headers, 'x-forwarded-for');
    if (forwarded !== undefined && forwarded !== '')
        return forwarded.split(',')[0].trim();
    return 'local';
}
