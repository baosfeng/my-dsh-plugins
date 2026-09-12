import { test, afterAll } from 'vitest'
/**
 * 写放大复现测试（issue #197，quality-gates #11 / 防复发）。
 *
 * 背景：旧实现每次防抖落盘都 atomicWriteJson(全量 state) —— 单次落盘 =
 * 整个状态文件字节数（审计实测 1,396,407 B / 写放大 3,665×）。本套件在
 * 「≥5,000 事件 / 100+ 会话」规模下把**真实落盘字节**与事件本体字节对比：
 * 增量模型下二者同阶（≤1.6×），全量快照模型下必然数百倍。
 *
 * 测量方式：向 createStore 注入 appender 工厂（生产默认是 dsh-shared 的
 * jsonlAppender），工厂内部用真实 fs 写入并统计字节 —— 测的是真实盘面行为。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createStore } from '../lib/store.js'
import { stateFile } from '../lib/state.js'
import { fileBytes, fileText, settle, waitFileContains, waitReady, waitStateFile, waitUntil } from './lib/settle.mjs'

/** 注入式 appender：真实增量 append + 真快照原子重写 + 精确字节统计。 */
function makeAppender() {
  const io = { bytes: 0, writes: 0, chunks: [], snapshots: 0, maxSnapshot: 0 }
  const factory = (file, options) => {
    const queue = []
    let appended = 0
    let timer = null
    let chain = Promise.resolve()
    const flushNow = () => {
      if (queue.length === 0) return
      const text = queue.join('\n') + '\n'
      queue.length = 0
      io.bytes += Buffer.byteLength(text)
      io.writes += 1
      io.chunks.push(Buffer.byteLength(text))
      chain = chain
        .then(() => mkdir(dirname(file), { recursive: true }))
        .then(() => appendFile(file, text, 'utf8'))
        .catch(() => {})
      pending.push(chain)
    }
    const pending = []
    return {
      append(value) {
        queue.push(JSON.stringify(value))
        appended += 1
        if (timer !== null) return
        timer = setTimeout(() => {
          timer = null
          flushNow()
        }, options.flushMs)
      },
      flush: () => {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        flushNow()
        return chain
      },
      snapshot(lines) {
        const text = lines.length > 0 ? lines.join('\n') + '\n' : ''
        const bytes = Buffer.byteLength(text)
        io.bytes += bytes
        io.writes += 1
        io.snapshots += 1
        io.maxSnapshot = Math.max(io.maxSnapshot, bytes)
        queue.length = 0
        const tmp = file + '.tmp'
        chain = chain
          .then(() => mkdir(dirname(file), { recursive: true }))
          .then(() => writeFile(tmp, text, 'utf8'))
          .then(() => rename(tmp, file))
          .catch(() => {})
        pending.push(chain)
        return chain
      },
      dispose: () => Promise.all(pending).then(() => undefined),
      // 与 dsh-shared jsonlAppender 同口径：total = 累计追加行数（compact 预算依据）
      stats: () => ({ bytesWritten: io.bytes, writes: io.writes, total: appended }),
    }
  }
  return { io, factory, done: () => settle(3, 25) }
}

/** 事件本体下界：每条事件一行 JSON（含换行），与实际落盘行同构。 */
function eventBytes(rows) {
  let total = 0
  for (const r of rows) {
    total += Buffer.byteLength(JSON.stringify({ s: r.sessionId, p: r.path, o: r.op, t: r.time })) + 1
  }
  return total
}

