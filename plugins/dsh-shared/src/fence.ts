/**
 * dsh-shared — Host-header trust fence（与 /api 网关一致的契约）。
 *
 * 判断请求是否来自可信方：host 必须为 loopback 或受信权威（trustedHosts），
 * 且 sec-fetch-site 不得为 cross-site、origin（若存在）必须与 host 同源。
 * 本实现由各插件 lib/fence.js 抽取合并（issue #45），行为与抽取前逐字节一致。
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

/** 请求是否通过信任围栏（loopback 或受信权威 + 同源校验）。 */
export function isTrustedApiRequest(request: IncomingRequest, trustedHosts: string[]): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
