/**
 * Structured plugin event tests for dsh-task-reliability (issue #154):
 *  - 干预（循环打断/任务继续/工具循环）发出 task-reliability/intervention；
 *  - ask 决策（超时自动决策/迟到回答）发出 task-reliability/ask-decision；
 *  - 救场（看门狗唤醒）发出 task-reliability/rescue；
 *  - verify（校验开始/结论/降级）发出 task-reliability/verify；
 *  - 恢复（重启 resume）发出 task-reliability/resume；
 *  - emit 失败静默：ctx.emit 抛错不影响主流程（steer/followup 照常）；
 *  - 待确认问题列表清理：已答超上限淘汰、过期未答清理、未答保留。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { pruneQuestions, addQuestion } from '../lib/store.js'
import { MAX_QUESTIONS, QUESTION_TTL_MS } from '../lib/constants.js'

// ── mock helpers（基于 host-smoke.mjs 结构，ctx 增加 emit 记录）───────────
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
    destroy() {},
    on() {},
    removeListener() {},
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

/** Boot 插件：mock ctx 记录 emit 到 env.emitted；emitBroken 模拟 emit 抛错。 */
function boot(config = {}, services = {}, dirOverride, emitBroken = false) {
  const dir = dirOverride ?? mkdtempSync(join(tmpdir(), 'dsh-task-reliability-emit-'))
  if (dirOverride === undefined) tmpDirs.push(dir)
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const listeners = {}
  const routes = []
  const disposers = []
  const emitted = []
  const verifyAgent = makeAgent('verify-mock', { origin: 'subagent' })
  const mainAgent = services.mainAgent ?? makeAgent('session-main')
  const agents = {
    get(id) {
      return services.liveAgentId === id ? mainAgent : undefined
    },
    async create() {
      return { agent: verifyAgent, async dispose() {} }
    },
    async resume() {
      return { agent: mainAgent, async dispose() {} }
    },
  }
  const sessionQuery = {
    async readSession() {
      return { header: {}, events: services.readEvents ?? [] }
    },
  }
  const ctx = {
    // 可选依赖局部等待（cordis ctx.inject）：这些用例不提供 commands 服务，
    // 等待态即不注册 /task 命令（与 ctx.get('commands') 返回 undefined 等价）。
    inject() {
      return { dispose() {} }
    },
    logger: { warn() {}, info() {} },
    on(name, handler) {
      ;(listeners[name] ??= []).push(handler)
      return () => {}
    },
    emit(name, payload) {
      if (emitBroken) throw new Error('emit broken')
      emitted.push({ name, payload })
    },
    effect(fn) {
      const dispose = fn()
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
    emitted,
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
      body: JSON.stringify({
        sessionId: 'session-main',
        description: '开发一个功能',
        ...overrides,
      }),
    }),
  )
}

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

async function collect(stream) {
  const out = []
  try {
    for await (const chunk of stream) out.push(chunk)
    return { chunks: out, error: undefined }
  } catch (error) {
    return { chunks: out, error }
  }
}

function eventsOf(env, name) {
  return env.emitted.filter((e) => e.name === name).map((e) => e.payload)
}

// ── 干预事件 ──────────────────────────────────────────────────────────────
test('循环打断注入时发出 intervention 事件（repeat-break）', async () => {
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
  const events = eventsOf(env, 'task-reliability/intervention')
  assert.equal(events.length, 1, 'one intervention event')
  assert.equal(events[0].sessionId, 'session-main')
  assert.equal(events[0].action, 'repeat-break')
  assert.equal(events[0].reason, 'reason')
  assert.equal(events[0].count, 1)
})

test('任务自动继续注入 steer 时发出 intervention 事件（steer-continue）', async () => {
  const env = boot()
  await registerTask(env)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  const events = eventsOf(env, 'task-reliability/intervention')
  assert.equal(events.length, 1)
  assert.equal(events[0].action, 'steer-continue')
  assert.equal(events[0].reason, 'turn-stopping')
  assert.equal(events[0].sessionId, 'session-main')
  assert.ok(events[0].taskId !== undefined, 'taskId included')
})

