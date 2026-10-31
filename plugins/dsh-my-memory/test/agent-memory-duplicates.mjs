/**
 * dsh-my-memory — 写入去重（issue #502 后续）。
 *
 * 背景：提示词要求「先读再写、已有同主题就合并」，但它只覆盖同一份文件——
 * 实测 67 条真实记忆里仍出现跨层重复（user.md 与本项目 pitfalls.md 写了同一
 * 句 Request Entity Too Large）。这里锁确定性护栏的边界：
 *  - 抓到：字符级近逐字重复（跨文件、同文件内部）；
 *  - 放行：正常条目、改写替换（旧条目已不在新内容里）、短句不同；
 *  - 短句完全相同仍算重复（靠精确相等，不靠阈值）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dsh-agent-memory-duplicates-'))
process.env.DSH_HOME = home
process.on('exit', () => {
  void rm(home, { recursive: true, force: true })
})

const REAL_DUPLICATE_A = '一次性读超大文件或粘贴长内容会触发 Request Entity Too Large，改分段读。'
const REAL_DUPLICATE_B = '超大文件或长内容粘贴会触发 Request Entity Too Large，改分段读。'

async function fixture() {
  const { createIndexStore } = await import('../lib/agent-memory/index-store.js')
  const { createAgentMemoryStore } = await import('../lib/agent-memory/store.js')
  const index = createIndexStore({})
  return { index, store: createAgentMemoryStore({ index }) }
}

test('相似度：实测那对几乎逐字的重复命中阈值，正常条目远低于阈值', async () => {
  const { similarity, DUPLICATE_THRESHOLD } = await import('../lib/agent-memory/duplicates.js')
  assert.ok(similarity(REAL_DUPLICATE_A, REAL_DUPLICATE_B) >= DUPLICATE_THRESHOLD)
  assert.ok(
    similarity('手机测试一律走仓库自带的 scripts/debug-cli.sh', '记账分类图标必须一一唯一，不按父级复用') <
      DUPLICATE_THRESHOLD,
  )
  assert.ok(similarity('不要写日期', '不要写数字') < DUPLICATE_THRESHOLD, '短句共用模板不算重复')
  assert.equal(similarity('用 pnpm', '用 pnpm'), 1, '短句完全相同算重复')
})

test('跨文件近逐字重复：拒写，并指出重复在哪份文件', async () => {
  const { store } = await fixture()
  assert.equal((await store.write('user.md', '- ' + REAL_DUPLICATE_B)).ok, true)
  const result = await store.write('projects/pid/pitfalls.md', '- ' + REAL_DUPLICATE_A)
  assert.equal(result.ok, false)
  assert.match(result.error, /user\.md/)
  assert.match(result.error, /重复/)
  const written = await store.read('projects/pid/pitfalls.md')
  assert.equal(written.ok, false, '被拒绝的写入没有落盘')
})

test('同一份内容内部出现两条近似条目：拒写', async () => {
  const { store } = await fixture()
  const result = await store.write('user.md', ['- ' + REAL_DUPLICATE_A, '- ' + REAL_DUPLICATE_B].join('\n'))
  assert.equal(result.ok, false)
  assert.match(result.error, /本次写入里/)
})

test('改写替换旧条目不会被自己的旧版本锁死', async () => {
  const { store } = await fixture()
  await store.write('projects/pid/decisions.md', '- 用 A 方案，因为 B 更慢而且不稳')
  const rewritten = await store.write('projects/pid/decisions.md', '- 用 C 方案，因为 D 更快更稳定更简单')
  assert.equal(rewritten.ok, true, '旧条目已被新内容替换，不应被视为重复')
})

test('正常新增（不同事实）放行，且目录/列表仍可读', async () => {
  const { store } = await fixture()
  assert.equal((await store.write('user.md', '- 交付 UI 改动要给改前→改后实测数字表')).ok, true)
  assert.equal((await store.write('feedback.md', '- 别只读代码就声明 UI 完成，要截图验收')).ok, true)
  const entries = await store.entries()
  assert.equal(entries.find((entry) => entry.name === 'user.md')?.lines.length, 1)
  assert.equal(entries.find((entry) => entry.name === 'feedback.md')?.lines.length, 1)
})
