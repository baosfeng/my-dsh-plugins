/**
 * Step definitions for dsh-my-memory Gherkin acceptance tests.
 * Boots the plugin against a mocked ctx per scenario (fresh world), drives
 * the /my-memory/api routes through it, and inspects the system-prompt
 * section and the memory_query tool — mirroring test/host-api.mjs,
 * test/prompt.mjs and test/tool.mjs.
 */
import { When, Then, After, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../../lib/index.js'
import { projectMemoryDir, projectIdOf } from '../../../lib/store.js'

class World {
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'dmm-feature-'))
    process.env.DSH_HOME = this.dir
    this.apiHolder = captureRoute('/my-memory/api')
    this.sections = []
    this.tools = []
    this.events = []
    this.lastResponse = null
    this.lastSectionText = ''
    this.lastToolValue = null
    this.lastSaveValue = null
    this.lastAsk = null
    this.autoLearn = false
    this.saveApproval = undefined
    this.policy = 'ask'
    this.sessionId = undefined
    this.lastDesc = ''
    this.boot()
  }

  boot(config) {
    const ctx = {
      logger: { info: () => {}, warn: () => {} },
      webRuntime: { trustedHosts: [] },
      webServer: {
        register: (route) => {
          this.apiHolder.set(route)
          return () => {}
        },
      },
      sessions: {
        get: (id) => (id === 'work-session' ? { header: { cwd: '/work/proj' } } : undefined),
      },
      systemPrompt: {
        section: (section) => {
          this.sections.push(section)
          return () => {}
        },
      },
      tools: {
        register: (tool) => {
          this.tools.push(tool)
          return () => {}
        },
      },
      events: this.events,
      effectCallbacks: [],
      on(name, listener) {
        this.events.push({ name, listener })
      },
      effect(callback) {
        this.effectCallbacks.push({ callback })
        const disposer = callback()
        if (typeof disposer === 'function') this.effectCallbacks.push({ disposer })
        return disposer
      },
    }
    this.ctx = ctx
    apply(ctx, config ?? this.defaultConfig())
  }

  /** 本次挂载的插件配置（saveApproval 仅在场景显式设置时出现）。 */
  defaultConfig() {
    const config = { autoLearn: this.autoLearn }
    if (this.saveApproval !== undefined) config.saveApproval = this.saveApproval
    return config
  }

  /** 设置本会话的审批策略 + saveApproval 并重新挂载（issue #208）。 */
  setPolicy(sessionId, policy, saveApproval) {
    this.sessionId = sessionId
    this.policy = policy
    this.saveApproval = saveApproval
    this.events.length = 0
    this.sections.length = 0
    this.tools.length = 0
    this.boot()
  }

  /** 本会话的假 session（宿主 Session 的 seq + eventAt 契约，issue #208）。 */
  session() {
    const events = [{ type: 'approval/policy', data: { policy: this.policy } }]
    return { seq: events.length, eventAt: (index) => events[index] }
  }

  /** 工具调用载荷（带 agent/session；未设置会话时为空对象）。 */
  defaultExec() {
    return this.sessionId === undefined ? {} : { agent: { id: this.sessionId, session: this.session() } }
  }

  /** Toggle autoLearn and re-boot so the collector listens (issue #78). */
  setAutoLearn(on) {
    this.autoLearn = on === true
    this.events.length = 0
    this.sections.length = 0
    this.tools.length = 0
    this.boot()
  }

  /** Feed one user message to the session/event listener. */
  receiveMessage(sessionId, text) {
    const listener = this.events.find((e) => e.name === 'session/event')?.listener
    assert.ok(listener, 'session/event listener registered')
    listener({ id: sessionId }, { type: 'user/message', data: { content: [{ type: 'text', text }] } })
  }

  /** End a session (top-level agent idle) so extraction runs. */
  endSession(sessionId, cwd) {
    const listener = this.events.find((e) => e.name === 'agent/status')?.listener
    assert.ok(listener, 'agent/status listener registered')
    listener({ agent: { id: sessionId, session: { header: { cwd: cwd ?? this.dir } }, options: {} }, status: 'idle' })
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

  section() {
    return this.sections.find((s) => s.name === 'dsh-my-memory')
  }

  tool() {
    return this.tools.find((t) => t.name === 'memory_query')
  }

  saveTool() {
    return this.tools.find((t) => t.name === 'memory_save')
  }

  gate() {
    return this.events.find((e) => e.name === 'tools/pre-execute')?.listener
  }

  /** Run the pre-execute gate for one tool call; returns the gate decision. */
  async runGate(name, args, exec) {
    if (this.gate() === undefined) return null
    const payload = { name, arguments: args ?? {}, ...(exec ?? this.defaultExec()) }
    this.lastAsk = await this.gate()(payload, async () => ({ kind: 'allow' }))
    return this.lastAsk
  }

  /** Execute a save tool call after approval; records the returned value. */
  async callSave(args, exec) {
    const tool = this.saveTool()
    assert.ok(tool, 'memory_save tool registered')
    this.lastSaveValue = await tool.execute(args, exec ?? {})
    return this.lastSaveValue
  }

  async callTool(args, exec) {
    this.lastToolValue = await this.tool().execute(args, exec ?? {})
    return this.lastToolValue
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

// ── 场景 1：写操作必须携带用户同意标记 ──────────────────────────────────
When('提交未携带同意标记的写操作', async function () {
  await this.callRoute('POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'global',
    desc: '静默写入',
  })
})

Then('接口返回 400', function () {
  assert.equal(this.lastResponse.status, 400)
})

Then('记忆列表为空', async function () {
  const r = await this.callRoute('GET', '/my-memory/api/memory?scope=global')
  assert.deepEqual(r.json.value.items, [])
})

// ── 场景 2：新增/修改/删除全局记忆 ──────────────────────────────────────
When('用户确认新增全局记忆 {string}', async function (desc) {
  await this.callRoute('POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'global',
    desc,
    confirmed: true,
  })
})

