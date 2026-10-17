/**
 * dsh-shared — fence 单元测试：Host-header 信任围栏。
 *
 * 覆盖：loopback 放行、受信权威放行、cross-site 拒绝、origin 同源校验、
 * 非法 host 拒绝、缺失 host 拒绝、trustedHosts 非数组容错；
 * 0.2.1 信任源迁移：webStartup.trustedHosts / webServer.host 监听地址 /
 * 旧宿主 webRuntime 兜底 / createTrustFence。
 * 行为基准：抽取前各插件 lib/fence.js 的既有测试断言（issue #45）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { isTrustedApiRequest, trustedHostsOf, bindHostOf, createTrustFence } from '../lib/fence.js'

function request({ host, secFetchSite, origin }) {
  const headers = {}
  if (host !== undefined) headers.host = host
  if (secFetchSite !== undefined) headers['sec-fetch-site'] = secFetchSite
  if (origin !== undefined) headers.origin = origin
  return { headers }
}

test('loopback host 放行（127.0.0.1）', () => {
  assert.equal(isTrustedApiRequest(request({ host: '127.0.0.1:3080' }), []), true)
})

test('loopback host 放行（localhost）', () => {
  assert.equal(isTrustedApiRequest(request({ host: 'localhost:3080' }), []), true)
})

test('loopback host 放行（[::1]）', () => {
  assert.equal(isTrustedApiRequest(request({ host: '[::1]:3080' }), []), true)
})

test('非 loopback 且无受信权威 → 拒绝', () => {
  assert.equal(isTrustedApiRequest(request({ host: 'evil.example.com' }), []), false)
})

test('受信权威放行（hostname 精确匹配）', () => {
  assert.equal(isTrustedApiRequest(request({ host: 'dsh.local:3080' }), ['dsh.local']), true)
})

test('受信权威放行（host:port 精确匹配）', () => {
  assert.equal(isTrustedApiRequest(request({ host: 'dsh.local:3080' }), ['dsh.local:3080']), true)
})

test('受信权威端口不匹配 → 拒绝', () => {
  assert.equal(isTrustedApiRequest(request({ host: 'dsh.local:9999' }), ['dsh.local:3080']), false)
})

test('缺失 host 头 → 拒绝', () => {
  assert.equal(isTrustedApiRequest(request({}), []), false)
})

test('非法 host → 拒绝', () => {
  assert.equal(isTrustedApiRequest(request({ host: '::not-a-host::' }), []), false)
})

test('cross-site 请求 → 拒绝', () => {
  assert.equal(isTrustedApiRequest(request({ host: '127.0.0.1:3080', secFetchSite: 'cross-site' }), []), false)
})

test('同源 origin → 放行', () => {
  assert.equal(isTrustedApiRequest(request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }), []), true)
})

test('跨源 origin → 拒绝', () => {
  assert.equal(isTrustedApiRequest(request({ host: '127.0.0.1:3080', origin: 'http://evil.example.com' }), []), false)
})

test('非法 origin → 拒绝', () => {
  assert.equal(isTrustedApiRequest(request({ host: '127.0.0.1:3080', origin: 'not-a-url' }), []), false)
})

test('无 origin 头 → 放行（同源校验跳过）', () => {
  assert.equal(isTrustedApiRequest(request({ host: '127.0.0.1:3080' }), []), true)
})

// ── 0.2.1 信任源迁移：webStartup / 监听地址 / 旧 webRuntime 兜底 ────────────

function context({ startup, runtime, host } = {}) {
  return {
    get(name) {
      if (name === 'webStartup') return startup
      if (name === 'webRuntime') return runtime
      return undefined
    },
    ...(host === undefined ? {} : { webServer: { host } }),
  }
}

test('trustedHostsOf: 0.2.1 从 webStartup.trustedHosts 读取', () => {
  const ctx = context({ startup: { trustedHosts: ['dsh.internal:8443'] } })
  assert.deepEqual(trustedHostsOf(ctx), ['dsh.internal:8443'])
})

test('trustedHostsOf: 旧宿主回退 webRuntime.trustedHosts', () => {
  const ctx = context({ runtime: { trustedHosts: ['legacy.local'] } })
  assert.deepEqual(trustedHostsOf(ctx), ['legacy.local'])
})

test('trustedHostsOf: 两来源合并去重，非字符串/空串忽略', () => {
  const ctx = context({
    startup: { trustedHosts: ['a.local', 'dup.local', ''] },
    runtime: { trustedHosts: ['dup.local', 42, 'b.local'] },
  })
  assert.deepEqual(trustedHostsOf(ctx), ['a.local', 'dup.local', 'b.local'])
})

test('trustedHostsOf: 服务缺失或字段非数组 → 空列表', () => {
  assert.deepEqual(trustedHostsOf(undefined), [])
  assert.deepEqual(trustedHostsOf(context({ startup: { trustedHosts: null } })), [])
  assert.deepEqual(trustedHostsOf({}), [])
})

test('bindHostOf: 读取 webServer.host，非字符串忽略', () => {
  assert.equal(bindHostOf(context({ host: '10.0.0.7' })), '10.0.0.7')
  assert.equal(bindHostOf(context({})), undefined)
  assert.equal(bindHostOf({ webServer: { host: 3080 } }), undefined)
})

test('bindHostOf: 属性不可用时回退 ctx.get(webServer).host', () => {
  const ctx = { get: (name) => (name === 'webServer' ? { host: '10.0.0.9' } : undefined) }
  assert.equal(bindHostOf(ctx), '10.0.0.9')
})

test('监听地址字面量（IPv4）任意端口放行', () => {
  assert.equal(isTrustedApiRequest(request({ host: '10.0.0.7:3080' }), [], '10.0.0.7'), true)
  assert.equal(isTrustedApiRequest(request({ host: '10.0.0.7:9999' }), [], '10.0.0.7'), true)
  assert.equal(isTrustedApiRequest(request({ host: '10.0.0.8:3080' }), [], '10.0.0.7'), false)
})

test('监听地址字面量（IPv6 + zone id）放行', () => {
  assert.equal(isTrustedApiRequest(request({ host: '[fd00::5]:3080' }), [], 'fd00::5'), true)
  assert.equal(isTrustedApiRequest(request({ host: '[fe80::1]:3080' }), [], 'fe80::1%en0'), true)
})

test('监听地址字面量仍受 cross-site / 跨源 origin 约束', () => {
  assert.equal(
    isTrustedApiRequest(request({ host: '10.0.0.7:3080', secFetchSite: 'cross-site' }), [], '10.0.0.7'),
    false,
  )
  assert.equal(
    isTrustedApiRequest(request({ host: '10.0.0.7:3080', origin: 'http://evil.example.com' }), [], '10.0.0.7'),
    false,
  )
})

test('createTrustFence: webStartup 权威 + 监听地址 + loopback 均放行，陌生 host 拒绝', () => {
  const fence = createTrustFence(context({ startup: { trustedHosts: ['dsh.internal'] }, host: '10.0.0.7' }))
  assert.equal(fence(request({ host: 'dsh.internal:3080' })), true)
  assert.equal(fence(request({ host: '10.0.0.7:3080' })), true)
  assert.equal(fence(request({ host: '127.0.0.1:3080' })), true)
  assert.equal(fence(request({ host: 'evil.example.com' })), false)
})

test('createTrustFence: 宿主服务晚到（apply 时缺失）后仍按请求现读', () => {
  let startup
  const ctx = {
    get(name) {
      return name === 'webStartup' ? startup : undefined
    },
  }
  const fence = createTrustFence(ctx)
  assert.equal(fence(request({ host: 'dsh.internal' })), false)
  startup = { trustedHosts: ['dsh.internal'] }
  assert.equal(fence(request({ host: 'dsh.internal' })), true)
})
