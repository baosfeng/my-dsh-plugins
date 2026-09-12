/**
 * Edge-path tests for the dsh-file-activity host half: covers the branches
 * the smoke test does not reach — trust-fence rejections, malformed bodies,
 * buffering before state load, recent-only media authorization and teardown.
 */
import { test, afterAll } from 'vitest'
import { settle, waitFileContains } from './lib/settle.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { sessionFromFile } from './state-file.mjs'

const dir = mkdtempSync(join(tmpdir(), 'dfa-edge-test-'))
process.env.DSH_HOME = dir
const statePath = join(dir, 'file-activity.json')

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeResponse() {
  return {
    _status: 0,
    _body: '',
    _headers: {},
    writeHead(status, headers) {
      this._status = status
      this._headers = headers ?? {}
    },
    end(body) {
      this._body = body ?? ''
    },
  }
}

function makeRequest(method, url, body, overrides) {
  const req = {
    method,
    url,
    headers: {
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:3080',
    },
    ...(overrides ?? {}),
    [Symbol.asyncIterator]() {
      const chunks = body === undefined ? [] : [JSON.stringify(body)]
      let i = 0
      return {
        next: () => Promise.resolve(i < chunks.length ? { value: chunks[i++], done: false } : { done: true }),
      }
    },
  }
  return req
}

function captureRoute(prefix) {
  let captured
  const holder = {
    set: (route) => {
      if (route.kind === 'prefix' && route.path === prefix) captured = route
    },
    get: () => captured,
  }
  return holder
}

/** Build a plugin context, run apply, wait for state load, return handles. */
async function boot() {
  const apiHolder = captureRoute('/file-activity/api')
  const mediaHolder = captureRoute('/file-activity/file')
  const ctx = {
    logger: { warn: () => {} },
    webRuntime: { trustedHosts: [] },
    sessions: { get: () => undefined },
    webServer: {
      register: (route) => {
        apiHolder.set(route)
        mediaHolder.set(route)
        return () => {}
      },
    },
    events: [],
    effectCallbacks: [],
    on(name, listener) {
      this.events.push({ name, listener })
    },
    effect(callback, label) {
      this.effectCallbacks.push({ callback, label })
      const disposer = callback()
      if (typeof disposer === 'function') this.effectCallbacks.push({ disposer, label: `${label}:disposer` })
      return disposer
    },
  }
  apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 50))
  return { ctx, getRoute: () => apiHolder.get(), getMediaRoute: () => mediaHolder.get() }
}

async function callRoute(getRoute, method, url, body, overrides) {
  const route = getRoute()
  assert.ok(route, 'route registered')
  const res = makeResponse()
  await route.handler(makeRequest(method, url, body, overrides), res)
  return { status: res._status, json: res._body === '' ? null : JSON.parse(res._body) }
}

test('missing host header is refused by the fence (403)', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s', undefined, {
    headers: {},
  })
  assert.equal(r.status, 403)
  assert.equal(r.json.ok, false, 'body ok flag false')
  assert.equal(r.json.error.code, 'forbidden', 'body error code')
})

test('malformed host header is refused by the fence (403)', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s', undefined, {
    headers: { host: 'not a valid authority' },
  })
  assert.equal(r.status, 403)
  assert.equal(r.json.ok, false, 'body ok flag false')
  assert.equal(r.json.error.code, 'forbidden', 'body error code')
})

test('malformed origin is refused by the fence (403)', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s', undefined, {
    headers: { host: '127.0.0.1:3080', origin: 'http://[' },
  })
  assert.equal(r.status, 403)
  assert.equal(r.json.ok, false, 'body ok flag false')
  assert.equal(r.json.error.code, 'forbidden', 'body error code')
})

test('cross-site requests are refused by the fence (403)', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s', undefined, {
    headers: {
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'cross-site',
      origin: 'http://evil.example',
    },
  })
  assert.equal(r.status, 403)
  assert.equal(r.json.ok, false, 'body ok flag false')
  assert.equal(r.json.error.code, 'forbidden', 'body error code')
})

test('trustedHosts entry without explicit port matches host:port requests', async () => {
  const apiHolder = captureRoute('/file-activity/api')
  const mediaHolder = captureRoute('/file-activity/file')
  const ctx = {
    logger: { warn: () => {} },
    webRuntime: { trustedHosts: ['dsh.example.com'] },
    sessions: { get: () => undefined },
    webServer: {
      register: (route) => {
        apiHolder.set(route)
        mediaHolder.set(route)
        return () => {}
      },
    },
    events: [],
    effectCallbacks: [],
    on() {},
    effect(callback, label) {
      this.effectCallbacks.push({ callback, label })
      const disposer = callback()
      if (typeof disposer === 'function') this.effectCallbacks.push({ disposer, label: `${label}:disposer` })
      return disposer
    },
  }
  apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const r = await callRoute(() => apiHolder.get(), 'GET', '/file-activity/api/stats?sessionId=s', undefined, {
    headers: { host: 'dsh.example.com:3080', origin: 'http://dsh.example.com:3080' },
  })
  assert.equal(r.status, 200, 'trusted host without explicit port is allowed')
  assert.equal(r.json.ok, true, 'body ok flag true')
})

