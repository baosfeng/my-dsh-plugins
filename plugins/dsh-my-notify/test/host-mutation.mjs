/**
 * Mutation-targeted tests for the dsh-my-notify host half.
 * Kills surviving mutants by covering untested branches: loopback variants,
 * isTopLevelAgent edge shapes, askNoteOf fallbacks, null exec/req and
 * trusted-host ports.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

const disposeAlls = []

afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
})

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

function boot(config, opts = {}) {
  // config 显式 undefined 时原样传给 apply（杀 config?.x 的 OptionalChaining 变异）
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
      if (name === 'sessionTitle') return opts.sessionTitle === false ? undefined : ctx.sessionTitle
      if (name === 'webRuntime')
        return opts.trustedHosts === undefined ? undefined : { trustedHosts: opts.trustedHosts }
      return undefined
    },
    sessionTitle:
      opts.sessionTitle === false
        ? undefined
        : {
            get(session) {
              if (opts.titleThrows) throw new Error('title lookup exploded')
              return session?.__title === undefined ? { title: '' } : { title: session.__title }
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

function noticesOf(res) {
  return res.written.filter((c) => c.includes('data: '))
}

// ── loopback 变体（杀 L66/L68/L70）───────────────────────────────────────

test('localhost and IPv6 loopback pass the fence', async () => {
  const { api } = boot({})
  for (const host of ['localhost:3080', '[::1]:3080']) {
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/notify/api/info', host, origin: `http://${host}` }), res)
    assert.equal(res.writeHeadStatus, 200, `${host} allowed`)
  }
})

test('dotted host variants are classified by the fence', async () => {
  const { api } = boot({})
  for (const host of ['127.100.0.1:3080']) {
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/notify/api/info', host, origin: `http://${host}` }), res)
    assert.equal(res.writeHeadStatus, 200, `${host} loopback allowed`)
  }
  for (const host of ['192.168.1.1:3080', '127.0.0.256:3080', '127.0.0.a:3080', '127.1.2.3.4:3080']) {
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/notify/api/info', host, origin: `http://${host}` }), res)
    assert.equal(res.writeHeadStatus, 403, `${host} refused`)
  }
})

// ── trustedHosts 带端口（杀 L74）─────────────────────────────────────────

test('trustedHosts entry with an explicit port is honored', async () => {
  const { api } = boot({}, { trustedHosts: ['notify.example.com:9443'] })
  const res = mockResponse()
  await invoke(
    api,
    mockRequest({
      url: '/notify/api/info',
      host: 'notify.example.com:9443',
      origin: 'http://notify.example.com:9443',
    }),
    res,
  )
  assert.equal(res.writeHeadStatus, 200, 'trusted host with port accepted')
})

// ── isTopLevelAgent 变体（杀 L114-117）───────────────────────────────────

test('agents without a session header are not notified', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  await dispatchEvent(listeners, 'agent/status', { agent: { id: 'no-session' }, status: 'idle' })
  assert.equal(noticesOf(res).length, 0, 'no session → not top-level')
})

test('delegationDepth of 0 is still top-level; negative depth is not notified', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  // depth 0 → top-level → notified
  await dispatchEvent(listeners, 'agent/status', {
    agent: { id: 'depth0', session: { header: { cwd: '/x', delegationDepth: 0 } } },
    status: 'idle',
  })
  assert.ok(noticesOf(res).length >= 1, 'delegationDepth 0 notified')
  // negative depth is not a number > 0 → still notified (only > 0 filters)
  await dispatchEvent(listeners, 'agent/status', {
    agent: { id: 'neg', session: { header: { cwd: '/x', delegationDepth: -1 } } },
    status: 'idle',
  })
  assert.ok(noticesOf(res).length >= 2, 'negative depth treated as top-level')
})

// ── askNoteOf 变体（杀 L148-152）─────────────────────────────────────────

test('ask with an empty questions array produces an empty note', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  await dispatchEvent(
    listeners,
    'tools/pre-execute',
    { name: 'ask_user_question', agent: topAgent('ask-empty'), arguments: { questions: [] } },
    async () => {},
  )
  const frame = res.written.join('')
  const notice = JSON.parse(frame.slice(frame.indexOf('data: ') + 6))
  assert.equal(notice.kind, 'ask')
  assert.equal(notice.note, '', 'empty questions → empty note')
})

test('ask with a null first question produces an empty note', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  await dispatchEvent(
    listeners,
    'tools/pre-execute',
    { name: 'ask_user_question', agent: topAgent('ask-null'), arguments: { questions: [null] } },
    async () => {},
  )
  const frame = res.written.join('')
  const notice = JSON.parse(frame.slice(frame.indexOf('data: ') + 6))
  assert.equal(notice.note, '', 'null first question → empty note')
})

test('ask with a non-string question produces an empty note', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  await dispatchEvent(
    listeners,
    'tools/pre-execute',
    {
      name: 'ask_user_question',
      agent: topAgent('ask-nonstring'),
      arguments: { questions: [{ question: 42 }] },
    },
    async () => {},
  )
  const frame = res.written.join('')
  const notice = JSON.parse(frame.slice(frame.indexOf('data: ') + 6))
  assert.equal(notice.note, '', 'non-string question → empty note')
})

test('ask with only a question (no header) falls back to the first line', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  await dispatchEvent(
    listeners,
    'tools/pre-execute',
    {
      name: 'ask_user_question',
      agent: topAgent('ask-q'),
      arguments: { questions: [{ question: '部署到生产？\n确认？' }] },
    },
    async () => {},
  )
  const frame = res.written.join('')
  const notice = JSON.parse(frame.slice(frame.indexOf('data: ') + 6))
  assert.equal(notice.note, '部署到生产？', 'first line of question used')
})

// ── exec/req null（杀 L224/L236）─────────────────────────────────────────

test('null exec passes through without notifying', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  let nextCalled = false
  await dispatchEvent(listeners, 'tools/pre-execute', null, async () => {
    nextCalled = true
  })
  assert.equal(nextCalled, true, 'next still called for null exec')
  assert.equal(noticesOf(res).length, 0, 'null exec not notified')
})

test('null req passes through without notifying', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  let nextCalled = false
  await dispatchEvent(listeners, 'approval/request', null, async () => {
    nextCalled = true
  })
  assert.equal(nextCalled, true, 'next still called for null req')
  assert.equal(noticesOf(res).length, 0, 'null req not notified')
})

// ── config 为 undefined：默认配置生效（杀 config?.x 的 OptionalChaining 变异）─

test('apply with an undefined config keeps every default', async () => {
  const { listeners, api } = boot(undefined)
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  // 默认全开：顶层 end 通知照常推送
  await dispatchEvent(listeners, 'agent/status', { agent: topAgent('def1'), status: 'idle' })
  const frame = res.written.join('')
  const notice = JSON.parse(frame.slice(frame.indexOf('data: ') + 6))
  assert.equal(notice.kind, 'end')
  assert.equal(notice.agentType, 'top')
  // 默认 subagentEnd 关闭：子代理不推送
  const before = res.written.length
  await dispatchEvent(listeners, 'agent/status', {
    agent: { id: 'def2', options: { subagentDepth: 1 }, session: { header: { cwd: '/x' } } },
    status: 'idle',
  })
  assert.equal(res.written.length, before, 'subagentEnd defaults to off')
  // info 反映默认开关
  const infoRes = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/info' }), infoRes)
  const info = JSON.parse(infoRes.written.join(''))
  assert.deepEqual(
    info.value,
    {
      end: true,
      ask: true,
      approval: true,
      subagentEnd: false,
      remoteEnabled: true,
      apiToken: false,
      dedupeMs: 3000,
      askMode: 'full',
      quietHours: { enabled: false, start: '23:00', end: '08:00' },
    },
    'defaults mirrored in info',
  )
})

// ── titleOf：非空 snapshot title 优先于 cwd（杀 L128）────────────────────

test('a non-empty session title beats the cwd fallback', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  await dispatchEvent(listeners, 'agent/status', {
    agent: { id: 'titled', session: { header: { cwd: '/work/alpha' }, __title: '我的会话' } },
    status: 'idle',
  })
  const frame = res.written.join('')
  const notice = JSON.parse(frame.slice(frame.indexOf('data: ') + 6))
  assert.equal(notice.title, '我的会话', 'snapshot title preferred')
})

// ── issue #26：五类子代理形态判定（白名单化 + 运行时深度兜底）────────────

test('five subagent shapes are all filtered (issue #26 whitelist)', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  const before = res.written.length
  const shapes = [
    // 1. header 缺 origin（delegationDepth 存在）
    { id: 'shape-1', session: { header: { cwd: '/x', delegationDepth: 2 } } },
    // 2. header 缺 delegationDepth（origin 存在）
    { id: 'shape-2', session: { header: { cwd: '/x', origin: 'subagent' } } },
    // 3. 两者皆缺（运行时 options.subagentDepth 兜底 —— 漏网形态）
    { id: 'shape-3', options: { subagentDepth: 1 }, session: { header: { cwd: '/x' } } },
    // 4. origin: 'subagent'
    { id: 'shape-4', session: { header: { cwd: '/x', origin: 'subagent', delegationDepth: 0 } } },
    // 5. delegationDepth > 0
    { id: 'shape-5', session: { header: { cwd: '/x', delegationDepth: 3 } } },
  ]
  for (const agent of shapes) {
    await dispatchEvent(listeners, 'agent/status', { agent, status: 'idle' })
  }
  assert.equal(res.written.length, before, 'no subagent shape may notify')
})

test('top-level end notice carries agentType top', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  await dispatchEvent(listeners, 'agent/status', { agent: topAgent('top1'), status: 'idle' })
  const frame = res.written.join('')
  const notice = JSON.parse(frame.slice(frame.indexOf('data: ') + 6))
  assert.equal(notice.kind, 'end')
  assert.equal(notice.agentType, 'top', 'top-level notice is marked top')
})

// ── issue #26：subagentEnd 开关 ─────────────────────────────────────────

test('subagentEnd defaults to off: subagent idle does not notify', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  const before = res.written.length
  await dispatchEvent(listeners, 'agent/status', {
    agent: { id: 'sub-off', options: { subagentDepth: 1 }, session: { header: { cwd: '/x' } } },
    status: 'idle',
  })
  assert.equal(res.written.length, before, 'subagent idle must not notify by default')
})

test('subagentEnd true notifies subagent end with a marked title', async () => {
  const { listeners, api } = boot({ subagentEnd: true })
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  await dispatchEvent(listeners, 'agent/status', {
    agent: {
      id: 'sub-x',
      options: { subagentDepth: 1 },
      session: { header: { cwd: '/work/sub' }, __title: '子任务' },
    },
    status: 'idle',
  })
  const frame = res.written.join('')
  const notice = JSON.parse(frame.slice(frame.indexOf('data: ') + 6))
  assert.equal(notice.kind, 'end')
  assert.equal(notice.agentType, 'subagent', 'subagent notice is marked subagent')
  assert.ok(notice.title.startsWith('子代理'), 'subagent title carries the marker')
  assert.ok(notice.title.includes('子任务'), 'subagent title carries the session title')
})

test('subagentEnd only affects end notices; ask/approval stay top-level only', async () => {
  const { listeners, api } = boot({ subagentEnd: true })
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  const before = res.written.length
  await dispatchEvent(
    listeners,
    'tools/pre-execute',
    {
      name: 'ask_user_question',
      agent: { id: 'sub-ask', options: { subagentDepth: 1 }, session: { header: { cwd: '/x' } } },
    },
    async () => {},
  )
  await dispatchEvent(
    listeners,
    'approval/request',
    { agent: { id: 'sub-ap', options: { subagentDepth: 1 }, session: { header: { cwd: '/x' } } } },
    async () => {},
  )
  assert.equal(res.written.length, before, 'subagent ask/approval never notify')
})

test('ask and approval notices carry agentType top', async () => {
  const { listeners, api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/stream' }), res)
  await dispatchEvent(
    listeners,
    'tools/pre-execute',
    {
      name: 'ask_user_question',
      agent: topAgent('ask-top'),
      arguments: { questions: [{ header: '确认' }] },
    },
    async () => {},
  )
  await dispatchEvent(listeners, 'approval/request', { agent: topAgent('ap-top'), toolName: 'bash' }, async () => {})
  const frames = res.written.filter((c) => c.includes('data: '))
  const notices = frames.map((f) => JSON.parse(f.slice(f.indexOf('data: ') + 6)))
  assert.equal(notices.length, 2, 'both notices emitted')
  assert.equal(notices[0].agentType, 'top', 'ask notice marked top')
  assert.equal(notices[1].agentType, 'top', 'approval notice marked top')
})
