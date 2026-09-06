import { test } from 'vitest'
/**
 * dsh-task-reliability — 配置 API 单测（issue #27 配置可视化）。
 *
 * 验证设置页配置读写闭环：
 *  - GET  /task-reliability/api/config → 当前生效配置（含默认值）；
 *  - PUT  /task-reliability/api/config → 保存配置：写入 profile
 *    cordis.patch.yml（持久化）+ 更新 shared.options（立即生效）；
 *  - 保存后 options 立即生效（retryMax 影响重试上限）；
 *  - 持久化：保存到临时 profile → 重新 apply（模拟重启）→ 配置生效；
 *  - 非法输入 400；非本机来源 403。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { extractConfig, patchFileOf } from 'dsh-shared'

const tmpDirs = []
const disposeAlls = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-reliability-api-'))
  tmpDirs.push(dir)
  return dir
}

function mockResponse() {
  const res = {
    writeHeadStatus: 0,
    writeHeadHeaders: null,
    written: [],
    ended: false,
    destroyed: false,
    closeHandlers: [],
    writeHead(status, headers) {
      res.writeHeadStatus = status
      res.writeHeadHeaders = headers
    },
    write(chunk) {
      res.written.push(String(chunk))
      return true
    },
    end(value) {
      res.ended = true
      if (value !== undefined) res.written.push(String(value))
    },
    destroy() {
      res.destroyed = true
    },
    on(_event, handler) {
      if (_event === 'close') res.closeHandlers.push(handler)
    },
    removeListener() {},
    emitClose() {
      for (const h of res.closeHandlers.splice(0)) h()
    },
  }
  return res
}

function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', secFetchSite, origin, body = '' } = {}) {
  const headers = { host }
  if (secFetchSite !== undefined) headers['sec-fetch-site'] = secFetchSite
  if (origin !== undefined) headers.origin = origin
  return {
    url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

/** Boot the plugin with a mocked ctx; DSH_HOME points at dir (or a fresh temp dir). */
function boot(config, dir) {
  const home = dir ?? tempDir()
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const listeners = {}
  const routes = []
  const disposers = []
  const ctx = {
    logger: { warn() {} },
    on(name, handler) {
      ;(listeners[name] ??= []).push(handler)
      return () => {
        const list = listeners[name]
        if (list !== undefined) {
          const idx = list.indexOf(handler)
          if (idx !== -1) list.splice(idx, 1)
        }
      }
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
    get(name) {
      if (name === 'agents')
        return {
          get: () => undefined,
          create: async () => ({ agent: { id: 'v' }, dispose: async () => {} }),
          resume: async () => ({ agent: { id: 'm' }, dispose: async () => {} }),
        }
      if (name === 'sessionQuery') return { readSession: async () => ({ header: {}, events: [] }) }
      if (name === 'goals') return { get: () => undefined }
      if (name === 'approval') return { setPolicy: () => {} }
      if (name === 'webRuntime') return { trustedHosts: [] }
      return undefined
    },
  }
  apply(ctx, {
    saveDebounceMs: 0,
    resumeGraceMs: 60000,
    steerCooldownMs: 0,
    retryBaseMs: 0,
    ...config,
  })
  const api = routes.find((r) => r.path === '/task-reliability/api' && r.kind === 'prefix')
  assert.ok(api, 'prefix route /task-reliability/api registered')
  const disposeAll = () => {
    for (const dispose of disposers.splice(0)) dispose()
    process.env.DSH_HOME = oldHome
  }
  disposeAlls.push(disposeAll)
  return { ctx, listeners, api, home, disposeAll }
}

async function invoke(api, request, response) {
  await api.handler(request, response)
  return response
}

// boot() 传入测试友好默认值（saveDebounceMs/resumeGraceMs/steerCooldownMs/retryBaseMs 被覆盖）
const DEFAULTS = {
  apiToken: '',
  retryMax: 3,
  maxLoop: 8,
  maxVerify: 3,
  retryableCodes: [
    'TIMEOUT',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNABORTED',
    'STREAM_IDLE_TIMEOUT',
    'TRANSPORT',
    'NETWORK',
    'SERVER',
    'RATE_LIMIT',
    'EMPTY_RESPONSE',
  ],
  retryBaseMs: 0,
  autopilot: false,
  steerCooldownMs: 0,
  saveDebounceMs: 0,
  resumeGraceMs: 60000,
  rateMaxActions: 12,
  askTimeoutMs: 1800000,
  autopilotGraceMs: 20000,
  watchdogIntervalMs: 300000,
  stallTimeoutMs: 600000,
  rescueOnTruncation: true,
  rescueMaxPerSession: 2,
  rescueCooldownMs: 30000,
}

test('config API suite', async () => {
  try {
    // ── 1. GET /config 返回当前生效配置（默认值） ──────────────────────
    {
      const { api } = boot({})
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/task-reliability/api/config' }), res)
      assert.equal(res.writeHeadStatus, 200, 'GET config is 200')
      const body = JSON.parse(res.written.join(''))
      assert.deepEqual(body.value, DEFAULTS, 'defaults reported')
    }

    // ── 2. GET /config 反映应用层 config 覆盖 ──────────────────────────
    {
      const { api } = boot({ retryMax: 7, autopilot: true })
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/task-reliability/api/config' }), res)
      const body = JSON.parse(res.written.join(''))
      assert.equal(body.value.retryMax, 7, 'app-level retryMax reflected')
      assert.equal(body.value.autopilot, true, 'app-level autopilot reflected')
    }

    // ── 3. PUT /config 保存 → GET 读取 → 值正确 ────────────────────────
    {
      const { api } = boot({})
      const saved = {
        apiToken: 'tok-1',
        retryMax: 5,
        maxLoop: 10,
        maxVerify: 2,
        retryableCodes: ['TIMEOUT', 'SERVER'],
        retryBaseMs: 2000,
        autopilot: true,
        steerCooldownMs: 5000,
        saveDebounceMs: 300,
        resumeGraceMs: 1000,
        rateMaxActions: 20,
        askTimeoutMs: 900000,
        autopilotGraceMs: 15000,
        watchdogIntervalMs: 120000,
        stallTimeoutMs: 300000,
        rescueOnTruncation: true,
        rescueMaxPerSession: 2,
        rescueCooldownMs: 30000,
      }
      const put = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/task-reliability/api/config',
          method: 'PUT',
          body: JSON.stringify(saved),
        }),
        put,
      )
      assert.equal(put.writeHeadStatus, 200, 'PUT config is 200')
      const get = mockResponse()
      await invoke(api, mockRequest({ url: '/task-reliability/api/config' }), get)
      const body = JSON.parse(get.written.join(''))
      assert.deepEqual(body.value, saved, 'saved config read back')
    }

    // ── 4. 保存后 options 立即生效（retryMax 影响重试上限） ────────────
    {
      const { api, listeners } = boot({})
      const saved = {
        apiToken: '',
        retryMax: 1,
        maxLoop: 8,
        maxVerify: 3,
        retryableCodes: ['TIMEOUT'],
        retryBaseMs: 0,
        autopilot: false,
        steerCooldownMs: 0,
        saveDebounceMs: 0,
        resumeGraceMs: 60000,
        rateMaxActions: 12,
        askTimeoutMs: 1800000,
        autopilotGraceMs: 20000,
        watchdogIntervalMs: 300000,
        stallTimeoutMs: 600000,
        rescueOnTruncation: true,
        rescueMaxPerSession: 2,
        rescueCooldownMs: 30000,
      }
      const put = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/task-reliability/api/config',
          method: 'PUT',
          body: JSON.stringify(saved),
        }),
        put,
      )
      assert.equal(put.writeHeadStatus, 200, 'save ok')

      // retryMax:1 → 第一次超时重试，第二次超时委托 next()
      const agent = {
        id: 's1',
        options: { provider: 'p', model: 'm' },
        session: { header: { cwd: '/work' } },
      }
      let nextCalls = 0
      const next = async () => {
        nextCalls += 1
      }
      const first = await listeners['agent/request-error'][0]({ agent, failure: { code: 'TIMEOUT' } }, next)
      assert.deepEqual(first, { kind: 'retry' }, 'first timeout retried')
      const second = await listeners['agent/request-error'][0]({ agent, failure: { code: 'TIMEOUT' } }, next)
      assert.equal(second, undefined, 'second timeout past retryMax delegates to next')
      assert.equal(nextCalls, 1, 'next called once after cap')
    }

    // ── 5. 持久化：保存 → 模拟重启（重新 apply）→ 配置生效 ────────────
    {
      const { api, home, disposeAll } = boot({})
      const saved = {
        apiToken: 'persist-tok',
        retryMax: 9,
        maxLoop: 15,
        maxVerify: 5,
        retryableCodes: ['TIMEOUT', 'NETWORK'],
        retryBaseMs: 300,
        autopilot: true,
        steerCooldownMs: 4000,
        saveDebounceMs: 250,
        resumeGraceMs: 800,
        rateMaxActions: 25,
        askTimeoutMs: 600000,
        autopilotGraceMs: 30000,
        watchdogIntervalMs: 60000,
        stallTimeoutMs: 120000,
        rescueOnTruncation: true,
        rescueMaxPerSession: 2,
        rescueCooldownMs: 30000,
      }
      const put = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/task-reliability/api/config',
          method: 'PUT',
          body: JSON.stringify(saved),
        }),
        put,
      )
      assert.equal(put.writeHeadStatus, 200, 'save ok')
      const file = patchFileOf('web')
      const text = readFileSync(file, 'utf8')
      assert.deepEqual(extractConfig(text, 'task-reliability'), saved, 'patch file carries the saved config')
      disposeAll()

      // 模拟重启：同一 DSH_HOME 重新 apply，config 来自 patch 文件
      const oldHome = process.env.DSH_HOME
      process.env.DSH_HOME = home
      const persisted = extractConfig(readFileSync(patchFileOf('web'), 'utf8'), 'task-reliability')
      process.env.DSH_HOME = oldHome
      const { api: api2 } = boot(persisted, home)
      const get = mockResponse()
      await invoke(api2, mockRequest({ url: '/task-reliability/api/config' }), get)
      const body = JSON.parse(get.written.join(''))
      assert.deepEqual(body.value, saved, 'config survives restart')
    }

    // ── 6. PUT 非对象 → 400 ────────────────────────────────────────────
    {
      const { api } = boot({})
      const bad = mockResponse()
      await invoke(api, mockRequest({ url: '/task-reliability/api/config', method: 'PUT', body: 'null' }), bad)
      assert.equal(bad.writeHeadStatus, 400, 'non-object payload rejected')
      const get = mockResponse()
      await invoke(api, mockRequest({ url: '/task-reliability/api/config' }), get)
      const body = JSON.parse(get.written.join(''))
      assert.equal(body.value.retryMax, 3, 'invalid save leaves config untouched')
    }

    // ── 7. fence：非本机来源 403 ────────────────────────────────────────
    {
      const { api } = boot({})
      const evil = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/task-reliability/api/config',
          method: 'PUT',
          host: 'evil.example.com',
          body: '{}',
        }),
        evil,
      )
      assert.equal(evil.writeHeadStatus, 403, 'cross-authority host rejected')
    }

    // ── 8. 保存 rescueOnTruncation=false 后救场立即关闭（issue #147） ───
    {
      const { api, listeners } = boot({})
      const saved = {
        apiToken: '',
        retryMax: 3,
        maxLoop: 8,
        maxVerify: 3,
        retryableCodes: ['TIMEOUT'],
        retryBaseMs: 0,
        autopilot: false,
        steerCooldownMs: 0,
        saveDebounceMs: 0,
        resumeGraceMs: 60000,
        rateMaxActions: 12,
        askTimeoutMs: 1800000,
        autopilotGraceMs: 20000,
        watchdogIntervalMs: 300000,
        stallTimeoutMs: 600000,
        rescueOnTruncation: false,
        rescueMaxPerSession: 2,
        rescueCooldownMs: 30000,
      }
      const put = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/task-reliability/api/config',
          method: 'PUT',
          body: JSON.stringify(saved),
        }),
        put,
      )
      assert.equal(put.writeHeadStatus, 200, 'save ok')
      // 保存后立即生效：无任务 + 截断 + 输出不完整 → 不注入（救场已关闭）
      const agent = {
        id: 's1',
        options: { provider: 'p', model: 'm' },
        session: {
          header: { cwd: '/work' },
          events: [
            {
              type: 'assistant/message',
              data: { message: { content: [{ type: 'text', text: '```js\nconst x = 1' }] } },
            },
          ],
        },
        steered: [],
        steer(message) {
          this.steered.push(message)
        },
      }
      const wrapped = listeners['llm/stream'][0]({ sessionId: 's1' }, () =>
        (async function* () {
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        })(),
      )
      for await (const chunk of wrapped) {
        void chunk
      }
      await listeners['agent/turn-stopping'][0]({ agent, signal: { aborted: false } })
      assert.equal(agent.steered.length, 0, 'rescueOnTruncation=false 保存后救场关闭')
    }

    // 清理
    for (const disposeAll of disposeAlls.splice(0)) disposeAll()

    console.log('ALL CONFIG API TESTS PASSED')
  } catch (err) {
    console.error(err)
    for (const disposeAll of disposeAlls.splice(0)) disposeAll()
    throw err
  } finally {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  }
})
