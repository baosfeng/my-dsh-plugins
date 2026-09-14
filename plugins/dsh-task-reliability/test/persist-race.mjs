/**
 * persist-race.mjs — 「读盘先于异步落盘完成」的确定性复现与防回归（PR #233 后续）。
 *
 * 背景（main CI 失败 #34704278680 / #34705373605，job = test (dsh-task-reliability)）：
 * PR #233 把任务注册表写路径从同步 fs 改成异步（fs/promises + 写串行链）后，
 * 一批用「固定 sleep 等落盘，然后读文件断言」的测试出现时序窗口：
 *   - `taskOf` / `storeOf` helper（host-smoke.mjs:222-230）只 `await tick()`（10ms）；
 *   - host-command.mjs:426 只 `setTimeout(20)`。
 * 同步写时代「timer 触发即写完」，异步写变成「timer + 微任务 + I/O」，CI 高负载下
 * 10/20ms 不再够 —— 于是读到旧内容（`'done' !== 'active'`）或文件尚未创建（ENOENT）。
 *
 * 本文件**不靠多跑几次碰运气**：用 vi.mock 给 writeFile 注入 60ms 延迟，把
 * 「写还没完成」变成确定性事实，然后锁定修复契约：
 *   - `env.drainSaves()` 是**确定性就绪信号**：await 之后所有已 save 的变更
 *     （含还挂在防抖窗口里的）都已落盘 —— 读盘断言不再依赖墙钟；
 *   - 未 drain 就读盘会读到旧状态（characterization：这正是 CI 失败形态）；
 *   - drain 覆盖防抖窗口（saveDebounceMs=500 也能被显式刷掉）。
 */
import { test, afterAll, vi } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirSync } from 'tmp'
import { join } from 'node:path'

/** 注入慢 IO：writeFile 延迟 60ms（把 CI 负载下的时序窗口变成确定性事实）。 */
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    writeFile: async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 60))
      return actual.writeFile(...args)
    },
  }
})

import { apply } from '../lib/index.js'

const tmpDirs = []
const disposeAlls = []
afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))

function mockResponse() {
  const res = {
    writeHeadStatus: 0,
    written: [],
    ended: false,
    writeHead(status) {
      res.writeHeadStatus = status
    },
    write(chunk) {
      res.written.push(String(chunk))
      return true
    },
    end(value) {
      res.ended = true
      if (value !== undefined) res.written.push(String(value))
    },
  }
  return res
}

function mockRequest({ url, method = 'GET', body = '' } = {}) {
  return {
    url,
    method,
    headers: { host: '127.0.0.1:3080' },
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

/** 最小 boot：只装配 store/API/teardown（落盘时序测试不需要 agents 等服务）。 */
function boot(config = {}) {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-tr-race-' }).name
  tmpDirs.push(dir)
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const routes = []
  const disposers = []
  const ctx = {
    inject() {
      return { dispose() {} }
    },
    logger: { info() {}, warn() {} },
    on() {
      return () => {}
    },
    effect(fn) {
      const dispose = fn()
      assert.equal(typeof dispose, 'function', 'every ctx.effect must return a disposer')
      disposers.push(dispose)
      return dispose
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    get() {
      return undefined
    },
  }
  const shared = apply(ctx, {
    saveDebounceMs: 0,
    resumeGraceMs: 60000,
    steerCooldownMs: 0,
    retryBaseMs: 0,
    ...config,
  })
  const api = routes.find((r) => r.path === '/task-reliability/api' && r.kind === 'prefix')
  assert.ok(api, 'prefix route registered')
  const disposeAll = () => {
    for (const dispose of disposers.splice(0)) dispose()
    process.env.DSH_HOME = oldHome
  }
  disposeAlls.push(disposeAll)
  return { dir, api, store: shared.store, drainSaves: shared.drainSaves, disposeAll }
}

async function callApi(env, url, method = 'GET', body) {
  const response = mockResponse()
  await env.api.handler(mockRequest({ url, method, body: body === undefined ? '' : JSON.stringify(body) }), response)
  return { response, body: JSON.parse(response.written.join('') || 'null') }
}

function readState(env) {
  return JSON.parse(readFileSync(join(env.dir, 'task-reliability.json'), 'utf8'))
}

test('确定性就绪信号：慢 IO 下 await drainSaves() 后状态必在盘上', async () => {
  const env = boot()
  const { body } = await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-race',
    description: '开发一个功能',
  })
  assert.equal(body.ok, true)
  await env.drainSaves()
  const state = readState(env)
  assert.equal(state.tasks.length, 1, 'drain 后就绪：状态已落盘（不依赖墙钟）')
  assert.equal(state.tasks[0].id, body.value.id)
})

test('确定性复现：慢 IO 下未等落盘就读盘会读到旧状态（CI 的 done !== active 形态）', async () => {
  const env = boot()
  const { body } = await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-race',
    description: '开发一个功能',
  })
  const id = body.value.id
  await env.drainSaves()
  await callApi(env, `/task-reliability/api/tasks/${id}/done`, 'POST')
  await env.drainSaves()
  assert.equal(readState(env).tasks.find((task) => task.id === id).status, 'done', 'done 已落盘')

  await callApi(env, `/task-reliability/api/tasks/${id}/resume`, 'POST')
  // 未 drain：慢 IO 下盘上仍是 done —— 这就是 CI 里 host-smoke「任务状态流转」
  // 断言 'done' !== 'active' 的确定性等价形态。
  assert.equal(
    readState(env).tasks.find((task) => task.id === id).status,
    'done',
    '未等落盘 → 读到旧状态（固定 sleep 读盘不可靠的直接证据）',
  )
  await env.drainSaves()
  assert.equal(readState(env).tasks.find((task) => task.id === id).status, 'active', 'drain 后读到最新状态')
})

test('drain 覆盖防抖窗口：saveDebounceMs=500 时 drain 也会把挂起的写刷掉', async () => {
  const env = boot({ saveDebounceMs: 500 })
  await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-race',
    description: '开发一个功能',
  })
  assert.equal(existsSync(join(env.dir, 'task-reliability.json')), false, '防抖窗口内尚未写盘')
  await env.drainSaves()
  assert.equal(existsSync(join(env.dir, 'task-reliability.json')), true, 'drain 刷掉挂起的防抖写')
  assert.equal(readState(env).tasks.length, 1)
})

test('drain 幂等且可重复调用（无挂起写时立即就绪）', async () => {
  const env = boot()
  await callApi(env, '/task-reliability/api/tasks', 'POST', {
    sessionId: 'session-race',
    description: '开发一个功能',
  })
  await env.drainSaves()
  const started = Date.now()
  await env.drainSaves()
  assert.ok(Date.now() - started < 30, '无挂起写时 drain 立即返回（幂等，不引入固定等待）')
  await tick(10)
})
