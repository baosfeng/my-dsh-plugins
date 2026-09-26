/**
 * dsh-my-plugin-manager — API route + apply() integration tests.
 *
 * manage.js / registry.js are mocked: the update check and the npm lookups
 * exercise the route wiring without spawning a real CLI or hitting the registry.
 *
 * 安装 / 卸载 / 启停 / 清单管理已下线（官方插件页与 `dsh plugin` CLI 承担），
 * 因此这些路由必须 404 —— 下面有专门的防复发用例。
 */
import { test, afterAll } from 'vitest'
import { vi } from 'vitest'
import assert from 'node:assert/strict'

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'

/** 临时 DSH_HOME 收集；配对清理见文件末尾 afterAll。 */
const tmpDirs = []
const dir = dirSync({ unsafeCleanup: true, prefix: 'dpm-api-test-' }).name
tmpDirs.push(dir)

// ── mocks ──────────────────────────────────────────────────────────────────
const manageMock = vi.hoisted(() => ({
  outdatedPlugins: vi.fn(async () => ({ ok: true, outdated: [] })),
}))
vi.mock('../lib/manage.js', () => manageMock)

const registryMock = vi.hoisted(() => ({
  searchNpmPlugins: vi.fn(async () => [
    {
      name: 'dsh-x',
      version: '1.0.0',
      description: 'desc',
      author: 'a',
      date: '',
      homepage: '',
      repository: '',
    },
  ]),
  fetchPackageDetail: vi.fn(async () => ({
    name: 'dsh-x',
    version: '1.0.0',
    latest: '1.0.0',
    description: 'desc',
    author: 'alice',
    license: 'MIT',
    homepage: 'https://foo',
    repository: 'https://github.com/x/y',
    readme: '# hi',
    versions: [{ version: '1.0.0', date: '2026-01-01' }],
    dependencies: [],
    peerDependencies: [],
    downloads: 5,
  })),
}))
vi.mock('../lib/registry.js', () => registryMock)

const { apply } = await import('../lib/index.js')
const { currentProfile, profileDirOf } = await import('dsh-shared')

test('currentProfile / profileDirOf resolve defaults', () => {
  assert.equal(currentProfile(), 'web')
  process.env.DSH_HOME = dir
  assert.equal(profileDirOf('web'), join(dir, 'profiles', 'web'))
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
  const apiHolder = captureRoute('/my-plugin-manager/api')
  const logs = []
  const ctx = {
    logger: { info: (m) => logs.push(m), warn: () => {} },
    webRuntime: { trustedHosts: [] },
    webServer: {
      register: (route) => {
        apiHolder.set(route)
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
    ...(overrides ?? {}),
  }
  process.env.DSH_HOME = dir
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

test('apply registers the API route', async () => {
  const { getRoute } = await boot()
  assert.ok(getRoute(), '/my-plugin-manager/api route registered')
})

test('apply injects only official read-only services (no pluginInventory)', async () => {
  const { inject } = await import('../lib/index.js')
  assert.deepEqual(inject, ['webServer', 'webRuntime'], '清单管理下线后不再依赖 pluginInventory')
})

test('API refuses requests outside the fence (403)', async () => {
  const { getRoute } = await boot()
  const res = makeResponse()
  await getRoute().handler(
    makeRequest('GET', '/my-plugin-manager/api/search?q=dsh', undefined, {
      headers: { host: 'evil.example', 'sec-fetch-site': 'cross-site' },
    }),
    res,
  )
  assert.equal(res._status, 403, 'fenced')
})

test('GET /search calls the npm registry and clamps size', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/search?q=dsh-file&size=999')
  assert.equal(r.status, 200)
  assert.equal(r.json.value.results[0].name, 'dsh-x')
  assert.ok(
    registryMock.searchNpmPlugins.mock.calls.some((call) => call[0] === 'dsh-file' && call[1] === 50),
    'size clamped to 50',
  )
  const empty = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/search?q=')
  assert.deepEqual(empty.json.value.results, [], 'blank query returns no results')
})

test('GET /detail surfaces package detail and forwards the version', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/detail?name=dsh-x')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.value.readme, '# hi')
  assert.equal(r.json.value.version, '1.0.0')
  assert.ok(
    registryMock.fetchPackageDetail.mock.calls.some((call) => call[0] === 'dsh-x' && call[1] === ''),
    'defaults to empty version (latest)',
  )

  await callRoute(getRoute, 'GET', '/my-plugin-manager/api/detail?name=dsh-x&version=2.0.0')
  assert.ok(
    registryMock.fetchPackageDetail.mock.calls.some((call) => call[0] === 'dsh-x' && call[1] === '2.0.0'),
    'version query forwarded',
  )
})

test('GET /detail requires a name (400)', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/detail?name=')
  assert.equal(r.status, 400)
  assert.equal(r.json.ok, false)
  assert.ok(r.json.error.message.includes('name'))
})

test('GET /detail returns a load-failure fallback when the fetch throws', async () => {
  registryMock.fetchPackageDetail.mockRejectedValueOnce(new Error('package not found'))
  const warns = []
  const { getRoute } = await boot({ logger: { info: () => {}, warn: (m) => warns.push(m) } })
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/detail?name=ghost')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, false)
  assert.ok(r.json.error.message.includes('package not found'))
  assert.ok(
    warns.some((line) => line.startsWith('[dsh-my-plugin-manager]') && line.includes('ghost')),
    'detail failure logged with the unified prefix',
  )
})

test('GET /updates surfaces outdated entries', async () => {
  manageMock.outdatedPlugins.mockResolvedValueOnce({
    ok: true,
    outdated: [{ name: 'dsh-a', current: '1.0.0', latest: '1.1.0' }],
  })
  const { getRoute, logs } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/updates')
  assert.equal(r.status, 200)
  assert.equal(r.json.value.outdated[0].latest, '1.1.0')
  assert.ok(
    manageMock.outdatedPlugins.mock.calls.some((call) => call[0] === 'web'),
    'update check runs against the current profile',
  )
  const line = logs.find((l) => l.includes('更新检查完成'))
  assert.ok(line !== undefined && line.startsWith('[dsh-my-plugin-manager]'), 'update log emitted with prefix')
})

test('GET /updates reports CLI failures without failing the request', async () => {
  manageMock.outdatedPlugins.mockResolvedValueOnce({ ok: false, error: 'registry unreachable' })
  const warns = []
  const { getRoute } = await boot({ logger: { info: () => {}, warn: (m) => warns.push(m) } })
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/updates')
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.value.outdated, [])
  assert.equal(r.json.value.error, 'registry unreachable')
  assert.ok(
    warns.some((l) => l.startsWith('[dsh-my-plugin-manager]') && l.includes('registry unreachable')),
    'failure logged with reason',
  )
})

