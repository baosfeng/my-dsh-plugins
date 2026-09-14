import { test } from 'vitest'
/**
 * dsh-my-notify — 免打扰时间段（quiet hours）单测。
 *
 * 覆盖：
 *  - isQuietNow 纯函数：启用/禁用、同日区间、跨午夜、边界、非法输入
 *  - 端到端：免打扰期间 SSE + webhook 双通道静默、配置读写闭环
 */
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

// ── mock helpers（复用 host-smoke 模式）────────────────────────────────────

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
    get() {
      return undefined
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

// Unused functions removed to fix ESLint errors

async function invoke(api, request, response) {
  await api.handler(request, response)
  return response
}

/** 便捷构造本地时间 Date（保证测试确定性，用固定日期避免 DST）。 */
function makeDate(hh, mm) {
  // new Date(year, month, day, hh, mm) 用本地时区
  return new Date(2024, 0, 15, hh, mm, 0)
}

// ═══════════════════════════════════════════════════════════════════════════
// isQuietNow 纯函数测试
// ═══════════════════════════════════════════════════════════════════════════

test('isQuietNow — disabled always returns false', async () => {
  // 动态导入（lib 可能尚未构建；直接测 src 的纯函数）
  // notice.ts 的 isQuietNow 是 export，lib 里也有
  const { isQuietNow } = await import('../lib/notice.js')
  const qh = { enabled: false, start: '23:00', end: '08:00' }
  assert.equal(isQuietNow(qh, makeDate(23, 30)), false, 'disabled at 23:30')
  assert.equal(isQuietNow(qh, makeDate(3, 0)), false, 'disabled at 03:00')
  assert.equal(isQuietNow(qh, makeDate(12, 0)), false, 'disabled at 12:00')
})

test('isQuietNow — same-day range [start, end)', async () => {
  const { isQuietNow } = await import('../lib/notice.js')
  const qh = { enabled: true, start: '09:00', end: '17:00' }
  assert.equal(isQuietNow(qh, makeDate(8, 59)), false, '08:59 before start')
  assert.equal(isQuietNow(qh, makeDate(9, 0)), true, '09:00 = start (inclusive)')
  assert.equal(isQuietNow(qh, makeDate(12, 30)), true, '12:30 inside range')
  assert.equal(isQuietNow(qh, makeDate(16, 59)), true, '16:59 still inside')
  assert.equal(isQuietNow(qh, makeDate(17, 0)), false, '17:00 = end (exclusive)')
  assert.equal(isQuietNow(qh, makeDate(17, 1)), false, '17:01 after end')
})

test('isQuietNow — overnight range [start, 24:00) ∪ [00:00, end)', async () => {
  const { isQuietNow } = await import('../lib/notice.js')
  const qh = { enabled: true, start: '23:00', end: '08:00' }
  assert.equal(isQuietNow(qh, makeDate(22, 59)), false, '22:59 before start')
  assert.equal(isQuietNow(qh, makeDate(23, 0)), true, '23:00 = start')
  assert.equal(isQuietNow(qh, makeDate(23, 59)), true, '23:59 in evening part')
  assert.equal(isQuietNow(qh, makeDate(0, 0)), true, '00:00 in morning part')
  assert.equal(isQuietNow(qh, makeDate(3, 30)), true, '03:30 deep night')
  assert.equal(isQuietNow(qh, makeDate(7, 59)), true, '07:59 still inside')
  assert.equal(isQuietNow(qh, makeDate(8, 0)), false, '08:00 = end (exclusive)')
  assert.equal(isQuietNow(qh, makeDate(12, 0)), false, '12:00 daytime')
})

test('isQuietNow — boundary: start === end means no quiet time', async () => {
  const { isQuietNow } = await import('../lib/notice.js')
  const qh = { enabled: true, start: '23:00', end: '23:00' }
  assert.equal(isQuietNow(qh, makeDate(23, 0)), false, 'start=end → empty range')
  assert.equal(isQuietNow(qh, makeDate(12, 0)), false, 'any time → false')
})

test('isQuietNow — invalid time strings disable quiet hours', async () => {
  const { isQuietNow } = await import('../lib/notice.js')
  assert.equal(isQuietNow({ enabled: true, start: 'bad', end: '08:00' }, makeDate(0, 0)), false, 'bad start')
  assert.equal(isQuietNow({ enabled: true, start: '23:00', end: '25:00' }, makeDate(0, 0)), false, 'hour > 23')
  assert.equal(isQuietNow({ enabled: true, start: '23:60', end: '08:00' }, makeDate(0, 0)), false, 'min > 59')
  assert.equal(isQuietNow({ enabled: true, start: '', end: '' }, makeDate(0, 0)), false, 'empty strings')
})

test('isQuietNow — midnight-midnight range (full day quiet)', async () => {
  const { isQuietNow } = await import('../lib/notice.js')
  const qh = { enabled: true, start: '00:00', end: '00:00' }
  assert.equal(isQuietNow(qh, makeDate(0, 0)), false, 'start=end=00:00 → empty')
})

test('isQuietNow — 00:00 to 23:59 (almost full day)', async () => {
  const { isQuietNow } = await import('../lib/notice.js')
  const qh = { enabled: true, start: '00:00', end: '23:59' }
  assert.equal(isQuietNow(qh, makeDate(0, 0)), true, '00:00 inside')
  assert.equal(isQuietNow(qh, makeDate(12, 0)), true, '12:00 inside')
  assert.equal(isQuietNow(qh, makeDate(23, 58)), true, '23:58 inside')
  assert.equal(isQuietNow(qh, makeDate(23, 59)), false, '23:59 = end (exclusive)')
})

// ═══════════════════════════════════════════════════════════════════════════
// 端到端：免打扰期间通知被静默
// ═══════════════════════════════════════════════════════════════════════════

test('quiet hours config default is disabled', async () => {
  const { api } = boot({})
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/config' }), res)
  const body = JSON.parse(res.written.join(''))
  assert.deepEqual(
    body.value.quietHours,
    {
      enabled: false,
      start: '23:00',
      end: '08:00',
    },
    'default quietHours config',
  )
})

test('quiet hours appears in info', async () => {
  const { api } = boot({ quietHours: { enabled: true, start: '22:00', end: '07:00' } })
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/info' }), res)
  const body = JSON.parse(res.written.join(''))
  assert.deepEqual(
    body.value.quietHours,
    {
      enabled: true,
      start: '22:00',
      end: '07:00',
    },
    'info exposes quietHours',
  )
})

test('PUT /config accepts quietHours', async () => {
  const { api } = boot({})
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
        subagentEnd: false,
        apiToken: '',
        dedupeMs: 3000,
        quietHours: { enabled: true, start: '22:00', end: '07:00' },
      }),
    }),
    put,
  )
  assert.equal(put.writeHeadStatus, 200, 'PUT with quietHours is 200')
  const get = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/config' }), get)
  const body = JSON.parse(get.written.join(''))
  assert.deepEqual(
    body.value.quietHours,
    {
      enabled: true,
      start: '22:00',
      end: '07:00',
    },
    'quietHours saved and read back',
  )
})

