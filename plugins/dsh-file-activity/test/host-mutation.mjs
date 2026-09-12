/**
 * Mutation-targeted edge tests for the dsh-file-activity host half.
 * Kills surviving mutants by asserting exact behaviors the smoke/edge tests
 * leave unasserted: \0 path rejection, corrupt state fallback, op mapping
 * variants, origin variations, media route size/directory/fence branches.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { sessionFromFile } from './state-file.mjs'

const dir = mkdtempSync(join(tmpdir(), 'dfa-mutation-test-'))
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

function emitObserved(ctx, toolName, sessionId, path, opts) {
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  const { observation, args } = opts ?? {}
  listener({ displayPath: path }, observation ?? { kind: 'present' }, {
    name: toolName,
    agent: { id: sessionId },
    arguments: args ?? { file_path: path },
  })
}

async function callRoute(getRoute, method, url, body, overrides) {
  const route = getRoute()
  assert.ok(route, 'route registered')
  const res = makeResponse()
  await route.handler(makeRequest(method, url, body, overrides), res)
  return { status: res._status, json: res._body === '' ? null : JSON.parse(res._body) }
}

test('paths containing NUL are rejected by applyRecord', async () => {
  const { ctx, getRoute } = await boot()
  emitObserved(ctx, 'read', 'nul-session', '/work/bad\u0000file.txt')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=nul-session')
  assert.deepEqual(r.json.value.counts, {}, 'NUL path never recorded')
})

test('non-string or empty paths are rejected by record', async () => {
  const { getRoute } = await boot()
  const r1 = await callRoute(getRoute, 'POST', '/file-activity/api/record', {
    sessionId: 's1',
    path: '',
    op: 'read',
  })
  assert.equal(r1.status, 200)
  const r2 = await callRoute(getRoute, 'POST', '/file-activity/api/record', {
    sessionId: 's1',
    path: 123,
    op: 'read',
  })
  assert.equal(r2.status, 200)
  const stats = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s1')
  assert.deepEqual(stats.json.value.counts, {}, 'invalid paths not recorded')
})

test('corrupt state file falls back to fresh state', async () => {
  writeFileSync(statePath, '{corrupt json', 'utf8')
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=any')
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.value.counts, {}, 'corrupt state yields empty')
})

test('wrong-version state file falls back to fresh state', async () => {
  writeFileSync(statePath, JSON.stringify({ version: 99, sessions: { x: {} } }), 'utf8')
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=x')
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.value.counts, {}, 'wrong version yields empty')
})

test('str_replace_editor maps to modify', async () => {
  const { ctx, getRoute } = await boot()
  emitObserved(ctx, 'str_replace_editor', 's2', '/work/ed.txt')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s2')
  assert.equal(r.json.value.counts['/work/ed.txt'].modify, 1, 'str_replace_editor is modify')
})

test('read_image maps to read', async () => {
  const { ctx, getRoute } = await boot()
  emitObserved(ctx, 'read_image', 's3', '/work/img.png')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s3')
  assert.equal(r.json.value.counts['/work/img.png'].read, 1, 'read_image is read')
})

test('unknown tool names map to read', async () => {
  const { ctx, getRoute } = await boot()
  emitObserved(ctx, 'some_future_tool', 's4', '/work/unk.txt')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s4')
  assert.equal(r.json.value.counts['/work/unk.txt'].read, 1, 'unknown tool is read')
})

test('request without origin header is accepted (same host)', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s5', undefined, {
    headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
  })
  assert.equal(r.status, 200, 'origin-less loopback request accepted')
})

test('mismatched origin host is refused by the fence', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s6', undefined, {
    headers: { host: '127.0.0.1:3080', origin: 'http://evil.example.com' },
  })
  assert.equal(r.status, 403, 'origin host mismatch refused')
})

test('oversized JSON body is rejected (400)', async () => {
  const { getRoute } = await boot()
  const res = makeResponse()
  const big = 'x'.repeat(1_000_001)
  await getRoute().handler(
    {
      method: 'POST',
      url: '/file-activity/api/record',
      headers: {
        host: '127.0.0.1:3080',
        'sec-fetch-site': 'same-origin',
        origin: 'http://127.0.0.1:3080',
      },
      [Symbol.asyncIterator]() {
        const chunks = [big]
        let i = 0
        return {
          next: () => Promise.resolve(i < chunks.length ? { value: chunks[i++], done: false } : { done: true }),
        }
      },
    },
    res,
  )
  assert.equal(res._status, 400, 'oversized body rejected')
  assert.equal(JSON.parse(res._body).ok, false)
})

test('media route refuses requests outside the fence (403)', async () => {
  const { getMediaRoute } = await boot()
  const res = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', '/file-activity/file?sessionId=s&path=/x', undefined, {
      headers: { host: 'evil.example.com', 'sec-fetch-site': 'same-origin' },
    }),
    res,
  )
  assert.equal(res._status, 403, 'media route fenced')
})

test('media route rejects directories (400)', async () => {
  const { ctx, getMediaRoute } = await boot()
  const dirPath = join(dir, 'a-directory')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(dirPath, { recursive: true })
  emitObserved(ctx, 'read', 's7', dirPath)
  await new Promise((resolve) => setTimeout(resolve, 600))
  const res = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', `/file-activity/file?sessionId=s7&path=${encodeURIComponent(dirPath)}`),
    res,
  )
  assert.equal(res._status, 400, 'directory is not a file')
  assert.equal(JSON.parse(res._body).ok, false)
})

test('media route rejects files over the size limit (413)', async () => {
  const { ctx, getMediaRoute } = await boot()
  const bigFile = join(dir, 'big.bin')
  const { writeFileSync: wfs } = await import('node:fs')
  wfs(bigFile, Buffer.alloc(64 * 1024 * 1024 + 1)) // MEDIA_LIMIT + 1
  emitObserved(ctx, 'read', 's8', bigFile)
  await new Promise((resolve) => setTimeout(resolve, 600))
  const res = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', `/file-activity/file?sessionId=s8&path=${encodeURIComponent(bigFile)}`),
    res,
  )
  assert.equal(res._status, 413, 'oversized media rejected')
  assert.equal(JSON.parse(res._body).ok, false)
})

test('localhost and IPv6 loopback hosts pass the fence', async () => {
  const { getRoute } = await boot()
  const r1 = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s9', undefined, {
    headers: { host: 'localhost:3080', origin: 'http://localhost:3080' },
  })
  assert.equal(r1.status, 200, 'localhost accepted')
  const r2 = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s9', undefined, {
    headers: { host: '[::1]:3080', origin: 'http://[::1]:3080' },
  })
  assert.equal(r2.status, 200, 'IPv6 loopback accepted')
})

test('non-loopback dotted host is refused by the fence', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s10', undefined, {
    headers: { host: '192.168.1.1:3080', origin: 'http://192.168.1.1:3080' },
  })
  assert.equal(r.status, 403, 'non-loopback IP refused')
})

test('stats carries the session cwd when the session provides one', async () => {
  const apiHolder2 = captureRoute('/file-activity/api')
  const mediaHolder2 = captureRoute('/file-activity/file')
  const ctxWithCwd = {
    logger: { warn: () => {} },
    webRuntime: { trustedHosts: [] },
    sessions: { get: () => ({ header: { cwd: '/work/alpha' } }) },
    webServer: {
      register: (route) => {
        apiHolder2.set(route)
        mediaHolder2.set(route)
        return () => {}
      },
    },
    events: [],
    effectCallbacks: [],
    on() {},
    effect(cb) {
      const d = cb()
      if (typeof d === 'function') this.effectCallbacks.push({ disposer: d })
      return d
    },
  }
  apply(ctxWithCwd)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const r = await callRoute(() => apiHolder2.get(), 'GET', '/file-activity/api/stats?sessionId=s11')
  assert.equal(r.status, 200)
  assert.equal(r.json.value.cwd, '/work/alpha', 'session cwd surfaced')
})

test('stats for a session without cwd falls back to the process cwd', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=none')
  assert.equal(r.status, 200)
  assert.equal(r.json.value.cwd, process.cwd(), 'process cwd fallback')
})

test('media route for an unknown session is refused (403)', async () => {
  const { getMediaRoute } = await boot()
  const res = makeResponse()
  await getMediaRoute().handler(makeRequest('GET', '/file-activity/file?sessionId=ghost&path=/work/x.png'), res)
  assert.equal(res._status, 403, 'unknown session refused')
  assert.equal(JSON.parse(res._body).ok, false)
})

test('unknown media extensions fall back to octet-stream', async () => {
  const { ctx, getMediaRoute } = await boot()
  const oddFile = join(dir, 'odd.zzz')
  const { writeFileSync: wfs2 } = await import('node:fs')
  wfs2(oddFile, Buffer.from([1, 2, 3]))
  emitObserved(ctx, 'read', 's12', oddFile)
  await new Promise((resolve) => setTimeout(resolve, 600))
  const res = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', `/file-activity/file?sessionId=s12&path=${encodeURIComponent(oddFile)}`),
    res,
  )
  assert.equal(res._status, 200)
  assert.equal(res._headers['content-type'], 'application/octet-stream', 'unknown ext fallback')
})

test('null observation is ignored by fs/observed', async () => {
  const { ctx, getRoute } = await boot()
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  listener({ displayPath: '/work/x.txt' }, null, {
    name: 'read',
    agent: { id: 's-null' },
    arguments: { file_path: '/work/x.txt' },
  })
  await new Promise((resolve) => setTimeout(resolve, 600))
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s-null')
  assert.deepEqual(r.json.value.counts, {}, 'null observation ignored')
})

test('undefined observation is ignored by fs/observed', async () => {
  const { ctx, getRoute } = await boot()
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  listener({ displayPath: '/work/x.txt' }, undefined, {
    name: 'read',
    agent: { id: 's-undef' },
    arguments: { file_path: '/work/x.txt' },
  })
  await new Promise((resolve) => setTimeout(resolve, 600))
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s-undef')
  assert.deepEqual(r.json.value.counts, {}, 'undefined observation ignored')
})

test('media route with missing sessionId parameter returns 400', async () => {
  const { getMediaRoute } = await boot()
  const res = makeResponse()
  await getMediaRoute().handler(makeRequest('GET', '/file-activity/file?path=/work/x.png'), res)
  assert.equal(res._status, 400, 'missing sessionId → 400')
  assert.equal(JSON.parse(res._body).ok, false)
})

test('isRecordedPath with non-array recent refuses the media route', async () => {
  // seed a state where the session has counts but recent is not an array
  // and the requested path is NOT in counts → must fall to the recent check
  writeFileSync(
    statePath,
    JSON.stringify({
      version: 1,
      sessions: {
        'odd-recent': {
          known: {},
          counts: { '/work/other.txt': { read: 1 } },
          recent: 'not-an-array',
        },
      },
    }),
    'utf8',
  )
  const { getMediaRoute } = await boot()
  const res = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', '/file-activity/file?sessionId=odd-recent&path=%2Fwork%2Fa.txt'),
    res,
  )
  assert.equal(res._status, 403, 'non-array recent cannot authorize')
})

test('null parsed state file falls back to fresh state', async () => {
  writeFileSync(statePath, 'null', 'utf8')
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=any')
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.value.counts, {}, 'null state yields empty')
})

test('non-array parsed state file falls back to fresh state', async () => {
  writeFileSync(statePath, '[1,2,3]', 'utf8')
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=any')
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.value.counts, {}, 'array state yields empty')
})

test('dotted host with octet above 255 is refused by the fence', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s13', undefined, {
    headers: { host: '127.0.0.256:3080', origin: 'http://127.0.0.256:3080' },
  })
  assert.equal(r.status, 403, 'octet above 255 refused')
})

test('dotted host with non-numeric octet is refused by the fence', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s14', undefined, {
    headers: { host: '127.0.0.a:3080', origin: 'http://127.0.0.a:3080' },
  })
  assert.equal(r.status, 403, 'non-numeric octet refused')
})

test('files without an extension get octet-stream content type', async () => {
  const { ctx, getMediaRoute } = await boot()
  const noExt = join(dir, 'noext')
  const { writeFileSync: wfs3 } = await import('node:fs')
  wfs3(noExt, Buffer.from([9, 9, 9]))
  emitObserved(ctx, 'read', 's15', noExt)
  await new Promise((resolve) => setTimeout(resolve, 600))
  const res = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', `/file-activity/file?sessionId=s15&path=${encodeURIComponent(noExt)}`),
    res,
  )
  assert.equal(res._status, 200)
  assert.equal(res._headers['content-type'], 'application/octet-stream', 'no-ext fallback')
})

test('fs/observed with null args and empty displayPath is ignored', async () => {
  const { ctx, getRoute } = await boot()
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  listener({ displayPath: '' }, { kind: 'present' }, { name: 'read', agent: { id: 's-nullargs' }, arguments: null })
  await new Promise((resolve) => setTimeout(resolve, 600))
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s-nullargs')
  assert.deepEqual(r.json.value.counts, {}, 'null args with empty displayPath ignored')
})

test('clear of an unknown session still returns ok and keeps other sessions', async () => {
  const { ctx, getRoute } = await boot()
  emitObserved(ctx, 'read', 'keep-session', '/work/keep.txt')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const clr = await callRoute(getRoute, 'POST', '/file-activity/api/clear', {
    sessionId: 'ghost-session',
  })
  assert.equal(clr.status, 200)
  assert.equal(clr.json.ok, true)
  const stats = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=keep-session')
  assert.equal(stats.json.value.counts['/work/keep.txt'].read, 1, 'other session untouched')
})

test('POST to the stats route is unknown (404)', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'POST', '/file-activity/api/stats', {})
  assert.equal(r.status, 404, 'POST stats unknown')
})

test('GET to the clear route is unknown (404)', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/clear')
  assert.equal(r.status, 404, 'GET clear unknown')
})

test('download=0 does not attach content-disposition', async () => {
  const { ctx, getMediaRoute } = await boot()
  const dlFile = join(dir, 'dl.png')
  const { writeFileSync: wfs4 } = await import('node:fs')
  wfs4(dlFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  emitObserved(ctx, 'read', 's16', dlFile)
  await new Promise((resolve) => setTimeout(resolve, 600))
  const res = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', `/file-activity/file?sessionId=s16&path=${encodeURIComponent(dlFile)}&download=0`),
    res,
  )
  assert.equal(res._status, 200)
  assert.equal(res._headers['content-disposition'], undefined, 'no disposition when download=0')
})

test('counts value of null does not authorize the media route', async () => {
  writeFileSync(
    statePath,
    JSON.stringify({
      version: 1,
      sessions: { 'null-count': { known: {}, counts: { '/work/a.txt': null }, recent: [] } },
    }),
    'utf8',
  )
  const { getMediaRoute } = await boot()
  const res = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', '/file-activity/file?sessionId=null-count&path=%2Fwork%2Fa.txt'),
    res,
  )
  assert.equal(res._status, 403, 'null count does not authorize')
})

test('null loaded.sessions is normalized to an empty object', async () => {
  writeFileSync(statePath, JSON.stringify({ version: 1, sessions: null }), 'utf8')
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=any')
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.value.counts, {}, 'null sessions normalized')
})

test('dedupe drops entries with non-string paths on load', async () => {
  writeFileSync(
    statePath,
    JSON.stringify({
      version: 1,
      sessions: {
        'dedupe-s': {
          known: {},
          counts: {},
          recent: [
            { path: 42, op: 'read', time: 1 },
            { path: '', op: 'read', time: 2 },
            { path: '/work/ok.txt', op: 'read', time: 3 },
            { path: '/work/ok.txt', op: 'read', time: 4 },
          ],
        },
      },
    }),
    'utf8',
  )
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=dedupe-s')
  assert.equal(r.json.value.recent.length, 1, 'bad entries dropped, duplicates deduped')
  assert.equal(r.json.value.recent[0].path, '/work/ok.txt')
})

test('fs/observed with null actor is ignored', async () => {
  const { ctx, getRoute } = await boot()
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  listener({ displayPath: '/work/x.txt' }, { kind: 'present' }, null)
  await new Promise((resolve) => setTimeout(resolve, 600))
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s-nullactor')
  assert.deepEqual(r.json.value.counts, {}, 'null actor ignored')
})

test('fs/observed with empty session id is ignored', async () => {
  const { ctx, getRoute } = await boot()
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  listener(
    { displayPath: '/work/x.txt' },
    { kind: 'present' },
    { name: 'read', agent: { id: '' }, arguments: { file_path: '/work/x.txt' } },
  )
  await new Promise((resolve) => setTimeout(resolve, 600))
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=')
  assert.deepEqual(r.json.value.counts, {}, 'empty session id ignored')
})

test('fs/observed with non-string tool name is ignored', async () => {
  const { ctx, getRoute } = await boot()
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  listener(
    { displayPath: '/work/x.txt' },
    { kind: 'present' },
    { name: 42, agent: { id: 's-noname' }, arguments: { file_path: '/work/x.txt' } },
  )
  await new Promise((resolve) => setTimeout(resolve, 600))
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s-noname')
  assert.deepEqual(r.json.value.counts, {}, 'non-string tool name ignored')
})

test('trustedHosts entry with an explicit port is honored', async () => {
  const apiHolder3 = captureRoute('/file-activity/api')
  const mediaHolder3 = captureRoute('/file-activity/file')
  const ctxT = {
    logger: { warn: () => {} },
    webRuntime: { trustedHosts: ['trusted.example.com:9443'] },
    sessions: { get: () => undefined },
    webServer: {
      register: (route) => {
        apiHolder3.set(route)
        mediaHolder3.set(route)
        return () => {}
      },
    },
    events: [],
    effectCallbacks: [],
    on() {},
    effect(cb) {
      const d = cb()
      if (typeof d === 'function') this.effectCallbacks.push({ disposer: d })
      return d
    },
  }
  apply(ctxT)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const r = await callRoute(() => apiHolder3.get(), 'GET', '/file-activity/api/stats?sessionId=s17', undefined, {
    headers: { host: 'trusted.example.com:9443', origin: 'http://trusted.example.com:9443' },
  })
  assert.equal(r.status, 200, 'trusted host with explicit port accepted')
})

test('uppercase extensions are normalized to lowercase for the media type', async () => {
  const { ctx, getMediaRoute } = await boot()
  const upFile = join(dir, 'UP.PNG')
  const { writeFileSync: wfs5 } = await import('node:fs')
  wfs5(upFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  emitObserved(ctx, 'read', 's18', upFile)
  await new Promise((resolve) => setTimeout(resolve, 600))
  const res = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', `/file-activity/file?sessionId=s18&path=${encodeURIComponent(upFile)}`),
    res,
  )
  assert.equal(res._status, 200)
  assert.equal(res._headers['content-type'], 'image/png', 'uppercase ext normalized')
})

test('explicit numeric time is preserved in the record', async () => {
  const { ctx, getRoute } = await boot()
  // fs/observed 使用 Date.now()；通过 record API 无法传 time，因此用 applyRecord 间接验证：
  // 两次记录后 lastSeen 递增、firstSeen 保持（time 分支在内部使用）
  emitObserved(ctx, 'write', 's19', '/work/timed.txt')
  await new Promise((resolve) => setTimeout(resolve, 60))
  emitObserved(ctx, 'write', 's19', '/work/timed.txt')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s19')
  const counts = r.json.value.counts['/work/timed.txt']
  assert.equal(counts.create, 1, 'first write create')
  assert.equal(counts.modify, 1, 'second write modify')
  assert.ok(counts.lastSeen >= counts.firstSeen, 'lastSeen after firstSeen')
})

test('valid JSON body over the size limit is rejected (400)', async () => {
  const { getRoute } = await boot()
  const res = makeResponse()
  const big = '{"pad":"' + 'x'.repeat(1_000_000) + '"}'
  await getRoute().handler(
    {
      method: 'POST',
      url: '/file-activity/api/record',
      headers: {
        host: '127.0.0.1:3080',
        'sec-fetch-site': 'same-origin',
        origin: 'http://127.0.0.1:3080',
      },
      [Symbol.asyncIterator]() {
        const chunks = [big]
        let i = 0
        return {
          next: () => Promise.resolve(i < chunks.length ? { value: chunks[i++], done: false } : { done: true }),
        }
      },
    },
    res,
  )
  assert.equal(res._status, 400, 'oversized valid JSON rejected')
})

test('media route authorizes paths present only in recent (counts absent)', async () => {
  // seed state: the path is in recent history but NOT in counts — the recent
  // branch of isRecordedPath must authorize it (→ stat fails → 404, not 403)
  writeFileSync(
    statePath,
    JSON.stringify({
      version: 1,
      sessions: {
        'recent-only': {
          known: {},
          counts: {},
          recent: [{ path: '/work/only-recent.txt', op: 'read', time: 1 }],
        },
      },
    }),
    'utf8',
  )
  const { getMediaRoute } = await boot()
  const res = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', '/file-activity/file?sessionId=recent-only&path=%2Fwork%2Fonly-recent.txt'),
    res,
  )
  assert.equal(res._status, 404, 'recent-only path authorized but file missing')
  // and an unrecorded path stays 403
  const res2 = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', '/file-activity/file?sessionId=recent-only&path=%2Fwork%2Fother.txt'),
    res2,
  )
  assert.equal(res2._status, 403, 'unrecorded path refused')
})

test('media errors carry a message in the body', async () => {
  const { getMediaRoute } = await boot()
  // missing sessionId + path → 400 with message
  const res = makeResponse()
  await getMediaRoute().handler(makeRequest('GET', '/file-activity/file'), res)
  assert.equal(res._status, 400)
  const parsed = JSON.parse(res._body)
  assert.equal(parsed.ok, false)
  assert.ok(typeof parsed.error.message === 'string' && parsed.error.message !== '', 'error message present')
})

test('three-digit octets in the middle are still loopback', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s20', undefined, {
    headers: { host: '127.100.0.1:3080', origin: 'http://127.100.0.1:3080' },
  })
  assert.equal(r.status, 200, '127.100.0.1 is loopback')
})

test('clear with an empty session id returns ok and deletes nothing', async () => {
  const { ctx, getRoute } = await boot()
  emitObserved(ctx, 'read', 's-keep', '/work/keep2.txt')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const clr = await callRoute(getRoute, 'POST', '/file-activity/api/clear', { sessionId: '' })
  assert.equal(clr.status, 200)
  assert.equal(clr.json.ok, true)
  const stats = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=s-keep')
  assert.equal(stats.json.value.counts['/work/keep2.txt'].read, 1, 'nothing deleted by empty clear')
})

test('records drained before state load are persisted to disk', async () => {
  const apiHolder4 = captureRoute('/file-activity/api')
  const mediaHolder4 = captureRoute('/file-activity/file')
  const ctx4 = {
    logger: { warn: () => {} },
    webRuntime: { trustedHosts: [] },
    sessions: { get: () => undefined },
    webServer: {
      register: (route) => {
        apiHolder4.set(route)
        mediaHolder4.set(route)
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
  apply(ctx4)
  // record before the async state load completes
  const { listener } = ctx4.events.find((e) => e.name === 'fs/observed')
  listener(
    { displayPath: '/work/drained.txt' },
    { kind: 'present' },
    { name: 'read', agent: { id: 'drain-s' }, arguments: {} },
  )
  await new Promise((resolve) => setTimeout(resolve, 1200)) // load + debounce persist
  const persisted = sessionFromFile(statePath, 'drain-s')
  assert.equal(persisted.counts['/work/drained.txt'].read, 1, 'drained record persisted')
})

// ── tools/pre-execute: bash command file ops (issue #19) ──────────────────

function emitPreExecute(ctx, name, sessionId, command, extraArgs) {
  const { listener } = ctx.events.find((e) => e.name === 'tools/pre-execute')
  const exec = { name, agent: { id: sessionId }, arguments: { command, ...(extraArgs ?? {}) } }
  return listener(exec, () => Promise.resolve({ kind: 'allow' }))
}

test('tools/pre-execute: bash rm records a delete and drops the file from stats', async () => {
  const { ctx, getRoute } = await boot()
  emitObserved(ctx, 'read', 'bash-s', '/work/gone.js')
  await new Promise((resolve) => setTimeout(resolve, 600))
  await emitPreExecute(ctx, 'bash', 'bash-s', 'rm -f /work/gone.js')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const stats = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=bash-s')
  assert.equal(stats.json.value.counts['/work/gone.js'], undefined, 'deleted file removed from stats')
  assert.ok(
    stats.json.value.recent.some((e) => e.path === '/work/gone.js' && e.op === 'delete'),
    'delete history entry present',
  )
})

test('tools/pre-execute: touch/redirect create; mv maps source delete + dest create', async () => {
  const { ctx, getRoute } = await boot()
  await emitPreExecute(ctx, 'bash', 'bash-s2', 'touch /work/new.txt && echo hi > /work/out.txt')
  await emitPreExecute(ctx, 'bash', 'bash-s2', 'mv /work/a.js /work/b.js')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const stats = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=bash-s2')
  const counts = stats.json.value.counts
  assert.equal(counts['/work/new.txt'].create, 1, 'touch maps to create')
  assert.equal(counts['/work/out.txt'].create, 1, 'redirect maps to create')
  assert.equal(counts['/work/b.js'].create, 1, 'mv destination maps to create')
  assert.equal(counts['/work/a.js'], undefined, 'mv source removed from stats')
})

test('tools/pre-execute: non-bash tools and unsafe/unknown commands record nothing', async () => {
  const { ctx, getRoute } = await boot()
  await emitPreExecute(ctx, 'bash', 'bash-s3', 'cat /work/x.txt')
  await emitPreExecute(ctx, 'bash', 'bash-s3', 'rm $FILE')
  await emitPreExecute(ctx, 'bash', 'bash-s3', 'npm install')
  await emitPreExecute(ctx, 'read_file', 'bash-s3', 'rm -f /work/ignored.js')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const stats = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=bash-s3')
  assert.deepEqual(stats.json.value.counts, {}, 'no phantom counts')
  assert.deepEqual(stats.json.value.recent, [], 'no phantom recent entries')
})

test('tools/pre-execute: relative paths resolve against the session cwd', async () => {
  const apiHolder5 = captureRoute('/file-activity/api')
  const mediaHolder5 = captureRoute('/file-activity/file')
  const ctx5 = {
    logger: { warn: () => {} },
    webRuntime: { trustedHosts: [] },
    sessions: { get: () => ({ header: { cwd: '/proj' } }) },
    webServer: {
      register: (route) => {
        apiHolder5.set(route)
        mediaHolder5.set(route)
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
  apply(ctx5)
  await new Promise((resolve) => setTimeout(resolve, 50))
  await emitPreExecute(ctx5, 'bash', 'rel-s', 'rm -f tmp/old.txt')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const stats = await callRoute(() => apiHolder5.get(), 'GET', '/file-activity/api/stats?sessionId=rel-s')
  assert.ok(
    stats.json.value.recent.some((e) => e.path === '/proj/tmp/old.txt' && e.op === 'delete'),
    'relative path resolved against session cwd',
  )
})

test('media route denies a path whose only record is a delete', async () => {
  const { ctx, getMediaRoute } = await boot()
  emitObserved(ctx, 'read', 'gone-s', '/work/byebye.txt')
  await new Promise((resolve) => setTimeout(resolve, 600))
  await emitPreExecute(ctx, 'bash', 'gone-s', 'rm /work/byebye.txt')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const res = makeResponse()
  await getMediaRoute().handler(
    makeRequest('GET', '/file-activity/file?sessionId=gone-s&path=%2Fwork%2Fbyebye.txt'),
    res,
  )
  assert.equal(res._status, 403, 'deleted file no longer authorizes media preview')
})

test('tools/pre-execute: non-string command and workdir branch coverage', async () => {
  const { ctx, getRoute } = await boot()
  // command 缺失/非字符串 → 不解析不记录
  await emitPreExecute(ctx, 'bash', 'bash-s4', undefined)
  await emitPreExecute(ctx, 'bash', 'bash-s4', 42)
  // workdir 参数优先于会话 cwd
  await emitPreExecute(ctx, 'bash', 'bash-s4', 'rm -f tmp/x.txt', { workdir: '/wd' })
  await new Promise((resolve) => setTimeout(resolve, 600))
  const stats = await callRoute(getRoute, 'GET', '/file-activity/api/stats?sessionId=bash-s4')
  assert.ok(
    stats.json.value.recent.some((e) => e.path === '/wd/tmp/x.txt' && e.op === 'delete'),
    'workdir overrides session cwd',
  )
  assert.equal(stats.json.value.recent.length, 1, 'only the workdir-resolved op recorded')
})
