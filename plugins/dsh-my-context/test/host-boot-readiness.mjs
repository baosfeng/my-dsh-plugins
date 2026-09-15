/**
 * dsh-my-context 启动就绪的确定性测试（issue #335：同族第 5 例）。
 *
 * 背景：CI 首跑在 `test/host-mutation.mjs:345` 红 —— 该用例靠 `await settle(80)`
 * （固定墙钟）赌 `createStore()` 的异步 `readFile` 已完成，CI 容器高负载下 80ms
 * 内回调没轮到，`store.session('s-1')` 仍是 undefined。前 4 例（#310/#313/#317）
 * 的范式是「实现侧补 whenReady + 测试侧条件轮询」，而本插件**没有**加载就绪信号：
 * 现有的 `store.whenPersisted()` 名字像信号，实际只 drain **写链**，加载未完成时
 * 它立即 resolve（此时变更还在 `pending` 里，根本没进 state）。
 *
 * 本文件用「注入受控慢 IO」把竞态变成 100% 可复现（不靠造负载，判据见
 * docs/踩坑/固定sleep等异步落盘导致CI-flaky.md）：
 *  - 挂起 `readFile` → 确定性地构造「加载慢于事件到达/查询」；
 *  - 断言对象是**可等待的信号**（whenReady / whenPersisted），与机器快慢无关。
 *
 * 修复前的失败形态（本机 100% 稳定，见 PR 证据）：
 *  - `TypeError: store.whenReady is not a function`
 *  - `whenPersisted()` 在加载未完成时提前 resolve → 落盘断言假通过/文件不存在
 */
import { test, afterAll, vi } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { waitForFile } from './lib/helpers.mjs'

/** 受控 IO 闸门：enabled 时 readFile 挂起，直到 releaseAll()。 */
const io = vi.hoisted(() => ({ enabled: false, waiters: [] }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    readFile: async (...args) => {
      if (io.enabled) await new Promise((resolve) => io.waiters.push(resolve))
      return actual.readFile(...args)
    },
  }
})

/** 打开闸门（后续 readFile 全部挂起）。 */
function holdIo() {
  io.enabled = true
}

/** 放行全部挂起的 readFile 并关闭闸门。 */
function releaseIo() {
  io.enabled = false
  for (const resolve of io.waiters.splice(0)) resolve()
}

const tmpDirs = []
afterAll(() => {
  releaseIo()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempHome(prefix) {
  const home = dirSync({ unsafeCleanup: true, prefix }).name
  tmpDirs.push(home)
  return home
}

/** 建 store（临时 DSH_HOME + mock ctx）。 */
async function makeStore(home) {
  process.env.DSH_HOME = home
  const { createStore } = await import('../lib/store.js')
  return createStore({ logger: { warn() {} } })
}

test('#335 复现 A：加载被挂起时 store.session() 必未就绪，whenReady() 之后必有值（零墙钟）', async () => {
  const home = tempHome('dsh-context-ready-')
  holdIo()
  const store = await makeStore(home)
  try {
    store.recordRequest('s-1', { turn: 1, step: 1, usage: { inputTokens: 42 } })
    // 此刻加载必然未完成（readFile 被闸门挂起）——这正是 CI 上 settle(80) 赌输的窗口
    assert.equal(store.session('s-1'), undefined, '加载未完成 → 查询必未就绪（竞态窗口存在）')

    const ready = store.whenReady()
    assert.equal(typeof ready?.then, 'function', 'store.whenReady() 必须返回可等待的就绪信号')

    let settled = false
    void ready.then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20)) // sleep-ok: 负向观察窗——断言「就绪信号此刻仍未 resolve」，没有正向条件可等
    assert.equal(settled, false, '就绪信号在加载完成前不得 resolve（否则等于又一个 sleep）')

    releaseIo()
    await ready
    // 零墙钟：不 await 任何固定时长，whenReady() 之后查询必须已就绪
    const session = store.session('s-1')
    assert.equal(session?.usage.inputTokens, 42, 'whenReady() 之后 buffered 变更必已回放')
    store.dispose()
  } finally {
    releaseIo()
  }
})

