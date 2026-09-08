/**
 * Smoke test for the dsh-task-reliability host half: mounts the plugin against
 * a mocked context and asserts the core behaviors:
 *  - task registry: register validation, state transitions, persistence,
 *    corrupt-file fallback;
 *  - request-error retry: timeout-class codes → `{ kind: 'retry' }`, other
 *    codes → next(), retry cap, abort guard;
 *  - turn-stopping auto-continue: steer injection, subagent skip, verify-mode
 *    skip, loop cap, cooldown, dedupe;
 *  - completion verifier: idle trigger, independent agent creation, conclusion
 *    branches (done / not-done wake-up / creation-failure fallback), verify cap;
 *  - reasoning-loop detection: stream wrapping, throw on repetition, passthrough
 *    otherwise, intervention cap, turn-stopping break text;
 *  - autopilot: ask deny + question collection, off-passthrough;
 *  - restart resume: resume + followup, idempotency (resumeAt), failure skip;
 *  - HTTP API: info/tasks/questions/mode/trigger routes, fence, token;
 *  - auto-tracking via goals, teardown cleanup.
 *
 * The client half is browser-only; CI checks its syntax with `node --check`.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

// ── mock helpers ──────────────────────────────────────────────────────────
function mockResponse() {
  const res = {
    writeHeadStatus: 0,
    writeHeadHeaders: null,
    written: [],
    ended: false,
    destroyed: false,
    closeHandlers: [],
    writeHead(status, headers) {
      res.writeHeadStatus = status
      res.writeHeadHeaders = headers
    },
    write(chunk) {
      res.written.push(String(chunk))
      return true
    },
    end(value) {
      res.ended = true
      if (value !== undefined) res.written.push(String(value))
    },
    destroy() {
      res.destroyed = true
    },
    on(_event, handler) {
      if (_event === 'close') res.closeHandlers.push(handler)
    },
    removeListener() {},
    emitClose() {
      for (const h of res.closeHandlers.splice(0)) h()
    },
  }
  return res
}

function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', secFetchSite, origin, token, body = '' } = {}) {
  const headers = { host }
  if (secFetchSite !== undefined) headers['sec-fetch-site'] = secFetchSite
  if (origin !== undefined) headers.origin = origin
  if (token !== undefined) headers['x-task-reliability-token'] = token
  return {
    url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

function makeAgent(id, opts = {}) {
  return {
    id,
    options: { provider: 'deepseek', model: 'deepseek-chat' },
    session: {
      header: { cwd: '/work', ...(opts.origin !== undefined ? { origin: opts.origin } : {}) },
      events: opts.events ?? [],
    },
    steered: [],
    followed: [],
    steer(message) {
      this.steered.push(message)
    },
    followup(message) {
      this.followed.push(message)
    },
    whenIdle() {
      return Promise.resolve()
    },
  }
}

const tmpDirs = []
const disposeAlls = []

/** Boot the plugin with a mocked ctx and default test-friendly timing. */
function boot(config = {}, services = {}, dirOverride) {
  const dir = dirOverride ?? mkdtempSync(join(tmpdir(), 'dsh-task-reliability-'))
  if (dirOverride === undefined) tmpDirs.push(dir)
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const listeners = {}
  const routes = []
  const disposers = []
  const policies = []
  const logs = []
  const calls = { create: [], resume: [], read: [] }
  const verifyAgent = makeAgent('verify-mock', { origin: 'subagent' })
  const mainAgent = services.mainAgent ?? makeAgent('session-main')
  const agents = {
    get(id) {
      return services.liveAgentId === id ? mainAgent : undefined
    },
    async create(options) {
      calls.create.push(options)
      return { agent: verifyAgent, async dispose() {} }
    },
    async resume(options) {
      calls.resume.push(options)
      return { agent: mainAgent, async dispose() {} }
    },
  }
  const sessionQuery = {
    async readSession(id) {
      calls.read.push(id)
      return { header: {}, events: services.readEvents ?? [] }
    },
  }
  const goals = {
    get(agent) {
      return services.goalOf?.(agent)
    },
  }
  const approval = {
    setPolicy(agent, policy) {
      policies.push({ agentId: agent.id, policy })
    },
  }
  const ctx = {
    // 可选依赖局部等待（cordis ctx.inject）：这些用例不提供 commands 服务，
    // 等待态即不注册 /task 命令（与 ctx.get('commands') 返回 undefined 等价）。
    inject() {
      return { dispose() {} }
    },
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    on(name, handler) {
      ;(listeners[name] ??= []).push(handler)
      return () => {}
    },
    effect(fn) {
      const dispose = fn()
      assert.equal(typeof dispose, 'function', 'every ctx.effect must return a disposer')
      disposers.push(dispose)
      return dispose
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    get(name) {
      if (name === 'agents') return agents
      if (name === 'sessionQuery') return sessionQuery
      if (name === 'goals') return goals
      if (name === 'approval') return approval
      if (name === 'webRuntime') return { trustedHosts: [] }
      return undefined
    },
  }
  const shared = apply(ctx, {
    saveDebounceMs: 0,
    resumeGraceMs: 60000,
    steerCooldownMs: 0,
    retryBaseMs: 0,
    ...config,
  })
  const api = routes.find((r) => r.path === '/task-reliability/api' && r.kind === 'prefix')
  assert.ok(api, 'prefix route /task-reliability/api registered')
  const disposeAll = () => {
    for (const dispose of disposers.splice(0)) dispose()
    process.env.DSH_HOME = oldHome
  }
  disposeAlls.push(disposeAll)
  return {
    ctx,
    listeners,
    api,
    mainAgent,
    verifyAgent,
    agents,
    policies,
    calls,
    logs,
    dir,
    disposeAll,
    store: shared.store,
  }
}

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))

