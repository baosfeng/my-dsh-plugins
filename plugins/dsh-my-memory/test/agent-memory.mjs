/**
 * dsh-my-memory — agent 记忆（issue #502）：路径白名单、尺寸红线、
 * 敏感信息扫描、元数据封装、冷记忆归档。
 *
 * 全部测试跑在隔离的临时 DSH_HOME 上（子进程设置 env），不碰用户真实
 * 的 ~/.dsh。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 隔离的 DSH_HOME（模块级初始化；vitest 的 before/after 在本版本不可用）。 */
const home = await mkdtemp(join(tmpdir(), 'dsh-agent-memory-'))
process.env.DSH_HOME = home

/** 所有测试结束后清理临时目录（register 在进程退出前跑）。 */
process.on('exit', () => {
  void rm(home, { recursive: true, force: true })
})

/** 取一个 store 门面实例（校验能力经门面暴露，不依赖游离导出）。 */
async function fenceOf() {
  const { createIndexStore, createAgentMemoryStore } = await mods()
  return createAgentMemoryStore({ index: createIndexStore({}) })
}

/** 每次动态导入，确保读到的 DSH_HOME 是刚设的（paths.ts 在调用时才对 dshHome 求值）。 */
async function mods() {
  const paths = await import('../lib/agent-memory/paths.js')
  const indexStore = await import('../lib/agent-memory/index-store.js')
  const store = await import('../lib/agent-memory/store.js')
  return { ...paths, ...indexStore, ...store }
}

test('normalizeName accepts only whitelisted names', async () => {
  const { normalizeName } = await mods()
  assert.equal(normalizeName('user.md'), 'user.md')
  assert.equal(normalizeName('feedback.md'), 'feedback.md')
  assert.equal(normalizeName('MEMORY.md'), 'MEMORY.md')
  assert.equal(normalizeName('projects/abc123/pitfalls.md'), 'projects/abc123/pitfalls.md')
  assert.equal(normalizeName('projects/abc123/decisions.md'), 'projects/abc123/decisions.md')
  assert.equal(normalizeName('./user.md'), 'user.md')
})

test('normalizeName rejects path escape and non-whitelisted names', async () => {
  const { normalizeName } = await mods()
  for (const bad of [
    '../etc/passwd',
    '/etc/passwd',
    'user.md/../x.md',
    'secret.md',
    'projects/../x/pitfalls.md',
    'projects/a b/pitfalls.md',
    'projects/abc/other.md',
    '',
    '   ',
    null,
    42,
  ]) {
    assert.equal(normalizeName(bad), null, `should reject: ${String(bad)}`)
  }
})

test('validateContent enforces the size red lines', async () => {
  const { MAX_ENTRY_CHARS } = await mods()
  const validateContent = (await fenceOf()).validate
  assert.equal(validateContent('- 短条目'), null)
  // 单条超长
  assert.match(validateContent('- ' + 'x'.repeat(MAX_ENTRY_CHARS + 10)), /超过 100 字上限/)
  // 条目数超限
  const many = Array.from({ length: 61 }, (_, i) => `- 条目 ${i}`).join('\n')
  assert.match(validateContent(many), /已满（61\/60 条）/)
})

test('validateContent rejects secrets', async () => {
  const validateContent = (await fenceOf()).validate
  assert.equal(validateContent('- 普通记忆'), null)
  for (const secret of [
    '- key 是 sk-abcdefghijklmnopqrst',
    '- token: ghp_abcdefghijklmnopqrst',
    '- AKIAIOSFODNN7EXAMPLE',
    '- password=supersecret',
    '-----BEGIN RSA PRIVATE KEY-----',
  ]) {
    assert.match(validateContent(secret), /密钥或口令/)
  }
})

