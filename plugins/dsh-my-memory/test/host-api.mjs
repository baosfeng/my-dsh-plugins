/**
 * dsh-my-memory — API route + apply() integration tests.
 *
 * 覆盖：fence 403、GET memory（全局/项目）、POST memory（add/update/delete
 * + confirmed 标记强制）、非法 scope/action 400、未知方法 404、错误响应。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, inject } from '../lib/index.js'
import { projectMemoryDir, projectIdOf, resolveProjectMemory } from '../lib/store.js'

const dir = mkdtempSync(join(tmpdir(), 'dmm-api-test-'))
process.env.DSH_HOME = dir
const homes = []

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

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

function captureRoute(prefix) {
  let captured
  const holder = {
    set: (route) => {
      if (route.kind === 'prefix' && route.path === prefix) captured = route
    },
    get: () => captured,
  }
  return holder
}

async function boot(overrides) {
  // 每个 boot 使用独立的 DSH_HOME，避免测试间持久化状态泄漏
  const home = mkdtempSync(join(tmpdir(), 'dmm-api-home-'))
  homes.push(home)
  process.env.DSH_HOME = home
  const apiHolder = captureRoute('/my-memory/api')
  const logs = []
  const ctx = {
    logger: { info: (m) => logs.push(m), warn: () => {} },
    webRuntime: { trustedHosts: [] },
    systemPrompt: { section: () => () => {} },
    tools: { register: () => () => {} },
    webServer: {
      register: (route) => {
        apiHolder.set(route)
        return () => {}
      },
    },
    sessions: {
      get: (id) => (id === 'work-session' ? { header: { cwd: '/work/proj' } } : undefined),
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
    ...(overrides ?? {}),
  }
  apply(ctx)
  return { ctx, logs, getRoute: () => apiHolder.get() }
}

async function callRoute(getRoute, method, url, body, overrides) {
  const route = getRoute()
  assert.ok(route, 'route registered')
  const res = makeResponse()
  await route.handler(makeRequest(method, url, body, overrides), res)
  return { status: res._status, json: res._body === '' ? null : JSON.parse(res._body) }
}

test('apply registers the API route and declares the required injects', async () => {
  const { getRoute, ctx } = await boot()
  assert.ok(getRoute(), '/my-memory/api route registered')
  assert.deepEqual(inject, ['systemPrompt', 'tools', 'webServer', 'webRuntime', 'sessions'], 'inject list intact')
  const disposers = ctx.effectCallbacks.filter((e) => typeof e.disposer === 'function')
  assert.ok(disposers.length >= 5, 'store/section/query-tool/save-tool/route effects return disposers')
})

test('apply registers memory_save and its pre-execute user-consent gate (issue #107)', async () => {
  const registered = []
  const events = []
  const home = mkdtempSync(join(tmpdir(), 'dmm-api-save-'))
  homes.push(home)
  process.env.DSH_HOME = home
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    webRuntime: { trustedHosts: [] },
    systemPrompt: { section: () => () => {} },
    tools: {
      register: (tool) => {
        registered.push(tool)
        return () => {}
      },
    },
    webServer: { register: () => () => {} },
    events,
    effectCallbacks: [],
    on(name, listener) {
      events.push({ name, listener })
    },
    effect(callback) {
      callback()
      return () => {}
    },
  }
  apply(ctx)
  const saveTool = registered.find((t) => t.name === 'memory_save')
  assert.ok(saveTool, 'memory_save tool registered')
  assert.deepEqual(saveTool.parameters.required, ['scope', 'desc'], 'scope+desc required')
  const gateEvent = events.find((e) => e.name === 'tools/pre-execute')
  assert.ok(gateEvent, 'tools/pre-execute listener registered')
  // gate: memory_save → ask（触发原生审批）；其它工具 → 透传下游决策
  const decision = { kind: 'allow' }
  const ask = await gateEvent.listener(
    { name: 'memory_save', arguments: { scope: 'global', desc: '偏好' } },
    async () => decision,
  )
  assert.equal(ask.kind, 'ask', 'memory_save raises the approval gate')
  const pass = await gateEvent.listener({ name: 'memory_query', arguments: { scope: 'global' } }, async () => decision)
  assert.equal(pass, decision, 'other tools pass through')
})

test('API refuses requests outside the fence (403)', async () => {
  const { getRoute } = await boot()
  const res = makeResponse()
  await getRoute().handler(
    makeRequest('GET', '/my-memory/api/memory?scope=global', undefined, {
      headers: { host: 'evil.example', 'sec-fetch-site': 'cross-site' },
    }),
    res,
  )
  assert.equal(res._status, 403, 'fenced')
  assert.equal(JSON.parse(res._body).ok, false, '403 body marks ok:false')
})

test('GET /memory lists the global scope', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-memory/api/memory?scope=global')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.value.scope, 'global')
  assert.deepEqual(r.json.value.items, [])
})

test('GET /session resolves the session working directory', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-memory/api/session?sessionId=work-session')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.value.cwd, '/work/proj', 'known session resolves its cwd')
})

test('GET /session returns empty cwd for unknown, absent or missing-sessions hosts', async () => {
  const { getRoute } = await boot()
  const unknown = await callRoute(getRoute, 'GET', '/my-memory/api/session?sessionId=missing')
  assert.equal(unknown.status, 200)
  assert.equal(unknown.json.value.cwd, '', 'unknown session → empty cwd')
  const none = await callRoute(getRoute, 'GET', '/my-memory/api/session')
  assert.equal(none.json.value.cwd, '', 'no sessionId → empty cwd')
  const noSessions = await boot({ sessions: undefined })
  const res = makeResponse()
  await noSessions.getRoute().handler(makeRequest('GET', '/my-memory/api/session?sessionId=any'), res)
  assert.equal(res._status, 200, 'sessions service absent → 200 with empty cwd')
  assert.equal(JSON.parse(res._body).value.cwd, '', 'tolerates a missing sessions service')
})

test('GET /config exposes the entry-length guidance (issue #105)', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-memory/api/config')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.value.maxEntryLength, 50, 'default entry-length guidance (issue #105 suggestion)')
  assert.equal(r.json.value.maxDescLength, 200, 'default injection cap preserved')
})

test('POST /memory keeps the FULL desc in storage even when it exceeds maxEntryLength (issue #105)', async () => {
  const { getRoute } = await boot()
  const longDesc = '第一句完整的话。第二句解释性话语，超过建议的精简长度但是应该完整保留在存储中。'
  const add = await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'global',
    desc: longDesc,
    confirmed: true,
  })
  assert.equal(add.status, 200, 'long entries are NOT rejected (guidance, not a hard limit)')
  assert.equal(add.json.value.items.length, 1)
  assert.equal(add.json.value.items[0].desc, longDesc, 'full desc preserved verbatim in storage')
})

test('POST /memory refuses writes without the user-consent marker (400)', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'global',
    desc: '静默写入',
  })
  assert.equal(r.status, 400)
  assert.ok(r.json.error.message.includes('confirmed'), 'consent marker required')
})

test('POST /memory add → update → delete round trip with consent', async () => {
  const { getRoute } = await boot()
  const add = await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'global',
    desc: '回复使用中文',
    confirmed: true,
  })
  assert.equal(add.status, 200)
  assert.equal(add.json.value.items.length, 1)
  const id = add.json.value.items[0].id
  assert.ok(id.startsWith('mem-'), 'generated id')

  const update = await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'update',
    scope: 'global',
    id,
    desc: '回复必须使用中文',
    confirmed: true,
  })
  assert.equal(update.status, 200)
  assert.equal(update.json.value.items[0].desc, '回复必须使用中文')

  const del = await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'delete',
    scope: 'global',
    id,
    confirmed: true,
  })
  assert.equal(del.status, 200)
  assert.deepEqual(del.json.value.items, [])
})

test('POST /memory persists to disk after the debounce flush', async () => {
  const { getRoute } = await boot()
  await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'global',
    desc: '持久化条目',
    confirmed: true,
  })
  // 等待防抖窗口 + 写盘
  await new Promise((resolve) => setTimeout(resolve, 400))
  const { readFileSync } = await import('node:fs')
  const onDisk = JSON.parse(readFileSync(`${process.env.DSH_HOME}/memory.json`, 'utf8'))
  assert.equal(onDisk.items.length, 1, 'persisted after the debounce window')
  assert.equal(onDisk.items[0].desc, '持久化条目')
})

test('project scope: add/list/delete with a cwd, isolated from global', async () => {
  const { getRoute } = await boot()
  mkdirSync(join(dir, 'proj', '.git'), { recursive: true })
  const projCwd = join(dir, 'proj')
  const add = await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'project',
    cwd: projCwd,
    desc: '本项目用 vitest',
    confirmed: true,
  })
  assert.equal(add.status, 200)
  const list = await callRoute(
    getRoute,
    'GET',
    `/my-memory/api/memory?scope=project&cwd=${encodeURIComponent(projCwd)}`,
  )
  assert.equal(list.status, 200)
  assert.equal(list.json.value.projectRoot, projCwd, 'project root resolved')
  assert.equal(list.json.value.items.length, 1)
  // 全局不受影响
  const global = await callRoute(getRoute, 'GET', '/my-memory/api/memory?scope=global')
  assert.equal(global.json.value.items.length, 0, 'project memory isolated from global')
  // 另一个项目也看不到
  mkdirSync(join(dir, 'other', '.git'), { recursive: true })
  const other = await callRoute(
    getRoute,
    'GET',
    `/my-memory/api/memory?scope=project&cwd=${encodeURIComponent(join(dir, 'other'))}`,
  )
  assert.equal(other.json.value.items.length, 0, 'project memory isolated per project')
})

test('legacy project memory is auto-migrated to the centralized location on first access (issue #108)', async () => {
  const { getRoute } = await boot()
  // 预置旧位置 <项目根>/.dsh/memory.json 数据（模拟升级前已存在的记忆）
  const proj = join(dir, 'legacy-proj')
  mkdirSync(join(proj, '.git'), { recursive: true })
  mkdirSync(join(proj, '.dsh'), { recursive: true })
  const legacyFile = join(proj, '.dsh', 'memory.json')
  const legacyItems = [
    { id: 'legacy-1', desc: '升级前项目约定', createdAt: 1, updatedAt: 2 },
    { id: 'legacy-2', desc: '升级前技术栈决策', createdAt: 3, updatedAt: 4 },
  ]
  writeFileSync(legacyFile, JSON.stringify({ items: legacyItems }), 'utf8')
  const resolved = await resolveProjectMemory(proj)

  // 首次 GET 项目记忆 → 触发自动迁移
  const list = await callRoute(getRoute, 'GET', `/my-memory/api/memory?scope=project&cwd=${encodeURIComponent(proj)}`)
  assert.equal(list.status, 200)
  assert.equal(list.json.value.items.length, 2, 'legacy items readable on first access')
  assert.equal(list.json.value.projectRoot, proj, 'project root unchanged')

  // 新位置文件包含旧数据（磁盘断言），旧文件已清理
  const migratedFile = join(projectMemoryDir(), `${projectIdOf(proj)}.json`)
  assert.equal(migratedFile, resolved.file, 'centralized file path')
  assert.ok(existsSync(migratedFile), 'migrated file exists')
  const onDisk = JSON.parse(readFileSync(migratedFile, 'utf8'))
  assert.equal(onDisk.items.length, 2, 'legacy items persisted to the new file')
  assert.ok(!existsSync(legacyFile), 'legacy file removed after migration')

  // 再次访问不重复迁移、数据仍在
  const again = await callRoute(getRoute, 'GET', `/my-memory/api/memory?scope=project&cwd=${encodeURIComponent(proj)}`)
  assert.equal(again.json.value.items.length, 2, 'data survives a second access')
})

test('validation errors: bad scope, bad action, missing fields, unknown id', async () => {
  const { getRoute } = await boot()
  const badScope = await callRoute(getRoute, 'GET', '/my-memory/api/memory?scope=bogus')
  assert.equal(badScope.status, 400)
  const projectNoCwd = await callRoute(getRoute, 'GET', '/my-memory/api/memory?scope=project')
  assert.equal(projectNoCwd.status, 400)
  const badAction = await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'bogus',
    scope: 'global',
    confirmed: true,
  })
  assert.equal(badAction.status, 400)
  const emptyDesc = await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'global',
    desc: '   ',
    confirmed: true,
  })
  assert.equal(emptyDesc.status, 400)
  const updateMissing = await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'update',
    scope: 'global',
    id: 'nope',
    desc: 'x',
    confirmed: true,
  })
  assert.equal(updateMissing.status, 404)
  const deleteMissing = await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'delete',
    scope: 'global',
    id: 'nope',
    confirmed: true,
  })
  assert.equal(deleteMissing.status, 404)
  const projectWriteNoCwd = await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'project',
    desc: 'x',
    confirmed: true,
  })
  assert.equal(projectWriteNoCwd.status, 400)
})

test('unknown methods answer 404', async () => {
  const { getRoute } = await boot()
  const getConfig = await callRoute(getRoute, 'GET', '/my-memory/api/nope')
  assert.equal(getConfig.status, 404)
  const putMemory = await callRoute(getRoute, 'PUT', '/my-memory/api/memory', {})
  assert.equal(putMemory.status, 404)
})

test('handler errors are answered with a 400 JSON body', async () => {
  const { getRoute } = await boot()
  const huge = 'x'.repeat(1_100_000)
  const res = makeResponse()
  const route = getRoute()
  const req = makeRequest('POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'global',
    desc: huge,
    confirmed: true,
  })
  await route.handler(req, res)
  assert.equal(res._status, 400)
  const body = JSON.parse(res._body)
  assert.equal(body.ok, false)
  assert.ok(typeof body.error.message === 'string')
})

test('fence: non-loopback hosts and origin mismatch are refused', async () => {
  const { getRoute } = await boot()
  const res1 = makeResponse()
  await getRoute().handler(
    makeRequest('GET', '/my-memory/api/memory?scope=global', undefined, {
      headers: { host: '192.168.1.10:3080', 'sec-fetch-site': 'same-origin' },
    }),
    res1,
  )
  assert.equal(res1._status, 403, 'non-loopback host refused')
  const res2 = makeResponse()
  await getRoute().handler(
    makeRequest('GET', '/my-memory/api/memory?scope=global', undefined, {
      headers: {
        host: '127.0.0.1:3080',
        'sec-fetch-site': 'same-origin',
        origin: 'http://evil.example',
      },
    }),
    res2,
  )
  assert.equal(res2._status, 403, 'origin mismatch refused')
})

test('fence: missing origin is allowed, unparseable origin is refused', async () => {
  const { getRoute } = await boot()
  const res1 = makeResponse()
  await getRoute().handler(
    makeRequest('GET', '/my-memory/api/memory?scope=global', undefined, {
      headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    }),
    res1,
  )
  assert.equal(res1._status, 200, 'no origin header → allowed')
  const res2 = makeResponse()
  await getRoute().handler(
    makeRequest('GET', '/my-memory/api/memory?scope=global', undefined, {
      headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'not a url' },
    }),
    res2,
  )
  assert.equal(res2._status, 403, 'unparseable origin → refused')
})

test('fence: explicitly trusted hosts are allowed', async () => {
  const holder = captureRoute('/my-memory/api')
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    webRuntime: { trustedHosts: ['dsh.internal:3080'] },
    systemPrompt: { section: () => () => {} },
    tools: { register: () => () => {} },
    webServer: {
      register: (route) => {
        holder.set(route)
        return () => {}
      },
    },
    events: [],
    effectCallbacks: [],
    on() {},
    effect(callback) {
      callback()
      return () => {}
    },
  }
  apply(ctx)
  const res = makeResponse()
  await holder.get().handler(
    makeRequest('GET', '/my-memory/api/memory?scope=global', undefined, {
      headers: {
        host: 'dsh.internal:3080',
        'sec-fetch-site': 'same-origin',
        origin: 'http://dsh.internal:3080',
      },
    }),
    res,
  )
  assert.equal(res._status, 200, 'trusted host allowed')
})

test('apply logs an info line with the [dsh-my-memory] prefix (issue #155)', async () => {
  const { logs } = await boot()
  assert.ok(logs.length >= 1, 'at least one log line emitted')
  assert.ok(logs[0].startsWith('[dsh-my-memory]'), 'log line carries the unified plugin prefix')
  assert.ok(logs[0].includes('已启用'), 'log line describes the enabled behavior')
})

test('API write logs an info line with action/scope (issue #155)', async () => {
  const { getRoute, logs } = await boot()
  const res = makeResponse()
  await getRoute().handler(
    makeRequest('POST', '/my-memory/api/memory', { action: 'add', scope: 'global', desc: 'x', confirmed: true }),
    res,
  )
  assert.equal(res._status, 200, 'write accepted')
  const writeLog = logs.find((line) => line.includes('API 写操作完成'))
  assert.ok(writeLog !== undefined, 'write info log emitted')
  assert.ok(writeLog.startsWith('[dsh-my-memory]'), 'write log carries the unified plugin prefix')
  assert.ok(writeLog.includes('action=add'), 'write log carries the action')
  assert.ok(writeLog.includes('scope=global'), 'write log carries the scope')
})
