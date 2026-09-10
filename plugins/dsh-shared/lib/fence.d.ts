/**
 * dsh-shared — Host-header trust fence（与 /api 网关一致的契约）。
 *
 * 判断请求是否来自可信方：host 必须为 loopback 或受信权威（trustedHosts），
 * 且 sec-fetch-site 不得为 cross-site、origin（若存在）必须与 host 同源。
 * 本实现由各插件 lib/fence.js 抽取合并（issue #45），行为与抽取前逐字节一致。
 */
import type { IncomingHeaders, IncomingRequest } from './types.js';
/** 读取字符串型请求头（非字符串视为缺失）。路由鉴权（如 token 头）共用。 */
export declare function header(headers: IncomingHeaders, name: string): string | undefined;
/** 请求是否通过信任围栏（loopback 或受信权威 + 同源校验）。 */
export declare function isTrustedApiRequest(request: IncomingRequest, trustedHosts: string[]): boolean;