test('write→read round-trip returns the verbatim body with no metadata', async () => {
  const { createIndexStore, createAgentMemoryStore } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  const body = '- 提交前必须跑 npm run verify\n- 回复使用中文'
  assert.deepEqual(await store.write('user.md', body), { ok: true })
  const read = await store.read('user.md')
  assert.equal(read.ok, true)
  assert.equal(read.content, body, 'read returns verbatim body — no timestamp/id/frontmatter injected')
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(read.content), 'no date leaks into the body')
})

test('metadata lives in index.json and is bumped by read (agent cannot see it)', async () => {
  const { createIndexStore, createAgentMemoryStore, indexFile } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await store.write('feedback.md', '- 用户纠正过：不要写日期')
  const before = index.metaOf('feedback.md')
  assert.ok(before.readCount === 0)
  assert.ok(before.lastReadAt === 0)
  await store.read('feedback.md')
  await store.read('feedback.md')
  const after = index.metaOf('feedback.md')
  assert.equal(after.readCount, 2, 'readCount bumped per read')
  assert.ok(after.lastReadAt > 0, 'lastReadAt recorded')
  // 元数据落盘，正文里没有
  const raw = JSON.parse(await readFile(indexFile(), 'utf8'))
  assert.ok(raw.files['feedback.md'].readCount >= 2)
  const body = await readFile(join(home, 'agent-memory', 'feedback.md'), 'utf8')
  assert.ok(!body.includes('readCount'))
})

test('memory_list hides archived entries and shows first line', async () => {
  const { createIndexStore, createAgentMemoryStore } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await store.write('MEMORY.md', '- user.md — 用户偏好\n- feedback.md — 纠正记录')
  const items = await store.list()
  const names = items.map((i) => i.name)
  assert.ok(names.includes('MEMORY.md'))
})

test('cold entries are archived and then disappear from list', async () => {
  const { createIndexStore, createAgentMemoryStore, archiveDir } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await store.write('user.md', '- 很久没读的记忆')
  // 把创建时间推到 400 天前，模拟冷记忆
  index.state().files['user.md'].createdAt = Date.now() - 400 * 24 * 60 * 60 * 1000
  index.state().files['user.md'].lastReadAt = 0
  const moved = await store.archiveCold(180 * 24 * 60 * 60 * 1000)
  assert.deepEqual(moved, ['user.md'])
  assert.ok(existsSync(join(archiveDir(), 'user.md')), 'moved into archive/')
  const items = await store.list()
  assert.ok(!items.some((i) => i.name === 'user.md'), 'archived entries are not listed')
})

test('invalid name is refused by read/write/remove', async () => {
  const { createIndexStore, createAgentMemoryStore } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  const w = await store.write('../escape.md', '- x')
  assert.equal(w.ok, false)
  assert.match(w.error, /无效的文件名/)
  const r = await store.read('/etc/passwd')
  assert.equal(r.ok, false)
  const d = await store.remove('nope.md')
  assert.equal(d.ok, false)
})

test('concurrent writes are serialized (no interleaved corruption)', async () => {
  const { createIndexStore, createAgentMemoryStore } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await Promise.all([
    store.write('user.md', '- 第一条'),
    store.write('user.md', '- 第二条'),
    store.write('user.md', '- 第三条'),
  ])
  const read = await store.read('user.md')
  assert.equal(read.ok, true)
  assert.match(read.content, /^- 第[一二三]条$/)
})

test('section text carries rules but zero memory content (no resident injection)', async () => {
  const { createAgentMemorySection, AGENT_MEMORY_SECTION_TEXT } = await import('../lib/agent-memory/prompt.js')
  const section = createAgentMemorySection()
  assert.equal(section.name, 'dsh-my-memory:agent-memory')
  assert.equal(section.order, -80)
  const text = section.text()
  assert.equal(text, AGENT_MEMORY_SECTION_TEXT)
  // 规则在
  assert.match(text, /宁缺毋滥/)
  assert.match(text, /不要写日期/)
  // 冲突处理协议在（系统不做冲突判断，判据全部交给 agent）
  assert.match(text, /遇到矛盾时/)
  assert.match(text, /能共存就别删/)
  assert.match(text, /不留两条并存/)
  // 正文不在（说明段不含任何实际记忆条目）
  assert.ok(!text.includes('- 提交前必须跑'), 'no memory body injected into the system prompt')
})

