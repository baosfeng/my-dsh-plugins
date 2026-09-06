/**
 * dsh-my-memory — issue #78 candidate store + confirm/dismiss API tests:
 * candidates live separately from memories, confirm merges progressively
 * (confidence up / conflict marker), dismiss drops without touching memory,
 * every write requires the user-consent marker, and apply() wires the
 * auto-extraction listener (session/event → agent/status idle) feeding the
 * pending list only when autoLearn is on.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { apply } from '../lib/index.js'
import { candidateMemoryFile, createCandidatesStore } from '../lib/store.js'

const dir = mkdtempSync(join(tmpdir(), 'dmm-cand-test-'))
process.env.DSH_HOME = dir
const homes = []

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

function makeResponse() {
  return {
    _status: 0,
    _body: '',
    writeHead(status) {
      this._status = status
    },
    end(body) {
      this._body = body ?? ''
    },
  }
}

function makeRequest(method, url, body, overrides) {
  const req = {
    method,
    url,
    headers: {
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:3080',
    },
    ...(overrides ?? {}),
    [Symbol.asyncIterator]() {
      const chunks = body === undefined ? [] : [JSON.stringify(body)]
      let i = 0
      return {
        next: () => Promise.resolve(i < chunks.length ? { value: chunks[i++], done: false } : { done: true }),
      }
    },
  }
  return req
}

function captureRoute(prefix) {
  let captured
  const holder = {
    set: (route) => {
      if (route.kind === 'prefix' && route.path === prefix) captured = route
    },
    get: () => captured,
  }
  return holder
}

/** Boot the plugin against a mock ctx; returns route + registered listeners.
 *  `seed` (array of candidate items) is written to the candidates file BEFORE
 *  apply() so the store's startup load sees them. */
function boot(config, seed) {
  const home = mkdtempSync(join(tmpdir(), 'dmm-cand-home-'))
  homes.push(home)
  process.env.DSH_HOME = home
  if (Array.isArray(seed)) {
    const file = candidateMemoryFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ items: seed }, null, 2), 'utf8')
  }
  const apiHolder = captureRoute('/my-memory/api')
  const events = []
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    webRuntime: { trustedHosts: [] },
    webServer: {
      register: (route) => {
        apiHolder.set(route)
        return () => {}
      },
    },
    sessions: { get: () => undefined },
    systemPrompt: { section: () => () => {} },
    tools: { register: () => () => {} },
    events,
    effectCallbacks: [],
    on(name, listener) {
      events.push({ name, listener })
      return () => {}
    },
    effect(callback) {
      callback()
      return () => {}
    },
  }
  apply(ctx, config)
  return { ctx, events, getRoute: () => apiHolder.get(), home }
}

async function callRoute(getRoute, method, url, body) {
  const route = getRoute()
  assert.ok(route, 'route registered')
  const res = makeResponse()
  await route.handler(makeRequest(method, url, body), res)
  return { status: res._status, json: res._body === '' ? null : JSON.parse(res._body) }
}

/** A well-formed candidate as the extractor would produce it. */
function candidateOf(id, desc, category = 'preference', scope = 'global', at = 1000) {
  return {
    id,
    category,
    desc,
    scope,
    cwd: scope === 'project' ? join(dir, 'proj') : undefined,
    source: { sessionId: 's1', at },
    createdAt: at,
  }
}

// ── candidate store 基础 ───────────────────────────────────────────────────

test('candidates store persists separately and restores on reload', async () => {
  const file = join(dir, 'candidates-a.json')
  const store = createCandidatesStore({ file, debounceMs: 50 })
  await store.load()
  const candidate = candidateOf('cand-1', '请用中文回复', 'preference', 'global')
  const added = await store.addRaw(candidate)
  assert.equal(added.id, 'cand-1')
  assert.equal(store.list().length, 1)
  await store.flush()
  const onDisk = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(onDisk.items.length, 1, 'candidate persisted separately')
  store.dispose()

  const second = createCandidatesStore({ file, debounceMs: 50 })
  await second.load()
  assert.equal(second.list().length, 1, 'restart recovery')
  assert.equal(second.list()[0].desc, '请用中文回复')
  second.dispose()
})

test('candidates store drops malformed entries defensively', async () => {
  // 预置一个缺 category 的坏候选 → 启动 restore 时被 normalizeCandidates 丢弃
  const { getRoute } = boot({}, [{ id: 'bad', desc: '缺分类', source: {}, createdAt: 1, scope: 'global' }])
  const pending = await callRoute(getRoute, 'GET', '/my-memory/api/candidates')
  assert.deepEqual(pending.json.value.items, [], 'candidate without category is dropped')
})

