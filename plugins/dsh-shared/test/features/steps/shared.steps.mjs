/**
 * Step definitions for dsh-shared Gherkin acceptance tests.
 * 直接调用 lib/fence.js 与 lib/http.js 的导出（纯函数，无运行时依赖）。
 */
import { Given, When, Then, After } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTrustedApiRequest } from '../../../lib/fence.js'
import { readJsonBody, writeJson, writeError } from '../../../lib/http.js'
import { atomicWriteJson, atomicWriteStats } from '../../../lib/persist.js'
import { boundedMap } from '../../../lib/bounded.js'
import { createWriteScheduler } from '../../../lib/scheduler.js'

const world = {
  tmpDir: null,
  warns: [],
  lastWrite: null,
  throttledBefore: 0,
  map: null,
  scheduler: null,
  writes: 0,
  request: null,
  trustedHosts: [],
  body: null,
  response: null,
}

function mockResponse() {
  const res = {
    writeHeadStatus: 0,
    writeHeadHeaders: null,
    written: [],
    ended: false,
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
  }
  return res
}

Given('请求 host 为 {string}', function (host) {
  world.request = { headers: { host } }
})

Given('请求 host 为 {string} 且无受信权威', function (host) {
  world.request = { headers: { host } }
  world.trustedHosts = []
})

Given('请求 host 为 {string} 且受信权威含 {string}', function (host, trusted) {
  world.request = { headers: { host } }
  world.trustedHosts = [trusted]
})

Given('请求 host 为 {string} 且 sec-fetch-site 为 {string}', function (host, site) {
  world.request = { headers: { host, 'sec-fetch-site': site } }
})

Given('请求 host 为 {string} 且 origin 为 {string}', function (host, origin) {
  world.request = { headers: { host, origin } }
})

Then('信任围栏判定为可信', function () {
  assert.equal(isTrustedApiRequest(world.request, world.trustedHosts), true)
})

Then('信任围栏判定为不可信', function () {
  assert.equal(isTrustedApiRequest(world.request, world.trustedHosts), false)
})

Given('请求体为 {string}', function (text) {
  world.body = {
    async *[Symbol.asyncIterator]() {
      yield text
    },
  }
})

When('读取 JSON 请求体', async function () {
  world.body = await readJsonBody(world.body)
})

Then('得到对象 {string}', function (expected) {
  assert.deepEqual(world.body, JSON.parse(expected))
})

When('写入 JSON 响应 状态码 {int} 值 {string}', function (status, value) {
  world.response = mockResponse()
  writeJson(world.response, status, JSON.parse(value))
})

Then('响应状态码为 {int} 且内容为 {string}', function (status, expected) {
  assert.equal(world.response.writeHeadStatus, status)
  assert.equal(world.response.written.join(''), expected)
})

When('写入错误响应 消息 {string}', function (message) {
  world.response = mockResponse()
  writeError(world.response, new Error(message))
})

Then('响应状态码为 {int} 且内容含错误消息 {string}', function (status, message) {
  assert.equal(world.response.writeHeadStatus, status)
  const payload = JSON.parse(world.response.written.join(''))
  assert.equal(payload.ok, false)
  assert.equal(payload.error.message, message)
})

// ── issue #198：资源护栏原语 ───────────────────────────────────────────────

/** 临时目录（场景用完即删）。 */
function tempDir() {
  if (world.tmpDir === null) world.tmpDir = mkdtempSync(join(tmpdir(), 'dsh-shared-feature-'))
  return world.tmpDir
}

After(function () {
  if (world.tmpDir !== null) {
    rmSync(world.tmpDir, { recursive: true, force: true })
    world.tmpDir = null
  }
  world.warns = []
  world.lastWrite = null
  world.map = null
  world.scheduler = null
  world.writes = 0
})

Given('已成功写入一次快照', async function () {
  const file = join(tempDir(), 'state.json')
  world.warns = []
  world.throttledBefore = atomicWriteStats().throttled
  world.lastWrite = await atomicWriteJson(file, { v: 1 }, { warn: (m) => world.warns.push(m) }, '[feature]')
  assert.equal(world.lastWrite, true)
})

When('在默认节流窗口内再写一次', async function () {
  world.lastWrite = await atomicWriteJson(
    join(tempDir(), 'state.json'),
    { v: 2 },
    { warn: (m) => world.warns.push(m) },
    '[feature]',
  )
})

Then('写入被拒绝且产生告警', function () {
  assert.equal(world.lastWrite, false, '默认节流窗口内第二次写必须被拒')
  assert.ok(
    world.warns.some((m) => m.includes('throttled')),
    '拦截必须 warn，不静默',
  )
})

Then('护栏节流计数递增 {int}', function (delta) {
  assert.equal(atomicWriteStats().throttled - world.throttledBefore, delta)
})

Given('一个有界字典上限为 {int}', function (maxSize) {
  world.map = boundedMap({ maxSize })
})

When('依次写入 {string}、{string}，访问 {string}，再写入 {string}', function (a, b, touch, c) {
  world.map.set(a, 1)
  world.map.set(b, 2)
  world.map.get(touch)
  world.map.set(c, 3)
})

Then('有界字典保留 {string} 与 {string}', function (a, b) {
  assert.equal(world.map.has(a), true)
  assert.equal(world.map.has(b), true)
  assert.equal(world.map.size, 2)
})

Then('有界字典淘汰计数为 {int}', function (evicted) {
  assert.equal(world.map.evicted, evicted)
})

Given('一个写入调度器 防抖窗口 {int}ms', function (debounceMs) {
  world.writes = 0
  world.scheduler = createWriteScheduler({
    debounceMs,
    minIntervalMs: 0,
    write: () => {
      world.writes += 1
    },
  })
})

When('连续调度 {int} 次变更并 drain', async function (times) {
  for (let i = 0; i < times; i += 1) world.scheduler.schedule()
  await world.scheduler.drain()
})

Then('实际写盘次数为 {int}', function (expected) {
  assert.equal(world.writes, expected, 'drain 后写入已完成（无需 sleep 猜窗口）')
})
