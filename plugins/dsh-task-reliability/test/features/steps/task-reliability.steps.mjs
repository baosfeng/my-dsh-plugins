/**
 * Step definitions for dsh-task-reliability Gherkin acceptance tests.
 * Boots the plugin against a mocked ctx per scenario, drives events + routes
 * through it, mirroring host-smoke.mjs / host-edge.mjs.
 *
 * World + helpers live in world.mjs (shared with
 * task-reliability-config.steps.mjs — cucumber allows only one
 * setWorldConstructor).
 */
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ── Given ─────────────────────────────────────────────────────────────────
Given('任务可靠性插件已启动', function () {
  this.boot()
})

Given('任务可靠性插件已启动且自主决策开启', function () {
  // autopilotGraceMs 用短缓冲（20ms）：缓冲超时路径在 cucumber step 超时内完成
  this.boot({ autopilot: true, autopilotGraceMs: 20 })
})

// issue #79：autopilotGraceMs=0 时保持旧行为（pre-execute 立即拦截）
Given('任务可靠性插件已启动且自主决策开启且缓冲禁用', function () {
  this.boot({ autopilot: true, autopilotGraceMs: 0 })
})

Given('任务可靠性插件已启动且自主决策关闭', function () {
  this.boot({ autopilot: false })
})

Given('任务可靠性插件已启动且配置了 apiToken', function () {
  this.boot({ apiToken: 'secret' })
})

Given('会话 {string} 存在活动任务', async function (sessionId) {
  await this.callApi('/task-reliability/api/tasks', 'POST', {
    sessionId,
    description: '开发一个功能',
  })
})

Given('会话 {string} 没有活动任务', function (_sessionId) {
  // 空注册表即无任务
})

Given('子代理 {string} 有活动任务', async function (sessionId) {
  await this.callApi('/task-reliability/api/tasks', 'POST', {
    sessionId,
    description: '子代理任务',
  })
})

Given('会话 {string} 注册了校验模式任务', async function (sessionId) {
  await this.callApi('/task-reliability/api/tasks', 'POST', {
    sessionId,
    description: '开发一个功能',
    mode: 'verify',
  })
})

Given('会话 {string} 注册了活动任务且循环上限为 {int}', async function (sessionId, maxLoop) {
  this.boot({ maxLoop, steerCooldownMs: 0 })
  await this.callApi('/task-reliability/api/tasks', 'POST', {
    sessionId,
    description: '开发一个功能',
  })
})

Given('会话 {string} 注册了活动任务', async function (sessionId) {
  await this.callApi('/task-reliability/api/tasks', 'POST', {
    sessionId,
    description: '开发一个功能',
  })
})

// ── When ──────────────────────────────────────────────────────────────────
When('我注册会话 {string} 的任务 {string}', async function (sessionId, description) {
  await this.callApi('/task-reliability/api/tasks', 'POST', { sessionId, description })
})

When('再次为会话 {string} 注册任务 {string}', async function (sessionId, description) {
  await this.callApi('/task-reliability/api/tasks', 'POST', { sessionId, description })
})

When('代理 {string} 的模型请求以 TIMEOUT 失败', async function (sessionId) {
  this.lastDecision = await this.dispatch(
    'agent/request-error',
    {
      agent: { id: sessionId },
      failure: { code: 'TIMEOUT', message: 'timeout' },
      signal: { aborted: false },
    },
    () => {
      this.nextCalled = true
      return Promise.resolve(undefined)
    },
  )
})

When('代理 {string} 的模型请求以 INVALID_ARGUMENT 失败', async function (sessionId) {
  this.lastDecision = await this.dispatch(
    'agent/request-error',
    {
      agent: { id: sessionId },
      failure: { code: 'INVALID_ARGUMENT', message: 'bad' },
      signal: { aborted: false },
    },
    () => {
      this.nextCalled = true
      return Promise.resolve(undefined)
    },
  )
})

When('代理 {string} 的回合即将结束', async function (_sessionId) {
  await this.dispatch('agent/turn-stopping', { agent: this.mainAgent, signal: { aborted: false } })
})

