/**
 * Mutation-targeted tests for the dsh-my-guardian host half.
 * Kills surviving mutants by asserting exact response bodies, event-log
 * messages and untested branches (loopback variants, state normalization,
 * entry validation) the smoke/edge tests leave unasserted.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-my-guardian-mutation-'))
process.env.DSH_HOME = dir
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function stagedFile() {
  return join(dir, 'cordis.staged.json')
}

function stateFile() {
  return join(dir, 'guardian', 'state.json')
}

function readState() {
  return JSON.parse(readFileSync(stateFile(), 'utf8'))
}

/** Fake loader tree: root group with a mutable failure map. */
function makeLoaderAndTree(opts = {}) {
  const store = {}
  const failMap = {}
  const created = []
  const removed = []
  const root = {
    create: async (options) => {
      const id = options.id
      if (failMap[id]) throw new Error(failMap[id])
      if (store[id]) throw new Error(`duplicate loader entry id: ${id}`)
      store[id] = { id, options }
      created.push(id)
    },
    remove: async (id) => {
      delete store[id]
      removed.push(id)
    },
  }
  const tree = opts.tree ?? { filename: join(dir, 'cordis.yml'), store, root }
  return {
    store,
    failMap,
    created,
    removed,
    tree,
    loader: { entries: opts.entries ?? (() => [{ subtree: tree }]) },
    apiRoute: undefined,
    events: [],
  }
}

function makeCtx(fake, opts = {}) {
  const services = {
    webServer: {
      register: (route) => {
        if (route.kind === 'prefix' && route.path === '/guardian/api') fake.apiRoute = route
        return () => {}
      },
    },
    webRuntime: { trustedHosts: opts.trustedHosts ?? [] },
  }
  const effects = []
  const intervals = []
  const ctx = {
    logger: { warn: () => {} },
    loader: fake.loader,
    timer: {
      interval: (callback) => {
        intervals.push(callback)
        return () => {}
      },
    },
    get(name) {
      return services[name]
    },
    on(name, listener) {
      fake.events.push({ name, listener })
    },
    effect(callback, label) {
      const disposer = callback()
      effects.push({ label, disposer })
      return disposer
    },
  }
  ctx.fakeEffects = effects
  ctx.fakeIntervals = intervals
  return ctx
}

