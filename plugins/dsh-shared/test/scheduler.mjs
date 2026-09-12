/**
 * dsh-shared 写入调度原语测试（issue #198 第二批）。
 *
 * 审计缺口：各插件重复实现 persistSoon（防抖 setTimeout）+ dirtyChain（串行链），
 * 且「等落盘」只能靠固定 sleep —— 这正是 CI flaky 的根因
 * （docs/踩坑/固定sleep等异步落盘导致CI-flaky.md：sleep 不表达条件，只表达"我猜够了"）。
 *
 * 本文件锁定 createWriteScheduler 的契约：
 *  - 防抖合并（窗口内多次 schedule 只写一次，合并次数可读）；
 *  - 最小间隔（两次写至少间隔 minIntervalMs，由调度器保证，护栏不会误伤）；
 *  - 串行（写回调不并发执行）；
 *  - drain() = **确定性就绪信号**（await 后所有挂起/在飞写入都已完成）；
 *  - flush() = 立即强写（force=true 传给写回调，用于退出前冲刷）；
 *  - 写回调返回 false（被护栏拒绝）→ 计数 + 自动重排，重试耗尽才放弃（有 warn）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createWriteScheduler, DEFAULT_DEBOUNCE_MS, DEFAULT_MIN_WRITE_INTERVAL_MS } from '../lib/scheduler.js'
import { atomicWriteJson } from '../lib/persist.js'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('createWriteScheduler：默认参数与默认护栏一致（防抖 500ms / 最小间隔 1s）', () => {
  assert.equal(DEFAULT_DEBOUNCE_MS, 500, '默认防抖窗口')
  assert.equal(DEFAULT_MIN_WRITE_INTERVAL_MS, 1000, '默认最小写间隔 ≥1s（与 atomicWriteJson 默认护栏对齐）')
})

test('createWriteScheduler：防抖合并（窗口内多次 schedule 只写一次 + 合并计数）', async () => {
  const stamps = []
  const scheduler = createWriteScheduler({
    debounceMs: 20,
    minIntervalMs: 0,
    write: () => {
      stamps.push(Date.now())
    },
  })
  for (let i = 0; i < 10; i += 1) scheduler.schedule()
  assert.equal(scheduler.pending(), true, 'schedule 后有挂起变更')
  await scheduler.drain() // 确定性就绪信号：无需 sleep 猜窗口
  assert.equal(stamps.length, 1, '10 次变更合并为 1 次写')
  assert.equal(scheduler.stats().coalesced, 9, '合并计数可读')
  assert.equal(scheduler.pending(), false, 'drain 后无挂起')
})

test('createWriteScheduler：最小间隔由调度器保证（drain 会等到窗口满足）', async () => {
  const stamps = []
  const scheduler = createWriteScheduler({
    debounceMs: 5,
    minIntervalMs: 60,
    write: () => {
      stamps.push(Date.now())
    },
  })
  scheduler.schedule()
  await scheduler.drain()
  scheduler.schedule()
  await scheduler.drain() // 第二次写必须等满最小间隔
  assert.equal(stamps.length, 2, '第二次变更仍然落盘（不是被丢掉）')
  assert.ok(stamps[1] - stamps[0] >= 55, '两次写间隔 ≥ minIntervalMs，got ' + (stamps[1] - stamps[0]) + 'ms')
  assert.equal(scheduler.stats().writes, 2)
})

test('createWriteScheduler：写串行（写回调不并发）+ drain 等 in-flight 完成', async () => {
  let inflight = 0
  let maxInflight = 0
  let release = null
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const scheduler = createWriteScheduler({
    debounceMs: 0,
    minIntervalMs: 0,
    write: async () => {
      inflight += 1
      maxInflight = Math.max(maxInflight, inflight)
      await gate
      inflight -= 1
    },
  })
  scheduler.schedule()
  await sleep(10) // 让第一次写进入 in-flight
  scheduler.schedule()
  let drained = false
  const drainedPromise = scheduler.drain().then(() => {
    drained = true
  })
  await sleep(10)
  assert.equal(drained, false, 'drain 必须等待 in-flight 写完成（不是猜时间）')
  release()
  await drainedPromise
  assert.equal(maxInflight, 1, '写回调串行执行')
  assert.equal(scheduler.pending(), false)
})

test('createWriteScheduler：drain 无挂起工作时立即 resolve（幂等）', async () => {
  let calls = 0
  const scheduler = createWriteScheduler({ write: () => (calls += 1) })
  await scheduler.drain()
  await scheduler.drain()
  assert.equal(calls, 0, '没有变更就不写（drain 不是 flush）')
  assert.equal(scheduler.pending(), false)
})

test('createWriteScheduler：flush 立即强写（force=true 传给写回调，退出前冲刷路径）', async () => {
  const forces = []
  const scheduler = createWriteScheduler({
    debounceMs: 60000,
    minIntervalMs: 60000,
    write: ({ force }) => {
      forces.push(force)
    },
  })
  scheduler.schedule()
  await scheduler.flush()
  assert.deepEqual(forces, [true], 'flush 以 force=true 立即落盘（不等防抖/最小间隔）')
  assert.equal(scheduler.pending(), false)
  await scheduler.flush()
  assert.deepEqual(forces, [true, true], 'flush 幂等：无变更也确保落盘一次（teardown 语义）')
})

test('createWriteScheduler：写回调返回 false（被护栏拒绝）→ 计数 + 自动重排，直到成功', async () => {
  let attempts = 0
  const scheduler = createWriteScheduler({
    debounceMs: 5,
    minIntervalMs: 10,
    write: () => {
      attempts += 1
      return attempts >= 2 // 第一次模拟被 atomicWriteJson 节流拒绝
    },
  })
  scheduler.schedule()
  await scheduler.drain()
  assert.equal(attempts, 2, '被拒后自动重排一次')
  assert.equal(scheduler.stats().retried, 1, '重排计数可读')
  assert.equal(scheduler.stats().writes, 1, '最终成功落盘')
  assert.equal(scheduler.pending(), false, '成功后不再挂起')
})

test('createWriteScheduler：连续被拒超过 maxWriteRetries → 放弃并 warn（不无限重试/不挂死 drain）', async () => {
  let attempts = 0
  const warns = []
  const scheduler = createWriteScheduler({
    debounceMs: 1,
    minIntervalMs: 1,
    maxWriteRetries: 2,
    logger: { warn: (m) => warns.push(m) },
    write: () => {
      attempts += 1
      return false
    },
  })
  scheduler.schedule()
  await scheduler.drain()
  assert.equal(attempts, 3, '首次 + 2 次重试后放弃')
  assert.ok(
    warns.some((m) => m.includes('blocked')),
    '放弃有 warn（不静默），got: ' + JSON.stringify(warns),
  )
  assert.equal(scheduler.pending(), false, '放弃后 drain 不挂死')
})

test('createWriteScheduler + atomicWriteJson：默认护栏下不误伤、不丢状态（真实组合）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-shared-sched-'))
  const file = join(dir, 'state.json')
  let version = 0
  // 契约：调度器 minIntervalMs 默认 1000 = atomicWriteJson 默认节流窗口，
  // 两者一致时护栏永远不会误伤正常节奏（不一致 = 配置错误，会走重排路径）。
  const scheduler = createWriteScheduler({
    debounceMs: 0,
    write: ({ force }) => atomicWriteJson(file, { version }, { warn() {} }, '[t]', { force }),
  })
  try {
    for (let round = 0; round < 2; round += 1) {
      version += 1
      scheduler.schedule()
      await scheduler.drain() // 每轮都等落盘：文件必须与内存一致
      assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, version, '第 ' + (round + 1) + ' 轮已落盘')
    }
    assert.equal(scheduler.stats().retried, 0, '调度器保证最小间隔 → 不会触发默认护栏的节流')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
