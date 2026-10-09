/**
 * mermaid 引擎静态资源路由（/md-render/assets）—— 资产路由契约。
 *
 * 断言：引擎**不内联**进 bundle（issue #185 的 4.48 MB base64 冗余教训），改为
 * 静态托管 + ETag/304 + 405 + 缺失时 404 降级；同时校验 assets 目录里的引擎
 * 文件确实存在且是 UMD 形态（构建期 SHA256 校验的运行时对应面）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createAssetHandler, ASSETS_PREFIX } from '../lib/routes/assets.js'

const here = dirname(fileURLToPath(import.meta.url))
const ENGINE = join(here, '..', 'assets', 'mermaid-10.9.3.min.js')

function mockResponse() {
  const res = {
    status: 0,
    headers: {},
    body: undefined,
    writeHead(status, headers) {
      res.status = status
      res.headers = headers ?? {}
    },
    end(chunk) {
      res.body = chunk
    },
  }
  return res
}
const req = (method = 'GET', headers = {}) => ({ method, headers, url: ASSETS_PREFIX + '/mermaid-10.9.3.min.js' })

test('资源路由前缀与 client 端字面量一致（跨半边契约）', () => {
  assert.equal(ASSETS_PREFIX, '/md-render/assets')
  const client = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  assert.ok(client.includes('/md-render/assets/mermaid-10.9.3.min.js'), 'client fetches the same prefix')
})

test('引擎文件存在、是 UMD、且 SHA256 与构建期冻结值一致', () => {
  assert.equal(existsSync(ENGINE), true, 'engine asset ships in the package')
  const bytes = readFileSync(ENGINE)
  const text = bytes.toString('utf8')
  assert.ok(text.includes('window') || text.includes('globalThis'), 'UMD build')
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '5a8ec91820bd55afef049068489369910e5d6ce70c8103952f27e29d3e76e8bc',
    'frozen engine SHA256',
  )
})

test('GET 引擎 → 200 + 缓存头 + ETag', async () => {
  const handler = createAssetHandler()
  const res = mockResponse()
  await handler(req(), res)
  assert.equal(res.status, 200)
  assert.equal(res.headers['Content-Type'], 'application/javascript; charset=utf-8')
  assert.equal(res.headers['Cache-Control'], 'public, max-age=31536000, immutable')
  assert.ok(res.headers.ETag, 'ETag present')
  assert.equal(Number(res.headers['Content-Length']), readFileSync(ENGINE).length, 'Content-Length matches')
})

test('If-None-Match 命中 → 304 空体', async () => {
  const handler = createAssetHandler()
  const first = mockResponse()
  await handler(req(), first)
  const cached = mockResponse()
  await handler(req('GET', { 'if-none-match': first.headers.ETag }), cached)
  assert.equal(cached.status, 304, 'conditional request served from cache')
  assert.equal(cached.body, undefined, 'no body on 304')
})

test('HEAD 也服务；非 GET/HEAD → 405', async () => {
  const handler = createAssetHandler()
  const head = mockResponse()
  await handler(req('HEAD'), head)
  assert.equal(head.status, 200, 'HEAD allowed')
  const post = mockResponse()
  await handler(req('PUT'), post)
  assert.equal(post.status, 405, 'method not allowed')
})