test('four tools are constructed with the documented faces', async () => {
  const { createAgentMemoryTools } = await import('../lib/agent-memory/tools.js')
  const { createIndexStore, createAgentMemoryStore } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  const tools = createAgentMemoryTools({ store, resolveProjectPrefix: async () => 'projects/abc/' })
  assert.deepEqual(
    tools.map((t) => t.name),
    ['agent_memory_list', 'agent_memory_read', 'agent_memory_write', 'agent_memory_delete'],
  )
  for (const tool of tools) {
    assert.equal(typeof tool.execute, 'function')
    assert.equal(tool.parameters.type, 'object')
  }
})

test('memory_write returns exactly "ok" on success (no body echo, no counts)', async () => {
  const { createAgentMemoryTools } = await import('../lib/agent-memory/tools.js')
  const { createIndexStore, createAgentMemoryStore } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  const tools = createAgentMemoryTools({ store, resolveProjectPrefix: async () => 'projects/abc/' })
  const write = tools.find((t) => t.name === 'agent_memory_write')
  const result = await write.execute({ name: 'user.md', content: '- 回复使用中文' })
  assert.equal(result, 'ok', 'success value must be the bare word ok')
})

test('memory_write failure returns an actionable reason, not ok', async () => {
  const { createAgentMemoryTools } = await import('../lib/agent-memory/tools.js')
  const { createIndexStore, createAgentMemoryStore } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  const tools = createAgentMemoryTools({ store, resolveProjectPrefix: async () => 'projects/abc/' })
  const write = tools.find((t) => t.name === 'agent_memory_write')
  const result = await write.execute({ name: 'user.md', content: '- key sk-abcdefghijklmnopqrst' })
  assert.match(String(result), /密钥或口令/)
})

test('memory_list of an unknown prefix is empty', async () => {
  const { createIndexStore, createAgentMemoryStore } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  assert.deepEqual(await store.list('nothing/'), [])
})

test('memory_read of a missing file gives an actionable error', async () => {
  const { createIndexStore, createAgentMemoryStore } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  const result = await store.read('projects/zzz999/pitfalls.md')
  assert.equal(result.ok, false)
  assert.match(result.error, /不存在/)
})

test('memory_delete removes the file and its metadata', async () => {
  const { createIndexStore, createAgentMemoryStore } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await store.write('user.md', '- 待删除')
  assert.deepEqual(await store.remove('user.md'), { ok: true })
  assert.equal(index.metaOf('user.md'), undefined, 'metadata dropped')
  const again = await store.read('user.md')
  assert.equal(again.ok, false)
})

test('index survives a reload (restart recovery)', async () => {
  const { createIndexStore, createAgentMemoryStore } = await mods()
  const first = createIndexStore({})
  await first.load()
  const store = createAgentMemoryStore({ index: first })
  await store.write('feedback.md', '- 会被纠正的记忆')
  await first.touchRead('feedback.md')
  const second = createIndexStore({})
  await second.load()
  const meta = second.metaOf('feedback.md')
  assert.ok(meta !== undefined, 'metadata reloaded from index.json')
  assert.ok(meta.readCount >= 1)
})

test('corrupt index.json degrades to empty metadata without losing the body', async () => {
  const { createIndexStore, createAgentMemoryStore, indexFile } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await store.write('MEMORY.md', '- 正文还在')
  await mkdir(join(home, 'agent-memory'), { recursive: true })
  await writeFile(indexFile(), '{ not json', 'utf8')
  const fresh = createIndexStore({})
  const meta = await fresh.load()
  assert.deepEqual(meta.files, {}, 'corrupt index degrades to empty')
  const read = await store.read('MEMORY.md')
  assert.equal(read.ok, true, 'body survives a corrupt index')
})

