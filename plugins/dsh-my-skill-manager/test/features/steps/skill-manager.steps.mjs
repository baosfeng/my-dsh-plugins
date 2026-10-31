/**
 * Step definitions for dsh-my-skill-manager Gherkin acceptance tests.
 *
 * 每个场景一个临时 DSH_HOME + 假宿主 ctx（apply() 真实接线：占位 provider /
 * usage 包装 / /my-skill-manager/api 路由 / 信任围栏）。假 ctx 只模拟宿主
 * services（skills.list 的合并语义、sessions、events），不 mock 网络，也不
 * 复刻插件内部逻辑；断言全部走 HTTP 响应与真实落盘文件。
 */
import { Given, When, Then, After, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { apply } from '../../../lib/index.js'

const API = '/my-skill-manager/api'
const CONFIG_FILE = 'skills.enabled.json'

class World {
  constructor() {
    this.dir = dirSync({ unsafeCleanup: true, prefix: 'dsm-feature-' }).name
    process.env.DSH_HOME = this.dir
    process.env.DSH_AGENTS_HOME = join(this.dir, 'agents')
    this.userRoot = join(this.dir, 'skills')
    this.projectRoot = join(this.dir, 'repo')
    this.outsideDir = join(this.dir, 'outside')
    mkdirSync(this.userRoot, { recursive: true })
    mkdirSync(join(this.projectRoot, '.git'), { recursive: true })
    mkdirSync(this.outsideDir, { recursive: true })

    /** 官方 catalog：name → { scope: 'user'|'project', summary }。 */
    this.catalog = new Map()
    this.sessions = new Map()
    this.invalidated = 0
    this.route = null
    this.provider = null
    this.last = null
    this.writtenDetail = ''
    this.boot()
  }

  /** 用假宿主 ctx 启动插件（apply 真实接线）。 */
  boot() {
    const world = this
    const ctx = {
      logger: { warn() {} },
      webServer: {
        register(route) {
          if (route.kind === 'prefix' && route.path === API) world.route = route
          return () => {}
        },
      },
      sessions: {
        get(id) {
          const cwd = world.sessions.get(id)
          return cwd === undefined ? undefined : { header: { cwd } }
        },
      },
      on() {
        return () => {}
      },
      effect(callback) {
        const disposer = callback()
        return typeof disposer === 'function' ? disposer : () => {}
      },
      get() {
        return undefined
      },
      skills: {
        // 插件注册 rank-0 占位 provider：这里保存实例，供 /list 合并与直接断言。
        registerProvider(create) {
          world.provider = create({
            invalidate() {
              world.invalidated += 1
            },
          })
          return () => {}
        },
        list: (options) => world.mergedCatalog(options?.cwd),
        get: async (name) => {
          const entry = world.catalog.get(name)
          return entry === undefined ? undefined : { ...entry.summary, content: '# ' + name + '\n' }
        },
      },
    }
    this.ctx = ctx
    apply(ctx)
  }

  /** 模拟宿主 skills 目录：官方条目 + 占位 provider（rank-0 同名覆盖）。 */
  async mergedCatalog(cwd) {
    const context = typeof cwd === 'string' && cwd !== '' ? cwd : undefined
    const rows = new Map()
    for (const [name, entry] of this.catalog) {
      if (entry.scope === 'project' && context === undefined) continue
      rows.set(name, { ...entry.summary })
    }
    const placeholders = await this.provider.list({ cwd: context })
    for (const candidate of placeholders) {
      rows.set(candidate.name, {
        name: candidate.name,
        description: candidate.description,
        source: candidate.source,
        provider: candidate.provider,
        invocation: candidate.invocation,
      })
    }
    return [...rows.values()]
  }

  addCatalogSkill(name, scope) {
    const root = scope === 'project' ? join(this.projectRoot, '.dsh', 'skills') : this.userRoot
    const source = scope === 'project' ? 'project-dsh' : 'user-dsh'
    this.writeSkillFile(root, name, `---\nname: ${name}\ndescription: ${scope} skill\n---\n`)
    this.catalog.set(name, {
      scope,
      summary: {
        name,
        description: scope + ' skill',
        invocation: { modelInvocable: true, userInvocable: true },
        source,
        provider: 'filesystem',
        path: join(root, name, 'SKILL.md'),
      },
    })
  }

  writeSkillFile(root, name, content) {
    mkdirSync(join(root, name), { recursive: true })
    writeFileSync(join(root, name, 'SKILL.md'), content, 'utf8')
  }

  async call(method, path, body) {
    assert.ok(this.route, 'API 路由已注册')
    const response = makeResponse()
    await this.route.handler(makeRequest(method, API + path, body), response)
    this.last = {
      status: response.status,
      body: response.body === '' ? null : JSON.parse(response.body),
    }
    return this.last
  }

  async saveScope(scope, disabled) {
    const cwd = scope === 'project' ? this.projectRoot : ''
    return this.call('PUT', '/config', { scope, disabled, cwd })
  }

  value() {
    assert.equal(this.last.body.ok, true, '响应 ok=true')
    return this.last.body.value
  }
}

/** 极简 HTTP 请求桩（loopback + 同源，过信任围栏）。 */
function makeRequest(method, url, body) {
  return {
    method,
    url,
    headers: {
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:3080',
    },
    [Symbol.asyncIterator]() {
      const chunks = body === undefined ? [] : [JSON.stringify(body)]
      let index = 0
      return {
        next: () => Promise.resolve(index < chunks.length ? { value: chunks[index++], done: false } : { done: true }),
      }
    },
  }
}

function makeResponse() {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ?? ''
    },
  }
}

