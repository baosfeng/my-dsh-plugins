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
import { createAssetHandler, assetNameOf, ASSETS_PREFIX } from '../lib/routes/assets.js'

const here = dirname(fileURLToPath(import.meta.url))
const ENGINE = join(here, '..', 'assets', 'mermaid-10.9.3.min.js')
const PANZOOM = join(here, '..', 'assets', 'panzoom-4.6.2.min.js')

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

test('panzoom 也随包发布、UMD 形态、SHA256 与构建期冻结值一致（需求 1 的 vendored 库）', () => {
  assert.equal(existsSync(PANZOOM), true, 'panzoom asset ships in the package')
  const bytes = readFileSync(PANZOOM)
  const text = bytes.toString('utf8')
  assert.ok(text.includes('window') || text.includes('globalThis'), 'UMD build')
  // 注入 <script> 后必须落 window.Panzoom（注入下无 module / exports，见 build.mjs 注释）
  assert.ok(text.includes('Panzoom='), 'assigns window.Panzoom when injected')
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '3ce354ef7b493efb62a4d4acaaf86fa2d6027eb629857a4e144041de1a112c1e',
    'frozen panzoom SHA256',
  )
  assert.equal(bytes.toString('utf8').includes('module.exports'), true, 'UMD 版含 module.exports → 只能走 asset 注入')
})

test('按白名单文件名分派：panzoom 可服务，未登记资源 404（不做目录穿越）', async () => {
  assert.equal(assetNameOf(ASSETS_PREFIX + '/panzoom-4.6.2.min.js'), 'panzoom-4.6.2.min.js', '白名单命中')
  assert.equal(
    assetNameOf(ASSETS_PREFIX + '/mermaid-10.9.3.min.js?x=1#y'),
    'mermaid-10.9.3.min.js',
    '忽略 query / hash',
  )
  assert.equal(assetNameOf(ASSETS_PREFIX + '/../../package.json'), null, '未登记一律拒绝')
  assert.equal(assetNameOf(undefined), null, '取不到 URL 也拒绝')
  const handler = createAssetHandler()
  const ok = mockResponse()
  await handler({ method: 'GET', headers: {}, url: ASSETS_PREFIX + '/panzoom-4.6.2.min.js' }, ok)
  assert.equal(ok.status, 200, 'panzoom 200')
  assert.equal(Number(ok.headers['Content-Length']), readFileSync(PANZOOM).length, 'Content-Length matches')
  const missing = mockResponse()
  await handler({ method: 'GET', headers: {}, url: ASSETS_PREFIX + '/nope.js' }, missing)
  assert.equal(missing.status, 404, '未登记资源 404')
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
