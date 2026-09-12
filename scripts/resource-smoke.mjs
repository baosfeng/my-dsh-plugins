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
 *      状态（审计实测单次 1,396,407 B / 放大 3,665×）正是漏过本门禁的原因。
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

let failures = 0

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

async function main() {
  const oldHome = process.env.DSH_HOME
  console.log('[resource-smoke] 临时 DSH_HOME 按场景隔离（互不污染）')

  try {
    // ── 场景 1：长会话高频事件流 → 写放大 + 每会话内存有界 ──────────────
    console.log('\n[场景 1] 长会话 12000 事件（高频工具调用形态）')
    const home1 = mkdtempSync(join(tmpdir(), 'dsh-resource-smoke-'))
    process.env.DSH_HOME = home1
    const store = createStore({ logger: { warn() {} } })
    await sleep(400) // 等待 loadPersisted 完成
    for (let i = 0; i < 12000; i += 1) {
      store.record({ sessionId: 'session-1', type: 'agent_status', data: { status: `s${i}` } })
    }
    await sleep(900) // flush 500ms + compact 300ms 完成

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
    await sleep(400)
    for (let s = 0; s < 11; s += 1) {
      for (let i = 0; i < 2000; i += 1) {
        store2.record({ sessionId: `agent-${s}`, type: 'agent_status', data: { status: `x${i}` } })
      }
    }
    await sleep(900)
    check('全局事件数 ≤ 20000（超限整桶淘汰最早会话）', store2.count() <= 20000, `count=${store2.count()}`)
    check('最早会话被淘汰（整桶轮转）', store2.events('agent-0').length === 0, 'agent-0 已整桶淘汰')
    store2.dispose()
    rmSync(home2, { recursive: true, force: true })

    // ── 场景 3：降级路径（资源看门狗：停落盘 → 恢复全量快照补齐）────────
    console.log('\n[场景 3] 降级：setPersistEnabled(false) 停写 → true 全量补齐')
    const home3 = mkdtempSync(join(tmpdir(), 'dsh-resource-smoke-'))
    process.env.DSH_HOME = home3
    const store3 = createStore({ logger: { warn() {} } })
    await sleep(400)
    for (let i = 0; i < 50; i += 1) {
      store3.record({ sessionId: 'g1', type: 'agent_status', data: { status: `normal-${i}` } })
    }
    await sleep(900)
    const normalLines = lineCount(home3)

    // 降级停写：内存不丢、文件不增长
    store3.setPersistEnabled(false)
    for (let i = 0; i < 80; i += 1) {
      store3.record({ sessionId: 'g1', type: 'agent_status', data: { status: `degrade-${i}` } })
    }
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
    await sleep(900)
    check('恢复后全量快照补齐降级窗口事件（不丢不重）', lineCount(home3) === 130, `lines=${lineCount(home3)}`)
    store3.dispose()
    rmSync(home3, { recursive: true, force: true })

    // ── 场景 4：dsh-file-activity 写放大与三维有界（issue #197）─────────
    console.log('\n[场景 4] dsh-file-activity：5,100 事件 / 100 会话')
    const home4 = mkdtempSync(join(tmpdir(), 'dsh-resource-smoke-'))
    process.env.DSH_HOME = home4
    const faStore = createFileActivityStore({ logger: { warn() {} } })
    await sleep(400)
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
    await sleep(1500) // flush(500ms) + compact 落定
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
    const faFile = join(home4, 'file-activity.json')
    const faBytes = existsSync(faFile) ? Buffer.byteLength(readFileSync(faFile, 'utf8'), 'utf8') : 0
    check('状态文件有界（≤4MB）', faBytes > 0 && faBytes <= 4 * 1024 * 1024, `file=${faBytes}B`)
    faStore.dispose()
    rmSync(home4, { recursive: true, force: true })

    // ── 汇总 ────────────────────────────────────────────────────────────
    console.log(failures === 0 ? '\n[resource-smoke] 全部通过 ✅' : `\n[resource-smoke] ${failures} 项失败 ❌`)
    process.exit(failures === 0 ? 0 : 1)
  } finally {
    if (oldHome !== undefined) process.env.DSH_HOME = oldHome
    else delete process.env.DSH_HOME
  }
}

main().catch((error) => {
  console.error('[resource-smoke] 异常终止：', error)
  process.exit(1)
})