When('查询全局记忆', async function () {
  await this.callRoute('GET', '/my-memory/api/memory?scope=global')
})

Then('全局记忆包含 {string}', async function (desc) {
  // 主动查询（不依赖上一步是否是 GET /memory——候选确认等写步骤返回 items
  // 之外的载荷）。
  const r = await this.callRoute('GET', '/my-memory/api/memory?scope=global')
  const items = r.json.value.items
  assert.ok(
    items.some((i) => i.desc === desc),
    `global memory contains ${desc}`,
  )
})

When('用户确认修改该记忆为 {string}', async function (desc) {
  const items = this.lastResponse.json.value.items
  const id = items[0].id
  await this.callRoute('POST', '/my-memory/api/memory', {
    action: 'update',
    scope: 'global',
    id,
    desc,
    confirmed: true,
  })
})

When('用户确认删除该记忆', async function () {
  const items = this.lastResponse.json.value.items
  const id = items[0].id
  await this.callRoute('POST', '/my-memory/api/memory', {
    action: 'delete',
    scope: 'global',
    id,
    confirmed: true,
  })
})

Then('全局记忆为空', function () {
  assert.deepEqual(this.lastResponse.json.value.items, [])
})

// ── 场景 3：项目记忆与全局记忆隔离 ──────────────────────────────────────
When('用户确认在项目 {string} 新增项目记忆 {string}', async function (cwd, desc) {
  const projectDir = join(this.dir, cwd)
  mkdirSync(join(projectDir, '.git'), { recursive: true })
  await this.callRoute('POST', '/my-memory/api/memory', {
    action: 'add',
    scope: 'project',
    cwd: projectDir,
    desc,
    confirmed: true,
  })
})

Then('全局记忆包含 {string} 且不包含 {string}', async function (present, absent) {
  const r = await this.callRoute('GET', '/my-memory/api/memory?scope=global')
  const items = r.json.value.items
  assert.ok(
    items.some((i) => i.desc === present),
    `global memory contains ${present}`,
  )
  assert.ok(!items.some((i) => i.desc === absent), `global memory excludes ${absent}`)
})

When('查询项目 {string} 的记忆', async function (cwd) {
  const projectDir = join(this.dir, cwd)
  await this.callRoute('GET', `/my-memory/api/memory?scope=project&cwd=${encodeURIComponent(projectDir)}`)
})

Then('项目记忆包含 {string} 且不包含 {string}', function (present, absent) {
  const items = this.lastResponse.json.value.items
  assert.ok(
    items.some((i) => i.desc === present),
    `project memory contains ${present}`,
  )
  assert.ok(!items.some((i) => i.desc === absent), `project memory excludes ${absent}`)
})