function makeResponse() {
  return {
    _status: 0,
    _body: '',
    writeHead(status) {
      this._status = status
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

async function callApi(fake, method, path, body, overrides) {
  const route = fake.apiRoute
  assert.ok(route, 'api route registered')
  const res = makeResponse()
  await route.handler(makeRequest(method, `/guardian/api/${path}`, body, overrides), res)
  return { status: res._status, json: res._body === '' ? null : JSON.parse(res._body) }
}

async function boot(fake, opts) {
  const ctx = makeCtx(fake, opts)
  apply(ctx)
  await sleep(150)
  return ctx
}

async function shutdown(ctx) {
  const teardown = (ctx.fakeEffects ?? []).find((e) => e.label === 'dsh-my-guardian: teardown')
  // await disposer（卸载 + 写链 drain）而不是 sleep 赌写盘跑完：赌输时旧实例的
  // 延迟快照会覆盖下一个用例块写入的 state.json（CI flaky 根因）。
  await teardown?.disposer()
}

async function freshState() {
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    stateFile(),
    JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
}

// ── API 响应体精确断言（杀 ObjectLiteral / BooleanLiteral 变异）──────────

test('staged API error responses carry ok=false and a message', async () => {
  const fake = makeLoaderAndTree()
  await freshState()
  fake.store['taken'] = { options: {} }
  const ctx = await boot(fake)

  const missing = await callApi(fake, 'POST', 'staged', { id: '', name: '' })
  assert.equal(missing.status, 400)
  assert.equal(missing.json.ok, false, 'ok false')
  assert.equal(missing.json.error.message, 'id and name are required', 'exact message')

  const conflict = await callApi(fake, 'POST', 'staged', { id: 'taken', name: 'x' })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.json.ok, false, 'ok false')
  assert.ok(conflict.json.error.message.includes('already in use'), 'conflict message')

  const unknown = await callApi(fake, 'GET', 'nope')
  assert.equal(unknown.status, 404)
  assert.equal(unknown.json.ok, false, 'ok false')
  assert.ok(unknown.json.error.message.includes('unknown guardian API'), 'unknown method message')
  await shutdown(ctx)
})

test('fence rejection carries ok=false and the forbidden code', async () => {
  const fake = makeLoaderAndTree()
  await freshState()
  const ctx = await boot(fake)
  const r = await callApi(fake, 'GET', 'state', undefined, {
    headers: { host: 'evil.example.com', 'sec-fetch-site': 'same-origin' },
  })
  assert.equal(r.status, 403)
  assert.equal(r.json.ok, false, 'ok false')
  assert.equal(r.json.error.code, 'forbidden', 'forbidden code')
  await shutdown(ctx)
})

test('retry of an unknown entry carries ok=false and a message', async () => {
  const fake = makeLoaderAndTree()
  await freshState()
  const ctx = await boot(fake)
  const r = await callApi(fake, 'POST', 'retry', { id: 'ghost' })
  assert.equal(r.status, 404)
  assert.equal(r.json.ok, false, 'ok false')
  assert.ok(r.json.error.message.includes('no such entry'), 'no-such-entry message')
  await shutdown(ctx)
})

// ── 事件日志消息（杀 OptionalChaining 变异）──────────────────────────────

test('diagnostic event log messages carry the entry id', async () => {
  const fake = makeLoaderAndTree()
  await freshState()
  const ctx = await boot(fake)
  for (const { name, listener } of fake.events) {
    if (name === 'loader/entry-init') listener({ options: { id: 'evt-1' } })
    if (name === 'loader/partial-dispose') listener({ options: { id: 'evt-2' } })
    // entry-init / dispose 只写内存；update-failed 的 persistSoon 触发落盘
    if (name === 'hmr/config-update-failed') listener('cordis.yml', new Error('boom'))
  }
  await sleep(250)
  const state = readState()
  assert.ok(
    state.events.some((e) => e.type === 'entry-init' && e.message.includes('evt-1')),
    'entry-init message has id',
  )
  assert.ok(
    state.events.some((e) => e.type === 'entry-dispose' && e.message.includes('evt-2')),
    'entry-dispose message has id',
  )
  await shutdown(ctx)
})

// ── loopback 变体（杀 L163 正则/逻辑变异）────────────────────────────────

test('loopback hostname variants pass the fence', async () => {
  const fake = makeLoaderAndTree()
  await freshState()
  const ctx = await boot(fake)
  for (const host of ['localhost:3080', '[::1]:3080', '127.0.0.1:3080', '127.100.0.1:3080']) {
    const r = await callApi(fake, 'GET', 'state', undefined, {
      headers: { host, origin: `http://${host}` },
    })
    assert.equal(r.status, 200, `${host} allowed`)
  }
  // non-loopback dotted host refused
  const r2 = await callApi(fake, 'GET', 'state', undefined, {
    headers: { host: '192.168.1.1:3080', origin: 'http://192.168.1.1:3080' },
  })
  assert.equal(r2.status, 403, 'non-loopback refused')
  await shutdown(ctx)
})

// ── loadState parsed 变体（杀 L81）───────────────────────────────────────

test('corrupt and wrong-shape state files degrade to fresh state', async () => {
  const fake = makeLoaderAndTree()
  // null parsed
  writeFileSync(stateFile(), 'null', 'utf8')
  const ctx1 = await boot(fake)
  await shutdown(ctx1)
  // array parsed
  writeFileSync(stateFile(), '[1,2]', 'utf8')
  const ctx2 = await boot(fake)
  await shutdown(ctx2)
  // wrong version
  writeFileSync(
    stateFile(),
    JSON.stringify({ version: 99, safeMode: true, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
  const ctx3 = await boot(fake)
  await shutdown(ctx3)
  // 全部降级：safeMode 应为 false、无崩溃
  writeFileSync(stateFile(), 'null', 'utf8')
  const ctx4 = await boot(fake)
  const r = await callApi(fake, 'GET', 'state')
  assert.equal(r.status, 200)
  assert.equal(r.json.value.safeMode, false, 'fresh state after corrupt file')
  await shutdown(ctx4)
})

// ── findRootTree 变体（杀 L114/120）──────────────────────────────────────

test('findRootTree tolerates entries without subtrees', async () => {
  const fake = makeLoaderAndTree()
  fake.loader.entries = () => [
    { noSubtree: true },
    { subtree: { filename: join(dir, 'alt.yml'), store: fake.store, root: fake.tree.root } },
  ]
  writeFileSync(join(dir, 'alt.yml'), '', 'utf8')
  writeFileSync(stagedFile(), JSON.stringify([{ id: 'alt2', name: 'dsh-alt2' }], null, 2))
  const ctx = await boot(fake)
  assert.ok(fake.created.includes('alt2'), 'fallback tree still used')
  await shutdown(ctx)
})

test('findRootTree tolerates non-string subtree filenames', async () => {
  const fake = makeLoaderAndTree()
  fake.loader.entries = () => [
    { subtree: { filename: 42, store: fake.store, root: fake.tree.root } },
    { subtree: { filename: join(dir, 'cordis.yml'), store: fake.store, root: fake.tree.root } },
  ]
  writeFileSync(stagedFile(), JSON.stringify([{ id: 'alt3', name: 'dsh-alt3' }], null, 2))
  const ctx = await boot(fake)
  assert.ok(fake.created.includes('alt3'), 'string-filename tree found')
  await shutdown(ctx)
})

// ── state normalize 变体（杀 L409/410）───────────────────────────────────

test('null staged/promoted in the state file are normalized', async () => {
  const fake = makeLoaderAndTree()
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    stateFile(),
    JSON.stringify({ version: 1, safeMode: false, staged: null, promoted: null, events: 'x' }),
    'utf8',
  )
  writeFileSync(stagedFile(), JSON.stringify([{ id: 'norm', name: 'dsh-norm' }], null, 2))
  const ctx = await boot(fake)
  assert.ok(fake.created.includes('norm'), 'entry mounted after normalization')
  const r = await callApi(fake, 'GET', 'state')
  assert.equal(r.status, 200)
  assert.ok(Array.isArray(r.json.value.staged), 'staged list is an array')
  assert.ok(Array.isArray(r.json.value.promoted), 'promoted list is an array')
  await shutdown(ctx)
})

// ── conflictOf / mount 变体 ──────────────────────────────────────────────

test('staged entries without a valid name are skipped silently', async () => {
  const fake = makeLoaderAndTree()
  await freshState()
  writeFileSync(
    stagedFile(),
    JSON.stringify(
      [
        { id: 'noname', name: 42 },
        { id: 'good', name: 'dsh-good' },
      ],
      null,
      2,
    ),
  )
  const ctx = await boot(fake)
  assert.deepEqual(fake.created, ['good'], 'only valid-name entry mounted')
  await shutdown(ctx)
})

test('mount with null config works (config omitted)', async () => {
  const fake = makeLoaderAndTree()
  await freshState()
  writeFileSync(stagedFile(), JSON.stringify([{ id: 'nocfg', name: 'dsh-nocfg', config: null }], null, 2))
  const ctx = await boot(fake)
  assert.ok(fake.created.includes('nocfg'), 'null config accepted')
  const state = readState()
  assert.equal(state.promoted['nocfg'].config, undefined, 'null config not stored')
  await shutdown(ctx)
})

// ── 路由 method 变体（杀 L524 等）────────────────────────────────────────

test('GET on the safemode route is unknown (404)', async () => {
  const fake = makeLoaderAndTree()
  await freshState()
  const ctx = await boot(fake)
  const r = await callApi(fake, 'GET', 'safemode')
  assert.equal(r.status, 404, 'GET safemode unknown')
  await shutdown(ctx)
})

test('staged API rejects a body over the size limit with ok=false', async () => {
  const fake = makeLoaderAndTree()
  await freshState()
  const ctx = await boot(fake)
  const route = fake.apiRoute
  const res = makeResponse()
  const big = 'x'.repeat(1_000_001)
  await route.handler(
    {
      method: 'POST',
      url: '/guardian/api/staged',
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
  await shutdown(ctx)
})
