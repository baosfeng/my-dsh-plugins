/**
 * dsh-my-memory — 全局提示词注入测试（issue #465）。
 *
 * 钉死：单 section + 固定字面量名 + order -85；启用过滤（禁用即不注入、
 * 全禁用返回空串）；全量按序（不评分不截断，与记忆评分选择器无关）；
 * provider 读内存态 → **改动后不重新注册即生效**；provider 内零磁盘 IO。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  PROMPT_SECTION_NAME,
  PROMPT_SECTION_ORDER,
  createPromptsSection,
  renderPromptsSection,
  sortPrompts,
  truncatePromptText,
} from '../lib/prompts.js'

/** 假 store：list() 返回固定数组（与真实 store 同契约）。 */
function fakeStore(items) {
  return { list: () => items }
}

/** 一条提示词条目。 */
function prompt(id, order, text, enabled = true, createdAt = 1) {
  return { id, title: id, text, enabled, order, createdAt, updatedAt: createdAt }
}

test('exactly one section with a fixed literal name and order -85', () => {
  const section = createPromptsSection(fakeStore([]), {})
  assert.equal(section.name, 'dsh-my-memory:prompts', 'literal name (idempotency key, same-order sort key)')
  assert.equal(PROMPT_SECTION_NAME, 'dsh-my-memory:prompts')
  assert.equal(section.order, -85)
  assert.equal(PROMPT_SECTION_ORDER, -85)
  assert.equal(typeof section.text, 'function', 'text is a provider evaluated per assembly')
  assert.ok(-95 < section.order && section.order < 0, 'after memory (-95), before the persona (0)')
  assert.equal(section.text({}), '', 'no prompts → empty section (dropped by the renderer, zero cost)')
})

test('enabled=true prompts are injected in full, in order', () => {
  const section = createPromptsSection(fakeStore([prompt('b', 20, '第二条规则'), prompt('a', 10, '第一条规则')]), {})
  const text = section.text({})
  assert.ok(text.includes('## 全局提示词'), 'section header present')
  assert.ok(text.includes('第一条规则') && text.includes('第二条规则'), 'both prompts injected')
  assert.ok(text.indexOf('第一条规则') < text.indexOf('第二条规则'), 'order asc (10 before 20)')
  assert.ok(text.includes('dsh-my-memory'), 'plugin attribution present')
})

test('enabled=false is never injected (disable == no injection)', () => {
  const section = createPromptsSection(fakeStore([prompt('a', 10, '启用规则'), prompt('b', 20, '停用规则', false)]), {})
  const text = section.text({})
  assert.ok(text.includes('启用规则'))
  assert.ok(!text.includes('停用规则'), 'a disabled prompt contributes zero characters')
})

test('all prompts disabled (or all empty) → provider returns an empty string', () => {
  const allOff = createPromptsSection(
    fakeStore([prompt('a', 10, '规则一', false), prompt('b', 20, '规则二', false)]),
    {},
  )
  assert.equal(allOff.text({}), '', 'all disabled → empty string')
  const allEmpty = createPromptsSection(fakeStore([prompt('a', 10, '   ', true), prompt('b', 20, '', true)]), {})
  assert.equal(allEmpty.text({}), '', 'whitespace-only bodies are not injected')
})

test('same order sorts stably by createdAt', () => {
  const items = [prompt('late', 10, 'later', true, 200), prompt('early', 10, 'earlier', true, 100)]
  assert.deepEqual(
    sortPrompts(items).map((i) => i.id),
    ['early', 'late'],
  )
})

test('provider reads the live in-memory store — no re-registration needed (issue #465 生效契约)', () => {
  const items = [prompt('a', 10, '旧文案')]
  const section = createPromptsSection(fakeStore(items), {})
  assert.ok(section.text({}).includes('旧文案'))
  // 模拟设置页保存：store 内存态变更（写操作先改内存、再调度落盘）
  items[0] = { ...items[0], text: '新文案' }
  assert.ok(section.text({}).includes('新文案'), 'next assembly sees the new text without re-registering')
  assert.ok(!section.text({}).includes('旧文案'), 'stale text is gone')
  items.push(prompt('b', 20, '新增文案'))
  assert.ok(section.text({}).includes('新增文案'), 'an added prompt is visible on the next assembly')
  items.length = 0
  assert.equal(section.text({}), '', 'removing every prompt returns to the empty section')
})