// ── 重复能力防复发：写路由与清单路由必须全部 404 ─────────────────────────
test('install / uninstall / update / enable / disable routes are gone (404)', async () => {
  const { getRoute } = await boot()
  for (const method of ['install', 'uninstall', 'update', 'enable', 'disable']) {
    const r = await callRoute(getRoute, 'POST', `/my-plugin-manager/api/${method}`, { name: 'dsh-x', source: 'dsh-x' })
    assert.equal(r.status, 404, `${method} 已下线（官方插件页承担）`)
  }
})

test('the inventory route is gone (404)', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/installed')
  assert.equal(r.status, 404, '清单路由已下线（官方插件页 / tool-plugin-manager 承担）')
})

test('unknown API methods return 404', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/nope')
  assert.equal(r.status, 404)
})

test('wrong method on a known route returns 404', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'POST', '/my-plugin-manager/api/search', { q: 'dsh' })
  assert.equal(r.status, 404)
})

test('profileDirOf uses DSH_HOME', () => {
  process.env.DSH_HOME = dir
  assert.equal(profileDirOf('web'), join(dir, 'profiles', 'web'))
})

test('fence: non-loopback hosts, origin mismatch and trusted hosts', async () => {
  const { getRoute } = await boot()
  const res1 = makeResponse()
  await getRoute().handler(
    makeRequest('GET', '/my-plugin-manager/api/search?q=dsh', undefined, {
      headers: { host: '192.168.1.10:3080', 'sec-fetch-site': 'same-origin' },
    }),
    res1,
  )
  assert.equal(res1._status, 403, 'non-loopback host refused')

  const res2 = makeResponse()
  await getRoute().handler(
    makeRequest('GET', '/my-plugin-manager/api/search?q=dsh', undefined, {
      headers: {
        host: '127.0.0.1:3080',
        'sec-fetch-site': 'same-origin',
        origin: 'http://evil.example',
      },
    }),
    res2,
  )
  assert.equal(res2._status, 403, 'origin mismatch refused')

  const holder = captureRoute('/my-plugin-manager/api')
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    webRuntime: { trustedHosts: ['dsh.internal:3080'] },
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
  const res3 = makeResponse()
  await holder.get().handler(
    makeRequest('GET', '/my-plugin-manager/api/search?q=dsh', undefined, {
      headers: {
        host: 'dsh.internal:3080',
        'sec-fetch-site': 'same-origin',
        origin: 'http://dsh.internal:3080',
      },
    }),
    res3,
  )
  assert.equal(res3._status, 200, 'trusted host allowed')
})

test('handler errors are answered with a 400 JSON body', async () => {
  registryMock.searchNpmPlugins.mockRejectedValueOnce(new Error('npm explode'))
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/search?q=dsh')
  assert.equal(r.status, 400)
  assert.equal(r.json.ok, false)
  assert.ok(typeof r.json.error.message === 'string')
})

test('currentProfile honors --profile and profileDirOf falls back to home', () => {
  const saved = process.argv
  process.argv = ['node', 'dsh', '--profile', 'custom', 'web']
  assert.equal(currentProfile(), 'custom')
  process.argv = saved
  const home = process.env.DSH_HOME
  delete process.env.DSH_HOME
  assert.ok(profileDirOf('web').endsWith('.dsh/profiles/web'), 'fallback to ~/.dsh/profiles')
  if (home !== undefined) process.env.DSH_HOME = home
})

test('apply logs an info line with the [dsh-my-plugin-manager] prefix (issue #155)', async () => {
  const { logs } = await boot()
  assert.ok(logs.length >= 1, 'at least one log line emitted')
  assert.ok(logs[0].startsWith('[dsh-my-plugin-manager]'), 'log line carries the unified plugin prefix')
  assert.ok(logs[0].includes('已启用'), 'log line describes the enabled behavior')
})

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
