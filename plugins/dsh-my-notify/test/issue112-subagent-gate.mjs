import { test } from 'vitest'
/**
 * dsh-my-notify — issue #112 回归测试：子代理完成通知受全局开关控制。
 *
 * 验证根因修复：
 *  - 方案 A：`isTopLevelAgent` 补齐 `header.parentSession` 派生父会话标记，
 *    把 workflow/ralph worker / fork 等「有父会话但漏写 origin/delegationDepth/
 *    subagentDepth」的形态识别为子代理，避免误判为顶层绕过开关；
 *  - 方案 B：`emitNotice` 出口统一过滤——`agentType: 'subagent'` 帧仅在
 *    `subagentEnd` 开启时广播，SSE（本地通知）与 webhook（出站）双通道一致。
 *
 * 覆盖断言（两条通道 + 开关两态）：
 *  - `subagentEnd: false` 时误判形态子代理完成不推送本地 SSE 也不推送 webhook；
 *  - `subagentEnd: true` 时同一子代理正常推送且带 `agentType: 'subagent'` 标记；
 *  - 顶层完成在 `subagentEnd: false` 时仍照常推送（SSE + webhook），不误伤；
 *  - `options.subagentDepth` 形态在关闭时同样被过滤（双通道）。
 */
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { dirSync } from 'tmp'
import { apply } from '../lib/index.js'

const tmpDirs = []
const disposeAlls = []

function tempDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-my-notify-issue112-' }).name
  tmpDirs.push(dir)
  return dir
}

