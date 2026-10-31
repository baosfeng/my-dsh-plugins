/**
 * dsh-my-skill-manager — HTTP 路由单测。
 *
 * 覆盖：信任围栏 403、GET /list 全量 payload（catalog + 扫描 + 双禁用名单 +
 * 诊断 + 统计 + scannedAt）、占位条目的还原、/rescan 触发 invalidate、
 * /detail 200/400/404、/session、PUT /config（global/project/非法 scope）、
 * 未知路由 404，以及 apply() 的宿主接线（provider / get 包装 / 事件 / 路由）。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { apply, inject, name } from '../lib/index.js'
import { API_PREFIX, createApiHandler } from '../lib/server/http.js'
import { CONFIG_FILE_NAME, readConfigFile, saveDisabledList } from '../lib/server/config-store.js'
import { createUsageStore } from '../lib/server/usage.js'

const home = dirSync({ unsafeCleanup: true, prefix: 'dsm-http-' }).name
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

const userRoot = join(home, 'skills')
mkdirSync(userRoot, { recursive: true })
const repo = join(home, 'repo')
mkdirSync(join(repo, '.git'), { recursive: true })

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

/** 极简 HTTP 请求桩。 */
function makeRequest(method, url, body, overrides) {
  return {
    method,
    url,
    headers: { host: '127.0.0.1:3080' },
    ...(overrides ?? {}),
    [Symbol.asyncIterator]() {
      const chunks = body === undefined ? [] : [JSON.stringify(body)]
      let index = 0
      return {
        next: () => Promise.resolve(index < chunks.length ? { value: chunks[index++], done: false } : { done: true }),
      }
    },
  }
}

/** 极简 HTTP 响应桩。 */
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

/** 解析响应 JSON。 */
function json(response) {
  return JSON.parse(response.body)
}

/** 假宿主 ctx（skills / webServer / sessions / 事件 / effect）。 */
function makeContext(options) {
  const state = { providers: [], routes: [], listeners: {}, effects: [], disposers: [] }
  const ctx = {
    skills: {
      registerProvider(create) {
        state.providers.push(create)
        return () => state.disposers.push('provider')
      },
      list: options?.list ?? (async () => []),
      get: async () => undefined,
    },
    webServer: {
      register(route) {
        state.routes.push(route)
        return () => state.disposers.push('route')
      },
    },
    sessions: { get: () => ({ header: { cwd: '/sessions/cwd' } }) },
    logger: { warn: () => {} },
    on(event, handler) {
      state.listeners[event] = handler
      return () => state.disposers.push('on')
    },
    effect(callback) {
      const disposer = callback()
      if (typeof disposer === 'function') state.effects.push(disposer)
    },
    get: () => undefined,
  }
  return { ctx, state }
}

/** 建一次 handler + 使用统计 store（每个用例独立文件）。 */
async function makeHandler(options) {
  const { ctx, state } = makeContext(options)
  const usage = createUsageStore({
    file: join(home, `${Math.random().toString(36).slice(2)}.usage.json`),
    logger: ctx.logger,
  })
  await usage.ready()
  let invalidated = 0
  const fence = options?.fence ?? (() => true)
  const handler = createApiHandler({
    ctx,
    invalidate: () => {
      invalidated += 1
    },
    fence,
    usage,
  })
  return { handler, ctx, state, usage, invalidations: () => invalidated }
}

