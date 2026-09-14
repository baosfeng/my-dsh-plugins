/**
 * Step definitions for dsh-my-skill-manager Gherkin acceptance tests.
 * Boots the plugin against a mocked ctx per scenario (fresh world), drives
 * the /my-skill-manager/api routes through it, mirroring test/host-api.mjs.
 */
import { Given, When, Then, After, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { apply } from '../../../lib/index.js'

class World {
  constructor() {
    this.dir = dirSync({ unsafeCleanup: true, prefix: 'dsm-feature-' }).name
    process.env.DSH_HOME = this.dir
    process.env.DSH_AGENTS_HOME = join(this.dir, 'agents')
    this.apiHolder = captureRoute('/my-skill-manager/api')
    this.invalidated = 0
    this.lastResponse = null
    this.catalog = new Map([
      ['web-search', { name: 'web-search', description: '搜索', source: 'user-dsh', provider: 'filesystem' }],
      [
        'codebase-memory',
        {
          name: 'codebase-memory',
          description: '图查询',
          source: 'project-dsh',
          provider: 'filesystem',
        },
      ],
    ])
    this.boot()
  }

  boot() {
    const ctx = {
      logger: { warn: () => {} },
      webRuntime: { trustedHosts: [] },
      webServer: {
        register: (route) => {
          this.apiHolder.set(route)
          return () => {}
        },
      },
      events: [],
      effectCallbacks: [],
      on() {},
      effect(callback) {
        this.effectCallbacks.push({ callback })
        const disposer = callback()
        if (typeof disposer === 'function') this.effectCallbacks.push({ disposer })
        return disposer
      },
      skills: {
        registerProvider: (create) => {
          create({
            invalidate: () => {
              this.invalidated += 1
            },
          })
          return () => {}
        },
        list: async () => {
          const merged = new Map(this.catalog)
          return [...merged.values()]
        },
        get: async (name) => {
          const entry = this.catalog.get(name)
          return entry === undefined ? undefined : { ...entry, content: 'body' }
        },
      },
    }
    this.ctx = ctx
    apply(ctx)
  }

  async callRoute(method, url, body) {
    const route = this.apiHolder.get()
    assert.ok(route, 'route registered')
    const res = makeResponse()
    await route.handler(makeRequest(method, url, body), res)
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

function makeRequest(method, url, body) {
  const req = {
    method,
    url,
    headers: {
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:3080',
    },
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

After(function () {
  rmSync(this.dir, { recursive: true, force: true })
})

Given('全局 skill {string} 与项目 skill {string} 已存在', function (globalName, projectName) {
  this.catalog.set(globalName, {
    name: globalName,
    description: '全局',
    source: 'user-dsh',
    provider: 'filesystem',
  })
  this.catalog.set(projectName, {
    name: projectName,
    description: '项目',
    source: 'project-dsh',
    provider: 'filesystem',
  })
})

When('以项目路径 {string} 查询 skill 列表', async function (cwd) {
  await this.callRoute('GET', `/my-skill-manager/api/list?cwd=${encodeURIComponent(cwd)}`)
})

Then('列表只包含项目来源的 skill', function () {
  const skills = this.lastResponse.json.value.skills
  assert.ok(
    skills.every((s) => s.source.startsWith('project-')),
    'only project sources remain',
  )
})

Then('列表包含 {string}', function (name) {
  const names = this.lastResponse.json.value.skills.map((s) => s.name)
  assert.ok(names.includes(name), `list contains ${name}`)
})

Then('列表不包含 {string}', function (name) {
  const names = this.lastResponse.json.value.skills.map((s) => s.name)
  assert.ok(!names.includes(name), `list excludes ${name}`)
})

Given('新建了 skill {string}', function (name) {
  this.catalog.set(name, { name, description: '新建', source: 'user-dsh', provider: 'filesystem' })
})

When('通过刷新接口重新扫描', async function () {
  await this.callRoute('GET', '/my-skill-manager/api/rescan?cwd=')
})

Then('刷新接口返回 200', function () {
  assert.equal(this.lastResponse.status, 200)
})

Then('刷新接口使 skill 目录缓存失效', function () {
  assert.ok(this.invalidated >= 1, 'rescan invalidates the skill catalog')
})

Then('刷新结果包含新扫描到的 skill {string}', function (name) {
  const names = this.lastResponse.json.value.skills.map((s) => s.name)
  assert.ok(names.includes(name), `rescan result contains ${name}`)
})

Given('全局 skill 目录存在异常条目 {string}（符号链接无法解析）', function (name) {
  const skillsDir = join(this.dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  symlinkSync(join(skillsDir, 'nowhere'), join(skillsDir, name))
})

Given('存在缺少 frontmatter 的条目 {string}', function (name) {
  const skillsDir = join(this.dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  writeFileSync(join(skillsDir, `${name}.md`), 'hello')
})

Given('全局 skill 目录存在正常条目 {string}', function (name) {
  const skillsDir = join(this.dir, 'skills')
  mkdirSync(join(skillsDir, name), { recursive: true })
  writeFileSync(join(skillsDir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: 正常\n---\nbody`)
})

When('查询全局 skill 列表', async function () {
  await this.callRoute('GET', '/my-skill-manager/api/list?cwd=')
})

Then('列表附带诊断名单', function () {
  assert.ok(Array.isArray(this.lastResponse.json.value.diagnostics.missing), 'diagnostics list present')
})

Then('诊断名单包含 {string} 且原因为 {string}', function (name, reason) {
  const missing = this.lastResponse.json.value.diagnostics.missing
  const entry = missing.find((m) => m.name === name)
  assert.ok(entry, `diagnostics contains ${name}`)
  assert.equal(entry.reason, reason)
})

Then('条目 {string} 标记为未收录', function (name) {
  const skill = this.lastResponse.json.value.skills.find((s) => s.name === name)
  assert.ok(skill, `list contains ${name}`)
  assert.equal(skill.cataloged, false, 'directory skill absent from the catalog is marked not cataloged')
})

Then('诊断名单不包含 {string}', function (name) {
  const missing = this.lastResponse.json.value.diagnostics.missing
  assert.ok(!missing.some((m) => m.name === name), `diagnostics excludes ${name}`)
})

Given('已保存全局禁用名单 {string}', async function (jsonList) {
  const disabled = JSON.parse(jsonList)
  await this.callRoute('PUT', '/my-skill-manager/api/config', { scope: 'global', disabled })
})

Then('全局禁用名单为 {string}', function (jsonList) {
  const expected = JSON.parse(jsonList)
  assert.deepEqual(this.lastResponse.json.value.global.disabled, expected)
})

Then('保存操作使 skill 目录缓存失效', function () {
  assert.ok(this.invalidated >= 1, 'config save invalidates the skill catalog')
})

// ── issue #91: usage statistics ────────────────────────────────────────────

Given('skill {string} 被加载 {int} 次', async function (name, times) {
  for (let i = 0; i < times; i += 1) {
    const loaded = await this.ctx.skills.get(name)
    assert.ok(loaded, `skill ${name} loads`)
  }
})

Then('列表附带使用统计', function () {
  const usage = this.lastResponse.json.value.usage
  assert.ok(usage !== null && typeof usage === 'object', 'usage statistics present in the list payload')
})

Then('{string} 的使用次数为 {int}', function (name, count) {
  const usage = this.lastResponse.json.value.usage
  assert.equal(usage[name]?.count, count, `usage count of ${name}`)
})

Then('{string} 的使用来源为 {string}', function (name, source) {
  const usage = this.lastResponse.json.value.usage
  assert.equal(usage[name]?.lastSource, source, `usage source of ${name}`)
})
