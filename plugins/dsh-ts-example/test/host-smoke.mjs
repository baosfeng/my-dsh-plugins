/**
 * Smoke test for the dsh-ts-example host half: mounts the plugin against a
 * mocked context and asserts the server contract (name/inject/apply + route
 * registration + session listener + route handler behavior).
 * The client half is browser-only (lib/client.js, __ModuleLoader__ format);
 * CI checks its syntax with `node --check`.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { name, inject, apply } from '../lib/index.js'

/** 构造 mock ctx：记录路由注册与事件监听，effect 立即执行。 */
function createMockCtx() {
  const registrations = []
  const listeners = {}
  return {
    registrations,
    listeners,
    ctx: {
      on(event, handler) {
        listeners[event] = handler
        return () => {}
      },
      effect(callback) {
        return callback()
      },
      webServer: {
        register(options) {
          registrations.push(options)
          return () => {}
        },
      },
    },
  }
}

/** 构造 mock response：记录状态码与输出块。 */
function createMockResponse() {
  const response = {
    status: 0,
    headers: {},
    chunks: [],
    writeHead(status, headers) {
      response.status = status
      response.headers = headers ?? {}
    },
    end(chunk) {
      response.chunks.push(chunk ?? '')
    },
  }
  return response
}

test('host half exposes name/inject/apply', () => {
  assert.equal(name, 'dsh-ts-example', 'plugin name')
  assert.deepEqual(inject, ['webServer'], 'inject list')
  assert.equal(typeof apply, 'function', 'apply is a function')
})

test('apply registers the route and the session listener', () => {
  const { registrations, listeners, ctx } = createMockCtx()
  apply(ctx, {})
  assert.equal(registrations.length, 1, 'one route registration')
  assert.equal(registrations[0].kind, 'prefix')
  assert.equal(registrations[0].path, '/ts-example/api')
  assert.equal(typeof registrations[0].handler, 'function')
  assert.equal(typeof listeners['session/start'], 'function', 'session listener')
})

test('greeting route returns JSON for a trusted request', () => {
  const { registrations, ctx } = createMockCtx()
  apply(ctx, {})
  const response = createMockResponse()
  registrations[0].handler({ url: '/ts-example/api/greeting?name=DSH', headers: { host: 'localhost:3080' } }, response)
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.chunks.join('')), { greeting: 'Hello, DSH!' })
})

test('greeting route honors the zh config', () => {
  const { registrations, ctx } = createMockCtx()
  apply(ctx, { language: 'zh' })
  const response = createMockResponse()
  registrations[0].handler({ url: '/ts-example/api/greeting?name=DSH', headers: { host: '127.0.0.1:3080' } }, response)
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.chunks.join('')), { greeting: '你好，DSH！' })
})

// 防回归：cordis 对未声明 config schema 的插件调用 apply(ctx)（第二参数为
// undefined）时不得抛 TypeError，且回落到默认语言 en。cfb28c5 的修复此前
// 只改了 lib/index.js 产物、没改 src/index.ts，重新构建即丢失——本用例锁死
// 该契约，避免"源码与产物不同步"再次复发。
test('apply without a config falls back to the default language', () => {
  const { registrations, ctx } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx), 'apply(ctx) without config must not throw')
  const response = createMockResponse()
  registrations[0].handler({ url: '/ts-example/api/greeting?name=DSH', headers: { host: 'localhost:3080' } }, response)
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.chunks.join('')), { greeting: 'Hello, DSH!' })
})

// 防回归：显式传 undefined 与省略参数同义（宿主可能显式传 undefined）。
test('apply with an explicit undefined config falls back to the default language', () => {
  const { registrations, ctx } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx, undefined), 'apply(ctx, undefined) must not throw')
  const response = createMockResponse()
  registrations[0].handler({ url: '/ts-example/api/greeting?name=DSH', headers: { host: 'localhost:3080' } }, response)
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.chunks.join('')), { greeting: 'Hello, DSH!' })
})

test('stats route reports the session count', () => {
  const { registrations, listeners, ctx } = createMockCtx()
  apply(ctx, {})
  listeners['session/start']()
  listeners['session/start']()
  const response = createMockResponse()
  registrations[0].handler({ url: '/ts-example/api/stats', headers: { host: 'localhost:3080' } }, response)
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.chunks.join('')), { sessions: 2 })
})

test('unknown path returns 404', () => {
  const { registrations, ctx } = createMockCtx()
  apply(ctx, {})
  const response = createMockResponse()
  registrations[0].handler({ url: '/ts-example/api/nope', headers: { host: 'localhost:3080' } }, response)
  assert.equal(response.status, 404)
})

test('untrusted host is rejected with 403', () => {
  const { registrations, ctx } = createMockCtx()
  apply(ctx, {})
  const response = createMockResponse()
  registrations[0].handler({ url: '/ts-example/api/greeting', headers: { host: 'evil.example.com' } }, response)
  assert.equal(response.status, 403)
})

test('missing host header is rejected with 403', () => {
  const { registrations, ctx } = createMockCtx()
  apply(ctx, {})
  const response = createMockResponse()
  registrations[0].handler({ url: '/ts-example/api/greeting', headers: {} }, response)
  assert.equal(response.status, 403)
})
