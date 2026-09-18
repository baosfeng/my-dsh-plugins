import { test } from 'vitest'
/**
 * dsh-session-title-gen — 设置页配置端点（GET/PUT /session-title-gen/api/config）契约测试
 * （issue #385 验收项「设置 → 插件 页签暴露 8 项」「页签 id 全局唯一」「保存写回 + 热生效」）。
 *
 * 本文件钉住 host 侧的**读取与注册契约**（写入与热生效见 config-write.mjs）：
 *  1. GET 暴露**全部 8 项**（enabled / template / provider / model / maxTitleBytes /
 *     maxInputBytes / maxOutputTokens / timeoutMs）与默认值口径；
 *  2. loopback 信任围栏（非本机 / 跨站 / origin 不匹配一律 403）、未知 path 与方法 404；
 *  3. 路由注册的真实契约（回归：设置页曾恒 404）——服务经 `ctx.inject(['webServer'], cb)`
 *     局部等待（不能用 `ctx.get` 一次性取值：无重试、服务晚到即永久错过），注册落
 *     **常驻 root**（profile 插件 fiber 会被 loader 回收，挂在它上的 effect 一并注销），
 *     重复 apply 先撤上一轮（宿主对重复 (kind, path) 直接抛错）；
 *  4. **禁用状态下也注册配置路由**：否则用户在设置页里没有任何入口把插件重新打开
 *     （enabled=false 只影响标题生成，不影响配置面）；
 *  5. 无 webServer / inject 失败 / 宿主占用同一 path 时降级为「无配置路由」，不 fatal。
 *
 * 断言全部写在 test() 内（Stryker vitest-runner 归因要求，同 host-smoke.mjs）。
 * ctx 桩见 helpers/host-ctx.mjs（按 cordis 4 真实契约构造，不是宽松 mock）。
 */
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { CONFIG_ROUTE_PREFIX, CONFIG_ROW_ID, createConfigHandler } from '../lib/config-routes.js'
import { DEFAULT_SETTINGS, SETTINGS_FIELDS } from '../lib/config.js'
import { createHostCtx } from './helpers/host-ctx.mjs'

/** 设置页暴露的 8 项（顺序无关，断言用集合精确比对）。 */
const SETTINGS_KEYS = [
  'enabled',
  'template',
  'provider',
  'model',
  'maxTitleBytes',
  'maxInputBytes',
  'maxOutputTokens',
  'timeoutMs',
]

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

test('GET config 暴露全部 8 项配置与默认值（① 页签暴露 8 项）', () => {
  assert.deepEqual([...SETTINGS_FIELDS].sort(), [...SETTINGS_KEYS].sort(), '暴露字段常量恰好 8 项：' + SETTINGS_FIELDS)
  const res = call(
    createConfigHandler(() => DEFAULT_SETTINGS),
    fakeRequest(),
  )
  assert.equal(res.status, 200, '默认配置返回 200')
  assert.equal(res.json.ok, true)
  assert.deepEqual(Object.keys(res.json.value).sort(), [...SETTINGS_KEYS].sort(), '恰好 8 项，不多不少')
  assert.deepEqual(res.json.value, {
    enabled: true,
    template: '[{workspace}] {description}',
    provider: '',
    model: '',
    maxTitleBytes: 80,
    maxInputBytes: 4096,
    maxOutputTokens: 64,
    timeoutMs: 30000,
  })
  assert.equal(res.headers['content-type'], 'application/json', 'JSON content-type')
  assert.equal(res.headers['cache-control'], 'no-cache', 'no-cache（配置改动即时可见）')
})

