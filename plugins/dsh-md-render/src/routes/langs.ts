/**
 * dsh-md-render — `/md-render/api/langs` 语言索引查询（host half，issue #466）。
 *
 * client 半在 **DOM 语言识别失败**时（真实宿主 banner 只给本地化标签「代码块」、
 * 非空代码块的 `<code>` 又没有 `language-*` class）按块内容哈希来问语言：
 *
 *   GET /md-render/api/langs?h=<hash>&h=<hash>…   →   { ok: true, value: { "<hash>": "text" } }
 *
 *  - 请求参数 `h` 可重复（{@link LANGS_MAX_HASHES} 上限，去重 + 形态校验，非法值忽略）；
 *  - 响应 `value` **只含命中的哈希**（查不到 = 保持官方默认，绝不误伤「无语言」块）；
 *  - 非 GET → 405；无参数 → `value: {}`（200，不是错误）。
 *
 * handler 挂在**既有** `/md-render/api` 前缀下（由 routes/config.ts 统一分派），因此
 * loopback 信任围栏与路由前缀单一真源都只有一份，不新增第三条路由。
 *
 * 本文件编译为 lib/routes/langs.js（产物必须提交）。
 */
import { writeJson } from 'dsh-shared'
import { LANGS_HASH_PARAM } from './paths.js'
import type { LangIndex } from '../lang-index.js'
import type { ServerRequest, ServerResponse } from '../types.js'

/** 单次查询的哈希上限（URL 长度 / 解析成本护栏；client 半同值分批）。 */
export const LANGS_MAX_HASHES = 64

/** 合法哈希形态：client 半 djb2 → base36（1-12 位小写字母数字）。 */
const HASH_RE = /^[0-9a-z]{1,12}$/

/** URL 的 `h` 参数 → 去重后的哈希数组（非法值忽略、超上限截断，都不算错误）。 */
export function hashesOfRequest(request: ServerRequest): string[] {
  const url = new URL(request.url ?? '/', 'http://dsh.internal')
  const seen = new Set<string>()
  for (const raw of url.searchParams.getAll(LANGS_HASH_PARAM)) {
    if (HASH_RE.test(raw) && seen.size < LANGS_MAX_HASHES) seen.add(raw)
  }
  return [...seen]
}

/** 构造 langs handler（围栏由调用方 config 路由负责，这里只做查询语义）。 */
export function createLangsHandler(index: LangIndex): (request: ServerRequest, response: ServerResponse) => void {
  return (request, response) => {
    if (request.method !== 'GET') {
      writeJson(response, 405, { ok: false, error: { code: 'method_not_allowed', message: 'GET only' } })
      return
    }
    writeJson(response, 200, { ok: true, value: index.lookup(hashesOfRequest(request)) })
  }
}
