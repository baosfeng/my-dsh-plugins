/**
 * teardown 收尾期 entry dispose 落盘 —— issue #438 防回归测试（先红后绿）。
 *
 * 缺陷：宿主卸载整树时同批 disposer 由 `Promise.all` 并发执行、顺序无保证
 * （官方宿主 `vendor/cordis/src/fiber.ts` 的 `_unload`）。guardian 的 teardown 只落
 * 「一次」收尾快照（`persistFinal()` + `flushPersist()`），之后没有任何 flush 钩子；
 * 而 `persistSoon()` 在 `disposed` 后直接 return（#217 守卫，src/state.ts）。于是任一
 * entry 的 `loader/partial-dispose` 只要晚于那次快照到达，就再无落盘机会 ——
 * 进程随后退出，收尾诊断永久丢失（`state.json.events` 里查不到收尾期间的 dispose）。
 *
 * 本套件覆盖四件事：
 *  1. 收尾窗口（persister 单元级）：disposed 后的排空窗口内写入仍被接受并落盘，
 *     窗口关闭后一律失效（#217 不回归）；
 *  2. 端到端复现：与 teardown 并发的 entry disposer 在**首次收尾落盘之后**才 emit，
 *     该事件必须出现在最终快照里（修前红）；
 *  3. 并发多 entry：分多轮到齐的 dispose 全部落盘；
 *  4. #217 不回归：teardown 返回之后到达的事件不得覆盖已落盘快照。
 *
 * 等待一律是「条件轮询 + 让出宏任务」（`waitForWritesAbove` / `nextMacrotask`），
 * 不用固定 sleep 赌时长（见 plugins/dsh-shared/test-kit/wait.mjs 与
 * scripts/check-test-sleeps.mjs）。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { atomicWriteStats } from 'dsh-shared'
import { apply } from '../lib/index.js'
import { createPersister, createState } from '../lib/state.js'
import { waitFor } from '../../dsh-shared/test-kit/wait.mjs'

const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-my-guardian-teardown-' }).name
const oldHome = process.env.DSH_HOME
process.env.DSH_HOME = dir
mkdirSync(join(dir, 'guardian'), { recursive: true })

afterAll(() => {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  rmSync(dir, { recursive: true, force: true })
})

const stateFile = () => join(dir, 'guardian', 'state.json')
const readStateFile = () => JSON.parse(readFileSync(stateFile(), 'utf8'))

function freshState() {
  writeFileSync(
    stateFile(),
    JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
}

/** 让出一轮宏任务（不是等固定时长）：给同批并发 disposer 的微/宏任务链推进机会。 */
const nextMacrotask = () => new Promise((resolve) => setImmediate(resolve))

/**
 * 条件等待：等 `atomicWriteStats().writes` 超过 base —— 也就是「guardian 又完成了一次
 * 原子落盘」。写次数是确定性信号，不是墙钟猜测；用 setImmediate 轮询（让出宏任务），
 * 比定时轮询更快发现刚落盘的写，从而把「其它 entry 的 dispose」精确排在收尾落盘之后。
 */
async function waitForWritesAbove(base, maxRounds = 2000) {
  for (let round = 0; round < maxRounds; round += 1) {
    if (atomicWriteStats().writes > base) return
    await nextMacrotask()
  }
  throw new Error('waitForWritesAbove 超时：等的是一次 guardian 原子落盘完成')
}

/** Fake loader tree：root group + 可变的 entry store（与 host-mutation.mjs 同构）。 */
function makeLoaderAndTree() {
  const store = {}
  const root = {
    create: async (options) => {
      store[options.id] = { id: options.id, options }
    },
    remove: async (id) => {
      delete store[id]
    },
  }
  const tree = { filename: join(dir, 'cordis.yml'), store, root }
  return {
    store,
    tree,
    loader: { entries: () => [{ subtree: tree }] },
    apiRoute: undefined,
    events: [],
  }
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
  const ctx = {
    logger: { warn: () => {} },
    loader: fake.loader,
    timer: { interval: () => () => {} },
    get: (name) => services[name],
    on: (name, listener) => {
      fake.events.push({ name, listener })
    },
    effect: (callback, label) => {
      const disposer = callback()
      effects.push({ label, disposer })
      return disposer
    },
  }
  ctx.fakeEffects = effects
  return ctx
}

async function boot(fake) {
  const ctx = makeCtx(fake)
  ctx.fakeShared = apply(ctx)
  // 确定性同步点：API 注册是启动链的最后一步（不用 sleep 赌它跑完）
  await waitFor(() => fake.apiRoute !== undefined, { message: 'guardian API 注册完成' })
  return ctx
}