setWorldConstructor(World)

// 每个场景丢弃整个世界：不调用插件 disposer（usage 的 teardown flush 会在
// 目录删除后重新写文件）；验收流程不调用被包装的 skills.get，故没有挂起写。
After(function () {
  rmSync(this.dir, { recursive: true, force: true })
})

// ── 列表与双作用域 ───────────────────────────────────────────────────────
Given('官方目录包含全局 skill {string} 与项目 skill {string}', function (globalName, projectName) {
  this.addCatalogSkill(globalName, 'user')
  this.addCatalogSkill(projectName, 'project')
})

Given('官方目录包含全局 skill {string}', function (name) {
  this.addCatalogSkill(name, 'user')
})

Given('目录中还有一个未被官方收录的 {string}', function (name) {
  this.writeSkillFile(this.userRoot, name, `---\nname: ${name}\ndescription: 扫描发现\n---\n`)
})

Given('全局禁用名单已保存为 {string}', async function (jsonList) {
  const response = await this.saveScope('global', JSON.parse(jsonList))
  assert.equal(response.status, 200, '全局禁用名单已保存')
})

Given('项目禁用名单已保存为 {string}', async function (jsonList) {
  const response = await this.saveScope('project', JSON.parse(jsonList))
  assert.equal(response.status, 200, '项目禁用名单已保存')
})

When('我以项目上下文查询 skill 列表', async function () {
  await this.call('GET', '/list?cwd=' + encodeURIComponent(this.projectRoot))
})

When('我查询全局 skill 列表', async function () {
  await this.call('GET', '/list')
})

Then('列表返回 {int} 且列出全部 {int} 个 skill', function (status, count) {
  assert.equal(this.last.status, status)
  assert.equal(this.value().skills.length, count)
})

Then('列表同时包含 {string} 与 {string} 来源', function (first, second) {
  const sources = this.value().skills.map((row) => row.source)
  assert.ok(sources.includes(first), '包含来源 ' + first)
  assert.ok(sources.includes(second), '包含来源 ' + second)
})

Then('全局禁用名单为 {string}', function (jsonList) {
  assert.deepEqual(this.value().globalDisabled, JSON.parse(jsonList))
})

Then('项目禁用名单为 {string}', function (jsonList) {
  assert.deepEqual(this.value().projectDisabled, JSON.parse(jsonList))
})

Then('{string} 标记为未收录且 provider 为 {string}', function (name, provider) {
  const row = this.value().skills.find((entry) => entry.name === name)
  assert.ok(row, '列表包含 ' + name)
  assert.equal(row.cataloged, false)
  assert.equal(row.provider, provider)
})

Then('{string} 带当前扫描路径', function (name) {
  const row = this.value().skills.find((entry) => entry.name === name)
  assert.ok(row, '列表包含 ' + name)
  // 目录形态的 skill：扫描路径是目录本身（官方 catalog 收录后才补 SKILL.md）。
  assert.equal(row.path, join(this.userRoot, name))
})

Then('{string} 在列表中标记为未收录', function (name) {
  const row = this.value().skills.find((entry) => entry.name === name)
  assert.ok(row, '列表包含 ' + name)
  assert.equal(row.cataloged, false)
})

// ── 启停与占位覆盖 ───────────────────────────────────────────────────────
When('我通过接口把全局禁用名单保存为 {string}', async function (jsonList) {
  await this.saveScope('global', JSON.parse(jsonList))
})

When('我通过接口把项目禁用名单保存为 {string}', async function (jsonList) {
  await this.saveScope('project', JSON.parse(jsonList))
})

Then('保存返回 {int} 且没有 value', function (status) {
  assert.equal(this.last.status, status)
  assert.equal(this.last.body.ok, true)
  assert.equal('value' in this.last.body, false)
})

Then('全局配置文件包含禁用名单 {string}', function (jsonList) {
  const doc = JSON.parse(readFileSync(join(this.dir, CONFIG_FILE), 'utf8'))
  assert.deepEqual(doc.global.disabled, JSON.parse(jsonList))
})

Then('全局配置文件仍包含禁用名单 {string}', function (jsonList) {
  const doc = JSON.parse(readFileSync(join(this.dir, CONFIG_FILE), 'utf8'))
  assert.deepEqual(doc.global.disabled, JSON.parse(jsonList), '项目写入不覆盖全局名单')
})

Then('项目配置文件包含禁用名单 {string}', function (jsonList) {
  const doc = JSON.parse(readFileSync(join(this.projectRoot, '.dsh', CONFIG_FILE), 'utf8'))
  assert.deepEqual(doc.project.disabled, JSON.parse(jsonList))
})

