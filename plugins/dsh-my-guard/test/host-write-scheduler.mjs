/**
 * host-write-scheduler.mjs — dsh-my-guard 落盘接入 dsh-shared 写入调度（issue #198 收尾）。
 *
 * 缺陷形态（src/store.ts 原实现）：自写 `persistTimer`（500ms 防抖）+ `dirtyChain` 串行链，
 * 且**没有确定性就绪信号**——调用方（测试/宿主）只能 sleep 猜落盘是否完成，teardown 的
 * 最后一次冲刷（`dispose()` → 异步写）无法被等待。快照护栏（atomicWriteJson）已在 #233 接入。
 *
 * 本文件先 RED 后 GREEN 锁定接入 `createWriteScheduler` 后的契约：
 *  - `store.drainPersist()` 是**确定性就绪信号**（await 后挂起/在飞的写都已完成）；
 *  - 窗口内多次变更合并为一次写（写放大）；
 *  - `dispose()` 冲刷后状态确实在盘上（teardown 语义，不靠 sleep）。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { dirSync } from 'tmp'
import { atomicWriteStats } from 'dsh-shared'
import { createStore, stateFile } from '../lib/store.js'

const homes = []
const oldHome = process.env.DSH_HOME
afterAll(() => {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function useHome() {
  const home = dirSync({ unsafeCleanup: true, prefix: 'guard-sched-' }).name
  homes.push(home)
  process.env.DSH_HOME = home
  return home
}

function alert(message = 'rm -rf / 触发') {
  return { time: Date.now(), type: 'destructive-command', message, severity: 'high' }
}

test('drain 就绪信号：await store.drainPersist() 后状态必在盘上', async () => {
  useHome()
  const store = createStore({})
  await store.whenReady()
  store.record(alert())
  await store.drainPersist()
  const doc = JSON.parse(readFileSync(stateFile(), 'utf8'))
  assert.equal(doc.alerts.length, 1, 'drain 后落盘（不依赖墙钟）')
})

test('写节奏：窗口内多次变更合并为一次落盘', async () => {
  useHome()
  const store = createStore({})
  await store.whenReady()
  const before = atomicWriteStats().writes
  store.record(alert('a'))
  store.record(alert('b'))
  store.record(alert('c'))
  await store.drainPersist()
  assert.equal(atomicWriteStats().writes - before, 1, '3 次变更合并为 1 次写')
  assert.equal(JSON.parse(readFileSync(stateFile(), 'utf8')).alerts.length, 3, '最终状态完整落盘')
})

test('teardown 冲刷：dispose() 之后状态在盘上（可被 drainPersist 等待）', async () => {
  useHome()
  const store = createStore({})
  await store.whenReady()
  store.record(alert('teardown 前'))
  store.dispose()
  await store.drainPersist()
  assert.equal(JSON.parse(readFileSync(stateFile(), 'utf8')).alerts.length, 1, '卸载冲刷不丢状态')
})
