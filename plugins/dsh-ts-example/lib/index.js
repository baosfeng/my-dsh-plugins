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
 *  - 事件：session/created 计数，GET /ts-example/api/stats → { sessions }；
 *  - 信任围栏：非 loopback 来源 403（与 /api 网关一致的契约）。
 */
import { buildGreeting } from './greeting.js';
export const name = 'dsh-ts-example';
export const inject = ['webServer'];
// config 可能缺省：DSH 对未声明 config schema 的插件调用 apply(ctx) 时
// 第二个参数为 undefined（cordis 契约），必须用可选链兜底，否则 TypeError。
/**
 * root 上的注册表（以 root ctx 为键）。
 *
 * ⚠️ 教学要点（issue #242 实测，DSH 0.1.5-rc.1）：profile 插件的 fiber 会被 loader
 * 在 apply 结束后回收，**注册在插件自身 ctx 上的监听器与路由会随之静默消失**——
 * 事件 0 触发、路由返回 404，且**没有任何报错**。所以本样例的所有注册都挂到
 * **常驻 ctx.root**，并以 root 为键去重（loader 会多次 apply 同一插件，重复注册会
 * 让同一事件被处理多次）。照抄本样例时，**不要把 root 改回 ctx**。
 */
const rootRegistrations = new WeakMap();
export function apply(ctx, config) {
    const language = config?.language ?? 'en';
    let sessionCount = 0;
    const listenCtx = ctx.root ?? ctx;
    for (const dispose of rootRegistrations.get(listenCtx) ?? [])
        dispose();
    const disposers = [];
    // ── 事件监听：会话创建计数（演示 ctx.on；注册在常驻 root）──────────
    // ⚠️ 事件名必须与宿主事件表一致：cordis 运行时不校验事件名，写错只是**静默不触发**
    // （计数恒为 0，无任何报错）。宿主会话创建事件是 `session/created`。
    // test/host-event-contract.mjs 会拿宿主真实事件表比对，改名即红。
    disposers.push(listenCtx.on('session/created', () => {
        sessionCount += 1;
    }, { global: true }));
    // ── 路由：greeting + stats（注册在常驻 root，自持 disposer）────────
    const webServer = ctx.webServer ?? listenCtx.webServer;
    if (webServer !== undefined) {
        disposers.push(webServer.register({
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
        }));
    }
    rootRegistrations.set(listenCtx, disposers);
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
