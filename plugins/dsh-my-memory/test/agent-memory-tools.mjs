/**
 * dsh-my-memory — agent 记忆工具面的行为测试（issue #502 盲测修复）。
 *
 * 盲测（4 个不知情的执行者）暴露的三件事，这里各锁一条：
 *   1. `projects/<id>` 的 id 是宿主算的 hash，agent 无从得知 → 提供
 *      `projects/current/` 别名，由系统解析成当前项目；真实路径也照常可用。
 *   2. `list` 只显示正文首行会严重低估内容量（60 条显示成 1 条）→ 返回条目数。
 *   3. MEMORY.md 索引写了却没人用 → list 优先用索引行当描述（索引才有回报）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dsh-agent-memory-tools-'))
process.env.DSH_HOME = home

process.on('exit', () => {
  void rm(home, { recursive: true, force: true })
})

/** 当前项目的真实前缀（模拟宿主按项目根 hash 生成）。 */
const PROJECT_PREFIX = 'projects/hash123/'

/** 一套真实的工具 + store。 */
async function fixture() {
  const { createIndexStore } = await import('../lib/agent-memory/index-store.js')
  const { createAgentMemoryStore } = await import('../lib/agent-memory/store.js')
  const { createAgentMemoryTools } = await import('../lib/agent-memory/tools.js')
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  const tools = createAgentMemoryTools({ store, resolveProjectPrefix: async () => PROJECT_PREFIX })
  return {
    store,
    call: (cmd, params) => tools.find((tool) => tool.name === `agent_memory_${cmd}`).execute(params, {}),
  }
}

test('projects/current 解析为当前项目前缀，与真实路径指向同一份文件', async () => {
  const { call, store } = await fixture()
  assert.equal(
    await call('write', { name: 'projects/current/decisions.md', content: '- 选 vitest 因为门禁统一' }),
    'ok',
  )
  const listed = await store.list(PROJECT_PREFIX)
  assert.equal(listed.length, 1, '落在当前项目的真实前缀下')
  assert.equal(listed[0].name, `${PROJECT_PREFIX}decisions.md`)
  assert.equal(await call('read', { name: 'projects/current/decisions.md' }), '- 选 vitest 因为门禁统一')
  assert.equal(await call('read', { name: `${PROJECT_PREFIX}decisions.md` }), '- 选 vitest 因为门禁统一')
})

test('list 标出条目数，60 条不会显示成 1 条', async () => {
  const { call } = await fixture()
  const many = Array.from({ length: 60 }, (_, i) => `- 偏好 ${i + 1}`).join('\n')
  assert.equal(await call('write', { name: 'user.md', content: many }), 'ok')
  const text = await call('list', {})
  assert.match(text, /user\.md — - 偏好 1（60 条）/, '列表必须暴露真实内容量')
})

test('MEMORY.md 里写了的索引行优先于正文首行作为 list 描述', async () => {
  const { call } = await fixture()
  assert.equal(await call('write', { name: 'projects/current/pitfalls.md', content: '- 坑一\n- 坑二' }), 'ok')
  assert.equal(
    await call('write', { name: 'MEMORY.md', content: '- projects/hash123/pitfalls.md — 改构建配置前读' }),
    'ok',
  )
  const text = await call('list', {})
  assert.match(text, /projects\/hash123\/pitfalls\.md — 改构建配置前读（2 条）/, '索引描述优先')
  assert.match(text, /MEMORY\.md — 索引/, '索引文件自身给出固定说明')
})
