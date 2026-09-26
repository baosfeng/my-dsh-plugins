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

/** Fake loader tree：root group + 可变的 entry store（与 host-mutation.mjs 同构）。
 *
 * `groupDispose()` 复刻宿主**整树卸载**（SIGTERM teardown）的真实行为：同批 disposer 里
 * group 把 entry 逐个从 store 里摘掉（真实 loader 的 `EntryGroup.remove`），而
 * guardian 的 `loader/partial-dispose` 监听器已经在同一批 disposer 里被摘除 ——
 * 事件根本不派发（#438 第二种形态）。 */
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
    /** 整树卸载：释放全部 entry，**不派发** partial-dispose（监听器同批被摘除）。 */
    groupDispose() {
      for (const id of Object.keys(store)) delete store[id]
    },
    /** 运行时安装一个 entry（走真实 create → entry-init 事件）。 */
    async installEntry(id) {
      await root.create({ id, name: id })
    },
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
/**
 * #438 第二种形态（先红后绿）：整树卸载期**事件通道根本收不到** —— 收尾期的 entry
 * 释放必须由「loader 树快照差集」补齐，且条数与释放的 entry 数一致。
 *
 * 真实形态（隔离实例 + SIGTERM 探针实测）：cordis `Fiber._unload` 把 guardian 的
 * `ctx.on` 监听器与 teardown disposer 放进**同一批** disposer 并发执行；整树卸载时
 * 监听器已被摘除，group 逐个释放 entry 时不再有人收到 `loader/partial-dispose`
 * （实测：修前 state.json.events 恒 1 条、entry-dispose 0 条）。
 *
 * 本用例把那一批拆成两半：`groupDispose()` 只在 store 上摘条目、**不派发事件**；
 * teardown disposer 照旧执行。修前该用例红（0 条记录），修后全量记录。
 */
test('#438 第二种形态：整树卸载不派发事件时，收尾释放的 entry 仍按树快照全部记录', async () => {
  freshState()
  const fake = makeLoaderAndTree()
  const ctx = await boot(fake)
  const ids = ['ui-settings-plugins', 'ui-plan', 'agent-presets', 'guardian']
  for (const id of ids) await fake.installEntry(id)
  // 启动期 entry-init 必须已经落盘过（证明事件通道在运行期有效）
  await waitFor(() => fake.events.length > 0, { message: '事件监听已注册' })

  const teardown = teardownOf(ctx)()
  // 同批并发：group 释放（监听器同批被摘除 → 不派发任何事件）
  fake.groupDispose()
  await teardown

  const recorded = readStateFile().events.filter((e) => e.type === 'entry-dispose')
  assert.equal(
    recorded.length,
    ids.length,
    '收尾释放的 entry 数必须与记录数一致（事件通道收不到时由 loader 树快照差集补齐）',
  )
  for (const id of ids) {
    assert.ok(
      recorded.some((e) => e.message === 'entry ' + id + ' disposed'),
      '收尾释放的 entry ' + id + ' 必须落盘（事件通道收不到也要记）',
    )
  }
})

test('#438 第二种形态：仍存活的 entry 不得被记成释放（差集不是「全量清单」）', async () => {
  freshState()
  const fake = makeLoaderAndTree()
  const ctx = await boot(fake)
  await fake.installEntry('released-entry')
  await fake.installEntry('surviving-entry')
  await waitFor(() => fake.events.length > 0, { message: '事件监听已注册' })

  const teardown = teardownOf(ctx)()
  // 只释放一个：另一个在同一批里活下来（例如宿主只摘了部分 entry）
  delete fake.store['released-entry']
  await teardown

  const recorded = readStateFile().events.filter((e) => e.type === 'entry-dispose')
  assert.deepEqual(
    recorded.map((e) => e.message),
    ['entry released-entry disposed'],
    '只记实际从树上消失的 entry，存活条目不得被误记',
  )
})

test('#438 第二种形态 + #217：teardown 返回后到达的同批释放不得覆盖快照', async () => {
  freshState()
  const fake = makeLoaderAndTree()
  const ctx = await boot(fake)
  await fake.installEntry('during-teardown')
  await waitFor(() => fake.events.length > 0, { message: '事件监听已注册' })

  await shutdown(ctx)
  const snapshot = readFileSync(stateFile(), 'utf8')

  // teardown 已返回：同批里更晚到达的释放只能改内存，绝不能再落盘（#217）
  delete fake.store['during-teardown']
  for (let round = 0; round < 5; round += 1) await nextMacrotask()
  assert.equal(readFileSync(stateFile(), 'utf8'), snapshot, 'teardown 返回后的写入必须失效')
})
