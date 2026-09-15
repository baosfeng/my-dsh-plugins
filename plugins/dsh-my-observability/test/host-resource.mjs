/**
 * host-resource.mjs — 资源监控（写放大/资源超限提前发现）测试。
 *
 * 对应需求 R17与 quality-gates #11 资源护栏：
 *  - evaluateResourceAlerts 各阈值边界（纯函数）；
 *  - createResourceMonitor 采样统计（CPU/内存/审计文件字节/写入速率）；
 *  - /observability/api/resources 路由（fence + 返回结构）。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluateResourceAlerts, DEFAULT_LIMITS, shouldEnterDegrade, shouldExitDegrade } from '../lib/resource-rules.js'
import { createResourceMonitor } from '../lib/resource-monitor.js'
import { bootPlugin, mockRequest, mockResponse, invoke, jsonOf, createTempHome, cleanupHome } from './lib/helpers.mjs'

const disposeAlls = []
afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 40))

test('resource rules: 各阈值边界判定', () => {
  const limits = { ...DEFAULT_LIMITS, writeRateBytesPerHour: 1000, fileBytes: 500, cpuPercent: 10, memoryBytes: 200 }
  // 正常 → 无告警
  assert.equal(
    evaluateResourceAlerts({ writeRateBytesPerHour: 900, fileBytes: 400, cpuPercent: 5, memoryBytes: 100 }, limits)
      .length,
    0,
    '正常样本无告警',
  )
  // 写入速率超限
  const rate = evaluateResourceAlerts(
    { writeRateBytesPerHour: 1001, fileBytes: 400, cpuPercent: 5, memoryBytes: 100 },
    limits,
  )
  assert.equal(rate.length, 1)
  assert.equal(rate[0].rule, 'write-rate')
  // 文件大小超限
  const file = evaluateResourceAlerts(
    { writeRateBytesPerHour: 10, fileBytes: 501, cpuPercent: 5, memoryBytes: 100 },
    limits,
  )
  assert.equal(file[0].rule, 'file-size')
  // CPU 超限 + 内存超限（多告警并存）
  const both = evaluateResourceAlerts(
    { writeRateBytesPerHour: 10, fileBytes: 100, cpuPercent: 11, memoryBytes: 201 },
    limits,
  )
  assert.deepEqual(both.map((a) => a.rule).sort(), ['cpu', 'memory'])
  // 边界值相等 → 不算超限
  assert.equal(
    evaluateResourceAlerts({ writeRateBytesPerHour: 1000, fileBytes: 500, cpuPercent: 10, memoryBytes: 200 }, limits)
      .length,
    0,
  )
})

test('resource monitor: 采样统计（文件字节/写入速率/CPU/内存 + ring buffer）', async () => {
  const home = createTempHome()
  try {
    const handle = bootPlugin({}, { home })
    // 造审计文件（模拟已落盘数据）
    const dir = join(home, 'observability')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'audit.jsonl'), `${'x'.repeat(1024)}\n`, 'utf8')
    const monitor = createResourceMonitor(handle.ctx, { intervalMs: 20 })
    const s1 = await monitor.sample()
    assert.equal(typeof s1.cpuPercent, 'number')
    assert.equal(typeof s1.memoryBytes, 'number')
    assert.equal(s1.fileBytes, 1025, '文件字节来自审计文件')
    // 写入速率：追加后再次采样 → 速率 > 0（20ms 内写入）
    writeFileSync(join(dir, 'audit.jsonl'), `${'x'.repeat(2048)}\n`, 'utf8')
    const s2 = await monitor.sample()
    assert.ok(s2.writeRateBytesPerHour > 0, '小窗口内写入速率为正')
    assert.ok(Array.isArray(s2.history), '保留历史样本')
    assert.ok(s2.history.length >= 1)
    assert.ok(Array.isArray(s2.alerts))
    monitor.stop()
    handle.disposeAll()
  } finally {
    cleanupHome(home)
  }
})

test('resource monitor: 路由 /observability/api/resources（fence + 结构）', async () => {
  const handle = bootPlugin({})
  disposeAlls.push(handle.disposeAll)
  await settle()
  const ok = mockResponse()
  await invoke(handle.api, mockRequest({ url: '/observability/api/resources' }), ok)
  assert.equal(ok.writeHeadStatus, 200)
  const value = jsonOf(ok).value
  assert.equal(typeof value.cpuPercent, 'number')
  assert.ok(Array.isArray(value.alerts), '含告警列表')
  // fence：跨域拒绝
  const evil = mockResponse()
  await invoke(handle.api, mockRequest({ url: '/observability/api/resources', host: 'evil.example.com' }), evil)
  assert.equal(evil.writeHeadStatus, 403, '跨域拒绝')
})

test('degrade: shouldEnterDegrade 连续超限才降级（含冷启动保护）', () => {
  const limits = { ...DEFAULT_LIMITS, writeRateBytesPerHour: 1000, fileBytes: 500 }
  const over = () => ({ writeRateBytesPerHour: 2000, fileBytes: 300 })
  const normal = () => ({ writeRateBytesPerHour: 10, fileBytes: 100 })
  // 样本不足 confirmCount 不降级
  assert.equal(shouldEnterDegrade([over(), over()], limits), false, '样本不足不降级')
  // 连续 3 次超限 → 降级
  assert.equal(shouldEnterDegrade([over(), over(), over()], limits), true, '连续 3 次超限降级')
  // 中间有一次正常 → 不降级
  assert.equal(shouldEnterDegrade([over(), normal(), over()], limits), false, '中断不降级')
})

test('degrade: shouldExitDegrade 连续正常才恢复（含刚降级抖动保护）', () => {
  const limits = { ...DEFAULT_LIMITS, writeRateBytesPerHour: 1000, fileBytes: 500 }
  const over = () => ({ writeRateBytesPerHour: 2000, fileBytes: 300 })
  const normal = () => ({ writeRateBytesPerHour: 10, fileBytes: 100 })
  // 样本不足不恢复
  assert.equal(shouldExitDegrade([normal(), normal()], limits), false, '样本不足不恢复')
  // 连续 3 次正常 → 恢复
  assert.equal(shouldExitDegrade([normal(), normal(), normal()], limits), true, '连续 3 次正常恢复')
  // 中间有一次超限 → 不恢复
  assert.equal(shouldExitDegrade([normal(), over(), normal()], limits), false, '中断不恢复')
})

test('degrade: monitor 接入 onDegrade/onRecover（连续超限降级 + 连续正常恢复）', async () => {
  const home = createTempHome()
  try {
    const handle = bootPlugin({}, { home })
    const dir = join(home, 'observability')
    mkdirSync(dir, { recursive: true })
    const auditFile = join(dir, 'audit.jsonl')
    writeFileSync(auditFile, `${'x'.repeat(1024)}\n`, 'utf8')
    const signs = { degraded: 0, recovered: 0, status: '' }
    const monitor = createResourceMonitor(handle.ctx, {
      intervalMs: 1000,
      limits: { ...DEFAULT_LIMITS, writeRateBytesPerHour: 40 * 1024 * 1024, fileBytes: 50 * 1024 * 1024 },
      onDegrade: () => {
        signs.degraded += 1
        signs.status = 'degraded'
      },
      onRecover: () => {
        signs.recovered += 1
        signs.status = 'recovered'
      },
    })
    // 先做两次常规采样打底（冷启动保护需要 ≥confirm 样本才有判定）
    await monitor.sample()
    // 模拟 3 次采样窗口内写入放大：每次追加 1MB → 速率 ≈ 2GB/h > 40MB/h
    for (let i = 0; i < 3; i += 1) {
      appendFileSync(auditFile, `${'y'.repeat(1024 * 1024)}\n`, 'utf8')
      await monitor.sample()
    }
    assert.equal(monitor.isDegraded(), true, '连续超限后进入降级')
    assert.equal(signs.degraded, 1, 'onDegrade 恰好触发一次')

    // 恢复正常：连续 3 次小写入 → 速率 < 阈值 → 恢复
    writeFileSync(auditFile, `${'x'.repeat(100)}\n`, 'utf8')
    for (let i = 0; i < 3; i += 1) {
      await settle()
      await monitor.sample()
    }
    assert.equal(monitor.isDegraded(), false, '连续正常后退出降级')
    assert.equal(signs.recovered, 1, 'onRecover 恰好触发一次')
    monitor.stop()
    handle.disposeAll()
  } finally {
    cleanupHome(home)
  }
})
