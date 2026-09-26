/**
 * Step definitions for dsh-my-plugin-manager Gherkin acceptance tests.
 *
 * Boots the real API handler against the real trust fence, mirroring
 * host-api.mjs: market search, package detail and the「重复能力已下线」404 面。
 * 安装 / 卸载 / 启停 / 清单路由不再存在（官方插件页承担），场景显式断言 404。
 */
import { After, When, Then, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'

import { dirSync } from 'tmp'
import { createApiHandler } from '../../../lib/api-route.js'
import { isTrustedApiRequest } from 'dsh-shared'

class World {
  constructor() {
    this.tmpDir = dirSync({ unsafeCleanup: true, prefix: 'dpm-feature-' }).name
    this.lastStatus = 0
    this.lastJson = null
  }

  makeResponse() {
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

  makeRequest(method, url, headers) {
    return {
      method,
      url,
      headers: {
        host: '127.0.0.1:3080',
        'sec-fetch-site': 'same-origin',
        origin: 'http://127.0.0.1:3080',
        ...(headers ?? {}),
      },
      [Symbol.asyncIterator]() {
        const chunks = []
        let i = 0
        return {
          next: () => Promise.resolve(i < chunks.length ? { value: chunks[i++], done: false } : { done: true }),
        }
      },
    }
  }

  async call(method, url, headers) {
    const ctx = {
      logger: { info: () => {}, warn: () => {} },
      webRuntime: { trustedHosts: [] },
    }
    const handler = createApiHandler({
      ctx,
      profile: 'web',
      fence: (request) => isTrustedApiRequest(request, ctx.webRuntime.trustedHosts),
    })
    const res = this.makeResponse()
    await handler(this.makeRequest(method, url, headers), res)
    this.lastStatus = res._status
    this.lastJson = res._body === '' ? null : JSON.parse(res._body)
  }
}

setWorldConstructor(World)

When('搜索关键词 {string} 返回官方与用户结果', async function (query) {
  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      objects: [
        {
          package: {
            name: '@deepseek-ai/dsh-base',
            version: '1.0.0',
            description: 'official',
            author: 'deepseek',
            date: '',
            homepage: '',
            repository: '',
          },
        },
        {
          package: {
            name: 'dsh-a',
            version: '0.1.0',
            description: 'user',
            author: 'alice',
            date: '',
            homepage: '',
            repository: '',
          },
        },
      ],
    }),
  })
  try {
    await this.call('GET', `/my-plugin-manager/api/search?q=${encodeURIComponent(query)}`)
  } finally {
    global.fetch = originalFetch
  }
})

When('请求插件详情 {string}', async function (name) {
  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      name: 'dsh-a',
      'dist-tags': { latest: '1.0.0' },
      readme: 'hello readme',
      time: { created: 'x', '1.0.0': '2026-01-01' },
      versions: {
        '1.0.0': {
          version: '1.0.0',
          license: 'MIT',
          repository: 'https://github.com/x/y',
          dependencies: { 'dsh-y': '^2' },
          peerDependencies: { cordis: '^4', 'dsh-shared': '^0.1.0' },
        },
      },
    }),
  })
  try {
    await this.call('GET', `/my-plugin-manager/api/detail?name=${encodeURIComponent(name)}`)
  } finally {
    global.fetch = originalFetch
  }
})

When('加载不存在的插件详情 {string}', async function (name) {
  const originalFetch = global.fetch
  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })
  try {
    await this.call('GET', `/my-plugin-manager/api/detail?name=${encodeURIComponent(name)}`)
  } finally {
    global.fetch = originalFetch
  }
})

When('请求已安装清单', async function () {
  await this.call('GET', '/my-plugin-manager/api/installed')
})

When('请求安装接口', async function () {
  await this.call('POST', '/my-plugin-manager/api/install')
})

When('用非回环 host 搜索插件', async function () {
  await this.call('GET', '/my-plugin-manager/api/search?q=dsh', {
    host: 'evil.example',
    'sec-fetch-site': 'cross-site',
  })
})

Then('详情包含 README {string}', function (text) {
  assert.equal(this.lastStatus, 200)
  assert.ok(this.lastJson.value.readme.includes(text), `readme includes ${text}`)
})

Then('详情版本历史包含 {string}', function (version) {
  assert.ok(
    this.lastJson.value.versions.some((v) => v.version === version),
    `version ${version} in timeline`,
  )
})

Then('详情元数据包含许可证 {string}', function (license) {
  assert.equal(this.lastJson.value.license, license)
})

Then('详情对等依赖包含缺失 {string}', function (name) {
  const peer = this.lastJson.value.peerDependencies.find((p) => p.name === name)
  assert.ok(peer && peer.missing === true, `peer ${name} marked missing`)
})

Then('详情对等依赖不缺失 {string}', function (name) {
  const peer = this.lastJson.value.peerDependencies.find((p) => p.name === name)
  assert.ok(peer && peer.missing === false, `peer ${name} not missing`)
})

Then('详情加载失败且给出错误消息', function () {
  assert.equal(this.lastStatus, 200)
  assert.equal(this.lastJson.ok, false)
  assert.ok(this.lastJson.error.message, 'error message present')
})

Then('搜索结果包含 {string}', function (name) {
  assert.ok(
    this.lastJson.value.results.some((r) => r.name === name),
    `search result ${name} present`,
  )
})

Then('响应状态码为 {int}', function (status) {
  assert.equal(this.lastStatus, status)
})

Then('响应错误说明路由未知', function () {
  assert.equal(this.lastJson.ok, false)
  assert.ok(this.lastJson.error.message.includes('unknown'), 'unknown route message present')
})

// 配对清理：每个场景的临时目录必须回收，否则 tmp 的 process-exit 钩子在
// worker 被强杀（超时 / CI 取消 / SIGKILL）时不执行，目录永久残留。
After(function () {
  if (this.tmpDir) rmSync(this.tmpDir, { recursive: true, force: true })
})