test('the injection does NOT use the memory scoring/top-N path (structural isolation)', () => {
  // 20 条全部启用 → 必须全部注入（记忆通道会按 score 截断到 maxItems 条）
  const many = Array.from({ length: 20 }, (_, i) => prompt(`p${i}`, i, `规则${i}`))
  const text = createPromptsSection(fakeStore(many), {}).text({})
  for (let i = 0; i < 20; i += 1) {
    assert.ok(text.includes(`规则${i}`), `prompt ${i} injected uncapped`)
  }
  // 长文本必须完整注入（记忆通道会 summarize/truncate 到 maxDescLength）
  const long = `开头。${'细节。'.repeat(60)}结尾。`
  const longText = createPromptsSection(fakeStore([prompt('long', 0, long)]), {}).text({})
  assert.ok(longText.includes('结尾。'), 'the whole prompt body is injected (no summarising)')
})

test('maxPromptItems caps the injected count with a warn', () => {
  const warns = []
  const bodies = ['甲甲甲规则', '乙乙乙规则', '丙丙丙规则', '丁丁丁超出上限', '戊戊戊超出上限']
  const items = bodies.map((body, i) => prompt(`p${i}`, i, body))
  const text = createPromptsSection(fakeStore(items), { maxItems: 3, logger: { warn: (m) => warns.push(m) } }).text({})
  assert.ok(text.includes('甲甲甲规则') && text.includes('丙丙丙规则'), 'the first three are injected')
  assert.ok(!text.includes('丁丁丁'), 'beyond the cap is dropped (no partial body leaks)')
  assert.ok(!text.includes('戊戊戊'), 'the rest is dropped too')
  assert.ok(
    warns.some((w) => w.includes('maxPromptItems')),
    `a warn names the count cap: ${warns.join(' | ')}`,
  )
})

test('maxPromptLength truncates one prompt body with a warn', () => {
  const warns = []
  const section = createPromptsSection(fakeStore([prompt('a', 0, 'y'.repeat(50))]), {
    maxLength: 10,
    logger: { warn: (m) => warns.push(m) },
  })
  const text = section.text({})
  assert.ok(text.includes('y'.repeat(10) + '…'), 'keeps the head up to the cap plus the marker')
  assert.ok(!text.includes('y'.repeat(11)), 'beyond the cap is cut')
  assert.ok(
    warns.some((w) => w.includes('maxPromptLength')),
    'warn names the length cap',
  )
  assert.equal(truncatePromptText('short', 100), 'short', 'short bodies untouched')
  assert.equal(truncatePromptText('abcdef', 3), 'abc…', 'truncation marker')
  assert.equal(truncatePromptText('abcdef', 0), '', 'non-positive cap → empty')
})

test('invalid config values fall back to the defaults', () => {
  const items = Array.from({ length: 25 }, (_, i) => prompt(`p${i}`, i, `第${i}条规则`))
  const text = createPromptsSection(fakeStore(items), { maxItems: 0, maxLength: -1 }).text({})
  assert.ok(text.includes('第19条规则'), 'default 20-item cap applied (not 0, not unlimited)')
  assert.ok(!text.includes('第20条规则'), 'item 21 dropped by the default cap')
})

test('renderPromptsSection renders the given items directly', () => {
  const text = renderPromptsSection([prompt('a', 0, '正文')], { maxItems: 20, maxLength: 1000 })
  assert.ok(text.includes('正文'))
  assert.equal(renderPromptsSection([], { maxItems: 20, maxLength: 1000 }), '', 'empty list → empty text')
  assert.equal(renderPromptsSection([prompt('a', 0, 'x', false)], { maxItems: 20, maxLength: 1000 }), '')
})

test('no disk IO inside the provider (reads the in-memory store only)', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/prompts.ts', import.meta.url)), 'utf8')
  const imports = source.split('\n').filter((line) => /^import /.test(line) || /^} from /.test(line))
  for (const line of imports) {
    assert.ok(!/node:fs|from '\.\/prompts-store/.test(line), `prompt provider must not touch disk: ${line}`)
  }
  // 组装期高频路径：不允许 await/async（provider 是同步求值）
  assert.ok(!/async\s+function text|await /.test(source), 'provider stays synchronous (no IO)')
})
