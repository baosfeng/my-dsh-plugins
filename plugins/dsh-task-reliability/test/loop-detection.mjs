/**
 * Loop-detection tests (issue #77): 多维度死循环检测。
 *
 *  1. 思考内容重复（现有 n-gram 检测，阈值/连续次数/每会话上限可配置）；
 *  2. 工具调用序列循环（A→A→A / A→B→A→B）；
 *  3. 无进展循环（连续 N 轮无有效产出）；
 *
 * 每个维度都断言「检测命中 → 立即中断 → turn-stopping 自动继续」的行为，
 * 并检测参数可配置（阈值/轮数）。host 相关 helper 在 host-smoke.mjs 中已
 * 覆盖，本文件聚焦多维检测本身，使用独立的最小 boot。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { registerTask } from '../lib/store.js'
import { detectReasoningLoop, detectToolCallLoop, similarityOf } from '../lib/repeat.js'

// ── 最小 boot helper ───────────────────────────────────────────────────────
function makeAgent(id) {
  return {
    id,
    options: { provider: 'deepseek', model: 'deepseek-chat' },
    session: { header: { cwd: '/work' }, events: [] },
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

function boot(config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-loop-'))
  tmpDirs.push(dir)
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const listeners = {}
  const disposers = []
  const mainAgent = makeAgent('session-main')
  const ctx = {
    logger: { info() {}, warn() {} },
    on(name, handler) {
      ;(listeners[name] ??= []).push(handler)
      return () => {}
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    webServer: {
      register() {
        return () => {}
      },
    },
    get(name) {
      if (name === 'agents') {
        return {
          get() {
            return undefined
          },
          async create() {
            return { agent: makeAgent('verify'), async dispose() {} }
          },
          async resume() {
            return { agent: mainAgent, async dispose() {} }
          },
        }
      }
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
  return { ctx, listeners, mainAgent, shared, disposeAll }
}

afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
})

// ── stream / tool helpers ──────────────────────────────────────────────────
function blockChunks(index, blockType, text) {
  const deltaType = blockType === 'reasoning' ? 'reasoning-delta' : 'text-delta'
  const chunks = [{ type: 'block-start', index, blockType }]
  for (const ch of text) chunks.push({ type: deltaType, index, text: ch })
  chunks.push({ type: 'block-end', index, block: { type: blockType, text } })
  return chunks
}

function streamOf(blocks) {
  const chunks = []
  blocks.forEach((block, i) => {
    chunks.push(...blockChunks(i, block.blockType, block.text))
  })
  chunks.push({ type: 'finish', reason: { kind: 'stop' } })
  return (async function* () {
    for (const chunk of chunks) yield chunk
  })()
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

function dispatchOne(listeners, name, ...args) {
  const handlers = listeners[name] ?? []
  assert.ok(handlers.length > 0, `listener ${name} registered`)
  return handlers[handlers.length - 1](...args)
}

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))

// ── 1. 思考内容重复 ────────────────────────────────────────────────────────
const REPEATING = '思考任务执行的每一个细节并反复推敲其中的潜在问题与更优的解决路径方案。'.repeat(8)

test('内容重复：连续高相似 reasoning 流触发 REASONING_LOOP 中断', async () => {
  const env = boot()
  const wrapped = dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () =>
    streamOf(Array.from({ length: 5 }, () => ({ blockType: 'reasoning', text: REPEATING }))),
  )
  const { error } = await collect(wrapped)
  assert.ok(error instanceof Error)
  assert.equal(error.code, 'REASONING_LOOP')
})

test('内容重复：中断后 turn-stopping 注入打断指令继续', async () => {
  const env = boot()
  const wrapped = dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () =>
    streamOf(Array.from({ length: 5 }, () => ({ blockType: 'reasoning', text: REPEATING }))),
  )
  await collect(wrapped)
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent: env.mainAgent, signal: { aborted: false } })
  assert.equal(env.mainAgent.steered.length, 1)
  assert.ok(env.mainAgent.steered[0].content[0].text.includes('思考重复'))
})

test('内容重复：打断指令一次性消费，后续回合不再注入（issue #153）', async () => {
  const env = boot()
  const wrapped = dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () =>
    streamOf(Array.from({ length: 5 }, () => ({ blockType: 'reasoning', text: REPEATING }))),
  )
  await collect(wrapped)
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent: env.mainAgent, signal: { aborted: false } })
  assert.equal(env.mainAgent.steered.length, 1)
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent: env.mainAgent, signal: { aborted: false } })
  assert.equal(env.mainAgent.steered.length, 1, '跨回合不重复注入')
})

test('内容重复：正常差异化 reasoning 不误触发（阈值默认 0.8）', async () => {
  const env = boot()
  const wrapped = dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () =>
    streamOf([{ blockType: 'reasoning', text: '这是完全不同的正常思考内容。' }]),
  )
  const { error } = await collect(wrapped)
  assert.equal(error, undefined)
})

// ── 2. 工具调用序列循环 ────────────────────────────────────────────────────
function runTool(env, name, args, next = () => Promise.resolve({ ok: true })) {
  return dispatchOne(env.listeners, 'tools/execute', { name, agent: env.mainAgent, arguments: args }, next)
}

test('工具循环 A→A→A：相同工具+参数连续 3 次触发 TOOL_LOOP 中断', async () => {
  const env = boot()
  await runTool(env, 'bash', { command: 'ls' })
  await runTool(env, 'bash', { command: 'ls' })
  await assert.rejects(runTool(env, 'bash', { command: 'ls' }), (error) => error.code === 'TOOL_LOOP')
})

test('工具循环 A→B→A→B：周期重复触发 TOOL_LOOP 中断', async () => {
  const env = boot()
  const A = { name: 'bash', arguments: { command: 'ls' } }
  const B = { name: 'bash', arguments: { command: 'pwd' } }
  await runTool(env, A.name, A.arguments)
  await runTool(env, B.name, B.arguments)
  await runTool(env, A.name, A.arguments)
  await assert.rejects(runTool(env, B.name, B.arguments), (error) => error.code === 'TOOL_LOOP')
})

test('工具循环：不同参数的工具序列不误触发', async () => {
  const env = boot()
  await runTool(env, 'bash', { command: 'ls' })
  await runTool(env, 'bash', { command: 'pwd' })
  await runTool(env, 'bash', { command: 'whoami' })
  const result = await runTool(env, 'bash', { command: 'ls' })
  assert.deepEqual(result, { ok: true }, '不同参数组合不判循环')
})

test('工具循环：中断后 turn-stopping 注入工具循环打断指令', async () => {
  const env = boot()
  await runTool(env, 'bash', { command: 'ls' })
  await runTool(env, 'bash', { command: 'ls' })
  await assert.rejects(runTool(env, 'bash', { command: 'ls' }), (error) => error.code === 'TOOL_LOOP')
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent: env.mainAgent, signal: { aborted: false } })
  assert.equal(env.mainAgent.steered.length, 1)
  assert.ok(env.mainAgent.steered[0].content[0].text.includes('工具调用循环'))
})

test('工具循环：连续相同只读工具调用（轮询）不误判（issue #153）', async () => {
  const env = boot()
  for (let i = 0; i < 4; i++) {
    const result = await runTool(env, 'browser_snapshot', {})
    assert.deepEqual(result, { ok: true }, `第 ${i + 1} 次只读轮询不判循环`)
  }
})

test('工具循环：只读轮询穿插写操作，写操作死循环仍命中（issue #153）', async () => {
  const env = boot()
  await runTool(env, 'browser_snapshot', {})
  await runTool(env, 'bash', { command: 'ls' })
  await runTool(env, 'browser_snapshot', {})
  await runTool(env, 'bash', { command: 'ls' })
  await runTool(env, 'browser_snapshot', {})
  await assert.rejects(runTool(env, 'bash', { command: 'ls' }), (error) => error.code === 'TOOL_LOOP')
})

test('工具循环：打断指令一次性消费，后续回合不再注入（issue #153）', async () => {
  const env = boot()
  await runTool(env, 'bash', { command: 'ls' })
  await runTool(env, 'bash', { command: 'ls' })
  await assert.rejects(runTool(env, 'bash', { command: 'ls' }), (error) => error.code === 'TOOL_LOOP')
  // 回合 A：命中回合的 turn-stopping 注入一次打断指令。
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent: env.mainAgent, signal: { aborted: false } })
  assert.equal(env.mainAgent.steered.length, 1)
  assert.ok(env.mainAgent.steered[0].content[0].text.includes('工具调用循环'))
  // 回合 B：无任何工具调用，turn-stopping 不得再次注入循环提示。
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent: env.mainAgent, signal: { aborted: false } })
  assert.equal(env.mainAgent.steered.length, 1, '跨回合不重复注入')
})

test('工具循环：命中回合未消费的 pendingBreak 跨回合失效（issue #153）', async () => {
  const env = boot({ rateMaxActions: 1 })
  registerActiveTask(env)
  // 先消耗速率配额（turn-stopping #1 注入任务继续指令）。
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent: env.mainAgent, signal: { aborted: false } })
  // 回合 A：命中工具循环（pendingBreak 产生）。
  await runTool(env, 'bash', { command: 'ls' })
  await runTool(env, 'bash', { command: 'ls' })
  await assert.rejects(runTool(env, 'bash', { command: 'ls' }), (error) => error.code === 'TOOL_LOOP')
  // 回合 A 的 turn-stopping：速率限制拒绝 → pendingBreak 未被消费。
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent: env.mainAgent, signal: { aborted: false } })
  // 模拟时间流逝，速率配额恢复。
  env.shared.actionLog.length = 0
  // 回合 B：无任何工具调用，turn-stopping 不得注入回合 A 残留的循环提示。
  await dispatchOne(env.listeners, 'agent/turn-stopping', { agent: env.mainAgent, signal: { aborted: false } })
  assert.ok(
    !env.mainAgent.steered.some((m) => m.content[0].text.includes('工具调用循环')),
    '跨回合残留的 pendingBreak 失效，不注入',
  )
})

test('工具循环每会话次数上限（repeatMaxPerSession）后放弃干预', async () => {
  const env = boot({ repeatMaxPerSession: 2 })
  await runTool(env, 'bash', { command: 'ls' })
  await runTool(env, 'bash', { command: 'ls' })
  await assert.rejects(runTool(env, 'bash', { command: 'ls' }), (error) => error.code === 'TOOL_LOOP')
  await assert.rejects(runTool(env, 'bash', { command: 'ls' }), (error) => error.code === 'TOOL_LOOP')
  const result = await runTool(env, 'bash', { command: 'ls' })
  assert.deepEqual(result, { ok: true }, '达上限后放弃干预，不再抛错')
})

test('检测到循环时可经 notifyUrl 推送通知（best-effort）', async () => {
  const calls = []
  const oldFetch = global.fetch
  global.fetch = async (url, opts) => {
    calls.push({ url, body: opts.body })
    return { ok: true }
  }
  try {
    const env = boot({ notifyOnLoop: true, notifyUrl: 'http://127.0.0.1:3199/notify/api/trigger' })
    await runTool(env, 'bash', { command: 'ls' })
    await runTool(env, 'bash', { command: 'ls' })
    await assert.rejects(runTool(env, 'bash', { command: 'ls' }), (error) => error.code === 'TOOL_LOOP')
    await tick()
    assert.equal(calls.length, 1, '应推送一次通知')
    assert.ok(calls[0].body.includes('tool'), '通知包含循环类型')
  } finally {
    global.fetch = oldFetch
  }
})

// ── 3. 无进展循环 ──────────────────────────────────────────────────────────
function registerActiveTask(env) {
  const result = registerTask(env.shared.store, {
    sessionId: 'session-main',
    description: '开发一个功能',
    mode: 'direct',
    source: 'manual',
  })
  assert.equal(result.ok, true)
}

function emitReasoningTurn(env) {
  const wrapped = dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () =>
    streamOf([{ blockType: 'reasoning', text: '思考推进任务的每一个细节与潜在影响。' }]),
  )
  return collect(wrapped)
}

function tickTurn(env) {
  return dispatchOne(env.listeners, 'agent/turn-stopping', { agent: env.mainAgent, signal: { aborted: false } })
}

test('无进展：连续 N 轮仅有 reasoning 无结论 → 触发无进展循环', async () => {
  const env = boot()
  registerActiveTask(env)
  await emitReasoningTurn(env)
  await tickTurn(env) // 建立基线 lastProduct
  await emitReasoningTurn(env)
  await tickTurn(env) // stall=1
  await emitReasoningTurn(env)
  await tickTurn(env) // stall=2
  await emitReasoningTurn(env)
  await tickTurn(env) // stall=3 → 命中
  const last = env.mainAgent.steered.at(-1).content[0].text
  assert.ok(last.includes('无进展循环'), `应注入无进展打断，实际: ${last}`)
})

test('无进展：noProgressRounds 可配置（=2 时更早触发）', async () => {
  const env = boot({ noProgressRounds: 2 })
  registerActiveTask(env)
  await emitReasoningTurn(env)
  await tickTurn(env) // 基线
  await emitReasoningTurn(env)
  await tickTurn(env) // stall=1
  await emitReasoningTurn(env)
  await tickTurn(env) // stall=2 → 命中
  assert.ok(env.mainAgent.steered.at(-1).content[0].text.includes('无进展循环'))
})

test('无进展：有有效产出（文本结论）时不误触发', async () => {
  const env = boot()
  registerActiveTask(env)
  // 每轮都产出文本结论 → productCount 持续增长 → 不判无进展。
  const emitTextTurn = (text) =>
    collect(
      dispatchOne(env.listeners, 'llm/stream', { sessionId: 'session-main' }, () =>
        streamOf([{ blockType: 'text', text }]),
      ),
    )
  await emitTextTurn('任务已完成，结论如下。')
  await tickTurn(env)
  await emitTextTurn('进一步确认无误，可以结束。')
  await tickTurn(env)
  await emitTextTurn('没有更多处理项。')
  await tickTurn(env)
  await emitTextTurn('全部完成。')
  await tickTurn(env)
  assert.ok(!env.mainAgent.steered.some((m) => m.content[0].text.includes('无进展循环')), '有结论时不判无进展')
})

// ── 4. 检测参数可配置（阈值/连续次数）─────────────────────────────────────
test('内容重复阈值可配置：repeatSimThreshold 控制命中', () => {
  const m1 = 'AAAABBBBCCCCDDDDEEEE'.repeat(4)
  const m2 = 'AAAABBBBXXXXDDDDEEEE'.repeat(4)
  const segments = [m1, m2, m1, m2]
  const sim = similarityOf(m1, m2)
  assert.ok(sim > 0.2 && sim < 0.95, `期望中间相似度，实际 ${sim}`)
  assert.equal(detectReasoningLoop(segments, { repeatSimThreshold: 0.99, repeatConsecutive: 3 }), false)
  assert.equal(
    detectReasoningLoop(segments, { repeatSimThreshold: Math.max(0.05, sim - 0.05), repeatConsecutive: 3 }),
    true,
  )
})

test('工具序列检测纯函数：A→A→A 与 A→B→A→B 判循环，不同参数不判', () => {
  const A1 = { name: 'bash', arg: '{"cmd":"ls"}' }
  const A2 = { name: 'bash', arg: '{"cmd":"ls"}' }
  const B1 = { name: 'read', arg: '{"path":"/a"}' }
  const B2 = { name: 'read', arg: '{"path":"/a"}' }
  const C1 = { name: 'bash', arg: '{"cmd":"pwd"}' }
  const D1 = { name: 'bash', arg: '{"cmd":"whoami"}' }
  assert.equal(detectToolCallLoop([A1, A2, A2]), true, 'A→A→A 判循环')
  assert.equal(detectToolCallLoop([A1, B1, A2, B2]), true, 'A→B→A→B 判循环')
  assert.equal(detectToolCallLoop([A1, C1, A2, D1]), false, '参数不同不判循环')
})
