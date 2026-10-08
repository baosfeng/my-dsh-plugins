/**
 * 诊断事件日志（lib/events.js）防回归测试。
 *
 * 背景：`events.ts` 是覆盖率最低的 server 模块（branch 55%，全插件最低），
 * 而其中未覆盖的 `entryLabelOf` 恰好是最危险的路径——它读 loader entry 的
 * 可读标识时**绝不能碰 `entry.id` getter**：loader 在 Entry 构造函数中 emit
 * `loader/entry-init`，此时 `parent.tree` 尚未就绪，访问 getter 会抛
 * "Cannot read properties of undefined (reading 'tree')"，把整个 DSH 启动
 * 拖垮（守护插件自己炸启动，真机复现过）。本套件把这个约束连同环形缓冲上限、
 * HMR 失败监听器的两个消息分支一起锁死。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attachEventListeners, HOST_EVENT_FALLBACKS, logEvent } from '../lib/events.js'
import * as stateModule from '../lib/state.js'

// 分级缓冲的两档配额与判定函数都来自被测实现：旧产物里没有它们（#439 未修时），
// 这里给诚实的兜底值，让测试用**断言**而不是导入崩溃把 bug 说清楚。
const CRITICAL_EVENT_LIMIT = stateModule.CRITICAL_EVENT_LIMIT ?? 20
const NOISE_EVENT_LIMIT = stateModule.NOISE_EVENT_LIMIT ?? 20
const isNoiseEvent = stateModule.isNoiseEvent
const { createState, createPersister } = stateModule

/** 本套件对「高频噪音」的独立清单（不依赖被测实现的自述）。 */
const NOISE_TYPES = new Set(['entry-init', 'entry-dispose'])

/** 配置热更新失败的结构化 warn 首参（逐字取自宿主源码，见 HOST_EVENT_FALLBACKS 取证）。 */
const MARKER = HOST_EVENT_FALLBACKS.find((fallback) => fallback.kind === 'logger-warn')?.marker ?? ''

/** 一条宿主 warn 消息（字段形状取自 cordis LoggerService Message）。 */
function warnMessage(args, name = 'hmr') {
  return { sn: 1, ts: Date.now(), name, type: 'warn', level: 2, args }
}

/** 最小 cordis ctx：记录监听的 loader 事件 + 警告 + 日志导出器（降级通道）。 */
function makeCtx() {
  const handlers = new Map()
  const warnings = []
  const sinks = []
  return {
    handlers,
    warnings,
    sinks,
    on: (event, listener) => {
      handlers.set(event, listener)
    },
    logger: {
      warn: (message) => warnings.push(message),
      exporter: (sink) => {
        sinks.push(sink)
        return () => {}
      },
    },
  }
}

/** 最小 SharedContext：只有事件环形缓冲与 persistSoon 被用到。 */
function makeShared() {
  return {
    state: { events: [] },
    persistCount: 0,
    persistSoon() {
      this.persistCount += 1
    },
  }
}

test('logEvent：追加事件、截断超长消息（ERROR_SNIP=300）并转换非字符串', () => {
  const shared = makeShared()
  logEvent(shared, 'promote', 'x'.repeat(500))
  assert.equal(shared.state.events.length, 1)
  assert.equal(shared.state.events[0].type, 'promote')
  assert.equal(shared.state.events[0].message.length, 300, '消息截断到 ERROR_SNIP')
  assert.ok(typeof shared.state.events[0].time === 'number', '事件带时间戳')

  logEvent(shared, 'quarantine', { toString: () => 'object message' })
  assert.equal(shared.state.events[1].message, 'object message', '非字符串消息经 String() 转换')
})

// ── #439 分级缓冲：噪音独立配额，不再挤掉关键事件 ──────────────────────────
// 旧实现是**单一 FIFO 环 + 上限 20 条**、噪音与关键事件共用：一次整树卸载
// （每个 entry 一条 entry-dispose）就能把 quarantine/freeze 物理挤出且不可恢复。
// 下面这组用例把新语义（两档各自配额、只裁本档、未知类型按关键处理）锁死。

/** 某档事件的条数。噪音类型优先取被测实现的判定函数，缺失时退回本套件自带的清单。 */
function countTier(events, tier) {
  const isNoise = typeof isNoiseEvent === 'function' ? (type) => isNoiseEvent(type) : (type) => NOISE_TYPES.has(type)
  return events.filter((event) => (tier === 'noise') === isNoise(event.type)).length
}

