/**
 * A 簇复现测试（issue #343）：`dsh-file-activity` 缺确定性就绪信号。
 *
 * ## 复现手法（不是靠 CI 撞运气）
 *
 * 用 `vi.mock('node:fs/promises')` 把 `readFile` 变成**受控慢 IO**（默认 300ms），
 * 「异步状态加载未完成」这个窗口就从"本地总是太快看不到"变成**必然命中**：
 *
 *   · 改动前的写法（固定等 60ms 再查询）在这个窗口内必然读到空 state → **必红**；
 *   · `await store.whenReady()` 则在「磁盘状态已合并 + 加载期间缓冲的记录已回放」之后
 *     resolve → 与 IO 耗时无关 → **必绿**。
 *
 * 每个用例的第一段（固定等待读不到）就是"改动前必红"的确定性证据，第二段是修复后的证明；
 * 改动前 `apply()` 不返回 store（更无 `whenReady`）→ 全部用例抛
 * `store.whenReady is not a function`，4/4 红。
 */
import { test, afterAll, afterEach, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import tmp from 'tmp'
import { sleepFor, yieldLoop } from '../../dsh-shared/test-kit/wait.mjs'

/** 受控 IO 闸门（vi.hoisted：mock 工厂与用例共享的可变状态）。 */
const io = vi.hoisted(() => ({ delayMs: 0 }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    readFile: async (...args) => {
      if (io.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, io.delayMs))
      return actual.readFile(...args)
    },
  }
})

const { apply } = await import('../lib/index.js')

const SLOW_IO_MS = 300
const rootDir = tmp.dirSync({ prefix: 'dfa-boot-readiness-root-', unsafeCleanup: true }).name
let home = rootDir

/** 每个用例一份全新的 $DSH_HOME（状态文件互不干扰，失败也不泄漏给下一个用例）。 */
beforeEach(() => {
  home = tmp.dirSync({ prefix: 'dfa-boot-readiness-', unsafeCleanup: true }).name
  process.env.DSH_HOME = home
})

afterEach(() => {
  io.delayMs = 0
  process.env.DSH_HOME = rootDir
  rmSync(home, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

/** 最小 ctx（webServer.register 捕获 /file-activity/api 路由，供端到端查询）。 */
function makeCtx() {
  const holder = { route: undefined }
  const ctx = {
    logger: { warn: () => {} },
    webRuntime: { trustedHosts: [] },
    sessions: { get: () => undefined },
    webServer: {
      register: (route) => {
        // apply 同时注册 /file-activity/api 与 /file-activity/file：只捕获前者
        if (String(route.path).startsWith('/file-activity/api')) holder.route = route
        return () => {}
      },
    },
    events: [],
    on(name, listener) {
      this.events.push({ name, listener })
    },
    effect(callback) {
      callback()
      return () => {}
    },
  }
  return { ctx, getRoute: () => holder.route }
}

function makeRequest(method, url) {
  return {
    method,
    url,
    headers: {
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:3080',
    },
    [Symbol.asyncIterator]() {
      return { next: () => Promise.resolve({ done: true }) }
    },
  }
}

function makeResponse() {
  return {
    _status: 0,
    _body: '',
    writeHead(status) {
      this._status = status
    },
    end(body) {
      this._body = body ?? ''
    },
  }
}

async function getStats(getRoute, sessionId) {
  const res = makeResponse()
  await getRoute().handler(makeRequest('GET', `/file-activity/api/stats?sessionId=${sessionId}`), res)
  assert.equal(res._status, 200, `stats 查询必须 200，实际 ${res._status}：${res._body}`)
  return JSON.parse(res._body)
}

function emitObserved(ctx, toolName, sessionId, path) {
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  listener(
    { displayPath: path },
    { kind: 'present' },
    {
      name: toolName,
      agent: { id: sessionId },
      arguments: { file_path: path },
    },
  )
}

/** 磁盘历史：旧版整文件快照格式 `{version:1,sessions}`（read 计数 3）。 */
function seedStateFile(file) {
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      sessions: {
        's-history': {
          known: { '/work/history.txt': { op: 'read', time: 1 } },
          counts: { '/work/history.txt': { read: 3, create: 0, modify: 0, firstSeen: 1, lastSeen: 1 } },
          recent: [],
        },
      },
    }),
  )
}

test('#343 A 复现：慢 IO 下「固定等 60ms 再查询」必读到空，whenReady() 之后必有值', async () => {
  seedStateFile(join(home, 'file-activity.json'))
  io.delayMs = SLOW_IO_MS

  const { ctx, getRoute } = makeCtx()
  const store = apply(ctx)
  emitObserved(ctx, 'read', 's-history', '/work/history.txt')

  // ── 改动前的写法：固定等 60ms 赌「readFile 回调已跑完」 ──
  await sleepFor('复刻改动前的固定等待写法：慢 IO 下必然早于状态加载完成（对照证据）', 60)
  const early = await getStats(getRoute, 's-history')
  assert.equal(
    early.value.counts['/work/history.txt'],
    undefined,
    '慢 IO 下固定等 60ms 读不到磁盘历史（这就是 CI 上必红的形态）',
  )

  // ── 修复后：确定性就绪信号，与 IO 耗时无关 ──
  await store.whenReady()
  const after = await getStats(getRoute, 's-history')
  assert.equal(after.value.counts['/work/history.txt'].read, 4, 'whenReady() 之后：磁盘历史 3 + 缓冲记录 1 必已合并')
})

test('#343 A 复现：whenReady() 兑现之前不得假装就绪（信号有实际含义，不是立即 resolve）', async () => {
  seedStateFile(join(home, 'file-activity.json'))
  io.delayMs = SLOW_IO_MS

  const { ctx } = makeCtx()
  const store = apply(ctx)
  let settled = false
  void store.whenReady().then(() => {
    settled = true
  })
  await yieldLoop()
  assert.equal(settled, false, '加载未完成时 whenReady() 不得已 resolve')
  assert.deepEqual(store.state.sessions, {}, '未就绪时 state 尚未含磁盘历史')

  await store.whenReady()
  assert.equal(settled, true, '加载完成后 whenReady() 已 resolve')
  assert.equal(store.state.sessions['s-history'].counts['/work/history.txt'].read, 3, '磁盘历史已合并进 state')
})

test('#343 A 复现：加载期间到达的记录（pending）在 whenReady() 之后必已回放', async () => {
  io.delayMs = SLOW_IO_MS

  const { ctx, getRoute } = makeCtx()
  const store = apply(ctx)
  // 加载未完成（readFile 仍在 300ms 闸门后）时记录 → 进 pending 缓冲
  emitObserved(ctx, 'write', 's-buffered', '/work/buffered.txt')
  emitObserved(ctx, 'write', 's-buffered', '/work/buffered.txt')

  await store.whenReady()
  const stats = await getStats(getRoute, 's-buffered')
  assert.equal(stats.value.counts['/work/buffered.txt'].create, 1, '缓冲的 create 已回放')
  assert.equal(stats.value.counts['/work/buffered.txt'].modify, 1, '缓冲的 modify 已回放')
})

test('#343 A：纯加载（无缓冲记录）时 whenReady() 依然兑现且幂等', async () => {
  seedStateFile(join(home, 'file-activity.json'))
  io.delayMs = SLOW_IO_MS

  const { ctx } = makeCtx()
  const store = apply(ctx)
  await Promise.all([store.whenReady(), store.whenReady(), store.whenReady()])
  assert.equal(store.state.sessions['s-history']?.counts?.['/work/history.txt']?.read, 3, '磁盘历史已合并')
})
