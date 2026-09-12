/**
 * Store persistence tests for dsh-my-observability:
 *  - 写放大防护（门禁 9 复现测试 RED 基线）：高频事件下磁盘写入必须与
 *    事件本体字节同阶（append-only），而非每次持久化全量重写文件；
 *  - compact（周期紧凑）后文件被完整快照且随后追加回到增量模型；
 *  - 旧格式 audit.json 迁移到 audit.jsonl；
 *  - jsonl 非法行跳过。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
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
import { createStore } from '../lib/store.js'
import { waitFileLines, waitUntil } from './lib/wait.mjs'

const disposeAlls = []
afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 40))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询 API 直到事件数达到期望（替代「固定等 store 异步加载完成」）：
 *  超时后返回最后一次结果，由原断言照常判红——等待语义只加强不削弱。 */
async function waitEvents(api, query, expected, opts) {
  let value = []
  await waitUntil(async () => {
    value = await eventsOf(api, query)
    return value.length === expected
  }, opts)
  return value
}

function jsonlFile(home) {
  return join(home, 'observability', 'audit.jsonl')
}

function legacyFile(home) {
  return join(home, 'observability', 'audit.json')
}

/** observability 目录下所有落盘文件 size 之和（含 tmp 中间产物）。 */
function dirBytes(home) {
  const dir = join(home, 'observability')
  if (!existsSync(dir)) return 0
  let total = 0
  for (const name of readdirSync(dir)) {
    try {
      total += statSync(join(dir, name)).size
    } catch {
      // 采样期间文件被 rename，忽略
    }
  }
  return total
}

/** 期望事件行字节数：从 API 取回的事件按存储结构序列化求和。 */
function eventLineBytes(events) {
  return events.reduce((acc, e) => {
    const line = JSON.stringify(e)
    return acc + line.length + 1 // +1 换行符
  }, 0)
}

async function eventsOf(api, query) {
  const res = mockResponse()
  await invoke(api, mockRequest({ url: `/observability/api/events${query}` }), res)
  return jsonOf(res).value
}

test('store: 高频事件下持久化为增量追加（无全量重写写放大）', async () => {
  const handle = bootPlugin({})
  disposeAlls.push(handle.disposeAll)
  const home = handle.home
  await settle()

  // 4 批 × 50 事件，批间隔 >500ms 防抖窗口：每批触发一次持久化
  const batches = 4
  const per = 50
  // 采样写入字节：连续 200ms 没有新字节即视为写入静止（issue #188b）。
  // 原先固定采样 batches*700+2000 约 4.8s，而批循环 2.8s 就结束了——白等约 2s。
  const tracker = (async () => {
    let total = 0
    let last = dirBytes(home)
    let idle = 0
    while (idle < 200) {
      await sleep(15)
      const cur = dirBytes(home)
      if (cur > last) {
        total += cur - last
        last = cur
        idle = 0
      } else {
        idle += 15
      }
    }
    return total
  })()

  for (let b = 0; b < batches; b += 1) {
    for (let i = 0; i < per; i += 1) {
      await dispatchEvent(handle.listeners, 'agent/status', {
        agent: topAgent('amp-1'),
        status: `s${b}-${i}`,
      })
    }
    await sleep(700)
  }
  const written = await tracker
  await settle()

  const events = await eventsOf(handle.api, '?sessionId=amp-1')
  assert.equal(events.length, batches * per, 'all events recorded')
  const expected = eventLineBytes(events)
  const tolerated = Math.ceil(expected * 1.6) + 512
  assert.ok(
    written <= tolerated,
    `写放大：实际写入 ${written}B，事件行字节 ${expected}B（上限 ${tolerated}B）；` +
      '若失败说明持久化仍在全量重写整个审计文件（= 9/2 磁盘写入风暴根因）',
  )
})

