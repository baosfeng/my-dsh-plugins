/**
 * Edge-path tests for the dsh-my-guardian host half: covers branches the smoke
 * test does not reach — loader-tree fallback, trust-fence variants, watcher
 * degradation, diagnostic events, API error paths, safe-mode unlock and
 * promoted-entry retry.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-my-guardian-edge-'))
process.env.DSH_HOME = dir
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询等待条件成立（guardian 持久化是异步 promise 链，固定 sleep 在慢 CI 上不稳定，曾致偶发失败）。 */
async function waitFor(check, timeoutMs = 10000, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (check()) return
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await sleep(intervalMs)
  }
}

/** 读取当前持久化的 state.json；文件尚未写入时返回 null。 */
function readStateOrNull() {
  try {
    return JSON.parse(readFileSync(join(dir, 'guardian', 'state.json'), 'utf8'))
  } catch {
    return null
  }
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

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
      if (opts.removeThrows) throw new Error('tree already gone')
      delete store[id]
      removed.push(id)
    },
  }
  const tree = { filename: opts.filename ?? join(dir, 'cordis.yml'), store, root }
  return {
    store,
    failMap,
    created,
    removed,
    tree,
    loader: { entries: () => [{ subtree: tree }] },
    apiRoute: undefined,
    events: [],
  }
}

