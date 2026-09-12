/**
 * dsh-shared 资源看门狗原语测试（issue #198 第三批）。
 *
 * 审计缺口：observability 里有一份**插件私有**的 resource-monitor（采样 → 阈值 →
 * 连续确认 → 降级/恢复），任何需要「资源超限自动降级」的插件都只能抄一遍
 * （docs/共享工具包/概述.md 的原语清单里这条一直挂着「未落地」）。
 *
 * 本文件锁定 createResourceGuard 的契约（先 RED 后 GREEN）：
 *  - 纯函数规则（阈值判定 / 连续确认降级 / 连续确认恢复）与 observability
 *    既有 resource-rules 语义**逐条等价**（阈值口径、边界值不算超限、冷启动保护、
 *    抖动保护）；
 *  - 三态行为：正常 → 降级（连续 enterConfirmCount 次关键阈值超限）→ 恢复
 *    （连续 exitConfirmCount 次正常）；降级中不重复触发、回调恰好一次；
 *  - 采样基线语义：首个样本无窗口数据 → 不告警、不进历史、仅作为后续窗口 prev；
 *  - 采样源由宿主注入（collect），时钟可注入（now）——降级语义可用确定性测试锁定，
 *    不再依赖真实 15s 采样与真实 fs 时序；
 *  - 历史 ring buffer 有界（historySize）、统计可观测（stats）；
 *  - 通用性边界：规则只把「磁盘类关键阈值」用于降级（write-rate / file-size），
 *    CPU/内存超限只告警（避免误伤正常大请求峰值）。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, appendFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createResourceGuard,
  evaluateResourceAlerts,
  shouldEnterDegrade,
  shouldExitDegrade,
  DEFAULT_RESOURCE_LIMITS,
  DEFAULT_GUARD_INTERVAL_MS,
  DEFAULT_GUARD_HISTORY_SIZE,
  DEFAULT_GUARD_CONFIRM_COUNT,
} from '../lib/resource-guard.js'

/** 确定性时钟 + 采样序列的可控采样器。 */
function scriptedGuard(samples, options = {}) {
  let index = 0
  let clock = 1_000_000
  const guard = createResourceGuard({
    collect: () => samples[Math.min(index++, samples.length - 1)],
    now: () => (clock += 1000),
    ...options,
  })
  return guard
}

const over = () => ({ writeRateBytesPerHour: 80 * 1024 * 1024, fileBytes: 1024, cpuPercent: 1, memoryBytes: 1024 })
const normal = () => ({ writeRateBytesPerHour: 1024, fileBytes: 1024, cpuPercent: 1, memoryBytes: 1024 })
const hot = () => ({ writeRateBytesPerHour: 1024, fileBytes: 1024, cpuPercent: 99, memoryBytes: 900 * 1024 * 1024 })

test('默认常量：采样间隔 15s / 历史 60 样本 / 连续确认 3 次 / 阈值与资源规范一致', () => {
  assert.equal(DEFAULT_GUARD_INTERVAL_MS, 15000, '默认采样间隔 15s')
  assert.equal(DEFAULT_GUARD_HISTORY_SIZE, 60, '默认历史 60 样本')
  assert.equal(DEFAULT_GUARD_CONFIRM_COUNT, 3, '默认连续确认 3 次（防抖动）')
  assert.deepEqual(DEFAULT_RESOURCE_LIMITS, {
    writeRateBytesPerHour: 50 * 1024 * 1024,
    fileBytes: 50 * 1024 * 1024,
    cpuPercent: 10,
    memoryBytes: 500 * 1024 * 1024,
  })
})

test('规则纯函数：阈值边界（相等不算超限）与规则名/级别', () => {
  const limits = { writeRateBytesPerHour: 1000, fileBytes: 500, cpuPercent: 10, memoryBytes: 200 }
  assert.equal(
    evaluateResourceAlerts({ writeRateBytesPerHour: 900, fileBytes: 400, cpuPercent: 5, memoryBytes: 100 }, limits)
      .length,
    0,
    '正常样本无告警',
  )
  const rate = evaluateResourceAlerts(
    { writeRateBytesPerHour: 1001, fileBytes: 400, cpuPercent: 5, memoryBytes: 100 },
    limits,
  )
  assert.equal(rate.length, 1)
  assert.equal(rate[0].rule, 'write-rate')
  assert.equal(rate[0].level, 'error', '磁盘类告警为 error')
  assert.equal(
    evaluateResourceAlerts({ writeRateBytesPerHour: 10, fileBytes: 501, cpuPercent: 5, memoryBytes: 100 }, limits)[0]
      .rule,
    'file-size',
  )
  const both = evaluateResourceAlerts(
    { writeRateBytesPerHour: 10, fileBytes: 100, cpuPercent: 11, memoryBytes: 201 },
    limits,
  )
  assert.deepEqual(both.map((a) => a.rule).sort(), ['cpu', 'memory'])
  assert.deepEqual(
    both.map((a) => a.level),
    ['warn', 'warn'],
    'CPU/内存告警为 warn',
  )
  assert.equal(
    evaluateResourceAlerts({ writeRateBytesPerHour: 1000, fileBytes: 500, cpuPercent: 10, memoryBytes: 200 }, limits)
      .length,
    0,
    '边界相等不算超限',
  )
})

