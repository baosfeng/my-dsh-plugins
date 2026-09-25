import { test, vi, afterAll } from 'vitest'
/**
 * 启动就绪契约（issue #217 —— 残留时序 flaky 的防回归）。
 *
 * #189 给 guardian 补了三个确定性信号：bootPromise（initialScan）、
 * flushPersist（写链 drain）、async teardown disposer。但 `runStartupCheck`
 * 是 scheduleInitialScan 里 fire-and-forget 的**独立异步链**，三者都没覆盖它：
 *   1. bootPromise 只等 initialScan → API 可能在预检完成前返回空 startupIssues；
 *   2. teardown 只 drain「已排队的写」→ 预检的 persistSoon 可能晚于 teardown
 *      返回才入链，把旧实例快照覆盖到下一个实例已写好的 state.json 上。
 *
 * 本文件的断言全部不依赖墙钟：#1/#2 只看 await 边界上的确定事实，#3 用
 * 受控 gate 把「预检慢于 API 分派」变成确定性时序（注入而非造负载）。
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'

/** 受控慢 IO：只挂起 startup-issues.json 的写入（其余 IO 直通真实实现）。 */
const gate = vi.hoisted(() => {
  const g = { active: false, release: () => {}, promise: Promise.resolve() }
  g.reset = () => {
    g.promise = new Promise((resolve) => {
      g.release = resolve
    })
  }
  g.reset()
  return g
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    writeFile: async (file, ...rest) => {
      if (gate.active && String(file).includes('startup-issues.json')) await gate.promise
      return actual.writeFile(file, ...rest)
    },
  }
})

const { apply } = await import('../lib/index.js')

/** issue #402：等待 initialScan（fire-and-forget 的真实 IO 链）的**墙钟**上限。 */
const API_READY_TIMEOUT_MS = 5000

/** 临时 DSH_HOME 收集；配对清理见文件末尾 afterAll。 */
const tmpDirs = []
const root = dirSync({ unsafeCleanup: true, prefix: 'dsh-my-guardian-boot-' }).name
tmpDirs.push(root)
process.env.DSH_HOME = root

/** Fake loader tree; `healthy` drops the unresolvable roster row so the
 *  startup pre-check produces no issue (and therefore no write of its own). */
function makeLoaderAndTree(dir, { healthy = false } = {}) {
  const store = healthy ? {} : { ghost: { options: { id: 'ghost', name: 'dsh-ghost' } } }
  const created = []
  const removed = []
  const rootGroup = {
    create: async (options) => {
      if (store[options.id]) throw new Error(`duplicate loader entry id: ${options.id}`)
      store[options.id] = { id: options.id, options }
      created.push(options.id)
    },
    remove: async (id) => {
      delete store[id]
      removed.push(id)
    },
  }
  const tree = { filename: join(dir, 'cordis.yml'), store, root: rootGroup }
  return { store, created, removed, tree, loader: { entries: () => [{ subtree: tree }] }, apiRoute: undefined }
}

function makeCtx(fake) {
  const services = {
    webServer: {
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
    get: (name) => services[name],
    on() {},
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

const teardownOf = (ctx) => (ctx.fakeEffects ?? []).find((e) => e.label === 'dsh-my-guardian: teardown')

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

async function callApi(fake, method, path) {
  const res = makeResponse()
  await fake.apiRoute.handler(
    {
      method,
      url: `/guardian/api/${path}`,
      headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3080' },
      [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true }) }),
    },
    res,
  )
  return { status: res._status, json: res._body === '' ? null : JSON.parse(res._body) }
}

const readStateOrNull = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'guardian', 'state.json'), 'utf8'))
  } catch {
    return undefined
  }
}

const readIssuesOrNull = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'guardian', 'startup-issues.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/** Boot one instance for a fresh profile dir. */
function bootInstance(tag, staged, treeOpts) {
  const dir = dirSync({ unsafeCleanup: true, prefix: tag }).name
  tmpDirs.push(dir)
  process.env.DSH_HOME = dir
  const fake = makeLoaderAndTree(dir, treeOpts)
  writeFileSync(join(dir, 'cordis.staged.json'), JSON.stringify(staged), 'utf8')
  const ctx = makeCtx(fake)
  apply(ctx)
  return { dir, fake, ctx }
}

test('#217 teardown returns only after the instance is fully idle (no post-teardown write)', async () => {
  const { dir, ctx } = bootInstance('idle-', [])

  await teardownOf(ctx).disposer()

  // 零墙钟：teardown 一返回就同步读盘。修复前这里读到的是 initialScan 之前
  // 的空 state（预检的 persistSoon 还没入链）→ 断言确定性失败。
  const state = readStateOrNull(dir)
  assert.ok(state, 'teardown flushed a snapshot')
  assert.ok(
    (state.events ?? []).some((e) => e.type === 'startup-issue'),
    'teardown 落盘的快照必须已含启动预检结果（预检不再游离于 teardown 之外）',
  )
})