function makeCtx(fake, opts = {}) {
  const services = {
    webServer:
      opts.webServer === false
        ? undefined
        : {
            register: (route) => {
              if (opts.registerThrows) throw new Error('register exploded')
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
  ctx.fakeServices = services
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

function boot(fake, opts) {
  const ctx = makeCtx(fake, opts)
  apply(ctx)
  return ctx
}

async function shutdown(ctx) {
  const teardown = (ctx.fakeEffects ?? []).find((e) => e.label === 'dsh-my-guardian: teardown')
  // disposer 返回「卸载 + 写链 drain」promise：await 它即可确定性等待本实例
  // 全部落盘完成——此前 sleep(60) 是在赌写盘跑完，赌输时旧实例的延迟快照会
  // 覆盖下一个用例块写入的 state.json（CI 实测 retry 变 404）。
  await teardown?.disposer()
}

test('findRootTree falls back to the first include-like tree without cordis.yml', async () => {
  const fake = makeLoaderAndTree({ filename: join(dir, 'alt', 'profile.yml') })
  mkdirSync(join(dir, 'alt'), { recursive: true })
  writeFileSync(
    join(dir, 'alt', 'cordis.staged.json'),
    JSON.stringify([{ id: 'alt-plugin', name: 'dsh-alt' }], null, 2),
  )
  const ctx = boot(fake)
  await waitFor(() => fake.created.includes('alt-plugin'))
  assert.deepEqual(fake.created, ['alt-plugin'], 'entry mounted via the fallback tree')
  await shutdown(ctx)
})

test('malformed host header is refused by the fence (403)', async () => {
  const fake = makeLoaderAndTree()
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    join(dir, 'guardian', 'state.json'),
    JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
  const ctx = boot(fake)
  await waitFor(() => fake.apiRoute)
  const r = await callApi(fake, 'GET', 'state', undefined, {
    headers: { host: 'not a valid authority' },
  })
  assert.equal(r.status, 403)
  await shutdown(ctx)
})

test('malformed origin is refused by the fence (403)', async () => {
  const fake = makeLoaderAndTree()
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    join(dir, 'guardian', 'state.json'),
    JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
  const ctx = boot(fake)
  await waitFor(() => fake.apiRoute)
  const r = await callApi(fake, 'GET', 'state', undefined, {
    headers: { host: '127.0.0.1:3080', origin: 'http://[' },
  })
  assert.equal(r.status, 403)
  await shutdown(ctx)
})

test('trustedHosts entry without explicit port is honored', async () => {
  const fake = makeLoaderAndTree()
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    join(dir, 'guardian', 'state.json'),
    JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
  const ctx = boot(fake, { trustedHosts: ['guardian.example.com'] })
  await waitFor(() => fake.apiRoute)
  const r = await callApi(fake, 'GET', 'state', undefined, {
    headers: { host: 'guardian.example.com:3080', origin: 'http://guardian.example.com:3080' },
  })
  assert.equal(r.status, 200, 'trusted host without port accepted')
  await shutdown(ctx)
})

test('corrupt staged file is treated as empty', async () => {
  const fake = makeLoaderAndTree()
  writeFileSync(join(dir, 'cordis.staged.json'), '{not json', 'utf8')
  const ctx = boot(fake)
  // 负向断言（"没有被挂载"没有正向信号可等）→ 保留观察窗口
  await sleep(120)
  assert.deepEqual(fake.created, [], 'no entries from a corrupt staged file')
  await shutdown(ctx)
})

test('unmount failures are swallowed (best effort)', async () => {
  const fake = makeLoaderAndTree({ removeThrows: true })
  writeFileSync(join(dir, 'cordis.staged.json'), JSON.stringify([{ id: 'u1', name: 'dsh-u1' }], null, 2))
  const ctx = boot(fake)
  await waitFor(() => fake.created.includes('u1'))
  assert.deepEqual(fake.created, ['u1'], 'entry mounted')
  await shutdown(ctx) // teardown unmount throws → must be swallowed
})

test('promoted entries are skipped in safe mode', async () => {
  const fake = makeLoaderAndTree()
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    join(dir, 'guardian', 'state.json'),
    JSON.stringify({
      version: 1,
      safeMode: true,
      staged: {},
      promoted: {
        'old-p': {
          name: 'dsh-p',
          attempts: 0,
          lastError: null,
          lastFailedAt: null,
          frozen: false,
          promotedAt: 1,
        },
      },
      events: [],
    }),
    'utf8',
  )
  const ctx = boot(fake)
  await waitFor(() => fake.apiRoute)
  assert.deepEqual(fake.created, [], 'promoted entries skipped in safe mode')
  await shutdown(ctx)
})

test('watcher degradation when the staged file cannot be watched', async () => {
  // staged file does not exist → fs.watch throws → guardian degrades to poll
  const fake = makeLoaderAndTree()
  const ctx = boot(fake)
  await waitFor(() => fake.apiRoute)
  assert.ok(fake.apiRoute, 'guardian still serves its API without a watcher')
  await shutdown(ctx)
})

test('diagnostic events are recorded (entry-init / dispose / update-failed)', async () => {
  const fake = makeLoaderAndTree()
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    join(dir, 'guardian', 'state.json'),
    JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
  const ctx = boot(fake)
  await waitFor(() => fake.apiRoute)
  for (const { name, listener } of fake.events) {
    if (name === 'loader/entry-init') listener({ options: { id: 'e1' } })
    if (name === 'loader/partial-dispose') listener({ options: { id: 'e2' } })
    if (name === 'hmr/config-update-failed') listener('cordis.yml', new Error('boom'))
  }
  await waitFor(() => {
    const s = readStateOrNull()
    return (
      s !== null &&
      s.events.some((e) => e.type === 'entry-init') &&
      s.events.some((e) => e.type === 'entry-dispose') &&
      s.events.some((e) => e.type === 'update-failed')
    )
  })
  const state = JSON.parse(readFileSync(join(dir, 'guardian', 'state.json'), 'utf8'))
  assert.ok(
    state.events.some((e) => e.type === 'entry-init'),
    'entry-init logged',
  )
  assert.ok(
    state.events.some((e) => e.type === 'entry-dispose'),
    'entry-dispose logged',
  )
  assert.ok(
    state.events.some((e) => e.type === 'update-failed'),
    'update-failed logged',
  )
  await shutdown(ctx)
})

test('staged API rejects missing id/name (400) and conflicts (409)', async () => {
  const fake = makeLoaderAndTree()
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    join(dir, 'guardian', 'state.json'),
    JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
  fake.store['taken'] = { options: {} }
  fake.failMap['dup'] = 'stays staged' // a failed entry REMAINS in the staged file
  writeFileSync(join(dir, 'cordis.staged.json'), JSON.stringify([{ id: 'dup', name: 'dsh-dup' }], null, 2))
  const ctx = boot(fake)
  // 等待 initialScan 完成（dup 处理失败后进入 state.staged），避免慢 CI 上
  // 时序竞态导致重复 id 冲突检测未生效（曾偶发 200 而非 409）
  await waitFor(() => {
    const s = readStateOrNull()
    return s !== null && s.staged !== undefined && s.staged.dup !== undefined
  })

  const missing = await callApi(fake, 'POST', 'staged', { id: '', name: '' })
  assert.equal(missing.status, 400, 'missing id/name → 400')

  const conflict = await callApi(fake, 'POST', 'staged', { id: 'taken', name: 'dsh-taken' })
  assert.equal(conflict.status, 409, 'id clash with loader row → 409')

  const dup = await callApi(fake, 'POST', 'staged', { id: 'dup', name: 'dsh-dup2' })
  assert.equal(dup.status, 409, 'id already in staged file → 409')
  await shutdown(ctx)
})

test('retry of an unknown entry returns 404', async () => {
  const fake = makeLoaderAndTree()
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    join(dir, 'guardian', 'state.json'),
    JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
  const ctx = boot(fake)
  await waitFor(() => fake.apiRoute)
  const r = await callApi(fake, 'POST', 'retry', { id: 'nope' })
  assert.equal(r.status, 404, 'unknown retry → 404')
  await shutdown(ctx)
})

test('retry of a promoted entry remounts it', async () => {
  const fake = makeLoaderAndTree()
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    join(dir, 'guardian', 'state.json'),
    JSON.stringify({
      version: 1,
      safeMode: false,
      staged: {},
      promoted: {
        'retry-p': {
          name: 'dsh-rp',
          attempts: 1,
          lastError: 'x',
          lastFailedAt: 1,
          frozen: false,
          promotedAt: 1,
        },
      },
      events: [],
    }),
    'utf8',
  )
  const ctx = boot(fake)
  await waitFor(() => fake.apiRoute)
  const r = await callApi(fake, 'POST', 'retry', { id: 'retry-p' })
  assert.equal(r.status, 200)
  assert.equal(r.json.value.outcome, 'mounted', 'promoted retry remounts')
  assert.ok(fake.created.includes('retry-p'))
  await shutdown(ctx)
})

test('safe-mode unlock re-scans staged and remounts promoted', async () => {
  const fake = makeLoaderAndTree()
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    join(dir, 'guardian', 'state.json'),
    JSON.stringify({
      version: 1,
      safeMode: true,
      staged: {},
      promoted: {
        'unlock-p': {
          name: 'dsh-up',
          attempts: 0,
          lastError: null,
          lastFailedAt: null,
          frozen: false,
          promotedAt: 1,
        },
      },
      events: [],
    }),
    'utf8',
  )
  writeFileSync(join(dir, 'cordis.staged.json'), JSON.stringify([{ id: 'unlock-s', name: 'dsh-us' }], null, 2))
  const ctx = boot(fake)
  await waitFor(() => fake.apiRoute)
  assert.deepEqual(fake.created, [], 'safe mode blocks both initially')

  const off = await callApi(fake, 'POST', 'safemode', { enabled: false })
  assert.equal(off.status, 200)
  await waitFor(() => fake.created.includes('unlock-s') && fake.created.includes('unlock-p'))
  assert.ok(fake.created.includes('unlock-s'), 'staged entry mounted after unlock')
  assert.ok(fake.created.includes('unlock-p'), 'promoted entry mounted after unlock')
  await shutdown(ctx)
})

test('malformed JSON body returns 400', async () => {
  const fake = makeLoaderAndTree()
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    join(dir, 'guardian', 'state.json'),
    JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
  const ctx = boot(fake)
  await waitFor(() => fake.apiRoute)
  const route = fake.apiRoute
  const res = makeResponse()
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
        const chunks = ['{bad json']
        let i = 0
        return {
          next: () => Promise.resolve(i < chunks.length ? { value: chunks[i++], done: false } : { done: true }),
        }
      },
    },
    res,
  )
  assert.equal(res._status, 400, 'malformed JSON body rejected')
  await shutdown(ctx)
})