test('规则纯函数：连续确认降级/恢复（冷启动保护 + 抖动保护）', () => {
  const limits = { ...DEFAULT_RESOURCE_LIMITS, writeRateBytesPerHour: 1000, fileBytes: 500 }
  const overSample = { writeRateBytesPerHour: 2000, fileBytes: 300 }
  const normalSample = { writeRateBytesPerHour: 10, fileBytes: 100 }
  assert.equal(shouldEnterDegrade([overSample, overSample], limits), false, '样本不足不降级')
  assert.equal(shouldEnterDegrade([overSample, overSample, overSample], limits), true, '连续 3 次超限降级')
  assert.equal(shouldEnterDegrade([overSample, normalSample, overSample], limits), false, '中间正常不降级')
  assert.equal(shouldEnterDegrade([overSample, overSample, overSample], limits, 2), true, '确认次数可配置')
  assert.equal(shouldExitDegrade([normalSample, normalSample], limits), false, '样本不足不恢复')
  assert.equal(shouldExitDegrade([normalSample, normalSample, normalSample], limits), true, '连续 3 次正常恢复')
  assert.equal(shouldExitDegrade([normalSample, overSample, normalSample], limits), false, '中间超限不恢复')
})

test('guard 三态：正常 → 降级（恰好一次回调）→ 恢复（恰好一次回调）', () => {
  const events = []
  const guard = scriptedGuard([normal(), over(), over(), over(), over(), normal(), normal(), normal()], {
    onDegrade: (snapshot) => events.push(['degrade', snapshot.degraded]),
    onRecover: (snapshot) => events.push(['recover', snapshot.degraded]),
  })
  const statuses = []
  for (let i = 0; i < 8; i += 1) {
    const snapshot = guard.sample()
    statuses.push(snapshot.degraded)
    if (i === 0) {
      assert.deepEqual(snapshot.alerts, [], '首个样本（无窗口）不告警')
      assert.equal(snapshot.history.length, 0, '首个样本不进历史')
    }
  }
  assert.deepEqual(
    statuses,
    [false, false, false, true, true, true, true, false],
    '第 3 次连续超限进入降级，第 3 次连续正常退出',
  )
  assert.deepEqual(
    events,
    [
      ['degrade', true],
      ['recover', false],
    ],
    '降级/恢复回调各恰好一次',
  )
  assert.equal(guard.isDegraded(), false, '恢复后 isDegraded=false')
  assert.deepEqual(
    guard.stats(),
    { samples: 8, degraded: 1, recovered: 1, alerts: 4 },
    '统计可观测（4 个超限样本各 1 条告警）',
  )
})

test('guard 抖动保护：确认序列被打断则不降级/不恢复', () => {
  const events = []
  const guard = scriptedGuard(
    [over(), over(), normal(), over(), over(), over(), normal(), over(), normal(), normal(), normal()],
    {
      onDegrade: () => events.push('degrade'),
      onRecover: () => events.push('recover'),
    },
  )
  for (let i = 0; i < 11; i += 1) guard.sample()
  assert.deepEqual(events, ['degrade', 'recover'], '打断的序列不触发，稳定序列各触发一次')
})

test('guard 通用性：确认次数可配置 + 降级后稳定超限不重复触发', () => {
  const events = []
  const guard = scriptedGuard([over(), over(), over(), over(), over()], {
    enterConfirmCount: 2,
    exitConfirmCount: 2,
    onDegrade: () => events.push('degrade'),
  })
  for (let i = 0; i < 5; i += 1) guard.sample()
  assert.deepEqual(events, ['degrade'], '确认 2 次即降级，且只触发一次')
  assert.equal(guard.isDegraded(), true)
})

test('guard 边界：CPU/内存超限只告警不降级（避免误伤正常大请求峰值）', () => {
  const events = []
  const guard = scriptedGuard([hot(), hot(), hot(), hot()], { onDegrade: () => events.push('degrade') })
  let last = null
  for (let i = 0; i < 4; i += 1) last = guard.sample()
  assert.deepEqual(
    last.alerts.map((a) => a.rule),
    ['cpu', 'memory'],
    'CPU/内存超限产生告警',
  )
  assert.equal(guard.isDegraded(), false, 'CPU/内存超限不触发落盘降级')
  assert.deepEqual(events, [])
})

test('guard 历史 ring buffer 有界（historySize）+ 自定义维度透传', () => {
  const guard = scriptedGuard([normal(), normal(), normal(), normal(), normal()], { historySize: 3 })
  let last = null
  for (let i = 0; i < 5; i += 1) last = guard.sample()
  assert.equal(last.history.length, 3, '历史样本数不超过 historySize')
  const withDimension = createResourceGuard({ collect: () => ({ homeBytes: 42, fileBytes: 1 }) })
  const snapshot = withDimension.sample()
  assert.equal(snapshot.homeBytes, 42, '宿主自定义维度（如 DSH_HOME 字节）原样透传')
})

