/**
 * B 簇复现测试（issue #343）：共享落盘原语（jsonlAppender）缺「已排空」信号。
 *
 * ## 根因
 *
 * `append()` / `flush()` 是**同步排队**语义：把行交给内部防抖窗口后立即返回，
 * 调用方无法 await 到"确已落盘"。测试只能 `await sleep(flushMs + 余量)` 赌窗口到期
 * —— 在慢 IO / 高负载下必然早于真实写完（同仓库的 `createWriteScheduler.drain()`
 * 早就有这个信号，属能力落差）。
 *
 * ## 复现手法（确定性，不靠 CI 撞运气）
 *
 * 用 `vi.mock('node:fs/promises')` 把 append 链路的实际写操作延迟 300ms，
 * 把"防抖窗口之后、真实落盘之前"这个窗口放大成必然命中：
 *
 *   · 改动前的写法（固定等 flushMs + 余量）必然读到空文件 → 必红；
 *   · `await appender.drained()` 等的是写链本身 → 与 IO 耗时无关 → 必绿。
 *
 * 改动前 `drained` 不存在 → 全部用例抛 `appender.drained is not a function`，3/3 红。
 */
import { test, afterAll, vi } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { sleepFor } from '../test-kit/wait.mjs'

/** 受控 IO 闸门（vi.hoisted：mock 工厂与用例共享的可变状态）。 */
const io = vi.hoisted(() => ({ delayMs: 0 }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  const slow = async (fn, ...args) => {
    if (io.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, io.delayMs))
    return fn(...args)
  }
  return {
    ...actual,
    mkdir: (...args) => slow(actual.mkdir, ...args),
    appendFile: (...args) => slow(actual.appendFile, ...args),
    writeFile: (...args) => slow(actual.writeFile, ...args),
    rename: (...args) => slow(actual.rename, ...args),
  }
})

const { jsonlAppender } = await import('../lib/jsonl.js')

const SLOW_IO_MS = 300
const dirs = []
function tempDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-shared-drained-' }).name
  dirs.push(dir)
  return dir
}

afterAll(() => {
  io.delayMs = 0
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 状态文件行数（不存在 → 0）。 */
function lineCount(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

test('#343 B 复现：慢 IO 下「固定等 flushMs + 余量」读不到内容，drained() 之后必已落盘', async () => {
  const file = join(tempDir(), 'audit.jsonl')
  const appender = jsonlAppender(file, { flushMs: 50, compactLines: 100000, logger: { warn() {} } })
  io.delayMs = SLOW_IO_MS

  appender.append({ id: 1 })

  // ── 改动前的写法：固定等 flushMs（50ms）+ 余量，赌防抖窗口到期就等于写完 ──
  await sleepFor('复刻改动前的固定等待（flushMs + 余量）：慢 IO 下必然早于真实落盘（对照证据）', 120)
  assert.equal(lineCount(file), 0, '慢 IO 下固定等待读不到内容（这就是 CI 上必红的形态）')

  // ── 修复后：等写链本身（与 IO 耗时无关） ──
  await appender.drained()
  assert.equal(lineCount(file), 1, 'drained() 之后：行必已真正落盘')

  io.delayMs = 0
  await appender.dispose()
})

test('#343 B：drained() 排空 compact 回调派生的写（回调内 append 也不丢）', async () => {
  const file = join(tempDir(), 'compact.jsonl')
  let compactCalls = 0
  const appender = jsonlAppender(file, {
    flushMs: 50,
    compactLines: 5,
    logger: { warn() {} },
    onCompact: () => {
      compactCalls += 1
      // 回调期间的写入竞争：drained 必须把这一行也排空
      appender.append({ derived: compactCalls })
    },
  })
  for (let i = 0; i < 6; i += 1) appender.append({ i })
  await appender.drained()

  assert.ok(compactCalls >= 1, 'compact 阈值回调已触发')
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).length
  assert.ok(lines >= 7, `回调派生的行也已落盘（got ${lines}）`)
  await appender.dispose()
})

test('#343 B：drained() 幂等，且 dispose() 之后依然可用（写链已结算时立即 resolve）', async () => {
  const file = join(tempDir(), 'idle.jsonl')
  const appender = jsonlAppender(file, { flushMs: 20, compactLines: 1000, logger: { warn() {} } })
  await appender.drained() // 无挂起工作：立即 resolve
  appender.append({ a: 1 })
  await appender.dispose()
  await Promise.all([appender.drained(), appender.drained()])
  assert.equal(lineCount(file), 1, 'dispose 冲刷的行已落盘')
  // 已静默 → 再次 drained 不应挂起
  await appender.drained()
})
