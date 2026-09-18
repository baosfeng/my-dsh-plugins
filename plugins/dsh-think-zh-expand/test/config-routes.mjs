import { test } from 'vitest'
/**
 * Host-half config surface test（issue #355）：
 *  - 配置项 defaultExpanded 的规整（仅布尔生效，缺失/非法回退 true）；
 *  - client 端读取通道：webServer 只读路由 GET /think-zh-expand/api/config；
 *  - loopback 信任围栏（非本机 / 跨站 / origin 不匹配一律 403）；
 *  - 路由注册的**真实契约**（回归：设置页曾恒 404）——服务经
 *    `ctx.inject(['webServer'], cb)` 局部等待（不能用 `ctx.get` 一次性取值：无重试，
 *    服务晚到即永久错过），注册落**常驻 root**（profile 插件 fiber 会被 loader 回收，
 *    挂在它上的 effect 一并注销 → 路由消失），重复 apply 先撤上一轮（宿主对重复
 *    (kind, path) 直接抛错）；无 webServer 时降级不 fatal、插件其它功能照常。
 *
 * ctx 桩见 helpers/host-ctx.mjs（按 cordis 4 真实契约构造，不是宽松 mock）。
 * 断言全部写在 test() 内（Stryker vitest-runner 归因要求，同 host-smoke.mjs）。
 */
import assert from 'node:assert/strict'
import {
  apply,
  CONFIG_ROUTE_PREFIX,
  DEFAULT_EXPANDED,
  createConfigHandler,
  isTrustedRequest,
  resolveDefaultExpanded,
} from '../lib/index.js'
import { createHostCtx } from './helpers/host-ctx.mjs'

/** 最小响应桩：记录 writeHead/end。 */
function fakeResponse() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(payload) {
      this.body = payload ?? ''
    },
  }
}

/** 最小请求桩：默认来自本机 host 的 GET 配置请求。 */
function fakeRequest(overrides = {}) {
  return {
    method: 'GET',
    url: `${CONFIG_ROUTE_PREFIX}/config`,
    headers: { host: '127.0.0.1:3080' },
    ...overrides,
  }
}

/** 调一次 handler，返回 { status, headers, json }。 */
function call(handler, request) {
  const response = fakeResponse()
  handler(request, response)
  return { status: response.status, headers: response.headers, json: JSON.parse(response.body) }
}

/** apply 后等 inject 回调落地，返回第一个注册的路由（无则 undefined）。 */
async function bootAndRoute(host, config) {
  apply(host.ctx, config)
  await host.settle()
  return host.routes[0]
}

test('resolveDefaultExpanded: 仅布尔生效，缺失/非法值回退 true（③ 配置缺失回退）', () => {
  assert.equal(DEFAULT_EXPANDED, true, '配置项默认值为 true（保持既有默认展开）')
  assert.equal(resolveDefaultExpanded(), true, '未配置 → true')
  assert.equal(resolveDefaultExpanded(null), true, 'null → true')
  assert.equal(resolveDefaultExpanded({}), true, '空配置对象 → true')
  assert.equal(resolveDefaultExpanded({ defaultExpanded: true }), true, '显式 true')
  assert.equal(resolveDefaultExpanded({ defaultExpanded: false }), false, '显式 false')
  assert.equal(resolveDefaultExpanded({ defaultExpanded: 'false' }), true, '字符串不生效 → true')
  assert.equal(resolveDefaultExpanded({ defaultExpanded: 0 }), true, '数字不生效 → true')
  assert.equal(resolveDefaultExpanded({ defaultExpanded: null }), true, 'null 值不生效 → true')
})

