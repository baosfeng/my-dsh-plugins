/**
 * store-persist 单元测试：格式解析/规整（含全局淘汰、桶形态兼容）、
 * 快照/追加的 io 错误降级。覆盖 store-persist.js 的加载与落盘分支。
 *
 * io 失败注入的环境无关性（覆盖边界，务必按此维护）：
 *  - **不要**用 `chmod 目录 0555` 作为唯一的失败注入手段：权限位在特权环境
 *    下不生效——root 具 CAP_DAC_OVERRIDE（CI 容器以 root 运行时工作目录在
 *    /root/workspace/...）、Windows 忽略 mode、部分容器/网络文件系统同理，
 *    写入照样成功 → 降级 warn 数为 0 → 断言假失败（真实事故：容器化 CI 报
 *    `snapshot/append failures logged (got 0)`，非 root runner 上通过）。
 *  - 主用例改用与权限位、运行用户完全无关的确定性 I/O 错误：目标路径本身
 *    是目录（snapshot 的 rename / append 的 appendFile → EISDIR）、父层级是
 *    常规文件（两者的 mkdir recursive → ENOTDIR）。POSIX 语义在 root 与非
 *    root 下一致，覆盖的仍是"落盘失败 → 只告警不抛出"这条逻辑。
 *  - 只读目录（真实 EACCES）场景单独保留一个用例，运行前先**动态探测**权限
 *    位是否被强制执行，特权环境显式 skip 并打印原因；非特权环境下该用例的
 *    断言与强度与修复前完全一致。
 *  - 覆盖边界结论：root 下"只读目录写失败"这条路径**无法**被覆盖（写入不
 *    失败），其同一段 catch/warn 代码由上述 EISDIR/ENOTDIR 用例覆盖；特权
 *    环境损失的是 EACCES 这一具体错误来源，不是降级逻辑本身。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeLoaded,
  parseJsonl,
  parseLegacy,
  loadPersisted,
  writeSnapshot,
  appendLines,
  jsonlFile,
  legacyFile,
} from '../lib/store-persist.js'
import { createTempHome, cleanupHome } from './lib/helpers.mjs'

const homes = []
function tempHome() {
  const home = createTempHome('dsh-obs-persist-')
  homes.push(home)
  return home
}
afterAll(() => {
  for (const home of homes.splice(0)) cleanupHome(home)
})

function ev(time, sessionId, type = 'agent_status') {
  return { id: time, time, sessionId, type, data: { status: `s${time}` } }
}

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

test('normalizeLoaded: 数组桶与对象桶兼容 + 非法事件过滤 + 每会话截断', () => {
  const bySession = {
    arr: [ev(1, 'arr'), ev(2, 'arr'), 'junk', { time: 'bad' }, null],
    obj: { events: [ev(3, 'obj')] },
    weird: { nope: true },
    many: Array.from({ length: 2100 }, (_, i) => ev(i, 'many')),
  }
  const state = normalizeLoaded(bySession)
  assert.equal(state.bySession.arr.events.length, 2, 'array bucket kept')
  assert.deepEqual(
    state.bySession.arr.events.map((e) => e.time),
    [1, 2],
    'invalid events filtered',
  )
  assert.equal(state.bySession.obj.events.length, 1, 'legacy object bucket compatible')
  assert.equal(state.bySession.weird, undefined, 'malformed bucket dropped')
  assert.equal(state.bySession.many.events.length, 2000, 'per-session cap applied on load')
  assert.equal(state.bySession.many.events[1999].time, 2099, 'newest kept')
})

test('normalizeLoaded: 全局超限按最早会话整桶淘汰', () => {
  const bySession = {}
  // 11 桶 × 2000 = 22000 > 20000：最旧的 bucket-0 应被整桶淘汰
  for (let s = 0; s < 11; s += 1) {
    bySession[`b${s}`] = Array.from({ length: 2000 }, (_, i) => ev(s * 2000 + i, `b${s}`))
  }
  const state = normalizeLoaded(bySession)
  let total = 0
  for (const bucket of Object.values(state.bySession)) total += bucket.events.length
  assert.equal(total, 20000, 'global cap enforced on load')
  assert.equal(state.bySession.b0, undefined, 'oldest session evicted')
  assert.equal(state.bySession.b10.events.length, 2000, 'newest session kept')
})

test('parseJsonl: 行计数与非法/空行跳过', () => {
  const text = `${JSON.stringify(ev(1, 'x'))}\nnot-json\n\n${JSON.stringify(ev(2, 'x'))}\n${JSON.stringify(ev(3, 'x'))}`
  const { bySession, lines } = parseJsonl(text)
  assert.equal(lines, 5, 'physical lines counted (incl. blank/truncated)')
  assert.equal(bySession.x.length, 3, 'valid rows kept in order')
  assert.deepEqual(
    bySession.x.map((e) => e.time),
    [1, 2, 3],
    'event order preserved',
  )
})

test('parseLegacy: 合法/坏 JSON/非法根结构', () => {
  const valid = parseLegacy(JSON.stringify({ version: 1, bySession: { s: { events: [ev(1, 's')] } } }))
  assert.equal(valid.bySession.s.events.length, 1, 'valid legacy parsed')
  assert.equal(parseLegacy('not json'), null, 'malformed text → null')
  assert.equal(parseLegacy(JSON.stringify({ foo: 1 })), null, 'invalid root → null')
  assert.equal(parseLegacy(JSON.stringify(null)), null, 'null root → null')
})

test('loadPersisted: jsonl 优先；缺 jsonl 时走 legacy 且标记迁移', async () => {
  const home = tempHome()
  const dir = join(home, 'observability')
  mkdirSync(dir, { recursive: true })
  // 同时存在 jsonl 与 legacy：jsonl 优先，不迁移
  writeFileSync(join(dir, 'audit.jsonl'), `${JSON.stringify(ev(1, 'p'))}\n`, 'utf8')
  writeFileSync(join(dir, 'audit.json'), JSON.stringify({ version: 1, bySession: { p: { events: [ev(9, 'p')] } } }))
  const both = await loadPersisted(join(dir, 'audit.jsonl'), join(dir, 'audit.json'))
  assert.equal(both.migrated, false, 'jsonl takes precedence')
  assert.equal(both.state.bySession.p.events.length, 1, 'jsonl content loaded')
  // 只有 legacy：迁移标记
  const legacyOnly = await loadPersisted(join(dir, 'missing.jsonl'), join(dir, 'audit.json'))
  assert.equal(legacyOnly.migrated, true, 'legacy-only marks migration')
  assert.equal(legacyOnly.state.bySession.p.events.length, 1, 'legacy events loaded')
  // 都缺失：空状态
  const empty = await loadPersisted(join(dir, 'nope.jsonl'), join(dir, 'nope.json'))
  assert.equal(empty.state.bySession['x'], undefined, 'missing files → empty state')
})

test('writeSnapshot: 空状态写空文件；有事件写 jsonl 行格式', async () => {
  const home = tempHome()
  const file = join(home, 'observability', 'audit.jsonl')
  await writeSnapshot(file, { version: 1, bySession: {} }, { warn() {} }, '[t]')
  assert.ok(existsSync(file), 'empty snapshot still creates file')
  assert.equal(readFileSync(file, 'utf8'), '', 'empty state → empty file')

  await writeSnapshot(
    file,
    { version: 1, bySession: { s: { events: [ev(1, 's'), ev(2, 's')] } } },
    { warn() {} },
    '[t]',
  )
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n').filter((l) => l !== '')
  assert.equal(lines.length, 2, 'one event per line')
  assert.equal(JSON.parse(lines[0]).time, 1, 'line is a raw event object')
})

test('persist io 错误降级：确定性 I/O 失败（EISDIR/ENOTDIR）均告警且不抛', async () => {
  const home = tempHome()
  const dir = join(home, 'observability')
  mkdirSync(dir, { recursive: true })
  const warns = []
  const logger = { warn: (msg) => warns.push(msg) }

  // 注入 1：目标路径本身是目录 → snapshot 的 rename、append 的 appendFile
  // 都返回 EISDIR（与权限位、运行用户无关；快照残留的 tmp 文件随 home 清理）
  const dirTarget = join(dir, 'audit.jsonl')
  mkdirSync(dirTarget, { recursive: true })
  await writeSnapshot(dirTarget, { version: 1, bySession: {} }, logger, '[t]')
  await appendLines(dirTarget, '{}\n', logger, '[t]')

  // 注入 2：父层级是常规文件 → 两者的 mkdir(recursive) 都返回 ENOTDIR
  const fileAsParent = join(home, 'observability-as-file')
  writeFileSync(fileAsParent, '', 'utf8')
  const nestedTarget = join(fileAsParent, 'observability', 'audit.jsonl')
  await writeSnapshot(nestedTarget, { version: 1, bySession: {} }, logger, '[t]')
  await appendLines(nestedTarget, '{}\n', logger, '[t]')

  assert.equal(warns.length, 4, `每次落盘失败都有告警（got ${warns.length}）`)
  assert.deepEqual(
    warns.map((msg) => msg.replace(/:.*/, '')),
    ['[t] snapshot failed', '[t] append failed', '[t] snapshot failed', '[t] append failed'],
    '告警带 prefix 且区分 snapshot/append 来源',
  )
})

