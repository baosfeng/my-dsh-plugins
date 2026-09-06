import { test } from 'vitest'
/**
 * Smoke test for the dsh-my-guardian host half: mounts the plugin against a
 * mocked loader tree + context, then drives staged-file scans, failure
 * isolation, freeze, safe mode, restart recovery and the HTTP API through it.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-my-guardian-test-'))
process.env.DSH_HOME = dir

// Watchdog self-protection: the guardian must never leak an unhandled
// rejection (fail-loud would kill the whole dsh web process).
let unhandledRejections = 0
process.on('unhandledRejection', () => {
  unhandledRejections += 1
})

const stagedFile = () => join(dir, 'cordis.staged.json')
const stateFile = () => join(dir, 'guardian', 'state.json')
const readState = () => JSON.parse(readFileSync(stateFile(), 'utf8'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── helpers ────────────────────────────────────────────────────────────────

/** Fake loader tree: root group with a mutable failure map. */
function makeLoaderAndTree() {
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
  const tree = { filename: join(dir, 'cordis.yml'), store, root }
  return {
    store,
    failMap,
    created,
    removed,
    tree,
    loader: { entries: () => [{ subtree: tree }] },
    apiRoute: undefined,
  }
}

function makeCtx(fake, opts = {}) {
  const services = {
    webServer:
      opts.webServer === false
        ? undefined
        : {
            register: (route) => {
              if (route.kind === 'prefix' && route.path === '/guardian/api') fake.apiRoute = route
              return () => {}
            },
          },
    webRuntime: { trustedHosts: [] },
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
    _handlers: {},
    on(event, handler) {
      ;(this._handlers[event] ??= []).push(handler)
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

function makeRequest(method, url, body) {
  const req = {
    method,
    url,
    headers: {
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:3080',
    },
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

async function callApi(fake, method, path, body) {
  const route = fake.apiRoute
  assert.ok(route, 'api route registered')
  const res = makeResponse()
  await route.handler(makeRequest(method, `/guardian/api/${path}`, body), res)
  return { status: res._status, json: JSON.parse(res._body) }
}

/** Boot a fresh guardian instance against the same fake tree. */
function boot(fake, opts) {
  const ctx = makeCtx(fake, opts)
  apply(ctx)
  return ctx
}

/**
 * Shut a guardian instance down (closes its fs.watch on the staged file —
 * a leftover watcher would react to later tests' staged-file writes and
 * corrupt their state with a stale instance).
 */
async function shutdown(ctx) {
  const teardown = (ctx.fakeEffects ?? []).find((e) => e.label === 'dsh-my-guardian: teardown')
  teardown?.disposer()
  // let the teardown's async unmount + persist chain settle so a later test
  // block's state-file write is not overwritten by this instance's snapshot
  await sleep(60)
}

test('host smoke suite', async () => {
  try {
    // ── 1. staged entry mounts and gets PROMOTED (removed from the file) ────
    {
      const fake = makeLoaderAndTree()
      writeFileSync(stagedFile(), JSON.stringify([{ id: 'nice-plugin', name: 'dsh-nice', config: { a: 1 } }], null, 2))
      const ctx1 = boot(fake)
      await sleep(150)

      const state = readState()
      assert.ok(state.promoted['nice-plugin'], 'entry promoted')
      assert.equal(state.promoted['nice-plugin'].name, 'dsh-nice')
      assert.equal(state.promoted['nice-plugin'].config.a, 1, 'config preserved')
      assert.ok(state.staged['nice-plugin'] === undefined, 'staged record cleared')
      assert.deepEqual(JSON.parse(readFileSync(stagedFile(), 'utf8')), [], 'candidate file emptied (promotion)')
      assert.deepEqual(fake.created, ['nice-plugin'], 'entry mounted once')
      assert.ok(
        state.events.some((e) => e.type === 'promote'),
        'promote event logged',
      )
      await shutdown(ctx1)
    }

    // ── 2. failing entry is quarantined (recorded, not promoted) ────────────
    {
      const fake = makeLoaderAndTree()
      fake.failMap['bad-plugin'] = 'apply exploded'
      writeFileSync(stagedFile(), JSON.stringify([{ id: 'bad-plugin', name: 'dsh-bad' }], null, 2))
      const ctx2 = boot(fake)
      await sleep(100)

      const state = readState()
      assert.ok(state.staged['bad-plugin'], 'entry kept in staged state')
      assert.equal(state.staged['bad-plugin'].attempts, 1, 'attempt recorded')
      assert.ok(state.staged['bad-plugin'].lastError.includes('apply exploded'), 'error recorded')
      assert.equal(state.staged['bad-plugin'].frozen, false, 'not frozen after 1 failure')
      assert.ok(state.promoted['bad-plugin'] === undefined, 'not promoted')
      assert.deepEqual(
        JSON.parse(readFileSync(stagedFile(), 'utf8')),
        [{ id: 'bad-plugin', name: 'dsh-bad' }],
        'candidate file untouched on failure',
      )
      await shutdown(ctx2)
    }

    // ── 3. three failures freeze the entry (accumulated across restarts) ────
    {
      const fake = makeLoaderAndTree()
      fake.failMap['flaky'] = 'nope'
      writeFileSync(stagedFile(), JSON.stringify([{ id: 'flaky', name: 'dsh-flaky' }], null, 2))
      const c3a = boot(fake)
      await sleep(250)
      const c3b = boot(fake)
      await sleep(250)
      const c3c = boot(fake)
      await sleep(250)

      const state = readState()
      assert.equal(state.staged['flaky'].attempts, 3, 'attempts accumulated across restarts')
      assert.equal(state.staged['flaky'].frozen, true, 'frozen after 3 failures')
      // (nice-plugin from block 1 is re-mounted here — restart recovery of the
      // promoted list is correct; the point is flaky itself never mounted)
      assert.ok(!fake.created.includes('flaky'), 'flaky never mounted')
      await shutdown(c3a)
      await shutdown(c3b)
      await shutdown(c3c)
    }

    // ── 4. safe mode skips everything ───────────────────────────────────────
    {
      const fake = makeLoaderAndTree()
      writeFileSync(stagedFile(), JSON.stringify([{ id: 'p1', name: 'dsh-p1' }], null, 2))
      mkdirSync(join(dir, 'guardian'), { recursive: true })
      writeFileSync(
        stateFile(),
        JSON.stringify({ version: 1, safeMode: true, staged: {}, promoted: {}, events: [] }),
        'utf8',
      )
      const ctx4 = boot(fake)
      await sleep(100)

      assert.deepEqual(fake.created, [], 'nothing mounted in safe mode')
      const state = readState()
      assert.equal(state.safeMode, true, 'safe mode persisted')
      assert.ok(
        state.events.some((e) => e.type === 'safe'),
        'safe-mode skip event logged',
      )
      await shutdown(ctx4)
    }

    // ── 5. id conflict is refused ───────────────────────────────────────────
    {
      const fake = makeLoaderAndTree()
      fake.store['occupied'] = { options: {} } // a row already in the tree
      mkdirSync(join(dir, 'guardian'), { recursive: true })
      writeFileSync(
        stateFile(),
        JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
        'utf8',
      )
      writeFileSync(stagedFile(), JSON.stringify([{ id: 'occupied', name: 'dsh-x' }], null, 2))
      const ctx5 = boot(fake)
      await sleep(100)

      const state = readState()
      assert.equal(state.staged['occupied'].attempts, 1, 'conflict recorded as a failure')
      assert.ok(state.staged['occupied'].lastError.includes('already exists'), 'conflict error recorded')
      await shutdown(ctx5)
    }

    // ── 6. retry after fixing the plugin (through the API) ──────────────────
    {
      const fake = makeLoaderAndTree()
      fake.failMap['fixable'] = 'first failure'
      writeFileSync(stagedFile(), JSON.stringify([{ id: 'fixable', name: 'dsh-fixable' }], null, 2))
      const ctx6 = boot(fake)
      await sleep(100)
      assert.ok(readState().staged['fixable'], 'first failure recorded')

      // "fix" the plugin, then retry through the API
      delete fake.failMap['fixable']
      const retry = await callApi(fake, 'POST', 'retry', { id: 'fixable' })
      assert.equal(retry.status, 200)
      assert.equal(retry.json.value.outcome, 'mounted', 'retry mounts the fixed plugin')
      await sleep(120) // let the promotion persist
      assert.ok(readState().promoted['fixable'], 'retried entry promoted')
      await shutdown(ctx6)
    }

    // ── 7. restart recovery: promoted entries remount ───────────────────────
    {
      const fake = makeLoaderAndTree()
      mkdirSync(join(dir, 'guardian'), { recursive: true })
      writeFileSync(
        stateFile(),
        JSON.stringify({
          version: 1,
          safeMode: false,
          staged: {},
          promoted: {
            'old-1': {
              name: 'dsh-old',
              config: undefined,
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
      const ctx7 = boot(fake)
      await sleep(100)
      assert.deepEqual(fake.created, ['old-1'], 'promoted entry remounted after restart')
      await shutdown(ctx7)
    }

    // ── 8. API surface: state / staged / remove / safemode / fence / 404 ────
    {
      const fake = makeLoaderAndTree()
      mkdirSync(join(dir, 'guardian'), { recursive: true })
      writeFileSync(
        stateFile(),
        JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
        'utf8',
      )
      writeFileSync(stagedFile(), JSON.stringify([{ id: 'keep', name: 'dsh-keep' }], null, 2))
      const ctx8 = boot(fake)
      await sleep(100)

      // state
      const stateRes = await callApi(fake, 'GET', 'state')
      assert.equal(stateRes.status, 200)
      assert.equal(stateRes.json.value.safeMode, false)
      assert.equal(stateRes.json.value.promoted[0].id, 'keep', 'promoted listed')

      // add a staged entry through the API
      const add = await callApi(fake, 'POST', 'staged', {
        id: 'via-api',
        name: 'dsh-via',
        config: { k: 'v' },
      })
      assert.equal(add.status, 200)
      assert.equal(
        add.json.value.promoted.some((e) => e.id === 'via-api'),
        true,
        'api-added entry promoted',
      )
      assert.equal(JSON.parse(readFileSync(stagedFile(), 'utf8')).length, 0, 'api entry promoted out of the file')

      // remove a promoted entry (keep stays)
      const rm = await callApi(fake, 'POST', 'remove', { id: 'via-api' })
      assert.equal(rm.status, 200)
      assert.equal(rm.json.value.promoted.length, 1, 'entry removed, keep remains')
      assert.ok(!rm.json.value.promoted.some((e) => e.id === 'via-api'), 'via-api gone')

      // safemode on unmounts the running mount
      const sm = await callApi(fake, 'POST', 'safemode', { enabled: true })
      assert.equal(sm.status, 200)
      assert.equal(sm.json.value.safeMode, true)
      assert.deepEqual(fake.removed, ['via-api', 'keep'], 'all mounted entries unmounted on safe mode')

      // fence: cross-site origin is refused
      const route = fake.apiRoute
      const res = makeResponse()
      await route.handler(
        {
          method: 'GET',
          url: '/guardian/api/state',
          headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' },
          [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true }) }),
        },
        res,
      )
      assert.equal(res._status, 403, 'cross-site request refused')

      // unknown method → 404
      const nf = await callApi(fake, 'GET', 'nope')
      assert.equal(nf.status, 404)
      await shutdown(ctx8)
    }

    // ── 9. teardown unmounts everything the guardian mounted ────────────────
    {
      const fake = makeLoaderAndTree()
      mkdirSync(join(dir, 'guardian'), { recursive: true })
      writeFileSync(
        stateFile(),
        JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
        'utf8',
      )
      writeFileSync(stagedFile(), JSON.stringify([{ id: 'tear', name: 'dsh-tear' }], null, 2))
      const ctx9 = boot(fake)
      await sleep(100)
      const teardown = ctx9.fakeEffects.find((e) => e.label === 'dsh-my-guardian: teardown')
      assert.ok(teardown, 'teardown disposer registered')
      teardown.disposer()
      await sleep(50)
      assert.deepEqual(fake.removed, ['tear'], 'guardian unmounted its entries on teardown')
    }

    // ── 10. webServer appears AFTER the guardian: API registers on the next
    //        poll tick (deferred registration must not be lost to a race) ─────
    {
      const fake = makeLoaderAndTree()
      writeFileSync(stagedFile(), '[]\n')
      const ctx10 = boot(fake, { webServer: false })
      await sleep(100)
      assert.ok(fake.apiRoute === undefined, 'api not registered before webServer appears')
      // the webServer service appears now
      ctx10.fakeServices.webServer = {
        register: (route) => {
          if (route.kind === 'prefix' && route.path === '/guardian/api') fake.apiRoute = route
          return () => {}
        },
      }
      // trigger a poll tick
      for (const callback of ctx10.fakeIntervals) callback()
      await sleep(50)
      assert.ok(fake.apiRoute, 'api registered after webServer appears (poll retry)')
      await shutdown(ctx10)
    }

    // ── 11. a broken loader tree must not make apply throw ──────────────────
    {
      const fake = makeLoaderAndTree()
      fake.loader.entries = () => {
        throw new Error('broken loader tree')
      }
      const ctx11 = makeCtx(fake)
      let threw = false
      try {
        apply(ctx11)
      } catch {
        threw = true
      }
      assert.equal(threw, false, 'apply must not throw on a broken loader tree')
      await shutdown(ctx11)
    }

    // ── 11b. plugin:status-query returns guardian state ──────────────────────
    {
      const fake11b = makeLoaderAndTree()
      const ctx11b = makeCtx(fake11b)
      apply(ctx11b)
      await sleep(60)
      const handlers = ctx11b._handlers['plugin:status-query'] ?? []
      assert.ok(handlers.length > 0, 'status-query handler registered')
      const result = handlers[0]({ plugin: 'dsh-my-guardian' })
      assert.equal(result?.ok, true)
      assert.equal(result?.value?.plugin, 'dsh-my-guardian')
      assert.equal(typeof result?.value?.running, 'boolean')
      // wrong plugin name returns undefined
      assert.equal(handlers[0]({ plugin: 'other' }), undefined)
      await shutdown(ctx11b)
    }

    // ── 12. no unhandled rejection leaked across every scenario above ───────
    assert.equal(unhandledRejections, 0, 'guardian leaked no unhandled rejection')

    console.log('ALL GUARDIAN HOST SMOKE TESTS PASSED')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