test('GET config 暴露生效值：默认 true（① 既有行为）/ 显式 false（② 折叠初值）', () => {
  const on = call(
    createConfigHandler(() => true),
    fakeRequest(),
  )
  assert.equal(on.status, 200, '默认配置返回 200')
  assert.equal(on.json.ok, true)
  assert.deepEqual(on.json.value, { defaultExpanded: true }, '默认 true，client 初值为展开')
  assert.equal(on.headers['content-type'], 'application/json', 'JSON content-type')
  assert.equal(on.headers['cache-control'], 'no-cache', 'no-cache（配置改动即时可见）')

  const off = call(
    createConfigHandler(() => false),
    fakeRequest(),
  )
  assert.deepEqual(off.json.value, { defaultExpanded: false }, '显式 false 原样暴露')
})

test('信任围栏：非本机 host / 跨站 / origin 不匹配 / 非法 origin 一律 403', () => {
  const handler = createConfigHandler(() => true)
  assert.equal(call(handler, fakeRequest({ headers: {} })).status, 403, '缺 host → 403')
  assert.equal(call(handler, fakeRequest({ headers: { host: 'evil.example.com' } })).status, 403, '外部 host → 403')
  assert.equal(call(handler, fakeRequest({ headers: { host: '10.0.0.5:3080' } })).status, 403, '内网非 loopback → 403')
  assert.equal(
    call(handler, fakeRequest({ headers: { host: '127.0.0.1.evil.com:3080' } })).status,
    403,
    '127. 前缀伪装（127.0.0.1.evil.com）→ 403',
  )
  assert.equal(
    call(handler, fakeRequest({ headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } })).status,
    403,
    '跨站请求 → 403',
  )
  assert.equal(
    call(handler, fakeRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://evil.example.com' } })).status,
    403,
    'origin 与 host 不一致 → 403',
  )
  assert.equal(
    call(handler, fakeRequest({ headers: { host: '127.0.0.1:3080', origin: 'not a url' } })).status,
    403,
    '非法 origin → 403',
  )
  assert.equal(
    call(handler, fakeRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } })).status,
    200,
    '同源本机请求 → 200',
  )
  assert.equal(call(handler, fakeRequest({ headers: { host: 'localhost:3080' } })).status, 200, 'localhost → 200')
  assert.equal(call(handler, fakeRequest({ headers: { host: '[::1]:3080' } })).status, 200, 'IPv6 loopback → 200')
  assert.equal(
    call(handler, fakeRequest({ headers: { host: '127.0.0.1:3080', origin: null } })).status,
    200,
    '无 origin → 200',
  )
  assert.equal(call(handler, fakeRequest({ headers: null })).status, 403, '无 headers → 403')
})

test('isTrustedRequest：header 读取与 IPv4 loopback 判定（含伪装域名）', () => {
  assert.equal(isTrustedRequest({ headers: { host: ['127.0.0.1:3080'] } }), true, 'host 数组取首值')
  assert.equal(isTrustedRequest({ headers: { host: '127.0.0.1:3080' } }), true)
  assert.equal(isTrustedRequest({ headers: { host: '127.1.2.3:80' } }), true, '127/8 任意地址')
  assert.equal(isTrustedRequest({ headers: { host: '127.0.0.1.evil.com:80' } }), false, '伪装前缀不通过')
  assert.equal(isTrustedRequest({ headers: { host: '127.0.0.1' } }), true, '不带端口')
  assert.equal(isTrustedRequest({ headers: { host: ':3080' } }), false, '空 hostname 不通过')
  assert.equal(isTrustedRequest({ headers: { host: 127 } }), false, '非字符串 host 不通过')
})

test('未识别的 path / 方法 → 404（按 path 定位的行为断言）', () => {
  const handler = createConfigHandler(() => true)
  const wrongPath = call(handler, fakeRequest({ url: '/think-zh-expand/api/other' }))
  assert.equal(wrongPath.status, 404, '未知 path → 404')
  assert.equal(wrongPath.json.ok, false, '404 体 ok:false')
  assert.equal(
    call(handler, fakeRequest({ method: 'PUT', url: '/think-zh-expand/api/other' })).status,
    404,
    'PUT 到未知 path → 404（config 端点的 PUT 已实现，见 config-write.mjs）',
  )
  assert.equal(call(handler, fakeRequest({ method: 'DELETE' })).status, 404, 'DELETE /config 未实现 → 404')
  assert.equal(call(handler, fakeRequest({ url: undefined })).status, 404, '缺 url → 404')
})