async function callApi(api, request) {
  const response = mockResponse()
  await api.handler(request, response)
  return { response, body: JSON.parse(response.written.join('') || 'null') }
}

function dispatchOne(listeners, name, ...args) {
  const handlers = listeners[name] ?? []
  assert.ok(handlers.length > 0, `listener ${name} registered`)
  return handlers[handlers.length - 1](...args)
}

async function taskOf(env, id) {
  await tick()
  const body = JSON.parse(readFileSync(join(env.dir, 'task-reliability.json'), 'utf8'))
  return body.tasks.find((task) => task.id === id)
}

async function storeOf(env) {
  await tick()
  return JSON.parse(readFileSync(join(env.dir, 'task-reliability.json'), 'utf8'))
}

function registerTask(env, overrides = {}) {
  return callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/tasks',
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'session-main',
        description: '开发一个功能',
        ...overrides,
      }),
    }),
  )
}

// ── 任务注册表 ─────────────────────────────────────────────────────────────
test('注册任务成功并返回任务记录', async () => {
  const env = boot()
  const { response, body } = await registerTask(env)
  assert.equal(response.writeHeadStatus, 200)
  assert.equal(body.ok, true)
  assert.equal(body.value.sessionId, 'session-main')
  assert.equal(body.value.description, '开发一个功能')
  assert.equal(body.value.status, 'active')
  assert.equal(body.value.mode, 'direct')
  assert.equal(body.value.source, 'manual')
})

test('注册任务拒绝空参数/超长描述', async () => {
  const env = boot()
  const empty = await registerTask(env, { sessionId: '' })
  assert.equal(empty.response.writeHeadStatus, 400)
  const noDesc = await registerTask(env, { description: '' })
  assert.equal(noDesc.response.writeHeadStatus, 400)
  const long = await registerTask(env, { description: 'x'.repeat(501) })
  assert.equal(long.response.writeHeadStatus, 400)
})

test('同一会话已有活动任务时注册被拒', async () => {
  const env = boot()
  await registerTask(env)
  const second = await registerTask(env)
  assert.equal(second.response.writeHeadStatus, 400)
})

test('任务状态流转 done/pause/resume/delete', async () => {
  const env = boot()
  const { body } = await registerTask(env)
  const id = body.value.id
  const done = await callApi(env.api, mockRequest({ url: `/task-reliability/api/tasks/${id}/done`, method: 'POST' }))
  assert.equal(done.body.ok, true)
  assert.equal((await taskOf(env, id)).status, 'done')
  await callApi(env.api, mockRequest({ url: `/task-reliability/api/tasks/${id}/resume`, method: 'POST' }))
  assert.equal((await taskOf(env, id)).status, 'active')
  await callApi(env.api, mockRequest({ url: `/task-reliability/api/tasks/${id}/pause`, method: 'POST' }))
  assert.equal((await taskOf(env, id)).status, 'paused')
  const del = await callApi(env.api, mockRequest({ url: `/task-reliability/api/tasks/${id}/delete`, method: 'POST' }))
  assert.equal(del.body.ok, true)
  assert.equal((await storeOf(env)).tasks.length, 0)
})

test('任务注册表持久化且重启后恢复', async () => {
  const env = boot()
  await registerTask(env)
  await tick()
  assert.ok(existsSync(join(env.dir, 'task-reliability.json')), 'state file written')
  // 模拟重启：同一目录重新 apply
  const env2 = boot({}, {}, env.dir)
  const { body } = await callApi(env2.api, mockRequest({ url: '/task-reliability/api/tasks', method: 'GET' }))
  assert.equal(body.value.length, 1)
  assert.equal(body.value[0].description, '开发一个功能')
})

test('损坏状态文件回退空表不崩溃', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-reliability-broken-'))
  tmpDirs.push(dir)
  writeFileSync(join(dir, 'task-reliability.json'), '{broken json', 'utf8')
  const env = boot({}, {}, dir)
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/tasks', method: 'GET' }))
  assert.equal(body.value.length, 0)
})

// ── 模型请求失败自动重试 ──────────────────────────────────────────────────
test('超时类错误返回 retry 且不调用 next', async () => {
  const env = boot()
  let nextCalled = false
  const action = await dispatchOne(
    env.listeners,
    'agent/request-error',
    {
      agent: env.mainAgent,
      failure: { code: 'TIMEOUT', message: 'stream idle' },
      signal: { aborted: false },
    },
    () => {
      nextCalled = true
      return Promise.resolve(undefined)
    },
  )
  assert.equal(action.kind, 'retry')
  assert.equal(nextCalled, false)
})

test('非超时类错误委托 next', async () => {
  const env = boot()
  let nextCalled = false
  const action = await dispatchOne(
    env.listeners,
    'agent/request-error',
    {
      agent: env.mainAgent,
      failure: { code: 'INVALID_ARGUMENT', message: 'bad request' },
      signal: { aborted: false },
    },
    () => {
      nextCalled = true
      return Promise.resolve(undefined)
    },
  )
  assert.equal(action, undefined)
  assert.equal(nextCalled, true)
})

test('重试超过上限后委托 next', async () => {
  const env = boot({ retryMax: 2 })
  const payload = {
    agent: env.mainAgent,
    failure: { code: 'TIMEOUT', message: 'x' },
    signal: { aborted: false },
  }
  const first = await dispatchOne(env.listeners, 'agent/request-error', payload, () => Promise.resolve(undefined))
  assert.equal(first.kind, 'retry')
  const second = await dispatchOne(env.listeners, 'agent/request-error', payload, () => Promise.resolve(undefined))
  assert.equal(second.kind, 'retry')
  let nextCalled = false
  const third = await dispatchOne(env.listeners, 'agent/request-error', payload, () => {
    nextCalled = true
    return Promise.resolve(undefined)
  })
  assert.equal(third, undefined)
  assert.equal(nextCalled, true)
})