test('#439：噪音配额独立——写满噪音再写关键事件，关键事件必须还在（旧 FIFO 下会被挤掉）', () => {
  const shared = makeShared()
  for (let i = 0; i < NOISE_EVENT_LIMIT + 7; i += 1) logEvent(shared, 'entry-dispose', `dispose-${i}`)
  logEvent(shared, 'quarantine', '插件 dsh-bad 加载失败，已隔离')

  const kept = shared.state.events
  assert.equal(
    countTier(kept, 'noise'),
    NOISE_EVENT_LIMIT,
    `噪音档裁到自己的配额，不侵占关键档；实际缓冲末 6 条 = ${JSON.stringify(kept.slice(-6).map((e) => e.type))}（共 ${kept.length} 条）`,
  )
  assert.equal(countTier(kept, 'critical'), 1, '关键事件条数不受噪音影响')
  assert.ok(
    kept.some((event) => event.type === 'quarantine'),
    `quarantine 不得被 dispose 风暴挤出缓冲（#439 根因）；实际缓冲 = ${JSON.stringify(kept.map((e) => e.type).slice(-6))}（共 ${kept.length} 条）`,
  )
  assert.equal(kept.at(-1).type, 'quarantine', '顺序仍是到达顺序：关键事件在噪音之后')
})

test('#439：风暴中的关键事件顺序与条数（多条关键事件 + 30 条噪音）', () => {
  const shared = makeShared()
  for (let i = 0; i < 30; i += 1) logEvent(shared, 'entry-dispose', `dispose-${i}`)
  logEvent(shared, 'quarantine', 'quarantine-1')
  logEvent(shared, 'entry-dispose', 'dispose-late')
  logEvent(shared, 'freeze', 'freeze-1')
  logEvent(shared, 'entry-init', 'init-late')
  logEvent(shared, 'update-failed', 'update-failed-1')
  logEvent(shared, 'promote', 'promote-1')

  const critical = shared.state.events.filter((event) => !isNoiseEvent(event.type)).map((event) => event.type)
  assert.deepEqual(critical, ['quarantine', 'freeze', 'update-failed', 'promote'], '关键事件按到达顺序全部保留')
  assert.equal(countTier(shared.state.events, 'noise'), NOISE_EVENT_LIMIT, '噪音仍受自己的配额约束')
})

test('#439：关键档自己的配额是 CRITICAL_EVENT_LIMIT，且噪音风暴不改动已存关键事件', () => {
  const shared = makeShared()
  for (let i = 0; i < CRITICAL_EVENT_LIMIT + 5; i += 1) logEvent(shared, 'skip', `skip-${i}`)
  const afterTrim = shared.state.events.map((event) => event.message)
  assert.equal(afterTrim.length, CRITICAL_EVENT_LIMIT, '关键档超出配额后裁到 CRITICAL_EVENT_LIMIT')
  assert.equal(afterTrim[0], `skip-${5}`, '裁掉最早的关键事件，保留最近的一批')
  assert.equal(afterTrim.at(-1), `skip-${CRITICAL_EVENT_LIMIT + 4}`)

  for (let i = 0; i < 60; i += 1) logEvent(shared, 'entry-init', `init-${i}`)
  assert.deepEqual(
    shared.state.events.filter((event) => !isNoiseEvent(event.type)).map((event) => event.message),
    afterTrim,
    '噪音只裁噪音档：已存关键事件一条不丢',
  )
})

test('#439：未登记的事件类型按关键处理（宁多留不暗丢），新增噪音类型只影响自己', () => {
  const shared = makeShared()
  for (let i = 0; i < 50; i += 1) logEvent(shared, 'entry-dispose', `dispose-${i}`)
  logEvent(shared, 'brand-new-event', '新事件不得被噪音挤掉')
  assert.equal(shared.state.events.at(-1).type, 'brand-new-event', '未知类型走关键档（不被噪音配额裁剪）')
  assert.ok(isNoiseEvent('entry-init') && isNoiseEvent('entry-dispose'), '已知噪音类型仍在噪音档')
  assert.ok(!isNoiseEvent('quarantine') && !isNoiseEvent('brand-new-event'), '其余类型一律关键档')
})

test('#439：两档配额之和是硬上界——落盘 events 有界，不随噪音量增长（STATE_MAX_BYTES 之外的条数护栏）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'guardian-events-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const state = createState()
    const shared = {
      state,
      disposed: false,
      persistSoon: () => {},
    }
    const persister = createPersister(shared)
    // 模拟整树卸载风暴：噪音条数 = entry 数（远大于任何配额）。
    for (let i = 0; i < 1000; i += 1) {
      logEvent(shared, 'entry-dispose', `entry e-${i} disposed ${'x'.repeat(280)}`)
      logEvent(shared, 'quarantine', `e-${i} 加载失败，已隔离`)
    }
    await persister.persistFinal()

    assert.equal(state.events.length, CRITICAL_EVENT_LIMIT + NOISE_EVENT_LIMIT, '内存 events = 两档配额之和')
    assert.equal(countTier(state.events, 'noise'), NOISE_EVENT_LIMIT)
    assert.equal(countTier(state.events, 'critical'), CRITICAL_EVENT_LIMIT)
    const raw = await readFile(join(home, 'guardian', 'state.json'), 'utf8')
    const written = JSON.parse(raw)
    assert.equal(written.events.length, CRITICAL_EVENT_LIMIT + NOISE_EVENT_LIMIT, '落盘 events 同样有界')
    assert.ok(raw.length < 64 * 1024, `落盘体积远低于 STATE_MAX_BYTES（实测 ${raw.length} 字节）`)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})

