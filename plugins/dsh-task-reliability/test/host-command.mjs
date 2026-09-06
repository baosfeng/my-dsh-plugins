/**
 * Tests for the /task slash command (issue #35): command registration
 * (name 'task', no collision with /goal), sub-command parsing/execution
 * (status/continue/answer/autopilot/register), and reuse of existing
 * store/API logic (no duplicated implementation). Also covers the
 * commands-service-absent fallback and persistence of command actions.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { parseTaskCommand } from '../lib/command.js'

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

function boot(config = {}, services = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-rel-cmd-'))
  tmpDirs.push(dir)
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const listeners = {}
  const routes = []
  const disposers = []
  const commandDefs = []
  const mainAgent = services.mainAgent ?? makeAgent('session-cmd')
  const agents = {
    get(id) {
      return services.liveAgentId === id ? mainAgent : undefined
    },
    async resume(_options) {
      return { agent: mainAgent, async dispose() {} }
    },
  }
  const commands = {
    register(def) {
      commandDefs.push(def)
      return () => {}
    },
  }
  const ctx = {
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
      if (name === 'agents') return services.noAgents ? undefined : agents
      if (name === 'commands') return services.noCommands ? undefined : commands
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
    agents,
    commandDefs,
    dir,
    disposeAll,
    store: shared.store,
  }
}

function taskCommand(env) {
  return env.commandDefs.find((def) => def.name === 'task')
}

async function runCommand(env, rawInput, agent = env.mainAgent) {
  const def = taskCommand(env)
  assert.ok(def, 'task command registered')
  return def.handler({
    commandId: 'cmd-1',
    agent,
    rawInput,
    attachments: [],
    signal: { aborted: false },
  })
}

async function callApi(env, url, method = 'GET', body) {
  const response = mockResponse()
  await env.api.handler(
    mockRequest({
      url,
      method,
      body: body === undefined ? '' : JSON.stringify(body),
    }),
    response,
  )
  return { response, body: JSON.parse(response.written.join('') || 'null') }
}

function dispatchOne(env, name, ...args) {
  const handlers = env.listeners[name] ?? []
  assert.ok(handlers.length > 0, `listener ${name} registered`)
  return handlers[handlers.length - 1](...args)
}

async function addQuestionViaAsk(env) {
  // issue #79：autopilot 拦截从 pre-execute 立即 deny 改为 execute 缓冲超时
  // 后自动决策——通过永不 resolve 的 next 触发缓冲超时产生待确认问题
  await dispatchOne(
    env,
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: env.mainAgent,
      arguments: { questions: [{ header: '需要确认' }] },
    },
    () => new Promise(() => {}),
  )
}

// ── 命令注册 ─────────────────────────────────────────────────────────────
test('/task 命令注册成功且与 /goal 不冲突', () => {
  const env = boot()
  const def = taskCommand(env)
  assert.ok(def, 'task command registered')
  assert.equal(def.name, 'task')
  assert.notEqual(def.name, 'goal')
  assert.ok(typeof def.description === 'string' && def.description !== '')
  assert.ok(def.input?.hint !== undefined)
  assert.equal(typeof def.handler, 'function')
})

test('commands 服务缺失时插件正常启动（判空降级）', () => {
  const env = boot({}, { noCommands: true })
  assert.equal(env.commandDefs.length, 0)
  assert.ok(env.store, 'plugin still boots without commands service')
})

// ── 命令解析 ─────────────────────────────────────────────────────────────
test('解析：无参数 → status', () => {
  assert.deepEqual(parseTaskCommand(''), { kind: 'status' })
  assert.deepEqual(parseTaskCommand('   '), { kind: 'status' })
  assert.deepEqual(parseTaskCommand(undefined), { kind: 'status' })
  assert.deepEqual(parseTaskCommand(null), { kind: 'status' })
})

test('解析：status/continue', () => {
  assert.deepEqual(parseTaskCommand('status'), { kind: 'status' })
  assert.deepEqual(parseTaskCommand('continue'), { kind: 'continue' })
})

test('解析：answer 带 id 和文本（含多词文本）', () => {
  assert.deepEqual(parseTaskCommand('answer q-1 好的'), { kind: 'answer', id: 'q-1', text: '好的' })
  assert.deepEqual(parseTaskCommand('answer q-1 多词 文本'), {
    kind: 'answer',
    id: 'q-1',
    text: '多词 文本',
  })
})

test('解析：answer 缺参数 → invalid-answer', () => {
  assert.deepEqual(parseTaskCommand('answer'), { kind: 'invalid-answer' })
  assert.deepEqual(parseTaskCommand('answer q-1'), { kind: 'invalid-answer' })
})

test('解析：autopilot on/off', () => {
  assert.deepEqual(parseTaskCommand('autopilot on'), { kind: 'autopilot', enabled: true })
  assert.deepEqual(parseTaskCommand('autopilot off'), { kind: 'autopilot', enabled: false })
})

test('解析：autopilot 无效参数 → invalid-autopilot', () => {
  assert.deepEqual(parseTaskCommand('autopilot'), { kind: 'invalid-autopilot' })
  assert.deepEqual(parseTaskCommand('autopilot maybe'), { kind: 'invalid-autopilot' })
})

test('解析：register 带描述', () => {
  assert.deepEqual(parseTaskCommand('register 开发一个功能'), {
    kind: 'register',
    description: '开发一个功能',
  })
})

test('解析：register 空描述 → invalid-register', () => {
  assert.deepEqual(parseTaskCommand('register'), { kind: 'invalid-register' })
})

test('解析：未知子命令 → invalid', () => {
  assert.deepEqual(parseTaskCommand('foo'), { kind: 'invalid' })
  assert.deepEqual(parseTaskCommand('foo bar'), { kind: 'invalid' })
})

// ── status 子命令 ─────────────────────────────────────────────────────────
test('status：无任务无问题时显示模式状态', async () => {
  const env = boot()
  const result = await runCommand(env, '')
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('任务可靠性状态'))
  assert.ok(result.text.includes('自主决策 关'))
  assert.ok(result.text.includes('活动任务: 0 个'))
  assert.ok(result.text.includes('待确认问题: 0 个'))
})

test('status：显示活动任务与待确认问题', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-cmd',
    description: '开发一个功能',
  })
  await addQuestionViaAsk(env)
  const result = await runCommand(env, 'status')
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('活动任务: 1 个'))
  assert.ok(result.text.includes('开发一个功能'))
  assert.ok(result.text.includes('待确认问题: 1 个'))
  assert.ok(result.text.includes('需要确认'))
})

test('status：显示 tracking/verify 开启与 checking 任务，已回答问题不列出', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  await callApi(env, '/task-reliability/api/mode', 'POST', {
    tracking: true,
    verify: true,
    autopilot: true,
  })
  await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-cmd',
    description: '开发一个功能',
  })
  env.store.tasks[0].status = 'checking'
  await addQuestionViaAsk(env)
  const qid = env.store.questions[0].id
  await runCommand(env, `answer ${qid} 好的`)
  const result = await runCommand(env, 'status')
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('自动跟踪 开'))
  assert.ok(result.text.includes('完成度校验 开'))
  assert.ok(result.text.includes('自主决策 开'))
  assert.ok(result.text.includes('活动任务: 1 个'))
  assert.ok(result.text.includes('checking'))
  assert.ok(result.text.includes('待确认问题: 0 个'))
  assert.ok(!result.text.includes('需要确认'), 'answered question not listed')
})

// ── continue 子命令 ───────────────────────────────────────────────────────
test('continue：唤醒当前会话活动任务', async () => {
  const env = boot()
  await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-cmd',
    description: '开发一个功能',
  })
  const result = await runCommand(env, 'continue')
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('已唤醒任务继续执行'))
  assert.equal(env.mainAgent.followed.length, 1)
  assert.ok(env.mainAgent.followed[0].content[0].text.includes('系统唤醒'))
  assert.ok(env.store.tasks[0].updatedAt > 0, 'updatedAt refreshed to avoid repeated wake')
})

test('continue：无活动任务返回错误', async () => {
  const env = boot()
  const result = await runCommand(env, 'continue')
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('没有活动任务'))
})

test('continue：唤醒失败返回错误', async () => {
  const env = boot({}, { noAgents: true })
  await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-cmd',
    description: '开发一个功能',
  })
  const result = await runCommand(env, 'continue')
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('唤醒任务失败'))
})

test('continue：resume 返回无 agent 时唤醒失败', async () => {
  const env = boot()
  await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-cmd',
    description: '开发一个功能',
  })
  env.agents.resume = async () => ({ agent: undefined, async dispose() {} })
  const result = await runCommand(env, 'continue')
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('唤醒任务失败'))
})

test('continue：followup 失败时返回错误', async () => {
  const env = boot()
  await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-cmd',
    description: '开发一个功能',
  })
  env.mainAgent.followup = () => {
    throw new Error('followup failed')
  }
  const result = await runCommand(env, 'continue')
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('唤醒任务失败'))
})

test('continue：唤醒成功后状态落盘', async () => {
  const env = boot()
  await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-cmd',
    description: '开发一个功能',
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const before = JSON.parse(readFileSync(join(env.dir, 'task-reliability.json'), 'utf8')).tasks[0].updatedAt
  await runCommand(env, 'continue')
  await new Promise((resolve) => setTimeout(resolve, 20))
  const after = JSON.parse(readFileSync(join(env.dir, 'task-reliability.json'), 'utf8')).tasks[0].updatedAt
  assert.ok(after > before, 'continue 后 updatedAt 落盘更新')
})

// ── answer 子命令 ─────────────────────────────────────────────────────────
test('answer：回答待确认问题', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  await addQuestionViaAsk(env)
  const qid = env.store.questions[0].id
  const result = await runCommand(env, `answer ${qid} 好的`)
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('已记录对问题'))
  assert.equal(env.store.questions[0].answer, '好的')
  assert.ok(env.store.questions[0].answeredAt > 0)
})

test('answer：问题不存在返回错误', async () => {
  const env = boot()
  const result = await runCommand(env, 'answer q-missing 好的')
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('回答失败'))
})

test('answer：缺参数返回错误', async () => {
  const env = boot()
  const result = await runCommand(env, 'answer q-1')
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('回答需要'))
})

// ── autopilot 子命令 ─────────────────────────────────────────────────────
test('autopilot on：开启自主决策模式', async () => {
  const env = boot()
  const result = await runCommand(env, 'autopilot on')
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('自主决策模式已开启'))
  assert.equal(env.store.mode.autopilot, true)
})

test('autopilot off：关闭自主决策模式', async () => {
  const env = boot({ autopilot: true })
  const result = await runCommand(env, 'autopilot off')
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('自主决策模式已关闭'))
  assert.equal(env.store.mode.autopilot, false)
})

test('autopilot 无效参数返回错误', async () => {
  const env = boot()
  const result = await runCommand(env, 'autopilot maybe')
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('autopilot 需要 on 或 off'))
})

// ── register 子命令 ──────────────────────────────────────────────────────
test('register：注册任务到当前会话', async () => {
  const env = boot()
  const result = await runCommand(env, 'register 开发一个功能')
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('任务已注册'))
  assert.equal(env.store.tasks.length, 1)
  assert.equal(env.store.tasks[0].sessionId, 'session-cmd')
  assert.equal(env.store.tasks[0].description, '开发一个功能')
  assert.equal(env.store.tasks[0].status, 'active')
  assert.equal(env.store.tasks[0].source, 'manual')
})

test('register：校验模式开启时任务用 verify 模式', async () => {
  const env = boot()
  await callApi(env, '/task-reliability/api/mode', 'POST', { verify: true })
  const result = await runCommand(env, 'register 开发一个功能')
  assert.equal(result.kind, 'success')
  assert.equal(env.store.tasks[0].mode, 'verify')
})

test('register：空描述返回错误', async () => {
  const env = boot()
  const result = await runCommand(env, 'register')
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('register 需要任务描述'))
})

test('register：同一会话已有活动任务时注册被拒', async () => {
  const env = boot()
  await runCommand(env, 'register 第一个任务')
  const result = await runCommand(env, 'register 第二个任务')
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('注册失败'))
})

// ── 未知命令 ─────────────────────────────────────────────────────────────
test('未知子命令返回错误', async () => {
  const env = boot()
  const result = await runCommand(env, 'foo bar')
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('未知命令'))
})

// ── 与 HTTP API 逻辑复用断言（无重复实现） ────────────────────────────────
test('复用：command.js 直接复用现有 store/API 函数（无重复实现）', () => {
  const source = readFileSync(new URL('../lib/command.js', import.meta.url), 'utf8')
  assert.ok(source.includes("import { activeTaskOf, answerQuestion, registerTask } from './store.js'"))
  assert.ok(source.includes("import { wakeStalledTask } from './verify.js'"))
  assert.ok(source.includes("import { applyMode } from './api.js'"))
})

test('复用：autopilot 子命令与 HTTP API mode 动作效果一致（同一 applyMode）', async () => {
  const env = boot()
  await runCommand(env, 'autopilot on')
  assert.equal(env.store.mode.autopilot, true)
  await callApi(env, '/task-reliability/api/mode', 'POST', { autopilot: false })
  assert.equal(env.store.mode.autopilot, false)
})

test('复用：register 子命令与 HTTP API 注册效果一致（同一 registerTask）', async () => {
  const env = boot()
  await runCommand(env, 'register 命令任务')
  await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-api',
    description: 'API任务',
  })
  assert.equal(env.store.tasks.length, 2)
  for (const task of env.store.tasks) {
    assert.equal(task.status, 'active')
    assert.equal(task.source, 'manual')
  }
})

test('复用：answer 子命令与 HTTP API 回答效果一致（同一 answerQuestion）', async () => {
  const env = boot({ autopilot: true, autopilotGraceMs: 20 })
  await addQuestionViaAsk(env)
  const qid = env.store.questions[0].id
  await runCommand(env, `answer ${qid} 命令回答`)
  assert.equal(env.store.questions[0].answer, '命令回答')
  env.store.questions[0].answer = undefined
  env.store.questions[0].answeredAt = undefined
  await callApi(env, `/task-reliability/api/questions/${qid}/answer`, 'POST', { answer: 'API回答' })
  assert.equal(env.store.questions[0].answer, 'API回答')
})

test('复用：continue 与看门狗唤醒走同一恢复逻辑（同一 wakeStalledTask）', async () => {
  const env = boot()
  await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-cmd',
    description: '开发一个功能',
  })
  await runCommand(env, 'continue')
  assert.equal(env.mainAgent.followed.length, 1)
  const { runWatchdog } = await import('../lib/verify.js')
  env.store.tasks[0].updatedAt = Date.now() - 60000
  await runWatchdog(env.ctx, env.store, () => {}, { stallTimeoutMs: 1000 })
  assert.equal(env.mainAgent.followed.length, 2)
  assert.ok(env.mainAgent.followed[1].content[0].text.includes('系统唤醒'))
})

// ── 持久化 ───────────────────────────────────────────────────────────────
test('命令操作后状态持久化到注册表', async () => {
  const env = boot()
  await runCommand(env, 'register 开发一个功能')
  await new Promise((resolve) => setTimeout(resolve, 20))
  const saved = JSON.parse(readFileSync(join(env.dir, 'task-reliability.json'), 'utf8'))
  assert.equal(saved.tasks.length, 1)
  assert.equal(saved.tasks[0].description, '开发一个功能')
})

afterAll(() => {
  for (const dispose of disposeAlls.splice(0)) dispose()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
