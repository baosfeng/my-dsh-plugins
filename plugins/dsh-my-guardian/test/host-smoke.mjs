import { test } from 'vitest'
/**
 * Smoke test for the dsh-my-guardian host half: mounts the plugin against a
 * mocked loader tree + context, then drives staged-file scans, failure
 * isolation, freeze, safe mode, restart recovery and the HTTP API through it.
 */
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { apply } from '../lib/index.js'

const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-my-guardian-test-' }).name
process.env.DSH_HOME = dir

// Watchdog self-protection: the guardian must never leak an unhandled
// rejection (fail-loud would kill the whole dsh web process).
let unhandledRejections = 0
process.on('unhandledRejection', () => {
  unhandledRejections += 1
})

const stagedFile = () => join(dir, 'cordis.staged.json')
const stateFile = () => join(dir, 'guardian', 'state.json')
/** 确定性就绪信号：apply 返回的 shared 暴露 flushPersist()（等落盘完成）。
 *  persistSoon 经 createWriteScheduler 防抖合并后，"写盘完成时刻"不再紧随变更，
 *  读盘断言必须先 await 它（与 198c 对 task-reliability 的修法同一模式）。 */
let flushPersist = async () => {}

const readStateSync = () => JSON.parse(readFileSync(stateFile(), 'utf8'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 读盘前先推一次落盘（确定性，不靠墙钟）。 */
async function readState() {
  await flushPersist()
  return readStateSync()
}

/** 同步读；尚未写出时返回 undefined（配合 waitFor 做条件轮询）。 */
const readStateOrNull = () => {
  try {
    return readStateSync()
  } catch {
    return undefined
  }
}

/** 轮询等待异步持久化结果**出现**（返回该真值）。
 *
 *  guardian 的状态写入是异步 promise 链，固定 sleep 在慢 CI 上会赌输——
 *  实测：boot 后立即读 state.json 时文件都还不存在（t0=ENOENT，t100 才有）。
 *  见 docs/踩坑/固定sleep等异步落盘导致CI-flaky.md。
 *  仅在「等真实时间语义」或「断言某事没有发生」时才保留 sleep。 */
async function waitFor(check, timeoutMs = 10000, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    // 每轮先推一次落盘：调度器防抖窗口（500ms）内也立即写，条件很快成立，
    // 不必等 500ms × N 次轮询（那会让整套 smoke 超过 testTimeout）。
    await flushPersist()
    if (check()) return
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await sleep(intervalMs)
  }
}

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
  // 路由注册发生在**异步**启动链里（apply → bootPromise → initialScan →
  // scanStaged/mountPromoted → ensureApi），且设计上是「webServer 服务出现后
  // 注册，可重试」（CLI profile 无 webServer 时跳过）。原先这里同步断言
  // fake.apiRoute，等于赌初始扫描先于断言跑完：慢环境（CI 高负载 / 文件 IO
  // 慢）下偶发 `AssertionError: api route registered`（#250 合并后 main 红盘
  // 的形态）。改为**确定性条件等待**（超时报错，不靠 sleep）：既消除 flaky，
  // 又保证「注册最终必须发生」这一语义仍被断言。
  // 仅在尚未注册时才等待（快路径零开销）：原实现每次都 waitFor，其内部的
  // flushPersist + 轮询会给主 suite 叠加开销，CI 上实测因此撞到 5s testTimeout。
  if (fake.apiRoute === undefined) await waitFor(() => fake.apiRoute !== undefined)
  const route = fake.apiRoute
  assert.ok(route, 'api route registered')
  const res = makeResponse()
  await route.handler(makeRequest(method, `/guardian/api/${path}`, body), res)
  return { status: res._status, json: JSON.parse(res._body) }
}

/** Boot a fresh guardian instance against the same fake tree. */
function boot(fake, opts) {
  const ctx = makeCtx(fake, opts)
  const shared = apply(ctx)
  flushPersist = shared?.flushPersist ?? (async () => {})
  return ctx
}

/**
 * Shut a guardian instance down (closes its fs.watch on the staged file —
 * a leftover watcher would react to later tests' staged-file writes and
 * corrupt their state with a stale instance).
 */
