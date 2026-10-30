/**
 * dsh-my-memory — agent 记忆的归档恢复（issue #502 修复）。
 *
 * 修复前的行为：归档把正文 rename 进 `archive/`，但索引里记的仍是逻辑名，
 * 白名单也不含 `archive/...` —— 于是面板读不到正文、GET 跳过该条目、agent
 * 也读不回来，**归档等于凭空消失**，只有手工改文件系统才能找回。这里锁死
 * 修复后的四条：
 *   1. 归档后 agent 通道仍不可读（遗忘语义不变，恢复能力不破坏"不常用不进上下文"）；
 *   2. 面板能读到归档正文，并能一键恢复（正文搬回原位 + 清归档标记）；
 *   3. GET 列表把归档项连同 `archived: true` 一起返回；
 *   4. 归档后再写同名文件即复活，不会一边归档一边可见。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 隔离的 DSH_HOME（模块级初始化；paths.ts 在调用时才读它）。 */
const home = await mkdtemp(join(tmpdir(), 'dsh-agent-memory-recovery-'))
process.env.DSH_HOME = home

process.on('exit', () => {
  void rm(home, { recursive: true, force: true })
})

/** 默认归档阈值（180 天）。 */
const ARCHIVE_MS = 180 * 24 * 60 * 60 * 1000

/** 冷记忆的模拟年龄（400 天，稳超阈值）。 */
const COLD_AGE_MS = 400 * 24 * 60 * 60 * 1000

/** 每次动态导入，确保读到刚设的 DSH_HOME。 */
async function deps() {
  const paths = await import('../lib/agent-memory/paths.js')
  const indexStore = await import('../lib/agent-memory/index-store.js')
  const storeMod = await import('../lib/agent-memory/store.js')
  return { ...paths, ...indexStore, ...storeMod }
}

/** 造一个已归档的记忆，返回它的 store 与 index。 */
async function archivedFixture(name, body) {
  const { createIndexStore, createAgentMemoryStore } = await deps()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await store.write(name, body)
  index.state().files[name].createdAt = Date.now() - COLD_AGE_MS
  index.state().files[name].updatedAt = Date.now() - COLD_AGE_MS
  index.state().files[name].lastReadAt = 0
  await store.archiveCold(ARCHIVE_MS)
  return { index, store }
}

/** 走真实路由打一次请求，返回状态码与解析后的响应。 */
async function routeCall(depsOfRoute, payload) {
  const { routeAgentMemory } = await import('../lib/agent-memory/route.js')
  const captured = []
  let status = 0
  const req =
    payload === undefined
      ? { headers: {}, method: 'GET' }
      : {
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          async *[Symbol.asyncIterator]() {
            yield JSON.stringify(payload)
          },
        }
  await routeAgentMemory(
    new URL('http://dsh.internal/my-memory/api/agent-memory'),
    req,
    {
      writeHead: (code) => {
        status = code
      },
      end: (chunk) => {
        if (chunk) captured.push(chunk)
      },
    },
    depsOfRoute,
  )
  return { status, json: captured[0] ? JSON.parse(captured[0]) : null }
}

test('归档后 agent 读不到，但面板读得到正文', async () => {
  const { archivedAbsoluteOf } = await deps()
  const { store } = await archivedFixture('projects/abc123/pitfalls.md', '- 归档后仍要能看见')
  assert.ok(existsSync(archivedAbsoluteOf('projects/abc123/pitfalls.md')), '正文已移入 archive/')
  assert.equal((await store.read('projects/abc123/pitfalls.md')).ok, false, '遗忘语义不变：agent 通道不可读')
  assert.equal(await store.readForPanel('projects/abc123/pitfalls.md'), '- 归档后仍要能看见', '面板仍能看到正文')
})

