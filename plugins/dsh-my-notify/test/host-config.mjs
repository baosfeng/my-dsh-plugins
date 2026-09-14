import { test } from 'vitest'
/**
 * dsh-my-notify — 配置 API 单测（issue #27 配置可视化）。
 *
 * 验证设置页配置读写闭环：
 *  - GET  /notify/api/config → 当前生效配置（含默认值）；
 *  - PUT  /notify/api/config → 保存配置：写入 profile cordis.patch.yml
 *    （持久化）+ 更新内存 options + 重新注册监听器（立即生效）；
 *  - 保存后监听器按新配置工作（end: false 不再推送 end 通知）；
 *  - 持久化：保存到临时 profile → 重新 apply（模拟重启）→ 配置生效；
 *  - 非法输入 400；非本机来源 403。
 */
import assert from 'node:assert/strict'
import { rmSync, readFileSync } from 'node:fs'
import { dirSync } from 'tmp'
import { apply } from '../lib/index.js'
import { extractConfig, patchFileOf } from 'dsh-shared'

const tmpDirs = []
const disposeAlls = []

function tempDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-my-notify-api-' }).name
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
      if (name === 'sessionTitle') return ctx.sessionTitle
      if (name === 'webRuntime') return undefined
      return undefined
    },
    sessionTitle: {
      get(session) {
        return session?.__title === undefined ? {} : { title: session.__title }
      },
    },
  }
  apply(ctx, config)
  const api = routes.find((r) => r.path === '/notify/api' && r.kind === 'prefix')
  assert.ok(api, 'prefix route /notify/api registered')
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

const topAgent = (id) => ({
  id,
  session: { header: { cwd: '/work/alpha' }, __title: `标题-${id}` },
})

async function dispatchEvent(listeners, name, ...args) {
  for (const handler of [...(listeners[name] ?? [])]) {
    await handler(...args)
  }
}

