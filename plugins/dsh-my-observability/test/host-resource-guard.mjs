/**
 * host-resource-guard.mjs — observability 作为 dsh-shared createResourceGuard
 * **消费方**的行为锁定（issue #198 第三批）。
 *
 * 背景：observability 原本有一份插件私有的 resource-monitor + resource-rules
 * （15s 采样 → 阈值 → 连续 3 次确认 → 降级停落盘/恢复）。第三批把它抽成
 * dsh-shared 原语，并让 observability 改为消费方——本文件锁定两件事：
 *  1. 消费方语义**等价**（阈值口径 / 连续确认 / 冷启动保护 / 抖动保护 /
 *     降级中不重复触发 / 回调时序），且这是 shared 原语直接提供的语义；
 *  2. 改造带来的新可测性：采样源（collect）与时钟（now）可注入 → 三态行为
 *     用确定性序列锁定，不再依赖真实 fs 时序与 15s 采样；
 *  3. 真实 fs 场景下的端到端等价护栏（降级触发点、告警规则序列）。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { createResourceMonitor } from '../lib/resource-monitor.js'
import { DEFAULT_LIMITS } from '../lib/resource-rules.js'
import { bootPlugin, createTempHome, cleanupHome } from './lib/helpers.mjs'

const disposeAlls = []
afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
})

const over = () => ({ writeRateBytesPerHour: 80 * 1024 * 1024, fileBytes: 1024, cpuPercent: 1, memoryBytes: 1024 })
const normal = () => ({ writeRateBytesPerHour: 1024, fileBytes: 1024, cpuPercent: 1, memoryBytes: 1024 })

test('消费方语义：注入采样源 + 时钟 → 三态（正常/降级/恢复）确定性可测', () => {
  const script = [normal, over, over, over, over, normal, normal, normal]
  let index = 0
  let clock = 1_000_000
  const events = []
  const monitor = createResourceMonitor(
    {},
    {
      collect: () => script[Math.min(index++, script.length - 1)](),
      now: () => (clock += 1000),
      onDegrade: (snapshot) => events.push(['degrade', snapshot.degraded]),
      onRecover: (snapshot) => events.push(['recover', snapshot.degraded]),
    },
  )
  const statuses = []
  for (let i = 0; i < 8; i += 1) statuses.push(monitor.sample().degraded)
  assert.deepEqual(
    statuses,
    [false, false, false, true, true, true, true, false],
    '第 3 次连续超限进入降级，第 3 次连续正常退出（阈值/连续性语义不变）',
  )
  assert.deepEqual(
    events,
    [
      ['degrade', true],
      ['recover', false],
    ],
    '降级/恢复回调各恰好一次且回调时状态已更新',
  )
  assert.equal(monitor.isDegraded(), false)
  assert.deepEqual(monitor.stats(), { samples: 8, degraded: 1, recovered: 1, alerts: 4 }, '统计可观测（含告警计数）')
  assert.deepEqual(monitor.history().length, 7, '历史样本可读（首样本为基线不入历史）')
})

test('消费方语义：CPU/内存超限只告警不降级（落盘降级只由磁盘关键阈值触发）', () => {
  const hot = () => ({ writeRateBytesPerHour: 1024, fileBytes: 1024, cpuPercent: 99, memoryBytes: 900 * 1024 * 1024 })
  let index = 0
  const events = []
  const monitor = createResourceMonitor(
    {},
    {
      collect: () => (index++ === 0 ? normal() : hot()),
      now: () => 2_000_000 + index * 1000,
      onDegrade: () => events.push('degrade'),
    },
  )
  let last = null
  for (let i = 0; i < 4; i += 1) last = monitor.sample()
  assert.deepEqual(
    last.alerts.map((a) => a.rule),
    ['cpu', 'memory'],
    'CPU/内存超限产生告警',
  )
  assert.equal(monitor.isDegraded(), false, 'CPU/内存超限不触发落盘降级（避免误伤正常大请求峰值）')
  assert.deepEqual(events, [])
})

test('等价护栏：真实 fs 场景下降级触发点与告警规则序列（连续 3 次超限 → 连续 3 次正常）', async () => {
  const home = createTempHome()
  try {
    const handle = bootPlugin({}, { home })
    const dir = join(home, 'observability')
    mkdirSync(dir, { recursive: true })
    const auditFile = join(dir, 'audit.jsonl')
    writeFileSync(auditFile, `${'x'.repeat(1024)}\n`, 'utf8')
    const trace = []
    const monitor = createResourceMonitor(handle.ctx, {
      intervalMs: 1000,
      limits: { ...DEFAULT_LIMITS, writeRateBytesPerHour: 40 * 1024 * 1024, fileBytes: 50 * 1024 * 1024 },
      onDegrade: () => trace.push('degrade'),
      onRecover: () => trace.push('recover'),
    })
    const seen = []
    const probe = () => {
      const snapshot = monitor.sample()
      seen.push({ degraded: snapshot.degraded, rules: snapshot.alerts.map((a) => a.rule) })
      return snapshot
    }
    probe() // 基线样本
    for (let i = 0; i < 3; i += 1) {
      appendFileSync(auditFile, `${'y'.repeat(1024 * 1024)}\n`, 'utf8')
      probe()
    }
    assert.deepEqual(trace, ['degrade'], '连续 3 次超限后进入降级（触发点不变）')
    assert.equal(
      seen[3].rules[0],
      'write-rate',
      '写入速率超限告警规则与顺序不变（CPU 在短窗口也可能超限，仅告警不降级）',
    )
    assert.ok(seen[3].rules.includes('write-rate'), '含写入速率告警')
    assert.equal(seen[1].degraded, false, '第 1 个超限窗口不降级（连续确认保护）')
    assert.equal(seen[2].degraded, false, '第 2 个超限窗口不降级')
    // 恢复正常：连续 3 次小写入
    writeFileSync(auditFile, `${'x'.repeat(100)}\n`, 'utf8')
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 40))
      probe()
    }
    assert.deepEqual(trace, ['degrade', 'recover'], '连续 3 次正常后恢复（触发点不变）')
    assert.deepEqual(monitor.stats().recovered, 1)
    monitor.stop()
    handle.disposeAll()
  } finally {
    cleanupHome(home)
  }
})

test('消费方语义：恢复判定需要连续正常（中间一次超限不恢复）', () => {
  const script = [over(), over(), over(), over(), normal(), over(), normal(), normal(), normal()]
  let index = 0
  const events = []
  const monitor = createResourceMonitor(
    {},
    {
      collect: () => script[Math.min(index++, script.length - 1)],
      now: () => 3_000_000 + index * 1000,
      onDegrade: () => events.push('degrade'),
      onRecover: () => events.push('recover'),
    },
  )
  for (let i = 0; i < script.length; i += 1) monitor.sample()
  assert.deepEqual(events, ['degrade', 'recover'], '抖动序列不误触发恢复，稳定 3 次正常才恢复')
})
