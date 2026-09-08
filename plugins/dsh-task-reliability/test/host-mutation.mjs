/**
 * Mutation-targeted edge tests for the dsh-task-reliability host half.
 * Kills surviving mutants by asserting exact behaviors the smoke/edge tests
 * leave unasserted: fence variants (trusted hosts / origin / cross-site),
 * loadStore mode parsing, summarizeSession event extraction, verify
 * conclusion parsing branches, request-error retryable-code config, and
 * trigger action branches.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { runWatchdog } from '../lib/verify.js'

// ── mock helpers ──────────────────────────────────────────────────────────
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

function boot(config = {}, services = {}, dirOverride) {
  const dir = dirOverride ?? mkdtempSync(join(tmpdir(), 'dsh-task-rel-mut-'))
  if (dirOverride === undefined) tmpDirs.push(dir)
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const listeners = {}
  const routes = []
  const disposers = []
  const policies = []
  const calls = { create: [], resume: [], read: [] }
  const verifyAgent = makeAgent('verify-mut', { origin: 'subagent' })
  const mainAgent = services.mainAgent ?? makeAgent('session-mut')
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
      if (name === 'sessionQuery') return services.noSessionQuery ? undefined : sessionQuery
      if (name === 'goals')
        return services.noGoals
          ? undefined
          : (services.goals ?? {
              get() {
                return undefined
              },
            })
      if (name === 'approval')
        return services.noApproval
          ? undefined
          : {
              setPolicy(agent, policy) {
                policies.push({ agentId: agent.id, policy })
              },
            }
      if (name === 'webRuntime')
        return services.trustedHosts !== undefined ? { trustedHosts: services.trustedHosts } : { trustedHosts: [] }
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
      body: JSON.stringify({ sessionId: 'session-mut', description: '任务', ...overrides }),
    }),
  )
}

// ── fence：trustedHosts 与 origin 变体 ────────────────────────────────────
test('fence 放行 trustedHosts 中的非本机 host', async () => {
  const env = boot({}, { trustedHosts: ['dsh.example.com'] })
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/info',
      method: 'GET',
      host: 'dsh.example.com',
      origin: 'http://dsh.example.com',
    }),
  )
  assert.equal(response.writeHeadStatus, 200)
})

test('fence 拒绝 trustedHosts 之外的 host', async () => {
  const env = boot({}, { trustedHosts: ['other.example.com'] })
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

test('fence 拒绝 origin 不匹配的请求', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/info',
      method: 'GET',
      origin: 'http://evil.example.com',
    }),
  )
  assert.equal(response.writeHeadStatus, 403)
})

test('fence 拒绝 origin 为非法 URL 的请求', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/info',
      method: 'GET',
      origin: 'not-a-url',
    }),
  )
  assert.equal(response.writeHeadStatus, 403)
})

test('fence 拒绝 sec-fetch-site 为 cross-site 的请求', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/info',
      method: 'GET',
      secFetchSite: 'cross-site',
    }),
  )
  assert.equal(response.writeHeadStatus, 403)
})

test('fence 拒绝带端口的非本机 host', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/info',
      method: 'GET',
      host: 'evil.example.com:8080',
    }),
  )
  assert.equal(response.writeHeadStatus, 403)
})

test('fence 接受 IPv6 本机 host', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/info',
      method: 'GET',
      host: '[::1]:3080',
    }),
  )
  assert.equal(response.writeHeadStatus, 200)
})

// ── loadStore：mode 解析变体 ──────────────────────────────────────────────
test('损坏 mode 结构回退默认 mode', async () => {
  const env = boot()
  writeFileSync(
    join(env.dir, 'task-reliability.json'),
    JSON.stringify({
      version: 1,
      tasks: [{ id: 'task-1', sessionId: 's-1', status: 'active' }],
      questions: 'not-an-array',
      mode: { tracking: 'yes', verify: null, autopilot: 1, sessionAutopilot: 'bad' },
    }),
    'utf8',
  )
  const env2 = boot({}, {}, env.dir)
  const info = await callApi(env2.api, mockRequest({ url: '/task-reliability/api/info', method: 'GET' }))
  assert.equal(info.body.value.tracking, false)
  assert.equal(info.body.value.verify, false)
  assert.equal(info.body.value.autopilot, false)
  assert.deepEqual(info.body.value.sessionAutopilot, {})
})

// ── 校验：会话摘要提取 ────────────────────────────────────────────────────
test('校验摘要包含用户与助手消息文本', async () => {
  const env = boot(
    {},
    {
      readEvents: [
        {
          type: 'user/message',
          data: { message: { content: [{ type: 'text', text: '帮我写代码' }] } },
        },
        {
          type: 'assistant/message',
          data: { message: { content: [{ type: 'text', text: '好的，开始' }] } },
        },
      ],
    },
  )
  env.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '{"done": false, "reason": "未完"}' }] } },
    },
  ]
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(80)
  // 校验 agent 收到含会话摘要的指令
  const prompt = env.verifyAgent.followed[0].content[0].text
  assert.ok(prompt.includes('帮我写代码'), '摘要包含用户消息')
  assert.ok(prompt.includes('好的，开始'), '摘要包含助手消息')
})

test('摘要超过上限时截断', async () => {
  const events = []
  for (let i = 0; i < 30; i++) {
    events.push({
      type: 'user/message',
      data: { message: { content: [{ type: 'text', text: `消息${i}：${'x'.repeat(600)}` }] } },
    })
  }
  const env = boot({}, { readEvents: events })
  env.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '{"done": true, "reason": "完成"}' }] } },
    },
  ]
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(80)
  const prompt = env.verifyAgent.followed[0].content[0].text
  assert.ok(prompt.length < 9000, '摘要被截断')
})

test('ask 工具无有效 questions 参数时仍拒绝但不记录问题', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 0 })
  let nextCalled = false
  const decision = await dispatchOne(
    env.listeners,
    'tools/pre-execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: 'not-an-array' },
    },
    () => {
      nextCalled = true
      return Promise.resolve({ kind: 'allow' })
    },
  )
  assert.equal(decision.kind, 'deny', 'autopilot 下仍拒绝')
  assert.equal(nextCalled, false)
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 0, '无效参数不记录问题')
})

test('config 可关闭重试并自定义重试码', async () => {
  const env = boot({ retryMax: 1, retryableCodes: ['CUSTOM_TIMEOUT'] })
  // 自定义码命中
  const hit = await dispatchOne(
    env.listeners,
    'agent/request-error',
    {
      agent: env.mainAgent,
      failure: { code: 'CUSTOM_TIMEOUT', message: 'x' },
      signal: { aborted: false },
    },
    () => Promise.resolve(undefined),
  )
  assert.equal(hit.kind, 'retry')
  // 默认 TIMEOUT 码不再命中（被自定义码覆盖）
  let nextCalled = false
  await dispatchOne(
    env.listeners,
    'agent/request-error',
    {
      agent: env.mainAgent,
      failure: { code: 'TIMEOUT', message: 'x' },
      signal: { aborted: false },
    },
    () => {
      nextCalled = true
      return Promise.resolve(undefined)
    },
  )
  assert.equal(nextCalled, true)
})

test('turn-stopping 循环上限后失败标记', async () => {
  const env = boot({ maxLoop: 1, steerCooldownMs: 0 })
  await registerTask(env)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  await tick()
  const store = JSON.parse(readFileSync(join(env.dir, 'task-reliability.json'), 'utf8'))
  assert.equal(store.tasks[0].status, 'failed')
})

test('全局速率限制阻止过量注入', async () => {
  const env = boot({ rateMaxActions: 3, steerCooldownMs: 0 })
  await registerTask(env)
  for (let i = 0; i < 5; i++) {
    await dispatchOne(env.listeners, 'agent/turn-stopping', {
      agent: env.mainAgent,
      signal: { aborted: false },
    })
  }
  assert.ok(env.mainAgent.steered.length <= 3, '速率限制生效')
})

// ── 更多变异定向断言 ───────────────────────────────────────────────────────
test('相同待确认问题不重复添加', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  const args = { questions: [{ header: '重复问题' }] }
  for (let i = 0; i < 3; i++) {
    await dispatchOne(
      env.listeners,
      'tools/execute',
      {
        name: 'ask_user_question',
        agent: env.mainAgent,
        arguments: args,
      },
      () => new Promise(() => {}),
    ) // 永不 resolve：缓冲超时后自动决策，问题进待确认列表
  }
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 1, '相同问题只记录一次')
})

test('delegationDepth 大于 0 的子代理不处理', async () => {
  const env = boot()
  const deep = makeAgent('deep-1')
  deep.session.header.delegationDepth = 2
  await registerTask(env)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: deep,
    signal: { aborted: false },
  })
  assert.equal(deep.steered.length, 0, '深层代理不注入')
})

test('trigger 注册缺参数返回 400', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'register', description: '无会话' }),
    }),
  )
  assert.equal(response.writeHeadStatus, 400)
})

test('mode 路由带会话级 autopilot 且生效', async () => {
  const env = boot({}, { liveAgentId: 'session-mut' })
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/mode',
      method: 'POST',
      body: JSON.stringify({ sessionId: 'session-mut', autopilot: true }),
    }),
  )
  assert.equal(response.writeHeadStatus, 200)
  const info = await callApi(env.api, mockRequest({ url: '/task-reliability/api/info', method: 'GET' }))
  assert.equal(info.body.value.sessionAutopilot['session-mut'], true)
  assert.ok(env.policies.some((p) => p.agentId === 'session-mut' && p.policy === 'never'))
})

test('trigger mode 动作切换全局开关', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'mode', tracking: true }),
    }),
  )
  assert.equal(response.writeHeadStatus, 200)
  const info = await callApi(env.api, mockRequest({ url: '/task-reliability/api/info', method: 'GET' }))
  assert.equal(info.body.value.tracking, true)
})

test('mode 路由无 token 被拒（apiToken 配置时）', async () => {
  const env = boot({ apiToken: 'tok' })
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/mode',
      method: 'POST',
      body: JSON.stringify({ tracking: true }),
    }),
  )
  assert.equal(response.writeHeadStatus, 403)
})

test('trigger 无 token 被拒（apiToken 配置时）', async () => {
  const env = boot({ apiToken: 'tok' })
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'status' }),
    }),
  )
  assert.equal(response.writeHeadStatus, 403)
})

test('任务不存在时状态操作返回 404', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/tasks/nope/done',
      method: 'POST',
    }),
  )
  assert.equal(response.writeHeadStatus, 404)
})

test('校验结论 JSON 带多余文本也能解析', async () => {
  const env = boot()
  env.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: {
        message: {
          content: [{ type: 'text', text: '结论如下：{"done": false, "reason": "还差一点"} 完毕' }],
        },
      },
    },
  ]
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(80)
  assert.equal(env.mainAgent.followed.length, 1)
  assert.ok(env.mainAgent.followed[0].content[0].text.includes('还差一点'))
})

test('info 统计任务数与待确认问题数', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  await registerTask(env)
  await tick()
  // 通过 autopilot ask 缓冲超时产生一个待确认问题
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ header: '待确认' }] },
    },
    () => new Promise(() => {}),
  ) // 永不 resolve：缓冲超时后自动决策，问题进待确认列表
  await tick()
  const info = await callApi(env.api, mockRequest({ url: '/task-reliability/api/info', method: 'GET' }))
  assert.equal(info.body.value.taskCount, 1)
  assert.equal(info.body.value.activeCount, 1)
  assert.equal(info.body.value.questionCount, 1)
})

test('注册任务 sessionId 非字符串返回 400', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/tasks',
      method: 'POST',
      body: JSON.stringify({ sessionId: 123, description: 'x' }),
    }),
  )
  assert.equal(response.writeHeadStatus, 400)
})

test('questions answer 路由带 token 校验', async () => {
  const env = boot({ apiToken: 'tok' })
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/questions/x/answer',
      method: 'POST',
      body: JSON.stringify({ answer: 'y' }),
    }),
  )
  assert.equal(response.writeHeadStatus, 403, 'answer 路由要求 token')
})

test('questions answer 未知问题返回 404', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/questions/nope/answer',
      method: 'POST',
      body: JSON.stringify({ answer: 'y' }),
    }),
  )
  assert.equal(response.writeHeadStatus, 404)
})

test('fence 拒绝 127 前缀但非法的 IP', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/info',
      method: 'GET',
      host: '127.0.0.999:3080',
    }),
  )
  assert.equal(response.writeHeadStatus, 403, '非法 IP 段拒绝')
})

test('任务描述超长时 trigger 注册返回 400', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'register', sessionId: 's-1', description: 'x'.repeat(501) }),
    }),
  )
  assert.equal(response.writeHeadStatus, 400)
})

// ── 第四轮定向补测 ────────────────────────────────────────────────────────
test('questions 数组含 null 元素时过滤', async () => {
  const env = boot()
  writeFileSync(
    join(env.dir, 'task-reliability.json'),
    JSON.stringify({
      version: 1,
      tasks: [],
      questions: [null, { id: 'q-1', question: '有效' }],
      mode: {},
    }),
    'utf8',
  )
  const env2 = boot({}, {}, env.dir)
  const { body } = await callApi(env2.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 1, 'null 被过滤')
  assert.equal(body.value[0].question, '有效')
})

test('trustedHosts 含非法 URL 时仅本机放行', async () => {
  const env = boot({}, { trustedHosts: ['bad::url'] })
  const evil = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/info',
      method: 'GET',
      host: 'evil.example.com',
    }),
  )
  assert.equal(evil.response.writeHeadStatus, 403, '非法 entry 不匹配')
  const local = await callApi(env.api, mockRequest({ url: '/task-reliability/api/info', method: 'GET' }))
  assert.equal(local.response.writeHeadStatus, 200, '本机仍放行')
})

async function collectStream(stream) {
  try {
    for await (const chunk of stream) {
      void chunk
    }
  } catch {
    // 预期抛错
  }
}

test('第二次重复打断使用更强文本', async () => {
  const env = boot()
  const long = '反复推敲同一段思考内容及其潜在影响与后续步骤的详细规划与执行细节安排。'.repeat(8)
  const chunks = []
  for (let b = 0; b < 5; b++) {
    chunks.push({ type: 'block-start', index: b, blockType: 'reasoning' })
    for (const ch of long) chunks.push({ type: 'reasoning-delta', index: b, text: ch })
    chunks.push({ type: 'block-end', index: b, block: { type: 'reasoning', text: long } })
  }
  const makeStream = () =>
    (async function* () {
      for (const c of chunks) yield c
    })()
  const w1 = await dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-mut' }, makeStream)
  await collectStream(w1)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  assert.ok(env.mainAgent.steered[0].content[0].text.includes('请收敛思考'), '第一次为温和提示')
  const w2 = await dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-mut' }, makeStream)
  await collectStream(w2)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  assert.ok(env.mainAgent.steered[1].content[0].text.includes('思考重复循环'), '第二次为强打断')
})

test('校验代理 whenIdle 拒绝时降级继续', async () => {
  const env = boot()
  env.verifyAgent.whenIdle = () => Promise.reject(new Error('boom'))
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(80)
  assert.equal(env.mainAgent.followed.length, 1, 'whenIdle 失败降级唤醒')
})

test('回答数字答案转为空字符串', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ header: '问题' }] },
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
      body: JSON.stringify({ answer: 123 }),
    }),
  )
  assert.equal(answered.body.ok, true)
  const after = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(after.body.value[0].answer, '', '非字符串答案转空')
})

test('注册任务 mode 非法值回退 direct', async () => {
  const env = boot()
  const { body } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/tasks',
      method: 'POST',
      body: JSON.stringify({ sessionId: 's-mode', description: 'x', mode: 'bogus' }),
    }),
  )
  assert.equal(body.value.mode, 'direct')
})

test('host 头缺失时 fence 拒绝', async () => {
  const env = boot()
  const response = mockResponse()
  await env.api.handler({ url: '/task-reliability/api/info', method: 'GET', headers: {} }, response)
  assert.equal(response.writeHeadStatus, 403)
})

test('校验结论 done 为字符串时按未完成处理', async () => {
  const env = boot()
  env.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '{"done": "yes", "reason": "x"}' }] } },
    },
  ]
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(80)
  assert.equal(env.mainAgent.followed.length, 1, '非布尔 done 视为未完成')
})

// ── 第五轮：精确消息/文本断言（杀 StringLiteral 变异）────────────────────
test('注册任务错误消息精确内容', async () => {
  const env = boot()
  const empty = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/tasks',
      method: 'POST',
      body: JSON.stringify({ sessionId: '', description: 'x' }),
    }),
  )
  assert.equal(empty.body.error.message, 'sessionId and description are required')
  const long = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/tasks',
      method: 'POST',
      body: JSON.stringify({ sessionId: 's-1', description: 'x'.repeat(501) }),
    }),
  )
  assert.equal(long.body.error.message, 'description too long (max 500)')
  await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/tasks',
      method: 'POST',
      body: JSON.stringify({ sessionId: 's-1', description: '任务' }),
    }),
  )
  const dup = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/tasks',
      method: 'POST',
      body: JSON.stringify({ sessionId: 's-1', description: '任务2' }),
    }),
  )
  assert.ok(dup.body.error.message.startsWith('session already has an active task'))
})

test('任务与问题不存在时的精确错误消息', async () => {
  const env = boot()
  const task404 = await callApi(env.api, mockRequest({ url: '/task-reliability/api/tasks/nope/done', method: 'POST' }))
  assert.equal(task404.body.error.message, 'task not found')
  const q404 = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/questions/nope/answer',
      method: 'POST',
      body: JSON.stringify({ answer: 'x' }),
    }),
  )
  assert.equal(q404.body.error.message, 'question not found')
  const unknown = await callApi(env.api, mockRequest({ url: '/task-reliability/api/nope', method: 'GET' }))
  assert.equal(unknown.body.error.message, 'unknown dsh-task-reliability API method')
})

test('fence 与 token 拒绝的精确错误消息', async () => {
  const env = boot({ apiToken: 'tok' })
  const fence403 = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/info',
      method: 'GET',
      host: 'evil.example.com',
    }),
  )
  assert.equal(fence403.body.error.message, 'forbidden')
  const token403 = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'status' }),
    }),
  )
  assert.equal(token403.body.error.message, 'invalid x-task-reliability-token')
})

test('direct 继续文本包含完整段落', async () => {
  const env = boot()
  await registerTask(env)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  const text = env.mainAgent.steered[0].content[0].text
  assert.ok(text.includes('你之前的任务尚未确认完成'))
  assert.ok(text.includes('检查当前进度，列出剩余未完成的部分并逐一执行'))
  assert.ok(text.includes('如果任务实际上已经完成，请明确说明已完成并结束'))
})

test('重启恢复文本包含完整段落', async () => {
  const env = boot({ resumeGraceMs: 60000 })
  await registerTask(env)
  await tick()
  env.disposeAll()
  const env2 = boot({ resumeGraceMs: 0 }, {}, env.dir)
  await tick(30)
  const text = env2.mainAgent.followed[0].content[0].text
  assert.ok(text.includes('系统此前在任务执行中被中断（休眠/重启）'))
  assert.ok(text.includes('先回顾当前进度，然后继续执行剩余部分，直到任务完成'))
})

test('autopilot 拒绝文本包含完整段落', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ header: 'h' }] },
    },
    () => new Promise(() => {}),
  ) // 永不 resolve：缓冲超时后注入自动决策指令
  assert.equal(env.mainAgent.followed.length, 1, '缓冲超时后注入自动决策指令')
  const text = env.mainAgent.followed[0].content[0].text
  assert.ok(text.includes('用户当前不在线，无法回答问题'))
  assert.ok(text.includes('请基于已有信息和上下文做出最合理的决策并继续执行'))
  assert.ok(text.includes('该问题已记录，用户回来后统一处理'))
})

test('校验指令包含完整段落', async () => {
  const env = boot()
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(50)
  const prompt = env.verifyAgent.followed[0].content[0].text
  assert.ok(prompt.includes('你是一个任务完成度校验员'))
  assert.ok(prompt.includes('请严格只输出一个 JSON 对象'))
  assert.ok(prompt.includes('判断标准：任务的所有要求是否都已被满足'))
})

test('localhost 与 IPv6 本机 host 放行', async () => {
  const env = boot()
  const localhost = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/info',
      method: 'GET',
      host: 'localhost:3080',
    }),
  )
  assert.equal(localhost.response.writeHeadStatus, 200)
  const v6 = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/info',
      method: 'GET',
      host: '[::1]:3080',
    }),
  )
  assert.equal(v6.response.writeHeadStatus, 200)
})

// ── 第六轮：输入变体穷尽（杀 filter/解析类存活变异）──────────────────────
test('会话摘要忽略非文本与非字符串块', async () => {
  const env = boot(
    {},
    {
      readEvents: [
        {
          type: 'user/message',
          data: {
            message: {
              content: [
                null,
                { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' },
                { type: 'text', text: '' },
                { type: 'text', text: '正常文本' },
                { type: 'text', text: 42 },
              ],
            },
          },
        },
      ],
    },
  )
  env.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '{"done": true, "reason": "ok"}' }] } },
    },
  ]
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(80)
  const prompt = env.verifyAgent.followed[0].content[0].text
  assert.ok(prompt.includes('正常文本'), '文本块被提取')
  assert.ok(!prompt.includes('tool-call'), '非文本块被忽略')
  assert.ok(!prompt.includes('42'), '非字符串文本被忽略')
})

test('校验结论读取跳过空消息与非文本块', async () => {
  const env = boot()
  env.verifyAgent.session.events = [
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '' }] } } },
    { type: 'assistant/message', data: { message: { content: null } } },
    {
      type: 'user/message',
      data: { message: { content: [{ type: 'text', text: '{"done": true, "reason": "完成"}' }] } },
    },
    {
      type: 'assistant/message',
      data: {
        message: {
          content: [
            { type: 'reasoning', text: '思考' },
            { type: 'text', text: '{"done": false, "reason": "未完"}' },
          ],
        },
      },
    },
  ]
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(80)
  assert.equal(env.mainAgent.followed.length, 1, '只读最后 assistant 文本')
  assert.ok(env.mainAgent.followed[0].content[0].text.includes('未完'), '跳过 reasoning 块取 text')
})

test('isLoopbackHostname 各变体', async () => {
  const env = boot()
  const cases = [
    ['127.0.0.1:3080', 200],
    ['127.0.0.1', 200],
    ['127.0.0.256:3080', 403],
    ['127.0.0.1.2:3080', 403],
    ['a.b.c.d:3080', 403],
    ['127.1.2.3:3080', 200],
    ['255.255.255.255:3080', 403],
  ]
  for (const [host, expected] of cases) {
    const { response } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/info', method: 'GET', host }))
    assert.equal(response.writeHeadStatus, expected, `host=${host}`)
  }
})

test('addQuestion 去重变体', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  const ask = (header) =>
    dispatchOne(
      env.listeners,
      'tools/execute',
      {
        name: 'ask_user_question',
        agent: env.mainAgent,
        arguments: { questions: [{ header }] },
      },
      () => new Promise(() => {}),
    ) // 永不 resolve：缓冲超时后自动决策，问题进待确认列表
  await ask('问题A')
  await ask('问题B') // 同会话不同问题 → 新增
  await ask('问题A') // 同会话同问题 → 去重
  await tick()
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 2, 'A/B 各一条，重复 A 被去重')
  // 回答 A 后可再添加同问题
  const aId = body.value.find((q) => q.question === '问题A').id
  await callApi(
    env.api,
    mockRequest({
      url: `/task-reliability/api/questions/${aId}/answer`,
      method: 'POST',
      body: JSON.stringify({ answer: '已答' }),
    }),
  )
  await ask('问题A')
  await tick()
  const after = await callApi(env.api, mockRequest({ method: 'GET', url: '/task-reliability/api/questions' }))
  assert.equal(after.body.value.length, 3, '已答后同问题可再添加')
})

test('askNoteOf 无有效参数不记录', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  const variants = [
    { questions: undefined },
    { questions: [] },
    { questions: [null] },
    { questions: [{ question: '' }] },
    { questions: [{ question: '只有问题' }] },
  ]
  for (const args of variants) {
    await dispatchOne(
      env.listeners,
      'tools/execute',
      {
        name: 'ask_user_question',
        agent: env.mainAgent,
        arguments: args,
      },
      () => new Promise(() => {}),
    ) // 永不 resolve：缓冲超时后自动决策，无效参数不记录
  }
  await tick()
  const { body } = await callApi(env.api, mockRequest({ method: 'GET', url: '/task-reliability/api/questions' }))
  assert.equal(body.value.length, 1, '仅「只有问题」被记录')
  assert.equal(body.value[0].question, '只有问题')
})

test('approval 服务缺失时模式切换不抛错', async () => {
  const env = boot({}, { noApproval: true })
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/mode',
      method: 'POST',
      body: JSON.stringify({ sessionId: 'session-mut', autopilot: true }),
    }),
  )
  assert.equal(response.writeHeadStatus, 200)
})

test('agents.get 无结果时审批策略不应用', async () => {
  const env = boot({}, { liveAgentId: 'other-session' })
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/mode',
      method: 'POST',
      body: JSON.stringify({ sessionId: 'session-mut', autopilot: true }),
    }),
  )
  assert.equal(response.writeHeadStatus, 200)
  assert.equal(env.policies.length, 0, '未找到 agent 时不设置策略')
})

test('sessionQuery 缺失时校验降级用任务描述', async () => {
  const env = boot({}, { noSessionQuery: true })
  env.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '{"done": false, "reason": "未完"}' }] } },
    },
  ]
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(80)
  assert.equal(env.mainAgent.followed.length, 1, '仍能唤醒继续')
  assert.ok(env.mainAgent.followed[0].content[0].text.includes('任务校验'), '带校验结论唤醒')
})

test('goal objective 非字符串不自动登记', async () => {
  const env = boot({}, { goals: { get: () => ({ objective: 123, status: 'active' }) } })
  await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/mode',
      method: 'POST',
      body: JSON.stringify({ tracking: true }),
    }),
  )
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick()
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/tasks', method: 'GET' }))
  assert.equal(body.value.length, 0, '非字符串 objective 不登记')
})

test('info 统计 checking 状态任务', async () => {
  const env = boot()
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(20)
  const info = await callApi(env.api, mockRequest({ url: '/task-reliability/api/info', method: 'GET' }))
  assert.equal(info.body.value.activeCount, 1, 'checking 计入 activeCount')
  assert.equal(info.body.value.taskCount, 1)
})

test('保存失败不崩溃（目录被删）', async () => {
  const env = boot()
  rmSync(env.dir, { recursive: true, force: true })
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/tasks',
      method: 'POST',
      body: JSON.stringify({ sessionId: 's-1', description: '任务' }),
    }),
  )
  assert.equal(response.writeHeadStatus, 200, 'save 失败不影响 API 响应')
})

test('trigger 注册 body 非法 JSON 返回 400', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: 'not-json',
    }),
  )
  assert.equal(response.writeHeadStatus, 400)
})

test('trigger register sessionId 非法返回 400', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'register', sessionId: 123, description: 'x' }),
    }),
  )
  assert.equal(response.writeHeadStatus, 400)
})

test('trigger answer id 非法返回 400', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/trigger',
      method: 'POST',
      body: JSON.stringify({ action: 'answer', id: 123, answer: 'x' }),
    }),
  )
  assert.equal(response.writeHeadStatus, 400)
})

test('非字符串 description 注册返回 400', async () => {
  const env = boot()
  const { response } = await callApi(
    env.api,
    mockRequest({
      url: '/task-reliability/api/tasks',
      method: 'POST',
      body: JSON.stringify({ sessionId: 's-1', description: 123 }),
    }),
  )
  assert.equal(response.writeHeadStatus, 400)
})

// ── 第七轮：issue #34 变异定向断言 ────────────────────────────────────────
test('ask 超时继续文本包含完整段落', async () => {
  const env = boot({ askTimeoutMs: 20 })
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'x' }] },
    },
    () => new Promise(() => {}),
  )
  const text = env.mainAgent.followed[0].content[0].text
  assert.ok(text.includes('用户长时间未响应'))
  assert.ok(text.includes('请基于已有信息和上下文自行决策并继续执行任务'))
  assert.ok(text.includes('不要再次询问用户'))
  assert.ok(text.includes('被跳过的询问已记录，用户回来后统一处理'))
})

test('ask 超时模拟回答跳过无 id 问题', async () => {
  const env = boot({ askTimeoutMs: 20 })
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: {
        questions: [{ question: '无 id 的问题' }, { id: 'q1', question: '有 id 的问题' }, null],
      },
    },
    () => new Promise(() => {}),
  )
  assert.equal(result.value.answers.length, 1, '仅有效 id 的问题生成回答')
  assert.equal(result.value.answers[0].id, 'q1')
})

test('ask 超时模拟回答 options 非数组时 selected 为空', async () => {
  const env = boot({ askTimeoutMs: 20 })
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'x', options: 'not-array' }] },
    },
    () => new Promise(() => {}),
  )
  assert.deepEqual(result.value.answers[0].selected, [], '非法 options 视为无推荐')
})

test('ask 超时模拟回答过滤非法 option 项', async () => {
  const env = boot({ askTimeoutMs: 20 })
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: {
        questions: [{ id: 'q1', question: 'x', options: [null, { label: '推荐' }, { label: 42 }] }],
      },
    },
    () => new Promise(() => {}),
  )
  assert.deepEqual(result.value.answers[0].selected, ['推荐'], '仅合法 label 的 option 可被选中')
})

test('看门狗唤醒文本包含完整段落', async () => {
  const env = boot({ watchdogIntervalMs: 20, stallTimeoutMs: 1000 })
  await registerTask(env)
  env.store.tasks[0].updatedAt = Date.now() - 60000
  await tick(60)
  const text = env.mainAgent.followed[0].content[0].text
  assert.ok(text.includes('系统此前因锁屏/休眠/网络中断而停滞'))
  assert.ok(text.includes('先回顾当前进度，然后继续执行剩余部分，直到任务完成'))
})

test('看门狗停滞判定为严格小于阈值', async () => {
  const env = boot({ watchdogIntervalMs: 0, stallTimeoutMs: 1000 })
  await registerTask(env)
  const task = env.store.tasks[0]
  const now = Date.now()
  task.updatedAt = now - 999 // 未到阈值 → 不唤醒
  await runWatchdog(env.ctx, env.store, () => {}, { stallTimeoutMs: 1000 }, now)
  assert.equal(env.mainAgent.followed.length, 0, '未到阈值不视为停滞')
  task.updatedAt = now - 1000 // 恰好等于阈值 → 视为停滞（严格小于）
  await runWatchdog(env.ctx, env.store, () => {}, { stallTimeoutMs: 1000 }, now)
  assert.equal(env.mainAgent.followed.length, 1, '等于阈值视为停滞')
})

test('ask 超时配置为 0 时透传且不记录问题', async () => {
  const env = boot({ askTimeoutMs: 0 })
  let nextCalled = false
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'x' }] },
    },
    () => {
      nextCalled = true
      return Promise.resolve({ value: { answers: [{ id: 'q1', selected: ['B'] }] } })
    },
  )
  assert.equal(nextCalled, true)
  assert.deepEqual(result.value.answers[0].selected, ['B'])
  const { body } = await callApi(env.api, mockRequest({ url: '/task-reliability/api/questions', method: 'GET' }))
  assert.equal(body.value.length, 0, '禁用时不记录问题')
})

afterAll(() => {
  for (const dispose of disposeAlls.splice(0)) dispose()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
