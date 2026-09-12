import { test, afterAll } from 'vitest'
/**
 * 入口上限与淘汰语义测试（issue #197 审计范围修正项）：会话数、每会话路径
 * 数、全局路径数三维上限必须「有界 + LRU 淘汰 + 可观测（计数 + warn）」；
 * 淘汰后状态仍可完整重载 —— 禁止静默丢弃。
 *
 * 上限以注入方式设为小值，直接覆盖淘汰分支（语义与默认上限一致）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../lib/store.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const dirs = []
function freshHome(tag) {
  const dir = mkdtempSync(join(tmpdir(), 'dfa-' + tag + '-'))
  dirs.push(dir)
  process.env.DSH_HOME = dir
  return dir
}

function makeLogger() {
  const warns = []
  return { warns, logger: { warn: (m) => warns.push(m) } }
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('会话数上限：超限按最久未活动 LRU 淘汰，计数与日志可观测', async () => {
  freshHome('sessions')
  const { warns, logger } = makeLogger()
  const store = createStore({ logger }, { limits: { maxSessions: 16 } })
  await sleep(300)

  for (let s = 0; s < 40; s += 1) store.record('sess-' + s, '/p/' + s + '.ts', 'read', Date.now())

  assert.equal(Object.keys(store.state.sessions).length, 16, '会话数等于上限 16')
  assert.ok(store.state.sessions['sess-39'], '最新会话保留')
  assert.ok(!store.state.sessions['sess-0'], '最旧会话被淘汰')
  assert.equal(store.state.stats.evicted.sessions, 24, '淘汰计数可观测（40-16）')
  assert.equal(store.stats().evictedSessions, 24, 'store.stats() 暴露淘汰计数')
  assert.equal(store.stats().maxSessions, 16, 'store.stats() 暴露上限')
  assert.ok(
    warns.some((m) => /evict/i.test(m) && /session/i.test(m)),
    '淘汰必须 warn 可见：' + JSON.stringify(warns.slice(0, 3)),
  )
  store.dispose()
})

test('每会话路径上限：超限 LRU 淘汰最久未活动路径，known 同步、内存有界', async () => {
  freshHome('paths')
  const { warns, logger } = makeLogger()
  const store = createStore({ logger }, { limits: { maxPathsPerSession: 50 } })
  await sleep(300)

  for (let i = 0; i < 120; i += 1) store.record('cap-session', '/c/f' + i + '.ts', 'read', Date.now())

  const session = store.state.sessions['cap-session']
  const paths = Object.keys(session.counts)
  assert.equal(paths.length, 50, '单会话路径数等于上限 50（实际 ' + paths.length + '）')
  assert.ok(paths.includes('/c/f119.ts'), '最新路径保留')
  assert.ok(!paths.includes('/c/f0.ts'), '最旧路径被淘汰')
  assert.ok(!('/c/f0.ts' in session.known), 'known 与 counts 同步淘汰')
  assert.equal(store.state.stats.evicted.paths, 70, '路径淘汰计数可观测（120-50）')
  assert.ok(
    warns.some((m) => /evict/i.test(m) && /path/i.test(m)),
    '淘汰必须 warn 可见：' + JSON.stringify(warns.slice(0, 3)),
  )
  // 被淘汰路径不再授权媒体预览（幽灵条目反例）
  const { isRecordedPath } = await import('../lib/state.js')
  assert.equal(isRecordedPath(store.state, 'cap-session', '/c/f0.ts'), false, '淘汰路径不再授权')
  assert.equal(isRecordedPath(store.state, 'cap-session', '/c/f119.ts'), true, '保留路径仍授权')
  store.dispose()
})

test('全局路径数上限：跨会话总量有界且计数可观测', async () => {
  freshHome('global')
  const { warns, logger } = makeLogger()
  const store = createStore({ logger }, { limits: { maxPathsTotal: 200, maxSessions: 64 } })
  await sleep(300)

  for (let s = 0; s < 20; s += 1) {
    for (let i = 0; i < 20; i += 1) store.record('g-' + s, '/g/' + s + '/' + i + '.ts', 'read', Date.now())
  }

  const stats = store.stats()
  assert.equal(stats.maxPathsTotal, 200, 'store.stats() 暴露全局上限')
  assert.ok(stats.pathCount <= 200, '全局路径数 ' + stats.pathCount + ' ≤ 200')
  assert.ok(store.state.stats.evicted.pathsTotal > 0, '全局淘汰计数可观测')
  assert.equal(stats.evictedPathsTotal, store.state.stats.evicted.pathsTotal, 'stats 与 state 计数一致')
  assert.ok(
    warns.some((m) => /evict/i.test(m) && /globally/i.test(m)),
    '全局淘汰必须 warn 可见：' + JSON.stringify(warns.slice(0, 3)),
  )
  store.dispose()
})

test('淘汰后完整重载：盘面与内存态一致、不超上限、计数语义不变', async () => {
  freshHome('reload')
  const { logger } = makeLogger()
  const store = createStore({ logger }, { limits: { maxSessions: 32, maxPathsPerSession: 20 } })
  await sleep(300)
  for (let s = 0; s < 80; s += 1) {
    for (let i = 0; i < 12; i += 1) store.record('r-' + s, '/r/' + s + '/' + i + '.ts', 'read', Date.now())
  }
  await sleep(900)
  store.dispose()
  await sleep(400)

  const store2 = createStore({ logger: { warn: () => {} } }, { limits: { maxSessions: 32, maxPathsPerSession: 20 } })
  await sleep(400)
  assert.ok(Object.keys(store2.state.sessions).length <= 32, '重载后会话数有界')
  assert.ok(store2.stats().pathCount <= 32 * 20, '重载后全局路径数有界')
  const kept = store2.state.sessions['r-79']
  assert.ok(kept && kept.counts['/r/79/11.ts'], '最新数据重载后仍在')
  assert.equal(kept.counts['/r/79/11.ts'].read, 1, '计数精确（不因持久化改造而漂移）')
  assert.ok(store2.state.stats.evicted.sessions > 0, '淘汰计数随状态持久化')
  store2.dispose()
})
