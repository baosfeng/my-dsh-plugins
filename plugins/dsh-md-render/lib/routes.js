/**
 * dsh-md-render — /md/api 路由（配置读写）。
 *
 * 设置页可视化 → 保存开关 → PUT /md/api/config → 写入 profile patch
 * 文件（持久化）+ 更新内存（立即生效）；DSH 的 watchUserPatches 热重载
 * patch 文件，重新 apply 后 client 端按新开关渲染。
 *
 * 安全：所有请求先做 loopback 信任围栏（与 /api 网关一致的契约）；
 * 配置仅本机可读写。
 */
import { isTrustedApiRequest, readJsonBody, writeJson, writeError } from 'dsh-shared';
/** 保留增强功能的开关键列表（默认开启；与 src/client/parts/config.ts 同序）。
 *  精简后只剩三项：整段复制 / text 围栏块渲染 / 上下文注入块渲染。 */
export const SWITCH_KEYS = ['copyButton', 'textFenceMarkdown', 'contextMarkdown'];
/** 注册 /md/api 路由（一个 effect，返回 disposer）。 */
export function registerConfigRoutes(ctx, options, onConfigChange) {
    const webRuntime = ctx.get ? ctx.get('webRuntime') : undefined;
    const trustedHosts = webRuntime !== undefined && webRuntime !== null && Array.isArray(webRuntime.trustedHosts)
        ? webRuntime.trustedHosts
        : [];
    const fence = (request) => isTrustedApiRequest(request, trustedHosts);
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/md/api',
        handler: apiHandler(fence, options, onConfigChange),
    }), 'dsh-md-render: /md/api routes');
}
/** 构造 /md/api 统一 handler：fence → 方法分派 → 404/错误兜底。 */
function apiHandler(fence, options, onConfigChange) {
    return async (request, response) => {
        if (!fence(request)) {
            writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
            return;
        }
        const url = new URL(request.url ?? '/', 'http://dsh.internal');
        const pathname = url.pathname;
        const method = pathname.startsWith('/md/api/') ? pathname.slice('/md/api/'.length) : undefined;
        try {
            const handled = await dispatchMethod(method, request, response, options, onConfigChange);
            if (!handled) {
                writeJson(response, 404, { ok: false, error: { message: 'unknown dsh-md-render API method' } });
            }
        }
        catch (error) {
            writeError(response, error);
        }
    };
}
/** 方法 + 请求动词匹配。 */
function isMethod(method, request, name, verb) {
    return method === name && request.method === verb;
}
/** 按 method 分派；未识别返回 false（调用方回 404）。 */
async function dispatchMethod(method, request, response, options, onConfigChange) {
    if (isMethod(method, request, 'config', 'GET')) {
        writeJson(response, 200, { ok: true, value: configValue(options) });
        return true;
    }
    if (isMethod(method, request, 'config', 'PUT')) {
        await handleConfigPut(request, response, onConfigChange);
        return true;
    }
    return false;
}
/** 配置查询：当前生效开关（设置页表单回填）。 */
function configValue(options) {
    const value = {};
    for (const key of SWITCH_KEYS)
        value[key] = options[key];
    return value;
}
/** 校验配置 payload：开关必须为布尔值（缺失字段跳过）；非法输入返回 undefined（回 400）。 */
function normalizeConfig(payload) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
        return undefined;
    const obj = payload;
    const result = {};
    for (const key of SWITCH_KEYS) {
        if (obj[key] === undefined)
            continue;
        if (typeof obj[key] !== 'boolean')
            return undefined;
        result[key] = obj[key];
    }
    return result;
}
/** 保存配置：校验 → 持久化 + 更新内存（onConfigChange）。 */
async function handleConfigPut(request, response, onConfigChange) {
    const payload = await readJsonBody(request);
    const next = normalizeConfig(payload);
    if (next === undefined) {
        writeJson(response, 400, { ok: false, error: { message: 'invalid config' } });
        return;
    }
    await onConfigChange(next);
    writeJson(response, 200, { ok: true });
}