test('api registration failure retries on the next poll tick', async () => {
  const fake = makeLoaderAndTree()
  writeFileSync(join(dir, 'cordis.staged.json'), '[]\n')
  const ctx = boot(fake, { registerThrows: true })
  // 负向断言（注册失败后 apiRoute 必须保持 undefined）→ 保留观察窗口，等 initialScan 跑完
  await sleep(120)
  assert.ok(fake.apiRoute === undefined, 'failed registration leaves apiRegistered false')
  // fix the service, then trigger a poll tick
  ctx.fakeServices.webServer = {
    register: (route) => {
      if (route.kind === 'prefix' && route.path === '/guardian/api') fake.apiRoute = route
      return () => {}
    },
  }
  for (const callback of ctx.fakeIntervals) callback()
  await waitFor(() => fake.apiRoute)
  assert.ok(fake.apiRoute, 'api registered on the retry tick')
  await shutdown(ctx)
})

test('snapshot lists staged records with status', async () => {
  const fake = makeLoaderAndTree()
  fake.failMap['bad2'] = 'boom'
  writeFileSync(join(dir, 'cordis.staged.json'), JSON.stringify([{ id: 'bad2', name: 'dsh-bad2' }], null, 2))
  const ctx = boot(fake)
  await waitFor(() => fake.apiRoute)
  const r = await callApi(fake, 'GET', 'state')
  assert.equal(r.status, 200)
  const staged = r.json.value.staged.find((e) => e.id === 'bad2')
  assert.ok(staged, 'staged record listed in snapshot')
  assert.equal(staged.status, 'failed', 'staged failure status surfaced')
  await shutdown(ctx)
})

