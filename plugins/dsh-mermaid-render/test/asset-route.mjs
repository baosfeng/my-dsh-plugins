/**
 * issue #296 附带修复：host 半的**静态资源路由**此前零覆盖率。
 *
 * `apply()` 通过 `ctx.webServer.register({ kind:'prefix', path:'/mermaid-render/assets' })`
 * 注册 mermaid 引擎的静态路由（引擎已外部化，client 端按需 fetch）。这条路由在
 * `lib/index.js` 里是最大的一块可测逻辑，却没有任何测试调用过它 —— 覆盖率门禁
 * （lib/index.js 行 ≥85 / 分支 ≥75 / 函数 ≥80）因此长期不达标，而这个失败又被
 * #296 的巨型资产 diff 灌满的 job 日志淹没了。
 *
 * 本文件用**假的 ctx / req / res** 真正跑一遍 apply + 路由处理函数，钉住契约：
 *  1. 路由注册在预期 path（client 端 fetch 的就是它）、handler 可调用；
 *  2. GET 全量返回引擎字节，Content-Type / Content-Length / ETag / Last-Modified 齐全；
 *  3. 带 If-None-Match 的第二次请求走 304（缓存层只读一次文件）；
 *  4. 非 GET/HEAD → 405 且不写 body；
 *  5. 引擎文件缺失 → 404 + 可操作提示（构建漏跑不得静默返回空脚本）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, inject } from '../lib/index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSET_PATH = join(ROOT, 'assets', 'mermaid-10.9.3.min.js')
const ASSET_HIDDEN = join(ROOT, 'assets', '__asset-route-hidden__.min.js')
const ROUTE_PATH = '/mermaid-render/assets'

/** 假的 ctx：记录 effect / webServer.register / systemPrompt.section 的调用。 */
function makeCtx() {
  const registrations = []
  const sections = []
  const ctx = {
    effect: (fn) => fn(),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    webServer: { register: (options) => registrations.push(options) },
    systemPrompt: { section: (section) => sections.push(section) },
  }
  return { ctx, registrations, sections }
}

/** 假的 res：把 writeHead/end 的参数收进对象，便于断言。 */
function makeRes() {
  const res = {
    head: null,
    body: undefined,
    writeHead: (code, headers) => {
      res.head = { code, headers }
    },
    end: (body) => {
      res.body = body
    },
  }
  return res
}

/** apply + 取出注册的静态路由 handler（对每条用例都是新的 handler，缓存层独立）。 */
function bootRoute() {
  const { ctx, registrations, sections } = makeCtx()
  apply(ctx)
  // issue #383 起 apply 还会注册 /mermaid-render/api（设置面板配置端点），
  // 故按 path 定位本条契约要钉的静态资源路由，而不是取第一条/断言总数。
  const route = registrations.find((r) => r.path === ROUTE_PATH)
  assert.ok(route, 'apply 必须注册静态资源路由')
  assert.equal(route.path, ROUTE_PATH, '路由前缀必须是 client 端 fetch 的那个 path')
  assert.equal(route.kind, 'prefix', '按前缀托管 assets 目录')
  assert.equal(typeof route.handler, 'function', 'handler 必须可调用')
  return { handler: route.handler, registrations, sections }
}

test('apply 注册静态资源路由，并把 systemPrompt section 交给宿主', () => {
  const { registrations, sections } = bootRoute()
  assert.ok(
    registrations.every((r) => r.kind === 'prefix'),
    '注册的每条路由都按前缀托管',
  )
  assert.equal(sections.length, 1, '默认配置下注入一条 systemPrompt section')
  assert.ok(inject.includes('systemPrompt'), 'inject 声明了 systemPrompt')
})

test('GET /mermaid-render/assets：返回引擎全量字节与完整缓存头', async () => {
  const { handler } = bootRoute()
  const res = makeRes()
  await handler({ method: 'GET', headers: {} }, res)
  const bytes = readFileSync(ASSET_PATH)
  assert.equal(res.head.code, 200, '命中资源返回 200')
  assert.equal(res.head.headers['Content-Type'], 'application/javascript; charset=utf-8')
  assert.equal(res.head.headers['Content-Length'], String(bytes.length), 'Content-Length 与实际文件字节一致')
  assert.ok(res.head.headers.ETag, '提供 ETag（缓存校验用）')
  assert.ok(res.head.headers['Last-Modified'], '提供 Last-Modified')
  assert.ok(Buffer.isBuffer(res.body), '二进制直出（不做字符串转换）')
  assert.equal(res.body.length, statSync(ASSET_PATH).size, 'body 就是引擎文件本身')
})

test('HEAD 与 GET 等价命中；带 If-None-Match 的重复请求走 304', async () => {
  const { handler } = bootRoute()
  const head = makeRes()
  await handler({ method: 'HEAD', headers: {} }, head)
  assert.equal(head.head.code, 200, 'HEAD 也应命中')

  const first = makeRes()
  await handler({ method: 'GET', headers: {} }, first)
  const second = makeRes()
  await handler({ method: 'GET', headers: { 'if-none-match': first.head.headers.ETag } }, second)
  assert.equal(second.head.code, 304, 'ETag 命中走 304')
  assert.equal(second.body, undefined, '304 不返回 body')
})

test('非 GET/HEAD 方法返回 405 且不写 body', async () => {
  const { handler } = bootRoute()
  for (const method of ['POST', 'DELETE', 'PUT']) {
    const res = makeRes()
    await handler({ method, headers: {} }, res)
    assert.equal(res.head.code, 405, method + ' 必须被拒')
    assert.equal(res.body, undefined, method + ' 不应返回 body')
  }
})

test('引擎文件缺失时返回 404（构建漏跑不得静默返回空脚本）', async () => {
  const { handler } = bootRoute()
  // 真实地让生产 handler 走进 catch 分支：临时把 asset 移开，用完立刻还原。
  renameSync(ASSET_PATH, ASSET_HIDDEN)
  try {
    const res = makeRes()
    await handler({ method: 'GET', headers: {} }, res)
    assert.equal(res.head.code, 404, '读不到引擎必须显式 404')
    assert.ok(String(res.body).includes('mermaid engine not found'), '给出可操作提示：' + res.body)
  } finally {
    renameSync(ASSET_HIDDEN, ASSET_PATH)
  }
})