Then('保存操作让 skill 目录缓存失效一次', function () {
  assert.equal(this.invalidated, 1)
})

Then('保存操作让 skill 目录缓存失效两次', function () {
  assert.equal(this.invalidated, 2)
})

Then('禁用占位 provider 列出 {string} 且 get 返回 undefined', async function (name) {
  assert.ok(this.provider, '占位 provider 已注册')
  const candidates = await this.provider.list({ cwd: this.projectRoot })
  const candidate = candidates.find((entry) => entry.name === name)
  assert.ok(candidate, '占位 provider 列出 ' + name)
  assert.equal(candidate.provider, 'my-skill-manager')
  assert.equal(candidate.rank, 0)
  const loaded = await this.provider.get({ name }, { cwd: this.projectRoot })
  assert.equal(loaded, undefined, '禁用态不加载正文')
})

// ── 详情 ─────────────────────────────────────────────────────────────────
Given('全局 skill 目录存在 {string} 的 SKILL.md：', function (name, content) {
  this.writtenDetail = content
  this.writeSkillFile(this.userRoot, name, content)
})

Given('全局 skill 目录存在超大 {string} 的 SKILL.md（{int} KB）', function (name, kilobytes) {
  this.writeSkillFile(this.userRoot, name, 'x'.repeat(kilobytes * 1024))
})

Given('全局 skill 目录的 {string} 指向白名单外', function (name) {
  writeFileSync(join(this.outsideDir, 'SKILL.md'), '# leaked\n', 'utf8')
  symlinkSync(this.outsideDir, join(this.userRoot, name))
})

When('我查询 {string} 的详情', async function (name) {
  await this.call('GET', '/detail?name=' + encodeURIComponent(name))
})

Then('详情返回 {int} 且内容与写入内容一致', function (status) {
  assert.equal(this.last.status, status)
  const value = this.value()
  assert.equal(value.content, this.writtenDetail)
  assert.ok(value.path.endsWith('SKILL.md'))
})

Then('详情未被截断', function () {
  assert.equal(this.value().truncated, false)
})

Then('详情返回 {int} 且错误码为 {string}', function (status, code) {
  assert.equal(this.last.status, status)
  assert.equal(this.last.body.ok, false)
  assert.equal(this.last.body.error.code, code)
})

Then('详情被标记为截断且内容不超过 {int} KB', function (kilobytes) {
  const value = this.value()
  assert.equal(value.truncated, true)
  const bytes = Buffer.byteLength(value.content, 'utf8')
  assert.ok(bytes <= kilobytes * 1024, '内容不超过 ' + kilobytes + ' KB')
  assert.equal(bytes, kilobytes * 1024, '截断点就是上限')
})

// ── 扫描诊断 ─────────────────────────────────────────────────────────────
Given('全局 skill 目录存在坏符号链接 {string}', function (name) {
  symlinkSync(join(this.userRoot, 'missing-target'), join(this.userRoot, name))
})

Given('全局 skill 目录存在缺 SKILL.md 的 {string}', function (name) {
  mkdirSync(join(this.userRoot, name), { recursive: true })
})

Given('全局 skill 目录存在缺 frontmatter 的 {string}', function (name) {
  this.writeSkillFile(this.userRoot, name, 'hello')
})

Given('全局 skill 目录存在 frontmatter 正常的 {string}', function (name) {
  this.writeSkillFile(this.userRoot, name, `---\nname: ${name}\ndescription: 正常\n---\n`)
})

Then('诊断名单包含 {string} 且原因为 {string}', function (name, reason) {
  const issue = this.value().diagnostics.missing.find((entry) => entry.name === name)
  assert.ok(issue, '诊断包含 ' + name)
  assert.equal(issue.reason, reason)
})

Then('诊断名单不包含 {string}', function (name) {
  const missing = this.value().diagnostics.missing
  assert.ok(!missing.some((entry) => entry.name === name), '诊断不包含 ' + name)
})

// ── rescan 与会话 ────────────────────────────────────────────────────────
Given('当前会话 {string} 的工作目录是项目根', function (sessionId) {
  this.sessions.set(sessionId, this.projectRoot)
})

When('我查询会话 {string} 的工作目录', async function (sessionId) {
  await this.call('GET', '/session?sessionId=' + encodeURIComponent(sessionId))
})

Then('会话返回项目根', function () {
  assert.equal(this.last.status, 200)
  assert.equal(this.value().cwd, this.projectRoot)
})

Given('新建目录条目 {string}', function (name) {
  this.writeSkillFile(this.userRoot, name, `---\nname: ${name}\ndescription: 新建\n---\n`)
})

When('我通过重新扫描接口刷新列表', async function () {
  await this.call('GET', '/rescan')
})

Then('重新扫描返回 {int} 且使目录缓存失效一次', function (status) {
  assert.equal(this.last.status, status)
  assert.equal(this.invalidated, 1)
})

Then('重新扫描结果包含 {string}', function (name) {
  const names = this.value().skills.map((row) => row.name)
  assert.ok(names.includes(name), '重扫结果包含 ' + name)
})