test('fence rejection returns 403 without touching the catalog', async () => {
  let called = 0
  const { handler } = await makeHandler({
    fence: () => false,
    list: async () => {
      called += 1
      return []
    },
  })
  const response = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/list`), response)
  assert.equal(response.status, 403)
  assert.equal(json(response).ok, false)
  assert.equal(called, 0)
})

test('GET /list returns the full payload (catalog + scan + disabled lists + diagnostics)', async () => {
  mkdirSync(join(userRoot, 'alpha'), { recursive: true })
  writeFileSync(join(userRoot, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: from scan\n---\n', 'utf8')
  mkdirSync(join(userRoot, 'beta'), { recursive: true })
  writeFileSync(join(userRoot, 'beta', 'SKILL.md'), '---\nname: beta\ndescription: only scanned\n---\n', 'utf8')
  mkdirSync(join(userRoot, 'broken'), { recursive: true })
  await saveDisabledList({ scope: 'global', disabled: ['alpha'] })

  const { handler, usage } = await makeHandler({
    list: async () => [
      {
        name: 'alpha',
        description: '已禁用占位',
        invocation: { modelInvocable: false, userInvocable: false },
        source: 'disabled',
        provider: 'my-skill-manager',
      },
    ],
  })
  usage.record('beta', 'model')

  const response = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/list?cwd=${encodeURIComponent(join(repo, 'pkg'))}`), response)
  assert.equal(response.status, 200)
  const body = json(response)
  assert.equal(body.ok, true)
  const value = body.value
  assert.equal(value.cwd, join(repo, 'pkg'))
  assert.equal(value.projectRoot, repo)
  assert.equal(typeof value.scannedAt, 'number')
  assert.deepEqual(value.globalDisabled, ['alpha'])
  assert.deepEqual(value.projectDisabled, [])
  assert.equal(value.usage.beta.count, 1)
  assert.equal(value.usage.beta.lastSource, 'model')
  assert.equal(typeof value.usage.beta.lastUsedAt, 'number')
  assert.deepEqual(
    value.diagnostics.missing.map((issue) => issue.reason),
    ['missing-skill-md'],
  )

  const alpha = value.skills.find((row) => row.name === 'alpha')
  assert.equal(alpha.cataloged, true)
  assert.equal(alpha.description, 'from scan', 'placeholder row restored from scan')
  assert.equal(alpha.invocation, undefined)
  const beta = value.skills.find((row) => row.name === 'beta')
  assert.equal(beta.cataloged, false)
  assert.equal(beta.provider, 'filesystem')
  assert.equal(beta.usage.count, 1)
  assert.equal(beta.usage.lastSource, 'model')
  await usage.drain()
})

test('GET /rescan invalidates the host catalog before listing', async () => {
  const { handler, invalidations } = await makeHandler()
  const response = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/rescan`), response)
  assert.equal(response.status, 200)
  assert.equal(invalidations(), 1)
  const value = json(response).value
  assert.equal(value.cwd, '')
  assert.equal(value.projectRoot, '')
})

test('GET /detail serves SKILL.md and maps failures', async () => {
  mkdirSync(join(userRoot, 'detail-skill'), { recursive: true })
  writeFileSync(join(userRoot, 'detail-skill', 'SKILL.md'), '# detail\n', 'utf8')
  const { handler } = await makeHandler()

  const ok = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/detail?name=detail-skill`), ok)
  assert.equal(ok.status, 200)
  assert.deepEqual(json(ok).value.name, 'detail-skill')
  assert.equal(json(ok).value.content, '# detail\n')
  assert.equal(json(ok).value.truncated, false)
  assert.ok(json(ok).value.path.endsWith('SKILL.md'))

  const missingName = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/detail`), missingName)
  assert.equal(missingName.status, 400)
  assert.equal(json(missingName).error.code, 'invalid-name')

  const notFound = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/detail?name=unknown-skill`), notFound)
  assert.equal(notFound.status, 404)
  assert.equal(json(notFound).error.code, 'not-found')
})

test('GET /session returns the session cwd (empty when unknown)', async () => {
  const { handler } = await makeHandler()
  const found = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/session?sessionId=s1`), found)
  assert.deepEqual(json(found).value, { cwd: '/sessions/cwd' })

  const none = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/session`), none)
  assert.deepEqual(json(none).value, { cwd: '' })
})

test('PUT /config saves each scope and invalidates the catalog', async () => {
  const { handler, invalidations } = await makeHandler()

  const globalResponse = makeResponse()
  await handler(
    makeRequest('PUT', `${API_PREFIX}/config`, { scope: 'global', disabled: ['a', 'a', ''], cwd: '' }),
    globalResponse,
  )
  assert.equal(globalResponse.status, 200)
  assert.deepEqual(json(globalResponse), { ok: true })
  assert.deepEqual((await readConfigFile(join(home, CONFIG_FILE_NAME))).global.disabled, ['a'])
  assert.equal(invalidations(), 1)

  const projectResponse = makeResponse()
  await handler(
    makeRequest('PUT', `${API_PREFIX}/config`, { scope: 'project', disabled: ['b'], cwd: repo }),
    projectResponse,
  )
  assert.equal(projectResponse.status, 200)
  const projectFile = join(repo, '.dsh', CONFIG_FILE_NAME)
  assert.deepEqual(JSON.parse(readFileSync(projectFile, 'utf8')).project.disabled, ['b'])
  assert.equal(invalidations(), 2)

  const badScope = makeResponse()
  await handler(makeRequest('PUT', `${API_PREFIX}/config`, { scope: 'nope', disabled: [] }), badScope)
  assert.equal(badScope.status, 400)
  assert.equal(json(badScope).error.code, 'invalid-scope')
  assert.equal(invalidations(), 2, 'invalid scope must not invalidate')
})

