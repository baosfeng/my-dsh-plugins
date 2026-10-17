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

import type { IncomingHeaders, IncomingRequest } from './types.js'

/** 读取字符串型请求头（非字符串视为缺失）。路由鉴权（如 token 头）共用。 */
export function header(headers: IncomingHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return (
    parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}

function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

function isTrustedAuthority(hostUrl: URL, trustedHosts: string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * 监听地址字面量匹配：浏览器访问 `http://<bind>:<port>` 时 Host 即该字面量。
 * 与 `trustedHosts` 的端口无关（任意端口），`%zone` 只选网卡、不参与地址文本。
 */
function isBindAddressAuthority(hostUrl: URL, bindHost: string | undefined): boolean {
  if (bindHost === undefined) return false
  const zoneAt = bindHost.indexOf('%')
  const address = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt)
  const bindUrl = parseAuthority(address.includes(':') ? `[${address}]` : address)
  return bindUrl !== undefined && bindUrl.hostname === hostUrl.hostname
}

/** 请求是否通过信任围栏（loopback / 受信权威 / 监听地址 + 同源校验）。 */
export function isTrustedApiRequest(request: IncomingRequest, trustedHosts: string[], bindHost?: string): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (
    !isLoopbackHostname(hostUrl.hostname) &&
    !isTrustedAuthority(hostUrl, trustedHosts) &&
    !isBindAddressAuthority(hostUrl, bindHost)
  ) {
    return false
  }
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** 可信权威的宿主来源（cordis Context 的最小子集，不安装宿主类型包）。 */
export interface TrustSourceContext {
  /** 可选服务读取：`strict=false` 机会性读取，未提供 / 未激活时返回 undefined。 */
  get?<T = unknown>(name: string, strict?: boolean): T | undefined
  /** webServer 服务（0.2.1 起 `host` 是具体监听地址字面量）。 */
  webServer?: { host?: unknown } | undefined
}

/**
 * 安全读一个可选服务。Cordis Context 是代理：**未 inject 的服务做属性访问会抛**
 * （`cannot get property ... without inject`），所以服务一律经 `get(name, false)`
 * 机会性读取，并对历史测试桩/异常实现兜底。
 */
function serviceOf<T>(ctx: TrustSourceContext | undefined, name: string): T | undefined {
  const get = ctx?.get
  if (typeof get !== 'function') return undefined
  try {
    return (get(name, false) ?? undefined) as T | undefined
  } catch {
    return undefined
  }
}

/** 安全读属性：测试桩是普通对象，真实 Cordis 代理可能对未注入服务抛错。 */
function propertyOf<T>(ctx: unknown, name: string): T | undefined {
  if (ctx === null || ctx === undefined || typeof ctx !== 'object') return undefined
  try {
    return (ctx as Record<string, T | undefined>)[name]
  } catch {
    return undefined
  }
}

/**
 * 解析宿主授予的可信权威列表。
 *
 * 优先级：`webStartup.trustedHosts`（0.2.1+）→ `webRuntime.trustedHosts`
 * （0.2.0 及以前，含测试桩直接挂属性的形态）。来源缺失、非数组、空串
 * 一律忽略；结果去重。
 */
export function trustedHostsOf(ctx: TrustSourceContext | undefined): string[] {
  const out: string[] = []
  for (const source of [
    serviceOf<{ trustedHosts?: unknown }>(ctx, 'webStartup'),
    serviceOf<{ trustedHosts?: unknown }>(ctx, 'webRuntime'),
    propertyOf<{ trustedHosts?: unknown }>(ctx, 'webRuntime'),
  ]) {
    const list = source?.trustedHosts
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      if (typeof entry === 'string' && entry !== '' && !out.includes(entry)) out.push(entry)
    }
  }
  return out
}

/** 监听地址字面量（`webServer.host`）；属性或服务读取都缺失/非字符串时为 undefined。 */
export function bindHostOf(ctx: TrustSourceContext | undefined): string | undefined {
  const direct = propertyOf<{ host?: unknown }>(ctx, 'webServer')?.host
  if (typeof direct === 'string' && direct !== '') return direct
  // 部分插件的 ctx 只经 get 取服务（属性访问不可靠），补一次服务读取。
  const service = serviceOf<{ host?: unknown }>(ctx, 'webServer')
  const host = service?.host
  return typeof host === 'string' && host !== '' ? host : undefined
}

/**
 * 生成可复用的信任围栏：每次请求现读宿主服务（服务可能晚于 fence 创建就绪）。
 * @param ctx - 插件 Context（只需 `get` 与 `webServer`）。
 * @returns 判断单个 HTTP 请求是否放行的函数。
 */
export function createTrustFence(ctx: TrustSourceContext | undefined): (request: IncomingRequest) => boolean {
  return (request) => isTrustedApiRequest(request, trustedHostsOf(ctx), bindHostOf(ctx))
}