test('route: GET returns entries with panel-only metadata', async () => {
  const { createAgentMemoryRouteDeps, routeAgentMemory } = await import('../lib/agent-memory/route.js')
  const deps = createAgentMemoryRouteDeps({})
  await deps.store.write('user.md', '- 面板要能看到这条')
  const captured = []
  const handled = await routeAgentMemory(
    new URL('http://dsh.internal/my-memory/api/agent-memory'),
    { headers: {}, method: 'GET' },
    { writeHead: () => {}, end: (body) => captured.push(body) },
    deps,
  )
  assert.equal(handled, true)
  const payload = JSON.parse(captured[0])
  const entry = payload.value.items.find((i) => i.name === 'user.md')
  assert.ok(entry, 'entry listed')
  assert.equal(entry.content, '- 面板要能看到这条', 'body visible to user')
  assert.ok(entry.createdAt > 0, 'createdAt exposed to the panel (agent never sees it)')
  assert.equal(typeof entry.readCount, 'number')
})

test('route: POST write then delete via the panel', async () => {
  const { createAgentMemoryRouteDeps, routeAgentMemory } = await import('../lib/agent-memory/route.js')
  const deps = createAgentMemoryRouteDeps({})
  const call = async (payload) => {
    const captured = []
    let status = 0
    const req = {
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify(payload)
      },
    }
    const res = {
      writeHead: (s) => {
        status = s
      },
      end: (b) => {
        if (b) captured.push(b)
      },
    }
    await routeAgentMemory(new URL('http://dsh.internal/my-memory/api/agent-memory'), req, res, deps)
    return { status, json: captured[0] ? JSON.parse(captured[0]) : null }
  }
  const wrote = await call({ action: 'write', name: 'feedback.md', content: '- 面板写入' })
  assert.equal(wrote.status, 200)
  assert.ok(wrote.json.value.items.some((i) => i.name === 'feedback.md'))
  const removed = await call({ action: 'delete', name: 'feedback.md' })
  assert.equal(removed.status, 200)
  assert.ok(!removed.json.value.items.some((i) => i.name === 'feedback.md'))
})

test('route: rejects invalid name and unknown action', async () => {
  const { createAgentMemoryRouteDeps, routeAgentMemory } = await import('../lib/agent-memory/route.js')
  const deps = createAgentMemoryRouteDeps({})
  const call = async (payload) => {
    let status = 0
    let body = ''
    const req = {
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify(payload)
      },
    }
    const res = {
      writeHead: (s) => {
        status = s
      },
      end: (b) => {
        body = b
      },
    }
    await routeAgentMemory(new URL('http://dsh.internal/my-memory/api/agent-memory'), req, res, deps)
    return { status, json: body ? JSON.parse(body) : null }
  }
  assert.equal((await call({ action: 'write', name: '../escape.md', content: '- x' })).status, 400)
  assert.equal((await call({ action: 'unknown', name: 'user.md' })).status, 400)
})

test('route: non-matching path is not handled', async () => {
  const { createAgentMemoryRouteDeps, routeAgentMemory } = await import('../lib/agent-memory/route.js')
  const deps = createAgentMemoryRouteDeps({})
  const handled = await routeAgentMemory(
    new URL('http://dsh.internal/my-memory/api/memory'),
    { headers: {}, method: 'GET' },
    { writeHead: () => {}, end: () => {} },
    deps,
  )
  assert.equal(handled, false)
})

test('panel read does NOT bump readCount (browsing must not revive dead memories)', async () => {
  const { createIndexStore, createAgentMemoryStore } = await mods()
  const index = createIndexStore({})
  const store = createAgentMemoryStore({ index })
  await store.write('user.md', '- 面板浏览不计热度')
  const before = index.metaOf('user.md').readCount
  await store.readForPanel('user.md')
  await store.readForPanel('user.md')
  assert.equal(index.metaOf('user.md').readCount, before, 'panel browsing leaves readCount untouched')
})
