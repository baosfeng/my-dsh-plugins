/**
 * dsh-my-memory — GET/POST /my-memory/api/prompts 测试（issue #465）。
 *
 * 覆盖：写路径 confirmed:true 门（缺失一律 400）、非 loopback 403、
 * add/update/delete/toggle/reorder 全动作、参数校验、与 /memory 端点互不干扰。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { dirSync } from 'tmp'
import { apply } from '../lib/index.js'
import { promptsFile } from '../lib/prompts-store.js'
import { PROMPT_SECTION_NAME, PROMPT_SECTION_ORDER } from '../lib/prompts.js'

const dir = dirSync({ unsafeCleanup: true, prefix: 'dmm-prompts-api-' }).name
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
  return {
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
}

/** 挂载插件并捕获 /my-memory/api 前缀路由 + 已注册的 system-prompt section。 */
async function boot(overrides) {
  const home = dirSync({ unsafeCleanup: true, prefix: 'dmm-prompts-home-' }).name
  homes.push(home)
  process.env.DSH_HOME = home
  let route
  const sections = []
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    webRuntime: { trustedHosts: [] },
    systemPrompt: {
      section: (section) => {
        sections.push(section)
        return () => {}
      },
    },
    tools: { register: () => () => {} },
    webServer: {
      register: (registered) => {
        if (registered.kind === 'prefix' && registered.path === '/my-memory/api') route = registered
        return () => {}
      },
    },
    sessions: { get: () => undefined },
    events: [],
    on(name, listener) {
      this.events.push({ name, listener })
    },
    effect(callback) {
      const disposer = callback()
      return disposer
    },
    ...(overrides ?? {}),
  }
  apply(ctx)
  return { ctx, sections, getRoute: () => route }
}

async function callRoute(getRoute, method, url, body, overrides) {
  const route = getRoute()
  assert.ok(route, 'route registered')
  const res = makeResponse()
  await route.handler(makeRequest(method, url, body, overrides), res)
  return { status: res._status, json: res._body === '' ? null : JSON.parse(res._body) }
}

/** 新增一条提示词并返回该条目（带同意标记；端点回传 items + 本次变更的 item）。 */
async function addPrompt(getRoute, payload) {
  const r = await callRoute(getRoute, 'POST', '/my-memory/api/prompts', { action: 'add', confirmed: true, ...payload })
  assert.equal(r.status, 200, `add succeeded: ${JSON.stringify(r.json)}`)
  const created = r.json.value.item
  assert.ok(created && created.id, `add returns the created item: ${JSON.stringify(r.json)}`)
  return created
}

test('apply registers the prompts section (fixed name/order) alongside the memory section', async () => {
  const { sections } = await boot()
  const names = sections.map((s) => s.name)
  assert.ok(names.includes('dsh-my-memory'), 'memory section registered')
  assert.ok(names.includes(PROMPT_SECTION_NAME), 'prompts section registered')
  const prompts = sections.find((s) => s.name === PROMPT_SECTION_NAME)
  assert.equal(prompts.order, PROMPT_SECTION_ORDER)
  assert.equal(typeof prompts.text, 'function')
})

test('a duplicate/foreign section registration must not break apply (try/catch degradation)', async () => {
  const sections = []
  const { getRoute } = await boot({
    systemPrompt: {
      section: (section) => {
        // 模拟宿主重复注册同名 section 抛错（issue #465 风险 1）
        if (section.name === PROMPT_SECTION_NAME) throw new Error('section already registered: ' + section.name)
        sections.push(section)
        return () => {}
      },
    },
  })
  assert.equal(sections.length, 1, 'the memory section still registered')
  assert.ok(getRoute(), 'apply finished: routes still registered after the section failure')
})

test('GET /prompts returns the seeded builtin entry (enabled)', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-memory/api/prompts')
  assert.equal(r.status, 200)
  assert.equal(r.json.value.items.length, 1)
  assert.equal(r.json.value.items[0].builtin, 'builtin:think-zh')
  assert.equal(r.json.value.items[0].enabled, true)
  assert.equal(r.json.value.scope, undefined, 'no project scope for prompts')
})