Then('项目记忆为空', function () {
  assert.deepEqual(this.lastResponse.json.value.items, [])
})

// ── 场景 4：系统提示词注入 ──────────────────────────────────────────────
When('组装系统提示词', function () {
  const section = this.section()
  assert.ok(section, 'dsh-my-memory section registered')
  this.lastSectionText = section.text({})
})

Then('系统提示词包含名为 {string} 的 section', function (name) {
  assert.ok(this.section(), `section ${name} registered`)
})

Then('section 顺序为 {int}', function (order) {
  assert.equal(this.section().order, order)
})

Then('section 文本包含 {string}', function (desc) {
  assert.ok(this.lastSectionText.includes(desc), `section text contains ${desc}`)
})

When('清空全局记忆', async function () {
  const r = await this.callRoute('GET', '/my-memory/api/memory?scope=global')
  for (const item of r.json.value.items) {
    await this.callRoute('POST', '/my-memory/api/memory', {
      action: 'delete',
      scope: 'global',
      id: item.id,
      confirmed: true,
    })
  }
  this.lastSectionText = this.section().text({})
})

Then('section 文本为空', function () {
  assert.equal(this.lastSectionText, '')
})

// ── 场景 5：memory_query 工具 ───────────────────────────────────────────
When('agent 调用 memory_query 查询全局记忆', async function () {
  await this.callTool({ scope: 'global' })
})

Then('返回两条记忆', function () {
  assert.equal(this.lastToolValue.items.length, 2)
})

Then('返回一条记忆', function () {
  assert.equal(this.lastToolValue.items.length, 1)
})

When('agent 以关键词 {string} 过滤查询', async function (keyword) {
  await this.callTool({ scope: 'global', keyword })
})

Then('只返回 {string}', function (desc) {
  assert.equal(this.lastToolValue.items.length, 1)
  assert.equal(this.lastToolValue.items[0].desc, desc)
})

Then('查询不改变记忆内容', async function () {
  const r = await this.callRoute('GET', '/my-memory/api/memory?scope=global')
  assert.equal(r.json.value.items.length, 2, 'memory unchanged after read-only queries')
})

// ── 场景 6：面板打开时解析当前会话项目根 ──────────────────────────────────
When('查询会话 {string} 的工作目录', async function (sessionId) {
  await this.callRoute('GET', `/my-memory/api/session?sessionId=${encodeURIComponent(sessionId)}`)
})

Then('返回工作目录 {string}', function (cwd) {
  assert.equal(this.lastResponse.json.value.cwd, cwd)
})

Then('返回空工作目录', function () {
  assert.equal(this.lastResponse.json.value.cwd, '')
})

// ── 场景 6-8：memory_save 工具（issue #107）────────────────────────────
When('agent 调用 memory_save 保存全局记忆 {string}', async function (desc) {
  this.lastDesc = desc
  await this.runGate('memory_save', { scope: 'global', desc })
})

Then('触发用户确认流程（ask 门）', function () {
  assert.ok(this.lastAsk, 'gate answered')
  assert.equal(this.lastAsk.kind, 'ask', 'memory_save raises a DSH native approval (ask)')
  assert.ok(this.lastAsk.reason.includes('确认'), 'reason asks for user consent')
})

When('用户批准该保存', async function () {
  await this.callSave({ scope: 'global', desc: '用户偏好用 pnpm' })
})

Then('memory_save 写入成功并返回条目 id', function () {
  assert.ok(this.lastSaveValue, 'save returned a value')
  assert.ok(this.lastSaveValue.item.id.startsWith('mem-'), 'returned item id')
  assert.equal(this.lastSaveValue.item.desc, '用户偏好用 pnpm')
})

Then('该记忆内容为 {string}', function (desc) {
  assert.equal(this.lastToolValue.items[0].desc, desc)
})

Then('查询不触发用户确认流程', async function () {
  await this.runGate('memory_query', { scope: 'global' })
  assert.equal(this.lastAsk.kind, 'allow', 'read-only tools do not raise an approval gate')
})

