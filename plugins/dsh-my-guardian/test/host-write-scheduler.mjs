/**
 * host-write-scheduler.mjs — dsh-my-guardian 落盘接入 dsh-shared 写入原语（issue #198 收尾）。
 *
 * 缺陷形态（src/state.ts 原实现）：
 *  - `createPersister` 自写 `shared.writeChain` 串行链：**每次 persistSoon 立即排一次写**
 *    （无防抖/无最小间隔）→ 一次挂载操作链（mount.ts 里 5 处 persistSoon）会触发多次
 *    全量快照写，写放大 = 变更次数 × 状态大小；
 *  - `persistState` 自写 tmp+rename：**无字节上限**（状态随 staged/promoted 条目增长），
 *    也没有护栏计数（写放大/巨型状态不可观测）；
 *  - `writeStagedFile` 用 `JSON.stringify(entries, null, 2)` **pretty 落盘**（体积放大）。
 *
 * 本文件先 RED 后 GREEN 锁定接入 `createWriteScheduler` + `atomicWriteJson` 后的契约
 * （断言口径不含墙钟时间：用 `atomicWriteStats()` 计数与文件内容判定）。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { atomicWriteStats } from 'dsh-shared'
import { createPersister, createState, writeStagedFile } from '../lib/state.js'

const homes = []
const oldHome = process.env.DSH_HOME
afterAll(() => {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function useHome() {
  const home = dirSync({ unsafeCleanup: true, prefix: 'guardian-sched-' }).name
  homes.push(home)
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'guardian'), { recursive: true })
  return home
}

function makeShared() {
  return {
    state: createState(),
    disposed: false,
    writeChain: Promise.resolve(),
    persistSoon() {},
    persistFinal() {},
    flushPersist: async () => {},
  }
}

const stateFile = (home) => join(home, 'guardian', 'state.json')

test('写放大：连续多次 persistSoon 合并为一次落盘（旧实现每次变更写一次）', async () => {
  const home = useHome()
  const shared = makeShared()
  const persister = createPersister(shared, { warn() {} })
  shared.state.safeMode = true
  const before = atomicWriteStats().writes
  persister.persistSoon()
  persister.persistSoon()
  persister.persistSoon()
  await persister.flush()
  assert.equal(
    atomicWriteStats().writes - before,
    1,
    '3 次变更合并为 1 次写（前后对比：旧实现 3 次；createWriteScheduler 防抖 + 最小间隔）',
  )
  assert.equal(JSON.parse(readFileSync(stateFile(home), 'utf8')).safeMode, true, '最终状态已落盘')
})

test('字节上限：超过上限的状态被护栏拦下（保留上一份完好状态、不静默）', async () => {
  const home = useHome()
  const shared = makeShared()
  const warned = []
  const persister = createPersister(shared, { warn: (message) => warned.push(String(message)) })
  shared.state.safeMode = false
  persister.persistSoon()
  await persister.flush()
  const good = readFileSync(stateFile(home), 'utf8')
  // 5MB > 显式上限（4MB）：状态随 staged/promoted 条目无界增长的兜底护栏
  shared.state.staged.huge = {
    name: 'huge',
    attempts: 0,
    lastError: null,
    config: { blob: 'x'.repeat(5 * 1024 * 1024) },
  }
  persister.persistSoon()
  await persister.flush()
  assert.equal(readFileSync(stateFile(home), 'utf8'), good, '超限写入被拒 → 文件保持上一份完好状态')
  assert.ok(
    warned.some((message) => message.includes('guardian')),
    '护栏拦截有 warn（不静默丢状态）',
  )
})

test('候选文件：紧凑 JSON（消除 pretty 缩进放大，仍可 JSON.parse 读回）', async () => {
  const home = useHome()
  const file = join(home, 'guardian', 'cordis.staged.json')
  const entries = [
    { name: 'a', config: { x: 1 } },
    { name: 'b', config: { y: 2 } },
  ]
  const error = await writeStagedFile(file, entries)
  assert.equal(error, null, '写入无错误')
  const text = readFileSync(file, 'utf8')
  assert.equal(text.trim(), JSON.stringify(entries), '紧凑 JSON：与 JSON.stringify(entries) 逐字节相等')
})