test('every prompt write without confirmed:true is refused with 400', async () => {
  const { getRoute } = await boot()
  const item = await addPrompt(getRoute, { title: 't', text: '正文' })
  const cases = [
    { action: 'add', title: 't', text: 'x' },
    { action: 'add', title: 't', text: 'x', confirmed: false },
    { action: 'update', id: item.id, text: 'x' },
    { action: 'delete', id: item.id },
    { action: 'toggle', id: item.id, enabled: false },
    { action: 'reorder', id: item.id, direction: 'up' },
  ]
  for (const payload of cases) {
    const r = await callRoute(getRoute, 'POST', '/my-memory/api/prompts', payload)
    assert.equal(r.status, 400, `refused without consent: ${JSON.stringify(payload)}`)
  }
  const after = await callRoute(getRoute, 'GET', '/my-memory/api/prompts')
  assert.equal(after.json.value.items.length, 2, 'no silent write happened')
  assert.equal(after.json.value.items.find((i) => i.id === item.id).enabled, true, 'toggle refused')
})

test('a non-loopback request is refused with 403', async () => {
  const { getRoute } = await boot()
  const r = await callRoute(getRoute, 'GET', '/my-memory/api/prompts', undefined, {
    headers: { host: 'evil.example.com', origin: 'http://evil.example.com' },
  })
  assert.equal(r.status, 403)
})

test('add requires a non-empty title and text; unknown action → 400', async () => {
  const { getRoute } = await boot()
  const noTitle = await callRoute(getRoute, 'POST', '/my-memory/api/prompts', {
    action: 'add',
    text: '正文',
    confirmed: true,
  })
  assert.equal(noTitle.status, 400)
  const noText = await callRoute(getRoute, 'POST', '/my-memory/api/prompts', {
    action: 'add',
    title: '标题',
    confirmed: true,
  })
  assert.equal(noText.status, 400)
  const bad = await callRoute(getRoute, 'POST', '/my-memory/api/prompts', { action: 'explode', confirmed: true })
  assert.equal(bad.status, 400)
})

test('update/toggle/reorder/delete act on one entry and 404 on unknown ids', async () => {
  const { getRoute } = await boot()
  const a = await addPrompt(getRoute, { title: 'A', text: 'a', order: 10 })
  const b = await addPrompt(getRoute, { title: 'B', text: 'b', order: 20 })

  const updated = await callRoute(getRoute, 'POST', '/my-memory/api/prompts', {
    action: 'update',
    id: a.id,
    title: 'A2',
    text: 'a2',
    confirmed: true,
  })
  assert.equal(updated.status, 200)
  const updatedItem = updated.json.value.items.find((i) => i.id === a.id)
  assert.equal(updatedItem.title, 'A2')
  assert.equal(updatedItem.text, 'a2')

  const toggled = await callRoute(getRoute, 'POST', '/my-memory/api/prompts', {
    action: 'toggle',
    id: a.id,
    enabled: false,
    confirmed: true,
  })
  assert.equal(toggled.status, 200)
  assert.equal(toggled.json.value.items.find((i) => i.id === a.id).enabled, false)

  const reordered = await callRoute(getRoute, 'POST', '/my-memory/api/prompts', {
    action: 'reorder',
    id: b.id,
    direction: 'up',
    confirmed: true,
  })
  assert.equal(reordered.status, 200)
  const titles = reordered.json.value.items.map((i) => i.title)
  assert.deepEqual(titles, ['中文思考', 'B', 'A2'], 'reorder up swapped the pair (seed stays first)')

  const badReorder = await callRoute(getRoute, 'POST', '/my-memory/api/prompts', {
    action: 'reorder',
    id: b.id,
    direction: 'sideways',
    confirmed: true,
  })
  assert.equal(badReorder.status, 400)

  const missing = await callRoute(getRoute, 'POST', '/my-memory/api/prompts', {
    action: 'update',
    id: 'gp-404',
    text: 'x',
    confirmed: true,
  })
  assert.equal(missing.status, 404)

  const deleted = await callRoute(getRoute, 'POST', '/my-memory/api/prompts', {
    action: 'delete',
    id: a.id,
    confirmed: true,
  })
  assert.equal(deleted.status, 200)
  assert.deepEqual(
    deleted.json.value.items.map((i) => i.title),
    ['中文思考', 'B'],
  )
  const deleteAgain = await callRoute(getRoute, 'POST', '/my-memory/api/prompts', {
    action: 'delete',
    id: a.id,
    confirmed: true,
  })
  assert.equal(deleteAgain.status, 404, 'deleting a missing id → 404')
})