test('请求已中止时不重试', async () => {
  const env = boot()
  let nextCalled = false
  const action = await dispatchOne(
    env.listeners,
    'agent/request-error',
    {
      agent: env.mainAgent,
      failure: { code: 'TIMEOUT', message: 'x' },
      signal: { aborted: true },
    },
    () => {
      nextCalled = true
      return Promise.resolve(undefined)
    },
  )
  assert.equal(action, undefined)
  assert.equal(nextCalled, true)
})

// ── 任务自动继续（turn-stopping）──────────────────────────────────────────
test('turn-stopping 时活动任务注入 steer 继续', async () => {
  const env = boot()
  await registerTask(env)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  assert.equal(env.mainAgent.steered.length, 1)
  const text = env.mainAgent.steered[0].content[0].text
  assert.ok(text.includes('开发一个功能'), 'steer 文本包含任务描述')
  assert.ok(text.includes('任务自动继续'))
})

test('无任务时不注入 steer', async () => {
  const env = boot()
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  assert.equal(env.mainAgent.steered.length, 0)
})

test('子代理 turn-stopping 不处理', async () => {
  const env = boot()
  const sub = makeAgent('sub-1', { origin: 'subagent' })
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: sub,
    signal: { aborted: false },
  })
  assert.equal(sub.steered.length, 0)
})

test('verify 模式任务 turn-stopping 不直接注入', async () => {
  const env = boot()
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  assert.equal(env.mainAgent.steered.length, 0)
})

test('循环次数达上限任务标记失败', async () => {
  const env = boot({ maxLoop: 2, steerCooldownMs: 0 })
  const { body } = await registerTask(env)
  for (let i = 0; i < 3; i++) {
    await dispatchOne(env.listeners, 'agent/turn-stopping', {
      agent: env.mainAgent,
      signal: { aborted: false },
    })
  }
  assert.equal((await taskOf(env, body.value.id)).status, 'failed')
  assert.equal(env.mainAgent.steered.length, 2)
})

test('冷却期内不重复注入', async () => {
  const env = boot({ steerCooldownMs: 60000 })
  await registerTask(env)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  assert.equal(env.mainAgent.steered.length, 1)
})

test('abort 信号时不注入', async () => {
  const env = boot()
  await registerTask(env)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: true },
  })
  assert.equal(env.mainAgent.steered.length, 0)
})

// ── 完成度校验 agent ──────────────────────────────────────────────────────
test('会话结束后 verify 任务创建独立校验 agent', async () => {
  const env = boot()
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(50)
  assert.equal(env.calls.create.length, 1)
  const createOpts = env.calls.create[0]
  assert.ok(createOpts.sessionId.startsWith('verify-'), '独立校验 agent sessionId')
  assert.equal(createOpts.meta.origin, 'subagent')
  assert.equal(createOpts.agentOptions.provider, 'deepseek')
  assert.ok(env.verifyAgent.followed.length >= 1, '校验指令已发送')
  assert.ok(env.verifyAgent.followed[0].content[0].text.includes('任务完成度校验员'))
})

test('校验结论 done 任务标记完成', async () => {
  const env = boot()
  env.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: {
        message: { content: [{ type: 'text', text: '{"done": true, "reason": "全部完成"}' }] },
      },
    },
  ]
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(50)
  assert.equal(env.mainAgent.followed.length, 0, 'done 后不唤醒主 agent')
  const store = await storeOf(env)
  const task = store.tasks.find((t) => t.sessionId === 'session-main')
  assert.equal(task.status, 'done')
})

test('校验结论未完成唤醒主 agent 继续（带结论）', async () => {
  const env = boot()
  env.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: {
        message: { content: [{ type: 'text', text: '{"done": false, "reason": "测试还没写"}' }] },
      },
    },
  ]
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(50)
  assert.equal(env.mainAgent.followed.length, 1)
  assert.ok(env.mainAgent.followed[0].content[0].text.includes('测试还没写'))
  assert.ok(env.mainAgent.followed[0].content[0].text.includes('任务校验'))
})

test('校验 agent 创建失败降级直接继续', async () => {
  const env = boot()
  env.agents.create = async () => {
    throw new Error('boom')
  }
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(50)
  assert.equal(env.mainAgent.followed.length, 1, '降级唤醒继续')
})

test('校验次数达上限任务标记失败', async () => {
  const env = boot({ maxVerify: 1 })
  env.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '{"done": false, "reason": "未完"}' }] } },
    },
  ]
  await registerTask(env, { mode: 'verify' })
  // 第一次 idle：校验未完成 → 唤醒
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(50)
  // 第二次 idle：达到上限 → failed
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(50)
  const store = await storeOf(env)
  const task = store.tasks.find((t) => t.sessionId === 'session-main')
  assert.equal(task.status, 'failed')
})

// ── 思考重复检测与干预 ────────────────────────────────────────────────────
function reasoningChunks(text) {
  const chunks = []
  for (let b = 0; b < 5; b++) {
    chunks.push({ type: 'block-start', index: b, blockType: 'reasoning' })
    for (const ch of text) chunks.push({ type: 'reasoning-delta', index: b, text: ch })
    chunks.push({ type: 'block-end', index: b, block: { type: 'reasoning', text } })
  }
  chunks.push({ type: 'finish', reason: { kind: 'stop' } })
  return chunks
}

function normalChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    ...text.split('').map((ch) => ({ type: 'reasoning-delta', index: 0, text: ch })),
    { type: 'block-end', index: 0, block: { type: 'reasoning', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

async function collect(stream) {
  const out = []
  try {
    for await (const chunk of stream) out.push(chunk)
    return { chunks: out, error: undefined }
  } catch (error) {
    return { chunks: out, error }
  }
}

/** 模拟 vision-toolkit 式委托消费：yield* 直接展开 waterfall 返回值（同步链）。 */
async function collectViaYieldStar(stream) {
  const out = []
  try {
    const delegated = (async function* () {
      yield* stream
    })()
    for await (const chunk of delegated) out.push(chunk)
    return { chunks: out, error: undefined }
  } catch (error) {
    return { chunks: out, error }
  }
}

test('llm/stream 返回值可被 yield* 委托消费（防 Promise 包装回归）', async () => {
  const env = boot()
  const chunks = normalChunks('这是完全不同的正常思考内容。')
  // 真实链路：cordis waterfall 不 await listener 返回值，next() 同步返回流
  // （adapterStream 是 async*，调用即得 generator）。若 handler 是 async
  // function，waterfall 拿到 Promise<流>，vision-toolkit 用 yield* 委托时
  // 抛 "yield* (intermediate value) is not async iterable"。
  const wrapped = dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () => {
    return (async function* () {
      for (const chunk of chunks) yield chunk
    })()
  })
  const { chunks: out, error } = await collectViaYieldStar(wrapped)
  assert.equal(error, undefined, `yield* 委托不应报错: ${error?.message ?? ''}`)
  assert.equal(out.length, chunks.length, '全部 chunk 透传')
})

test('回归：重复检测在 yield* 委托消费下仍抛 REASONING_LOOP', async () => {
  const env = boot()
  const long = '思考任务执行的每一个细节并反复推敲其中的潜在问题与更优的解决路径方案。'.repeat(8)
  const wrapped = dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () => {
    return (async function* () {
      for (const chunk of reasoningChunks(long)) yield chunk
    })()
  })
  const { error } = await collectViaYieldStar(wrapped)
  assert.ok(error instanceof Error)
  assert.equal(error.code, 'REASONING_LOOP')
})

test('流中连续重复 reasoning 段落触发检测抛错', async () => {
  const env = boot()
  const long = '思考任务执行的每一个细节并反复推敲其中的潜在问题与更优的解决路径方案。'.repeat(8)
  const wrapped = dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () => {
    return (async function* () {
      for (const chunk of reasoningChunks(long)) yield chunk
    })()
  })
  const { error } = await collect(wrapped)
  assert.ok(error instanceof Error)
  assert.equal(error.code, 'REASONING_LOOP')
})

test('正常流透传全部 chunk 不抛错', async () => {
  const env = boot()
  const chunks = normalChunks('这是完全不同的正常思考内容。')
  const wrapped = await dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () => {
    return (async function* () {
      for (const chunk of chunks) yield chunk
    })()
  })
  const { chunks: out, error } = await collect(wrapped)
  assert.equal(error, undefined)
  assert.equal(out.length, chunks.length, '全部 chunk 透传')
})

test('短 reasoning 段落不参与重复检测', async () => {
  const env = boot()
  const short = '好的'.repeat(4)
  const wrapped = await dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () => {
    return (async function* () {
      for (const chunk of reasoningChunks(short)) yield chunk
    })()
  })
  const { error } = await collect(wrapped)
  assert.equal(error, undefined)
})

test('重复干预达上限后放弃（不再抛错）', async () => {
  const env = boot({})
  const long = '反复思考同样的问题细节与可能的影响因素以及下一步应该采取的具体行动方案。'.repeat(8)
  const makeStream = () =>
    (async function* () {
      for (const chunk of reasoningChunks(long)) yield chunk
    })()
  for (let i = 0; i < 3; i++) {
    const wrapped = await dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, makeStream)
    const { error } = await collect(wrapped)
    assert.ok(error instanceof Error, `第 ${i + 1} 次仍抛错`)
  }
  const fourth = await dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, makeStream)
  const { error } = await collect(fourth)
  assert.equal(error, undefined, '超过上限后放弃干预')
})

test('turn-stopping 检测到重复后注入打断指令', async () => {
  const env = boot()
  const long = '反复推敲同一段思考内容及其潜在影响与后续步骤的详细规划与执行细节安排。'.repeat(8)
  const wrapped = await dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () => {
    return (async function* () {
      for (const chunk of reasoningChunks(long)) yield chunk
    })()
  })
  await collect(wrapped)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  assert.equal(env.mainAgent.steered.length, 1)
  assert.ok(env.mainAgent.steered[0].content[0].text.includes('思考重复'))
})

// ── 自主决策模式 ──────────────────────────────────────────────────────────
test('autopilot 开启时 ask 先展示给用户（缓冲期放行，issue #79）', async () => {
  const env = boot({ autopilot: true })
  let nextCalled = false
  const decision = await dispatchOne(
    env.listeners,
    'tools/pre-execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ header: '选哪个方案？', question: 'A 还是 B？' }] },
    },
    () => {
      nextCalled = true
      return Promise.resolve({ kind: 'allow' })
    },
  )
  assert.equal(decision.kind, 'allow', '缓冲期内不拦截，ask 正常展示给用户')
  assert.equal(nextCalled, true, '放行时调用 next')
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 0, '缓冲期内不记录问题')
})

test('autopilotGraceMs=0 时 autopilot 立即拒绝并记录问题（旧行为保留）', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 0 })
  let nextCalled = false
  const decision = await dispatchOne(
    env.listeners,
    'tools/pre-execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ header: '选哪个方案？', question: 'A 还是 B？' }] },
    },
    () => {
      nextCalled = true
      return Promise.resolve({ kind: 'allow' })
    },
  )
  assert.equal(decision.kind, 'deny')
  assert.ok(decision.reason.includes('自主决策模式'))
  assert.equal(nextCalled, false, 'deny 时不调用 next')
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 1)
  assert.equal(body.value[0].question, '选哪个方案？')
})