test('apply：注册 loopback 配置路由并把生效值接进 handler（经 ctx.inject 局部等待）', async () => {
  const host = createHostCtx({ webServer: 'ready' })
  const route = await bootAndRoute(host, { defaultExpanded: false })
  assert.equal(host.sections.length, 1, 'system-prompt section 仍注册')
  assert.equal(host.routes.length, 1, '配置路由注册一次')
  assert.equal(route.kind, 'prefix', 'prefix 路由')
  assert.equal(route.path, CONFIG_ROUTE_PREFIX, '路由前缀稳定（client 端按同一常量拉取）')
  assert.equal(typeof route.handler, 'function', 'handler 是函数')
  const body = call(route.handler, fakeRequest())
  assert.deepEqual(body.json.value, { defaultExpanded: false }, 'handler 暴露 apply 时的配置值')
  assert.ok(host.logs[0].includes('defaultExpanded=false'), `启用日志带生效值，got ${host.logs[0]}`)
})

test('apply 默认配置：路由暴露 true（① 默认展开不回归）', async () => {
  const host = createHostCtx({ webServer: 'ready' })
  const route = await bootAndRoute(host, undefined)
  assert.deepEqual(call(route.handler, fakeRequest()).json.value, { defaultExpanded: true })
})

test('回归：webServer 晚于本插件就绪时仍注册（ctx.get 一次性取值会永久错过）', async () => {
  const host = createHostCtx({ webServer: 'late' })
  apply(host.ctx, { defaultExpanded: false })
  await host.settle()
  assert.equal(host.routes.length, 0, '服务未就绪时先不注册（也不抛错）')

  host.provideWebServer()
  await host.settle()
  assert.equal(host.routes.length, 1, '服务就绪后补注册（inject 子 fiber 等待服务）')
  assert.equal(host.routes[0].path, CONFIG_ROUTE_PREFIX, '补注册的仍是配置路由')
  assert.deepEqual(
    call(host.routes[0].handler, fakeRequest()).json.value,
    { defaultExpanded: false },
    '补注册的 handler 暴露 apply 时的生效值',
  )
})

test('回归：注册落常驻 root，profile 插件 fiber 被回收后路由仍在（曾恒 404 的根因）', async () => {
  const host = createHostCtx({ webServer: 'ready' })
  const route = await bootAndRoute(host, undefined)
  assert.equal(host.routes.length, 1, '先注册成功')
  host.recyclePluginFiber()
  assert.equal(host.routes.length, 1, '插件自身 fiber 被 loader 回收后路由仍存活（挂在常驻 root 上）')
  assert.deepEqual(call(route.handler, fakeRequest()).json.value, { defaultExpanded: true }, 'handler 仍可服务')
})

test('重复 apply（loader 会多次 apply）：先撤上一轮，不重复注册、不撞宿主的 duplicate route 抛错', async () => {
  const host = createHostCtx({ webServer: 'ready' })
  await bootAndRoute(host, { defaultExpanded: true })
  apply(host.ctx, { defaultExpanded: false })
  await host.settle()
  apply(host.ctx, { defaultExpanded: true })
  await host.settle()
  assert.equal(host.routes.length, 1, '同一前缀只留一条路由（宿主 register 对重复 path 抛错）')
  assert.ok(host.sections.length >= 1, 'section 注册与路由注册互不影响')
  assert.deepEqual(
    call(host.routes[0].handler, fakeRequest()).json.value,
    { defaultExpanded: true },
    '生效值跟随最后一次 apply',
  )
  assert.equal(host.logs.filter((l) => l.startsWith('error:')).length, 0, '无错误日志')

  // 多轮 apply 后 root 卸载：每一轮 effect disposer 依次执行，陈旧 disposer 必须幂等
  // （不得误删新一轮的注册表项，也不得抛错）
  host.teardownRoot()
  assert.equal(host.routes.length, 0, 'root 卸载后无残留路由')
  assert.equal(host.logs.filter((l) => l.startsWith('error:')).length, 0, '幂等清理不抛错')
})

