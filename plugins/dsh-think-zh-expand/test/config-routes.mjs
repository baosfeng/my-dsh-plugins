import { test } from 'vitest'
/**
 * Host-half config surface test（issue #355）：
 *  - 配置项 defaultExpanded 的规整（仅布尔生效，缺失/非法回退 true）；
 *  - client 端读取通道：webServer 只读路由 GET /think-zh-expand/api/config；
 *  - loopback 信任围栏（非本机 / 跨站 / origin 不匹配一律 403）；
 *  - 无 webServer（非 web profile）时降级不 apply 失败。
 *
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

/** 构造带 webServer 的 ctx（捕获注册的路由）。 */
function bootWithServer(config, { service = true } = {}) {
  const routes = []
  const sections = []
  const logs = []
  const ctx = {
    systemPrompt: { section: (section) => sections.push(section) },
    logger: {
      info: (message) => logs.push(`info:${message}`),
      warn: (message) => logs.push(`warn:${message}`),
      error: (message) => logs.push(`error:${message}`),
    },
    get: (name) => {
      if (name !== 'webServer' || !service) return undefined
      return { register: (route) => routes.push(route) }
    },
    effect: (fn) => fn(),
  }
  apply(ctx, config)
  return { routes, sections, logs }
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

test('未识别的 path / 方法 → 404（只提供读接口）', () => {
  const handler = createConfigHandler(() => true)
  const wrongPath = call(handler, fakeRequest({ url: '/think-zh-expand/api/other' }))
  assert.equal(wrongPath.status, 404)
  assert.equal(wrongPath.json.ok, false)
  assert.equal(call(handler, fakeRequest({ method: 'PUT' })).status, 404, 'PUT 未实现 → 404')
  assert.equal(call(handler, fakeRequest({ url: undefined })).status, 404, '缺 url → 404')
})

test('apply：注册 loopback 只读路由并把配置生效值接进 handler', () => {
  const { routes, sections, logs } = bootWithServer({ defaultExpanded: false })
  assert.equal(sections.length, 1, 'system-prompt section 仍注册')
  assert.equal(routes.length, 1, '配置路由注册一次')
  assert.equal(routes[0].kind, 'prefix', 'prefix 路由')
  assert.equal(routes[0].path, CONFIG_ROUTE_PREFIX, '路由前缀稳定（client 端按同一常量拉取）')
  assert.equal(typeof routes[0].handler, 'function', 'handler 是函数')
  const body = call(routes[0].handler, fakeRequest())
  assert.deepEqual(body.json.value, { defaultExpanded: false }, 'handler 暴露 apply 时的配置值')
  assert.ok(logs[0].includes('defaultExpanded=false'), `启用日志带生效值，got ${logs[0]}`)
})

test('apply 默认配置：路由暴露 true（① 默认展开不回归）', () => {
  const { routes } = bootWithServer(undefined)
  assert.deepEqual(call(routes[0].handler, fakeRequest()).json.value, { defaultExpanded: true })
})

test('无 webServer（非 web profile / get 抛错）→ 降级警告，不 apply 失败', () => {
  const noService = bootWithServer({ defaultExpanded: false }, { service: false })
  assert.equal(noService.routes.length, 0, '无服务不注册路由')
  assert.equal(noService.sections.length, 1, 'system-prompt section 仍注册')
  assert.ok(
    noService.logs.some((l) => l.startsWith('warn:') && l.includes('webServer')),
    '降级时给出 webServer 警告',
  )

  const throwing = bootWithServer(undefined)
  const ctx = {
    systemPrompt: { section: () => () => {} },
    get: () => {
      throw new Error('service not found')
    },
  }
  assert.doesNotThrow(() => apply(ctx, { defaultExpanded: true }), 'get 抛错也不能让 apply 失败')
  assert.ok(throwing.logs[0].includes('已启用'), '正常路径仍有启用日志')

  const badService = bootWithServer(undefined)
  const ctx2 = { systemPrompt: { section: () => () => {} }, get: () => ({}) }
  assert.doesNotThrow(() => apply(ctx2), 'register 缺失的服务视作不可用')
  assert.ok(badService.logs[0].includes('已启用'))
})
