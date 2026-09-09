/**
 * dsh-md-render — /md/api 路由（配置读写，issue #84 配置化）。
 *
 * 设置页可视化 → 保存开关 → PUT /md/api/config → 写入 profile patch
 * 文件（持久化）+ 更新内存（立即生效）；DSH 的 watchUserPatches 热重载
 * patch 文件，重新 apply 后 client 端按新开关渲染。
 *
 * 安全：所有请求先做 loopback 信任围栏（与 /api 网关一致的契约）；
 * 配置仅本机可读写。
 */
import { isTrustedApiRequest, readJsonBody, writeJson, writeError } from 'dsh-shared';
/** 增强功能开关键列表（默认开启；与 src/client/parts/config.ts 同序）。 */
export const SWITCH_KEYS = [
    'copyButton',
    'syntaxHighlight',
    'languageLabel',
    'lineNumbers',
    'taskList',
    'strikethrough',
    'image',
    'nestedList',
    'mathStructures',
    'tableSort',
    'tableFold',
];
/**
 * 选择型配置键（issue #146）：非布尔枚举值，键 → 合法值列表。
 *  - copyButtonPosition：代码块复制按钮位置（header=头部右上角 |
 *    bottom-right=右下角，默认与 #74 原始诉求一致）；
 *  - codeTheme：代码块主题（token 色 + 背景/边框色板，与
 *    src/client/parts/styles.ts CODE_THEMES 同序）。
 */
export const SELECT_KEYS = {
    copyButtonPosition: ['header', 'bottom-right'],
    codeTheme: ['bright', 'github-light', 'github-dark', 'one-dark', 'nord'],
};
/** 选择型配置默认值（缺失/非法值回退）。 */
export const SELECT_DEFAULTS = {
    copyButtonPosition: 'bottom-right',
    codeTheme: 'bright',
};
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
/** 配置查询：当前生效开关与选择项（设置页表单回填）。 */
function configValue(options) {
    const value = {};
    for (const key of SWITCH_KEYS)
        value[key] = options[key];
    for (const key of Object.keys(SELECT_KEYS))
        value[key] = options[key];
    return value;
}
/**
 * 校验并规整配置 payload：开关必须为布尔值、选择项必须为合法枚举值
 * （缺失字段跳过校验）；非法输入返回 undefined（调用方回 400）。
 */
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
    for (const [key, allowed] of Object.entries(SELECT_KEYS)) {
        if (obj[key] === undefined)
            continue;
        if (!allowed.includes(obj[key]))
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
