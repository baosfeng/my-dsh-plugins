/**
 * Step definitions for dsh-file-activity Gherkin acceptance tests.
 * Boots the plugin against a mocked ctx per scenario (fresh world), drives
 * fs/observed events + HTTP routes through it, mirroring host-smoke.mjs.
 */
import { Given, When, Then, After, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { dirSync } from 'tmp'
import { apply } from '../../../lib/index.js'

class World {
  constructor() {
    this.dir = dirSync({ unsafeCleanup: true, prefix: 'dfa-feature-' }).name
    process.env.DSH_HOME = this.dir
    this.ctx = null
    this.sessionId = null
    this.apiHolder = captureRoute('/file-activity/api')
    this.mediaHolder = captureRoute('/file-activity/file')
    this.lastResponse = null
  }

  async boot() {
    const ctx = {
      logger: { warn: () => {} },
      webRuntime: { trustedHosts: [] },
      sessions: { get: () => undefined },
      webServer: {
        register: (route) => {
          this.apiHolder.set(route)
          this.mediaHolder.set(route)
          return () => {}
        },
      },
      events: [],
      effectCallbacks: [],
      on(name, listener) {
        this.events.push({ name, listener })
      },
      effect(callback, label) {
        this.effectCallbacks.push({ callback, label })
        const disposer = callback()
        if (typeof disposer === 'function') this.effectCallbacks.push({ disposer, label: `${label}:disposer` })
        return disposer
      },
    }
    this.ctx = ctx
    this.store = apply(ctx)
    await this.store.whenReady()
  }

  emitAgent(sessionId, toolName, path, opts) {
    const { listener } = this.ctx.events.find((e) => e.name === 'fs/observed')
    const { observation, args } = opts ?? {}
    listener({ displayPath: path }, observation ?? { kind: 'present' }, {
      name: toolName,
      agent: { id: sessionId },
      arguments: args ?? { file_path: path },
    })
  }

  async callRoute(method, url, body, overrides) {
    const route = this.apiHolder.get()
    assert.ok(route, 'route registered')
    const res = makeResponse()
    await route.handler(makeRequest(method, url, body, overrides), res)
    this.lastResponse = {
      status: res._status,
      json: res._body === '' ? null : JSON.parse(res._body),
    }
    return this.lastResponse
  }

  async stats(sessionId) {
    const r = await this.callRoute('GET', `/file-activity/api/stats?sessionId=${sessionId}`)
    return r.json.value
  }

  /** Call the binary media/text route (the response body is raw bytes or JSON text). */
  async callMedia(method, url) {
    const route = this.mediaHolder.get()
    assert.ok(route, 'media route registered')
    const res = makeResponse()
    await route.handler(makeRequest(method, url), res)
    this.lastResponse = {
      status: res._status,
      json: res._body === '' ? null : JSON.parse(res._body),
    }
    return this.lastResponse
  }
}

function captureRoute(prefix) {
  let captured
  return {
    set: (route) => {
      if (route.kind === 'prefix' && route.path === prefix) captured = route
    },
    get: () => captured,
  }
}

function makeResponse() {
  return {
    _status: 0,
    _body: '',
    writeHead(status) {
      this._status = status
    },
    end(body) {
      this._body = body ?? ''
    },
  }
}

function makeRequest(method, url, body, overrides) {
  const req = {
    method,
    url,
    headers: {
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:3080',
    },
    ...(overrides ?? {}),
    [Symbol.asyncIterator]() {
      const chunks = body === undefined ? [] : [JSON.stringify(body)]
      let i = 0
      return {
        next: () => Promise.resolve(i < chunks.length ? { value: chunks[i++], done: false } : { done: true }),
      }
    },
  }
  return req
}

setWorldConstructor(World)

After(async function () {
  rmSync(this.dir, { recursive: true, force: true })
})

// ── Given ─────────────────────────────────────────────────────────────────
Given('会话 {string} 已就绪', async function (sessionId) {
  this.sessionId = sessionId
  await this.boot()
})

// ── When ──────────────────────────────────────────────────────────────────
When('代理读取了文件 {string}', async function (path) {
  this.emitAgent(this.sessionId, 'read', path)
})

When('代理再次读取了文件 {string}', async function (path) {
  this.emitAgent(this.sessionId, 'read', path)
})

When('代理写入了文件 {string}', async function (path) {
  this.emitAgent(this.sessionId, 'write', path)
})

When('代理再次写入了文件 {string}', async function (path) {
  this.emitAgent(this.sessionId, 'write', path)
})

When('代理编辑了文件 {string}', async function (path) {
  this.emitAgent(this.sessionId, 'edit', path)
})

When('代理尝试读取缺失的文件 {string}', async function (path) {
  this.emitAgent(this.sessionId, 'read', path, { observation: { kind: 'absent' } })
})

When('代理读取了 {int} 个不同的文件', async function (count) {
  for (let i = 0; i < count; i++) {
    this.emitAgent(this.sessionId, 'read', `/work/cap-${i}.txt`)
  }
})

When('查询会话 {string} 的统计', async function (sessionId) {
  await this.stats(sessionId)
})

When('等待持久化完成', async function () {
  // sleep-ok: 等实现自己的落盘链排空（flush→compact→dispose）；本卡只补了加载就绪信号 whenReady（写就绪面留待落盘原语统一），
  // 这里的语义是"等一段大于防抖窗口（500ms）的真实时间"
  await new Promise((resolve) => setTimeout(resolve, 600))
})

When('插件实例重启', async function () {
  const disposers = this.ctx.effectCallbacks.filter((e) => e.disposer)
  for (const d of disposers) {
    try {
      d.disposer()
    } catch {
      /* ignore */
    }
  }
  this.ctx = null
  this.apiHolder = captureRoute('/file-activity/api')
  this.mediaHolder = captureRoute('/file-activity/file')
  await this.boot()
})

When('用非回环 host 请求统计接口', async function () {
  await this.callRoute('GET', '/file-activity/api/stats?sessionId=s-008', undefined, {
    headers: { host: 'evil.example.com', 'sec-fetch-site': 'same-origin' },
  })
})

When('清空会话 {string} 的记录', async function (sessionId) {
  await this.callRoute('POST', '/file-activity/api/clear', { sessionId })
})

When('创建文本文件 {string} 内容为 {string}', async function (path, content) {
  writeFileSync(path, content)
})

When('请求该文件 {string} 的文本路由', async function (path) {
  await this.callMedia(
    'GET',
    `/file-activity/file?sessionId=${encodeURIComponent(this.sessionId)}&path=${encodeURIComponent(path)}&as=text`,
  )
})

// ── Then ──────────────────────────────────────────────────────────────────
Then('最近访问列表包含 {string}', async function (path) {
  const value = await this.stats(this.sessionId)
  assert.ok(
    value.recent.some((e) => e.path === path),
    `recent contains ${path}`,
  )
})

Then('该文件 {string} 的读取计数为 {int}', async function (path, count) {
  const value = await this.stats(this.sessionId)
  assert.equal(value.counts[path]?.read, count)
})

Then('该文件 {string} 的新增计数为 {int}', async function (path, count) {
  const value = await this.stats(this.sessionId)
  assert.equal(value.counts[path]?.create, count)
})

Then('该文件 {string} 的修改计数为 {int}', async function (path, count) {
  const value = await this.stats(this.sessionId)
  assert.equal(value.counts[path]?.modify, count)
})

Then('最近访问列表中 {string} 只出现一次', async function (path) {
  const value = await this.stats(this.sessionId)
  assert.equal(value.recent.filter((e) => e.path === path).length, 1)
})

Then('会话 {string} 的统计中不存在 {string}', async function (sessionId, path) {
  const value = await this.stats(sessionId)
  assert.equal(value.counts[path], undefined)
})

Then('最近访问列表长度为 {int}', async function (length) {
  const value = await this.stats(this.sessionId)
  assert.equal(value.recent.length, length)
})

Then('最近访问列表第一项是最新读取的文件', async function () {
  const value = await this.stats(this.sessionId)
  assert.equal(value.recent[0].path, '/work/cap-11.txt')
})

Then('会话 {string} 的统计为空', async function (sessionId) {
  const value = await this.stats(sessionId)
  assert.deepEqual(value.counts, {})
})

Then('会话 {string} 的统计包含 {string}', async function (sessionId, path) {
  const value = await this.stats(sessionId)
  assert.ok(value.counts[path], `counts contains ${path}`)
})

Then('响应状态码为 {int}', async function (status) {
  assert.equal(this.lastResponse.status, status)
})

Then('文本路由返回内容 {string}', async function (content) {
  assert.equal(this.lastResponse.json.ok, true, 'as=text ok flag')
  assert.equal(this.lastResponse.json.value.content, content, 'as=text content matches')
})
