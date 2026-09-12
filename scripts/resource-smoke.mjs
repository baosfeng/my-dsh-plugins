#!/usr/bin/env node
/**
 * resource-smoke.mjs — 长会话资源冒烟（issue #127 发版前资源回归门禁）。
 *
 * 模拟「高频工具调用 + 多子 agent + 数小时」的生产形态（补充 #126 长会话
 * 测试盲区），断言 observability 审计存储的增量模型资源可控：
 *
 *   1. 写放大 ≤ 1.6：1 万+ 事件落盘字节 ≈ 事件行字节（增量追加 + compact
 *      快照，而非每次全量重写整个状态文件——9/2 磁盘写入风暴根因）；
 *   2. 内存有界：单会话灌 1.2 万事件后内存态事件数 = 每会话上限 2000
 *      （FIFO 淘汰，不随事件数线性增长）；多会话全局 ≤ 20000；
 *   3. 降级路径（资源看门狗）：setPersistEnabled(false) 停落盘但内存事件
 *      不丢、文件不增长；恢复后全量快照补齐降级窗口事件（不丢不重）；
 *   4. dsh-file-activity（issue #197 纳入覆盖）：5,100 事件 / 100 会话下写
 *      放大 ≤ 1.6、内存与状态文件三维有界 —— 旧实现每次防抖全量重写整个
 *      状态（审计实测单次 1,396,407 B / 放大 3,665×）正是漏过本门禁的原因；
 *   5. dsh-my-context（issue #198 纳入覆盖）：bySession 会话数有界（LRU +
 *      淘汰计数）、写入节流生效（写次数 ≤ 时间窗口 ÷ 最小间隔），并打印
 *      「旧节奏（防抖 500ms + 无护栏） vs 实际（+ 最小间隔 1s）」写入次数/字节对比。
 *
 * 全部通过 exit 0；任一失败 exit 1 并打印原因。
 * CI 入口：.github/workflows/ci.yml 的 resource-smoke job（独立于功能测试）。
 * 本地用法：node scripts/resource-smoke.mjs
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../plugins/dsh-my-observability/lib/store.js'
import { createStore as createFileActivityStore } from '../plugins/dsh-file-activity/lib/store.js'
import { createStore as createContextStore } from '../plugins/dsh-my-context/lib/store.js'
import { createState, createSession } from '../plugins/dsh-my-context/lib/state.js'
import { atomicWriteJson, atomicWriteStats, createWriteScheduler } from '../plugins/dsh-shared/lib/index.js'

let failures = 0

/** 资源冒烟统一静默 logger（warn 由各 store 自行降级）。 */
const QUIET = { warn() {} }

