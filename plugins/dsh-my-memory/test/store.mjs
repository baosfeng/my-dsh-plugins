/**
 * dsh-my-memory — store tests: two-scope separation, atomic writes,
 * debounced persistence, restart recovery, defensive reads.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { findProjectRoot } from 'dsh-shared'
import {
  createStore,
  globalMemoryFile,
  migrateProjectMemory,
  normalizeMemory,
  projectIdOf,
  projectMemoryDir,
  projectMemoryFileOf,
  readMemoryFile,
  resolveProjectMemory,
} from '../lib/store.js'

const dir = dirSync({ unsafeCleanup: true, prefix: 'dmm-store-test-' }).name
process.env.DSH_HOME = dir

test('global and project memory files are separate paths', () => {
  assert.equal(globalMemoryFile(), `${dir}/memory.json`)
  assert.ok(projectMemoryFileOf !== undefined, 'projectMemoryFileOf exported')
})

test('findProjectRoot walks up to the nearest .git ancestor', async () => {
  const proj = join(dir, 'repo', 'sub')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(proj, '.git'), { recursive: true })
  assert.equal(await findProjectRoot(proj), join(dir, 'repo', 'sub'))
  assert.equal(await findProjectRoot(join(dir, 'no-git-here')), join(dir, 'no-git-here'), 'no .git → cwd itself')
})

test('projectMemoryFileOf resolves under $DSH_HOME/memory/projects (issue #108)', async () => {
  const proj = join(dir, 'repo2')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(proj, '.git'), { recursive: true })
  const file = await projectMemoryFileOf(proj)
  assert.ok(file.startsWith(join(dir, 'memory', 'projects') + '/'), `centralized under DSH_HOME: ${file}`)
  assert.ok(file.endsWith('.json'))
  assert.ok(!file.includes(proj), 'project root no longer contains the memory file')
})

test('projectIdOf is stable for the same root and distinct across roots', () => {
  const a = join(dir, 'id-a')
  const b = join(dir, 'id-b')
  mkdirSync(a, { recursive: true })
  mkdirSync(b, { recursive: true })
  const idA1 = projectIdOf(a)
  const idA2 = projectIdOf(a)
  const idB = projectIdOf(b)
  assert.equal(idA1, idA2, 'same root → same id')
  assert.ok(idA1 !== idB, 'different roots → different ids')
  assert.match(idA1, /^[0-9a-f]{12}$/, 'sha256 hex prefix')
  // 尾斜杠不影响 id（规范化的绝对路径）
  assert.equal(projectIdOf(`${a}/`), idA1, 'trailing slash normalized away')
})

test('resolveProjectMemory returns root, centralized file and legacy file', async () => {
  const proj = join(dir, 'repo3')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(proj, '.git'), { recursive: true })
  const resolved = await resolveProjectMemory(proj)
  assert.equal(resolved.root, proj, 'project root resolved')
  assert.equal(resolved.file, join(projectMemoryDir(), `${projectIdOf(proj)}.json`), 'centralized file')
  assert.equal(resolved.legacyFile, join(proj, '.dsh', 'memory.json'), 'legacy file under the project root')
})

test('migrateProjectMemory copies legacy data and cleans the legacy file (issue #108)', async () => {
  const proj = join(dir, 'repo4')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(join(proj, '.git'), { recursive: true })
  mkdirSync(join(proj, '.dsh'), { recursive: true })
  const legacyFile = join(proj, '.dsh', 'memory.json')
  writeFileSync(
    legacyFile,
    JSON.stringify({
      items: [
        { id: 'old-1', desc: '旧项目约定', createdAt: 1, updatedAt: 2 },
        { id: 'old-2', desc: '旧技术栈决策', createdAt: 3, updatedAt: 4 },
      ],
    }),
    'utf8',
  )
  const resolved = await resolveProjectMemory(proj)
  const migrated = await migrateProjectMemory({ file: resolved.file, legacyFile: resolved.legacyFile })
  assert.equal(migrated, true, 'migration happened')
  const onDisk = JSON.parse(readFileSync(resolved.file, 'utf8'))
  assert.equal(onDisk.items.length, 2, 'legacy items copied to the new file')
  assert.equal(onDisk.items[0].desc, '旧项目约定')
  assert.throws(() => readFileSync(resolved.legacyFile, 'utf8'), 'legacy file removed')
  // 再次迁移：新文件已存在 → 不再迁移
  const again = await migrateProjectMemory({ file: resolved.file, legacyFile: resolved.legacyFile })
  assert.equal(again, false, 'already migrated → no second migration')
})

test('migrateProjectMemory skips when the legacy file is absent or empty', async () => {
  const proj = join(dir, 'repo5')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(proj, '.git'), { recursive: true })
  const resolved = await resolveProjectMemory(proj)
  // 无旧文件 → 无迁移
  assert.equal(
    await migrateProjectMemory({ file: resolved.file, legacyFile: resolved.legacyFile }),
    false,
    'no legacy file → no migration',
  )
  // 空旧文件 → 无迁移
  const { mkdirSync: mk, writeFileSync } = await import('node:fs')
  mk(join(proj, '.dsh'), { recursive: true })
  writeFileSync(resolved.legacyFile, JSON.stringify({ items: [] }), 'utf8')
  assert.equal(
    await migrateProjectMemory({ file: resolved.file, legacyFile: resolved.legacyFile }),
    false,
    'empty legacy items → no migration',
  )
})

test('add/update/remove mutate the cache and persist after flush', async () => {
  const file = join(dir, 'mem-a.json')
  const store = createStore({ file, debounceMs: 50 })
  await store.load()
  const item = await store.add('回复使用中文', 1000)
  assert.equal(item.desc, '回复使用中文')
  assert.equal(item.createdAt, 1000)
  assert.equal(store.list().length, 1)
  const updated = await store.update(item.id, '回复必须使用中文', 2000)
  assert.equal(updated.desc, '回复必须使用中文')
  assert.equal(updated.updatedAt, 2000)
  assert.equal(await store.remove('nope'), false, 'removing a missing id returns false')
  assert.equal(await store.remove(item.id), true, 'removing an existing id returns true')
  assert.equal(store.list().length, 0)
  await store.flush()
  const onDisk = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(onDisk.items, [], 'empty list persisted')
  store.dispose()
})

test('debounce coalesces writes: flush persists the latest state', async () => {
  const file = join(dir, 'mem-b.json')
  const store = createStore({ file, debounceMs: 200 })
  await store.load()
  await store.add('第一条', 1000)
  await store.add('第二条', 2000)
  await store.add('第三条', 3000)
  // 防抖窗口内不落盘
  assert.throws(() => readFileSync(file, 'utf8'), 'no file before the debounce window elapses')
  await store.flush()
  const onDisk = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(onDisk.items.length, 3, 'all three mutations coalesced into one write')
  store.dispose()
})

test('restart recovery: a new store instance loads the persisted items', async () => {
  const file = join(dir, 'mem-c.json')
  const first = createStore({ file, debounceMs: 50 })
  await first.load()
  await first.add('重启后还在', 1000)
  await first.flush()
  first.dispose()
  const second = createStore({ file, debounceMs: 50 })
  await second.load()
  const items = second.list()
  assert.equal(items.length, 1, 'restored from disk')
  assert.equal(items[0].desc, '重启后还在')
  second.dispose()
})

test('missing and corrupt files degrade to an empty memory', async () => {
  const missing = join(dir, 'mem-missing.json')
  assert.deepEqual(await readMemoryFile(missing), { items: [] }, 'missing file → empty')
  const corrupt = join(dir, 'mem-corrupt.json')
  writeFileSync(corrupt, 'not-json{{{')
  assert.deepEqual(await readMemoryFile(corrupt), { items: [] }, 'corrupt file → empty')
})

test('normalizeMemory keeps only well-formed items', () => {
  const memory = {
    items: [
      { id: 'a', desc: '好', createdAt: 1, updatedAt: 2 },
      { id: '', desc: '坏 id', createdAt: 1, updatedAt: 2 },
      { id: 'b', desc: '', createdAt: 1, updatedAt: 2 },
      { id: 'c', desc: '坏时间', createdAt: 'x', updatedAt: 2 },
      null,
      'junk',
    ],
  }
  const normalized = normalizeMemory(memory)
  assert.equal(normalized.items.length, 1, 'only the well-formed item survives')
  assert.equal(normalized.items[0].id, 'a')
  assert.deepEqual(normalizeMemory(null), { items: [] }, 'null input → empty')
  assert.deepEqual(normalizeMemory({}), { items: [] }, 'empty object → empty')
})

test('list returns items newest-first', async () => {
  const file = join(dir, 'mem-d.json')
  const store = createStore({ file, debounceMs: 50 })
  await store.load()
  await store.add('旧', 1000)
  await store.add('新', 2000)
  const items = store.list()
  assert.equal(items[0].desc, '新', 'newest first')
  assert.equal(items[1].desc, '旧')
  store.dispose()
})

test('dispose drops pending writes without persisting', async () => {
  const file = join(dir, 'mem-e.json')
  const store = createStore({ file, debounceMs: 200 })
  await store.load()
  await store.add('不落盘', 1000)
  store.dispose()
  assert.throws(() => readFileSync(file, 'utf8'), 'dispose drops the pending write')
})

test('globalMemoryFile falls back to ~/.dsh when DSH_HOME is unset', () => {
  const saved = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    const file = globalMemoryFile()
    assert.ok(file.endsWith('/.dsh/memory.json'), `fallback path: ${file}`)
  } finally {
    process.env.DSH_HOME = saved
  }
})

test('cleanup', () => {
  rmSync(dir, { recursive: true, force: true })
})