test('工具序列循环命中时发出 intervention 事件（tool-loop）', async () => {
  const env = boot({ toolLoopConsecutive: 2, toolLoopWindow: 2 })
  const exec = { name: 'bash', agent: env.mainAgent, arguments: { command: 'ls' } }
  for (let i = 0; i < 3; i++) {
    try {
      await dispatchOne(env.listeners, 'tools/execute', exec, () => Promise.resolve({}))
    } catch {
      break // TOOL_LOOP 中断回合
    }
  }
  const events = eventsOf(env, 'task-reliability/intervention')
  const toolLoop = events.find((e) => e.action === 'tool-loop')
  assert.ok(toolLoop !== undefined, 'tool-loop event emitted')
  assert.equal(toolLoop.reason, 'tool-sequence')
  assert.equal(toolLoop.sessionId, 'session-main')
})

// ── ask 决策事件 ───────────────────────────────────────────────────────────
test('ask 超时自动决策发出 ask-decision 事件（ask-timeout）', async () => {
  const env = boot({ askTimeoutMs: 20 })
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？' }] },
    },
    () => new Promise(() => {}),
  )
  const events = eventsOf(env, 'task-reliability/ask-decision')
  assert.equal(events.length, 1)
  assert.equal(events[0].action, 'ask-timeout')
  assert.equal(events[0].reason, 'ask-timeout')
  assert.equal(events[0].sessionId, 'session-main')
  assert.equal(events[0].question, 'A 还是 B？')
})

test('autopilot 缓冲超时发出 ask-decision 事件（autopilot-grace）', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？' }] },
    },
    () => new Promise(() => {}),
  )
  const events = eventsOf(env, 'task-reliability/ask-decision')
  assert.equal(events.length, 1)
  assert.equal(events[0].action, 'ask-timeout')
  assert.equal(events[0].reason, 'autopilot-grace')
  assert.equal(events[0].autopilot, true)
})

test('autopilotGraceMs=0 立即拦截发出 ask-decision 事件（ask-deny）', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 0 })
  await dispatchOne(
    env.listeners,
    'tools/pre-execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ header: '选哪个方案？' }] },
    },
    () => Promise.resolve({ kind: 'allow' }),
  )
  const events = eventsOf(env, 'task-reliability/ask-decision')
  assert.equal(events.length, 1)
  assert.equal(events[0].action, 'ask-deny')
  assert.equal(events[0].reason, 'autopilot')
  assert.equal(events[0].question, '选哪个方案？')
})

test('超时后迟到回答发出 ask-decision 事件（ask-late-answer）', async () => {
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
  resolveNext({ value: { answers: [{ id: 'q1', selected: ['B'] }] } })
  await tick(10)
  const events = eventsOf(env, 'task-reliability/ask-decision')
  const late = events.find((e) => e.action === 'ask-late-answer')
  assert.ok(late !== undefined, 'late-answer event emitted')
  assert.equal(late.reason, 'late-answer')
  assert.equal(late.answer, 'B')
})

// ── 救场事件（看门狗唤醒 + #147 输出未完成救场）────────────────────────
test('看门狗唤醒停滞任务发出 rescue 事件（wake-stalled）', async () => {
  const env = boot({ watchdogIntervalMs: 20, stallTimeoutMs: 1000 })
  await registerTask(env)
  env.store.tasks[0].updatedAt = Date.now() - 60000
  await tick(60)
  const events = eventsOf(env, 'task-reliability/rescue')
  assert.equal(events.length, 1)
  assert.equal(events[0].action, 'wake-stalled')
  assert.equal(events[0].reason, 'stall-timeout')
  assert.equal(events[0].sessionId, 'session-main')
})

/** 走一遍 llm/stream（finish kind 可指定），让 wrapStreamForLoop 捕获 lastFinish。 */
async function runStream(env, sessionId, finishKind, text = '正常输出内容。') {
  const chunks = [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...text.split('').map((ch) => ({ type: 'text-delta', index: 0, text: ch })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: finishKind } },
  ]
  const wrapped = dispatchOne(env.listeners, 'llm/stream', { sessionId }, () => {
    return (async function* () {
      for (const chunk of chunks) yield chunk
    })()
  })
  for await (const chunk of wrapped) {
    void chunk
  }
}

