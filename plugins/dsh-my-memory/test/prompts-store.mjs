/**
 * dsh-my-memory — 全局提示词存储测试（issue #465）。
 *
 * 钉死与记忆的**存储隔离**（不同文件、不同结构）、种子迁移只发生一次
 * （文件已存在不补种、删除不复活）、上限截断 + warn、脏数据兜底。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import {
  createPromptsStore,
  promptsFile,
  seedPrompts,
  normalizePrompts,
  isPromptItem,
  DEFAULT_MAX_PROMPT_ITEMS,
  DEFAULT_MAX_PROMPT_LENGTH,
} from '../lib/prompts-store.js'

const dir = dirSync({ unsafeCleanup: true, prefix: 'dmm-prompts-test-' }).name
process.env.DSH_HOME = dir

test('prompts live in their own file, separate from every memory file', () => {
  assert.equal(promptsFile(), join(dir, 'memory', 'prompts.json'))
  assert.ok(!promptsFile().endsWith('memory.json'), 'not the global memory file')
  assert.ok(!promptsFile().includes('candidates'), 'not the candidates file')
  assert.ok(!promptsFile().includes('/projects/'), 'no project scope')
})

test('seed migration writes builtin:think-zh enabled once, non-destructively', async () => {
  const file = join(dir, 'seed-a.json')
  const store = createPromptsStore({ file, debounceMs: 30 })
  await store.load()
  const items = store.list()
  assert.equal(items.length, 1, 'exactly one seed item')
  assert.equal(items[0].builtin, 'builtin:think-zh')
  assert.equal(items[0].enabled, true, 'seed is enabled (behaviour-equivalent migration)')
  assert.ok(items[0].text.includes('简体中文'), 'seed text is the Chinese-thinking instruction')
  assert.ok(items[0].text.includes('思考过程'), 'seed carries the reasoning clause')
  assert.ok(Number.isFinite(items[0].order), 'seed has a numeric order')
  assert.ok(itemTs(items[0]), 'seed has timestamps')
  await store.flush()
  store.dispose()
  assert.ok(existsSync(file), 'seed persisted to disk')
})

test('an existing prompts.json is never re-seeded — not even when empty', async () => {
  const file = join(dir, 'seed-b.json')
  writeFileSync(file, JSON.stringify({ items: [] }), 'utf8')
  const store = createPromptsStore({ file, debounceMs: 30 })
  await store.load()
  assert.deepEqual(store.list(), [], 'empty items stay empty (user deleted everything)')
  store.dispose()
})

test('a deleted builtin entry does not come back after a restart', async () => {
  const file = join(dir, 'seed-c.json')
  const first = createPromptsStore({ file, debounceMs: 30 })
  await first.load()
  const id = first.list()[0].id
  assert.equal(await first.remove(id), true)
  await first.flush()
  first.dispose()
  const second = createPromptsStore({ file, debounceMs: 30 })
  await second.load()
  assert.deepEqual(second.list(), [], 'deleted builtin stays deleted (no resurrection)')
  second.dispose()
})

test('seedPrompts is pure seeding: no-op when the file exists, false when seeded', async () => {
  const file = join(dir, 'seed-d.json')
  assert.equal(await seedPrompts({ file }), true, 'seeded on a fresh file')
  assert.equal(await seedPrompts({ file }), false, 'second call is a no-op')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).items.length, 1)
})

test('add/update/remove/toggle persist and recover after a restart', async () => {
  const file = join(dir, 'crud.json')
  writeFileSync(file, JSON.stringify({ items: [] }), 'utf8')
  const store = createPromptsStore({ file, debounceMs: 30 })
  await store.load()
  const item = await store.add({ title: '风格', text: '回答要短。', order: 10 }, 1000)
  assert.equal(item.title, '风格')
  assert.equal(item.enabled, true, 'new prompts default to enabled')
  assert.equal(item.order, 10, 'explicit order honoured')
  assert.ok(item.id.startsWith('gp-'), 'prompt id prefix')
  const updated = await store.update(item.id, { text: '回答要更短。', enabled: false }, 2000)
  assert.equal(updated.text, '回答要更短。')
  assert.equal(updated.enabled, false)
  assert.equal(updated.updatedAt, 2000)
  assert.equal(updated.createdAt, 1000, 'createdAt preserved')
  assert.equal(await store.remove('gp-nope'), false, 'removing a missing id → false')
  await store.flush()
  store.dispose()
  const second = createPromptsStore({ file, debounceMs: 30 })
  await second.load()
  assert.equal(second.list().length, 1, 'restored from disk')
  assert.equal(second.list()[0].enabled, false)
  second.dispose()
})

test('reorder moves one entry up/down by swapping order values', async () => {
  const file = join(dir, 'order.json')
  writeFileSync(file, JSON.stringify({ items: [] }), 'utf8')
  const store = createPromptsStore({ file, debounceMs: 30 })
  await store.load()
  const a = await store.add({ title: 'A', text: 'a', order: 10 }, 1000)
  const b = await store.add({ title: 'B', text: 'b', order: 20 }, 1001)
  const c = await store.add({ title: 'C', text: 'c', order: 30 }, 1002)
  assert.deepEqual(ordered(store.list()), ['A', 'B', 'C'], 'insertion order by order asc')
  await store.reorder(b.id, 'up')
  assert.deepEqual(ordered(store.list()), ['B', 'A', 'C'], 'up swaps with the previous entry')
  await store.reorder(b.id, 'down')
  assert.deepEqual(ordered(store.list()), ['A', 'B', 'C'], 'down swaps back')
  await store.reorder(a.id, 'up')
  assert.deepEqual(ordered(store.list()), ['A', 'B', 'C'], 'up on the first entry is a no-op')
  await store.reorder(c.id, 'down')
  assert.deepEqual(ordered(store.list()), ['A', 'B', 'C'], 'down on the last entry is a no-op')
  assert.equal(await store.reorder('gp-nope', 'up'), false, 'unknown id → false')
  await store.flush()
  const onDisk = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(
    onDisk.items.map((i) => i.title),
    ['A', 'B', 'C'],
    'swapped order persisted',
  )
  store.dispose()
})

test('item count cap: extra prompts are dropped and never injected', async () => {
  const file = join(dir, 'cap.json')
  writeFileSync(file, JSON.stringify({ items: [] }), 'utf8')
  const warns = []
  const store = createPromptsStore({ file, debounceMs: 30, maxItems: 2, logger: { warn: (m) => warns.push(m) } })
  await store.load()
  await store.add({ title: 'A', text: 'a' }, 1)
  await store.add({ title: 'B', text: 'b' }, 2)
  const third = await store.add({ title: 'C', text: 'c' }, 3)
  assert.equal(third, null, 'add beyond the cap is refused')
  assert.equal(store.list().length, 2, 'cap holds')
  assert.ok(
    warns.some((w) => w.includes('maxPromptItems')),
    `a warn names the cap: ${warns.join(' | ')}`,
  )
  store.dispose()
})

test('plain-text prompt body is capped at maxPromptLength (truncate + warn)', async () => {
  const file = join(dir, 'len.json')
  writeFileSync(file, JSON.stringify({ items: [] }), 'utf8')
  const warns = []
  const store = createPromptsStore({ file, debounceMs: 30, maxLength: 10, logger: { warn: (m) => warns.push(m) } })
  await store.load()
  const item = await store.add({ title: '长', text: 'x'.repeat(50) }, 1)
  assert.equal(item.text.length, 10, 'text truncated to the cap')
  assert.ok(item.text.endsWith('…'), 'truncation marker present')
  assert.ok(
    warns.some((w) => w.includes('maxPromptLength')),
    `a warn names the length cap: ${warns.join(' | ')}`,
  )
  const short = await store.add({ title: '短', text: 'ok' }, 2)
  assert.equal(short.text, 'ok', 'short text untouched')
  store.dispose()
})

test('concurrent adds never exceed the cap (in-flight racers are refused)', async () => {
  const file = join(dir, 'race.json')
  writeFileSync(file, JSON.stringify({ items: [] }), 'utf8')
  const warns = []
  const store = createPromptsStore({ file, debounceMs: 30, maxItems: 1, logger: { warn: (m) => warns.push(m) } })
  const [first, second] = await Promise.all([
    store.add({ title: 'A', text: 'a' }, 1),
    store.add({ title: 'B', text: 'b' }, 2),
  ])
  const created = [first, second].filter((item) => item !== null)
  assert.equal(created.length, 1, 'exactly one concurrent add wins the cap')
  // 紧接的串行 add 也必须被拒（上限已经满了）
  assert.equal(await store.add({ title: 'C', text: 'c' }, 3), null, 'cap holds after the race')
  assert.equal(store.list().length, 1, 'never more items than the cap')
  assert.ok(warns.length >= 1, 'the refusals are reported (never silent)')
  store.dispose()
})

test('caps default to the issue spec (20 items / 1000 chars)', () => {
  assert.equal(DEFAULT_MAX_PROMPT_ITEMS, 20)
  assert.equal(DEFAULT_MAX_PROMPT_LENGTH, 1000)
})

test('item shape guards reject malformed prompt entries', () => {
  assert.equal(isPromptItem({ id: 'gp-1', title: 't', text: 'x', createdAt: 1, updatedAt: 2 }), true)
  assert.equal(isPromptItem({ id: 'gp-1', title: 't', text: '', createdAt: 1, updatedAt: 2 }), false, 'empty text')
  assert.equal(isPromptItem({ id: '', title: 't', text: 'x', createdAt: 1, updatedAt: 2 }), false, 'empty id')
  assert.equal(isPromptItem({ id: 'gp-1', title: 't', text: 'x', createdAt: 'x', updatedAt: 2 }), false, 'bad ts')
  assert.equal(isPromptItem(null), false)
  assert.equal(isPromptItem('junk'), false)
})

test('normalizePrompts fills defensive defaults and drops junk', () => {
  const normalized = normalizePrompts({
    items: [
      { id: 'gp-1', title: '保留', text: '正文', createdAt: 1, updatedAt: 2 },
      { id: 'gp-2', title: '', text: '无标题也能用', createdAt: 3, updatedAt: 4 },
      { id: 'gp-3', title: '坏', text: '', createdAt: 5, updatedAt: 6 },
      null,
      'junk',
    ],
  })
  assert.equal(normalized.items.length, 2, 'junk + empty text dropped')
  assert.equal(normalized.items[0].enabled, true, 'missing enabled → true')
  assert.equal(normalized.items[0].order, 0, 'missing order → 0')
  assert.equal(normalized.items[1].title, '', 'empty title kept as-is (text is what matters)')
  assert.deepEqual(normalizePrompts(null), { items: [] })
  assert.deepEqual(normalizePrompts({}), { items: [] })
})

test('a memory-shaped file in prompts.json position is not read as prompts', async () => {
  const file = join(dir, 'shape.json')
  // 记忆条目结构（desc/category/confidence）不是提示词条目 → 全部被丢弃
  writeFileSync(
    file,
    JSON.stringify({ items: [{ id: 'mem-1', desc: '回复使用中文', createdAt: 1, updatedAt: 2 }] }),
    'utf8',
  )
  const store = createPromptsStore({ file, debounceMs: 30 })
  await store.load()
  assert.deepEqual(store.list(), [], 'memory-shaped items are not prompts (structural isolation)')
  store.dispose()
})

test('cleanup', () => {
  rmSync(dir, { recursive: true, force: true })
})

/** 条目是否有可用的时间戳（种子断言用）。 */
function itemTs(item) {
  return Number.isFinite(item.createdAt) && Number.isFinite(item.updatedAt)
}

/** 按 order asc 排列的标题（同 order 按 createdAt）。 */
function ordered(items) {
  return items
    .slice()
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    .map((i) => i.title)
}