test('store: compact 产生完整快照且随后恢复增量追加', async () => {
  const handle = bootPlugin({})
  disposeAlls.push(handle.disposeAll)
  const home = handle.home
  await settle()

  // 3 个会话 × 1700 = 5100 事件，超过紧凑阈值（5000 行）触发 compact
  for (const sid of ['c1', 'c2', 'c3']) {
    for (let i = 0; i < 1700; i += 1) {
      await dispatchEvent(handle.listeners, 'agent/status', { agent: topAgent(sid), status: `x${i}` })
    }
  }
  await waitFileLines(jsonlFile(home), 5100) // 等 flush + compact 落盘（原固定 2500ms）

  const jsonl = jsonlFile(home)
  assert.ok(existsSync(jsonl), 'audit.jsonl exists after compact')
  const lines = readFileSync(jsonl, 'utf8')
    .split('\n')
    .filter((l) => l !== '').length
  assert.equal(lines, 5100, 'compact writes full live snapshot (no event loss)')

  // compact 后继续追加：100 事件只增 100 行（无放大）
  for (let i = 0; i < 100; i += 1) {
    await dispatchEvent(handle.listeners, 'agent/status', { agent: topAgent('c4'), status: `y${i}` })
  }
  await waitFileLines(jsonl, 5200) // 等追加落盘（原固定 1200ms）
  const linesAfter = readFileSync(jsonl, 'utf8')
    .split('\n')
    .filter((l) => l !== '').length
  assert.equal(linesAfter, 5200, 'append-only growth after compact')
  const events = await eventsOf(handle.api, '?sessionId=c4')
  assert.equal(events.length, 100, 'post-compact events queryable')
})

test('store: 旧格式 audit.json 迁移为 audit.jsonl 且事件恢复', async () => {
  const home = createTempHome()
  try {
    mkdirSync(join(home, 'observability'), { recursive: true })
    writeFileSync(
      legacyFile(home),
      JSON.stringify({
        version: 1,
        bySession: {
          m1: {
            events: [
              { id: 1, time: 1, sessionId: 'm1', type: 'agent_status', data: { status: 'x' } },
              { id: 2, time: 2, sessionId: 'm1', type: 'agent_status', data: { status: 'y' } },
            ],
          },
        },
      }),
      'utf8',
    )
    const handle = bootPlugin({}, { home })
    disposeAlls.push(handle.disposeAll)
    await settle()
    const events = await eventsOf(handle.api, '?sessionId=m1')
    assert.equal(events.length, 2, 'legacy events recovered')
    await waitUntil(() => existsSync(jsonlFile(home)) && !existsSync(legacyFile(home))) // 等迁移完成（原固定 1500ms）
    assert.ok(existsSync(jsonlFile(home)), 'audit.jsonl created by migration')
    assert.ok(!existsSync(legacyFile(home)), 'legacy audit.json removed after migration')
  } finally {
    cleanupHome(home)
  }
})

test('store: jsonl 解析跳过非法/截断行', async () => {
  const home = createTempHome()
  try {
    mkdirSync(join(home, 'observability'), { recursive: true })
    const good = JSON.stringify({ id: 1, time: 10, sessionId: 'good', type: 'agent_status', data: {} })
    writeFileSync(jsonlFile(home), `${good}\nnot-json-line\n{"time":"bad"}\n${good.slice(0, 30)}\n`, 'utf8')
    const handle = bootPlugin({}, { home })
    disposeAlls.push(handle.disposeAll)
    await settle()
    const events = await eventsOf(handle.api, '?sessionId=good')
    assert.equal(events.length, 1, 'only valid line restored')
  } finally {
    cleanupHome(home)
  }
})

