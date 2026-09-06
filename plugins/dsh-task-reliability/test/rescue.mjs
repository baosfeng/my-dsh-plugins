/**
 * Rescue tests for the dsh-task-reliability host half (issue #147).
 *
 * 覆盖「输出未完成自动救场」的判定矩阵：
 *  - 纯函数：isOutputTruncated（围栏/公式/表格/半句启发式）、todoHasPending；
 *  - 集成：turn-stopping 无任务截断救场（steer 注入）、上限/冷却/开关边界、
 *    aborted 不救场、有任务不回归（continueTask 优先）、error 事后救场
 *    （agent/error → idle → followup）、todo pending 信号、循环打断优先。
 *
 * 判定矩阵（issue #147）：
 *  | 结束原因        | 输出完整度/任务状态                    | 决策                     |
 *  | completed       | —                                      | 不救场                   |
 *  | aborted         | —                                      | 不自动救场（尊重意图）   |
 *  | max-tokens/error| 文本完整                                | 不救场                   |
 *  | max-tokens/error| 未闭合围栏/表格/公式或半句              | 救场（上限+冷却约束）    |
 *  | max-tokens/error| 有活动任务/goal/todo pending             | 走既有 continueTask 逻辑 |
 *  | max-tokens/error| 无任务无 todo 文本信号弱                 | 不自动救场               |
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { isOutputTruncated, todoHasPending } from '../lib/rescue.js'

// ── mock helpers（与 host-smoke.mjs 同构）─────────────────────────────────

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
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-reliability-rescue-'))
  tmpDirs.push(dir)
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const listeners = {}
  const disposers = []
  const mainAgent = services.mainAgent ?? makeAgent('session-main')
  const agents = {
    get() {
      return undefined
    },
    async create() {
      return { agent: makeAgent('verify-mock', { origin: 'subagent' }), async dispose() {} }
    },
    async resume() {
      return { agent: mainAgent, async dispose() {} }
    },
  }
  const ctx = {
    logger: { warn() {} },
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
      register() {
        return () => {}
      },
    },
    get(name) {
      if (name === 'agents') return agents
      if (name === 'sessionQuery')
        return {
          async readSession() {
            return { header: {}, events: [] }
          },
        }
      if (name === 'goals')
        return {
          get() {
            return undefined
          },
        }
      if (name === 'approval') return { setPolicy() {} }
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
  const disposeAll = () => {
    for (const dispose of disposers.splice(0)) dispose()
    process.env.DSH_HOME = oldHome
  }
  disposeAlls.push(disposeAll)
  return { ctx, listeners, mainAgent, disposeAll, store: shared.store }
}

function dispatchOne(listeners, name, ...args) {
  const handlers = listeners[name] ?? []
  assert.ok(handlers.length > 0, `listener ${name} registered`)
  return handlers[handlers.length - 1](...args)
}

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

function assistantEvent(text) {
  return {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text }] } },
  }
}

function todoEvent(todos) {
  return { type: 'todo/write', data: { todos } }
}

const RESCUE_MARK = '回合输出未完成'
const CONTINUE_MARK = '任务自动继续'
const BREAK_MARK = '思考重复'

// ── 纯函数：isOutputTruncated ─────────────────────────────────────────────

test('isOutputTruncated：未闭合代码围栏判未完成', () => {
  assert.equal(isOutputTruncated('```js\nconst x = 1'), true)
  assert.equal(isOutputTruncated('```mermaid\ngraph TD'), true)
})

test('isOutputTruncated：闭合围栏判完整', () => {
  assert.equal(isOutputTruncated('```js\nconst x = 1\n```\n以上是代码。'), false)
})

test('isOutputTruncated：未闭合公式块判未完成', () => {
  assert.equal(isOutputTruncated('公式：$$E = mc^2'), true)
})

test('isOutputTruncated：闭合公式块判完整', () => {
  assert.equal(isOutputTruncated('公式：$$E = mc^2$$，完毕。'), false)
})

test('isOutputTruncated：表头分隔行结尾判未完成（表格未填数据）', () => {
  assert.equal(isOutputTruncated('| 名称 | 值 |\n|---|---|'), true)
})

test('isOutputTruncated：完整表格行结尾判完整', () => {
  assert.equal(isOutputTruncated('| 名称 | 值 |\n|---|---|\n| a | 1 |'), false)
})

test('isOutputTruncated：表格行被截断（含 | 不以 | 结尾）判未完成', () => {
  assert.equal(isOutputTruncated('| 名称 | 值 |\n| 第一项 | 第二项'), true)
})

test('isOutputTruncated：长句无结尾标点判半句未完成', () => {
  assert.equal(isOutputTruncated('接下来我们需要仔细分析这个方案的每一个细节并给出最终结论和建议'), true)
})

test('isOutputTruncated：完整句结尾判完整', () => {
  assert.equal(isOutputTruncated('接下来我们需要仔细分析这个方案的每一个细节并给出最终结论。'), false)
})

test('isOutputTruncated：列表项结尾不判半句', () => {
  assert.equal(isOutputTruncated('主要步骤：\n- 第一步先做调研\n- 第二步写代码'), false)
})

test('isOutputTruncated：空文本与短句不判未完成', () => {
  assert.equal(isOutputTruncated(''), false)
  assert.equal(isOutputTruncated('好的'), false)
  assert.equal(isOutputTruncated('   '), false)
})

// ── 纯函数：todoHasPending ────────────────────────────────────────────────

test('todoHasPending：存在 pending 或 in_progress 项判有未完成任务', () => {
  assert.equal(todoHasPending([todoEvent([{ content: '写测试', status: 'pending' }])]), true)
  assert.equal(todoHasPending([todoEvent([{ content: '写测试', status: 'in_progress' }])]), true)
})

test('todoHasPending：全部 completed 或没有 todo/write 判无未完成任务', () => {
  assert.equal(todoHasPending([todoEvent([{ content: '写测试', status: 'completed' }])]), false)
  assert.equal(todoHasPending([assistantEvent('正常输出。')]), false)
  assert.equal(todoHasPending([]), false)
  assert.equal(todoHasPending(undefined), false)
})

// ── 集成：turn-stopping 救场（判定矩阵）───────────────────────────────────

test('无任务 + max-tokens 截断 + 输出不完整 → 注入补完指令（主验收）', async () => {
  const env = boot()
  const agent = makeAgent('session-main', {
    events: [assistantEvent('```js\nconst x = 1')],
  })
  await runStream(env, 'session-main', 'max-tokens')
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent, signal: { aborted: false } })
  assert.equal(agent.steered.length, 1)
  assert.ok(agent.steered[0].content[0].text.includes(RESCUE_MARK), '注入补完指令')
})

test('无任务 + max-tokens 截断 + 输出完整 → 不救场', async () => {
  const env = boot()
  const agent = makeAgent('session-main', {
    events: [assistantEvent('分析完成，结论如下。')],
  })
  await runStream(env, 'session-main', 'max-tokens')
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent, signal: { aborted: false } })
  assert.equal(agent.steered.length, 0)
})

test('无任务 + 无截断信号 + 输出不完整 → 启发式兜底救场', async () => {
  const env = boot()
  const agent = makeAgent('session-main', {
    events: [assistantEvent('```js\nconst x = 1')],
  })
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent, signal: { aborted: false } })
  assert.equal(agent.steered.length, 1)
  assert.ok(agent.steered[0].content[0].text.includes(RESCUE_MARK))
})

test('无任务 + 无截断信号 + 输出完整 → 不救场（回归：普通问答不打扰）', async () => {
  const env = boot()
  const agent = makeAgent('session-main', {
    events: [assistantEvent('分析完成，结论如下。')],
  })
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent, signal: { aborted: false } })
  assert.equal(agent.steered.length, 0)
})

test('aborted（用户主动停止）+ 截断 + 输出不完整 → 不自动救场', async () => {
  const env = boot()
  const agent = makeAgent('session-main', {
    events: [assistantEvent('```js\nconst x = 1')],
  })
  await runStream(env, 'session-main', 'max-tokens')
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent, signal: { aborted: true } })
  assert.equal(agent.steered.length, 0)
})

test('有活动任务 + 截断 → continueTask 注入任务继续文本（回归）', async () => {
  const env = boot()
  const agent = makeAgent('session-main', {
    events: [assistantEvent('```js\nconst x = 1')],
  })
  await dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () => {
    return (async function* () {
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
    })()
  })
  // 注册活动任务
  const { registerTask } = await import('../lib/store.js')
  const result = registerTask(env.store, { sessionId: 'session-main', description: '开发一个功能' })
  assert.ok(result.ok)
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent, signal: { aborted: false } })
  assert.equal(agent.steered.length, 1)
  assert.ok(agent.steered[0].content[0].text.includes(CONTINUE_MARK), '注入任务继续文本')
  assert.ok(!agent.steered[0].content[0].text.includes(RESCUE_MARK), '非 rescue 文本')
})

test('rescue 每会话次数上限：rescueMaxPerSession=2 时第 3 次不注入', async () => {
  const env = boot({ rescueMaxPerSession: 2, rescueCooldownMs: 0 })
  const agent = makeAgent('session-main', {
    events: [assistantEvent('```js\nconst x = 1')],
  })
  await runStream(env, 'session-main', 'max-tokens')
  for (let i = 0; i < 3; i++) {
    await dispatchOne(env.listeners, 'agent/turn-stopping', { agent, signal: { aborted: false } })
  }
  assert.equal(agent.steered.length, 2, '前两次注入，第三次达上限不注入')
})

test('rescue 冷却：rescueCooldownMs 内不重复注入', async () => {
  const env = boot({ rescueCooldownMs: 60000 })
  const agent = makeAgent('session-main', {
    events: [assistantEvent('```js\nconst x = 1')],
  })
  await runStream(env, 'session-main', 'max-tokens')
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent, signal: { aborted: false } })
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent, signal: { aborted: false } })
  assert.equal(agent.steered.length, 1, '冷却期内不重复注入')
})

test('rescueOnTruncation=false 时完全不救场', async () => {
  const env = boot({ rescueOnTruncation: false })
  const agent = makeAgent('session-main', {
    events: [assistantEvent('```js\nconst x = 1')],
  })
  await runStream(env, 'session-main', 'max-tokens')
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent, signal: { aborted: false } })
  assert.equal(agent.steered.length, 0)
})

test('截断 + 文本完整 + todo 存在 pending → 救场（任务上下文信号）', async () => {
  const env = boot()
  const agent = makeAgent('session-main', {
    events: [assistantEvent('分析完成，结论如下。'), todoEvent([{ content: '写测试', status: 'pending' }])],
  })
  await runStream(env, 'session-main', 'max-tokens')
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent, signal: { aborted: false } })
  assert.equal(agent.steered.length, 1)
  assert.ok(agent.steered[0].content[0].text.includes(RESCUE_MARK))
})

test('循环打断优先于救场：pendingBreak 存在时只注入打断指令', async () => {
  const env = boot()
  const agent = makeAgent('session-main', {
    events: [assistantEvent('```js\nconst x = 1')],
  })
  const long = '反复推敲同一段思考内容及其潜在影响与后续步骤的详细规划与执行细节安排。'.repeat(8)
  const chunks = []
  for (let b = 0; b < 5; b++) {
    chunks.push({ type: 'block-start', index: b, blockType: 'reasoning' })
    for (const ch of long) chunks.push({ type: 'reasoning-delta', index: b, text: ch })
    chunks.push({ type: 'block-end', index: b, block: { type: 'reasoning', text: long } })
  }
  const wrapped = dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () => {
    return (async function* () {
      for (const chunk of chunks) yield chunk
    })()
  })
  await assert.rejects(
    (async () => {
      for await (const chunk of wrapped) {
        void chunk
      }
    })(),
    (error) => error?.code === 'REASONING_LOOP',
  )
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent, signal: { aborted: false } })
  assert.equal(agent.steered.length, 1)
  assert.ok(agent.steered[0].content[0].text.includes(BREAK_MARK), '注入打断指令')
  assert.ok(!agent.steered[0].content[0].text.includes(RESCUE_MARK), '不注入 rescue 指令')
})

test('子代理 + 截断 + 输出不完整 → 不救场（回归）', async () => {
  const env = boot()
  const sub = makeAgent('sub-1', { origin: 'subagent', events: [assistantEvent('```js\nconst x = 1')] })
  await runStream(env, 'sub-1', 'max-tokens')
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent: sub, signal: { aborted: false } })
  assert.equal(sub.steered.length, 0)
})

// ── 集成：error 事后救场（agent/error → idle → followup）──────────────────

test('回合 error 结束 + 输出不完整 → idle 后 followup 补完', async () => {
  const env = boot()
  const agent = makeAgent('session-main', {
    events: [assistantEvent('```js\nconst x = 1')],
  })
  await dispatchOne(env.listeners, 'agent/error', {
    agent,
    turn: 1,
    step: 1,
    error: new Error('boom'),
  })
  await dispatchOne(env.listeners, 'agent/status', { agent, status: 'idle' })
  assert.equal(agent.followed.length, 1)
  assert.ok(agent.followed[0].content[0].text.includes(RESCUE_MARK), 'followup 注入补完指令')
})

test('回合 error 结束 + 输出完整 → idle 后不救场', async () => {
  const env = boot()
  const agent = makeAgent('session-main', {
    events: [assistantEvent('分析完成，结论如下。')],
  })
  await dispatchOne(env.listeners, 'agent/error', {
    agent,
    turn: 1,
    step: 1,
    error: new Error('boom'),
  })
  await dispatchOne(env.listeners, 'agent/status', { agent, status: 'idle' })
  assert.equal(agent.followed.length, 0)
})

test('error 标记一次性消费：无新 error 的 idle 不重复救场', async () => {
  const env = boot()
  const agent = makeAgent('session-main', {
    events: [assistantEvent('```js\nconst x = 1')],
  })
  await dispatchOne(env.listeners, 'agent/error', {
    agent,
    turn: 1,
    step: 1,
    error: new Error('boom'),
  })
  await dispatchOne(env.listeners, 'agent/status', { agent, status: 'idle' })
  await dispatchOne(env.listeners, 'agent/status', { agent, status: 'idle' })
  assert.equal(agent.followed.length, 1, '第二次 idle 无新 error 标记不救场')
})

test('error 救场同样受上限约束', async () => {
  const env = boot({ rescueMaxPerSession: 1 })
  const agent = makeAgent('session-main', {
    events: [assistantEvent('```js\nconst x = 1')],
  })
  for (let i = 0; i < 2; i++) {
    await dispatchOne(env.listeners, 'agent/error', {
      agent,
      turn: i + 1,
      step: 1,
      error: new Error('boom'),
    })
    await dispatchOne(env.listeners, 'agent/status', { agent, status: 'idle' })
  }
  assert.equal(agent.followed.length, 1, '达上限后不再救场')
})

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const dispose of disposeAlls.splice(0)) dispose()
})
