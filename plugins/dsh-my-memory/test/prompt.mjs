/**
 * dsh-my-memory — system-prompt injection tests: the section registration
 * (name/order), the provider text evaluated per assembly, and the
 * maxItems / maxDescLength caps.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createMemorySection, renderMemorySection, truncateDesc } from '../lib/prompt.js'

/** A fake global store with a fixed item list. */
function fakeStore(items) {
  return { list: () => items }
}

test('section registration: stable name, early order, provider text', () => {
  const section = createMemorySection(fakeStore([]), {})
  assert.equal(section.name, 'dsh-my-memory', 'section name stable')
  assert.equal(section.order, -95, 'order -95 (before the persona at 0 and dsh-think-zh at -90)')
  assert.equal(typeof section.text, 'function', 'text is a provider evaluated per assembly')
  assert.equal(section.text({}), '', 'empty memory renders an empty section (dropped by renderPrompt)')
})

test('section disables host interpolation: {{...}} in a memory stays literal (regression)', () => {
  const section = createMemorySection(
    fakeStore([{ id: 'a', desc: '模板写法 {{title}} 原样记录', createdAt: 1, updatedAt: 2 }]),
    {},
  )
  assert.equal(section.interpolate, false, 'memory text is user data, never a prompt template')
  assert.ok(section.text({}).includes('{{title}}'), 'double braces survive verbatim')
})

test('injected text carries the global memories the agent must carry', () => {
  const section = createMemorySection(
    fakeStore([
      { id: 'a', desc: '回复使用中文', createdAt: 1, updatedAt: 2 },
      { id: 'b', desc: '代码注释用中文', createdAt: 1, updatedAt: 2 },
    ]),
    {},
  )
  const text = section.text({})
  assert.ok(text.includes('用户记忆（全局）'), 'section header present')
  assert.ok(text.includes('回复使用中文'), 'first memory injected')
  assert.ok(text.includes('代码注释用中文'), 'second memory injected')
  assert.ok(text.includes('dsh-my-memory'), 'plugin attribution present')
})

test('maxItems caps how many memories are injected (newest first)', () => {
  // store.list() 契约：newest-first（updatedAt 降序），fakeStore 模拟该顺序
  const items = [6, 5, 4, 3, 2, 1].map((n) => ({
    id: `m${n}`,
    desc: `记忆${n}`,
    createdAt: n,
    updatedAt: n,
  }))
  const section = createMemorySection(fakeStore(items), { maxItems: 3 })
  const text = section.text({})
  assert.ok(text.includes('记忆6'), 'newest memory included')
  assert.ok(text.includes('记忆4'), 'third-newest included')
  assert.ok(!text.includes('记忆3'), 'older memories capped out')
  assert.ok(!text.includes('记忆1'), 'oldest memory capped out')
})

test('maxDescLength truncates one memory desc', () => {
  const section = createMemorySection(fakeStore([{ id: 'a', desc: 'x'.repeat(300), createdAt: 1, updatedAt: 2 }]), {
    maxDescLength: 50,
  })
  const text = section.text({})
  assert.ok(text.includes('x'.repeat(50)), 'keeps the head up to the cap')
  assert.ok(text.includes('…'), 'truncation marker present')
  assert.ok(!text.includes('x'.repeat(51)), 'beyond the cap is cut')
})

test('invalid config values fall back to the defaults', () => {
  const section = createMemorySection(fakeStore([{ id: 'a', desc: 'y'.repeat(500), createdAt: 1, updatedAt: 2 }]), {
    maxItems: 0,
    maxDescLength: -1,
  })
  const text = section.text({})
  assert.ok(text.includes('y'.repeat(200)), 'default 200-char cap applied')
  assert.ok(!text.includes('y'.repeat(201)), 'beyond the default cap is cut')
})

test('truncateDesc keeps short descs untouched', () => {
  assert.equal(truncateDesc('短', 200), '短')
  assert.equal(truncateDesc('abc', 3), 'abc')
  assert.equal(truncateDesc('abcd', 3), 'abc…')
})

test('truncateDesc cuts at the sentence boundary, never mid-sentence (issue #105)', () => {
  const desc = '回复必须使用中文。代码注释也要中文。'
  const cut = truncateDesc(desc, 10)
  assert.equal(cut, '回复必须使用中文。', 'keeps the whole first sentence')
  assert.ok(!cut.includes('代码'), 'second sentence dropped at the boundary')
})

test('injection prefers the summary (first sentence) for long multi-sentence descs (issue #105)', () => {
  const desc = '第一条很长的记忆描述。第二条解释性话语不应该注入。第三条也不需要。'
  const section = createMemorySection(fakeStore([{ id: 'a', desc, createdAt: 1, updatedAt: 2 }]), {
    maxDescLength: 30,
  })
  const text = section.text({})
  assert.ok(text.includes('第一条很长的记忆描述。'), 'first sentence injected whole')
  assert.ok(!text.includes('第二条'), 'explanation sentences not injected')
  assert.ok(!text.includes('第三条'), 'later sentences not injected')
})

test('renderMemorySection renders the picked items directly', () => {
  const text = renderMemorySection([{ id: 'a', desc: '第一条', createdAt: 1, updatedAt: 2 }], {
    maxItems: 5,
    maxDescLength: 200,
  })
  assert.ok(text.includes('第一条'))
  assert.equal(renderMemorySection([], { maxItems: 5, maxDescLength: 200 }), '', 'empty list → empty text')
})