async function shutdown(ctx) {
  const teardown = (ctx.fakeEffects ?? []).find((e) => e.label === 'dsh-my-guardian: teardown')
  // disposer 返回「卸载 + 写链 drain」promise：await 它即可确定性等待本实例
  // 全部落盘完成，不必再 sleep 赌它跑完——赌输时旧实例的延迟快照会覆盖
  // 下一个用例块写入的状态（跨实例共享 state.json 的时序竞态）。
  await teardown?.disposer()
}

// 显式超时：本 suite 本地已约 4.5s（CI 更慢），默认 5s 上限会随环境抖动偶发红。
test('host smoke suite', { timeout: 30000 }, async () => {
  try {
    // ── 1. staged entry mounts and gets PROMOTED (removed from the file) ────
    {
      const fake = makeLoaderAndTree()
      writeFileSync(stagedFile(), JSON.stringify([{ id: 'nice-plugin', name: 'dsh-nice', config: { a: 1 } }], null, 2))
      const ctx1 = boot(fake)
      await waitFor(() => readStateOrNull()?.promoted?.['nice-plugin'])

      const state = await readState()
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
      await waitFor(() => readStateOrNull()?.staged?.['bad-plugin'])

      const state = await readState()
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
      // 「跨重启累计失败」是**顺序**语义：重启 = 上一个实例已经关掉。此前三个
      // 实例同时存活并各自 persistSoon 同一份 state.json，谁后落盘谁说了算
      // （#217：shutdown 在下一个实例之前，消除这项并发写竞态）。
      const c3a = boot(fake)
      await waitFor(() => readStateOrNull()?.staged?.['flaky']?.attempts === 1)
      await shutdown(c3a)
      const c3b = boot(fake)
      await waitFor(() => readStateOrNull()?.staged?.['flaky']?.attempts === 2)
      await shutdown(c3b)
      const c3c = boot(fake)
      await waitFor(() => readStateOrNull()?.staged?.['flaky']?.attempts === 3)

      const state = await readState()
      assert.equal(state.staged['flaky'].attempts, 3, 'attempts accumulated across restarts')
      assert.equal(state.staged['flaky'].frozen, true, 'frozen after 3 failures')
      // (nice-plugin from block 1 is re-mounted here — restart recovery of the
      // promoted list is correct; the point is flaky itself never mounted)
      assert.ok(!fake.created.includes('flaky'), 'flaky never mounted')
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
      await waitFor(() => readStateOrNull()?.events?.some((e) => e.type === 'safe'))

      assert.deepEqual(fake.created, [], 'nothing mounted in safe mode')
      const state = await readState()
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
      await waitFor(() => readStateOrNull()?.staged?.['occupied'])

      const state = await readState()
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
      await waitFor(() => readStateOrNull()?.staged?.['fixable'])
      assert.ok((await readState()).staged['fixable'], 'first failure recorded')

      // "fix" the plugin, then retry through the API
      delete fake.failMap['fixable']
      const retry = await callApi(fake, 'POST', 'retry', { id: 'fixable' })
      assert.equal(retry.status, 200)
      assert.equal(retry.json.value.outcome, 'mounted', 'retry mounts the fixed plugin')
      await waitFor(() => readStateOrNull()?.promoted?.['fixable'])
      assert.ok((await readState()).promoted['fixable'], 'retried entry promoted')
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
      await waitFor(() => fake.created.includes('old-1'))
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
      await waitFor(() => fake.created.includes('keep'))

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
      await waitFor(() => fake.created.includes('tear'))
      const teardown = ctx9.fakeEffects.find((e) => e.label === 'dsh-my-guardian: teardown')
      assert.ok(teardown, 'teardown disposer registered')
      await teardown.disposer()
      assert.deepEqual(fake.removed, ['tear'], 'guardian unmounted its entries on teardown')
    }

    // ── 10. webServer appears AFTER the guardian: API registers on the next
    //        poll tick (deferred registration must not be lost to a race) ─────
    {
      const fake = makeLoaderAndTree()
      writeFileSync(stagedFile(), '[]\n')
      const ctx10 = boot(fake, { webServer: false })
      // 负向断言（"未注册"没有正向信号可等）→ 保留观察窗口，等 initial scan 跑完
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
      await waitFor(() => fake.apiRoute)
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
      await waitFor(() => (ctx11b._handlers['plugin:status-query'] ?? []).length > 0)
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

// ── 9. webServer 服务晚到 → poll tick 重试注册（api.js 的尝试/重试语义）──────
// 路由注册是**可选面**：webServer 未出现时不注册、每个轮询 tick 重试（CLI profile
// 无 webServer 时整块跳过）。这条重试路径之前没有测试覆盖——而它正是
// 「api route registered」断言在慢环境下 flaky 的另一面：注册只可能"晚到"，
// 不可能通过等待之外的方式提前。本用例确定性验证「服务晚到 → 重试后必注册」。
test('api route registration retries on poll tick when webServer appears late', async () => {
  const fake = makeLoaderAndTree()
  // 主 suite 结束时清理过临时目录，这里重建（本用例独立运行）
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(stagedFile(), JSON.stringify([], null, 2))
  const ctx = makeCtx(fake, { webServer: false })
  const shared = apply(ctx)
  flushPersist = shared?.flushPersist ?? (async () => {})
  await waitFor(() => shared.ready === true)
  assert.equal(fake.apiRoute, undefined, 'webServer 缺失时不注册（可选面降级）')

  // 服务晚到：补上 webServer，然后触发一次轮询 tick（ensureApi 在 tick 内重试）
  ctx.fakeServices.webServer = {
    register: (route) => {
      if (route.kind === 'prefix' && route.path === '/guardian/api') fake.apiRoute = route
      return () => {}
    },
  }
  for (const tick of ctx.fakeIntervals) await tick()
  await waitFor(() => fake.apiRoute !== undefined)
  assert.ok(fake.apiRoute, 'webServer 出现后经轮询重试完成注册')

  const teardown = (ctx.fakeEffects ?? []).find((e) => e.label === 'dsh-my-guardian: teardown')
  await teardown?.disposer()
})

// ── 10. 顶层 inject 不得声明（issue #242 fatal 形态防回归）──────────────────
// 实测：把 guardian 从隔离 profile 的 disabled 去掉后，cordis 解析顶层
// inject(['loader','timer']) 时若 ctx 已 inactive 会抛
// "cannot get required service \"loader\" in inactive context" → dsh web 启动
// exit 1（apply 内 try/catch 拦不住：错误发生在 apply 之前）。
// 因此依赖改由 apply 内的 ctx.inject([...], cb) 局部等待承载。
test('不声明顶层 inject（声明会在 ctx inactive 时 fatal）', async () => {
  const mod = await import('../lib/index.js')
  assert.deepEqual([...(mod.inject ?? [])], [], '顶层 inject 必须为空数组')
})

test('loader/timer 未就绪时 apply 降级：不抛错、返回 undefined（绝不 fatal）', async () => {
  const fake = makeLoaderAndTree()
  const ctx = makeCtx(fake)
  // 模拟 cordis 局部 inject：依赖不就绪 → 回调不被调用（服务始终不到）
  ctx.inject = () => {}
  const shared = apply(ctx)
  assert.equal(shared, undefined, '服务未就绪 → 降级返回 undefined，而不是抛错')
})

test('loader/timer 就绪时经局部 inject 初始化（声明式依赖保留）', async () => {
  const fake = makeLoaderAndTree()
  const ctx = makeCtx(fake)
  let received = null
  ctx.inject = (names, cb) => {
    received = names
    cb(ctx) // 服务已就绪：cordis 同步回调
  }
  const shared = apply(ctx)
  assert.deepEqual([...(received ?? [])].sort(), ['loader', 'timer'], '局部 inject 声明 loader/timer')
  assert.ok(shared !== undefined, '服务就绪 → 正常初始化')
  const teardown = (ctx.fakeEffects ?? []).find((e) => e.label === 'dsh-my-guardian: teardown')
  await teardown?.disposer()
})