test('guard 生命周期：start/stop 幂等 + 周期采样', async () => {
  let calls = 0
  const guard = createResourceGuard({
    collect: () => {
      calls += 1
      return normal()
    },
    intervalMs: 5,
  })
  const timer = guard.start()
  assert.ok(timer, 'start 返回定时器句柄')
  assert.equal(guard.start(), timer, 'start 幂等（重复调用同一句柄）')
  await new Promise((resolve) => setTimeout(resolve, 30))
  guard.stop()
  const seen = guard.stats().samples
  assert.ok(calls >= 2, `周期采样发生（samples=${calls}）`)
  assert.ok(seen >= 2, '统计与采样次数一致')
  guard.stop()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(guard.stats().samples, seen, 'stop 后不再采样')
})

test('guard 健壮性：宿主回调抛错只 warn，不中断状态机', () => {
  const warned = []
  const guard = scriptedGuard([over(), over(), over(), over()], {
    logger: { warn: (message) => warned.push(message) },
    onDegrade: () => {
      throw new Error('host callback exploded')
    },
  })
  assert.doesNotThrow(() => {
    for (let i = 0; i < 4; i += 1) guard.sample()
  }, '回调异常不冒泡给采样方')
  assert.equal(guard.isDegraded(), true, '回调抛错后状态机仍进入降级')
  assert.ok(
    warned.some((message) => message.includes('onDegrade')),
    '回调异常有 warn 可观测',
  )
})

const samplerDir = mkdtempSync(join(tmpdir(), 'guard-sampler-'))
afterAll(() => {
  rmSync(samplerDir, { recursive: true, force: true })
})

test('createProcessSampler：进程/文件维度 + 自定义维度 + 首个样本基线（无窗口记 0）', async () => {
  const { createProcessSampler } = await import('../lib/resource-guard.js')
  mkdirSync(samplerDir, { recursive: true })
  const file = join(samplerDir, 'audit.jsonl')
  writeFileSync(file, 'x'.repeat(100))
  const sampler = createProcessSampler({ file, extra: () => ({ homeBytes: 42 }) })
  const first = sampler(null, 1_000_000)
  assert.equal(first.time, 1_000_000, 'time 用传入时钟')
  assert.equal(first.cpuPercent, 0, '首个样本无窗口 → CPU 记 0')
  assert.equal(first.writeRateBytesPerHour, 0, '首个样本无窗口 → 写入速率记 0')
  assert.equal(first.fileBytes, 100, '受监控文件字节')
  assert.equal(first.homeBytes, 42, '宿主自定义维度透传')
  assert.equal(typeof first.memoryBytes, 'number', 'RSS 为数值')
  appendFileSync(file, 'y'.repeat(1024))
  const second = sampler(first, 1_001_000)
  assert.equal(second.writeRateBytesPerHour, (1024 / 1000) * 3600 * 1000, '写入速率 = 增量/窗口（字节/小时）')
  assert.equal(second.fileBytes, 1124)
})

test('createProcessSampler：文件缺失与自定义维度抛错都不影响主维度（best-effort）', async () => {
  const { createProcessSampler } = await import('../lib/resource-guard.js')
  const sampler = createProcessSampler({
    file: join(samplerDir, 'missing.jsonl'),
    extra: () => {
      throw new Error('extra exploded')
    },
  })
  const sample = sampler(null, 5)
  assert.equal(sample.fileBytes, 0, '文件缺失 → 0 字节（不抛错）')
  assert.equal(sample.homeBytes, undefined, '自定义维度抛错 → 该维度缺省')
  assert.equal(typeof sample.memoryBytes, 'number', '主维度仍可用')
})

test('guard.history()：返回历史副本（外部修改不影响内部 ring buffer）', () => {
  const guard = scriptedGuard([normal(), normal(), normal()], { historySize: 10 })
  guard.sample()
  guard.sample()
  guard.sample()
  const snapshot = guard.history()
  assert.equal(snapshot.length, 2, '首样本为基线不入历史')
  snapshot.push({ cpuPercent: 999 })
  assert.equal(guard.history().length, 2, '外部修改不回写内部状态')
})

test('guard 参数校验：非法配置 fail-fast（不做静默失效的看门狗）', () => {
  assert.throws(
    () => createResourceGuard({ collect: () => normal(), intervalMs: 0 }),
    RangeError,
    'intervalMs 必须为正',
  )
  assert.throws(
    () => createResourceGuard({ collect: () => normal(), historySize: -1 }),
    RangeError,
    'historySize 必须为正',
  )
  assert.throws(
    () => createResourceGuard({ collect: () => normal(), enterConfirmCount: 0 }),
    RangeError,
    'enterConfirmCount 必须为正',
  )
  assert.throws(() => createResourceGuard({ collect: null }), TypeError, 'collect 必须为函数')
})