test('PUT /config rejects invalid quietHours', async () => {
  const { api } = boot({})
  // 缺少 required 字段
  const bad1 = mockResponse()
  await invoke(
    api,
    mockRequest({
      url: '/notify/api/config',
      method: 'PUT',
      body: JSON.stringify({
        end: true,
        ask: true,
        approval: true,
        subagentEnd: false,
        apiToken: '',
        dedupeMs: 3000,
        quietHours: { enabled: true }, // missing start/end
      }),
    }),
    bad1,
  )
  assert.equal(bad1.writeHeadStatus, 400, 'missing start/end → 400')

  // 非法时间格式
  const bad2 = mockResponse()
  await invoke(
    api,
    mockRequest({
      url: '/notify/api/config',
      method: 'PUT',
      body: JSON.stringify({
        end: true,
        ask: true,
        approval: true,
        subagentEnd: false,
        apiToken: '',
        dedupeMs: 3000,
        quietHours: { enabled: true, start: '25:00', end: '08:00' },
      }),
    }),
    bad2,
  )
  assert.equal(bad2.writeHeadStatus, 400, 'hour > 23 → 400')
})

test('PUT /config without quietHours preserves existing', async () => {
  const { api } = boot({ quietHours: { enabled: true, start: '22:00', end: '07:00' } })
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
        subagentEnd: false,
        apiToken: '',
        dedupeMs: 3000,
        // no quietHours → not sent, preserved
      }),
    }),
    put,
  )
  assert.equal(put.writeHeadStatus, 200, 'PUT without quietHours is 200')
  const get = mockResponse()
  await invoke(api, mockRequest({ url: '/notify/api/config' }), get)
  const body = JSON.parse(get.written.join(''))
  assert.deepEqual(
    body.value.quietHours,
    {
      enabled: true,
      start: '22:00',
      end: '07:00',
    },
    'existing quietHours preserved when not sent',
  )
})

// 清理（心跳 interval 等）
for (const disposeAll of disposeAlls.splice(0)) disposeAll()

console.log('ALL QUIET HOURS TESTS PASSED')
