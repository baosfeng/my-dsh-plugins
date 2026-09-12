/**
 * dsh-my-skill-manager — usage statistics unit tests (issue #91).
 *
 * 覆盖：计数累加/去重、来源记录、防抖持久化、重启恢复、损坏文件容错、
 * 加载完成前 record 不丢（pending 回放）。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteStats } from 'dsh-shared'
import { createUsageStore, drainUsage, flushUsage, recordUsage, usageFile, usageSnapshot } from '../lib/usage.js'

const dir = mkdtempSync(join(tmpdir(), 'dsm-usage-test-'))
process.env.DSH_HOME = dir

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const quiet = { warn: () => {} }

test('usageFile honors DSH_HOME', () => {
  assert.equal(usageFile(), join(dir, 'skills.usage.json'))
})

test('recordUsage accumulates count and updates lastUsedAt/lastSource', async () => {
  const store = createUsageStore({ file: join(dir, 'u1.json'), logger: quiet })
  await store.readyPromise
  recordUsage(store, 'web-search', 'model')
  recordUsage(store, 'web-search', 'user')
  recordUsage(store, 'codebase-memory', 'model')
  const snap = usageSnapshot(store)
  assert.equal(snap['web-search'].count, 2, 'same skill loads accumulate')
  assert.equal(snap['web-search'].lastSource, 'user', 'last source wins')
  assert.ok(snap['web-search'].lastUsedAt > 0, 'last used time recorded')
  assert.equal(snap['codebase-memory'].count, 1)
  assert.equal(snap['codebase-memory'].lastSource, 'model')
  assert.equal(snap['teach'], undefined, 'never-loaded skill absent from the snapshot')
})

test('usage persists after flush and survives a restart', async () => {
  const file = join(dir, 'u2.json')
  const store = createUsageStore({ file, logger: quiet })
  await store.readyPromise
  recordUsage(store, 'web-search', 'model')
  recordUsage(store, 'web-search', 'model')
  await flushUsage(store)
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(raw.skills['web-search'].count, 2, 'count persisted')
  assert.equal(raw.skills['web-search'].lastSource, 'model', 'source persisted')

  // 重启：新 store 从磁盘恢复
  const store2 = createUsageStore({ file, logger: quiet })
  await store2.readyPromise
  const snap = usageSnapshot(store2)
  assert.equal(snap['web-search'].count, 2, 'restart restores the count')
  assert.equal(snap['web-search'].lastSource, 'model')
  assert.ok(snap['web-search'].lastUsedAt > 0, 'restart restores the last used time')
})

test('debounced persist writes the file without an explicit flush', async () => {
  const file = join(dir, 'u3.json')
  const store = createUsageStore({ file, logger: quiet })
  await store.readyPromise
  recordUsage(store, 'web-search', 'user')
  assert.ok(!existsSync(file), 'not written before the debounce window')
  await new Promise((resolve) => setTimeout(resolve, 700))
  assert.ok(existsSync(file), 'written after the debounce window')
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(raw.skills['web-search'].count, 1)
})

test('records made before the async load are replayed (no loss)', async () => {
  const file = join(dir, 'u4.json')
  writeFileSync(file, JSON.stringify({ skills: { 'old-skill': { count: 5, lastUsedAt: 1000, lastSource: 'user' } } }))
  const store = createUsageStore({ file, logger: quiet })
  // 加载完成前立即 record（不 await readyPromise）
  recordUsage(store, 'web-search', 'model')
  await store.readyPromise
  const snap = usageSnapshot(store)
  assert.equal(snap['old-skill'].count, 5, 'disk data merged')
  assert.equal(snap['web-search'].count, 1, 'pre-load record kept')
  assert.equal(snap['web-search'].lastSource, 'model')
})

test('corrupt or malformed usage files degrade to empty state', async () => {
  const file = join(dir, 'u5.json')
  writeFileSync(file, 'not-json{{{')
  const store = createUsageStore({ file, logger: quiet })
  await store.readyPromise
  assert.deepEqual(usageSnapshot(store), {}, 'corrupt file → empty state')

  const file2 = join(dir, 'u6.json')
  writeFileSync(
    file2,
    JSON.stringify({
      skills: {
        good: { count: 3, lastUsedAt: 100, lastSource: 'model' },
        badCount: { count: 'x', lastUsedAt: 100, lastSource: 'model' },
        zeroCount: { count: 0, lastUsedAt: 100, lastSource: 'model' },
        badSource: { count: 2, lastUsedAt: 100, lastSource: 'bogus' },
      },
    }),
  )
  const store2 = createUsageStore({ file: file2, logger: quiet })
  await store2.readyPromise
  const snap = usageSnapshot(store2)
  assert.equal(snap.good.count, 3, 'valid entry kept')
  assert.equal(snap.badCount, undefined, 'non-numeric count dropped')
  assert.equal(snap.zeroCount, undefined, 'zero count dropped')
  assert.equal(snap.badSource.lastSource, 'user', 'unknown source falls back to user')
})

// ── issue #198：写入调度接入 dsh-shared createWriteScheduler ──────────────

test('drainUsage：确定性就绪信号（await 后状态必已落盘，不需要 sleep 猜防抖窗口）', async () => {
  const file = join(dir, 'u-drain.json')
  const store = createUsageStore({ file, logger: quiet })
  await store.readyPromise
  recordUsage(store, 'drain-skill', 'model')
  await drainUsage(store)
  assert.equal(existsSync(file), true, 'await drainUsage() 后文件已存在')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).skills['drain-skill'].count, 1, '内存与磁盘一致')
})

test('写入调度：防抖窗口内 100 次 recordUsage 合并为一次落盘（写次数与变更数解耦）', async () => {
  const file = join(dir, 'u-coalesce.json')
  const store = createUsageStore({ file, logger: quiet })
  await store.readyPromise
  const before = atomicWriteStats().writes
  for (let i = 0; i < 100; i += 1) recordUsage(store, 'hot-skill', 'model')
  await drainUsage(store)
  const writes = atomicWriteStats().writes - before
  assert.equal(writes, 1, '100 次高频 record → 1 次写（防抖合并），got ' + writes)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).skills['hot-skill'].count, 100, '计数不丢')
})
