/**
 * dsh-shared — Host-header trust fence（与 /api 网关一致的契约）。
 *
 * 判断请求是否来自可信方：host 必须为 loopback、受信权威（trustedHosts）或
 * 监听地址字面量（bindHost），且 sec-fetch-site 不得为 cross-site、origin
 * （若存在）必须与 host 同源。
 * 本实现由各插件 lib/fence.js 抽取合并（issue #45）。
 *
 * 来源迁移（DSH 0.2.1）：宿主**移除了 `webRuntime` 服务**——可信权威改由
 * `webStartup.trustedHosts`（`--trusted-host`）提供，监听地址由
 * `webServer.host` 单独接受（与官方 `api-request-trust` 一致）；0.2.0 及
 * 以前继续回退 `webRuntime.trustedHosts`。插件不要自己再读 `webRuntime`。
 */
import type { IncomingHeaders, IncomingRequest } from './types.js';
/** 读取字符串型请求头（非字符串视为缺失）。路由鉴权（如 token 头）共用。 */
export declare function header(headers: IncomingHeaders, name: string): string | undefined;
/** 请求是否通过信任围栏（loopback / 受信权威 / 监听地址 + 同源校验）。 */
export declare function isTrustedApiRequest(request: IncomingRequest, trustedHosts: string[], bindHost?: string): boolean;
/** 可信权威的宿主来源（cordis Context 的最小子集，不安装宿主类型包）。 */
export interface TrustSourceContext {
    /** 可选服务读取：`strict=false` 机会性读取，未提供 / 未激活时返回 undefined。 */
    get?<T = unknown>(name: string, strict?: boolean): T | undefined;
    /** webServer 服务（0.2.1 起 `host` 是具体监听地址字面量）。 */
    webServer?: {
        host?: unknown;
    } | undefined;
}
/**
 * 解析宿主授予的可信权威列表。
 *
 * 优先级：`webStartup.trustedHosts`（0.2.1+）→ `webRuntime.trustedHosts`
 * （0.2.0 及以前，含测试桩直接挂属性的形态）。来源缺失、非数组、空串
 * 一律忽略；结果去重。
 */
export declare function trustedHostsOf(ctx: TrustSourceContext | undefined): string[];
/** 监听地址字面量（`webServer.host`）；属性或服务读取都缺失/非字符串时为 undefined。 */
export declare function bindHostOf(ctx: TrustSourceContext | undefined): string | undefined;
/**
 * 生成可复用的信任围栏：每次请求现读宿主服务（服务可能晚于 fence 创建就绪）。
 * @param ctx - 插件 Context（只需 `get` 与 `webServer`）。
 * @returns 判断单个 HTTP 请求是否放行的函数。
 */
export declare function createTrustFence(ctx: TrustSourceContext | undefined): (request: IncomingRequest) => boolean;