test('autopilot 关闭时 ask 透传', async () => {
  const env = boot()
  let nextCalled = false
  const decision = await dispatchOne(
    env.listeners,
    'tools/pre-execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ header: 'h' }] },
    },
    () => {
      nextCalled = true
      return Promise.resolve({ kind: 'allow' })
    },
  )
  assert.equal(nextCalled, true)
  assert.equal(decision.kind, 'allow')
})

test('非 ask 工具透传', async () => {
  const env = boot({ autopilot: true })
  let nextCalled = false
  await dispatchOne(
    env.listeners,
    'tools/pre-execute',
    {
      name: 'bash',
      agent: env.mainAgent,
      arguments: {},
    },
    () => {
      nextCalled = true
      return Promise.resolve({ kind: 'allow' })
    },
  )
  assert.equal(nextCalled, true)
})

test('会话级 autopilot 开启后问题可远程回答', async () => {
  const env = boot({ autopilotGraceMs: 20 }, { liveAgentId: 'session-main' })
  await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'mode', autopilot: true, sessionId: 'session-main' }),
    }),
  )
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ header: '需要确认' }] },
    },
    () => new Promise(() => {}),
  ) // 永不 resolve：缓冲超时后自动决策，问题进待确认列表
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  const id = body.value[0].id
  const answered = await callApi(
    env.api,
    mockRequest({
      url: `/task-reliability/api/questions/${id}/answer`,
      method: 'POST',
      body: JSON.stringify({ answer: '选 B' }),
    }),
  )
  assert.equal(answered.body.ok, true)
  const after = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(after.body.value[0].answer, '选 B')
  assert.ok(
    env.policies.some((p) => p.agentId === 'session-main' && p.policy === 'never'),
    '审批策略切换 never',
  )
})

// ── ask 超时自动继续（issue #34）─────────────────────────────────────────
test('autopilot 缓冲期内用户回答透传（issue #79）', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 60000 })
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？' }] },
    },
    () => Promise.resolve({ value: { answers: [{ id: 'q1', selected: ['B'] }] } }),
  )
  assert.deepEqual(result.value.answers[0].selected, ['B'], '缓冲期内真实回答透传')
  assert.equal(env.mainAgent.followed.length, 0, '缓冲期内不注入自动决策指令')
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 0, '缓冲期内不记录问题')
})

test('autopilot 缓冲超时后自动决策：记录问题 + 注入指令 + 空回答（issue #79）', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: {
        questions: [{ id: 'q1', question: 'A 还是 B？', options: [{ label: '方案A' }, { label: '方案B' }] }],
      },
    },
    () => new Promise(() => {}),
  ) // 永不 resolve，模拟用户缓冲期内未回答
  assert.deepEqual(result.value.answers, [], '缓冲超时后返回空回答，由模型自行决策（不假装用户选了推荐项）')
  assert.equal(env.mainAgent.followed.length, 1, '注入自动决策指令')
  assert.ok(env.mainAgent.followed[0].content[0].text.includes('用户当前不在线'))
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 1, '被自动决策的 ask 记录到待确认列表')
  assert.equal(body.value[0].question, 'A 还是 B？')
})

test('autopilot 缓冲超时后问题可事后回答（issue #79）', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ header: '需要确认' }] },
    },
    () => new Promise(() => {}),
  )
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  const id = body.value[0].id
  const answered = await callApi(
    env.api,
    mockRequest({
      url: `/task-reliability/api/questions/${id}/answer`,
      method: 'POST',
      body: JSON.stringify({ answer: '事后选 B' }),
    }),
  )
  assert.equal(answered.body.ok, true)
  const after = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(after.body.value[0].answer, '事后选 B')
})

test('autopilot 关闭时 execute 不延迟（透传）', async () => {
  const env = boot({ autopilotGraceMs: 20 })
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？' }] },
    },
    () => Promise.resolve({ value: { answers: [{ id: 'q1', selected: ['B'] }] } }),
  )
  assert.deepEqual(result.value.answers[0].selected, ['B'], '非 autopilot 模式透传')
  assert.equal(env.mainAgent.followed.length, 0)
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 0)
})

test('ask 超时后注入继续指令并返回模拟回答', async () => {
  const env = boot({ askTimeoutMs: 20 })
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: {
        questions: [{ id: 'q1', question: 'A 还是 B？', options: [{ label: '方案A' }, { label: '方案B' }] }],
      },
    },
    () => new Promise(() => {}),
  ) // 永不 resolve，模拟用户长时间不回答
  assert.ok(result.value.answers.length === 1, '返回模拟回答')
  assert.equal(result.value.answers[0].id, 'q1')
  assert.deepEqual(result.value.answers[0].selected, ['方案A'], '推荐选项被选中')
  assert.equal(env.mainAgent.followed.length, 1, '注入继续指令')
  assert.ok(env.mainAgent.followed[0].content[0].text.includes('长时间未响应'))
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 1, '被跳过的 ask 记录到待确认列表')
  assert.equal(body.value[0].question, 'A 还是 B？')
  // 被跳过的 ask 可事后回答（复用需求 9 的 answer 机制）
  const answered = await callApi(
    env.api,
    mockRequest({
      url: `/task-reliability/api/questions/${body.value[0].id}/answer`,
      method: 'POST',
      body: JSON.stringify({ answer: '事后选 B' }),
    }),
  )
  assert.equal(answered.body.ok, true)
  const after = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(after.body.value[0].answer, '事后选 B')
})