test('the prompts endpoint never touches memory, and /memory never touches prompts', async () => {
  const { getRoute } = await boot()
  const prompt = await addPrompt(getRoute, { title: '指令', text: '必须使用中文' })
  const memory = await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'global',
    desc: '用户偏好用 pnpm',
    confirmed: true,
  })
  assert.equal(memory.status, 200)

  const memList = await callRoute(getRoute, 'GET', '/my-memory/api/memory?scope=global')
  assert.equal(memList.json.value.items.length, 1, 'memory holds exactly its own entry')
  assert.equal(memList.json.value.items[0].desc, '用户偏好用 pnpm')
  assert.ok(!JSON.stringify(memList.json).includes('必须使用中文'), 'prompts are not in the memory payload')

  const promptList = await callRoute(getRoute, 'GET', '/my-memory/api/prompts')
  assert.equal(promptList.json.value.items.length, 2, 'seed + the added prompt, nothing from memory')
  assert.ok(!JSON.stringify(promptList.json).includes('用户偏好用 pnpm'), 'memory is not in the prompts payload')

  // 删掉记忆不影响提示词；删掉提示词不影响记忆
  await callRoute(getRoute, 'POST', '/my-memory/api/memory', {
    action: 'delete',
    scope: 'global',
    id: memList.json.value.items[0].id,
    confirmed: true,
  })
  await callRoute(getRoute, 'POST', '/my-memory/api/prompts', { action: 'delete', id: prompt.id, confirmed: true })
  const promptsAfter = await callRoute(getRoute, 'GET', '/my-memory/api/prompts')
  assert.deepEqual(
    promptsAfter.json.value.items.map((i) => i.title),
    ['中文思考'],
    'the seed prompt survived the memory delete; only the explicitly deleted prompt is gone',
  )
  const memoryAfter = await callRoute(getRoute, 'GET', '/my-memory/api/memory?scope=global')
  assert.deepEqual(memoryAfter.json.value.items, [], 'memory stayed deleted')
})

test('memory_query never returns prompts (retrieval isolation)', async () => {
  let queryTool
  const { getRoute } = await boot({
    tools: {
      register: (tool) => {
        if (tool.name === 'memory_query') queryTool = tool
        return () => {}
      },
    },
  })
  await addPrompt(getRoute, { title: '指令', text: '必须使用中文' })
  assert.ok(queryTool, 'memory_query registered')
  const value = await queryTool.execute({ scope: 'global' }, {})
  assert.deepEqual(value.items, [], 'a prompt is not a memory: the query tool stays empty')
  const rendered = queryTool.output.render({ scope: 'global' }, value)[0].text
  assert.ok(!rendered.includes('必须使用中文'), 'the query render never exposes prompts')
})

test('prompts persist in their own file and never in the memory files', async () => {
  const { getRoute } = await boot()
  await addPrompt(getRoute, { title: '指令', text: '持久化断言' })
  const items = (await callRoute(getRoute, 'GET', '/my-memory/api/prompts')).json.value.items
  assert.ok(items.some((i) => i.text === '持久化断言'))
  assert.ok(promptsFile().endsWith('/memory/prompts.json'), 'dedicated prompts file')
  const memoryList = await callRoute(getRoute, 'GET', '/my-memory/api/memory?scope=global')
  assert.deepEqual(memoryList.json.value.items, [], 'nothing leaked into memory.json')
})