test('malformed staged entries (null / missing id / missing name) are ignored', async () => {
  const fake = makeLoaderAndTree()
  writeFileSync(
    join(dir, 'cordis.staged.json'),
    JSON.stringify([null, 42, { name: 'dsh-no-id' }, { id: 'no-name' }, { id: 'good', name: 'dsh-good' }], null, 2),
  )
  const ctx = boot(fake)
  await waitFor(() => fake.created.includes('good'))
  assert.deepEqual(fake.created, ['good'], 'only the well-formed entry is mounted')
  await shutdown(ctx)
})

test('retry of a staged entry missing from the staged file returns missing', async () => {
  const fake = makeLoaderAndTree()
  fake.failMap['gone'] = 'failed once'
  writeFileSync(join(dir, 'cordis.staged.json'), JSON.stringify([{ id: 'gone', name: 'dsh-gone' }], null, 2))
  const ctx = boot(fake)
  await waitFor(() => readStateOrNull()?.staged?.['gone'])
  assert.ok(JSON.parse(readFileSync(join(dir, 'guardian', 'state.json'), 'utf8')).staged['gone'], 'failure recorded')
  // the entry disappears from the staged file (e.g. removed manually)
  writeFileSync(join(dir, 'cordis.staged.json'), '[]\n')
  const r = await callApi(fake, 'POST', 'retry', { id: 'gone' })
  assert.equal(r.status, 200)
  assert.equal(r.json.value.outcome, 'missing', 'staged retry without file entry → missing')
  await shutdown(ctx)
})

test('request body over the size limit is rejected (400)', async () => {
  const fake = makeLoaderAndTree()
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    join(dir, 'guardian', 'state.json'),
    JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
  const ctx = boot(fake)
  await waitFor(() => fake.apiRoute)
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
  await shutdown(ctx)
})