test('ask 超时后无推荐选项时返回空回答由模型自行决策', async () => {
  const env = boot({ askTimeoutMs: 20 })
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q2', question: '请自行决定' }] },
    },
    () => new Promise(() => {}),
  )
  assert.deepEqual(result.value.answers[0].selected, [], '无推荐选项时 selected 为空')
  assert.equal(env.mainAgent.followed.length, 1)
})

// ── issue #145：竞速边界 + 超时后迟到回答不静默丢弃 ─────────────────────
test('缓冲超时后迟到回答不被静默丢弃：记录到待确认列表（issue #145）', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  let resolveNext
  const next = () =>
    new Promise((resolve) => {
      resolveNext = resolve
    })
  // 缓冲超时先触发（用户未在缓冲期内回答），自动决策返回
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？' }] },
    },
    next,
  )
  // 用户在超时后提交回答（迟到回答，模拟 GUI ask 卡片/待确认列表提交）
  resolveNext({ value: { answers: [{ id: 'q1', selected: ['B'] }] } })
  await tick(10)
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 1, '超时已记录问题到待确认列表')
  assert.equal(body.value[0].answer, 'B', '迟到回答被记录，不静默丢弃')
  assert.ok(body.value[0].answeredAt !== undefined, '回答时间已记录')
})

test('竞速边界：缓冲期边界提交回答 → 回答优先不被超时覆盖（issue #145）', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 30 })
  let resolveNext
  const next = () =>
    new Promise((resolve) => {
      resolveNext = resolve
    })
  const pending = dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？' }] },
    },
    next,
  )
  // 恰在超时边界前提交回答（20ms < 30ms 缓冲）
  await tick(20)
  resolveNext({ value: { answers: [{ id: 'q1', selected: ['B'] }] } })
  const result = await pending
  assert.deepEqual(result.value.answers[0].selected, ['B'], '回答优先透传，不被超时覆盖')
  assert.equal(env.mainAgent.followed.length, 0, '回答优先时不注入「不在线」指令')
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 0, '回答优先不记录问题')
})

test('迟到回答注入「用户已回答」提示，文案区分状态（issue #145）', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  let resolveNext
  const next = () =>
    new Promise((resolve) => {
      resolveNext = resolve
    })
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？' }] },
    },
    next,
  )
  assert.equal(env.mainAgent.followed.length, 1, '超时注入自动决策指令')
  resolveNext({ value: { answers: [{ id: 'q1', selected: ['B'] }] } })
  await tick(10)
  assert.equal(env.mainAgent.followed.length, 2, '迟到回答追加「用户已回答」提示')
  const late = env.mainAgent.followed[1].content[0].text
  assert.ok(late.includes('用户已回答'), '文案区分「已回答」而非默认「不在线」')
  assert.ok(late.includes('B'), '提示包含回答内容')
  assert.ok(late.includes('已记录'), '提示明确回答已记录，不静默丢弃')
})

test('迟到回答无有效答案/无对应记录时不误记录（issue #145 防御）', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  let resolveNext
  const next = () =>
    new Promise((resolve) => {
      resolveNext = resolve
    })
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？' }] },
    },
    next,
  )
  resolveNext({ value: { answers: [{ id: 'q1', selected: [] }] } }) // 空选择/取消
  await tick(10)
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value[0].answer, undefined, '空回答不写入')
  // 场景 2：问题无有效参数（超时未记录待确认），迟到回答不崩溃也不新增
  const env2 = boot({ autopilot: true, autopilotGraceMs: 20 })
  let resolveNext2
  const next2 = () =>
    new Promise((resolve) => {
      resolveNext2 = resolve
    })
  await dispatchOne(
    env2.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env2.mainAgent,
      arguments: { questions: [] },
    },
    next2,
  )
  resolveNext2({ value: { answers: [{ id: 'q9', selected: ['X'] }] } })
  await tick(10)
  const after = await callApi(env2.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(after.body.value.length, 0, '无对应记录时迟到回答不新增、不崩溃')
})

test('ask 超时后的迟到回答同样记录（issue #145 覆盖 askTimeout 路径）', async () => {
  const env = boot({ askTimeoutMs: 20 })
  let resolveNext
  const next = () =>
    new Promise((resolve) => {
      resolveNext = resolve
    })
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？', options: [{ label: '甲' }, { label: '乙' }] }] },
    },
    next,
  )
  assert.ok(result.value.answers.length === 1 && result.value.answers[0].selected[0] === '甲', 'ask 超时返回模拟回答')
  resolveNext({ value: { answers: [{ id: 'q1', selected: ['乙'] }] } })
  await tick(10)
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value[0].answer, '乙', 'ask 超时后的迟到回答也记录')
})

test('ask 用户回答后返回真实结果不超时', async () => {
  const env = boot({ askTimeoutMs: 60000 })
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？' }] },
    },
    () => Promise.resolve({ value: { answers: [{ id: 'q1', selected: ['B'] }] } }),
  )
  assert.deepEqual(result.value.answers[0].selected, ['B'], '真实回答透传')
  assert.equal(env.mainAgent.followed.length, 0, '不注入继续指令')
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 0, '不记录问题')
})

test('askTimeoutMs=0 时 ask 超时禁用', async () => {
  const env = boot({ askTimeoutMs: 0 })
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？' }] },
    },
    () => Promise.resolve({ value: { answers: [{ id: 'q1', selected: ['B'] }] } }),
  )
  assert.deepEqual(result.value.answers[0].selected, ['B'])
  assert.equal(env.mainAgent.followed.length, 0)
})