const dirs = []
function freshHome(tag) {
  const dir = mkdtempSync(join(tmpdir(), 'dfa-' + tag + '-'))
  dirs.push(dir)
  process.env.DSH_HOME = dir
  return dir
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

// ── 场景 1：5,100 事件 / 100 会话（审计规模）─────────────────────────────
test('长会话 5,000+ 事件 / 100+ 会话：总落盘字节 ≈ 事件本体（写放大 ≤ 1.6）', async () => {
  freshHome('budget')
  const { io, factory } = makeAppender()
  const store = createStore({ logger: { warn: () => {} } }, { appender: factory })
  await waitReady(store)

  const rows = []
  for (let s = 0; s < 100; s += 1) {
    const sessionId = 'budget-session-' + s
    for (let i = 0; i < 51; i += 1) {
      const path = '/work/dir' + s + '/file-' + i + '.ts'
      const time = Date.now()
      store.record(sessionId, path, 'read', time)
      rows.push({ sessionId, path, op: 'read', time })
    }
  }
  // 防抖 500ms + append 落定：轮询「已 flush 且盘面字节追平内存计数」，满足即返回（issue #188）
  await waitUntil(() => io.writes > 0 && fileBytes(stateFile()) >= io.bytes)

  const expected = eventBytes(rows)
  const tolerated = Math.ceil(expected * 1.6) + 4096
  assert.ok(io.writes > 0, '必须真实落盘：writes=' + io.writes + ' bytes=' + io.bytes)
  assert.ok(
    io.bytes <= tolerated,
    '写放大超标：落盘 ' +
      io.bytes +
      'B > 容差 ' +
      tolerated +
      'B（事件本体 ' +
      expected +
      'B，放大 ' +
      (io.bytes / expected).toFixed(2) +
      '×）',
  )
  const size = Buffer.byteLength(readFileSync(stateFile(), 'utf8'))
  assert.ok(size <= 4 * 1024 * 1024, '状态文件 ' + size + 'B 超过 4MB 上界')
  store.dispose()
})

// ── 场景 2：单次落盘字节与状态体积解耦（非全量重写）──────────────────────
test('密集流：单次落盘字节与状态体积解耦（非全量重写）', async () => {
  freshHome('chunk')
  const { io, factory } = makeAppender()
  const store = createStore({ logger: { warn: () => {} } }, { appender: factory })
  await waitReady(store)

  for (let i = 0; i < 290; i += 1) store.record('warm-session', '/warm/p' + i + '.ts', 'read', Date.now())
  await waitUntil(() => io.writes > 0)
  const stateBytes = Buffer.byteLength(JSON.stringify(store.state))
  io.bytes = 0
  io.writes = 0
  io.chunks = []

  for (let i = 0; i < 40; i += 1) store.record('warm-session', '/warm/new-' + i + '.ts', 'read', Date.now())
  await waitUntil(() => io.writes > 0)

  assert.ok(io.writes > 0, '必须真实落盘')
  assert.ok(
    io.bytes < stateBytes / 4,
    '单次落盘 ' + io.bytes + 'B 未与状态体积 ' + stateBytes + 'B 解耦（全量重写特征）',
  )
  const maxChunk = io.chunks.reduce((m, c) => Math.max(m, c), 0)
  assert.ok(maxChunk <= 64 * 1024, '单次落盘 ' + maxChunk + 'B > 64KB（全量重写特征）')
  store.dispose()
})

// ── 场景 3：跨进程冷启动可完整重建 ───────────────────────────────────────
test('重启后从 JSON Lines 状态文件重建内存态（计数与历史不丢）', async () => {
  freshHome('rebuild')
  const store = createStore({ logger: { warn: () => {} } })
  await waitReady(store)
  for (let i = 0; i < 30; i += 1) {
    store.record('rebuild-session', '/r/f' + i + '.ts', i === 0 ? 'write' : 'read', Date.now())
  }
  store.record('rebuild-session', '/r/f1.ts', 'edit', Date.now())
  await waitStateFile(stateFile())
  store.dispose()
  await waitFileContains(stateFile(), '"m":1')

  const store2 = createStore({ logger: { warn: () => {} } })
  await waitReady(store2)
  const session = store2.state.sessions['rebuild-session']
  assert.ok(session, '重启后会话存在')
  assert.equal(session.counts['/r/f0.ts'].create, 1, 'create 计数恢复')
  assert.equal(session.counts['/r/f1.ts'].read, 1, 'read 计数恢复')
  assert.equal(session.counts['/r/f1.ts'].modify, 1, 'modify 计数恢复')
  assert.equal(Object.keys(session.counts).length, 30, '全部路径恢复')
  assert.equal(session.recent[0].path, '/r/f1.ts', 'LRU 历史顺序恢复')
  assert.ok(session.recent.length <= 5, 'LRU 历史上限保持')
  store2.dispose()
})

// ── 场景 3b：崩溃/重启前未 compact（文件里只有事件行）也必须能重建 ────────
test('未 compact（仅事件行）时冷启动同样可重建：事件行按序重放，不丢数据', async () => {
  freshHome('replay-only')
  const store = createStore({ logger: { warn: () => {} } })
  await waitReady(store)
  store.record('replay-session', '/p/a.ts', 'write', Date.now())
  store.record('replay-session', '/p/a.ts', 'edit', Date.now())
  store.record('replay-session', '/p/b.ts', 'read', Date.now())
  await waitStateFile(stateFile())
  const text = readFileSync(stateFile(), 'utf8')
  assert.ok(text.includes('"p":'), '文件里是事件行')
  assert.ok(!text.includes('"m":1'), '此时还没有 compact 快照行')

  const store2 = createStore({ logger: { warn: () => {} } })
  await waitReady(store2)
  const session = store2.state.sessions['replay-session']
  assert.ok(session, '仅事件行也能重建会话')
  assert.equal(session.counts['/p/a.ts'].create, 1, 'create 重放正确')
  assert.equal(session.counts['/p/a.ts'].modify, 1, 'modify 重放正确')
  assert.equal(session.counts['/p/b.ts'].read, 1, 'read 重放正确')
  store2.dispose()
})

// ── 场景 3c：超过 compact 行预算后自动原子快照（文件有界 + 重载完整）──────
test('超过 compact 预算触发原子快照：文件有界、重载计数完整', async () => {
  freshHome('compact')
  const { io, factory } = makeAppender()
  // 注入小预算（生产默认 20000 行，按状态体积自适应），直接覆盖 compact 分支
  const limits = { maxPathsPerSession: 1000 }
  const store = createStore({ logger: { warn: () => {} } }, { appender: factory, compactLines: 200, limits })
  await waitReady(store)
  for (let i = 0; i < 700; i += 1) store.record('c-sess', '/c/f' + i + '.ts', 'read', Date.now())
  await waitUntil(() => io.snapshots >= 1 && fileText(stateFile()).includes('"m":1'))

  assert.ok(io.snapshots >= 1, '达到行预算后触发 compact 快照（实际 snapshots=' + io.snapshots + '）')
  const text = readFileSync(stateFile(), 'utf8')
  assert.ok(text.includes('"m":1'), '盘面含快照元信息行（原子重写为 JSON Lines）')
  const size = Buffer.byteLength(text)
  assert.ok(size <= 512 * 1024, 'compact 后文件有界（' + size + 'B）')

  const store2 = createStore({ logger: { warn: () => {} } }, { compactLines: 200, limits })
  await waitReady(store2)
  const session = store2.state.sessions['c-sess']
  assert.equal(Object.keys(session.counts).length, 700, 'compact 后重载计数完整')
  assert.equal(session.counts['/c/f699.ts'].read, 1, '计数精确')
  store2.dispose()
  store.dispose()
})

// ── 场景 4：旧格式（全量 JSON 快照）升级后数据不丢 + 盘面收敛 ────────────
test('升级：旧格式状态文件的计数被完整接管（首次启动一次性 compact）', async () => {
  freshHome('migrate')
  const legacy = {
    version: 1,
    sessions: {
      'old-session': {
        known: { '/legacy/a.ts': 111 },
        counts: { '/legacy/a.ts': { read: 7, create: 2, modify: 3, firstSeen: 111, lastSeen: 222 } },
        recent: [{ path: '/legacy/a.ts', op: 'read', time: 222 }],
      },
    },
  }
  writeFileSync(stateFile(), JSON.stringify(legacy), 'utf8')
  const store = createStore({ logger: { warn: () => {} } })
  await waitReady(store)
  const session = store.state.sessions['old-session']
  assert.ok(session, '旧格式会话被接管')
  assert.equal(session.counts['/legacy/a.ts'].read, 7, '旧计数保留')
  assert.equal(session.counts['/legacy/a.ts'].modify, 3, '旧计数保留（modify）')
  await waitFileContains(stateFile(), '"m":1')
  const text = readFileSync(stateFile(), 'utf8')
  assert.ok(text.includes('"m":1'), '盘面已重写为 JSON Lines 快照格式')
  store.dispose()
})