/** 宿主对某个 entry 触发 `loader/partial-dispose`（整树卸载 / group.remove 的真实语义）。 */
function emitDispose(fake, id) {
  for (const { name, listener } of fake.events) {
    if (name === 'loader/partial-dispose') listener({ options: { id } })
  }
}

const teardownOf = (ctx) => ctx.fakeEffects.find((e) => e.label === 'dsh-my-guardian: teardown').disposer

/** teardown 已返回之后的确定性收尾（负向用例用）。 */
const shutdown = async (ctx) => {
  await teardownOf(ctx)()
}

test('#438 收尾窗口（persister 单元级）：disposed 后排空窗口内的写入仍落盘，窗口关闭后失效', async () => {
  freshState()
  const shared = { state: createState(), disposed: true }
  const persister = createPersister(shared, { warn() {} })

  // 窗口打开前：#217 原语义 —— disposed 之后一律不写
  const sealed = atomicWriteStats().writes
  shared.state.events.push({ time: Date.now(), type: 'entry-dispose', message: 'before-window' })
  persister.persistSoon()
  await persister.flush()
  assert.equal(atomicWriteStats().writes, sealed, '窗口未开：disposed 后的 persistSoon 一律失效（#217）')

  // 收尾窗口内：写入被接受，并由排空保证落盘
  persister.beginClosingWrites()
  shared.state.events.push({ time: Date.now(), type: 'entry-dispose', message: 'in-window' })
  persister.persistSoon()
  await persister.settleClosingWrites()
  assert.ok(
    readStateFile().events.some((e) => e.message === 'in-window'),
    '收尾窗口内记录的事件必须落盘（#438）',
  )

  // 窗口已关闭：teardown 返回后的写入一律失效（#217 不回归）
  const afterWindow = atomicWriteStats().writes
  shared.state.events.push({ time: Date.now(), type: 'entry-dispose', message: 'after-window' })
  persister.persistSoon()
  await persister.flush()
  assert.equal(atomicWriteStats().writes, afterWindow, '窗口关闭后不再落盘（#217 不回归）')
  assert.ok(!readStateFile().events.some((e) => e.message === 'after-window'), '窗口关闭后的迟到事件不得覆盖已落盘快照')
})

test('#438 复现：teardown 首次收尾落盘之后到达的 entry dispose 必须落盘', async () => {
  freshState()
  const fake = makeLoaderAndTree()
  const ctx = await boot(fake)
  const base = atomicWriteStats().writes

  // 宿主 `_unload` 的 Promise.all 语义：同批 disposer 并发、顺序无保证。
  // 这个「其它 entry 的 disposer」以 guardian 的收尾落盘（原子写计数）为同步点，
  // 因此它的 dispose 一定发生在 guardian 已经落盘一次之后 —— 正是 #438 的丢失窗口。
  const otherEntry = (async () => {
    await waitForWritesAbove(base)
    emitDispose(fake, 'late-entry')
  })()

  await Promise.all([teardownOf(ctx)(), otherEntry])

  assert.ok(
    readStateFile().events.some((e) => e.type === 'entry-dispose' && e.message.includes('late-entry')),
    '收尾期到达的 entry dispose 必须出现在最终快照里',
  )
})

test('#438 并发多 entry：分多轮到齐的 dispose 全部落盘', async () => {
  freshState()
  const fake = makeLoaderAndTree()
  const ctx = await boot(fake)
  const base = atomicWriteStats().writes
  const ids = ['late-a', 'late-b', 'late-c', 'late-d']

  // 每个「其它 entry 的 disposer」在 guardian 的第 i 次收尾落盘之后才 dispose ——
  // 模拟真实整树卸载里各 entry disposer 完成时间不一致（并发无顺序保证）。
  const others = ids.map((id, index) =>
    (async () => {
      await waitForWritesAbove(base + index)
      emitDispose(fake, id)
    })(),
  )

  await Promise.all([teardownOf(ctx)(), ...others])

  const events = readStateFile().events.filter((e) => e.type === 'entry-dispose')
  for (const id of ids) {
    assert.ok(
      events.some((e) => e.message.includes(id)),
      '并发 entry ' + id + ' 的 dispose 必须落盘',
    )
  }
})

test('#217 不回归：teardown 返回之后到达的 dispose 不得覆盖已落盘快照', async () => {
  freshState()
  const fake = makeLoaderAndTree()
  const ctx = await boot(fake)
  await shutdown(ctx)

  const snapshot = readFileSync(stateFile(), 'utf8')
  emitDispose(fake, 'after-teardown')
  for (let round = 0; round < 5; round += 1) await nextMacrotask()

  assert.equal(readFileSync(stateFile(), 'utf8'), snapshot, 'teardown 返回后的写入必须失效')
  assert.ok(!readStateFile().events.some((e) => e.message.includes('after-teardown')), '迟到事件不得落盘')
})