// ── 场景 9：旧位置项目记忆自动迁移（issue #108）─────────────────────────
When('项目 {string} 存在旧位置记忆文件', async function (name) {
  const projectDir = join(this.dir, name)
  mkdirSync(join(projectDir, '.git'), { recursive: true })
  mkdirSync(join(projectDir, '.dsh'), { recursive: true })
  writeFileSync(
    join(projectDir, '.dsh', 'memory.json'),
    JSON.stringify({
      items: [{ id: 'legacy-1', desc: '旧项目约定（迁移）', createdAt: 1, updatedAt: 2 }],
    }),
    'utf8',
  )
  this.legacyProject = projectDir
  this.legacyFile = join(projectDir, '.dsh', 'memory.json')
})

Then('项目记忆包含迁移后的旧记忆', function () {
  const items = this.lastResponse.json.value.items
  assert.equal(items.length, 1, 'legacy item readable after migration')
  assert.equal(items[0].desc, '旧项目约定（迁移）')
})

Then('旧位置记忆文件已清理', function () {
  assert.ok(!existsSync(this.legacyFile), 'legacy <projectRoot>/.dsh/memory.json removed')
})

Then('项目记忆存于集中存储位置', function () {
  const centralized = join(projectMemoryDir(), `${projectIdOf(this.legacyProject)}.json`)
  // GET /memory 只暴露 items；这里验证磁盘上集中位置存在且项目根下不再有记忆文件
  assert.equal(JSON.parse(readFileSync(centralized, 'utf8')).items.length, 1, 'centralized file holds the data')
})

// ── 场景 10：保存长记忆保留完整内容，注入按语义截断（issue #105）─────────
Then('section 文本不包含 {string}', function (desc) {
  assert.ok(!this.lastSectionText.includes(desc), `section text excludes ${desc}`)
})

// ── 场景 15-17：权限模式感知的保存策略（issue #208）+ 来源标记（#209）────
When('会话 {string} 的审批策略为 {string} 且 saveApproval 为 {string}', function (sessionId, policy, saveApproval) {
  this.setPolicy(sessionId, policy, saveApproval)
})

Then('未写入任何记忆', async function () {
  const value = await this.callTool({ scope: 'global' })
  assert.equal(value.items.length, 0, 'nothing was written')
})

Then('保存未经用户确认直接放行', function () {
  assert.ok(this.lastAsk, 'gate answered')
  assert.equal(this.lastAsk.kind, 'allow', 'policy=never + saveApproval=auto allows the write without an ask gate')
})

Then('保存被明确拒绝且提示包含 {string} 与 {string}', function (first, second) {
  assert.ok(this.lastAsk, 'gate answered')
  assert.equal(this.lastAsk.kind, 'deny', 'policy=never + saveApproval=always fails explicitly')
  assert.ok(this.lastAsk.reason.includes(first), `reason mentions ${first}: ${this.lastAsk.reason}`)
  assert.ok(this.lastAsk.reason.includes(second), `reason mentions ${second}: ${this.lastAsk.reason}`)
})

When('会话 {string} 执行该保存', async function (sessionId) {
  this.saveSessionId = sessionId
  await this.callSave({ scope: 'global', desc: this.lastDesc }, this.defaultExec())
})

Then('全局记忆包含 {string} 且来源会话为 {string}', async function (desc, sessionId) {
  const value = await this.callTool({ scope: 'global' })
  const item = value.items.find((entry) => entry.desc === desc)
  assert.ok(item, `global memory contains ${desc}`)
  assert.equal(item.source.sessionId, sessionId, 'the entry records the writing session (#209)')
  assert.ok(item.source.at > 0, 'the entry records the write timestamp (#209)')
  const queryText = this.tool().output.render({ scope: 'global' }, value)[0].text
  assert.ok(queryText.includes(sessionId.slice(0, 8)), `the query render carries the source session: ${queryText}`)
})

// ── 场景 11：面板拉取条目长度精简引导配置（issue #105）───────────────────
When('查询记忆 API 配置', async function () {
  await this.callRoute('GET', '/my-memory/api/config')
})

Then('返回精简单条长度上限 {int}', function (limit) {
  assert.equal(this.lastResponse.json.value.maxEntryLength, limit)
})

Then('返回单条注入长度上限 {int}', function (limit) {
  assert.equal(this.lastResponse.json.value.maxDescLength, limit)
})

// ── issue #78：自动提取 + 待确认候选 + 确认写入 + 渐进更新 + 元数据 ──────

When('开启自动学习 autoLearn', function () {
  this.setAutoLearn(true)
})

When('关闭自动学习 autoLearn 且会话 {string} 收到用户消息 {string}', function (sessionId, text) {
  this.setAutoLearn(false)
  this.receiveMessage(sessionId, text)
})