test('#217 a stale instance cannot clobber the state written after its teardown', async () => {
  const { dir, fake, ctx } = bootInstance('stale-', [{ id: 'ok', name: 'dsh-ok' }])

  await teardownOf(ctx).disposer()
  assert.deepEqual(fake.created, ['ok'], 'teardown 之前 staged 挂载已完成')

  // 「下一个用例块」写入自己的 state。
  const sentinel = {
    version: 1,
    safeMode: false,
    staged: {},
    promoted: { sentinel: { name: 'dsh-sentinel', attempts: 0, frozen: false } },
    events: [],
  }
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(join(dir, 'guardian', 'state.json'), JSON.stringify(sentinel), 'utf8')

  // 正向信号：等旧实例自己的预检报告落盘（它的 persistSoon 紧随其后）。
  for (let i = 0; i < 400 && readIssuesOrNull(dir) === undefined; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  // 负向断言（"没有发生"没有正向信号可等）→ 保留观察窗口，让链上 IO 有机会完成。
  await new Promise((resolve) => setTimeout(resolve, 50))

  assert.ok(readIssuesOrNull(dir), '预检报告已落盘（旧实例的异步链确实跑完过）')
  assert.ok(readStateOrNull(dir)?.promoted?.sentinel, 'teardown 后旧实例不得再写 state.json（否则会覆盖下一个用例块）')
})

test('#217 API dispatch never observes a half-loaded startup pre-check', async () => {
  gate.active = true
  gate.reset()
  try {
    const { fake, ctx } = bootInstance('half-', [])

    // 先等 initialScan 把自己那条链跑完（API 注册是它的最后一步）。
    // issue #402：等待预算必须是**真实墙钟**，不能是事件循环轮转次数。原实现
    // `for (200 次) await setImmediate` 的预算与 IO 完成时间解耦：高负载下（CI runner、
    // 门禁并发池 6+4 路）CPU 被抢，200 轮轮转先耗尽而 initialScan 的真实 IO 链尚未跑完
    // → fake.apiRoute 仍为 undefined → 假红。CI 实证（run 36120528494，main）：
    // AssertionError: initialScan 已完成（API 已注册）@ host-boot-readiness.mjs:216。
    // 轮询在条件满足时立即返回，条件不满足时等到墙钟上限后由下面的 assert 照常判红
    // ——等待语义只加强不削弱（不会静默通过）。
    const apiReadyDeadline = Date.now() + API_READY_TIMEOUT_MS
    while (fake.apiRoute === undefined && Date.now() < apiReadyDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.ok(fake.apiRoute, `initialScan 已完成（API 已注册；等待上限 ${API_READY_TIMEOUT_MS}ms）`)

    const pending = callApi(fake, 'GET', 'state')
    gate.release()
    const res = await pending

    assert.equal(res.status, 200)
    assert.equal(
      res.json.value.startupIssues.length,
      1,
      'boot 就绪信号之后 snapshot 必须已含预检结果（预检被 gate 挂起时不得返回半加载快照）',
    )
    assert.ok(typeof res.json.value.startupCheckedAt === 'number', 'startupCheckedAt 已填充')
    await teardownOf(ctx).disposer()
  } finally {
    gate.active = false
  }
})

test('#217 a torn-down instance ignores poll ticks that fire afterwards', async () => {
  // roster 健康 → 启动预检不产生写，本用例里的唯一潜在写源就是轮询 tick。
  const { dir, fake, ctx } = bootInstance('tick-', [], { healthy: true })

  await teardownOf(ctx).disposer()

  // 「下一个用例块」写入自己的 state.json。
  const sentinel = {
    version: 1,
    safeMode: false,
    staged: {},
    promoted: { sentinel: { name: 'dsh-sentinel', attempts: 0, frozen: false } },
    events: [],
  }
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(join(dir, 'guardian', 'state.json'), JSON.stringify(sentinel), 'utf8')

  // 旧实例的轮询 tick 在 teardown 之后才触发（真实场景：timer 回调已排队/飞行中），
  // 此刻 staged 文件里出现了一个新候选。
  writeFileSync(join(dir, 'cordis.staged.json'), JSON.stringify([{ id: 'late', name: 'dsh-late' }]), 'utf8')
  for (const tick of ctx.fakeIntervals) tick()

  // 负向断言（"没有发生"没有正向信号可等）→ 保留观察窗口，让链上 IO 有机会完成。
  await new Promise((resolve) => setTimeout(resolve, 50))

  assert.deepEqual(fake.created, [], 'teardown 之后的轮询 tick 不得再扫描/挂载')
  assert.ok(
    readStateOrNull(dir)?.promoted?.sentinel,
    'teardown 之后的轮询 tick 不得再写 state.json（否则会覆盖下一个用例块）',
  )
})

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