function mockResponse() {
  const res = {
    writeHeadStatus: 0,
    written: [],
    closeHandlers: [],
    writeHead(status) {
      res.writeHeadStatus = status
    },
    write(chunk) {
      res.written.push(String(chunk))
      return true
    },
    end(value) {
      if (value !== undefined) res.written.push(String(value))
    },
    destroy() {},
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

function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', body = '' } = {}) {
  return {
    url,
    method,
    headers: { host },
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

/** Boot the plugin with a mocked ctx; DSH_HOME points at a temp dir. */
function boot(config) {
  const home = tempDir()
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
  return { ctx, listeners, api, disposeAll }
}

async function invoke(api, request, response) {
  await api.handler(request, response)
  return response
}

async function dispatchEvent(listeners, name, ...args) {
  for (const handler of [...(listeners[name] ?? [])]) {
    await handler(...args)
  }
}

/** 等待异步 webhook 推送完成（fire-and-forget 成功路径）。 */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

/** 覆盖 global fetch 的 mock（记录调用，返回固定响应）。 */
function installFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return handler(url, options)
  }
  return { calls, restore: () => (globalThis.fetch = original) }
}

/** 返回 SSE 流里所有 `data: ` 帧解析后的 notice 数组。 */
function noticesOf(res) {
  return res.written.filter((c) => c.includes('data: ')).map((c) => JSON.parse(c.slice(c.indexOf('data: ') + 6)))
}

const topAgent = (id, extra = {}) => ({
  id,
  session: { header: { cwd: '/work/alpha', ...extra }, __title: `标题-${id}` },
})

// 误判形态：有父会话（派生）但漏写 origin/delegationDepth/subagentDepth。
// 修复前 `isTopLevelAgent` 会把它当顶层，绕过 subagentEnd 双通道推送（issue #112）。
const misjudgedSubagent = {
  id: 'worker-1',
  options: {},
  session: { header: { cwd: '/work/sub', parentSession: 'parent-x' }, __title: '子任务' },
}

// 运行时深度兜底形态（DSH 官方 subagent 服务设置 options.subagentDepth）。
const runtimeDepthSubagent = {
  id: 'worker-2',
  options: { subagentDepth: 1 },
  session: { header: { cwd: '/work/sub' }, __title: '子任务2' },
}

const endWebhook = {
  name: '通用',
  channel: 'generic',
  url: 'https://relay.example.com/hook',
  events: ['end'],
  enabled: true,
}

test('issue #112 subagent gate suite', async () => {
  try {
    // ── 1. subagentEnd 关闭：误判形态子代理 → 本地 SSE 与 webhook 都不推 ──
    {
      const { listeners, api } = boot({ webhooks: [endWebhook] })
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      const mock = installFetch(() => ({ ok: true }))
      try {
        await dispatchEvent(listeners, 'agent/status', { agent: misjudgedSubagent, status: 'idle' })
        await flush()
        assert.equal(noticesOf(res).length, 0, 'SSE: misjudged-form subagent must not notify (subagentEnd off)')
        assert.equal(mock.calls.length, 0, 'webhook: misjudged-form subagent must not be pushed (subagentEnd off)')
      } finally {
        mock.restore()
      }
    }

    // ── 2. subagentEnd 关闭：运行时深度形态 → 双通道都不推 ──────────────
    {
      const { listeners, api } = boot({ webhooks: [endWebhook] })
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      const mock = installFetch(() => ({ ok: true }))
      try {
        await dispatchEvent(listeners, 'agent/status', { agent: runtimeDepthSubagent, status: 'idle' })
        await flush()
        assert.equal(noticesOf(res).length, 0, 'SSE: runtime-depth subagent must not notify (subagentEnd off)')
        assert.equal(mock.calls.length, 0, 'webhook: runtime-depth subagent must not be pushed (subagentEnd off)')
      } finally {
        mock.restore()
      }
    }

    // ── 3. subagentEnd 关闭：顶层完成仍照常推送（SSE + webhook） ────────
    {
      const { listeners, api } = boot({ webhooks: [endWebhook] })
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      const mock = installFetch(() => ({ ok: true }))
      try {
        await dispatchEvent(listeners, 'agent/status', { agent: topAgent('top-1'), status: 'idle' })
        await flush()
        const notices = noticesOf(res)
        assert.equal(notices.length, 1, 'SSE: top-level still notifies')
        assert.equal(notices[0].agentType, 'top', 'top-level notice marked top')
        assert.equal(mock.calls.length, 1, 'webhook: top-level still pushed')
        const body = JSON.parse(mock.calls[0].options.body)
        assert.equal(body.kind, 'end')
        assert.equal(body.agentType, 'top', 'webhook frame carries agentType top')
      } finally {
        mock.restore()
      }
    }

    // ── 4. subagentEnd 开启：误判形态子代理 → SSE + webhook 都推送，带子代理标记 ──
    {
      const { listeners, api } = boot({ subagentEnd: true, webhooks: [endWebhook] })
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      const mock = installFetch(() => ({ ok: true }))
      try {
        await dispatchEvent(listeners, 'agent/status', { agent: misjudgedSubagent, status: 'idle' })
        await flush()
        const notices = noticesOf(res)
        assert.equal(notices.length, 1, 'SSE: misjudged-form subagent notifies when subagentEnd on')
        assert.equal(notices[0].kind, 'end')
        assert.equal(notices[0].sessionId, 'worker-1')
        assert.equal(notices[0].agentType, 'subagent', 'subagent notice marked subagent')
        assert.ok(notices[0].title.startsWith('子代理'), 'subagent notice title carries the marker')
        assert.equal(mock.calls.length, 1, 'webhook: misjudged-form subagent pushed when subagentEnd on')
        const body = JSON.parse(mock.calls[0].options.body)
        assert.equal(body.agentType, 'subagent', 'webhook frame carries agentType subagent')
      } finally {
        mock.restore()
      }
    }

    // ── 5. subagentEnd 开启：运行时深度形态 → 推送到 webhook ────────────
    {
      const { listeners, api } = boot({ subagentEnd: true, webhooks: [endWebhook] })
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      const mock = installFetch(() => ({ ok: true }))
      try {
        await dispatchEvent(listeners, 'agent/status', { agent: runtimeDepthSubagent, status: 'idle' })
        await flush()
        assert.equal(noticesOf(res).length, 1, 'SSE: runtime-depth subagent notifies when subagentEnd on')
        assert.equal(mock.calls.length, 1, 'webhook: runtime-depth subagent pushed when subagentEnd on')
      } finally {
        mock.restore()
      }
    }

    // ── 6. subagentEnd 只影响 end 通知；ask 仍只推顶层 ───────────────────
    {
      const { listeners, api } = boot({ subagentEnd: true, webhooks: [endWebhook] })
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      const mock = installFetch(() => ({ ok: true }))
      try {
        await dispatchEvent(
          listeners,
          'tools/pre-execute',
          {
            name: 'ask_user_question',
            agent: misjudgedSubagent,
            arguments: { questions: [{ header: '确认' }] },
          },
          async () => {},
        )
        await flush()
        assert.equal(noticesOf(res).length, 0, 'subagent ask never notifies, even when subagentEnd on')
        assert.equal(mock.calls.length, 0, 'subagent ask not pushed to webhook')
      } finally {
        mock.restore()
      }
    }

    // 清理（释放心跳 interval，保证进程可退出）。
    for (const disposeAll of disposeAlls.splice(0)) disposeAll()

    console.log('ALL ISSUE #112 SUBAGENT GATE TESTS PASSED')
  } catch (err) {
    console.error(err)
    for (const disposeAll of disposeAlls.splice(0)) disposeAll()
    throw err
  } finally {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  }
})