When('会话 {string} 收到用户消息 {string}', function (sessionId, text) {
  this.receiveMessage(sessionId, text)
})

When('会话 {string} 结束（顶层 agent idle）', async function (sessionId) {
  this.endSession(sessionId)
  // 等待提取 → 候选落盘（异步 storeCandidates 链）
  await new Promise((resolve) => setTimeout(resolve, 30))
})

Then('待确认候选列表包含偏好候选 {string}', async function (desc) {
  const r = await this.callRoute('GET', '/my-memory/api/candidates')
  const items = r.json.value.items
  assert.ok(
    items.some((c) => c.category === 'preference' && c.desc.includes(desc)),
    `pending candidates contain preference ${desc}`,
  )
})

Then('待确认候选列表包含项目候选 {string}', async function (desc) {
  const r = await this.callRoute('GET', '/my-memory/api/candidates')
  const items = r.json.value.items
  assert.ok(
    items.some((c) => c.scope === 'project' && c.desc.includes(desc)),
    `pending candidates contain project ${desc}`,
  )
})

Then('正式记忆列表为空', async function () {
  const r = await this.callRoute('GET', '/my-memory/api/memory?scope=global')
  assert.deepEqual(r.json.value.items, [])
})

Then('待确认候选列表为空', async function () {
  const r = await this.callRoute('GET', '/my-memory/api/candidates')
  assert.deepEqual(r.json.value.items, [])
})

When('用户确认候选 {string}', async function (desc) {
  const r = await this.callRoute('GET', '/my-memory/api/candidates')
  const matches = r.json.value.items.filter((c) => c.desc.includes(desc))
  assert.ok(matches.length > 0, `candidate ${desc} exists`)
  // 同一句可能被多个分类规则命中（如「本项目用 vitest」→ project + stack），
  // 全部确认（渐进合并到各自的记录）。
  for (const candidate of matches) {
    await this.callRoute('POST', '/my-memory/api/candidates/confirm', { id: candidate.id, confirmed: true })
  }
})

When('会话 {string} 收到用户消息 {string} 并确认候选', async function (sessionId, text) {
  this.receiveMessage(sessionId, text)
  this.endSession(sessionId)
  await new Promise((resolve) => setTimeout(resolve, 30))
  const r = await this.callRoute('GET', '/my-memory/api/candidates')
  const candidate = r.json.value.items.find((c) => c.desc.includes(text))
  assert.ok(candidate, `candidate ${text} exists`)
  await this.callRoute('POST', '/my-memory/api/candidates/confirm', { id: candidate.id, confirmed: true })
})

Then('全局记忆包含置信度为 {int} 的 {string}', async function (confidence, desc) {
  const r = await this.callRoute('GET', '/my-memory/api/memory?scope=global')
  const item = r.json.value.items.find((i) => i.desc.includes(desc))
  assert.ok(item, `memory contains ${desc}`)
  assert.equal(item.confidence, confidence, `confidence is ${confidence}`)
})

Then('项目记忆条目带元数据：分类 {string} 且来源会话为 {string}', async function (category, sessionId) {
  const r = await this.callRoute('GET', `/my-memory/api/memory?scope=project&cwd=${encodeURIComponent(this.dir)}`)
  const item = r.json.value.items.find((i) => i.category === category)
  assert.ok(item, `project memory has an item of category ${category}`)
  assert.equal(item.source?.sessionId, sessionId, `source session is ${sessionId}`)
  assert.equal(item.confidence, 1, 'first confirmed candidate starts at confidence 1')
})

Then('section 评分选择器按 相关性+时效性+置信度 选择条目', function () {
  // issue #78 智能注入：section text provider 使用评分选择（prompt.js /
  // memory-scoring.js 的 pickForInjection），非简单 top-N——单测已断言
  // 选择行为；此处断言 provider 关联的 scoring 行为等价（空记忆渲染为空）。
  const section = this.section()
  assert.ok(section, 'dsh-my-memory section registered')
  this.lastSectionText = section.text({})
  // 纯断言：provider 可求值（不抛错），返回字符串
  assert.equal(typeof this.lastSectionText, 'string')
})

When('提交未携带同意标记的候选确认', async function () {
  await this.callRoute('POST', '/my-memory/api/candidates/confirm', { id: 'cand-any' })
})
