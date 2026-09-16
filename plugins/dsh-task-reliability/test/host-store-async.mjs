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
import { existsSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
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
  return dirSync({ unsafeCleanup: true, prefix: 'tr-store-async-' }).name
}

test('saveStore：落盘不在调用路径上（I/O 项在返回后才完成）', async () => {
  const dir = tempDir()
  try {
    const store = bigStore(20000)
    const target = join(dir, 'task-reliability.json')
    const pending = saveStore(dir, store)
    assert.equal(typeof pending?.then, 'function', 'saveStore 返回 Promise（异步落盘）')
    /*
     * 判据（issue #353：绝对耗时阈值 → 行为断言）：
     * 断言的是「落盘这个 I/O **项**在 saveStore 返回之后才完成」，不是「返回耗时 < Nms」。
     * 为什么该条件下必然成立（与机器负载无关）：
     *  - 同步实现（原 writeFileSync + renameSync）在**返回前**就把目标文件写好了 → 此处必有文件；
     *  - 异步实现（fs/promises 的 writeFile + rename）两者都在 `writeChain.then(run, run)` 的
     *    微任务里，且 run 内第一个 await 之前不碰目标文件 → 目标文件在同步返回时**必然不存在**。
     * 所以本谓词与 fs 速度、CPU 负载都无关：它区分的是调用路径形态，不是快慢。
     */
    assert.equal(existsSync(target), false, '调用返回时目标文件尚未写出（写盘 I/O 不在调用路径上）')
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
