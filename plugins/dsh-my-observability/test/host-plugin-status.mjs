/**
 * host-plugin-status.mjs — GET /observability/api/plugin-status 聚合端点防回归。
 *
 * 覆盖两处真实缺陷（修前恒空列表 / 修后仍会编造假状态）：
 *  1. 清单来源：旧实现读并不存在的宿主能力 `ctx.bundler` → 恒返回空列表。
 *     正确来源：`ctx.get('pluginInventory', false)`（机会性读取）→
 *     `await list()` → `entries[].moduleName`（**完整包名**，监听方按它比对）。
 *  2. 响应收集：旧实现用 `ctx.emit`（同步派发、**不收集**监听器返回值），
 *     `Promise.race([emit(...), timeout])` 立即得到 undefined → 走
 *     `?? { running: true, ... }` 分支，为每个插件编造"运行中"的假状态。
 *     正确做法：`ctx.serial('plugin:status-query', payload)`（顺序 await 并
 *     返回首个非 null/false/undefined 的返回值）；无匹配响应时如实标记
 *     `{ running: false, error: 'no-response' }`，绝不编造。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { handlePluginStatus, PLUGIN_STATUS_TIMEOUT_MS } from '../lib/routes.js'
import { mockResponse, jsonOf } from './lib/helpers.mjs'

/** 清单条目（entry.moduleName 是完整包名）。 */
const ENTRIES = [
  { moduleName: 'dsh-file-activity', enabled: true, fiberPhase: 'active' },
  { moduleName: 'dsh-my-guardian', enabled: true, fiberPhase: 'active' },
]

/** 监听方（dsh-file-activity）真实返回值。 */
const REAL_VALUE = {
  plugin: 'dsh-file-activity',
  config: { maxEvents: 5 },
  running: true,
  stats: { files: 42, sessions: 3 },
  lastActions: ['write /tmp/a'],
}

/**
 * mock ctx：inventory 提供 entries；collect 模拟「会 await 并返回监听器返回值」
 * 的分发（ctx.serial）。emit 故意抛错——回归到 emit 收集会被立刻发现。
 */
function mockCtx({ entries = ENTRIES, inventory = true, collect = async () => undefined } = {}) {
  const calls = []
  const ctx = {
    logger: { warn() {} },
    get(name) {
      if (name === 'pluginInventory') return inventory ? { list: async () => ({ entries }) } : undefined
      return undefined
    },
    serial(name, payload) {
      calls.push({ name, payload })
      return collect(payload)
    },
    emit() {
      throw new Error('plugin:status-query 不得用 emit 收集（emit 不收集监听器返回值）')
    },
  }
  return { ctx, calls }
}

test('清单可用：采用监听方真实 value（含 stats），按 entry.moduleName 查询', async () => {
  const { ctx, calls } = mockCtx({
    collect: async ({ plugin }) => (plugin === 'dsh-file-activity' ? { ok: true, value: REAL_VALUE } : undefined),
  })
  const response = mockResponse()
  await handlePluginStatus(ctx, response)
  const body = jsonOf(response)

  assert.equal(response.writeHeadStatus, 200)
  assert.equal(body.ok, true)
  const fileActivity = body.value.find((s) => s.plugin === 'dsh-file-activity')
  assert.deepEqual(fileActivity, REAL_VALUE, '监听方 value 必须原样透传（不得编造默认值）')
  assert.deepEqual(fileActivity.stats, { files: 42, sessions: 3 }, 'stats 必须保留')
  assert.deepEqual(
    calls.map((c) => c.name),
    ['plugin:status-query', 'plugin:status-query'],
  )
  assert.deepEqual(
    calls.map((c) => c.payload.plugin),
    ['dsh-file-activity', 'dsh-my-guardian'],
    '查询名必须是完整包名（entry.moduleName），不是类名',
  )
})

test('无匹配响应：如实标记 no-response，不得编造 running: true', async () => {
  const { ctx } = mockCtx({ collect: async () => undefined })
  const response = mockResponse()
  await handlePluginStatus(ctx, response)
  const body = jsonOf(response)

  assert.deepEqual(body.value, [
    { plugin: 'dsh-file-activity', running: false, error: 'no-response' },
    { plugin: 'dsh-my-guardian', running: false, error: 'no-response' },
  ])
  assert.equal(
    body.value.some((s) => s.running === true),
    false,
    '无响应不得标记为运行中',
  )
  assert.equal(
    body.value.some((s) => 'config' in s || 'lastActions' in s),
    false,
    '无响应不得编造 config/lastActions',
  )
})

test('ok:false 的返回值不算匹配：如实标记 no-response', async () => {
  const { ctx } = mockCtx({ collect: async () => ({ ok: false, error: 'nope' }) })
  const response = mockResponse()
  await handlePluginStatus(ctx, response)
  const body = jsonOf(response)
  assert.equal(
    body.value.every((s) => s.running === false && s.error === 'no-response'),
    true,
  )
})

test('pluginInventory 不可用（ctx.get → undefined）：返回空列表且不抛错', async () => {
  const { ctx, calls } = mockCtx({ inventory: false })
  const response = mockResponse()
  await handlePluginStatus(ctx, response)
  const body = jsonOf(response)

  assert.equal(response.writeHeadStatus, 200)
  assert.deepEqual(body, { ok: true, value: [] })
  assert.equal(calls.length, 0, '清单不可用时不应发起查询')
})

test('清单返回 Promise（list() 必须 await）：entries 正常读取', async () => {
  const { ctx } = mockCtx({
    collect: async ({ plugin }) =>
      plugin === 'dsh-my-guardian' ? { ok: true, value: { plugin, running: false } } : undefined,
  })
  const response = mockResponse()
  await handlePluginStatus(ctx, response)
  const body = jsonOf(response)
  assert.equal(body.value.length, 2)
  assert.deepEqual(
    body.value.find((s) => s.plugin === 'dsh-my-guardian'),
    { plugin: 'dsh-my-guardian', running: false },
  )
})

test('entry 缺 moduleName 时跳过该条，不产生 plugin: undefined', async () => {
  const { ctx } = mockCtx({ entries: [{ enabled: true }, { moduleName: 'dsh-my-guardian', enabled: true }] })
  const response = mockResponse()
  await handlePluginStatus(ctx, response)
  const body = jsonOf(response)
  assert.deepEqual(
    body.value.map((s) => s.plugin),
    ['dsh-my-guardian'],
  )
})

test('超时：默认 3s 语义保留（测试注入 50ms），标记 running:false / timeout', async () => {
  assert.equal(PLUGIN_STATUS_TIMEOUT_MS, 3000, '默认超时必须是 3s')
  const { ctx } = mockCtx({ collect: () => new Promise(() => {}) })
  const response = mockResponse()
  const started = Date.now()
  await handlePluginStatus(ctx, response, 50)
  const body = jsonOf(response)

  assert.equal(Date.now() - started < 1000, true, '不得等满默认 3s')
  assert.deepEqual(body.value, [
    { plugin: 'dsh-file-activity', running: false, error: 'timeout' },
    { plugin: 'dsh-my-guardian', running: false, error: 'timeout' },
  ])
})

test('分发抛错（监听方异常）：不编造状态，标记 timeout 之外的失败', async () => {
  const { ctx } = mockCtx({
    collect: async () => {
      throw new Error('listener boom')
    },
  })
  const response = mockResponse()
  await handlePluginStatus(ctx, response)
  const body = jsonOf(response)
  assert.equal(body.ok, true)
  assert.equal(
    body.value.every((s) => s.running === false),
    true,
  )
})