When('子代理 {string} 的回合即将结束', async function (sessionId) {
  await this.dispatch('agent/turn-stopping', {
    agent: this.makeAgent(sessionId, { origin: 'subagent' }),
    signal: { aborted: false },
  })
})

When('代理 {string} 回合结束触发 {int} 次', async function (sessionId, count) {
  for (let i = 0; i < count; i++) {
    await this.dispatch('agent/turn-stopping', {
      agent: this.mainAgent,
      signal: { aborted: false },
    })
  }
})

When('代理 {string} 变为空闲', async function (_sessionId) {
  // fire-and-forget：校验流程异步挂起在 verifyIdle，等待后续结论 step resolve
  void this.dispatch('agent/status', { agent: this.mainAgent, status: 'idle' })
  await new Promise((resolve) => setTimeout(resolve, 20))
})

When('校验代理结论为已完成', function () {
  this.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: {
        message: { content: [{ type: 'text', text: '{"done": true, "reason": "全部完成"}' }] },
      },
    },
  ]
  this.verifyIdle.resolve()
})

When('校验代理结论为未完成并附原因', function () {
  this.verifyAgent.session.events = [
    {
      type: 'assistant/message',
      data: {
        message: { content: [{ type: 'text', text: '{"done": false, "reason": "测试还没写"}' }] },
      },
    },
  ]
  this.verifyIdle.resolve()
})

When('代理 {string} 的模型流产生连续重复的思考段落', async function (sessionId) {
  const long = '反复推敲同一段思考内容及其潜在影响与后续步骤的详细规划与执行细节安排。'.repeat(8)
  const chunks = []
  for (let b = 0; b < 5; b++) {
    chunks.push({ type: 'block-start', index: b, blockType: 'reasoning' })
    for (const ch of long) chunks.push({ type: 'reasoning-delta', index: b, text: ch })
    chunks.push({ type: 'block-end', index: b, block: { type: 'reasoning', text: long } })
  }
  this.wrapped = this.dispatch('llm/stream', { sessionId }, () =>
    (async function* () {
      for (const c of chunks) yield c
    })(),
  )
})

When('代理 {string} 调用 ask_user_question 工具', async function (_sessionId) {
  this.lastDecision = await this.dispatch(
    'tools/pre-execute',
    {
      name: 'ask_user_question',
      agent: this.mainAgent,
      arguments: { questions: [{ header: '需要确认' }] },
    },
    () => {
      this.nextCalled = true
      return Promise.resolve({ kind: 'allow' })
    },
  )
})

// issue #79：autopilot 缓冲超时路径（tools/execute 延迟决策）
When('代理 {string} 调用 ask_user_question 且缓冲超时', async function (_sessionId) {
  this.lastDecision = await this.dispatch(
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: this.mainAgent,
      arguments: { questions: [{ header: '需要确认' }] },
    },
    () => new Promise(() => {}),
  ) // 永不 resolve：缓冲超时后自动决策，问题进待确认列表
})

When('插件重新启动', async function () {
  const dir = this.dir
  for (const dispose of this.disposers.splice(0)) dispose()
  this.boot({ resumeGraceMs: 0 }, dir)
  await new Promise((resolve) => setTimeout(resolve, 30))
})

When('我通过远程 hook 注册会话 {string} 的任务', async function (sessionId) {
  await this.callApi('/task-reliability/api/trigger', 'POST', {
    action: 'register',
    sessionId,
    description: '远程任务',
  })
})

When('我通过远程 hook 不携带 token 调用', async function () {
  await this.callApi('/task-reliability/api/trigger', 'POST', { action: 'status' })
})

// ── Then ──────────────────────────────────────────────────────────────────
Then('任务列表包含该任务且状态为进行中', async function () {
  await this.callApi('/task-reliability/api/tasks', 'GET')
  assert.equal(this.lastResponse.status, 200)
  assert.ok(this.lastResponse.body.value.some((t) => t.sessionId === 's-1' && t.status === 'active'))
})

Then('任务注册表已写入持久化文件', async function () {
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(existsSync(join(this.dir, 'task-reliability.json')))
})