test('非 ask 工具不受 ask 超时影响', async () => {
  const env = boot({ askTimeoutMs: 20 })
  let nextCalled = false
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'bash',
      agent: env.mainAgent,
      arguments: { command: 'ls' },
    },
    () => {
      nextCalled = true
      return Promise.resolve({ value: { output: 'ok' } })
    },
  )
  assert.equal(nextCalled, true, '直接透传 next')
  assert.deepEqual(result.value, { output: 'ok' })
})

// ── 任务停滞看门狗（issue #34）───────────────────────────────────────────
test('看门狗唤醒停滞的活动任务', async () => {
  const env = boot({ watchdogIntervalMs: 20, stallTimeoutMs: 1000 })
  await registerTask(env)
  env.store.tasks[0].updatedAt = Date.now() - 60000 // 模拟停滞 60 秒
  await tick(60) // 等看门狗触发
  assert.equal(env.mainAgent.followed.length, 1, '唤醒指令注入')
  assert.ok(env.mainAgent.followed[0].content[0].text.includes('系统唤醒'))
  const store = await storeOf(env)
  assert.equal(store.tasks[0].status, 'active')
})

test('看门狗不唤醒未停滞的任务', async () => {
  const env = boot({ watchdogIntervalMs: 20, stallTimeoutMs: 1000 })
  await registerTask(env)
  await tick(60)
  assert.equal(env.mainAgent.followed.length, 0, '未停滞不唤醒')
})

test('watchdogIntervalMs=0 时看门狗禁用', async () => {
  const env = boot({ watchdogIntervalMs: 0, stallTimeoutMs: 10 })
  await registerTask(env)
  await tick(60)
  assert.equal(env.mainAgent.followed.length, 0)
})

test('看门狗唤醒后更新活动时间避免重复唤醒', async () => {
  const env = boot({ watchdogIntervalMs: 20, stallTimeoutMs: 1000 })
  await registerTask(env)
  env.store.tasks[0].updatedAt = Date.now() - 60000
  await tick(60)
  assert.equal(env.mainAgent.followed.length, 1, '第一次唤醒')
  await tick(60)
  assert.equal(env.mainAgent.followed.length, 1, '不重复唤醒')
})

test('看门狗唤醒失败不标记任务失败', async () => {
  const env = boot({ watchdogIntervalMs: 20, stallTimeoutMs: 1000 })
  await registerTask(env)
  env.store.tasks[0].updatedAt = Date.now() - 60000
  env.agents.resume = async () => {
    throw new Error('session missing')
  }
  await tick(60)
  const store = await storeOf(env)
  assert.equal(store.tasks[0].status, 'active', '保持 active 等待下次唤醒')
})

// ── 休眠/重启恢复 ─────────────────────────────────────────────────────────
test('启动时恢复活动任务（resume + followup 继续）', async () => {
  const env = boot({ resumeGraceMs: 60000 })
  await registerTask(env)
  await tick()
  env.disposeAll() // 关闭第一个实例（阻止其 resume 定时器）
  // 模拟重启：同一目录重新 apply
  const env2 = boot({ resumeGraceMs: 0 }, {}, env.dir)
  await tick(30) // 等 resumeGraceMs=0 的定时器
  assert.equal(env2.calls.resume.length, 1)
  assert.equal(env2.calls.resume[0].resumeSessionId, 'session-main')
  assert.equal(env2.mainAgent.followed.length, 1)
  assert.ok(env2.mainAgent.followed[0].content[0].text.includes('系统重启恢复'))
  const store = await storeOf(env2)
  assert.ok(store.tasks[0].resumeAt > 0, 'resumeAt 已记录')
})

test('已恢复的任务不重复恢复（幂等）', async () => {
  const env = boot({ resumeGraceMs: 60000 })
  await registerTask(env)
  await tick()
  env.disposeAll()
  const env2 = boot({ resumeGraceMs: 0 }, {}, env.dir)
  await tick(30)
  assert.equal(env2.calls.resume.length, 1, '第一次恢复执行')
  const env3 = boot({ resumeGraceMs: 0 }, {}, env.dir)
  await tick(30)
  assert.equal(env3.calls.resume.length, 0, 'resumeAt 已存在则不恢复')
})

test('resume 失败任务标记 failed 不阻塞启动', async () => {
  const env = boot({ resumeGraceMs: 60000 })
  await registerTask(env)
  await tick()
  env.disposeAll()
  const env2 = boot({ resumeGraceMs: 0 }, {}, env.dir)
  env2.agents.resume = async () => {
    throw new Error('session missing')
  }
  await tick(30)
  const store = await storeOf(env2)
  assert.equal(store.tasks[0].status, 'failed')
})

// ── HTTP API ──────────────────────────────────────────────────────────────
test('info 返回模式开关与统计', async () => {
  const env = boot()
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/info', method: 'GET' }))
  assert.equal(body.ok, true)
  assert.equal(body.value.tracking, false)
  assert.equal(body.value.apiToken, false)
  assert.equal(body.value.taskCount, 0)
})

test('mode 接口切换全局开关', async () => {
  const env = boot()
  const { body } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/mode',
      method: 'POST',
      body: JSON.stringify({ tracking: true, verify: true, autopilot: true }),
    }),
  )
  assert.equal(body.ok, true)
  const info = await callApi(env.api, mockRequest({ url: '/task-reliability/api/info', method: 'GET' }))
  assert.equal(info.body.value.tracking, true)
  assert.equal(info.body.value.verify, true)
  assert.equal(info.body.value.autopilot, true)
})

test('trigger 支持 register/status/未知动作', async () => {
  const env = boot()
  const reg = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({
        action: 'register',
        sessionId: 'session-main',
        description: '远程注册的任务',
      }),
    }),
  )
  assert.equal(reg.body.ok, true)
  const status = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'status' }),
    }),
  )
  assert.equal(status.body.ok, true)
  assert.equal(status.body.value.tasks.length, 1)
  const bad = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'nope' }),
    }),
  )
  assert.equal(bad.response.writeHeadStatus, 400)
})

