/**
 * dsh-shared atomicWriteJson 默认护栏测试（issue #198）。
 *
 * 背景：atomicWriteJson 此前默认「无护栏」（minIntervalMs=0 / maxBytes=Infinity），
 * 4 个调用方又都没传参数——「有参数 ≠ 有防护」，护栏形同虚设（#126 写放大事故的
 * 同源缺口）。本文件锁定「默认安全」契约：
 *
 *  - 不传 options 时：1s 节流窗口（DEFAULT_MIN_INTERVAL_MS）+ 1MB 字节上限
 *    （DEFAULT_MAX_BYTES）默认生效；
 *  - 被节流/超限：**不静默**——warn + 模块级计数（atomicWriteStats，资源观测用）；
 *  - 放宽必须显式：显式 minIntervalMs / maxBytes，或 force（退出前冲刷 /
 *    用户显式保存的「立即落盘」语义）。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteJson, atomicWriteStats, DEFAULT_MAX_BYTES, DEFAULT_MIN_INTERVAL_MS } from '../lib/persist.js'

const dirs = []
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-shared-persist-'))
  dirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

test('atomicWriteJson 默认护栏：1s 窗口内第二次写被拒（warn + 计数可外部读取）', async () => {
  const file = join(tempDir(), 'state.json')
  const warns = []
  const logger = { warn: (m) => warns.push(m) }
  const before = atomicWriteStats()
  assert.equal(DEFAULT_MIN_INTERVAL_MS, 1000, '默认节流窗口 ≥1s（issue #198 验收）')

  assert.equal(await atomicWriteJson(file, { ok: 1 }, logger, '[t]'), true, '首次写成功（无历史写时间）')
  assert.equal(await atomicWriteJson(file, { ok: 2 }, logger, '[t]'), false, '默认窗口内第二次写被拒绝')
  assert.equal(readJson(file).ok, 1, '被拒的写没有覆盖文件')

  const after = atomicWriteStats()
  assert.equal(after.writes - before.writes, 1, '只有成功落盘计入 writes')
  assert.equal(after.throttled - before.throttled, 1, '节流计数 +1（外部可读，供资源观测）')
  assert.ok(
    warns.some((m) => m.includes('throttled') && m.includes(file)),
    '节流必须 warn（不静默），got: ' + JSON.stringify(warns),
  )
})

test('atomicWriteJson 默认护栏：超过默认 1MB 的对象被拒（warn + 计数），显式放宽才可写', async () => {
  const file = join(tempDir(), 'big.json')
  const warns = []
  const logger = { warn: (m) => warns.push(m) }
  const before = atomicWriteStats()
  assert.equal(DEFAULT_MAX_BYTES, 1024 * 1024, '默认字节上限 = 1MB（issue #198 验收）')

  const big = { blob: 'x'.repeat(DEFAULT_MAX_BYTES) }
  assert.equal(await atomicWriteJson(file, big, logger, '[t]'), false, '默认超 1MB 拒绝')
  const after = atomicWriteStats()
  assert.equal(after.rejected - before.rejected, 1, '超限计数 +1（与节流区分）')
  assert.ok(
    warns.some((m) => m.includes('maxBytes')),
    '超限必须 warn（不静默），got: ' + JSON.stringify(warns),
  )

  // 显式放宽（调用方为自己的状态尺寸负责）+ force（首次写不受节流影响）
  assert.equal(
    await atomicWriteJson(file, big, logger, '[t]', { maxBytes: 4 * 1024 * 1024, force: true }),
    true,
    '显式 maxBytes 放宽后可写',
  )
  assert.equal(readJson(file).blob.length, DEFAULT_MAX_BYTES, '内容完整落盘')
})

test('atomicWriteJson：force 跳过默认节流（退出前冲刷 / 用户显式保存语义）', async () => {
  const file = join(tempDir(), 'forced.json')
  const logger = { warn() {} }
  assert.equal(await atomicWriteJson(file, { v: 1 }, logger, '[t]'), true, '首次写成功')
  assert.equal(await atomicWriteJson(file, { v: 2 }, logger, '[t]'), false, '默认节流拒绝')
  assert.equal(await atomicWriteJson(file, { v: 3 }, logger, '[t]', { force: true }), true, 'force 立即落盘')
  assert.equal(readJson(file).v, 3, 'force 写覆盖最新值')
})

test('atomicWriteJson：显式 minIntervalMs 可覆盖默认（收紧不等于不可放宽）', async () => {
  const file = join(tempDir(), 'window.json')
  const logger = { warn() {} }
  assert.equal(await atomicWriteJson(file, { v: 1 }, logger, '[t]', { minIntervalMs: 30 }), true)
  assert.equal(await atomicWriteJson(file, { v: 2 }, logger, '[t]', { minIntervalMs: 30 }), false, '30ms 窗口内被拒')
  await sleep(50)
  assert.equal(await atomicWriteJson(file, { v: 3 }, logger, '[t]', { minIntervalMs: 30 }), true, '窗口过期后可写')
  assert.equal(readJson(file).v, 3)
  // 显式 0 = 关闭节流（调用方显式承担节奏责任，如低频人工操作）
  assert.equal(await atomicWriteJson(file, { v: 4 }, logger, '[t]', { minIntervalMs: 0 }), true)
  assert.equal(await atomicWriteJson(file, { v: 5 }, logger, '[t]', { minIntervalMs: 0 }), true, '显式 0 无节流')
})

test('atomicWriteJson：节流按文件隔离（同进程多文件互不误伤）', async () => {
  const dir = tempDir()
  const logger = { warn() {} }
  const a = join(dir, 'a.json')
  const b = join(dir, 'b.json')
  assert.equal(await atomicWriteJson(a, { v: 1 }, logger, '[t]'), true)
  assert.equal(await atomicWriteJson(b, { v: 1 }, logger, '[t]'), true, '另一个文件的首次写不受 a 的窗口影响')
  assert.equal(await atomicWriteJson(a, { v: 2 }, logger, '[t]'), false, 'a 仍在其窗口内')
})

test('atomicWriteJson：onBlocked 回调携带拦截原因（调用方可据此重排/重试）', async () => {
  const file = join(tempDir(), 'blocked.json')
  const logger = { warn() {} }
  const blocked = []
  assert.equal(await atomicWriteJson(file, { v: 1 }, logger, '[t]'), true)
  assert.equal(await atomicWriteJson(file, { v: 2 }, logger, '[t]', { onBlocked: (info) => blocked.push(info) }), false)
  assert.equal(blocked.length, 1, '拦截回调被调用一次')
  assert.equal(blocked[0].reason, 'throttled')
  assert.equal(blocked[0].file, file)
  assert.equal(
    await atomicWriteJson(file, { blob: 'y'.repeat(2048) }, logger, '[t]', {
      force: true,
      maxBytes: 1024,
      onBlocked: (info) => blocked.push(info),
    }),
    false,
  )
  assert.equal(blocked[1].reason, 'too-large', '超限原因与节流区分')
  assert.ok(blocked[1].bytes > 1024, '携带实际字节数')
})
