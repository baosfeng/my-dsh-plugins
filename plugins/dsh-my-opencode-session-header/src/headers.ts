/**
 * dsh-my-opencode-session-header — 请求头形态归一化。
 *
 * fetch init.headers / Request.headers 有三种形态（Headers 实例、数组、
 * 普通对象），大小写不敏感：判定"是否已有该头"与"写入该头"都必须覆盖
 * 三种形态，且不可就地修改调用方的对象（避免污染共享 headers）。
 */

/** Headers 实例的最小契约。 */
interface HeadersLike {
  has(name: string): boolean
  set(name: string, value: string): void
  forEach(callback: (value: string, key: string) => void): void
}

/** 取运行时 Headers 构造器（Node 18+ 全局可用；缺失时降级为其它形态处理）。 */
function headersConstructor(): (new (init?: unknown) => HeadersLike) | undefined {
  const ctor = (globalThis as { Headers?: unknown }).Headers
  return typeof ctor === 'function' ? (ctor as new (init?: unknown) => HeadersLike) : undefined
}

function isHeadersInstance(value: unknown): value is HeadersLike {
  const ctor = headersConstructor()
  return ctor !== undefined && value instanceof ctor
}

/** 条目 → 头名（数组形态的第 0 项）。 */
function entryName(entry: unknown): string {
  return Array.isArray(entry) ? String(entry[0]).toLowerCase() : ''
}

/** 是否已存在同名头（大小写不敏感）。 */
export function hasHeader(headers: unknown, name: string): boolean {
  const wanted = name.toLowerCase()
  if (isHeadersInstance(headers)) return headers.has(name)
  if (Array.isArray(headers)) return headers.some((entry) => entryName(entry) === wanted)
  if (headers !== null && typeof headers === 'object') {
    return Object.keys(headers as Record<string, unknown>).some((key) => key.toLowerCase() === wanted)
  }
  return false
}

/** 返回写入该头后的新 headers 值（不改动入参；形态与入参一致）。 */
export function withHeader(headers: unknown, name: string, value: string): unknown {
  if (isHeadersInstance(headers)) return clonedWithHeader(headers, name, value)
  if (Array.isArray(headers))
    return [...headers.filter((entry) => entryName(entry) !== name.toLowerCase()), [name, value]]
  const base: Record<string, unknown> =
    headers !== null && typeof headers === 'object' ? { ...(headers as object) } : {}
  for (const key of Object.keys(base)) {
    if (key.toLowerCase() === name.toLowerCase()) delete base[key]
  }
  base[name] = value
  return base
}

/** 复制 Headers 实例并写入（避免改动调用方共享的实例）。 */
function clonedWithHeader(headers: HeadersLike, name: string, value: string): HeadersLike {
  const ctor = headersConstructor()
  if (ctor === undefined) return headers
  const copy = new ctor()
  headers.forEach((headerValue, key) => copy.set(key, headerValue))
  copy.set(name, value)
  return copy
}