test('store: dispose 时紧凑挂起仍完整落盘（无事件丢失）', async () => {
  const home = createTempHome()
  try {
    const handle = bootPlugin({}, { home })
    // 快速灌入超过紧凑阈值的事件，趁 compact 定时器挂起时立即 dispose
    for (let i = 0; i < 5100; i += 1) {
      await dispatchEvent(handle.listeners, 'agent/status', { agent: topAgent('d1'), status: `x${i}` })
    }
    handle.disposeAll() // compact 尚未执行时卸载
    await waitFileLines(jsonlFile(home), 2000) // 等 dispose 落盘（原固定 1500ms）
    const jsonl = jsonlFile(home)
    assert.ok(existsSync(jsonl), 'jsonl flushed on dispose')
    const lines = readFileSync(jsonl, 'utf8')
      .split('\n')
      .filter((l) => l !== '').length
    assert.equal(lines, 2000, 'dispose 后事件完整落盘（每会话上限 2000）')
    // 重启恢复
    const second = bootPlugin({}, { home })
    const events = await waitEvents(second.api, '?sessionId=d1', 2000)
    assert.equal(events.length, 2000, 'restart 后事件完整恢复')
    second.disposeAll()
  } finally {
    cleanupHome(home)
  }
})

test('store: 旧格式迁移在 dispose 前完成（migrated 兜底）', async () => {
  const home = createTempHome()
  try {
    mkdirSync(join(home, 'observability'), { recursive: true })
    writeFileSync(
      legacyFile(home),
      JSON.stringify({
        version: 1,
        bySession: { m2: { events: [{ id: 1, time: 5, sessionId: 'm2', type: 'agent_status', data: {} }] } },
      }),
      'utf8',
    )
    const first = bootPlugin({}, { home })
    // load 完成前即 dispose：未就绪回放 + 迁移兜底
    await dispatchEvent(first.listeners, 'agent/status', { agent: topAgent('m2'), status: 'idle' })
    first.disposeAll()
    await waitUntil(() => existsSync(jsonlFile(home)) && !existsSync(legacyFile(home))) // 等迁移兜底（原固定 1200ms）
    assert.ok(!existsSync(legacyFile(home)), 'legacy 已迁移移除')
    assert.ok(existsSync(jsonlFile(home)), 'jsonl 已生成')
    const second = bootPlugin({}, { home })
    const events = await waitEvents(second.api, '?sessionId=m2', 2)
    assert.equal(events.length, 2, '旧事件 + 新回放事件均恢复')
    second.disposeAll()
  } finally {
    cleanupHome(home)
  }
})

test('store: setPersistEnabled 降级停落盘 / 恢复全量快照补齐（资源看门狗，issue #127）', async () => {
  const home = createTempHome()
  try {
    const oldHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const store = createStore({ logger: { warn() {} } })
    const countLines = () =>
      readFileSync(jsonlFile(home), 'utf8')
        .split('\n')
        .filter((l) => l !== '').length
    const recordN = (n, tag) => {
      for (let i = 0; i < n; i += 1) {
        store.record({ sessionId: 'g1', type: 'agent_status', data: { status: `${tag}-${i}` } })
      }
    }

    await store.whenReady() // 等异步加载完成（原固定 400ms）
    // 正常阶段：50 事件落盘
    recordN(50, 'normal')
    await waitUntil(() => existsSync(jsonlFile(home)) && countLines() === 50) // 等 flush（原固定 900ms）
    assert.ok(existsSync(jsonlFile(home)), 'normal phase writes jsonl')
    const linesNormal = countLines()
    assert.equal(linesNormal, 50, 'normal phase: 50 events persisted')

    // 降级：停落盘；再记录 50 事件只入内存不写盘
    store.setPersistEnabled(false)
    recordN(50, 'degrade')
    await sleep(900) // 若 flush 仍在写会增长；应保持不变
    assert.equal(countLines(), linesNormal, 'degrade phase: no disk writes')

    // 事件仍可查询（内存有界，不丢）
    assert.equal(store.events('g1', undefined, 1000).length, 100, 'events still queryable in memory during degrade')

    // 恢复：全量快照补齐降级窗口事件
    store.setPersistEnabled(true)
    await waitUntil(() => countLines() === 100) // 等全量快照补齐（原固定 900ms）
    assert.equal(countLines(), 100, 'recover phase: full snapshot restores all events (50 old + 50 degrade)')

    store.dispose()
    if (oldHome !== undefined) process.env.DSH_HOME = oldHome
    else delete process.env.DSH_HOME
  } finally {
    cleanupHome(home)
  }
})