Then('第二次注册返回失败', function () {
  assert.equal(this.lastResponse.status, 400)
})

Then('插件返回重试动作且不委托 next', function () {
  assert.equal(this.lastDecision.kind, 'retry')
  assert.equal(this.nextCalled, false)
})

Then('插件委托 next 处理', function () {
  assert.equal(this.nextCalled, true)
})

Then('插件向代理注入继续指令（steer）', function () {
  assert.equal(this.mainAgent.steered.length, 1)
  assert.ok(this.mainAgent.steered[0].content[0].text.includes('任务自动继续'))
})

Then('指令包含任务描述', function () {
  assert.ok(this.mainAgent.steered[0].content[0].text.includes('开发一个功能'))
})

Then('插件不注入任何指令', function () {
  assert.equal(this.mainAgent.steered.length, 0)
})

// ── issue #147：输出未完成自动救场 ───────────────────────────────────────
Given('代理 {string} 的最后输出不完整', function (_sessionId) {
  this.mainAgent.session.events = [
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '```js\nconst x = 1' }] } },
    },
  ]
})

Given('代理 {string} 的最后输出完整', function (_sessionId) {
  this.mainAgent.session.events = [
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '分析完成，结论如下。' }] } },
    },
  ]
})

When('代理 {string} 的模型流以 max-tokens 结束', async function (_sessionId) {
  const wrapped = this.dispatch('llm/stream', { sessionId: 's-1' }, () => {
    return (async function* () {
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
    })()
  })
  for await (const chunk of wrapped) {
    void chunk
  }
})

When('代理 {string} 的回合即将结束且信号已中止', async function (_sessionId) {
  await this.dispatch('agent/turn-stopping', { agent: this.mainAgent, signal: { aborted: true } })
})

Then('插件向代理注入补完指令（steer）', function () {
  assert.equal(this.mainAgent.steered.length, 1)
  assert.ok(this.mainAgent.steered[0].content[0].text.includes('回合输出未完成'))
})

Then('任务状态变为 failed', async function () {
  await new Promise((resolve) => setTimeout(resolve, 20))
  const store = JSON.parse(readFileSync(join(this.dir, 'task-reliability.json'), 'utf8'))
  assert.equal(store.tasks[0].status, 'failed')
})

Then('插件创建独立校验代理', async function () {
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(this.calls.create.length, 1)
  assert.ok(this.calls.create[0].sessionId.startsWith('verify-'))
})

Then('校验代理收到校验指令', function () {
  assert.ok(this.verifyAgent.followed.length >= 1)
  assert.ok(this.verifyAgent.followed[0].content[0].text.includes('任务完成度校验员'))
})

Then('任务状态变为 done', async function () {
  await new Promise((resolve) => setTimeout(resolve, 30))
  const store = JSON.parse(readFileSync(join(this.dir, 'task-reliability.json'), 'utf8'))
  assert.equal(store.tasks[0].status, 'done')
})

Then('主代理收到带原因的继续指令', async function () {
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(this.mainAgent.followed.length, 1)
  assert.ok(this.mainAgent.followed[0].content[0].text.includes('测试还没写'))
})

Then('流抛出思考循环错误', async function () {
  let error = null
  try {
    for await (const chunk of this.wrapped) {
      void chunk
    }
  } catch (e) {
    error = e
  }
  assert.ok(error instanceof Error)
  assert.equal(error.code, 'REASONING_LOOP')
})

Then('插件注入打断指令', function () {
  assert.equal(this.mainAgent.steered.length, 1)
  assert.ok(this.mainAgent.steered[0].content[0].text.includes('思考重复'))
})

Then('工具被拒绝且原因含自主决策说明', function () {
  assert.equal(this.lastDecision.kind, 'deny')
  assert.ok(this.lastDecision.reason.includes('自主决策模式'))
})

Then('问题被记录到待确认列表', async function () {
  await this.callApi('/task-reliability/api/questions', 'GET')
  assert.equal(this.lastResponse.body.value.length, 1)
})

