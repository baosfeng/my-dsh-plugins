/**
 * dsh-shared jsonlAppender + atomicWriteJson 护栏测试。
 *
 * 资源护栏（quality-gates #11 / resource-budget-review）：
 *  - 高频 append 落盘字节 ≈ 事件本体字节（无全量重写写放大）；
 *  - 防抖窗口内批量合并（写入次数与事件数解耦）；
 *  - compact 阈值回调 + 快照重置；
 *  - atomicWriteJson 显式护栏参数（minIntervalMs 节流 / maxBytes 拒绝巨型对象）；
 *    默认护栏（1s/1MB）与 force/计数见 test/persist.mjs（issue #198）。
 *
 * io 失败注入的环境无关性（覆盖边界，务必按此维护）：
 *  - **不要**用 `chmod 目录 0555` 作为唯一的失败注入手段：权限位在特权环境
 *    下不生效——root 具 CAP_DAC_OVERRIDE（CI 容器以 root 运行）、
 *    Windows 忽略 mode、部分容器/网络文件系统同理，写入照样成功 → 降级
 *    warn 数为 0 → 断言假失败（真实事故：容器化 CI 报 `flush/snapshot 失败均有
 *    warn（got 0）`，非 root runner 上通过）。
 *  - 主用例改用与权限位、运行用户完全无关的确定性 I/O 错误：目标路径本身
 *    是目录（flush 的 appendFile / snapshot 的 rename → EISDIR）、父层级是
 *    常规文件（两者的 mkdir recursive → ENOTDIR）。POSIX 语义在 root 与非
 *    root 下一致，覆盖的仍是"落盘失败 → 只告警不抛出"这条逻辑。
 *  - 只读目录（真实 EACCES）场景单独保留一个用例，运行前先**动态探测**权限
 *    位是否被强制执行，特权环境显式 skip 并打印原因；非特权环境下该用例的
 *    断言与强度与修复前完全一致。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jsonlAppender, parseJsonlLines } from '../lib/jsonl.js'
import { atomicWriteJson } from '../lib/persist.js'

const dirs = []
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-shared-jsonl-'))
  dirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const noop = { warn() {} }

/**
 * 动态探测目录的权限位是否被内核强制执行：chmod 0555 后试写一个探针文件，
 * 写成功 ⇒ 权限位不生效（root/CAP_DAC_OVERRIDE、Windows、部分容器或网络
 * 文件系统），EACCES 无法被注入。比 `process.getuid() === 0` 更准确——
 * ACL、只读挂载、平台差异都能识别。
 */
function permBitsEnforced(dir) {
  chmodSync(dir, 0o555)
  try {
    writeFileSync(join(dir, '.perm-probe'), '', 'utf8')
    return false
  } catch {
    return true
  } finally {
    rmSync(join(dir, '.perm-probe'), { force: true })
    chmodSync(dir, 0o755)
  }
}
const linesOf = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
    : []

test('jsonlAppender: 高频追加为增量写（无写放大）+ 防抖合并', async () => {
  const dir = tempDir()
  const file = join(dir, 'audit.jsonl')
  const appender = jsonlAppender(file, { flushMs: 50, compactLines: 100000, logger: noop })
  const events = []
  for (let i = 0; i < 200; i += 1) {
    const ev = { id: i, time: 1000 + i, sessionId: 's1', type: 'agent_status', data: {} }
    events.push(ev)
    appender.append(ev)
  }
  appender.flush()
  await sleep(120)
  const text = readFileSync(file, 'utf8')
  const eventBytes = events.reduce((acc, e) => acc + JSON.stringify(e).length + 1, 0)
  assert.ok(text.length <= Math.ceil(eventBytes * 1.6) + 64, `写放大：文件 ${text.length}B vs 事件 ${eventBytes}B`)
  const stats = appender.stats()
  assert.ok(stats.writes <= 3, `防抖合并：写入次数 ${stats.writes} 应远小于事件数`)
  assert.equal(linesOf(file).length, 200, '全部事件落盘')
  appender.dispose()
})

test('jsonlAppender: compact 阈值回调 + 快照重置 + dispose 冲刷', async () => {
  const dir = tempDir()
  const file = join(dir, 'audit.jsonl')
  let compacted = 0
  const appender = jsonlAppender(file, {
    flushMs: 30,
    compactLines: 50,
    logger: noop,
    onCompact: () => {
      compacted += 1
      appender.append({ compacted }) // 模拟回调期间的写入竞争（覆盖 compacting 防重入）
    },
  })
  for (let i = 0; i < 120; i += 1) appender.append({ i })
  appender.dispose() // compact timer 未触发时 dispose 兜底执行 onCompact
  await sleep(150)
  assert.ok(compacted >= 1, 'compact 阈值回调触发')
  assert.ok(linesOf(file).length >= 100, 'dispose 后事件落盘')
  // 句柄快照（宿主提供全量行）→ 文件 = 快照内容 + 队列/阈值计数重置
  await appender.snapshot(['{"a":1}', '{"a":2}'])
  assert.deepEqual(JSON.parse(linesOf(file)[0]), { a: 1 }, '快照覆盖为宿主行内容')
  assert.ok(appender.stats().writes >= 1, '句柄写计数 ≥1（flush + 回调期间的补充 flush + 快照）')
})