test('restore 把归档正文搬回原位并清掉归档标记', async () => {
  const { archivedAbsoluteOf } = await deps()
  const name = 'projects/abc123/decisions.md'
  const { index, store } = await archivedFixture(name, '- 选 vitest 因为宿主门禁已统一')
  assert.deepEqual(await store.restore(name), { ok: true })
  assert.ok(existsSync(join(home, 'agent-memory', 'projects', 'abc123', 'decisions.md')), '正文回到原位')
  assert.ok(!existsSync(archivedAbsoluteOf(name)), '归档副本不再占位')
  assert.equal(index.metaOf(name).archivedAt, undefined, '归档标记清除')
  assert.ok(
    (await store.list()).some((item) => item.name === name),
    '恢复后重新出现在列表里',
  )
  assert.equal((await store.read(name)).ok, true, 'agent 可再次读取')
})

test('未归档的记忆 restore 给出可操作错误', async () => {
  const { createIndexStore, createAgentMemoryStore } = await deps()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await store.write('user.md', '- 还在活跃区')
  const result = await store.restore('user.md')
  assert.equal(result.ok, false)
  assert.match(result.error, /未归档/)
})

test('route GET 把归档项连同 archived 标记一起返回，POST restore 可复原', async () => {
  const { createIndexStore, createAgentMemoryStore } = await deps()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await store.write('feedback.md', '- 被纠正过的做法')
  index.state().files['feedback.md'].createdAt = Date.now() - COLD_AGE_MS
  index.state().files['feedback.md'].updatedAt = Date.now() - COLD_AGE_MS
  index.state().files['feedback.md'].lastReadAt = 0
  await store.archiveCold(ARCHIVE_MS)
  const routeDeps = { index, store }

  const listed = await routeCall(routeDeps)
  const archived = listed.json.value.items.find((item) => item.name === 'feedback.md')
  assert.equal(archived.archived, true, '归档标记暴露给面板')
  assert.equal(archived.content, '- 被纠正过的做法', '归档正文在面板可见')

  const restored = await routeCall(routeDeps, { action: 'restore', name: 'feedback.md' })
  assert.equal(restored.status, 200)
  const after = restored.json.value.items.find((item) => item.name === 'feedback.md')
  assert.equal(after.archived, false, '恢复后不再是归档态')
})

test('归档后再写同名文件即复活，不会一边归档一边可见', async () => {
  const { archivedAbsoluteOf } = await deps()
  const { index, store } = await archivedFixture('MEMORY.md', '- 旧索引')
  await store.write('MEMORY.md', '- 新索引')
  assert.equal(index.metaOf('MEMORY.md').archivedAt, undefined, '写入清掉归档标记')
  assert.equal((await store.read('MEMORY.md')).content, '- 新索引', '活跃文件是新内容')
  assert.ok(existsSync(archivedAbsoluteOf('MEMORY.md')), '旧归档副本留在 archive/（不参与可见性）')
})

test('复活（重新写入）不会被旧 createdAt 再次归档', async () => {
  const { createIndexStore, createAgentMemoryStore } = await deps()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await store.write('user.md', '- 旧内容')
  index.state().files['user.md'].createdAt = Date.now() - COLD_AGE_MS
  index.state().files['user.md'].lastReadAt = 0
  await store.write('user.md', '- 新内容')
  const moved = await store.archiveCold(ARCHIVE_MS)
  assert.deepEqual(moved, [], '刚写过的条目不算冷记忆（updatedAt 计入判定）')
  assert.equal((await store.read('user.md')).content, '- 新内容', '正文仍是新写的')
})

test('已归档条目可被删除，归档副本一并清理', async () => {
  const { archivedAbsoluteOf } = await deps()
  const { store } = await archivedFixture('feedback.md', '- 要被删掉的归档')
  assert.deepEqual(await store.remove('feedback.md'), { ok: true })
  assert.ok(!existsSync(join(home, 'agent-memory', 'feedback.md')), '活跃区无残留')
  assert.ok(!existsSync(archivedAbsoluteOf('feedback.md')), '归档副本一并清理')
})