test('#335 复现 B：host-mutation.mjs:345 的「settle(80) 赌加载」在慢 IO 下必红，whenReady 必绿', async () => {
  const home = tempHome('dsh-context-slowio-')
  mkdirSync(join(home, 'context'), { recursive: true })
  writeFileSync(join(home, 'context', 'context.json'), JSON.stringify({ version: 1, bySession: {} }), 'utf8')
  holdIo()
  const store = await makeStore(home)
  try {
    // 复刻 host-mutation.mjs『persist: mutations before load are buffered and replayed』：
    // 立即写入（加载完成前），随后查询 s-1
    store.recordRequest('s-1', { turn: 1, step: 1, usage: { inputTokens: 42 } })
    const started = Date.now()
    // 受控慢 IO：加载比任何固定 sleep(80) 都晚 —— CI 高负载下 readFile 回调晚到就是这种形态
    const releaseTimer = setTimeout(() => releaseIo(), 300) // sleep-ok: 人为延时构造「慢 IO」，不是在等异步副作用
    await store.whenReady()
    const elapsed = Date.now() - started
    clearTimeout(releaseTimer)
    assert.ok(elapsed >= 250, `whenReady() 必须等到加载真正完成（等了 ${elapsed}ms，任何固定 sleep 都会赌输）`)
    const session = store.session('s-1')
    assert.equal(session?.usage.inputTokens, 42, 'whenReady() 之后查询必就绪（与 IO 耗时无关）')
    store.dispose()
  } finally {
    releaseIo()
  }
})

test('#335 复现 C：whenPersisted() 名副其实——加载未完成时调用，返回后变更必已落盘', async () => {
  const home = tempHome('dsh-context-whenpersisted-')
  const file = join(home, 'context', 'context.json')
  holdIo()
  const store = await makeStore(home)
  try {
    store.recordRequest('s-1', { turn: 1, step: 1, usage: { inputTokens: 7 } })
    const persisted = store.whenPersisted()
    // 修复前：drain() 只 drain 写链，加载未完成时立即 resolve → 变更仍卡在 pending，磁盘上没有
    releaseIo()
    await persisted
    assert.equal(existsSync(file), true, 'whenPersisted() 返回后状态文件必须已存在')
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(onDisk.bySession['s-1']?.usage.inputTokens, 7, 'whenPersisted() 返回后变更必已落盘')
    store.dispose()
  } finally {
    releaseIo()
  }
})

test('#335 复现 E：只读实例的 teardown 不得用空快照覆盖别处已写入的数据（数据丢失级）', async () => {
  const home = tempHome('dsh-context-multi-instance-')
  const file = join(home, 'context', 'context.json')
  mkdirSync(join(home, 'context'), { recursive: true })
  // 实例 A：产生变更并落盘
  const storeA = await makeStore(home)
  storeA.recordRequest('s-a', { turn: 1, step: 1, usage: { inputTokens: 5 } })
  await storeA.dispose()
  assert.notEqual(JSON.parse(readFileSync(file, 'utf8')).bySession['s-a'], undefined, '实例 A 已落盘')

  // 实例 B：只读启动（从未产生任何变更），teardown 时不得写出空快照
  // 修复前：scheduler.flush() 的契约是「无变更也写一次」→ 空 bySession 覆盖掉 s-a（数据丢失）
  const storeB = await makeStore(home)
  await storeB.dispose()
  const onDisk = JSON.parse(readFileSync(file, 'utf8'))
  assert.notEqual(onDisk.bySession['s-a'], undefined, '只读实例 teardown 不得覆盖别处写入的会话')
  assert.equal(storeB.state.bySession.size, 1, '实例 B 也已加载到磁盘状态（不是空启动）')
})

test('#335 复现 D：加载被挂起时 dispose() 不得用「缺磁盘历史」的快照覆盖磁盘', async () => {
  const home = tempHome('dsh-context-dispose-')
  const file = join(home, 'context', 'context.json')
  mkdirSync(join(home, 'context'), { recursive: true })
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      bySession: {
        'old-s': {
          sessionId: 'old-s',
          usage: { inputTokens: 9, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
          requests: [],
          alerts: [],
          updatedAt: 1,
        },
      },
    }),
    'utf8',
  )
  holdIo()
  const store = await makeStore(home)
  try {
    store.recordRequest('new-s', { turn: 1, step: 1, usage: { inputTokens: 1 } })
    store.dispose() // 加载尚未完成时 teardown（真实进程随后退出，防抖写不再发生）
    releaseIo()
    // 等「本实例写出的快照」出现：修复前它是不含磁盘历史的那一份
    // （统一工具 waitForFile：文件不存在/读取失败 → 继续轮询，超时报出等的是什么条件）
    await waitForFile(file, (text) => text.includes('new-s'), { message: '等待 teardown 落盘新变更' })
    const settled = JSON.parse(readFileSync(file, 'utf8'))
    assert.notEqual(settled.bySession['old-s'], undefined, 'teardown 落盘必须保留磁盘历史（不得被空历史快照覆盖）')
    assert.notEqual(settled.bySession['new-s'], undefined, 'teardown 落盘必须包含缓冲的新变更')
  } finally {
    releaseIo()
  }
})