test('jsonlAppender: parseJsonlLines 跳过坏行', () => {
  const parsed = parseJsonlLines('{"a":1}\nnot-json\n{"a":2}\n\n{"a":3')
  assert.equal(parsed.length, 2, '仅合法 JSON 行返回')
  assert.equal(JSON.parse(parsed[1]).a, 2)
})

test('atomicWriteJson 护栏: minIntervalMs 节流 + maxBytes 拒绝', async () => {
  const dir = tempDir()
  const file = join(dir, 'state.json')
  const warns = []
  const logger = { warn: (m) => warns.push(m) }
  // 基线：无选项行为不变
  assert.equal(await atomicWriteJson(file, { ok: 1 }, logger, '[t]'), true, '缺省写成功')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).ok, 1)
  // minIntervalMs：窗口内第二次跳过
  const ok2 = await atomicWriteJson(file, { ok: 2 }, logger, '[t]', { minIntervalMs: 60000 })
  assert.equal(ok2, false, '窗口内写被节流拒绝')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).ok, 1, '文件未被覆盖')
  assert.ok(warns.length >= 1, '节流写入有 warn 记录')
  // maxBytes：巨型对象拒绝
  const big = { blob: 'x'.repeat(100000) }
  const ok3 = await atomicWriteJson(file, big, logger, '[t]', { maxBytes: 1000 })
  assert.equal(ok3, false, '超 maxBytes 拒绝')
  assert.ok(warns.length >= 2, '拒绝有 warn 记录')
})

test('jsonlAppender: io 错误降级——确定性 I/O 失败（EISDIR/ENOTDIR）仅警告不抛出', async () => {
  const dir = tempDir()
  const warns = []
  const logger = { warn: (m) => warns.push(m) }

  // 注入 1：目标路径本身是目录 → flush 的 appendFile、snapshot 的 rename 均 EISDIR
  const fileAsDir = join(dir, 'file-as-dir', 'audit.jsonl')
  mkdirSync(fileAsDir, { recursive: true })
  const appenderA = jsonlAppender(fileAsDir, { flushMs: 10, compactLines: 5, logger })
  for (let i = 0; i < 8; i += 1) appenderA.append({ i })
  appenderA.flush()
  await appenderA.snapshot(['{"a":1}'])
  appenderA.dispose()

  // 注入 2：父层级是常规文件 → 两者的 mkdir(recursive) 均 ENOTDIR
  const parentAsFile = join(dir, 'parent-as-file')
  writeFileSync(parentAsFile, '', 'utf8')
  const appenderB = jsonlAppender(join(parentAsFile, 'audit.jsonl'), { flushMs: 10, compactLines: 5, logger })
  appenderB.append({ x: 1 })
  appenderB.flush()
  await appenderB.snapshot(['{"b":2}'])
  appenderB.dispose()
  await sleep(50)

  assert.equal(warns.length, 4, `flush/snapshot 失败均有 warn（got ${warns.length}）`)
  assert.deepEqual(
    warns.map((m) => m.replace(/:.*/, '')),
    ['[jsonl] append failed', '[jsonl] snapshot failed', '[jsonl] append failed', '[jsonl] snapshot failed'],
    'warn 带 prefix 且区分 append/snapshot 来源',
  )
})

test('jsonlAppender: io 错误降级——flush/snapshot 失败仅警告不抛出（只读目录 EACCES）「需权限位生效」', async (context) => {
  const dir = tempDir()
  const file = join(dir, 'readonly', 'audit.jsonl')
  const warns = []
  const logger = { warn: (m) => warns.push(m) }
  const appender = jsonlAppender(file, { flushMs: 10, compactLines: 5, logger })
  // 目录不存在会自建——先建好，再决定用哪种失败注入
  mkdirSync(join(dir, 'readonly'), { recursive: true })
  if (!permBitsEnforced(join(dir, 'readonly'))) {
    const reason =
      '权限位未生效（root/CAP_DAC_OVERRIDE、Windows 或只读挂载类文件系统）：chmod 0555 后写入仍成功，无法注入 EACCES。' +
      '降级逻辑已由「确定性 I/O 失败（EISDIR/ENOTDIR）」用例覆盖，本用例仅在权限位被强制执行的普通用户环境具备判定力'
    console.log(`[skip] jsonlAppender io 错误降级（只读目录 EACCES）：${reason}`)
    appender.dispose()
    context.skip(reason)
    return
  }
  chmodSync(join(dir, 'readonly'), 0o555)
  try {
    for (let i = 0; i < 8; i += 1) appender.append({ i })
    appender.flush()
    await sleep(100)
    await appender.snapshot(['{"a":1}'])
    appender.dispose()
    await sleep(50)
  } finally {
    chmodSync(join(dir, 'readonly'), 0o755)
  }
  assert.ok(warns.length >= 2, `flush/snapshot 失败均有 warn（got ${warns.length}）`)
  assert.deepEqual(
    warns.map((m) => m.replace(/:.*/, '')),
    ['[jsonl] append failed', '[jsonl] snapshot failed'],
    'EACCES 场景 warn 同样带 prefix 且区分来源',
  )
})