test('config API suite', async () => {
  try {
    // ── 1. GET /config 返回当前生效配置（默认值） ──────────────────────
    {
      const { api } = boot({})
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/config' }), res)
      assert.equal(res.writeHeadStatus, 200, 'GET config is 200')
      const body = JSON.parse(res.written.join(''))
      assert.deepEqual(
        body.value,
        {
          end: true,
          ask: true,
          approval: true,
          subagentEnd: false,
          apiToken: '',
          dedupeMs: 3000,
          askMode: 'full',
          webBaseUrl: '',
          webhooks: [],
          quietHours: { enabled: false, start: '23:00', end: '08:00' },
        },
        'defaults reported',
      )
    }

    // ── 2. GET /config 反映应用层 config 覆盖 ──────────────────────────
    {
      const { api } = boot({ end: false, dedupeMs: 5000 })
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/config' }), res)
      const body = JSON.parse(res.written.join(''))
      assert.deepEqual(
        body.value,
        {
          end: false,
          ask: true,
          approval: true,
          subagentEnd: false,
          apiToken: '',
          dedupeMs: 5000,
          askMode: 'full',
          webBaseUrl: '',
          webhooks: [],
          quietHours: { enabled: false, start: '23:00', end: '08:00' },
        },
        'app-level config reflected',
      )
    }

    // ── 3. PUT /config 保存 → GET 读取 → 值正确 ────────────────────────
    {
      const { api } = boot({})
      const put = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/notify/api/config',
          method: 'PUT',
          body: JSON.stringify({
            end: false,
            ask: true,
            approval: false,
            subagentEnd: true,
            apiToken: 'tok-1',
            dedupeMs: 7000,
          }),
        }),
        put,
      )
      assert.equal(put.writeHeadStatus, 200, 'PUT config is 200')
      const get = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/config' }), get)
      const body = JSON.parse(get.written.join(''))
      assert.deepEqual(
        body.value,
        {
          end: false,
          ask: true,
          approval: false,
          subagentEnd: true,
          apiToken: 'tok-1',
          dedupeMs: 7000,
          askMode: 'full',
          webBaseUrl: '',
          webhooks: [],
          quietHours: { enabled: false, start: '23:00', end: '08:00' },
        },
        'saved config read back',
      )
    }

    // ── 4. 保存后监听器立即按新配置工作（end: false 不再推送） ────────
    {
      const { api, listeners } = boot({})
      const stream = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), stream)
      await dispatchEvent(listeners, 'agent/status', { agent: topAgent('before'), status: 'idle' })
      assert.ok(stream.written.join('').includes('data: '), 'end notice before save')

      const put = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/notify/api/config',
          method: 'PUT',
          body: JSON.stringify({
            end: false,
            ask: true,
            approval: true,
            subagentEnd: false,
            apiToken: '',
            dedupeMs: 3000,
          }),
        }),
        put,
      )
      assert.equal(put.writeHeadStatus, 200, 'save ok')

      const before = stream.written.length
      await dispatchEvent(listeners, 'agent/status', { agent: topAgent('after'), status: 'idle' })
      assert.equal(stream.written.length, before, 'end listener removed after save with end:false')
    }

    // ── 5. 保存后 subagentEnd: true 立即生效 ───────────────────────────
    {
      const { api, listeners } = boot({})
      const stream = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), stream)
      const put = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/notify/api/config',
          method: 'PUT',
          body: JSON.stringify({
            end: true,
            ask: true,
            approval: true,
            subagentEnd: true,
            apiToken: '',
            dedupeMs: 3000,
          }),
        }),
        put,
      )
      const before = stream.written.length
      await dispatchEvent(listeners, 'agent/status', {
        agent: {
          id: 'sub1',
          session: { header: { cwd: '/work', origin: 'subagent' }, __title: '子' },
        },
        status: 'idle',
      })
      const frames = stream.written.slice(before).filter((c) => c.includes('data: '))
      assert.equal(frames.length, 1, 'subagent end notice after subagentEnd:true')
      const notice = JSON.parse(frames[0].slice(6))
      assert.equal(notice.agentType, 'subagent', 'marked as subagent')
    }

    // ── 6. 持久化：保存 → 模拟重启（重新 apply）→ 配置生效 ────────────
    {
      const { api, home, disposeAll } = boot({})
      const saved = {
        end: false,
        ask: true,
        approval: true,
        subagentEnd: true,
        apiToken: 'persist-tok',
        dedupeMs: 9000,
        askMode: 'full',
        webBaseUrl: '',
      }
      const put = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/config', method: 'PUT', body: JSON.stringify(saved) }), put)
      assert.equal(put.writeHeadStatus, 200, 'save ok')
      // patch 文件已写入（quietHours 展开为扁平字段，webhooks 单独 JSON 文件）
      const file = patchFileOf('web')
      const text = readFileSync(file, 'utf8')
      assert.deepEqual(
        extractConfig(text, 'notify'),
        {
          ...saved,
          quietHoursEnabled: false,
          quietHoursStart: '23:00',
          quietHoursEnd: '08:00',
        },
        'patch file carries the saved config (quietHours flattened)',
      )
      disposeAll()

      // 模拟重启：同一 DSH_HOME 重新 apply，config 来自 patch 文件
      const oldHome = process.env.DSH_HOME
      process.env.DSH_HOME = home
      const persisted = extractConfig(readFileSync(patchFileOf('web'), 'utf8'), 'notify')
      process.env.DSH_HOME = oldHome
      const { api: api2, listeners: listeners2 } = boot(persisted, home)
      const get = mockResponse()
      await invoke(api2, mockRequest({ url: '/notify/api/config' }), get)
      const body = JSON.parse(get.written.join(''))
      assert.deepEqual(
        body.value,
        {
          ...saved,
          webhooks: [],
          quietHours: { enabled: false, start: '23:00', end: '08:00' },
        },
        'config survives restart',
      )
      // 重启后监听器按持久化配置工作
      const stream = mockResponse()
      await invoke(api2, mockRequest({ url: '/notify/api/stream' }), stream)
      await dispatchEvent(listeners2, 'agent/status', { agent: topAgent('r1'), status: 'idle' })
      assert.ok(!stream.written.join('').includes('data: '), 'end:false honored after restart')
    }

    // ── 7. PUT 非法值 → 400 ────────────────────────────────────────────
    {
      const { api } = boot({})
      const bad = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/notify/api/config',
          method: 'PUT',
          body: JSON.stringify({ end: 'yes', dedupeMs: 'fast' }),
        }),
        bad,
      )
      assert.equal(bad.writeHeadStatus, 400, 'invalid types rejected')
      const get = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/config' }), get)
      const body = JSON.parse(get.written.join(''))
      assert.equal(body.value.end, true, 'invalid save leaves config untouched')
    }

    // ── 8. fence：非本机来源 403 ────────────────────────────────────────
    {
      const { api } = boot({})
      const evil = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/notify/api/config',
          method: 'PUT',
          host: 'evil.example.com',
          body: '{}',
        }),
        evil,
      )
      assert.equal(evil.writeHeadStatus, 403, 'cross-authority host rejected')
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
