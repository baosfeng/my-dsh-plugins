/**
 * Step definitions for dsh-my-plugin-manager Gherkin acceptance tests.
 * Boots the API handler against a mocked pluginInventory + real fence,
 * mirroring host-api.mjs: installed filtering (issue #28), official
 * namespace classification, market search and the trust fence.
 */
import { Given, When, Then, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApiHandler, isOfficialModule } from '../../../lib/api-route.js'
import { isTrustedApiRequest } from 'dsh-shared'

class World {
  constructor() {
    this.profileDir = mkdtempSync(join(tmpdir(), 'dpm-feature-'))
    this.entries = []
    this.lastStatus = 0
    this.lastJson = null
    this.lastModuleName = ''
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
      logger: { warn: () => {} },
      webRuntime: { trustedHosts: [] },
      // 宿主 list() 是 async（0.1.2-rc.1）；桩返回 Promise 才与真实语义一致。
      pluginInventory: { list: async () => ({ entries: this.entries }) },
    }
    const handler = createApiHandler({
      ctx,
      profile: 'web',
      profileDir: this.profileDir,
      fence: (request) => isTrustedApiRequest(request, ctx.webRuntime.trustedHosts),
    })
    const res = this.makeResponse()
    await handler(this.makeRequest(method, url, headers), res)
    this.lastStatus = res._status
    this.lastJson = res._body === '' ? null : JSON.parse(res._body)
  }
}

setWorldConstructor(World)

Given('loader 已加载官方插件 {string}', function (name) {
  this.entries.push({ moduleName: name, enabled: true, fiberPhase: 'active' })
})

Given('loader 已加载用户插件 {string}', function (name) {
  this.entries.push({ moduleName: name, enabled: true, fiberPhase: 'active' })
})

Given('插件名为 {string}', function (name) {
  this.lastModuleName = name
})

When('请求已安装清单', async function () {
  await this.call('GET', '/my-plugin-manager/api/installed')
})

When('用非回环 host 请求已安装清单', async function () {
  await this.call('GET', '/my-plugin-manager/api/installed', {
    host: 'evil.example',
    'sec-fetch-site': 'cross-site',
  })
})

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

Then('响应包含 {int} 个条目', function (count) {
  assert.equal(this.lastStatus, 200)
  assert.equal(this.lastJson.value.entries.length, count)
})

Then('条目 {string} 存在且 official 为 false', function (name) {
  const hit = this.lastJson.value.entries.find((e) => e.moduleName === name)
  assert.ok(hit, `entry ${name} present`)
  assert.equal(hit.official, false)
})

Then('条目 {string} 存在', function (name) {
  const hit = this.lastJson.value.entries.find((e) => e.moduleName === name)
  assert.ok(hit, `entry ${name} present`)
})

Then('响应不包含官方插件 {string}', function (name) {
  assert.ok(!this.lastJson.value.entries.some((e) => e.moduleName === name), `official ${name} filtered out`)
})

Then('该插件被判定为官方', function () {
  assert.equal(isOfficialModule(this.lastModuleName), true)
})

Then('该插件不被判定为官方', function () {
  assert.equal(isOfficialModule(this.lastModuleName), false)
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