test('fence 拒绝非本机来源', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/info',
      method: 'GET',
      host: 'evil.example.com',
    }),
  )
  assert.equal(response.writeHeadStatus, 403)
})

test('配置 apiToken 后错误/缺失 token 被拒', async () => {
  const env = boot({ apiToken: 'secret' })
  const noToken = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'status' }),
    }),
  )
  assert.equal(noToken.response.writeHeadStatus, 403)
  const badToken = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      token: 'wrong',
      body: JSON.stringify({ action: 'status' }),
    }),
  )
  assert.equal(badToken.response.writeHeadStatus, 403)
  const ok = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      token: 'secret',
      body: JSON.stringify({ action: 'status' }),
    }),
  )
  assert.equal(ok.body.ok, true)
})

// ── 自动跟踪（goal 信号）──────────────────────────────────────────────────
test('tracking 开启且存在活动 goal 时自动登记任务', async () => {
  const env = boot(
    {},
    {
      goalOf: () => ({ objective: '完成插件开发', status: 'active' }),
    },
  )
  await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/mode',
      method: 'POST',
      body: JSON.stringify({ tracking: true }),
    }),
  )
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/tasks', method: 'GET' }))
  assert.equal(body.value.length, 1)
  assert.equal(body.value[0].description, '完成插件开发')
  assert.equal(body.value[0].source, 'auto')
})

test('tracking 关闭不自动登记', async () => {
  const env = boot(
    {},
    {
      goalOf: () => ({ objective: '完成插件开发', status: 'active' }),
    },
  )
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/tasks', method: 'GET' }))
  assert.equal(body.value.length, 0)
})

// ── 干预/救场动作日志（issue #155 日志体系）──────────────────────────────
test('请求失败自动重试输出 [dsh-task-reliability] info 日志', async () => {
  const env = boot()
  await dispatchOne(
    env.listeners,
    'agent/request-error',
    {
      agent: env.mainAgent,
      failure: { code: 'TIMEOUT', message: 'stream idle' },
      signal: { aborted: false },
    },
    () => Promise.resolve(undefined),
  )
  const retryLog = env.logs.find((line) => line.includes('请求失败自动重试'))
  assert.ok(retryLog !== undefined, 'retry info log emitted')
  assert.ok(retryLog.startsWith('[dsh-task-reliability]'), 'log carries the unified plugin prefix')
  assert.ok(retryLog.includes('session-main'), 'log carries the session id')
  assert.ok(retryLog.includes('TIMEOUT'), 'log carries the error code')
})

test('任务自动继续注入输出 info 日志（含 taskId）', async () => {
  const env = boot()
  await registerTask(env)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  const steerLog = env.logs.find((line) => line.includes('任务自动继续已注入'))
  assert.ok(steerLog !== undefined, 'steer info log emitted')
  assert.ok(steerLog.startsWith('[dsh-task-reliability]'), 'log carries the unified plugin prefix')
  assert.ok(steerLog.includes('taskId='), 'log carries the task id')
  assert.ok(steerLog.includes('session-main'), 'log carries the session id')
})

test('循环打断注入输出 info 日志（含类型）', async () => {
  const env = boot()
  const long = '反复推敲同一段思考内容及其潜在影响与后续步骤的详细规划与执行细节安排。'.repeat(8)
  const wrapped = await dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () => {
    return (async function* () {
      for (const chunk of reasoningChunks(long)) yield chunk
    })()
  })
  await collect(wrapped)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  const breakLog = env.logs.find((line) => line.includes('循环打断已注入'))
  assert.ok(breakLog !== undefined, 'break info log emitted')
  assert.ok(breakLog.startsWith('[dsh-task-reliability]'), 'log carries the unified plugin prefix')
  assert.ok(breakLog.includes('类型='), 'log carries the break kind')
})

test('看门狗唤醒停滞任务输出 info 日志', async () => {
  const env = boot({ watchdogIntervalMs: 20, stallTimeoutMs: 1000 })
  await registerTask(env)
  env.store.tasks[0].updatedAt = Date.now() - 60000 // 模拟停滞 60 秒
  await tick(60) // 等看门狗触发
  const wakeLog = env.logs.find((line) => line.includes('看门狗唤醒停滞任务'))
  assert.ok(wakeLog !== undefined, 'watchdog wake info log emitted')
  assert.ok(wakeLog.startsWith('[dsh-task-reliability]'), 'log carries the unified plugin prefix')
  assert.ok(wakeLog.includes('taskId='), 'log carries the task id')
})

test('重启恢复任务输出 info 日志', async () => {
  const env = boot({ resumeGraceMs: 60000 })
  await registerTask(env)
  await tick()
  env.disposeAll()
  const env2 = boot({ resumeGraceMs: 0 }, {}, env.dir)
  await tick(30)
  const resumeLog = env2.logs.find((line) => line.includes('重启恢复任务'))
  assert.ok(resumeLog !== undefined, 'resume info log emitted')
  assert.ok(resumeLog.startsWith('[dsh-task-reliability]'), 'log carries the unified plugin prefix')
  assert.ok(resumeLog.includes('session-main'), 'log carries the session id')
})

// ── 卸载清理 ──────────────────────────────────────────────────────────────
test('卸载 disposer 全部可调用且不抛错', () => {
  boot()
  assert.ok(disposeAlls.length > 0)
  for (const dispose of disposeAlls.splice(0)) dispose()
  assert.ok(true)
})

afterAll(() => {
  for (const dispose of disposeAlls.splice(0)) dispose()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