test('candidateMemoryFile lives under $DSH_HOME/memory', () => {
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const file = candidateMemoryFile()
    assert.ok(file.startsWith(`${dir}/memory/`), `under memory dir: ${file}`)
    assert.ok(file.endsWith('candidates.json'))
  } finally {
    process.env.DSH_HOME = saved
  }
})

// ── confirm API：用户确认 → 渐进合并进记忆 ────────────────────────────────

test('confirm writes the candidate into the global memory (progressive merge)', async () => {
  const seedCandidate = candidateOf('cand-confirm', '回复使用中文', 'preference', 'global')
  const { getRoute } = boot({ autoLearn: true }, [seedCandidate])
  // 预置一条同主题记忆（confirms 提升置信度）
  await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'global',
    desc: '回复使用中文',
    confirmed: true,
  })

  const confirm = await callRoute(getRoute, 'POST', '/my-memory/api/candidates/confirm', {
    id: 'cand-confirm',
    confirmed: true,
  })
  assert.equal(confirm.status, 200)
  assert.equal(confirm.json.ok, true)
  assert.equal(confirm.json.value.outcome, 'reinforced', 'same theme → confidence raised')
  assert.equal(confirm.json.value.item.confidence, 2)

  // 内存中的同主题条目已被合并（confidence 2）
  const list = await callRoute(getRoute, 'GET', '/my-memory/api/memory?scope=global')
  assert.equal(list.json.value.items.length, 1, 'no duplicate row')
  assert.equal(list.json.value.items[0].confidence, 2, 'confidence raised in memory')
  // 候选已从待确认列表移除
  const pending = await callRoute(getRoute, 'GET', '/my-memory/api/candidates')
  assert.deepEqual(pending.json.value.items, [], 'confirmed candidate removed from pending')
})

test('confirm without the user-consent marker is refused (400)', async () => {
  const { getRoute } = boot()
  const r = await callRoute(getRoute, 'POST', '/my-memory/api/candidates/confirm', { id: 'cand-x' })
  assert.equal(r.status, 400)
  assert.ok(r.json.error.message.includes('confirmed'), 'consent marker required')
})

test('confirm of an unknown candidate answers 404', async () => {
  const { getRoute } = boot()
  const r = await callRoute(getRoute, 'POST', '/my-memory/api/candidates/confirm', {
    id: 'nope',
    confirmed: true,
  })
  assert.equal(r.status, 404)
})

test('confirm of a project candidate writes into the project memory', async () => {
  const projDir = join(dir, 'proj')
  mkdirSync(join(projDir, '.git'), { recursive: true })
  const seedCandidate = candidateOf('cand-proj', '本项目用 vitest', 'stack', 'project', 1000)
  const { getRoute } = boot({}, [seedCandidate])

  const confirm = await callRoute(getRoute, 'POST', '/my-memory/api/candidates/confirm', {
    id: 'cand-proj',
    confirmed: true,
  })
  assert.equal(confirm.status, 200)
  assert.equal(confirm.json.value.scope, 'project')
  assert.equal(confirm.json.value.outcome, 'added')

  const proj = await callRoute(
    getRoute,
    'GET',
    `/my-memory/api/memory?scope=project&cwd=${encodeURIComponent(projDir)}`,
  )
  assert.equal(proj.json.value.items.length, 1)
  assert.equal(proj.json.value.items[0].desc, '本项目用 vitest')
  // 分类元数据已写入
  assert.equal(proj.json.value.items[0].category, 'stack')
})

// ── dismiss API：拒绝 → 丢弃，不触碰记忆 ─────────────────────────────────

test('dismiss drops the candidate without touching any memory', async () => {
  const seedCandidate = candidateOf('cand-drop', '不想要的候选', 'fact', 'global')
  const { getRoute } = boot({}, [seedCandidate])

  const dismiss = await callRoute(getRoute, 'POST', '/my-memory/api/candidates/dismiss', {
    id: 'cand-drop',
    confirmed: true,
  })
  assert.equal(dismiss.status, 200)
  assert.equal(dismiss.json.value.removed, true)
  const pending = await callRoute(getRoute, 'GET', '/my-memory/api/candidates')
  assert.deepEqual(pending.json.value.items, [], 'dismissed candidate gone')
  const memories = await callRoute(getRoute, 'GET', '/my-memory/api/memory?scope=global')
  assert.deepEqual(memories.json.value.items, [], 'memory untouched')
})

test('dismiss also requires the user-consent marker', async () => {
  const { getRoute } = boot()
  const r = await callRoute(getRoute, 'POST', '/my-memory/api/candidates/dismiss', { id: 'cand-x' })
  assert.equal(r.status, 400)
})