test('输出未完成自动救场发出 rescue 事件（rescue-turn，issue #147）', async () => {
  const env = boot(
    {},
    {
      mainAgent: makeAgent('session-main', {
        events: [
          {
            type: 'assistant/message',
            data: { message: { content: [{ type: 'text', text: '```js\nconst x = 1' }] } },
          },
        ],
      }),
    },
  )
  await runStream(env, 'session-main', 'max-tokens')
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  const events = eventsOf(env, 'task-reliability/rescue')
  const turn = events.find((e) => e.action === 'rescue-turn')
  assert.ok(turn !== undefined, 'rescue-turn event emitted')
  assert.equal(turn.reason, 'truncation')
  assert.equal(turn.sessionId, 'session-main')
  assert.equal(turn.count, 1)
})

test('回合 error 事后救场发出 rescue 事件（rescue-after-error，issue #147）', async () => {
  const env = boot(
    {},
    {
      mainAgent: makeAgent('session-main', {
        events: [
          {
            type: 'assistant/message',
            data: {
              message: {
                content: [{ type: 'text', text: '接下来我们需要仔细分析这个方案的每一个细节并给出最终结论和建议' }],
              },
            },
          },
        ],
      }),
    },
  )
  await dispatchOne(env.listeners, 'agent/error', { agent: env.mainAgent })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  const events = eventsOf(env, 'task-reliability/rescue')
  const after = events.find((e) => e.action === 'rescue-after-error')
  assert.ok(after !== undefined, 'rescue-after-error event emitted')
  assert.equal(after.reason, 'error')
  assert.equal(after.sessionId, 'session-main')
})

// ── verify 事件 ────────────────────────────────────────────────────────────
test('校验结论 done 发出 verify 事件（verify-start + verify-done）', async () => {
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
  const events = eventsOf(env, 'task-reliability/verify')
  const start = events.find((e) => e.action === 'verify-start')
  const done = events.find((e) => e.action === 'verify-done')
  assert.ok(start !== undefined, 'verify-start emitted')
  assert.equal(start.reason, 'session-idle')
  assert.ok(done !== undefined, 'verify-done emitted')
  assert.equal(done.reason, '全部完成')
  assert.equal(done.sessionId, 'session-main')
})

test('校验未完成发出 verify 事件（verify-continue 带结论）', async () => {
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
  const events = eventsOf(env, 'task-reliability/verify')
  const cont = events.find((e) => e.action === 'verify-continue')
  assert.ok(cont !== undefined, 'verify-continue emitted')
  assert.equal(cont.reason, '测试还没写')
})

test('校验 agent 创建失败降级发出 verify 事件（verify-degrade）', async () => {
  const env = boot()
  env.ctx.get = (name) => {
    if (name === 'agents') {
      return {
        get() {
          return undefined
        },
        async create() {
          throw new Error('boom')
        },
      }
    }
    return undefined
  }
  await registerTask(env, { mode: 'verify' })
  await dispatchOne(env.listeners, 'agent/status', { agent: env.mainAgent, status: 'idle' })
  await tick(50)
  const events = eventsOf(env, 'task-reliability/verify')
  const degrade = events.find((e) => e.action === 'verify-degrade')
  assert.ok(degrade !== undefined, 'verify-degrade emitted')
  assert.equal(degrade.reason, 'verifier-unavailable')
})

// ── 恢复事件 ───────────────────────────────────────────────────────────────
test('重启恢复任务发出 resume 事件（resume-task）', async () => {
  const env = boot({ resumeGraceMs: 60000 })
  await registerTask(env)
  await tick()
  env.disposeAll()
  const env2 = boot({ resumeGraceMs: 0 }, {}, env.dir)
  await tick(30)
  const events = eventsOf(env2, 'task-reliability/resume')
  assert.equal(events.length, 1)
  assert.equal(events[0].action, 'resume-task')
  assert.equal(events[0].reason, 'restart')
  assert.equal(events[0].sessionId, 'session-main')
})

// ── emit 失败静默（best-effort）───────────────────────────────────────────
test('ctx.emit 抛错不影响主流程（steer 照常注入）', async () => {
  const env = boot({}, {}, undefined, true) // emitBroken
  await registerTask(env)
  await dispatchOne(env.listeners, 'agent/turn-stopping', {
    agent: env.mainAgent,
    signal: { aborted: false },
  })
  assert.equal(env.mainAgent.steered.length, 1, 'steer 注入不受 emit 失败影响')
  assert.equal(env.emitted.length, 0, 'emit 抛错不记录')
})