Then('问题未被记录到待确认列表', async function () {
  await this.callApi('/task-reliability/api/questions', 'GET')
  assert.equal(this.lastResponse.body.value.length, 0)
})

Then('工具流程的 next\\(\\) 未被调用', function () {
  assert.equal(this.nextCalled, false)
})

Then('工具流程的 next\\(\\) 被调用', function () {
  assert.equal(this.nextCalled, true)
})

// issue #79：缓冲超时后注入自动决策指令（AUTOPILOT_DENY_REASON）
Then('代理收到自主决策指令', function () {
  assert.equal(this.mainAgent.followed.length, 1)
  assert.ok(this.mainAgent.followed[0].content[0].text.includes('用户当前不在线'))
})

Then('代理 {string} 收到系统重启恢复指令', function (_sessionId) {
  assert.equal(this.mainAgent.followed.length, 1)
  assert.ok(this.mainAgent.followed[0].content[0].text.includes('系统重启恢复'))
})

Then('任务记录 resumeAt', async function () {
  await new Promise((resolve) => setTimeout(resolve, 20))
  const store = JSON.parse(readFileSync(join(this.dir, 'task-reliability.json'), 'utf8'))
  assert.ok(store.tasks[0].resumeAt > 0)
})

Then('任务出现在任务列表', async function () {
  await this.callApi('/task-reliability/api/tasks', 'GET')
  assert.ok(this.lastResponse.body.value.some((t) => t.description === '远程任务'))
})

Then('返回 403', function () {
  assert.equal(this.lastResponse.status, 403)
})

// ── issue #34：ask 超时自动继续 + 任务停滞看门狗 ─────────────────────────
Given('任务可靠性插件已启动且 ask 超时为 {int} 毫秒', function (ms) {
  this.boot({ askTimeoutMs: ms })
})

Given('任务可靠性插件已启动且 ask 超时禁用', function () {
  this.boot({ askTimeoutMs: 0 })
})

Given('任务可靠性插件已启动且看门狗间隔为 {int} 毫秒', function (ms) {
  this.boot({ watchdogIntervalMs: ms, stallTimeoutMs: 1000 })
})

When('代理 {string} 调用 ask_user_question 且用户长时间未回答', async function (_sessionId) {
  this.lastDecision = await this.dispatch(
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: this.mainAgent,
      arguments: {
        questions: [{ id: 'q1', question: 'A 还是 B？', options: [{ label: '方案A' }, { label: '方案B' }] }],
      },
    },
    () => new Promise(() => {}),
  )
})

When('代理 {string} 调用 ask_user_question 且用户回答 {string}', async function (_sessionId, answer) {
  this.lastDecision = await this.dispatch(
    'tools/execute',
    {
      name: 'ask_user_question',
      agent: this.mainAgent,
      arguments: { questions: [{ id: 'q1', question: 'A 还是 B？' }] },
    },
    () => Promise.resolve({ value: { answers: [{ id: 'q1', selected: [answer] }] } }),
  )
})

When('任务停滞超过阈值', async function () {
  this.store.tasks[0].updatedAt = Date.now() - 60000 // 模拟停滞 60 秒
  await new Promise((resolve) => setTimeout(resolve, 60))
})

Then('插件返回模拟回答且推荐选项被选中', function () {
  assert.equal(this.lastDecision.value.answers[0].id, 'q1')
  assert.deepEqual(this.lastDecision.value.answers[0].selected, ['方案A'])
})

Then('代理收到用户长时间未响应继续指令', function () {
  assert.equal(this.mainAgent.followed.length, 1)
  assert.ok(this.mainAgent.followed[0].content[0].text.includes('用户长时间未响应'))
})

Then('插件返回用户的真实回答', function () {
  assert.deepEqual(this.lastDecision.value.answers[0].selected, ['B'])
})

Then('代理未收到继续指令', function () {
  assert.equal(this.mainAgent.followed.length, 0)
})

Then('代理 {string} 收到系统唤醒恢复指令', function (_sessionId) {
  assert.equal(this.mainAgent.followed.length, 1)
  assert.ok(this.mainAgent.followed[0].content[0].text.includes('系统唤醒'))
})
