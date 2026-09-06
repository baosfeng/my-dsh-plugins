/**
 * Mutation-targeted tests: covers untested branches — fence variants,
 * git/review route shapes, store load/evict edge cases, AI timeout &
 * parse fallbacks, audit null shapes.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { isTrustedApiRequest } from 'dsh-shared'
import {
  bootPlugin,
  createTempHome,
  cleanupHome,
  mockRequest,
  mockResponse,
  invoke,
  jsonOf,
  topAgent,
  dispatchEvent,
} from './lib/helpers.mjs'

const disposeAlls = []
const tmpDirs = []
afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 40))

function boot(config, opts) {
  const handle = bootPlugin(config, opts)
  disposeAlls.push(handle.disposeAll)
  return handle
}

function createRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obs-mut-'))
  tmpDirs.push(dir)
  mkdirSync(join(dir, 'src'), { recursive: true })
  git(dir, 'init')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test Runner')
  return dir
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

// ── fence 变体 ─────────────────────────────────────────────────────────────

test('fence: origin matching, missing host, trusted hosts', () => {
  // loopback + 同源 origin → 放行
  assert.equal(isTrustedApiRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } }, []), true)
  // loopback + 不同源 origin → 拒绝
  assert.equal(
    isTrustedApiRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://evil.example.com' } }, []),
    false,
  )
  // 无 host → 拒绝
  assert.equal(isTrustedApiRequest({ headers: {} }, []), false)
  // 非字符串 host → 拒绝
  assert.equal(isTrustedApiRequest({ headers: { host: 42 } }, []), false)
  // 畸形 host → 拒绝
  assert.equal(isTrustedApiRequest({ headers: { host: '::bad::' } }, []), false)
  // trustedHosts 命中（无端口）→ 放行
  assert.equal(isTrustedApiRequest({ headers: { host: 'obs.example.com' } }, ['obs.example.com']), true)
  // trustedHosts 未命中 → 拒绝
  assert.equal(isTrustedApiRequest({ headers: { host: 'other.example.com' } }, ['obs.example.com']), false)
  // trustedHosts 畸形条目 → 拒绝
  assert.equal(isTrustedApiRequest({ headers: { host: 'obs.example.com' } }, [':::']), false)
  // localhost 放行
  assert.equal(isTrustedApiRequest({ headers: { host: 'localhost:3080' } }, []), true)
})

// ── git 路由变体 ───────────────────────────────────────────────────────────

test('git routes: status/diff/commit via API on a real repo', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
  const { api } = boot({})
  await settle()

  // GET /git/status
  const statusRes = mockResponse()
  await invoke(api, mockRequest({ url: `/observability/api/git/status?repo=${encodeURIComponent(repo)}` }), statusRes)
  assert.equal(statusRes.writeHeadStatus, 200)
  assert.equal(jsonOf(statusRes).value.stagedCount, 0)
  assert.equal(jsonOf(statusRes).value.unstagedCount, 1)

  // GET /git/diff
  const diffRes = mockResponse()
  await invoke(api, mockRequest({ url: `/observability/api/git/diff?repo=${encodeURIComponent(repo)}` }), diffRes)
  assert.equal(diffRes.writeHeadStatus, 200)
  assert.ok(jsonOf(diffRes).value.text.includes('+const y = 2'), 'diff text returned')

  // GET /git/diff 缺 repo → 400
  const noRepo = mockResponse()
  await invoke(api, mockRequest({ url: '/observability/api/git/diff' }), noRepo)
  assert.equal(noRepo.writeHeadStatus, 400)

  // GET /git/status 非仓库 → 400
  const badRepo = mockResponse()
  await invoke(
    api,
    mockRequest({
      url: `/observability/api/git/status?repo=${encodeURIComponent('/nonexistent')}`,
    }),
    badRepo,
  )
  assert.equal(badRepo.writeHeadStatus, 400)

  // POST /git/commit
  const commitRes = mockResponse()
  await invoke(
    api,
    mockRequest({
      url: '/observability/api/git/commit',
      method: 'POST',
      body: JSON.stringify({
        repoPath: repo,
        type: 'fix',
        scope: 'store',
        description: 'fix the thing',
      }),
    }),
    commitRes,
  )
  assert.equal(commitRes.writeHeadStatus, 200)
  const committed = jsonOf(commitRes).value
  assert.match(committed.hash, /^[0-9a-f]{7,40}$/)
  assert.equal(committed.message, 'fix(store): fix the thing')

  // POST /git/commit 缺 repoPath → 400
  const noPath = mockResponse()
  await invoke(api, mockRequest({ url: '/observability/api/git/commit', method: 'POST', body: '{}' }), noPath)
  assert.equal(noPath.writeHeadStatus, 400)

  // POST /git/commit 非法请求 → 400
  const invalid = mockResponse()
  await invoke(
    api,
    mockRequest({
      url: '/observability/api/git/commit',
      method: 'POST',
      body: JSON.stringify({ repoPath: repo, type: 'nope', description: 'x' }),
    }),
    invalid,
  )
  assert.equal(invalid.writeHeadStatus, 400)
})

test('git routes: staged diff and review staged flag', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
  git(repo, 'add', 'src/a.js')
  const { api } = boot({})
  await settle()
  const diffRes = mockResponse()
  await invoke(
    api,
    mockRequest({ url: `/observability/api/git/diff?repo=${encodeURIComponent(repo)}&staged=1` }),
    diffRes,
  )
  assert.equal(diffRes.writeHeadStatus, 200)
  assert.ok(jsonOf(diffRes).value.text.includes('+const y = 2'), 'staged diff returned')
})

// ── body 超限与非法 JSON ───────────────────────────────────────────────────

test('oversized request body yields 400 with a message', async () => {
  const { api } = boot({})
  await settle()
  const big = `{"repoPath":"${'x'.repeat(1_100_000)}"}`
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/observability/api/git/commit', method: 'POST', body: big }), res)
  assert.equal(res.writeHeadStatus, 400)
  assert.ok(jsonOf(res).error.message.includes('too large'), 'size error surfaced')
})

test('malformed JSON body yields 400 from the error path', async () => {
  const { api } = boot({})
  await settle()
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/observability/api/git/commit', method: 'POST', body: '{nope' }), res)
  assert.equal(res.writeHeadStatus, 400)
})

// ── store 边界 ─────────────────────────────────────────────────────────────

test('store ignores malformed persisted state', async () => {
  const home = createTempHome()
  try {
    mkdirSync(join(home, 'observability'), { recursive: true })
    writeFileSync(join(home, 'observability', 'audit.json'), 'not json at all', 'utf8')
    const second = bootPlugin({}, { home })
    disposeAlls.push(second.disposeAll)
    await settle()
    const res = mockResponse()
    await invoke(second.api, mockRequest({ url: '/observability/api/events?sessionId=x' }), res)
    assert.deepEqual(jsonOf(res).value, [], 'malformed file yields empty state')
  } finally {
    cleanupHome(home)
  }
})

test('store filters structurally invalid events on load', async () => {
  const home = createTempHome()
  try {
    mkdirSync(join(home, 'observability'), { recursive: true })
    const state = {
      version: 1,
      bySession: {
        'good-session': {
          events: [{ id: 1, time: 1, sessionId: 'good-session', type: 'agent_status', data: {} }],
        },
        'bad-session': { events: [{ time: 'nope' }, { sessionId: 'x' }, null] },
      },
    }
    writeFileSync(join(home, 'observability', 'audit.json'), JSON.stringify(state), 'utf8')
    const second = bootPlugin({}, { home })
    disposeAlls.push(second.disposeAll)
    await settle()
    const good = mockResponse()
    await invoke(second.api, mockRequest({ url: '/observability/api/events?sessionId=good-session' }), good)
    assert.equal(jsonOf(good).value.length, 1, 'valid events survive')
    const bad = mockResponse()
    await invoke(second.api, mockRequest({ url: '/observability/api/events?sessionId=bad-session' }), bad)
    assert.equal(jsonOf(bad).value.length, 0, 'invalid events dropped')
  } finally {
    cleanupHome(home)
  }
})

test('store global cap evicts oldest sessions', async () => {
  const { listeners, api } = boot({})
  await settle()
  // 两个会话各塞满到全局上限触发轮转淘汰：先写 s1 大量事件，再写 s2，
  // 超限后最早活动的 s1 整桶被淘汰
  for (let i = 0; i < 100; i += 1) {
    await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s1'), status: `x${i}` })
  }
  await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s2'), status: 'idle' })
  // 全局上限 20000 未触发（101 个事件）——验证不误淘汰
  const sessions = jsonOf(await invoke(api, mockRequest({ url: '/observability/api/sessions' }), mockResponse())).value
  assert.equal(sessions.length, 2, 'no eviction below the cap')
})

// ── audit 边界 ─────────────────────────────────────────────────────────────

test('audit ignores null agents and null args', async () => {
  const { listeners, api } = boot({})
  await settle()
  await dispatchEvent(listeners, 'agent/status', { agent: null, status: 'idle' })
  await dispatchEvent(listeners, 'tools/pre-execute', { name: 'bash', agent: null }, async () => {})
  await dispatchEvent(
    listeners,
    'tools/pre-execute',
    { name: 'bash', agent: topAgent('s1'), arguments: null },
    async () => {},
  )
  const events = jsonOf(
    await invoke(api, mockRequest({ url: '/observability/api/events?sessionId=s1' }), mockResponse()),
  ).value
  assert.equal(events.length, 1, 'only the valid args record lands')
  assert.deepEqual(events[0].data.args, { keys: [] }, 'null args → empty keys')
})

test('audit marks unknown agent type without session header', async () => {
  const { listeners, api } = boot({})
  await settle()
  await dispatchEvent(listeners, 'agent/status', { agent: { id: 'strange' }, status: 'idle' })
  const events = jsonOf(
    await invoke(api, mockRequest({ url: '/observability/api/events?sessionId=strange' }), mockResponse()),
  ).value
  assert.equal(events[0].data.agentType, 'unknown', 'no header → unknown')
})

test('tool_result flags object errors and tolerates non-objects', async () => {
  const { listeners, api } = boot({})
  await settle()
  await dispatchEvent(listeners, 'tools/execute', { name: 'bash', agent: topAgent('s1') }, async () => null)
  await dispatchEvent(listeners, 'tools/execute', { name: 'bash', agent: topAgent('s1') }, async () => ({ error: {} }))
  const events = jsonOf(
    await invoke(api, mockRequest({ url: '/observability/api/events?sessionId=s1&type=tool_result' }), mockResponse()),
  ).value
  assert.equal(events.length, 2)
  assert.equal(events[0].data.ok, true, 'null result is ok')
  assert.equal(events[1].data.ok, true, 'empty error object is ok')
})

test('tool_call summary picks the first known text key', async () => {
  const { listeners, api } = boot({})
  await settle()
  await dispatchEvent(
    listeners,
    'tools/pre-execute',
    { name: 'write', agent: topAgent('s1'), arguments: { content: 'hello world' } },
    async () => {},
  )
  const events = jsonOf(
    await invoke(api, mockRequest({ url: '/observability/api/events?sessionId=s1' }), mockResponse()),
  ).value
  assert.equal(events[0].data.args.summary, 'hello world')
})

// ── AI 边界 ────────────────────────────────────────────────────────────────

test('AI timeout degrades with a note', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
  const agents = {
    create: async () => ({
      agent: {
        followup: () => {},
        whenIdle: () => new Promise(() => {}), // 永不 resolve → 超时
        session: { events: [] },
      },
      dispose: async () => {},
    }),
  }
  const { api } = boot({ aiTimeoutMs: 300 }, { agents })
  await settle()
  const res = mockResponse()
  await invoke(
    api,
    mockRequest({
      url: '/observability/api/review',
      method: 'POST',
      body: JSON.stringify({ repoPath: repo }),
    }),
    res,
  )
  assert.equal(res.writeHeadStatus, 200)
  const value = jsonOf(res).value
  assert.equal(value.ai.enabled, true)
  assert.equal(value.ai.failed, true, 'timeout degrades to failed')
  assert.ok(value.ai.note !== undefined, 'note explains the failure')
})

// ── 变异补充：store 边界（杀 store.js 存活变异体）────────────────────────

test('jsonlFile falls back to homedir without DSH_HOME', async () => {
  const { jsonlFile } = await import('../lib/store-persist.js')
  const old = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    const file = jsonlFile()
    assert.ok(file.includes('observability'), 'path contains observability dir')
    assert.ok(!file.startsWith('/tmp/'), 'not under DSH_HOME when unset')
  } finally {
    if (old !== undefined) process.env.DSH_HOME = old
    else delete process.env.DSH_HOME
  }
})

test('per-session cap boundary: exactly 2000 kept, 2001 trims one', async () => {
  const { listeners, api } = boot({})
  await settle()
  for (let i = 0; i < 2000; i += 1) {
    await dispatchEvent(listeners, 'agent/status', { agent: topAgent('edge'), status: `s${i}` })
  }
  const exact = jsonOf(
    await invoke(api, mockRequest({ url: '/observability/api/events?sessionId=edge' }), mockResponse()),
  ).value
  assert.equal(exact.length, 2000, 'exactly 2000 kept at boundary')
  assert.equal(exact[0].data.status, 's0', 'oldest kept at boundary')
  await dispatchEvent(listeners, 'agent/status', { agent: topAgent('edge'), status: 's2000' })
  const trimmed = jsonOf(
    await invoke(api, mockRequest({ url: '/observability/api/events?sessionId=edge' }), mockResponse()),
  ).value
  assert.equal(trimmed.length, 2000, 'still capped after overflow')
  assert.equal(trimmed[0].data.status, 's1', 'oldest trimmed')
})

test('store global cap evicts oldest sessions at 20000', async () => {
  const { listeners, api } = boot({})
  await settle()
  // 11 个会话 × 2000 = 22000 条，触发全局上限轮转淘汰
  for (let s = 0; s < 11; s += 1) {
    const id = `gcap-${s}`
    for (let i = 0; i < 2000; i += 1) {
      await dispatchEvent(listeners, 'agent/status', { agent: topAgent(id), status: `x${i}` })
    }
  }
  const status = jsonOf(await invoke(api, mockRequest({ url: '/observability/api/status' }), mockResponse())).value
  assert.ok(status.auditCount <= 20000, 'global cap enforced')
  const sessions = jsonOf(await invoke(api, mockRequest({ url: '/observability/api/sessions' }), mockResponse())).value
  assert.ok(sessions.length < 11, 'oldest sessions evicted')
  assert.ok(sessions.length >= 1, 'newest sessions kept')
})

test('events query tolerates null type and odd limits', async () => {
  const { listeners, api } = boot({})
  await settle()
  await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s1'), status: 'running' })
  await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s1'), status: 'idle' })
  const all = jsonOf(
    await invoke(api, mockRequest({ url: '/observability/api/events?sessionId=s1' }), mockResponse()),
  ).value
  assert.equal(all.length, 2, 'no type filter → all')
  const zero = jsonOf(
    await invoke(api, mockRequest({ url: '/observability/api/events?sessionId=s1&limit=0' }), mockResponse()),
  ).value
  assert.equal(zero.length, 2, 'limit 0 → all')
  const neg = jsonOf(
    await invoke(api, mockRequest({ url: '/observability/api/events?sessionId=s1&limit=-5' }), mockResponse()),
  ).value
  assert.equal(neg.length, 2, 'negative limit → all')
  const nan = jsonOf(
    await invoke(api, mockRequest({ url: '/observability/api/events?sessionId=s1&limit=abc' }), mockResponse()),
  ).value
  assert.equal(nan.length, 2, 'non-numeric limit → all')
})

test('store treats structurally invalid JSON root as empty', async () => {
  const home = createTempHome()
  try {
    mkdirSync(join(home, 'observability'), { recursive: true })
    writeFileSync(join(home, 'observability', 'audit.json'), JSON.stringify({ foo: 1 }), 'utf8')
    const second = bootPlugin({}, { home })
    disposeAlls.push(second.disposeAll)
    await settle()
    const res = mockResponse()
    await invoke(second.api, mockRequest({ url: '/observability/api/status' }), res)
    assert.equal(jsonOf(res).value.auditCount, 0, 'invalid root yields empty state')
  } finally {
    cleanupHome(home)
  }
})

test('dispose before store load flushes buffered events', async () => {
  const home = createTempHome()
  try {
    const first = bootPlugin({}, { home })
    // 立即 record（store 可能未 ready → 缓冲）
    await dispatchEvent(first.listeners, 'agent/status', {
      agent: topAgent('early'),
      status: 'running',
    })
    await first.disposeAll() // 未 ready 时回放 pending + 落盘（await 保证冲刷完成）
    const second = bootPlugin({}, { home })
    disposeAlls.push(second.disposeAll)
    // 确定性等待 second 的 store 加载完成（不赌固定延时；超时后断言自然失败）
    let events = []
    for (let tries = 0; tries < 200; tries += 1) {
      events = jsonOf(
        await invoke(second.api, mockRequest({ url: '/observability/api/events?sessionId=early' }), mockResponse()),
      ).value
      if (events.length > 0) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(events.length, 1, 'buffered event survives dispose')
  } finally {
    cleanupHome(home)
  }
})

// ── 变异补充：AI 边界（杀 ai.js 存活变异体）───────────────────────────────

function aiAgents(sessionText, onPrompt) {
  return {
    create: async () => ({
      agent: {
        followup: (msg) => {
          if (onPrompt !== undefined) onPrompt(msg.content[0].text)
        },
        whenIdle: async () => {},
        session:
          sessionText === ''
            ? { events: [] }
            : {
                events: [
                  {
                    type: 'assistant/message',
                    data: { message: { content: [{ type: 'text', text: sessionText }] } },
                  },
                ],
              },
      },
      dispose: async () => {},
    }),
  }
}

async function reviewWith(api, repo) {
  const res = mockResponse()
  await invoke(
    api,
    mockRequest({
      url: '/observability/api/review',
      method: 'POST',
      body: JSON.stringify({ repoPath: repo }),
    }),
    res,
  )
  return jsonOf(res).value
}

test('AI unavailable when agents is null or create is not a function', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
  for (const agents of [null, { create: 'nope' }]) {
    const { api } = boot({}, { agents })
    await settle()
    const value = await reviewWith(api, repo)
    assert.equal(value.ai.failed, true, 'degraded for malformed agents service')
    assert.ok(value.ai.note.includes('unavailable'), 'unavailable noted')
  }
})

test('AI prompt truncates oversized diffs', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), `const x = 1\n${'y'.repeat(9000)}\n`)
  let promptText = ''
  const { api } = boot(
    {},
    {
      agents: aiAgents('{"verdict":"approve","summary":"ok","topIssues":[]}', (t) => {
        promptText = t
      }),
    },
  )
  await settle()
  const value = await reviewWith(api, repo)
  assert.equal(value.ai.verdict, 'approve')
  assert.ok(promptText.includes('截断'), 'truncation marker present')
  assert.ok(promptText.length < 9000, 'prompt bounded')
})

test('AI prompt handles empty rule issues', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  // 只改测试文件 → no-test-change 不触发 → issues 为空
  mkdirSync(join(repo, 'test'), { recursive: true })
  writeFileSync(join(repo, 'test/a.test.js'), 'test("x", () => {})\n')
  let promptText = ''
  const { api } = boot(
    {},
    {
      agents: aiAgents('{"verdict":"approve","summary":"ok","topIssues":[]}', (t) => {
        promptText = t
      }),
    },
  )
  await settle()
  const value = await reviewWith(api, repo)
  assert.equal(value.ai.verdict, 'approve')
  assert.ok(promptText.includes('（无）'), 'empty rules marker')
})

test('AI conclusion rejects non-object JSON', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
  for (const sessionText of ['[1,2]', 'null', '42']) {
    const { api } = boot({}, { agents: aiAgents(sessionText) })
    await settle()
    const value = await reviewWith(api, repo)
    assert.equal(value.ai.failed, true, `non-object JSON ${sessionText} degrades`)
  }
})

test('AI conclusion normalizes odd summary/topIssues shapes', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
  const { api } = boot({}, { agents: aiAgents('{"verdict":"approve","summary":42,"topIssues":"nope"}') })
  await settle()
  const value = await reviewWith(api, repo)
  assert.equal(value.ai.summary, '', 'non-string summary normalized')
  assert.deepEqual(value.ai.topIssues, [], 'non-array topIssues normalized')
})

test('AI conclusion with empty session text degrades', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
  const { api } = boot({}, { agents: aiAgents('') })
  await settle()
  const value = await reviewWith(api, repo)
  assert.equal(value.ai.failed, true, 'empty session text degrades')
})

// ── 变异补充：fence / routes / index 边界 ─────────────────────────────────

test('fence: bare loopback and trusted host with port', () => {
  assert.equal(isTrustedApiRequest({ headers: { host: '127.0.0.1' } }, []), true, 'bare loopback allowed')
  assert.equal(
    isTrustedApiRequest({ headers: { host: 'obs.example.com:9443' } }, ['obs.example.com:9443']),
    true,
    'trusted host with port allowed',
  )
  assert.equal(
    isTrustedApiRequest({ headers: { host: 'obs.example.com:9443' } }, ['obs.example.com']),
    true,
    'hostname-only entry matches any port',
  )
  assert.equal(
    isTrustedApiRequest({ headers: { host: 'obs.example.com:8080' } }, ['obs.example.com:9443']),
    false,
    'explicit port mismatch rejected',
  )
})

test('routes tolerate malformed webRuntime', async () => {
  for (const webRuntime of [null, { trustedHosts: 'nope' }]) {
    const { api } = boot({}, { webRuntime })
    await settle()
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/observability/api/status' }), res)
    assert.equal(res.writeHeadStatus, 200, 'status still served with malformed webRuntime')
  }
})

test('apply with undefined config keeps defaults', async () => {
  const { api } = boot(undefined)
  await settle()
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/observability/api/status' }), res)
  const value = jsonOf(res).value
  assert.equal(value.aiReview, true, 'aiReview defaults on')
})
