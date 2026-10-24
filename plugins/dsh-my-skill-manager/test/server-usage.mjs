/**
 * dsh-my-skill-manager — 使用统计单测。
 *
 * 覆盖：路径解析、计数累加、来源记录、快照隔离、防抖落盘（drain 确定性
 * 就绪）、重启恢复、损坏文件容错、加载完成前的计数不丢、get 包装的来源
 * 判定与还原。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import {
  USAGE_FILE_NAME,
  createModelCallTracker,
  createUsageStore,
  usageFile,
  wrapSkillGet,
} from '../lib/server/usage.js'

const home = dirSync({ unsafeCleanup: true, prefix: 'dsm-usage-' }).name
process.env.DSH_HOME = home

const quiet = { warn: () => {} }

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

test('usageFile honors DSH_HOME', () => {
  assert.equal(usageFile(), join(home, USAGE_FILE_NAME))
})

test('records accumulate count, timestamp and last source', async () => {
  let now = 1000
  const store = createUsageStore({ file: join(home, 'u1.json'), logger: quiet, now: () => now })
  await store.ready()
  store.record('web-search', 'model')
  now = 2000
  store.record('web-search', 'user')
  store.record('codebase-memory', 'model')

  const snapshot = store.snapshot()
  assert.deepEqual(snapshot['web-search'], { count: 2, lastUsedAt: 2000, lastSource: 'user' })
  assert.deepEqual(snapshot['codebase-memory'], { count: 1, lastUsedAt: 2000, lastSource: 'model' })
  assert.equal(snapshot['never-loaded'], undefined)

  // 快照是拷贝：改动不反写 store
  snapshot['web-search'].count = 99
  assert.equal(store.snapshot()['web-search'].count, 2)
})

test('persists after drain and survives a restart', async () => {
  const file = join(home, 'u2.json')
  const store = createUsageStore({ file, logger: quiet })
  await store.ready()
  store.record('web-search', 'model')
  store.record('web-search', 'model')
  await store.drain()

  const raw = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(raw.skills['web-search'].count, 2)
  assert.equal(raw.skills['web-search'].lastSource, 'model')
  assert.ok(raw.skills['web-search'].lastUsedAt > 0)

  const reloaded = createUsageStore({ file, logger: quiet })
  await reloaded.ready()
  assert.equal(reloaded.snapshot()['web-search'].count, 2)
})

test('records made before the load finishes are replayed, not lost', async () => {
  const file = join(home, 'u3.json')
  writeFileSync(
    file,
    JSON.stringify({ skills: { existing: { count: 5, lastUsedAt: 7, lastSource: 'model' } } }),
    'utf8',
  )
  const store = createUsageStore({ file, logger: quiet })
  store.record('fresh', 'user') // 加载完成前记录
  await store.drain()
  const snapshot = store.snapshot()
  assert.equal(snapshot.existing.count, 5)
  assert.equal(snapshot.fresh.count, 1)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).skills.fresh.count, 1)
})

test('corrupt state degrades to an empty snapshot without throwing', async () => {
  const file = join(home, 'u4.json')
  writeFileSync(file, '{ not json', 'utf8')
  const store = createUsageStore({ file, logger: quiet })
  await store.ready()
  assert.deepEqual(store.snapshot(), {})
  store.record('web-search', 'user')
  await store.drain()
  assert.equal(store.snapshot()['web-search'].count, 1)
})

test('wrapSkillGet records model vs user loads and restores the original', async () => {
  const file = join(home, 'u5.json')
  const store = createUsageStore({ file, logger: quiet })
  await store.ready()
  const tracker = createModelCallTracker()
  const original = async (name) => (name === 'known' || name === 'other' ? { name } : undefined)
  const skills = { get: original }
  const restore = wrapSkillGet(skills, store, tracker)

  tracker.mark('known')
  assert.deepEqual(await skills.get('known'), { name: 'known' })
  await skills.get('other')
  await skills.get('missing') // 未命中不计数

  const snapshot = store.snapshot()
  assert.equal(snapshot.known.lastSource, 'model')
  assert.equal(snapshot.other.lastSource, 'user')
  assert.equal(snapshot.missing, undefined)

  restore()
  assert.equal(skills.get, original)
})

test('wrapSkillGet is a no-op when the host get is not a function', () => {
  const restore = wrapSkillGet({}, createUsageStore({ file: join(home, 'u6.json'), logger: quiet }))
  assert.equal(typeof restore, 'function')
  restore()
})