test('malformed JSON body returns 400', async () => {
  const { getRoute } = await boot()
  const res = makeResponse()
  const req = {
    method: 'POST',
    url: '/file-activity/api/record',
    headers: {
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:3080',
    },
    [Symbol.asyncIterator]() {
      const chunks = ['{not json']
      let i = 0
      return {
        next: () => Promise.resolve(i < chunks.length ? { value: chunks[i++], done: false } : { done: true }),
      }
    },
  }
  await getRoute().handler(req, res)
  assert.equal(res._status, 400, 'malformed JSON body rejected')
  const parsed = JSON.parse(res._body)
  assert.equal(parsed.ok, false)
})

test('media route refuses non-GET methods (405)', async () => {
  const { getMediaRoute } = await boot()
  const res = makeResponse()
  await getMediaRoute().handler(makeRequest('POST', '/file-activity/file?sessionId=s&path=/x'), res)
  assert.equal(res._status, 405)
  const parsed = JSON.parse(res._body)
  assert.equal(parsed.ok, false, 'body ok flag false')
  assert.ok(parsed.error.message.includes('method not allowed'), 'method-not-allowed message')
})

test('media route authorizes paths present only in recent history', async () => {
  const { getMediaRoute, ctx } = await boot()
  const mediaFile = join(tmpdir(), `dfa-edge-${Date.now()}.png`)
  writeFileSync(mediaFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  listener(
    { displayPath: mediaFile },
    { kind: 'present' },
    { name: 'read', agent: { id: 'edge-session' }, arguments: {} },
  )
  await settle()
  const res = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', `/file-activity/file?sessionId=edge-session&path=${encodeURIComponent(mediaFile)}`),
    res,
  )
  assert.equal(res._status, 200, 'path present in recent history is served')
})

test('records arriving before state load are buffered and applied', async () => {
  const apiHolder = captureRoute('/file-activity/api')
  const mediaHolder = captureRoute('/file-activity/file')
  const ctx = {
    logger: { warn: () => {} },
    webRuntime: { trustedHosts: [] },
    sessions: { get: () => undefined },
    webServer: {
      register: (route) => {
        apiHolder.set(route)
        mediaHolder.set(route)
        return () => {}
      },
    },
    events: [],
    effectCallbacks: [],
    on(name, listener) {
      this.events.push({ name, listener })
    },
    effect(callback) {
      callback()
      return () => {}
    },
  }
  apply(ctx)
  // Record immediately — before the 50ms async state load completes.
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  listener(
    { displayPath: '/work/buffered.txt' },
    { kind: 'present' },
    { name: 'read', agent: { id: 'edge-session' }, arguments: {} },
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  const r = await callRoute(() => apiHolder.get(), 'GET', '/file-activity/api/stats?sessionId=edge-session')
  assert.equal(r.status, 200)
  assert.equal(r.json.value.counts['/work/buffered.txt'].read, 1, 'buffered record drained after load')
})

test('invalid session ids are ignored by record', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'POST', '/file-activity/api/record', {
    sessionId: '',
    path: '/x',
    op: 'read',
  })
  assert.equal(r.status, 200)
  const stats = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=')
  assert.deepEqual(stats.json.value.counts, {}, 'empty session id creates no state')
})

test('fs/observed falls back to the file_path argument when displayPath is empty', async () => {
  const { ctx, getRoute } = await boot()
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  listener(
    { displayPath: '' },
    { kind: 'present' },
    { name: 'read', agent: { id: 'arg-session' }, arguments: { file_path: '/work/via-args.txt' } },
  )
  await settle()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=arg-session')
  assert.equal(r.json.value.counts['/work/via-args.txt'].read, 1)
})

test('teardown flushes pending persistence', async () => {
  const apiHolder = captureRoute('/file-activity/api')
  const mediaHolder = captureRoute('/file-activity/file')
  const disposers = []
  const ctx = {
    logger: { warn: () => {} },
    webRuntime: { trustedHosts: [] },
    sessions: { get: () => undefined },
    webServer: {
      register: (route) => {
        apiHolder.set(route)
        mediaHolder.set(route)
        return () => {}
      },
    },
    events: [],
    on(name, listener) {
      this.events.push({ name, listener })
    },
    effect(callback) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
  }
  apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  listener(
    { displayPath: '/work/teardown.txt' },
    { kind: 'present' },
    { name: 'read', agent: { id: 'td-session' }, arguments: {} },
  )
  // Run every disposer (teardown) without waiting for the 500ms debounce.
  for (const disposer of disposers) disposer()
  // teardown 的落盘链是异步的（flush → dispose → compact）：轮询文件里出现该记录即返回
  await waitFileContains(statePath, 'teardown.txt')
  const persisted = sessionFromFile(statePath, 'td-session')
  assert.equal(persisted.counts['/work/teardown.txt'].read, 1, 'teardown flushed pending record')
})
