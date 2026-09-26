/**
 * dsh-md-render — 配置 API 单测（/md/api，host half）。
 *
 * 验证设置页配置读写闭环（覆盖门禁对象 lib/index.js + lib/routes.js）：
 *  - buildOptions：保留的三个开关默认开启；显式 false 关闭；非法值回退默认；
 *  - GET  /md/api/config → 当前生效开关；
 *  - PUT  /md/api/config → 保存：写入 profile cordis.patch.yml（持久化）+ 更新内存；
 *  - 非法输入 400；非本机来源 403；未知方法 404。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { dirSync } from 'tmp'
import { apply, buildOptions } from '../lib/index.js'
import { extractConfig, patchFileOf } from 'dsh-shared'

const SWITCHES = ['copyButton', 'textFenceMarkdown', 'contextMarkdown']
const tmpDirs = []

function tempDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-md-render-api-' }).name
  tmpDirs.push(dir)
  return dir
}

// 进程非正常终止时 temp 目录会残留（tmp-hygiene 门禁）：显式配对清理。
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

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

/** 启动插件（假 ctx，DSH_HOME 指向临时 profile 目录）。 */
function boot(config, dir) {
  const home = dir ?? tempDir()
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const routes = []
  const disposers = []
  const logs = []
  const ctx = {
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
    },
    get() {
      return undefined
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    webServer: {
      register(registration) {
        routes.push(registration)
        return () => {
          const i = routes.indexOf(registration)
          if (i !== -1) routes.splice(i, 1)
        }
      },
    },
  }
  apply(ctx, config ?? {})
  assert.equal(routes.length, 1, 'one /md/api prefix registration')
  assert.equal(routes[0].kind, 'prefix', 'prefix routing')
  assert.equal(routes[0].path, '/md/api', 'route prefix path')
  return {
    registration: routes[0],
    logs,
    restore() {
      for (const dispose of disposers.splice(0)) dispose()
      if (oldHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = oldHome
    },
  }
}

async function call(registration, request) {
  const response = mockResponse()
  await registration.handler(request, response)
  const payload = response.written.join('')
  let body
  try {
    body = JSON.parse(payload)
  } catch {
    body = payload
  }
  return { status: response.writeHeadStatus, body }
}

test('buildOptions：保留的三个开关默认开启', () => {
  const options = buildOptions(undefined)
  assert.deepEqual(Object.keys(options).sort(), [...SWITCHES].sort(), '只有三个开关')
  for (const key of SWITCHES) assert.equal(options[key], true, key + ' 默认开启')
})

test('buildOptions：显式 false 关闭、非布尔值回退默认', () => {
  const options = buildOptions({ copyButton: false, textFenceMarkdown: 'nope', contextMarkdown: true })
  assert.equal(options.copyButton, false, 'copyButton off')
  assert.equal(options.contextMarkdown, true, 'contextMarkdown on')
  assert.equal(options.textFenceMarkdown, true, 'non-boolean falls back to default on')
})

test('GET /md/api/config 返回当前生效开关', async () => {
  const booted = boot({ contextMarkdown: false })
  const { status, body } = await call(booted.registration, mockRequest({ url: '/md/api/config' }))
  booted.restore()
  assert.equal(status, 200, 'ok')
  assert.equal(body.ok, true, 'ok flag')
  assert.deepEqual(body.value, { copyButton: true, textFenceMarkdown: true, contextMarkdown: false }, '当前值')
})

test('PUT /md/api/config 保存并更新内存（立即生效）', async () => {
  const dir = tempDir()
  const booted = boot({}, dir)
  const put = await call(
    booted.registration,
    mockRequest({
      url: '/md/api/config',
      method: 'PUT',
      body: JSON.stringify({ copyButton: false, textFenceMarkdown: false }),
    }),
  )
  assert.equal(put.status, 200, 'save ok')
  const after = await call(booted.registration, mockRequest({ url: '/md/api/config' }))
  // patch 文件路径必须在 restore（恢复 DSH_HOME）之前解析
  const file = patchFileOf('web')
  booted.restore()
  assert.equal(after.body.value.copyButton, false, '内存已更新（立即生效）')
  assert.equal(after.body.value.textFenceMarkdown, false, '内存已更新')
  // 持久化：写进 profile patch 文件（重启后恢复）
  const saved = extractConfig(readFileSync(file, 'utf8'), 'md-render')
  assert.equal(saved.copyButton, false, 'patch 文件已持久化 copyButton')
  assert.equal(saved.textFenceMarkdown, false, 'patch 文件已持久化 textFenceMarkdown')
})

test('PUT 非法输入 → 400（开关必须为布尔）', async () => {
  const booted = boot({})
  const bad1 = await call(
    booted.registration,
    mockRequest({ url: '/md/api/config', method: 'PUT', body: JSON.stringify({ copyButton: 'yes' }) }),
  )
  const bad2 = await call(booted.registration, mockRequest({ url: '/md/api/config', method: 'PUT', body: '[1,2]' }))
  const bad3 = await call(booted.registration, mockRequest({ url: '/md/api/config', method: 'PUT', body: 'not json' }))
  booted.restore()
  assert.equal(bad1.status, 400, 'string value rejected')
  assert.equal(bad2.status, 400, 'array payload rejected')
  assert.equal(bad3.status, 400, 'malformed JSON rejected (writeError)')
})

test('非本机来源 → 403；未知方法 → 404', async () => {
  const booted = boot({})
  const loopback = await call(booted.registration, mockRequest({ url: '/md/api/config' }))
  const external = await call(
    booted.registration,
    mockRequest({ url: '/md/api/config', host: 'evil.example.com', secFetchSite: 'cross-site' }),
  )
  const unknown = await call(booted.registration, mockRequest({ url: '/md/api/nope' }))
  booted.restore()
  assert.equal(loopback.status, 200, 'loopback passes')
  assert.equal(external.status, 403, 'cross-site external host rejected')
  assert.equal(unknown.status, 404, 'unknown method')
})
