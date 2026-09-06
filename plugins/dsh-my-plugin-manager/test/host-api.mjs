/**
 * dsh-my-plugin-manager — API route + apply() integration tests.
 *
 * manage.js / registry.js are mocked: install/uninstall/updates exercise the
 * route wiring without spawning real CLI or hitting the npm registry.
 */
import { test } from 'vitest'
import { vi } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'dpm-api-test-'))

// ── mocks ──────────────────────────────────────────────────────────────────
const manageMock = vi.hoisted(() => ({
  installedVersionOf: vi.fn(() => '0.1.0'),
  installPlugin: vi.fn(async () => ({ ok: true, code: 0, stdout: 'added', stderr: '' })),
  uninstallPlugin: vi.fn(async () => ({ ok: true, code: 0, stdout: '', stderr: '' })),
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
    pluginInventory: {
      list: () => ({
        entries: [
          { moduleName: 'dsh-a', enabled: true, fiberPhase: 'ready' },
          { moduleName: '@scope/dsh-b', enabled: false, fiberPhase: null },
          { moduleName: '@deepseek-ai/dsh-base', enabled: true, fiberPhase: 'active' },
          { moduleName: 'cordis:include', enabled: true, fiberPhase: 'active' },
          { moduleName: '@koishijs/plugin-xxx', enabled: true, fiberPhase: 'active' },
        ],
      }),
    },
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

test('API refuses requests outside the fence (403)', async () => {
  const { getRoute } = await boot()
  const res = makeResponse()
  await getRoute().handler(
    makeRequest('GET', '/my-plugin-manager/api/installed', undefined, {
      headers: { host: 'evil.example', 'sec-fetch-site': 'cross-site' },
    }),
    res,
  )
  assert.equal(res._status, 403, 'fenced')
})

test('GET /installed merges inventory + versions', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/installed')
  assert.equal(r.status, 200)
  const entries = r.json.value.entries
  assert.equal(entries.length, 2)
  assert.equal(entries[0].moduleName, 'dsh-a')
  assert.equal(entries[0].enabled, true)
  assert.equal(entries[0].version, '0.1.0', 'version resolved via manage.installedVersionOf')
})

test('GET /installed filters official modules and marks user entries', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/installed')
  assert.equal(r.status, 200)
  const entries = r.json.value.entries
  assert.deepEqual(
    entries.map((e) => e.moduleName),
    ['dsh-a', '@scope/dsh-b'],
    'official modules filtered out',
  )
  assert.ok(
    entries.every((e) => e.official === false),
    'user entries carry official: false',
  )
  assert.ok(
    entries.every((e) => e.version === '0.1.0'),
    'versions still resolved for user entries',
  )
})

test('GET /search calls the npm registry and clamps size', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/search?q=dsh-file&size=999')
  assert.equal(r.status, 200)
  assert.equal(r.json.value.results[0].name, 'dsh-x')
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
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/detail?name=ghost')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, false)
  assert.ok(r.json.error.message.includes('package not found'))
})

test('GET /updates surfaces outdated entries', async () => {
  manageMock.outdatedPlugins.mockResolvedValueOnce({
    ok: true,
    outdated: [{ name: 'dsh-a', current: '1.0.0', latest: '1.1.0' }],
  })
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/updates')
  assert.equal(r.status, 200)
  assert.equal(r.json.value.outdated[0].latest, '1.1.0')
})

test('POST /install and /uninstall route through the CLI wrapper', async () => {
  const { getRoute } = await boot()
  const bad = await callRoute(getRoute, 'POST', '/my-plugin-manager/api/install', { source: '  ' })
  assert.equal(bad.status, 400, 'blank source rejected')

  const ok = await callRoute(getRoute, 'POST', '/my-plugin-manager/api/install', {
    source: 'dsh-x',
  })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.ok, true)
  assert.ok(manageMock.installPlugin.mock.calls.some((call) => call[0] === 'web' && call[1] === 'dsh-x'))

  const un = await callRoute(getRoute, 'POST', '/my-plugin-manager/api/uninstall', {
    name: 'dsh-x',
  })
  assert.equal(un.status, 200)
  assert.ok(manageMock.uninstallPlugin.mock.calls.some((call) => call[0] === 'web' && call[1] === 'dsh-x'))
})

