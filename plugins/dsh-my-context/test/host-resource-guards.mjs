/**
 * dsh-my-context 资源护栏接线测试（issue #198 第一/二批）。
 *
 * 审计缺口（issue #198 现状表）：
 *  - bySession **会话数无上限**（每会话 500 条上限存在，但会话可以无限增长）；
 *  - 每会话数组用裸 splice 截断，淘汰条数不可观测；
 *  - 落盘只能靠固定 sleep 等防抖窗口（CI flaky 根因）。
 *
 * 本文件锁定接入 dsh-shared 原语后的契约：
 *  - boundedMap：会话数上限（LRU）+ 淘汰计数可读（store.stats()）；
 *  - boundList：每会话数组既有上限语义不变（FIFO 保留最新 N 条）+ 淘汰计数；
 *  - createWriteScheduler：防抖合并、串行、`whenPersisted()` 确定性就绪信号。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteStats } from 'dsh-shared'
import { bootPlugin, settle } from './lib/helpers.mjs'

const disposeAlls = []
afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
})

function boot(config, opts) {
  const handle = bootPlugin(config, opts)
  disposeAlls.push(handle.disposeAll)
  return handle
}

async function bootStore(config = {}, opts = {}) {
  const handle = boot(config, opts)
  const { createStore } = await import('../lib/store.js')
  const store = createStore(handle.ctx)
  await settle(80) // 等异步加载完成（加载信号本身不在本次范围）
  return { handle, store }
}

test('bySession 会话数上限：LRU 淘汰最旧会话 + 淘汰计数可读（审计缺口修正）', async () => {
  const { MAX_SESSIONS } = await import('../lib/constants.js')
  assert.equal(Number.isInteger(MAX_SESSIONS) && MAX_SESSIONS > 0, true, '会话数上限必须显式定义')
  const { store } = await bootStore()
  for (let i = 0; i < MAX_SESSIONS + 5; i += 1) {
    store.recordRequest('s-' + i, { turn: 1, step: 1, usage: { inputTokens: 1 } })
  }
  await store.whenPersisted()
  const stats = store.stats()
  assert.equal(stats.sessions, MAX_SESSIONS, '内存态会话数不超过上限')
  assert.equal(stats.maxSessions, MAX_SESSIONS)
  assert.equal(stats.evictedSessions, 5, '淘汰计数可读（资源观测）')
  assert.equal(store.session('s-0'), undefined, '最久未使用的会话被淘汰')
  assert.notEqual(store.session('s-' + (MAX_SESSIONS + 4)), undefined, '最新会话保留')
  // 磁盘状态同样有界（淘汰不是只在内存里）
  const onDisk = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'context', 'context.json'), 'utf8'))
  assert.equal(Object.keys(onDisk.bySession).length, MAX_SESSIONS, '落盘 JSON 的会话数同样有界')
  store.dispose()
})

test('bySession LRU：访问过的旧会话不被淘汰（最近使用优先保留）', async () => {
  const { MAX_SESSIONS } = await import('../lib/constants.js')
  const { store } = await bootStore()
  for (let i = 0; i < MAX_SESSIONS; i += 1) {
    store.recordRequest('s-' + i, { turn: 1, step: 1, usage: { inputTokens: 1 } })
  }
  store.recordRequest('s-0', { turn: 2, step: 1, usage: { inputTokens: 1 } }) // 刷新 s-0
  store.recordRequest('s-new', { turn: 1, step: 1, usage: { inputTokens: 1 } })
  await store.whenPersisted()
  assert.notEqual(store.session('s-0'), undefined, 'LRU：刚访问过的 s-0 保留')
  assert.equal(store.session('s-1'), undefined, '最久未使用的 s-1 被淘汰')
  store.dispose()
})

test('每会话数组上限保持（FIFO 保留最新 N 条）+ 淘汰计数可读', async () => {
  const { MAX_REQUESTS_PER_SESSION, MAX_ALERTS_PER_SESSION } = await import('../lib/constants.js')
  const { store } = await bootStore()
  for (let i = 0; i < MAX_REQUESTS_PER_SESSION + 100; i += 1) {
    store.recordRequest('s-1', { turn: 1, step: i, usage: { inputTokens: 1 } })
  }
  for (let i = 0; i < MAX_ALERTS_PER_SESSION + 7; i += 1) {
    store.recordAlert('s-1', { kind: 'budget', message: 'm' + i })
  }
  await store.whenPersisted()
  const session = store.session('s-1')
  assert.equal(session.requests.length, MAX_REQUESTS_PER_SESSION, '请求记录上限语义不变')
  assert.equal(session.requests[0].step, 100, 'FIFO：保留最新 N 条')
  assert.equal(session.alerts.length, MAX_ALERTS_PER_SESSION, '告警上限语义不变')
  const stats = store.stats()
  assert.equal(stats.evictedRequests, 100, '请求淘汰计数可读')
  assert.equal(stats.evictedAlerts, 7, '告警淘汰计数可读')
  store.dispose()
})

test('whenPersisted：确定性就绪信号（await 后状态必已落盘，不需要 sleep 猜窗口）', async () => {
  const { store } = await bootStore()
  store.recordRequest('s-1', { turn: 1, step: 1, usage: { inputTokens: 42 } })
  await store.whenPersisted()
  const file = join(process.env.DSH_HOME, 'context', 'context.json')
  assert.equal(existsSync(file), true, 'await whenPersisted() 后状态文件已存在')
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(parsed.bySession['s-1'].usage.inputTokens, 42, '内存与磁盘一致')
  store.dispose()
})

test('写入调度：500ms 防抖窗口内 100 次变更合并为一次落盘（写次数与变更数解耦）', async () => {
  const { store } = await bootStore()
  const before = atomicWriteStats().writes
  for (let i = 0; i < 100; i += 1) {
    store.recordRequest('s-1', { turn: 1, step: i, usage: { inputTokens: 1 } })
  }
  await store.whenPersisted()
  const writes = atomicWriteStats().writes - before
  assert.equal(writes, 1, '100 次高频变更 → 1 次写（防抖合并），got ' + writes)
  store.dispose()
})

test('dispose：退出前冲刷强制落盘（flush 路径不受节流窗口影响）', async () => {
  const { store } = await bootStore()
  const before = atomicWriteStats().writes
  store.recordRequest('s-1', { turn: 1, step: 1, usage: { inputTokens: 7 } })
  store.dispose() // 立即 teardown（不等防抖窗口）
  const file = join(process.env.DSH_HOME, 'context', 'context.json')
  // dispose 内部 flush 是异步的；用同样的调度器 drain 语义等它（waitForFinite）
  await settle(60)
  assert.equal(existsSync(file), true, 'dispose 后状态已落盘')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).bySession['s-1'].usage.inputTokens, 7)
  assert.ok(atomicWriteStats().writes - before >= 1, 'dispose 触发一次强制写')
})