test('ctx.emit 抛错不影响 ask 超时自动决策', async () => {
  const env = boot({ askTimeoutMs: 20 }, {}, undefined, true)
  const result = await dispatchOne(
    env.listeners,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？', options: [{ label: '甲' }] }] },
    },
    () => new Promise(() => {}),
  )
  assert.ok(result.value.answers.length === 1, '模拟回答照常返回')
  assert.equal(env.mainAgent.followed.length, 1, '继续指令照常注入')
})

// ── 待确认问题列表清理（issue #154 文件体积有界）──────────────────────────
test('已答问题超上限时按最旧优先淘汰（未答保留）', () => {
  const store = { questions: [] }
  const now = Date.now()
  for (let i = 0; i < MAX_QUESTIONS + 20; i += 1) {
    store.questions.push({
      id: `q${i}`,
      sessionId: 's1',
      question: `问题 ${i}`,
      answer: i % 2 === 0 ? `回答 ${i}` : undefined,
      createdAt: now - (MAX_QUESTIONS + 20 - i) * 1000,
      answeredAt: i % 2 === 0 ? now - (MAX_QUESTIONS + 20 - i) * 1000 : undefined,
    })
  }
  const removed = pruneQuestions(store, now)
  assert.equal(removed, 20, '20 条被清理')
  assert.equal(store.questions.length, MAX_QUESTIONS, '总数回到上限')
  const unanswered = store.questions.filter((q) => q.answer === undefined)
  assert.equal(unanswered.length, 110, '全部未答问题保留（未答优先）')
  const answered = store.questions.filter((q) => q.answer !== undefined)
  assert.equal(answered.length, 90, '已答只保留最新 90 条')
  const answeredIds = answered.map((q) => q.id)
  assert.ok(answeredIds.includes('q218'), '最新已答保留')
  assert.ok(!answeredIds.includes('q0'), '最旧已答淘汰')
})

test('过期未答问题清理（TTL 之外删除，未过期保留）', () => {
  const store = { questions: [] }
  const now = Date.now()
  store.questions.push(
    { id: 'old', sessionId: 's1', question: '过期问题', answer: undefined, createdAt: now - QUESTION_TTL_MS - 1000 },
    { id: 'fresh', sessionId: 's1', question: '新问题', answer: undefined, createdAt: now - 1000 },
    {
      id: 'answered',
      sessionId: 's1',
      question: '已答',
      answer: 'ok',
      createdAt: now - QUESTION_TTL_MS - 5000,
      answeredAt: now - 1000,
    },
  )
  const removed = pruneQuestions(store, now)
  assert.equal(removed, 1, '仅过期未答被清理')
  assert.deepEqual(
    store.questions.map((q) => q.id),
    ['fresh', 'answered'],
    '未过期未答 + 已答（无论多旧）保留',
  )
})

test('addQuestion 后列表不超上限（集成路径）', () => {
  const store = { questions: [] }
  for (let i = 0; i < MAX_QUESTIONS + 5; i += 1) {
    addQuestion(store, 's1', `问题 ${i}`)
  }
  assert.ok(store.questions.length <= MAX_QUESTIONS, `questions capped at ${MAX_QUESTIONS}`)
  assert.equal(store.questions[store.questions.length - 1].question, `问题 ${MAX_QUESTIONS + 4}`, '最新问题保留')
})

test('加载时清理已答/过期问题并落盘', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-reliability-prune-'))
  tmpDirs.push(dir)
  const now = Date.now()
  const store = {
    version: 1,
    tasks: [],
    questions: [
      { id: 'old', sessionId: 's1', question: '过期', answer: undefined, createdAt: now - QUESTION_TTL_MS - 1000 },
      { id: 'ok', sessionId: 's1', question: '正常', answer: undefined, createdAt: now - 1000 },
    ],
    mode: { tracking: false, verify: false, autopilot: false, sessionAutopilot: {} },
  }
  writeFileSync(join(dir, 'task-reliability.json'), JSON.stringify(store), 'utf8')
  boot({}, {}, dir) // 启动插件触发加载时清理（副作用：注册 disposeAlls）
  await tick()
  const loaded = JSON.parse(readFileSync(join(dir, 'task-reliability.json'), 'utf8'))
  assert.deepEqual(
    loaded.questions.map((q) => q.id),
    ['ok'],
    '过期问题加载即清理并落盘',
  )
})

afterAll(() => {
  for (const dispose of disposeAlls.splice(0)) dispose()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