test('root 链卸载：effect disposer 注销路由（子 fiber 释放语义保留），并可重新 apply', async () => {
  const host = createHostCtx({ webServer: 'ready' })
  await bootAndRoute(host, undefined)
  assert.equal(host.routes.length, 1)
  host.teardownRoot()
  assert.equal(host.routes.length, 0, 'fiber 释放时注销路由（不残留）')

  apply(host.ctx, { defaultExpanded: false })
  await host.settle()
  assert.equal(host.routes.length, 1, '卸载后可重新注册')
  assert.deepEqual(call(host.routes[0].handler, fakeRequest()).json.value, { defaultExpanded: false })
})

test('无 webServer（非 web profile）：降级不 fatal，路由不注册，插件其它功能照常', async () => {
  const host = createHostCtx({ webServer: 'never' })
  assert.doesNotThrow(() => apply(host.ctx, { defaultExpanded: false }), '缺服务也不能让 apply 失败')
  await host.settle()
  assert.equal(host.routes.length, 0, '无服务不注册路由')
  assert.equal(host.sections.length, 1, 'system-prompt section 仍注册（中文思考指令不受影响）')
  assert.equal(host.logs.filter((l) => l.startsWith('error:')).length, 0, '降级不报错')
  assert.ok(host.logs[0].includes('已启用'), `正常路径仍有启用日志，got ${host.logs[0]}`)

  // 精简/老宿主：没有常驻 root，且 inject 抛错（如 inactive context）也必须降级而非蔓延
  const broken = createHostCtx({ webServer: 'ready', root: false })
  broken.ctx.inject = () => {
    throw new Error('cannot get required service "webServer" in inactive context')
  }
  assert.doesNotThrow(() => apply(broken.ctx, { defaultExpanded: true }), 'inject 抛错不能让 apply 失败')
  await broken.settle()
  assert.equal(broken.routes.length, 0, 'inject 失败即不注册')
  assert.equal(broken.sections.length, 1, 'section 仍注册')
  assert.ok(
    broken.logs.some((l) => l.startsWith('warn:') && l.includes('webServer')),
    'inject 失败给出 webServer 警告（可观测，不静默）',
  )
})

test('宿主已占用同一 path 时（register 抛错）：只告警，不让插件 fatal', async () => {
  const host = createHostCtx({ webServer: 'ready' })
  // 复刻宿主行为：同 path 已被占用（另一插件/上一实例残留）
  host.routes.push({ kind: 'prefix', path: CONFIG_ROUTE_PREFIX, handler: () => {} })
  apply(host.ctx, { defaultExpanded: true })
  await host.settle()
  assert.equal(host.sections.length, 1, 'section 不受影响')
  assert.ok(
    host.logs.some((l) => l.startsWith('warn:') && l.includes('配置路由')),
    `注册失败必须告警，got ${JSON.stringify(host.logs)}`,
  )
  assert.equal(host.logs.filter((l) => l.startsWith('error:')).length, 0, '不抛错、不 fatal')
})

test('scope 上仍无 webServer（宿主契约异常）：不注册、不抛错', async () => {
  const host = createHostCtx({ webServer: 'ready', scopeWebServer: false })
  assert.doesNotThrow(() => apply(host.ctx, { defaultExpanded: true }), 'scope 缺服务也不能抛错')
  await host.settle()
  assert.equal(host.routes.length, 0, '无可用服务即不注册')
  assert.equal(host.sections.length, 1, 'section 仍注册')
})