function check(name, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ''}`)
  }
}

function jsonlFile(home) {
  return join(home, 'observability', 'audit.jsonl')
}

function lineCount(home) {
  const file = jsonlFile(home)
  if (!existsSync(file)) return 0
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l !== '').length
}

function fileBytes(home) {
  const file = jsonlFile(home)
  if (!existsSync(file)) return 0
  return Buffer.byteLength(readFileSync(file, 'utf8'), 'utf8')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 轮询直到 predicate 成立（issue #188b：把「固定等 N 毫秒」换成「等真实完成信号」）。
 * 超时返回 false，由原 check() 断言照常判定——等待语义只加强不削弱。
 */
async function waitUntil(predicate, { timeoutMs = 8000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return true
    if (Date.now() >= deadline) return false
    await sleep(intervalMs)
  }
}

/**
 * 等一个可读数值稳定下来（连续 quietMs 无变化即视为落定）。
 * minMs 是下限：持久化有 500ms 防抖窗口，窗口内文件本来就还没开始写，
 * 没有下限会把「还没写」误判成「写完了」。
 */
async function waitStable(read, { quietMs = 300, minMs = 700, timeoutMs = 8000 } = {}) {
  const started = Date.now()
  const deadline = started + timeoutMs
  let last = read()
  let idle = 0
  while (Date.now() < deadline) {
    await sleep(25)
    const current = read()
    if (current !== last) {
      last = current
      idle = 0
    } else {
      idle += 25
    }
    if (idle >= quietMs && Date.now() - started >= minMs) return true
  }
  return false
}

async function main() {
  const oldHome = process.env.DSH_HOME
  console.log('[resource-smoke] 临时 DSH_HOME 按场景隔离（互不污染）')

  try {
    // ── 场景 1：长会话高频事件流 → 写放大 + 每会话内存有界 ──────────────
    console.log('\n[场景 1] 长会话 12000 事件（高频工具调用形态）')
    const home1 = mkdtempSync(join(tmpdir(), 'dsh-resource-smoke-'))
    process.env.DSH_HOME = home1
    const store = createStore({ logger: { warn() {} } })
    await store.whenReady() // 等 loadPersisted 完成（确定性信号，替代固定 400ms）
    for (let i = 0; i < 12000; i += 1) {
      store.record({ sessionId: 'session-1', type: 'agent_status', data: { status: `s${i}` } })
    }
    // flush 500ms + compact 300ms 落定：等落盘字节稳定（原固定 900ms）
    await waitStable(() => fileBytes(home1))

    // 内存有界：单会话 FIFO 上限 2000
    check('内存态事件数 = 每会话上限 2000（FIFO，不线性增长）', store.count() === 2000, `count=${store.count()}`)

    // 写放大：落盘字节 ≈ 事件行字节
    const events = store.events('session-1')
    const expectedBytes = events.reduce((acc, e) => acc + Buffer.byteLength(JSON.stringify(e), 'utf8') + 1, 0)
    const tolerated = Math.ceil(expectedBytes * 1.6) + 512
    const written = fileBytes(home1)
    check(
      '写放大 ≤ 1.6（落盘字节 ≈ 事件行字节，增量追加非全量重写）',
      written <= tolerated,
      `written=${written}B, expected=${expectedBytes}B, tolerated=${tolerated}B`,
    )
    store.dispose()
    rmSync(home1, { recursive: true, force: true })

    // ── 场景 2：多会话全局上限 20000 ────────────────────────────────────
    console.log('\n[场景 2] 11 会话 × 2000 事件（多子 agent 形态）')
    const home2 = mkdtempSync(join(tmpdir(), 'dsh-resource-smoke-'))
    process.env.DSH_HOME = home2
    const store2 = createStore({ logger: { warn() {} } })
    await store2.whenReady() // 确定性就绪信号（原固定 400ms）
    for (let s = 0; s < 11; s += 1) {
      for (let i = 0; i < 2000; i += 1) {
        store2.record({ sessionId: `agent-${s}`, type: 'agent_status', data: { status: `x${i}` } })
      }
    }
    await waitStable(() => fileBytes(home2)) // 等落盘稳定（原固定 900ms）
    check('全局事件数 ≤ 20000（超限整桶淘汰最早会话）', store2.count() <= 20000, `count=${store2.count()}`)
    check('最早会话被淘汰（整桶轮转）', store2.events('agent-0').length === 0, 'agent-0 已整桶淘汰')
    store2.dispose()
    rmSync(home2, { recursive: true, force: true })

    // ── 场景 3：降级路径（资源看门狗：停落盘 → 恢复全量快照补齐）────────
    console.log('\n[场景 3] 降级：setPersistEnabled(false) 停写 → true 全量补齐')
    const home3 = mkdtempSync(join(tmpdir(), 'dsh-resource-smoke-'))
    process.env.DSH_HOME = home3
    const store3 = createStore({ logger: { warn() {} } })
    await store3.whenReady() // 确定性就绪信号（原固定 400ms）
    for (let i = 0; i < 50; i += 1) {
      store3.record({ sessionId: 'g1', type: 'agent_status', data: { status: `normal-${i}` } })
    }
    await waitUntil(() => lineCount(home3) === 50) // 等 50 条落盘（原固定 900ms）
    const normalLines = lineCount(home3)

    // 降级停写：内存不丢、文件不增长
    store3.setPersistEnabled(false)
    for (let i = 0; i < 80; i += 1) {
      store3.record({ sessionId: 'g1', type: 'agent_status', data: { status: `degrade-${i}` } })
    }
    // 这一处**刻意保留固定窗口**：断言是「降级期间不该有写入」——否定命题没有可轮询的
    // 完成信号，必须让一个大于防抖窗口（500ms）的时间窗真正过去，否则等于没测。
    await sleep(900)
    check(
      '降级期间落盘停止（文件行数不变）',
      lineCount(home3) === normalLines,
      `lines=${lineCount(home3)} vs ${normalLines}`,
    )
    check(
      '降级期间事件仍可查询（内存有界不丢）',
      store3.events('g1').length === 130,
      `count=${store3.events('g1').length}`,
    )

    // 恢复：全量快照补齐（50 旧 + 80 降级窗口 = 130）
    store3.setPersistEnabled(true)
    await waitUntil(() => lineCount(home3) === 130) // 等全量快照补齐（原固定 900ms）
    check('恢复后全量快照补齐降级窗口事件（不丢不重）', lineCount(home3) === 130, `lines=${lineCount(home3)}`)
    store3.dispose()
    rmSync(home3, { recursive: true, force: true })

    // ── 场景 4：dsh-file-activity 写放大与三维有界（issue #197）─────────
    console.log('\n[场景 4] dsh-file-activity：5,100 事件 / 100 会话')
    const home4 = mkdtempSync(join(tmpdir(), 'dsh-resource-smoke-'))
    process.env.DSH_HOME = home4
    const faStore = createFileActivityStore({ logger: { warn() {} } })
    // file-activity store 没有 whenReady：onLoaded 会把 store.state 换成新对象，用引用变化当就绪信号
    const faInitialState = faStore.state
    await waitUntil(() => faStore.state !== faInitialState)
    const faTime = Date.now()
    let faExpected = 0
    for (let s = 0; s < 100; s += 1) {
      for (let i = 0; i < 51; i += 1) {
        const sessionId = `fa-${s}`
        const path = `/work/dir${s}/file-${i}.ts`
        faStore.record(sessionId, path, 'read', faTime)
        faExpected += Buffer.byteLength(JSON.stringify({ s: sessionId, p: path, o: 'read', t: faTime }), 'utf8') + 1
      }
    }
    const faFile = join(home4, 'file-activity.json')
    // flush(500ms) + compact 落定：等状态文件字节稳定（原固定 1500ms）
    await waitStable(() => (existsSync(faFile) ? Buffer.byteLength(readFileSync(faFile, 'utf8'), 'utf8') : 0))
    const faStats = faStore.stats()
    const faTolerated = Math.ceil(faExpected * 1.6) + 8192
    check(
      '写放大 ≤ 1.6（JSON Lines 增量 append + 有界 compact，非全量重写）',
      faStats.writes > 0 && faStats.bytesWritten <= faTolerated,
      `written=${faStats.bytesWritten}B, expected=${faExpected}B, tolerated=${faTolerated}B, amplification=${(faStats.bytesWritten / faExpected).toFixed(2)}×`,
    )
    check(
      '内存有界（会话数 ≤ 上限、淘汰计数可观测）',
      Object.keys(faStore.state.sessions).length <= faStats.maxSessions && faStats.evictedSessions > 0,
      `sessions=${Object.keys(faStore.state.sessions).length}/${faStats.maxSessions}, evictedSessions=${faStats.evictedSessions}`,
    )
    check(
      '路径总数 ≤ 全局上限（三维入口配额生效）',
      faStats.pathCount <= faStats.maxPathsTotal,
      `paths=${faStats.pathCount}/${faStats.maxPathsTotal}`,
    )
    const faBytes = existsSync(faFile) ? Buffer.byteLength(readFileSync(faFile, 'utf8'), 'utf8') : 0
    check('状态文件有界（≤4MB）', faBytes > 0 && faBytes <= 4 * 1024 * 1024, `file=${faBytes}B`)
    faStore.dispose()
    rmSync(home4, { recursive: true, force: true })

    // ── 场景 5：dsh-my-context 有界容器 + 写入调度（issue #198）──────────
    console.log('\n[场景 5] dsh-my-context：会话数有界 + 写入节流（旧/新节奏对比）')
    const home5a = mkdtempSync(join(tmpdir(), 'dsh-resource-smoke-'))
    process.env.DSH_HOME = home5a
    const ctxStore = createContextStore({ logger: QUIET })
    await sleep(300)

    // 5a：会话数上限（审计缺口：bySession 此前无上限）
    for (let s = 0; s < 25; s += 1) {
      ctxStore.recordRequest(`cap-${s}`, { turn: 1, step: 1, usage: { inputTokens: 1 } })
    }
    await ctxStore.whenPersisted()
    const capStats = ctxStore.stats()
    check(
      'bySession 会话数有界（LRU 淘汰 + 淘汰计数可观测）',
      capStats.sessions <= capStats.maxSessions && capStats.evictedSessions === 25 - capStats.maxSessions,
      `sessions=${capStats.sessions}/${capStats.maxSessions}, evictedSessions=${capStats.evictedSessions}`,
    )
    ctxStore.dispose()
    rmSync(home5a, { recursive: true, force: true })

    // 5b：写节奏对比（旧默认值「防抖 500ms + 无护栏」 vs 实际「防抖 500ms + 最小间隔 1s」）
    // 空目录起步 + 预热到状态稳定（每会话请求达上限）→ 两侧状态大小相同，字节可直接比。
    const home5b = mkdtempSync(join(tmpdir(), 'dsh-resource-smoke-'))
    const legacy = await legacyContextStream(home5b, 30)
    const current = await contextStream(home5b, 30)
    console.log(
      `  · 写节奏对比（事件流 ${current.elapsed}ms）：旧「防抖 500ms + 无护栏」${legacy.writes} 次 / ${legacy.bytes}B` +
        ` → 新「+ 最小间隔 1s」${current.writes} 次 / ${current.bytes}B`,
    )
    const writeCap = Math.ceil(current.elapsed / 1000) + 2
    check(
      '写入节流生效：写次数 ≤ 时间窗口 ÷ 最小间隔 + 2',
      current.writes <= writeCap,
      `writes=${current.writes}（上界 ${writeCap}）, bytes=${current.bytes}`,
    )
    check(
      '新旧节奏对比：写次数不高于旧节奏（防抖 500ms + 无护栏）',
      current.writes <= legacy.writes,
      `旧 ${legacy.writes} 次 / ${legacy.bytes}B → 新 ${current.writes} 次 / ${current.bytes}B`,
    )
    const ctxFile = join(home5b, 'context', 'context.json')
    const ctxBytes = existsSync(ctxFile) ? Buffer.byteLength(readFileSync(ctxFile, 'utf8'), 'utf8') : 0
    check('状态文件字节有界（≤8MB 显式上限）', ctxBytes > 0 && ctxBytes <= 8 * 1024 * 1024, `file=${ctxBytes}B`)
    rmSync(home5b, { recursive: true, force: true })

    // ── 汇总 ────────────────────────────────────────────────────────────
    console.log(failures === 0 ? '\n[resource-smoke] 全部通过 ✅' : `\n[resource-smoke] ${failures} 项失败 ❌`)
    process.exit(failures === 0 ? 0 : 1)
  } finally {
    if (oldHome !== undefined) process.env.DSH_HOME = oldHome
    else delete process.env.DSH_HOME
  }
}

/**
 * 场景 5 helper：一次请求记录——字段与 store.applyRequest 的产出**逐一对应**
 * （14 个字段），保证「旧节奏对照组」与「实际 store」写出的字节可直接比较。
 */
function requestOf(tick) {
  return {
    turn: 1,
    step: tick,
    time: Date.now(),
    prompt: 1000,
    output: 20,
    cacheRead: 900,
    cacheWrite: 100,
    total: 1020,
    system: 120,
    tools: 300,
    user: 80,
    inject: 40,
    assistant: 60,
    tool: 120,
  }
}

/** 场景 5 helper：向（对照组）state 追加一次会话请求，结构与 store.recordRequest 一致。 */
function pushRequest(state, sessionId, tick) {
  let session = state.bySession.get(sessionId)
  if (session === undefined) {
    session = createSession(sessionId)
    state.bySession.set(sessionId, session)
  }
  session.requests.push(requestOf(tick))
  session.updatedAt = Date.now()
}

/** 场景 5 helper：预热到状态稳态（每会话请求数达上限，之后 FIFO 替换不再增长）。 */
function warmUp(state) {
  for (let i = 0; i < 500; i += 1) {
    for (let s = 0; s < 3; s += 1) pushRequest(state, `legacy-${s}`, i)
  }
}

/** 场景 5 helper：旧节奏对照组——防抖 500ms + 无护栏（issue #198 之前的默认值）。 */
async function legacyContextStream(home, ticks) {
  const file = join(home, 'legacy-context.json')
  const state = createState()
  const scheduler = createWriteScheduler({
    debounceMs: 500,
    minIntervalMs: 0,
    prefix: '[legacy]',
    write: ({ force }) =>
      atomicWriteJson(file, state, QUIET, '[legacy]', { force, minIntervalMs: 0, maxBytes: Number.POSITIVE_INFINITY }),
  })
  warmUp(state)
  await scheduler.flush() // 预热落盘一次后开始测量
  const before = atomicWriteStats()
  const started = Date.now()
  for (let tick = 0; tick < ticks; tick += 1) {
    for (let s = 0; s < 3; s += 1) pushRequest(state, `legacy-${s}`, tick)
    scheduler.schedule()
    await sleep(100)
  }
  await scheduler.drain()
  return {
    writes: atomicWriteStats().writes - before.writes,
    bytes: atomicWriteStats().bytesWritten - before.bytesWritten,
    elapsed: Date.now() - started,
  }
}

/** 场景 5 helper：实际配置——dsh-my-context store（防抖 500ms + 最小间隔 1s + 有界容器）。 */
async function contextStream(home, ticks) {
  process.env.DSH_HOME = home
  const store = createContextStore({ logger: QUIET })
  await sleep(300)
  // 预热到稳态（与对照组同规模），再排掉首次落盘：只测事件流节奏
  for (let i = 0; i < 500; i += 1) {
    for (let s = 0; s < 3; s += 1) store.recordRequest(`ctx-${s}`, requestOf(i))
  }
  await store.whenPersisted()
  const before = atomicWriteStats()
  const started = Date.now()
  for (let tick = 0; tick < ticks; tick += 1) {
    for (let s = 0; s < 3; s += 1) store.recordRequest(`ctx-${s}`, requestOf(tick))
    await sleep(100)
  }
  await store.whenPersisted()
  const result = {
    writes: atomicWriteStats().writes - before.writes,
    bytes: atomicWriteStats().bytesWritten - before.bytesWritten,
    elapsed: Date.now() - started,
  }
  store.dispose()
  return result
}

main().catch((error) => {
  console.error('[resource-smoke] 异常终止：', error)
  process.exit(1)
})