test('attachEventListeners：只订阅目标宿主真实派发的 loader 事件（不再订阅已删除的 hmr 事件）', async () => {
  const ctx = makeCtx()
  const shared = makeShared()
  attachEventListeners(ctx, shared)
  assert.deepEqual([...ctx.handlers.keys()].sort(), ['loader/entry-init', 'loader/partial-dispose'])

  // loader 在 Entry **构造函数**里 emit entry-init（vendor/loader/src/config/entry.ts:58），
  // 此刻 options 还是空对象（同文件 :50），同步读取只能记成 "entry ? initialized" ——
  // 构造完成后同一次 create() 内 options 才被赋值，所以记录必须等一个 microtask。
  const entry = { options: {} }
  ctx.handlers.get('loader/entry-init')(entry)
  assert.deepEqual(shared.state.events, [], '构造期不落笔：那时拿不到任何 entry 标识')
  entry.options = { id: 'dsh-bad', name: 'dsh-bad' }
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(
    shared.state.events.map((event) => [event.type, event.message]),
    [['entry-init', 'entry dsh-bad initialized']],
  )

  ctx.handlers.get('loader/partial-dispose')({ options: { id: 'dsh-bad' } })
  assert.deepEqual(
    shared.state.events.map((event) => [event.type, event.message]),
    [
      ['entry-init', 'entry dsh-bad initialized'],
      ['entry-dispose', 'entry dsh-bad disposed'],
    ],
  )
  assert.equal(shared.persistCount, 2, 'entry-init / dispose 记录后立刻排队落盘（#438：不再只写内存）')
})

test('配置热更新失败诊断由结构化日志通道承担：告警 + 立刻落盘 + 补齐真实原因', () => {
  const ctx = makeCtx()
  const shared = makeShared()
  attachEventListeners(ctx, shared)
  const sink = ctx.sinks[0]

  sink.export(warnMessage([MARKER, 'cordis.yml']))
  assert.equal(shared.state.events[0].type, 'update-failed')
  assert.equal(shared.state.events[0].message, 'cordis.yml: (error detail logged by host)')
  assert.deepEqual(ctx.warnings, ['[dsh-my-guardian] config update failed (rolled back): cordis.yml'])
  assert.equal(shared.persistCount, 1, '失败后立刻落盘（重启后仍能诊断）')

  sink.export(warnMessage([new Error('boom')]))
  assert.equal(shared.state.events[0].message, 'cordis.yml: boom', '紧随的 Error warn 补齐真实原因')

  const bare = makeCtx()
  delete bare.logger
  assert.doesNotThrow(() => attachEventListeners(bare, makeShared()), 'logger 缺失时不得抛异常（可选链降级）')
})

test('entryLabelOf：优先 options.id，回落 options.name，缺失为 "?"', async () => {
  const ctx = makeCtx()
  const shared = makeShared()
  attachEventListeners(ctx, shared)
  const onInit = ctx.handlers.get('loader/entry-init')

  const cases = [
    [{ options: { id: 'by-id', name: 'by-name' } }, 'entry by-id initialized'],
    [{ options: { id: null, name: 'fallback-name' } }, 'entry fallback-name initialized'],
    [{ options: { name: 'only-name' } }, 'entry only-name initialized'],
    [{ options: { id: undefined, name: '' } }, 'entry ? initialized', '空 name 不采用'],
    [{ options: {} }, 'entry ? initialized'],
    [{}, 'entry ? initialized', '无 options'],
    [{ options: null }, 'entry ? initialized'],
    [null, 'entry ? initialized'],
    ['string-entry', 'entry ? initialized'],
    [42, 'entry ? initialized'],
    [{ options: { id: 7, name: 'n' } }, 'entry 7 initialized', '数字 id 字符串化'],
  ]
  for (const [entry, expected, note] of cases) {
    shared.state.events.length = 0
    onInit(entry)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(shared.state.events[0].message, expected, note ?? JSON.stringify(entry))
  }
})

test('entryLabelOf：绝不触碰 entry.id getter（会抛 "reading tree" 把启动拖垮）', async () => {
  const ctx = makeCtx()
  const shared = makeShared()
  attachEventListeners(ctx, shared)

  let getterReads = 0
  const entry = {
    options: { name: 'safe-name' },
    get id() {
      getterReads += 1
      throw new Error("Cannot read properties of undefined (reading 'tree')")
    },
  }
  assert.doesNotThrow(
    () => ctx.handlers.get('loader/entry-init')(entry),
    'loader 在 Entry 构造函数中 emit entry-init 时 id getter 不可用，读取它会让 DSH 起不来',
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(getterReads, 0, 'entry.id getter 一次都不能被访问')
  assert.equal(shared.state.events[0].message, 'entry safe-name initialized', '退回 options.name')
})
