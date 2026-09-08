/**
 * Edge-path tests for the dsh-task-reliability host half: covers branches the
 * smoke test does not reach — trigger answer action (ok/fail), unknown API
 * method 404, malformed JSON body error path, ask-note question fallback and
 * long-question truncation, live-agent resume branch, session-query failure
 * fallback in verification, and autopilot session-level off switch.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

// ── mock helpers（与 host-smoke.mjs 相同的模式）─────────────────────────
function mockResponse() {
  const res = {
    writeHeadStatus: 0,
    written: [],
    ended: false,
    writeHead(status) {
      res.writeHeadStatus = status
    },
    write(chunk) {
      res.written.push(String(chunk))
      return true
    },
    end(value) {
      res.ended = true
      if (value !== undefined) res.written.push(String(value))
    },
  }
  return res
}

function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', body = '' } = {}) {
  return {
    url,
    method,
    headers: { host },
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

function boot(config = {}, services = {}, dirOverride) {
  const dir = dirOverride ?? mkdtempSync(join(tmpdir(), 'dsh-task-rel-edge-'))
  if (dirOverride === undefined) tmpDirs.push(dir)
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const listeners = {}
  const routes = []
  const disposers = []
  const policies = []
  const calls = { create: [], resume: [] }
  const verifyAgent = makeAgent('verify-edge', { origin: 'subagent' })
  const mainAgent = services.mainAgent ?? makeAgent('session-edge')
  const agents = {
    get(id) {
      return services.liveAgentId === id ? mainAgent : undefined
    },
    async create(options) {
      calls.create.push(options)
      if (services.createThrows) throw new Error('create failed')
      return { agent: verifyAgent, async dispose() {} }
    },
    async resume(options) {
      calls.resume.push(options)
      return { agent: mainAgent, async dispose() {} }
    },
  }
  const sessionQuery = {
    async readSession(_id) {
      if (services.readThrows) throw new Error('read failed')
      return { header: {}, events: services.readEvents ?? [] }
    },
  }
  const ctx = {
    // 可选依赖局部等待（cordis ctx.inject）：这些用例不提供 commands 服务，
    // 等待态即不注册 /task 命令（与 ctx.get('commands') 返回 undefined 等价）。
    inject() {
      return { dispose() {} }
    },
    logger: { info() {}, warn() {} },
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
      if (name === 'goals')
        return (
          services.goals ?? {
            get() {
              return undefined
            },
          }
        )
      if (name === 'approval')
        return {
          setPolicy(agent, policy) {
            policies.push({ agentId: agent.id, policy })
          },
        }
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

async function registerTask(env, overrides = {}) {
  return callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/tasks',
      method: 'POST',
      body: JSON.stringify({ sessionId: 'session-edge', description: '边界任务', ...overrides }),
    }),
  )
}

// ── trigger answer 动作 ────────────────────────────────────────────────────
test('trigger answer 成功回答待确认问题', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ header: '确认项' }] },
    },
    () => new Promise(() => {}),
  ) // 永不 resolve：缓冲超时后自动决策，问题进待确认列表
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  const id = body.value[0].id
  const answered = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'answer', id, answer: '远程回答' }),
    }),
  )
  assert.equal(answered.body.ok, true)
  const after = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(after.body.value[0].answer, '远程回答')
})

test('trigger answer 未知问题 id 返回 400', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'answer', id: 'nope', answer: 'x' }),
    }),
  )
  assert.equal(response.writeHeadStatus, 400)
})

// ── 未知 API 方法与异常 body ──────────────────────────────────────────────
test('未知 API 方法返回 404', async () => {
  const env = boot()
  const { response } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/nope', method: 'GET' }))
  assert.equal(response.writeHeadStatus, 404)
})

test('非法 JSON body 返回 400', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/tasks',
      method: 'POST',
      body: '{broken',
    }),
  )
  assert.equal(response.writeHeadStatus, 400)
})

// ── ask 参数摘要回退与截断 ────────────────────────────────────────────────
test('ask 只有 question 且首行超长时截断记录', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  const longQuestion = '请确认这个非常长的决策问题究竟应该选择哪一个具体的方案来处理才更合适。'.repeat(6)
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ question: longQuestion }] },
    },
    () => new Promise(() => {}),
  ) // 永不 resolve：缓冲超时后自动决策，问题进待确认列表
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 1)
  assert.ok(body.value[0].question.length <= 81, '问题摘要被截断到 80 字符')
})

test('ask 参数为空时不记录问题', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  await dispatchEvent(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [] },
    },
    () => new Promise(() => {}),
  ) // 永不 resolve：缓冲超时后自动决策，空参数不记录问题
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 0)
})

async function dispatchEvent(listeners, name, ...args) {
  const handlers = listeners[name] ?? []
  assert.ok(handlers.length > 0, `listener ${name} registered`)
  return handlers[handlers.length - 1](...args)
}

// ── 会话级 autopilot 显式关闭 ─────────────────────────────────────────────
test('会话级 autopilot 显式 false 时 ask 透传', async () => {
  const env = boot({ autopilot: true }, { liveAgentId: 'session-edge' })
  await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'mode', autopilot: false, sessionId: 'session-edge' }),
    }),
  )
  let nextCalled = false
  const decision = await dispatchEvent(
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
  assert.ok(
    env.policies.some((p) => p.agentId === 'session-edge' && p.policy === 'ask'),
    '审批策略恢复 ask',
  )
})

// ── 校验流程边界 ──────────────────────────────────────────────────────────
test('sessionQuery 读取失败时校验仍可降级继续', async () => {
  const env = boot({}, { readThrows: true })
  env.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '{"done": false, "reason": "未完"}' }] } },
    },
  ]
  await registerTask(env, { mode: 'verify' })
  await dispatchEvent(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(50)
  assert.equal(env.mainAgent.followed.length, 1, '读取失败后降级唤醒')
})

test('校验结论无法解析时按未完成处理并降级文本', async () => {
  const env = boot()
  env.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '抱歉我无法判断' }] } },
    },
  ]
  await registerTask(env, { mode: 'verify' })
  await dispatchEvent(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(50)
  assert.equal(env.mainAgent.followed.length, 1)
  assert.ok(env.mainAgent.followed[0].content[0].text.includes('任务自动继续'), '无结论时使用默认继续文本')
})

// ── agent 已 live 时重启恢复直接唤醒 ─────────────────────────────────────
test('重启时 agent 已 live 则直接唤醒不重复 resume', async () => {
  const env = boot({ resumeGraceMs: 60000 }, { liveAgentId: 'session-edge' })
  await registerTask(env)
  await tick()
  env.disposeAll()
  const env2 = boot({ resumeGraceMs: 0 }, { liveAgentId: 'session-edge' }, env.dir)
  await tick(30)
  assert.equal(env2.calls.resume.length, 0, 'live agent 不 resume')
  assert.equal(env2.mainAgent.followed.length, 1, '直接 followup 唤醒')
  assert.ok(env2.mainAgent.followed[0].content[0].text.includes('系统重启恢复'))
})

// ── ask 超时边界（issue #34）─────────────────────────────────────────────
test('ask 超时对子代理透传不处理', async () => {
  const env = boot({ askTimeoutMs: 20 })
  const sub = makeAgent('sub-edge', { origin: 'subagent' })
  let nextCalled = false
  const result = await dispatchEvent(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: sub,
      arguments: { questions: [{ id: 'q1', question: 'x' }] },
    },
    () => {
      nextCalled = true
      return Promise.resolve({ value: { answers: [] } })
    },
  )
  assert.equal(nextCalled, true, '子代理直接透传')
  assert.deepEqual(result.value.answers, [])
  assert.equal(sub.followed.length, 0)
})

test('ask 超时对空 exec 透传', async () => {
  const env = boot({ askTimeoutMs: 20 })
  let nextCalled = false
  const result = await dispatchEvent(env.listeners, 'tools/execute', null, () => {
    nextCalled = true
    return Promise.resolve({ value: { output: 'x' } })
  })
  assert.equal(nextCalled, true)
  assert.deepEqual(result.value, { output: 'x' })
})

test('ask 超时 arguments 无 questions 时返回空回答', async () => {
  const env = boot({ askTimeoutMs: 20 })
  const result = await dispatchEvent(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: 'not-an-array' },
    },
    () => new Promise(() => {}),
  )
  assert.deepEqual(result.value.answers, [], '无有效 questions 返回空回答')
  assert.equal(env.mainAgent.followed.length, 1, '仍注入继续指令')
})

// ── 看门狗边界（issue #34）───────────────────────────────────────────────
test('看门狗唤醒 live agent 不重复 resume', async () => {
  const env = boot({ watchdogIntervalMs: 20, stallTimeoutMs: 1000 }, { liveAgentId: 'session-edge' })
  await registerTask(env)
  env.store.tasks[0].updatedAt = Date.now() - 60000
  await tick(60)
  assert.equal(env.calls.resume.length, 0, 'live agent 不 resume')
  assert.equal(env.mainAgent.followed.length, 1, '直接 followup 唤醒')
  assert.ok(env.mainAgent.followed[0].content[0].text.includes('系统唤醒'))
})

test('看门狗跳过非 active 任务', async () => {
  const env = boot({ watchdogIntervalMs: 20, stallTimeoutMs: 1000 })
  await registerTask(env)
  const id = env.store.tasks[0].id
  await callApi(env.api, mockRequest({ url: `/task-reliability/api/tasks/${id}/done`, method: 'POST' }))
  env.store.tasks[0].updatedAt = Date.now() - 60000
  await tick(60)
  assert.equal(env.mainAgent.followed.length, 0, 'done 任务不唤醒')
})

afterAll(() => {
  for (const dispose of disposeAlls.splice(0)) dispose()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