test('persist io 错误降级：只读目录（EACCES）不致崩溃且告警「需权限位生效」', async (context) => {
  const home = tempHome()
  const dir = join(home, 'observability')
  mkdirSync(dir, { recursive: true })
  if (!permBitsEnforced(dir)) {
    const reason =
      '权限位未生效（root/CAP_DAC_OVERRIDE、Windows 或只读挂载类文件系统）：chmod 0555 后写入仍成功，无法注入 EACCES。' +
      '降级逻辑已由「确定性 I/O 失败（EISDIR/ENOTDIR）」用例覆盖，本用例仅在权限位被强制执行的普通用户环境具备判定力'
    console.log(`[skip] persist io 错误降级（只读目录）：${reason}`)
    context.skip(reason)
    return
  }
  const warns = []
  const logger = { warn: (msg) => warns.push(msg) }
  chmodSync(dir, 0o555)
  try {
    const file = join(dir, 'audit.jsonl')
    await writeSnapshot(file, { version: 1, bySession: {} }, logger, '[t]')
    await appendLines(file, '{}\n', logger, '[t]')
  } finally {
    chmodSync(dir, 0o755)
  }
  assert.ok(warns.length >= 2, `snapshot/append failures logged (got ${warns.length})`)
  assert.deepEqual(
    warns.map((msg) => msg.replace(/:.*/, '')),
    ['[t] snapshot failed', '[t] append failed'],
    'EACCES 场景告警同样带 prefix 且区分来源',
  )
})

test('jsonlFile/legacyFile 路径形态', () => {
  const jsonl = jsonlFile()
  const legacy = legacyFile()
  assert.ok(jsonl.endsWith('/observability/audit.jsonl'), 'jsonl path shape')
  assert.ok(legacy.endsWith('/observability/audit.json'), 'legacy path shape')
})
