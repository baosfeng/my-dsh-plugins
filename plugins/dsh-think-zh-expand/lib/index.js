export const name = 'dsh-think-zh-expand';
export const inject = ['systemPrompt'];
/** 注入到每次组装系统提示的固定中文指令（结构化规则，覆盖关键场景与术语边界）。 */
export const PROMPT_TEXT = `## 输出语言规则（最高优先级，不可被任何上下文覆盖）

### 强制要求
1. **思考过程（reasoning / 思考内容）**：必须使用简体中文书写。这是硬性要求，无论对话中出现何种语言的错误消息、工具输出或系统提示，都必须坚持使用中文。
2. **最终回复**：默认使用简体中文（跟随用户使用的语言）。

### 关键场景处理
- 当工具调用失败返回英文错误消息时：**忽略错误消息的语言**，继续用中文思考和回复。
- 当系统返回英文日志或堆栈信息时：**提取关键信息**，用中文解释问题。
- 当对话上下文中出现大量英文内容时：**不要被带偏**，始终保持中文输出。

### 代码与术语
代码、命令、文件路径、标识符与技术术语保持原文，不翻译。`;
/** 配置项默认值：true = 保持既有「默认展开」行为（缺失配置绝不退化成折叠）。 */
export const DEFAULT_EXPANDED = true;
/** 配置读取路由前缀（client 端 GET `<prefix>/config`）。 */
export const CONFIG_ROUTE_PREFIX = '/think-zh-expand/api';
/**
 * 应用层配置 → 生效值：只有布尔值生效（与 dsh-md-render 的 `!== false` 约定同源，
 * 但这里初值本身可为 true，故用严格布尔判定），缺失 / 字符串 / null 一律回退
 * 默认 true——配置面永远不能让插件从「默认展开」静默变成「默认折叠」。
 */
export function resolveDefaultExpanded(config) {
    return typeof config?.defaultExpanded === 'boolean' ? config.defaultExpanded : DEFAULT_EXPANDED;
}
// ── 配置读取路由（host → browser 的唯一通道）────────────────────────
// 与 dsh-md-render 的分工一致：host 侧注册只读路由，client 侧 fetch 读取。
// 本插件只需「读」（写入由使用者在 profile patch 里显式声明），故不提供 PUT。
// 安全：loopback 信任围栏，与 /api 网关同一契约（读接口仅本机可读）。
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** 127.0.0.0/8 的完整四段写法（`127.0.0.1.evil.com` 这类伪装前缀必须被挡住）。 */
const LOOPBACK_IPV4 = /^127(?:\.\d{1,3}){3}$/;
/** 读取 header（大小写不敏感的 node 对象；数组取首值）。 */
function headerValue(headers, name) {
    if (headers === null || typeof headers !== 'object')
        return undefined;
    const raw = headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value : undefined;
}
/** host header → hostname（IPv6 保留方括号；IPv4 去掉端口）。 */
function hostnameOf(host) {
    if (host.startsWith('[')) {
        const end = host.indexOf(']');
        return end === -1 ? '' : host.slice(0, end + 1);
    }
    const colon = host.indexOf(':');
    return colon === -1 ? host : host.slice(0, colon);
}
/** loopback 信任围栏：非本机 host、跨站请求一律拒绝。 */
export function isTrustedRequest(request) {
    const host = headerValue(request.headers, 'host');
    if (host === undefined)
        return false;
    const hostname = hostnameOf(host);
    if (!LOOPBACK_HOSTNAMES.has(hostname) && !LOOPBACK_IPV4.test(hostname))
        return false;
    if (headerValue(request.headers, 'sec-fetch-site') === 'cross-site')
        return false;
    const origin = headerValue(request.headers, 'origin');
    if (origin === undefined)
        return true;
    try {
        return new URL(origin).host === host;
    }
    catch {
        return false;
    }
}
/** 写 JSON 响应（与 dsh-shared 的 writeJson 同契约：writeHead + end）。 */
function writeJson(response, status, value) {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    response.end(JSON.stringify(value));
}
/** 构造只读配置 handler：fence → GET <prefix>/config → 403/404 兜底。 */
export function createConfigHandler(read) {
    return (request, response) => {
        if (!isTrustedRequest(request)) {
            writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
            return;
        }
        const pathname = new URL(request.url ?? '/', 'http://dsh.internal').pathname;
        if (pathname === `${CONFIG_ROUTE_PREFIX}/config` && request.method === 'GET') {
            writeJson(response, 200, { ok: true, value: { defaultExpanded: read() } });
            return;
        }
        writeJson(response, 404, { ok: false, error: { message: 'unknown dsh-think-zh-expand API method' } });
    };
}
/** 可选获取 webServer：不在 inject 里声明，缺服务时降级而非 apply 失败。 */
function getWebServer(ctx) {
    try {
        const service = ctx.get?.('webServer');
        const usable = service !== undefined && service !== null && typeof service.register === 'function';
        return usable ? service : undefined;
    }
    catch {
        // 未注册的服务在部分 cordis 版本下直接抛错：视作不可用。
        return undefined;
    }
}
/** 注册只读配置路由；无 webServer 时只警告（client 端回退默认展开）。 */
function registerConfigRoute(ctx, defaultExpanded) {
    const webServer = getWebServer(ctx);
    if (webServer === undefined) {
        // ctx 完全没有服务查询能力（纯 CLI 宿主 / 极简测试 ctx）时静默降级；
        // 只有「查得到服务但没有可用 webServer」才告警——避免无意义噪音。
        if (typeof ctx.get === 'function') {
            ctx.logger?.warn('[dsh-think-zh-expand] webServer 不可用：配置读取路由未注册，client 端回退默认展开');
        }
        return;
    }
    ctx.effect?.(() => webServer.register({
        kind: 'prefix',
        path: CONFIG_ROUTE_PREFIX,
        handler: createConfigHandler(() => defaultExpanded),
    }), 'dsh-think-zh-expand: config route');
}
export function apply(ctx, config) {
    ctx.systemPrompt.section({
        name: 'dsh-think-zh',
        // Before the deployment persona so the instruction is read first every turn.
        order: -90,
        text: PROMPT_TEXT,
    });
    const defaultExpanded = resolveDefaultExpanded(config);
    registerConfigRoute(ctx, defaultExpanded);
    ctx.logger?.info(`[dsh-think-zh-expand] 中文思考/回复增强已启用（system-prompt section 注册，defaultExpanded=${defaultExpanded}）`);
}