test('信任围栏：非本机 host / 跨站 / origin 不匹配 / 非法 origin 一律 403', () => {
  const handler = createConfigHandler(() => DEFAULT_SETTINGS)
  assert.equal(call(handler, fakeRequest({ headers: {} })).status, 403, '缺 host → 403')
  assert.equal(call(handler, fakeRequest({ headers: { host: 'evil.example.com' } })).status, 403, '外部 host → 403')
  assert.equal(call(handler, fakeRequest({ headers: { host: '10.0.0.5:3080' } })).status, 403, '内网非 loopback → 403')
  assert.equal(
    call(handler, fakeRequest({ headers: { host: '127.0.0.1.evil.com:3080' } })).status,
    403,
    '127. 前缀伪装 → 403',
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
})

test('未识别的 path / 方法 → 404（配置端点之外的请求不误伤）', () => {
  const handler = createConfigHandler(() => DEFAULT_SETTINGS)
  assert.equal(call(handler, fakeRequest({ url: `${CONFIG_ROUTE_PREFIX}/other` })).status, 404, '未知 path → 404')
  assert.equal(
    call(handler, fakeRequest({ url: `${CONFIG_ROUTE_PREFIX}/other`, method: 'PUT' })).status,
    404,
    'PUT 到未知 path → 404',
  )
  assert.equal(call(handler, fakeRequest({ method: 'DELETE' })).status, 404, 'DELETE /config 未实现 → 404')
  assert.equal(call(handler, fakeRequest({ url: undefined })).status, 404, '缺 url → 404')
})

test('apply：注册 loopback 配置路由（prefix + 稳定前缀 + 8 项生效值）', async () => {
  const host = createHostCtx({ webServer: 'ready' })
  const route = await bootAndRoute(host, { template: '{description}' })
  assert.equal(host.routes.length, 1, '配置路由注册一次')
  assert.equal(route.kind, 'prefix', 'prefix 路由')
  assert.equal(route.path, CONFIG_ROUTE_PREFIX, '路由前缀稳定（client 端按同一常量拉取）')
  assert.equal(typeof route.handler, 'function', 'handler 是函数')
  const body = call(route.handler, fakeRequest())
  assert.deepEqual(Object.keys(body.json.value).sort(), [...SETTINGS_KEYS].sort(), '路由暴露全部 8 项')
  assert.equal(body.json.value.template, '{description}', 'handler 暴露 apply 时的配置值')
  assert.equal(host.logs.filter((l) => l.startsWith('error:')).length, 0, '注册路由不报错')
})

test('enabled=false 时仍注册配置路由（否则设置页没有入口把插件重新打开）', async () => {
  const host = createHostCtx({ webServer: 'ready' })
  const route = await bootAndRoute(host, { enabled: false })
  assert.ok(route, '禁用状态也注册配置路由：' + JSON.stringify(host.logs))
  assert.equal(call(route.handler, fakeRequest()).json.value.enabled, false, 'GET 反映禁用的生效值')
  assert.equal(host.listeners.length, 0, '禁用时不注册 session/event 监听器（既有语义保持）')
})

test('回归：webServer 晚于本插件就绪时仍注册（ctx.get 一次性取值会永久错过）', async () => {
  const host = createHostCtx({ webServer: 'late' })
  apply(host.ctx, {})
  await host.settle()
  assert.equal(host.routes.length, 0, '服务未就绪时先不注册（也不抛错）')

  host.provideWebServer()
  await host.settle()
  assert.equal(host.routes.length, 1, '服务就绪后补注册（inject 子 fiber 等待服务）')
  assert.equal(host.routes[0].path, CONFIG_ROUTE_PREFIX, '补注册的仍是配置路由')
})

test('回归：注册落常驻 root，profile 插件 fiber 被回收后路由仍在（曾恒 404 的根因）', async () => {
  const host = createHostCtx({ webServer: 'ready' })
  const route = await bootAndRoute(host, {})
  assert.equal(host.routes.length, 1, '先注册成功')
  host.recyclePluginFiber()
  assert.equal(host.routes.length, 1, '插件自身 fiber 被 loader 回收后路由仍存活（挂在常驻 root 上）')
  assert.equal(call(route.handler, fakeRequest()).status, 200, 'handler 仍可服务')
})

test('重复 apply（loader 会多次 apply）：先撤上一轮；root 卸载后无残留路由', async () => {
  const host = createHostCtx({ webServer: 'ready' })
  await bootAndRoute(host, {})
  apply(host.ctx, {})
  await host.settle()
  apply(host.ctx, {})
  await host.settle()
  assert.equal(host.routes.length, 1, '同一前缀只留一条路由（宿主 register 对重复 path 抛错）')

  host.teardownRoot()
  assert.equal(host.routes.length, 0, 'root 卸载后无残留路由（disposer 幂等）')
  assert.equal(host.logs.filter((l) => l.startsWith('error:')).length, 0, '幂等清理不抛错')
})

test('无 webServer / inject 抛错 / scope 缺服务：降级为无配置路由，插件不 fatal', async () => {
  const noServer = createHostCtx({ webServer: 'never' })
  assert.doesNotThrow(() => apply(noServer.ctx, {}), '缺服务也不能让 apply 失败')
  await noServer.settle()
  assert.equal(noServer.routes.length, 0, '无服务不注册路由')
  assert.equal(noServer.listeners.length, 1, '标题生成监听器照常注册（主功能不陪葬）')
  assert.equal(noServer.logs.filter((l) => l.startsWith('error:')).length, 0, '降级不报错')

  const broken = createHostCtx({ webServer: 'ready', root: false })
  broken.ctx.inject = () => {
    throw new Error('cannot get required service "webServer" in inactive context')
  }
  assert.doesNotThrow(() => apply(broken.ctx, {}), 'inject 抛错不能让 apply 失败')
  await broken.settle()
  assert.equal(broken.routes.length, 0, 'inject 失败即不注册')
  assert.ok(
    broken.logs.some((l) => l.startsWith('warn:') && l.includes('webServer')),
    'inject 失败给出 webServer 警告（可观测，不静默）',
  )

  const scopeMissing = createHostCtx({ webServer: 'ready', scopeWebServer: false })
  assert.doesNotThrow(() => apply(scopeMissing.ctx, {}), 'scope 缺服务也不能抛错')
  await scopeMissing.settle()
  assert.equal(scopeMissing.routes.length, 0, '无可用服务即不注册')
})

test('没有 inject 能力的极简 ctx（老宿主/测试桩）：只告警，不抛错', async () => {
  const host = createHostCtx({ webServer: 'ready' })
  host.ctx.inject = undefined
  host.ctx.root.inject = undefined
  assert.doesNotThrow(() => apply(host.ctx, {}), '无 inject 不能让 apply 失败')
  await host.settle()
  assert.equal(host.routes.length, 0, '无注册通道即不注册')
  assert.ok(
    host.logs.some((l) => l.startsWith('warn:') && l.includes('配置路由')),
    '给出可观测告警：' + JSON.stringify(host.logs),
  )
})

test('宿主已占用同一 path（register 抛错）：只告警，不让插件 fatal', async () => {
  const host = createHostCtx({ webServer: 'ready' })
  host.routes.push({ kind: 'prefix', path: CONFIG_ROUTE_PREFIX, handler: () => {} })
  apply(host.ctx, {})
  await host.settle()
  assert.equal(host.listeners.length, 1, '标题生成监听器不受影响')
  assert.ok(
    host.logs.some((l) => l.startsWith('warn:') && l.includes('配置路由')),
    `注册失败必须告警，got ${JSON.stringify(host.logs)}`,
  )
  assert.equal(host.logs.filter((l) => l.startsWith('error:')).length, 0, '不抛错、不 fatal')
})

test('路由前缀与行 id 是稳定常量（client 端与 patch 文件按同一常量对齐）', () => {
  assert.equal(CONFIG_ROUTE_PREFIX, '/session-title-gen/api', '路由前缀固定为 /session-title-gen/api')
  assert.equal(CONFIG_ROW_ID, 'session-title-gen', '行 id 固定为 session-title-gen（写回见 config-write.mjs）')
})
