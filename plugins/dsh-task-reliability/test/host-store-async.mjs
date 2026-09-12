/**
 * host-store-async.mjs — task-reliability 任务注册表落盘：同步 fs → 异步（issue #198 P2）。
 *
 * 缺陷形态（src/store.ts 原来 import { readFileSync, writeFileSync, renameSync }）：
 * 落盘在事件循环里同步执行——任务注册表随使用增长（任务 + 待确认问题累积），
 * 写盘耗时随文件线性增长，期间整个 DSH 宿主的事件循环（LLM 流、工具回调）
 * 全部停摆。当前状态文件只有几百字节所以「没炸」，但形态是错的：
 * 这是在正确性之外必须显式守住的资源维度（resource-budget-review：CPU/IO 预算）。
 *
 * 本文件先 RED 后 GREEN 锁定：
 *  - `saveStore` 返回 Promise（异步落盘），调用立即返回（写盘在后台）；
 *  - 异步写仍**完整**落盘（内容与同步版一致），无残留 tmp；
 *  - 并发/连续调用**串行化**（同一状态文件不会被两个写同时 rename 覆盖）；
 *  - 读路径（loadStore）保持同步：启动时一次读取，见 PR 的「未接入清单」。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveStore } from '../lib/store.js'

/** 造一个大状态（用于把「同步阻塞」放大到可测量）。 */
function bigStore(count, marker = 'x') {
  const tasks = []
  for (let i = 0; i < count; i += 1) {
    tasks.push({
      id: `task-${marker}-${i}`,
      sessionId: `session-${i}`,
      description: marker.repeat(200),
      status: 'active',
      mode: 'direct',
      source: 'manual',
      loopCount: 0,
      verifyCount: 0,
      lastSteerAt: 0,
      resumeAt: 0,
      createdAt: 1,
      updatedAt: 1,
    })
  }
  return {
    version: 1,
    tasks,
    questions: [],
    mode: { tracking: false, verify: false, autopilot: false, sessionAutopilot: {} },
  }
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'tr-store-async-'))
}

test('saveStore：落盘不阻塞事件循环（返回 Promise，调用立即返回）', async () => {
  const dir = tempDir()
  try {
    const store = bigStore(20000)
    const jsonBytes = Buffer.byteLength(JSON.stringify(store, null, 2))
    const started = process.hrtime.bigint()
    const pending = saveStore(dir, store)
    const syncMs = Number(process.hrtime.bigint() - started) / 1e6
    assert.equal(typeof pending?.then, 'function', 'saveStore 返回 Promise（异步落盘）')
    assert.ok(
      syncMs < 5,
      `调用返回耗时 ${syncMs.toFixed(2)}ms < 5ms（写盘在后台；JSON ${(jsonBytes / 1024 / 1024).toFixed(1)}MB）`,
    )
    await pending
    const parsed = JSON.parse(readFileSync(join(dir, 'task-reliability.json'), 'utf8'))
    assert.equal(parsed.tasks.length, 20000, '异步写仍完整落盘')
    assert.equal(parsed.tasks[19999].sessionId, 'session-19999', '内容与序列化一致')
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.includes('.tmp')),
      [],
      '无残留 tmp 文件',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('saveStore：并发调用串行化，盘上最终为最后一次状态（不丢写/不互相覆盖）', async () => {
  const dir = tempDir()
  try {
    const first = bigStore(300, 'a')
    const second = bigStore(300, 'b')
    const third = bigStore(300, 'c')
    await Promise.all([saveStore(dir, first), saveStore(dir, second), saveStore(dir, third)])
    const parsed = JSON.parse(readFileSync(join(dir, 'task-reliability.json'), 'utf8'))
    assert.equal(parsed.tasks[0].id, 'task-c-0', '最后写入的状态生效（串行链保证顺序）')
    assert.equal(parsed.tasks.length, 300)
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.includes('.tmp')),
      [],
      '并发写不残留 tmp 文件',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
