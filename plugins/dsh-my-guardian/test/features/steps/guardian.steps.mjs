/**
 * Step definitions for dsh-my-guardian Gherkin acceptance tests.
 * Boots the plugin against a mocked loader tree + context per scenario,
 * mirroring host-smoke.mjs: staged-file scan, promotion, failure isolation,
 * freeze, safe mode, restart recovery, id conflicts and the trust fence.
 */
import { Given, When, Then, After, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../../lib/index.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class World {
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'guardian-feature-'))
    process.env.DSH_HOME = this.dir
    this.fake = this.makeFake()
    this.ctx = null
    this.lastResponse = null
  }

  stagedFile() {
    return join(this.dir, 'cordis.staged.json')
  }

  stateFile() {
    return join(this.dir, 'guardian', 'state.json')
  }

  readState() {
    return JSON.parse(readFileSync(this.stateFile(), 'utf8'))
  }

  makeFake() {
    const store = {}
    const failMap = {}
    const created = []
    const removed = []
    const root = {
      create: async (options) => {
        const id = options.id
        if (failMap[id]) throw new Error(failMap[id])
        if (store[id]) throw new Error(`duplicate loader entry id: ${id}`)
        store[id] = { id, options }
        created.push(id)
      },
      remove: async (id) => {
        delete store[id]
        removed.push(id)
      },
    }
    const tree = { filename: join(this.dir, 'cordis.yml'), store, root }
    return {
      store,
      failMap,
      created,
      removed,
      tree,
      loader: { entries: () => [{ subtree: tree }] },
      apiRoute: undefined,
      effects: [],
      intervals: [],
    }
  }

  async boot() {
    const fake = this.fake
    const ctx = {
      logger: { warn: () => {} },
      loader: fake.loader,
      timer: {
        interval: (callback) => {
          fake.intervals.push(callback)
          return () => {}
        },
      },
      get(name) {
        const services = {
          webServer: {
            register: (route) => {
              if (route.kind === 'prefix' && route.path === '/guardian/api') fake.apiRoute = route
              return () => {}
            },
          },
          webRuntime: { trustedHosts: [] },
        }
        return services[name]
      },
      on() {},
      effect(callback, label) {
        const disposer = callback()
        fake.effects.push({ label, disposer })
        return disposer
      },
    }
    this.ctx = ctx
    apply(ctx)
    await sleep(150)
  }

  async callApi(method, path, body, overrides) {
    const route = this.fake.apiRoute
    assert.ok(route, 'api route registered')
    const res = makeResponse()
    await route.handler(makeRequest(method, `/guardian/api/${path}`, body, overrides), res)
    this.lastResponse = {
      status: res._status,
      json: res._body === '' ? null : JSON.parse(res._body),
    }
    return this.lastResponse
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
  // 关闭 fs.watch（teardown disposer），否则 Node 进程被 watcher 挂住不退出
  const teardown = (this.fake.effects ?? []).find((e) => e.label === 'dsh-my-guardian: teardown')
  teardown?.disposer()
  await sleep(60)
  rmSync(this.dir, { recursive: true, force: true })
})

// ── Given ─────────────────────────────────────────────────────────────────
Given('候选区已写入条目 {string} 名为 {string}', async function (id, name) {
  writeFileSync(this.stagedFile(), JSON.stringify([{ id, name }], null, 2))
})

Given('loader 挂载 {string} 会失败', async function (id) {
  this.fake.failMap[id] = 'apply exploded'
})

Given('loader 已有条目 {string}', async function (id) {
  this.fake.store[id] = { options: {} }
})

Given('候选插件 {string} 声明缺失的 peer 依赖 {string}', async function (name, dep) {
  const pkgDir = join(this.dir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, peerDependencies: { [dep]: '^0.1.0' } }), 'utf8')
})

Given('候选插件 {string} 的 peer 依赖 {string} 已安装版本 {string}', async function (name, dep, version) {
  const pkgDir = join(this.dir, 'node_modules', name)
  const depDir = join(this.dir, 'node_modules', dep)
  mkdirSync(pkgDir, { recursive: true })
  mkdirSync(depDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, peerDependencies: { [dep]: '^18.2.0' } }), 'utf8')
  writeFileSync(join(depDir, 'package.json'), JSON.stringify({ name: dep, version }), 'utf8')
})