test('unknown routes answer 404 JSON', async () => {
  const { handler } = await makeHandler()
  const response = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/nope`), response)
  assert.equal(response.status, 404)
  assert.equal(json(response).ok, false)
})

test('GET /list reports 503 when the skills service is missing', async () => {
  const usage = createUsageStore({ file: join(home, 'no-skills.usage.json'), logger: { warn: () => {} } })
  await usage.ready()
  const handler = createApiHandler({ ctx: {}, invalidate: () => {}, fence: () => true, usage })
  const response = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/list`), response)
  assert.equal(response.status, 503)
  assert.equal(json(response).error.code, 'skills-unavailable')
})

test('unexpected catalog failures answer 500 internal', async () => {
  const usage = createUsageStore({ file: join(home, 'boom.usage.json'), logger: { warn: () => {} } })
  await usage.ready()
  const handler = createApiHandler({
    ctx: {
      skills: {
        list: async () => {
          throw new Error('boom')
        },
      },
    },
    invalidate: () => {},
    fence: () => true,
    usage,
  })
  const response = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/list`), response)
  assert.equal(response.status, 500)
  assert.equal(json(response).error.code, 'internal')
})

test('GET /detail maps an escaping symlink to 400 forbidden', async () => {
  const outside = join(home, 'outside-http')
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'SKILL.md'), '# leaked\n', 'utf8')
  symlinkSync(outside, join(userRoot, 'escape-http'))
  const { handler } = await makeHandler()
  const response = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/detail?name=escape-http`), response)
  assert.equal(response.status, 400)
  assert.equal(json(response).error.code, 'forbidden')
})

test('GET /session tolerates a non-string session cwd', async () => {
  const usage = createUsageStore({ file: join(home, 'session.usage.json'), logger: { warn: () => {} } })
  await usage.ready()
  const handler = createApiHandler({
    ctx: { sessions: { get: () => ({ header: { cwd: 42 } }) } },
    invalidate: () => {},
    fence: () => true,
    usage,
  })
  const response = makeResponse()
  await handler(makeRequest('GET', `${API_PREFIX}/session?sessionId=s1`), response)
  assert.deepEqual(json(response).value, { cwd: '' })
})

test('apply() wires the provider, get wrapper, pre-execute listener and route', async () => {
  assert.equal(name, 'dsh-my-skill-manager')
  assert.deepEqual(inject, ['skills', 'webServer', 'sessions'])

  const { ctx, state } = makeContext()
  const originalGet = ctx.skills.get
  apply(ctx)

  assert.equal(state.providers.length, 1)
  assert.equal(state.routes.length, 1)
  assert.equal(state.routes[0].kind, 'prefix')
  assert.equal(state.routes[0].path, API_PREFIX)
  assert.notEqual(ctx.skills.get, originalGet, 'skills.get is wrapped for usage statistics')
  assert.equal(typeof state.listeners['tools/pre-execute'], 'function')

  // provider 工厂可构造：无禁用配置时零候选；控制面 invalidate 可调用
  const isolated = dirSync({ unsafeCleanup: true, prefix: 'dsm-http-empty-' }).name
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = isolated
  try {
    let invalidated = false
    const provider = state.providers[0]({
      invalidate: () => {
        invalidated = true
      },
    })
    assert.equal(provider.name, 'my-skill-manager')
    assert.deepEqual(await provider.list({}), [])
    assert.equal(await provider.get({ name: 'x' }, {}), undefined)
    assert.equal(invalidated, false)
  } finally {
    process.env.DSH_HOME = previousHome
    rmSync(isolated, { recursive: true, force: true })
  }

  // pre-execute 传递 next 并标记模型来源
  const next = () => 'forwarded'
  const result = state.listeners['tools/pre-execute']({ name: 'skill', arguments: { name: 'alpha' } }, next)
  assert.equal(result, 'forwarded')

  // teardown 还原 get 并收尾
  for (const dispose of state.effects) dispose()
  assert.equal(ctx.skills.get, originalGet)
})
