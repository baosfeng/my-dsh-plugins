/**
 * dsh-ts-example — server 端入口（TypeScript 源码）。
 *
 * 本文件是 TS 插件 server 端的示例：`tsc -p tsconfig.json` 编译为
 * lib/index.js（产物必须提交，CI 只跑 node --check + 测试，不跑构建）。
 *
 * 演示内容：
 *  - 类型检查：import 不存在的模块 → TS2307 编译期报错（#39 的
 *    require('dsh-md-render') 类错误在 TS 下不可能发版出去）；
 *  - 路由：GET /ts-example/api/greeting?name=xxx → { greeting }；
 *  - 事件：session/start 计数，GET /ts-example/api/stats → { sessions }；
 *  - 信任围栏：非 loopback 来源 403（与 /api 网关一致的契约）。
 */
import { buildGreeting } from './greeting.js';
export const name = 'dsh-ts-example';
export const inject = ['webServer'];
// config 可能缺省：DSH 对未声明 config schema 的插件调用 apply(ctx) 时
// 第二个参数为 undefined（cordis 契约），必须用可选链兜底，否则 TypeError。
export function apply(ctx, config) {
    const language = config?.language ?? 'en';
    let sessionCount = 0;
    // ── 事件监听：会话开始计数（演示 ctx.on）──────────────────────────
    ctx.on('session/start', () => {
        sessionCount += 1;
    });
    // ── 路由：greeting + stats（effect 持有 disposer）──────────────────
    ctx.effect(() => ctx.webServer?.register({
        kind: 'prefix',
        path: '/ts-example/api',
        handler: (request, response) => {
            if (!isTrustedRequest(request)) {
                writeJson(response, 403, { ok: false, error: 'forbidden' });
                return;
            }
            const path = request.url?.split('?')[0] ?? '';
            if (path === '/ts-example/api/greeting') {
                const name = readQueryParam(request, 'name');
                writeJson(response, 200, { greeting: buildGreeting({ name, language }) });
                return;
            }
            if (path === '/ts-example/api/stats') {
                writeJson(response, 200, { sessions: sessionCount });
                return;
            }
            writeJson(response, 404, { ok: false, error: 'not found' });
        },
    }), 'dsh-ts-example: /ts-example/api routes');
}
/** 请求是否来自本机（loopback 信任围栏）。 */
function isTrustedRequest(request) {
    const host = request.headers.host;
    if (typeof host !== 'string')
        return false;
    try {
        const hostname = new URL(`http://${host}`).hostname;
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    }
    catch {
        return false;
    }
}
/** 读取查询参数（request.url 的 query 部分）。 */
function readQueryParam(request, key) {
    const url = request.url ?? '';
    const queryIndex = url.indexOf('?');
    if (queryIndex < 0)
        return '';
    return new URLSearchParams(url.slice(queryIndex + 1)).get(key) ?? '';
}
/** 写 JSON 响应。 */
function writeJson(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
}