Given('安全模式已开启', async function () {
  mkdirSync(join(this.dir, 'guardian'), { recursive: true })
  writeFileSync(
    this.stateFile(),
    JSON.stringify({ version: 1, safeMode: true, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
})

Given('状态文件已记录转正条目 {string}', async function (id) {
  mkdirSync(join(this.dir, 'guardian'), { recursive: true })
  writeFileSync(
    this.stateFile(),
    JSON.stringify({
      version: 1,
      safeMode: false,
      staged: {},
      promoted: {
        [id]: {
          name: 'old-plugin',
          attempts: 0,
          lastError: null,
          lastFailedAt: null,
          frozen: false,
          promotedAt: 1,
        },
      },
      events: [],
    }),
    'utf8',
  )
})

Given('守护进程启动', async function () {
  await this.boot()
})

// ── When ──────────────────────────────────────────────────────────────────
When('守护进程连续启动 {int} 次', async function (count) {
  for (let i = 0; i < count; i++) {
    // 关闭上一个实例的 watcher（模拟完整重启，避免 watcher 泄漏挂住进程）
    const teardown = (this.fake.effects ?? []).find((e) => e.label === 'dsh-my-guardian: teardown')
    teardown?.disposer()
    this.fake = this.makeFake()
    this.fake.failMap['flaky'] = 'nope'
    writeFileSync(this.stagedFile(), JSON.stringify([{ id: 'flaky', name: '抖动插件' }], null, 2))
    await this.boot()
  }
})

When('用非回环 host 请求状态接口', async function () {
  await this.callApi('GET', 'state', undefined, {
    headers: { host: 'evil.example.com', 'sec-fetch-site': 'same-origin' },
  })
})

// ── Then ──────────────────────────────────────────────────────────────────
Then('条目 {string} 已被挂载', async function (id) {
  assert.ok(this.fake.created.includes(id), `entry ${id} mounted`)
})

Then('条目 {string} 已转正进入 promoted 清单', async function (id) {
  const state = this.readState()
  assert.ok(state.promoted[id], `entry ${id} promoted`)
})

Then('候选区文件不再包含 {string}', async function (id) {
  const entries = JSON.parse(readFileSync(this.stagedFile(), 'utf8'))
  assert.ok(!entries.some((e) => e?.id === id), `candidate file no longer contains ${id}`)
})

Then('条目 {string} 未被挂载', async function (id) {
  assert.ok(!this.fake.created.includes(id), `entry ${id} not mounted`)
})

Then('条目 {string} 的失败次数为 {int}', async function (id, count) {
  const state = this.readState()
  assert.equal(state.staged[id]?.attempts, count)
})

Then('候选区文件仍包含 {string}', async function (id) {
  const entries = JSON.parse(readFileSync(this.stagedFile(), 'utf8'))
  assert.ok(
    entries.some((e) => e?.id === id),
    `candidate file still contains ${id}`,
  )
})

Then('状态记录包含失败原因', async function () {
  const state = this.readState()
  const record = state.staged['bad-plugin']
  assert.ok(record?.lastError?.includes('apply exploded'), `failure reason recorded: ${record?.lastError}`)
})

Then('条目 {string} 处于依赖缺失失败', async function (id) {
  const state = this.readState()
  assert.equal(state.staged[id]?.failureType, 'dependency')
})

Then('条目 {string} 处于代码错误失败', async function (id) {
  const state = this.readState()
  assert.equal(state.staged[id]?.failureType, 'code')
})

Then('状态记录包含依赖安装建议', async function () {
  const state = this.readState()
  const record = state.staged['dep-miss']
  assert.ok(record?.installHint?.includes('dsh plugin add'), `install hint recorded: ${record?.installHint}`)
  assert.ok(record?.lastError?.includes('缺少依赖'), `dependency message recorded: ${record?.lastError}`)
})

Then('条目 {string} 处于冻结状态', async function (id) {
  const state = this.readState()
  assert.equal(state.staged[id]?.frozen, true)
})

Then('没有任何条目被挂载', async function () {
  assert.equal(this.fake.created.length, 0)
})

Then('状态记录包含冲突提示', async function () {
  const state = this.readState()
  const record = state.staged['conflict']
  assert.ok(record?.lastError?.includes('already exists'), `conflict recorded: ${record?.lastError}`)
})

Then('响应状态码为 {int}', async function (status) {
  assert.equal(this.lastResponse.status, status)
})

// ── startup-roster pre-check (issue #144) ─────────────────────────────────

Given('loader 名册已有条目 {string} 名为 {string}', async function (id, name) {
  this.fake.store[id] = { options: { id, name } }
})

Given('名册插件 {string} 声明缺失的 peer 依赖 {string}', async function (name, dep) {
  const pkgDir = join(this.dir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, peerDependencies: { [dep]: '^0.1.0' } }), 'utf8')
})

Then('预检报告写入启动区问题', async function () {
  const report = JSON.parse(readFileSync(join(this.dir, 'guardian', 'startup-issues.json'), 'utf8'))
  assert.equal(report.version, 1)
  assert.ok(report.issues.length >= 1, 'report carries at least one issue')
  assert.equal(report.issues[0].type, 'dependency')
  assert.ok(report.issues[0].fix.includes('dsh plugin add'), 'fix command present')
})

Then('状态记录包含启动区问题事件', async function () {
  const state = this.readState()
  assert.ok(
    state.events.some((e) => e.type === 'startup-issue'),
    'startup-issue event logged',
  )
})