test('install/uninstall failures carry an error message', async () => {
  manageMock.installPlugin.mockResolvedValueOnce({
    ok: false,
    code: 1,
    stdout: '',
    stderr: 'ERESOLVE',
  })
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'POST', '/my-plugin-manager/api/install', {
    source: 'dsh-bad',
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, false)
  assert.ok(r.json.error.message.includes('ERESOLVE'))
})

test('unknown API methods return 404', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/nope')
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
    makeRequest('GET', '/my-plugin-manager/api/installed', undefined, {
      headers: { host: '192.168.1.10:3080', 'sec-fetch-site': 'same-origin' },
    }),
    res1,
  )
  assert.equal(res1._status, 403, 'non-loopback host refused')

  const res2 = makeResponse()
  await getRoute().handler(
    makeRequest('GET', '/my-plugin-manager/api/installed', undefined, {
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
    pluginInventory: { list: () => ({ entries: [] }) },
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
    makeRequest('GET', '/my-plugin-manager/api/installed', undefined, {
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
  const { getRoute } = await boot()
  const huge = 'x'.repeat(1_100_000)
  const res = makeResponse()
  await getRoute().handler(makeRequest('POST', '/my-plugin-manager/api/install', { source: huge }), res)
  assert.equal(res._status, 400)
  const body = JSON.parse(res._body)
  assert.equal(body.ok, false)
  assert.ok(typeof body.error.message === 'string')
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

test('updates failure and uninstall failure carry error details', async () => {
  manageMock.outdatedPlugins.mockResolvedValueOnce({ ok: false, error: 'registry unreachable' })
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-plugin-manager/api/updates')
  assert.equal(r.status, 200)
  assert.equal(r.json.value.error, 'registry unreachable')

  manageMock.uninstallPlugin.mockResolvedValueOnce({
    ok: false,
    code: 1,
    stdout: '',
    stderr: 'EBADPKG',
  })
  const un = await callRoute(getRoute, 'POST', '/my-plugin-manager/api/uninstall', {
    name: 'dsh-x',
  })
  assert.equal(un.json.ok, false)
  assert.ok(un.json.error.message.includes('EBADPKG'))
})

test('apply logs an info line with the [dsh-my-plugin-manager] prefix (issue #155)', async () => {
  const { logs } = await boot()
  assert.ok(logs.length >= 1, 'at least one log line emitted')
  assert.ok(logs[0].startsWith('[dsh-my-plugin-manager]'), 'log line carries the unified plugin prefix')
  assert.ok(logs[0].includes('已启用'), 'log line describes the enabled behavior')
})

test('install success logs an info line with source (issue #155)', async () => {
  const { getRoute, logs } = await boot()
  const r = await callRoute(getRoute, 'POST', '/my-plugin-manager/api/install', { source: 'dsh-x' })
  assert.equal(r.json.ok, true, 'install ok')
  const installLog = logs.find((line) => line.includes('插件安装成功'))
  assert.ok(installLog !== undefined, 'install info log emitted')
  assert.ok(installLog.startsWith('[dsh-my-plugin-manager]'), 'install log carries the unified plugin prefix')
  assert.ok(installLog.includes('dsh-x'), 'install log carries the source')
})

test('install failure logs a warn line with reason (issue #155)', async () => {
  const warns = []
  manageMock.installPlugin.mockResolvedValueOnce({ ok: false, code: 1, stdout: '', stderr: 'EACCES' })
  const { getRoute } = await boot({ logger: { info: () => {}, warn: (m) => warns.push(m) } })
  const r = await callRoute(getRoute, 'POST', '/my-plugin-manager/api/install', { source: 'dsh-bad' })
  assert.equal(r.json.ok, false, 'install failed')
  assert.ok(warns.length >= 1, 'warn emitted for failed install')
  assert.ok(warns[0].startsWith('[dsh-my-plugin-manager]'), 'warn carries the unified plugin prefix')
  assert.ok(warns[0].includes('dsh-bad'), 'warn carries the source')
  assert.ok(warns[0].includes('EACCES'), 'warn carries the reason')
})
