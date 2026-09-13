/**
 * host-write-scheduler.mjs — dsh-my-memory 落盘接入 dsh-shared 写入原语（issue #198 收尾）。
 *
 * 缺陷形态（src/store.ts 原实现）：
 *  - `atomicWrite` 自写 mkdir + `JSON.stringify(data, null, 2)` + tmp/rename：
 *    **无人读的 pretty 缩进**放大文件体积，且**无字节上限**（记忆条目随使用增长，
 *    没有护栏也没有拦截计数）；
 *  - `createDebouncedStore` 自写 timer + writing 链：防抖有了，但没有最小间隔护栏、
 *    没有就绪信号统计（`createWriteScheduler` 的 `drain()`/`stats()`）。
 *
 * 本文件先 RED 后 GREEN 锁定接入后的契约。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteStats } from 'dsh-shared'
import { createStore } from '../lib/store.js'

const dirs = []
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempFile(name = 'memory.json') {
  const dir = mkdtempSync(join(tmpdir(), 'memory-sched-'))
  dirs.push(dir)
  return join(dir, name)
}

test('紧凑 JSON：落盘不再 pretty 缩进放大（仍可 JSON.parse 读回）', async () => {
  const file = tempFile()
  const store = createStore({ file, debounceMs: 0 })
  await store.add({ desc: '一条记忆', createdAt: 1, updatedAt: 1 })
  await store.flush()
  const text = readFileSync(file, 'utf8')
  assert.equal(text, JSON.stringify(JSON.parse(text)), '紧凑 JSON：与 JSON.stringify(doc) 逐字节相等')
  assert.equal(JSON.parse(text).items.length, 1, '内容完整')
})

test('接入护栏原语：落盘经 dsh-shared atomicWriteJson（计数可观测）', async () => {
  const file = tempFile()
  const store = createStore({ file, debounceMs: 0 })
  await store.add({ desc: '护栏计数', createdAt: 1, updatedAt: 1 })
  const before = atomicWriteStats().writes
  await store.flush()
  assert.ok(atomicWriteStats().writes > before, '落盘经 shared 快照原语（字节上限/拦截计数随之生效）')
})

test('写节奏：连续变更合并为一次写（防抖 + 最小间隔由调度器保证）', async () => {
  const file = tempFile()
  const store = createStore({ file, debounceMs: 0 })
  const before = atomicWriteStats().writes
  await store.add({ desc: 'a', createdAt: 1, updatedAt: 1 })
  await store.add({ desc: 'b', createdAt: 2, updatedAt: 2 })
  await store.add({ desc: 'c', createdAt: 3, updatedAt: 3 })
  await store.flush()
  assert.equal(atomicWriteStats().writes - before, 1, '3 次变更合并为 1 次写（不再逐次全量重写）')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).items.length, 3, '最终状态完整落盘')
})
