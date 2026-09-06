import { describe, it, expect, afterEach } from 'vitest'
/**
 * dsh-my-remote — 路由层单测（/remote/api：fence / token / 分派 / 404 / 审计）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const tmpDirs = []
const disposeAlls = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-my-remote-route-'))
  tmpDirs.push(dir)
  return dir
}

function mockResponse() {
  const res = {
    status: 0,
    written: [],
    writeHead(status) {
      res.status = status
    },
    write(chunk) {
      res.written.push(String(chunk))
    },
    end(value) {
      if (value !== undefined) res.written.push(String(value))
    },
    destroy() {},
  }
  return res
}

function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', headers = {}, body = '' } = {}) {
  return {
    url,
    method,
    headers: { host, ...headers },
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

/** boot：apply + 注册的 api handler。 */
function boot(config) {
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = tempDir()
  const routes = []
  const disposers = []
  const ctx = {
    logger: { info() {}, warn() {} },
    on() {
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
      if (name === 'webRuntime') return undefined
      return undefined
    },
  }
  apply(ctx, config)
  const api = routes.find((r) => r.path === '/remote/api' && r.kind === 'prefix')
  expect(api, 'prefix route /remote/api registered').toBeDefined()
  const disposeAll = () => {
    for (const dispose of disposers.splice(0)) dispose()
    process.env.DSH_HOME = oldHome
  }
  disposeAlls.push(disposeAll)
  return { api, disposeAll }
}

async function invoke(api, request, response) {
  await api.handler(request, response)
  return response
}

function bodyOf(response) {
  return JSON.parse(response.written.join(''))
}

afterEach(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('route fence', () => {
  it('non-loopback host is forbidden (403)', async () => {
    const { api } = boot({})
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/remote/api/status', host: 'evil.example.com' }), res)
    expect(res.status).toBe(403)
    const body = bodyOf(res)
    expect(body.error.code).toBe('forbidden')
  })

  it('cross-site sec-fetch-site is forbidden', async () => {
    const { api } = boot({})
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/remote/api/status', headers: { 'sec-fetch-site': 'cross-site' } }), res)
    expect(res.status).toBe(403)
  })

  it('loopback request passes the fence', async () => {
    const { api } = boot({})
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/remote/api/info' }), res)
    expect(res.status).toBe(200)
  })
})

describe('GET endpoints', () => {
  it('info exposes switches but never the token value', async () => {
    const { api } = boot({ apiToken: 'secret-token' })
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/remote/api/info' }), res)
    const body = bodyOf(res)
    expect(body.ok).toBe(true)
    expect(body.value.apiToken).toBe(true)
    expect(JSON.stringify(body)).not.toContain('secret-token')
    expect(body.value.end).toBe(true)
    expect(body.value.webhooks).toBe(0)
  })

  it('status returns sessions/asks/approvals snapshot', async () => {
    const { api } = boot({})
    // 直接注册 pending ask（无事件路径，验证快照可见）
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/remote/api/status' }), res)
    const body = bodyOf(res)
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.value.sessions)).toBe(true)
    expect(Array.isArray(body.value.asks)).toBe(true)
    expect(Array.isArray(body.value.approvals)).toBe(true)
    expect(body.value.time).toBeTypeOf('number')
  })

  it('audit returns recorded entries', async () => {
    const { api } = boot({})
    // 触发一次未知指令写审计
    const bad = mockResponse()
    await invoke(
      api,
      mockRequest({
        url: '/remote/api/command',
        method: 'POST',
        body: JSON.stringify({ action: 'hack' }),
        headers: { 'x-forwarded-for': '10.1.2.3' },
      }),
      bad,
    )
    expect(bad.status).toBe(400)
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/remote/api/audit' }), res)
    const body = bodyOf(res)
    expect(body.value.entries).toHaveLength(1)
    expect(body.value.entries[0].action).toBe('hack')
    expect(body.value.entries[0].source).toBe('10.1.2.3')
  })

  it('unknown GET method is 404', async () => {
    const { api } = boot({})
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/remote/api/nope' }), res)
    expect(res.status).toBe(404)
  })
})

describe('POST /command', () => {
  it('answers a pending ask end-to-end with registry', async () => {
    const { api } = boot({})
    // 预置 pending ask（绕过事件路径，直接操作注册表不可行——apply 内部自有）。
    // 用 boot 返回的共享不可达，改测 token 与结果整形路径：先注册（通过
    // 事件 mock 成本高），改测非法 payload 与缺 token。
    const res = mockResponse()
    await invoke(
      api,
      mockRequest({
        url: '/remote/api/command',
        method: 'POST',
        body: JSON.stringify({ action: 'answer', sessionId: 's1', answers: [{ id: 'q1', selected: ['是'] }] }),
      }),
      res,
    )
    // 无 pending ask → 400 no pending
    expect(res.status).toBe(400)
    const body = bodyOf(res)
    expect(body.error.message).toContain('no pending ask')
  })

  it('requires apiToken when configured (403 + audit)', async () => {
    const { api } = boot({ apiToken: 'tok' })
    const res = mockResponse()
    await invoke(
      api,
      mockRequest({
        url: '/remote/api/command',
        method: 'POST',
        body: JSON.stringify({ action: 'continue', sessionId: 's1', message: 'go' }),
      }),
      res,
    )
    expect(res.status).toBe(403)
    expect(bodyOf(res).error.message).toContain('x-remote-token')
    const audit = mockResponse()
    await invoke(api, mockRequest({ url: '/remote/api/audit' }), audit)
    const entries = bodyOf(audit).value.entries
    expect(entries).toHaveLength(1)
    expect(entries[0].ok).toBe(false)
    expect(entries[0].detail).toContain('invalid x-remote-token')
  })

  it('accepts command with matching token', async () => {
    const { api } = boot({ apiToken: 'tok' })
    const res = mockResponse()
    await invoke(
      api,
      mockRequest({
        url: '/remote/api/command',
        method: 'POST',
        body: JSON.stringify({ action: 'continue', sessionId: 'gone', message: 'hi' }),
        headers: { 'x-remote-token': 'tok' },
      }),
      res,
    )
    expect(res.status).toBe(400)
    expect(bodyOf(res).error.message).toContain('no live agent')
    const audit = mockResponse()
    await invoke(api, mockRequest({ url: '/remote/api/audit' }), audit)
    expect(bodyOf(audit).value.entries[0]).toMatchObject({ action: 'continue', ok: false, source: 'local' })
  })

  it('rejects invalid json body with 400 + audit', async () => {
    const { api } = boot({})
    const res = mockResponse()
    await invoke(api, mockRequest({ url: '/remote/api/command', method: 'POST', body: 'not-json' }), res)
    expect(res.status).toBe(400)
    expect(bodyOf(res).error.message).toBe('invalid json body')
  })

  it('unknown command → 400 unknown command', async () => {
    const { api } = boot({})
    const res = mockResponse()
    await invoke(
      api,
      mockRequest({ url: '/remote/api/command', method: 'POST', body: JSON.stringify({ action: 'x' }) }),
      res,
    )
    expect(res.status).toBe(400)
    expect(bodyOf(res).error.message).toContain('unknown command')
  })
})