// ── 自动提取触发（session/event + agent/status idle）──────────────────────

test('autoLearn off: session end does not produce candidates', async () => {
  const { events } = boot({ autoLearn: false })
  const sessionEvent = events.find((e) => e.name === 'session/event')
  const statusEvent = events.find((e) => e.name === 'agent/status')
  assert.ok(sessionEvent, 'session/event listener registered')
  assert.ok(statusEvent, 'agent/status listener registered')

  // 注入用户消息 → 会话结束（顶层 agent idle）
  sessionEvent.listener(
    { id: 's1' },
    {
      type: 'user/message',
      data: { content: [{ type: 'text', text: '请用中文回复我' }] },
    },
  )
  statusEvent.listener({ agent: { id: 's1', session: { header: { cwd: dir } }, options: {} }, status: 'idle' })
  // 等待微任务链完成
  await new Promise((resolve) => setTimeout(resolve, 20))
  const file = candidateMemoryFile()
  const store = createCandidatesStore({ file, debounceMs: 50 })
  await store.load()
  assert.deepEqual(store.list(), [], 'autoLearn off → no candidates')
  store.dispose()
})

test('autoLearn on: session end extracts candidates into the pending list', async () => {
  const { events, getRoute } = boot({ autoLearn: true })
  const sessionEvent = events.find((e) => e.name === 'session/event')
  const statusEvent = events.find((e) => e.name === 'agent/status')

  sessionEvent.listener(
    { id: 's2' },
    {
      type: 'user/message',
      data: { content: [{ type: 'text', text: '请用中文回复我' }] },
    },
  )
  sessionEvent.listener(
    { id: 's2' },
    {
      type: 'user/message',
      data: { content: [{ type: 'text', text: '本项目用 vitest 测试' }] },
    },
  )
  statusEvent.listener({
    agent: { id: 's2', session: { header: { cwd: join(dir, 'proj') } }, options: {} },
    status: 'idle',
  })
  await new Promise((resolve) => setTimeout(resolve, 20))

  const pending = await callRoute(getRoute, 'GET', '/my-memory/api/candidates')
  assert.equal(pending.json.value.items.length >= 2, true, 'candidates extracted from the session')
  const pref = pending.json.value.items.find((c) => c.category === 'preference')
  assert.ok(pref, 'preference candidate present')
  assert.ok(pref.desc.includes('请用中文回复我'))
})

test('subagent idle does not trigger extraction (top-level only)', async () => {
  const { events, getRoute } = boot({ autoLearn: true })
  const sessionEvent = events.find((e) => e.name === 'session/event')
  const statusEvent = events.find((e) => e.name === 'agent/status')

  sessionEvent.listener(
    { id: 'sub1' },
    {
      type: 'user/message',
      data: { content: [{ type: 'text', text: '请用中文回复我' }] },
    },
  )
  // 子代理：parentSession 标记 → 不提取
  statusEvent.listener({
    agent: { id: 'sub1', session: { header: { cwd: dir, parentSession: 'top' } }, options: {} },
    status: 'idle',
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const pending = await callRoute(getRoute, 'GET', '/my-memory/api/candidates')
  assert.deepEqual(pending.json.value.items, [], 'subagent end → no extraction')
})

test('plugin-injected messages are excluded from extraction', async () => {
  const { events, getRoute } = boot({ autoLearn: true })
  const sessionEvent = events.find((e) => e.name === 'session/event')
  const statusEvent = events.find((e) => e.name === 'agent/status')

  sessionEvent.listener(
    { id: 's3' },
    {
      type: 'user/message',
      data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '请用中文回复我' }] },
    },
  )
  statusEvent.listener({ agent: { id: 's3', session: { header: { cwd: dir } }, options: {} }, status: 'idle' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const pending = await callRoute(getRoute, 'GET', '/my-memory/api/candidates')
  assert.deepEqual(pending.json.value.items, [], 'plugin messages filtered out')
})

test('non-idle status transitions do not trigger extraction', async () => {
  const { events, getRoute } = boot({ autoLearn: true })
  const sessionEvent = events.find((e) => e.name === 'session/event')
  const statusEvent = events.find((e) => e.name === 'agent/status')

  sessionEvent.listener(
    { id: 's4' },
    {
      type: 'user/message',
      data: { content: [{ type: 'text', text: '请用中文回复我' }] },
    },
  )
  statusEvent.listener({ agent: { id: 's4', session: { header: { cwd: dir } }, options: {} }, status: 'running' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const pending = await callRoute(getRoute, 'GET', '/my-memory/api/candidates')
  assert.deepEqual(pending.json.value.items, [], 'non-idle → no extraction')
})
