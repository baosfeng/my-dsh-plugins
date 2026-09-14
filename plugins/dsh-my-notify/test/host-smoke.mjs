import { test } from 'vitest'
/**
 * Smoke test for the dsh-my-notify host half: mounts the plugin against a mocked
 * context and asserts
 *  - agent/status idle → 'end' notice broadcast (with subagent filtering and
 *    per-session dedupe),
 *  - tools/pre-execute (ask_user_question) → 'ask' notice + next() passthrough,
 *  - approval/request → 'approval' notice + next() passthrough,
 *  - config switches (end/ask/approval) gate the listeners,
 *  - SSE stream route: 200 event-stream, close cleans the client set,
 *  - POST /notify/api/trigger: loopback fence, apiToken gate, remote notice.
 *
 * The client half is browser-only; CI checks its syntax with `node --check`.
 */
import assert from 'node:assert/strict'
import { apply, inject } from '../lib/index.js'

// ── mock helpers ──────────────────────────────────────────────────────────
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

function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', secFetchSite, origin, token, body = '' } = {}) {
  const headers = { host }
  if (secFetchSite !== undefined) headers['sec-fetch-site'] = secFetchSite
  if (origin !== undefined) headers.origin = origin
  if (token !== undefined) headers['x-notify-token'] = token
  return {
    url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

/** Boot the plugin with a mocked ctx and a fake SSE subscriber. */
const disposeAlls = []
function boot(config) {
  const listeners = {}
  const routes = []
  const disposers = []
  const ctx = {
    logger: { warn() {} },
    on(name, handler) {
      ;(listeners[name] ??= []).push(handler)
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
  disposeAlls.push(() => {
    for (const dispose of disposers.splice(0)) dispose()
  })
  return { ctx, listeners, api }
}

const topAgent = (id, extra = {}) => ({
  id,
  session: { header: { cwd: '/work/alpha', ...extra }, __title: `标题-${id}` },
})

async function dispatchEvent(listeners, name, ...args) {
  for (const handler of [...(listeners[name] ?? [])]) {
    await handler(...args)
  }
}

async function invoke(api, request, response) {
  await api.handler(request, response)
  return response
}

test('host smoke suite', async () => {
  try {
    // ── 1. inject 只声明硬依赖 webServer ─────────────────────────────────
    assert.ok(Array.isArray(inject), 'inject is an array')
    assert.deepEqual(inject, ['webServer'], 'only webServer is a hard dependency')

    // ── 2. agent/status idle → 'end' ─────────────────────────────────────
    {
      const { listeners, api } = boot({})
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      assert.equal(res.writeHeadStatus, 200, 'SSE stream is 200')
      assert.equal(res.writeHeadHeaders['content-type'], 'text/event-stream', 'SSE content type')
      assert.ok(res.written.join('').includes('retry: 3000'), 'SSE sends retry hint')

      await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s1'), status: 'idle' })
      const frame = res.written.join('')
      assert.ok(frame.includes('data: '), 'notice frame written')
      const notice = JSON.parse(frame.slice(frame.indexOf('data: ') + 6))
      assert.equal(notice.type, 'notice')
      assert.equal(notice.kind, 'end')
      assert.equal(notice.sessionId, 's1')
      assert.equal(notice.title, '标题-s1', 'title comes from sessionTitle snapshot')
      assert.equal(notice.agentType, 'top', 'top-level notice is marked top')
      assert.equal(typeof notice.time, 'number')
    }

    // ── 3. 子代理过滤：subagent / delegationDepth / 运行时深度不通知 ────────
    {
      const { listeners, api } = boot({})
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      const before = res.written.length
      await dispatchEvent(listeners, 'agent/status', {
        agent: topAgent('sub1', { origin: 'subagent' }),
        status: 'idle',
      })
      await dispatchEvent(listeners, 'agent/status', {
        agent: topAgent('sub2', { delegationDepth: 2 }),
        status: 'idle',
      })
      // 漏网形态：header 无 origin/delegationDepth，但运行时 options.subagentDepth 兜底
      await dispatchEvent(listeners, 'agent/status', {
        agent: {
          id: 'sub3',
          options: { subagentDepth: 1 },
          session: { header: { cwd: '/work/alpha' }, __title: '标题-sub3' },
        },
        status: 'idle',
      })
      assert.equal(res.written.length, before, 'subagent idle must not notify')
      // top-level one does
      await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s2'), status: 'idle' })
      assert.ok(res.written.length > before, 'top-level idle notifies')
    }

    // ── 4. 去重：同 session 的 end 在窗口内只推一次 ─────────────────────
    {
      const { listeners, api } = boot({})
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      const before = res.written.length
      await dispatchEvent(listeners, 'agent/status', { agent: topAgent('dup'), status: 'idle' })
      await dispatchEvent(listeners, 'agent/status', { agent: topAgent('dup'), status: 'idle' })
      const frames = res.written.slice(before).filter((c) => c.includes('data: '))
      assert.equal(frames.length, 1, 'deduped within the window')
    }

    // ── 5. tools/pre-execute ask → 'ask' + next passthrough ───────────────
    {
      const { listeners, api } = boot({})
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      let nextCalled = false
      await dispatchEvent(
        listeners,
        'tools/pre-execute',
        {
          name: 'ask_user_question',
          agent: topAgent('ask1'),
          arguments: { questions: [{ header: '确认部署' }] },
        },
        async () => {
          nextCalled = true
        },
      )
      assert.equal(nextCalled, true, 'waterfall listener must call next()')
      const frame = res.written.join('')
      const notice = JSON.parse(frame.slice(frame.indexOf('data: ') + 6))
      assert.equal(notice.kind, 'ask')
      assert.equal(notice.sessionId, 'ask1')
      assert.equal(notice.note, '确认部署', 'note carries the ask header')

      // 其它工具不触发
      const before = res.written.length
      let nextCalled2 = false
      await dispatchEvent(listeners, 'tools/pre-execute', { name: 'bash', agent: topAgent('b1') }, async () => {
        nextCalled2 = true
      })
      assert.equal(nextCalled2, true, 'non-ask tools still pass through next()')
      assert.equal(res.written.length, before, 'non-ask tool does not notify')
    }

    // ── 6. approval/request → 'approval' + next passthrough ───────────────
    {
      const { listeners, api } = boot({})
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      let nextCalled = false
      await dispatchEvent(
        listeners,
        'approval/request',
        { agent: topAgent('ap1'), toolName: 'bash', reason: 'sandbox escalation' },
        async () => {
          nextCalled = true
        },
      )
      assert.equal(nextCalled, true, 'approval waterfall listener must call next()')
      const frame = res.written.join('')
      const notice = JSON.parse(frame.slice(frame.indexOf('data: ') + 6))
      assert.equal(notice.kind, 'approval')
      assert.equal(notice.sessionId, 'ap1')
      assert.equal(notice.toolName, 'bash')
      assert.equal(notice.note, 'sandbox escalation')
    }

    // ── 7. 配置开关 ───────────────────────────────────────────────────────
    {
      const { listeners, api } = boot({ end: false, ask: false, approval: false })
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      const before = res.written.length
      await dispatchEvent(listeners, 'agent/status', { agent: topAgent('off1'), status: 'idle' })
      await dispatchEvent(
        listeners,
        'tools/pre-execute',
        { name: 'ask_user_question', agent: topAgent('off2') },
        async () => {},
      )
      await dispatchEvent(listeners, 'approval/request', { agent: topAgent('off3'), toolName: 'bash' }, async () => {})
      assert.equal(res.written.length, before, 'disabled kinds must not notify')

      // info 反映开关
      const infoRes = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/info' }), infoRes)
      const info = JSON.parse(infoRes.written.join(''))
      assert.deepEqual(
        info.value,
        {
          end: false,
          ask: false,
          approval: false,
          subagentEnd: false,
          remoteEnabled: true,
          apiToken: false,
          dedupeMs: 3000,
          askMode: 'full',
          quietHours: { enabled: false, start: '23:00', end: '08:00' },
        },
        'info mirrors config',
      )
    }

    // ── 8. SSE close 清理集合，后续广播不再写它 ──────────────────────────
    {
      const { listeners, api } = boot({})
      const res = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
      res.emitClose()
      await dispatchEvent(listeners, 'agent/status', { agent: topAgent('gone'), status: 'idle' })
      assert.equal(
        res.written.filter((c) => c.includes('data: ')).length,
        0,
        'closed client receives no further notices',
      )
    }

    // ── 9. trigger 远程 hook ──────────────────────────────────────────────
    {
      const { api } = boot({})
      const stream = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), stream)

      // 本机 loopback（带 origin）放行
      const okRes = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/notify/api/trigger',
          method: 'POST',
          secFetchSite: 'same-origin',
          origin: 'http://127.0.0.1:3080',
        }),
        okRes,
      )
      assert.equal(okRes.writeHeadStatus, 200, 'loopback trigger accepted')
      const frame = stream.written.join('')
      const notice = JSON.parse(frame.slice(frame.indexOf('data: ') + 6))
      assert.equal(notice.kind, 'remote', 'trigger broadcasts kind remote')
      assert.equal(notice.title, '', 'and defaults are empty')

      // 非 loopback host 拒绝
      const evilRes = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/trigger', method: 'POST', host: 'evil.example.com' }), evilRes)
      assert.equal(evilRes.writeHeadStatus, 403, 'cross-authority host rejected')

      // cross-site 拒绝
      const crossRes = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/notify/api/trigger',
          method: 'POST',
          secFetchSite: 'cross-site',
          origin: 'http://evil.example.com',
        }),
        crossRes,
      )
      assert.equal(crossRes.writeHeadStatus, 403, 'cross-site rejected')

      // 带自定义标题/正文/会话
      const withBodyStream = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), withBodyStream)
      const custom = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/notify/api/trigger',
          method: 'POST',
          body: JSON.stringify({ title: 'CI 完成', body: '构建成功', sessionId: 'sess-9' }),
        }),
        custom,
      )
      assert.equal(custom.writeHeadStatus, 200, 'custom remote trigger accepted')
      const customFrame = withBodyStream.written.join('')
      const customNotice = JSON.parse(customFrame.slice(customFrame.indexOf('data: ') + 6))
      assert.equal(customNotice.kind, 'remote')
      assert.equal(customNotice.title, 'CI 完成')
      assert.equal(customNotice.note, '构建成功')
      assert.equal(customNotice.sessionId, 'sess-9')

      // 非法 JSON body → 400
      const badJson = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/trigger', method: 'POST', body: '{nope' }), badJson)
      assert.equal(badJson.writeHeadStatus, 400, 'invalid JSON body yields 400')
    }

    // ── 10. apiToken 门禁 ─────────────────────────────────────────────────
    {
      const { api } = boot({ apiToken: 'secret-token' })
      const noToken = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/trigger', method: 'POST' }), noToken)
      assert.equal(noToken.writeHeadStatus, 403, 'missing token rejected')

      const badToken = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/trigger', method: 'POST', token: 'wrong' }), badToken)
      assert.equal(badToken.writeHeadStatus, 403, 'wrong token rejected')

      const goodStream = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/stream' }), goodStream)
      const rightToken = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/trigger', method: 'POST', token: 'secret-token' }), rightToken)
      assert.equal(rightToken.writeHeadStatus, 200, 'correct token accepted')
      assert.ok(goodStream.written.join('').includes('data: '), 'triggered notice broadcast')
    }

    // ── 11. 配置 apiToken 在 info 中可见 ─────────────────────────────────
    {
      const { api } = boot({ apiToken: 'x' })
      const info = mockResponse()
      await invoke(api, mockRequest({ url: '/notify/api/info' }), info)
      const parsed = JSON.parse(info.written.join(''))
      assert.equal(parsed.value.apiToken, true, 'info exposes token hint (never the value)')
    }

    // 卸载所有 mock 实例（清理心跳 interval，保证测试进程可退出）。
    for (const disposeAll of disposeAlls.splice(0)) disposeAll()

    console.log('ALL HOST SMOKE TESTS PASSED')
  } catch (err) {
    console.error(err)
    // 断言失败也要清理心跳等（否则进程被 interval 挂住不退）。
    for (const disposeAll of disposeAlls.splice(0)) disposeAll()
    // 抛出而非 exitCode：vitest 与 node --test 都按异常判定失败
    throw err
  }
})
