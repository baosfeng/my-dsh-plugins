import { test, afterEach, beforeEach } from 'vitest'
/**
 * dsh-my-remote — 设置页配置端点（GET / PUT /remote/api/settings）单测（issue #385）。
 *
 * 需求：宿主「设置 → 插件 → 远程控制」面板可视化编辑本插件的 4 项配置
 * （apiToken / askTimeoutMs / approvalTimeoutMs / webhooks[]）→ 保存写回 profile
 * 层 patch 文件（行 id `remote`，与 cordis.patch.yml 的插件行一致）并立即热生效。
 *
 * 本文件钉住七条底线：
 *  1. **路由注册在常驻 root**（`ctx.root.inject(['webServer'], …)`）+ 重复 apply
 *     去重：注册挂插件自身 fiber 会被 loader 回收 → 路由 404；用 `ctx.get('webServer')`
 *     一次性取值在服务晚就绪时永久错过（严格就绪检查 + 无重试）。两种写法都必须
 *     在桩上失败（桩按 cordis 4 真实契约构造）。
 *  2. **写回先合并该行已有键**：writePatchConfig 是「删同 id 旧条目 → 追加新条目」，
 *     不合并会抹掉用户手写的 `end`/`ask`/`approval` 等其它配置项。
 *  3. **用户手写的 webhooks 嵌套列表不被写坏**：extractConfig 只解析标量/flow 数组，
 *     嵌套 webhook 条目必须由本模块自行保留（否则保存一次就丢光用户的 webhook）。
 *  4. **非法值只忽略该字段并回退当前值，不整单拒绝**（一次提交四项，因一个字段非法
 *     丢掉其它合法修改 = 用户以为保存无效）。
 *  5. **apiToken 掩码语义**：GET 绝不回显完整 token（只回 `apiTokenSet` 布尔）；
 *     PUT 未修改（`apiToken === undefined` 或空串）→ 保持原值。
 *  6. **保存即热生效**：PUT 成功后同一 handler 的 GET 立即反映新值，且 events /
 *     channels 读到的 options 同步更新。
 *  7. 既有安全契约不变：围栏对设置端点同样生效（403 且不落盘）；未知 path / 方法 404。
 *
 * 所有落盘都写进临时 DSH_HOME，真实 ~/.dsh 绝不触碰。等待一律走条件轮询 / yieldLoop
 * （dsh-shared/test-kit/wait.mjs），**无固定 sleep**。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentProfile, extractConfig, patchFileOf } from 'dsh-shared'
import { yieldLoop, waitFor } from '../../dsh-shared/test-kit/wait.mjs'
import { apply } from '../lib/index.js'
import { SETTINGS_ROUTE_PREFIX, TOKEN_MASK } from '../lib/settings.js'
import { assertIsolatedPatchPath, isolatedHome } from './helpers/isolated-home.mjs'

const SETTINGS_PATH = `${SETTINGS_ROUTE_PREFIX}/settings`

// ── 按 cordis 4 真实契约构造的 host ctx 桩 ──────────────────────────────
// 与 plugins/dsh-think-zh-expand/test/helpers/host-ctx.mjs 同族（本插件只多一个
// webRuntime 服务查询），关键复刻点见上方文件头第 1 条。
function createHostCtx({ webServer = 'ready' } = {}) {
  const routes = []
  const logs = []
  const pluginEffects = []
  const rootEffects = []
  const pending = []
  const listeners = {}
  let ready = webServer === 'ready'

  const service = {
    register(route) {
      if (routes.some((r) => r.kind === route.kind && r.path === route.path)) {
        throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
      }
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }
  const webRuntime = { trustedHosts: [] }
  const makeLogger = () => ({
    info: (m) => logs.push(`info:${m}`),
    warn: (m) => logs.push(`warn:${m}`),
    error: (m) => logs.push(`error:${m}`),
  })
  const flushPending = () => {
    if (!ready) return
    for (const start of pending.splice(0)) queueMicrotask(start)
  }
  const scopedInject = (bucket) => (names, callback) => {
    if (!Array.isArray(names) || !names.includes('webServer')) {
      throw new Error(`host-ctx stub: unsupported inject deps (${String(names)})`)
    }
    pending.push(() => callback(makeScope(bucket)))
    flushPending()
    return { dispose: () => {} }
  }
  const makeScope = (bucket) => ({
    webServer: service,
    logger: makeLogger(),
    get: (name) => (name === 'webRuntime' ? webRuntime : name === 'webServer' && ready ? service : undefined),
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') bucket.push(dispose)
      return dispose
    },
  })
  const rootCtx = {
    logger: makeLogger(),
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') rootEffects.push(dispose)
      return dispose
    },
    get: (name) => (name === 'webRuntime' ? webRuntime : name === 'webServer' && ready ? service : undefined),
    inject: scopedInject(rootEffects),
    on: (event, handler) => {
      ;(listeners[event] ??= []).push(handler)
      return () => {}
    },
  }
  rootCtx.root = rootCtx
  const ctx = {
    logger: makeLogger(),
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') pluginEffects.push(dispose)
      return dispose
    },
    get: (name) => (name === 'webRuntime' ? webRuntime : name === 'webServer' && ready ? service : undefined),
    inject: scopedInject(pluginEffects),
    on: (event, handler) => {
      ;(listeners[event] ??= []).push(handler)
      return () => {}
    },
    root: rootCtx,
  }
  return {
    ctx,
    routes,
    logs,
    listeners,
    pluginEffects,
    rootEffects,
    provideWebServer() {
      ready = true
      flushPending()
    },
    recyclePluginFiber() {
      while (pluginEffects.length > 0) pluginEffects.pop()()
    },
    settle: () => new Promise((resolve) => setImmediate(resolve)),
  }
}

// ── 临时 DSH_HOME（每用例一个，断言失败也不泄漏环境变量）──────────────
// 双保险：`beforeEach` 先把整个用例期间的 DSH_HOME 指到隔离目录（即使某个用例
// 忘了 tempHome，写入也不会落到真实 ~/.dsh）；`tempHome` 再给单用例一个独立目录。
// 这是真实事故（测试覆盖真实 cordis.patch.yml）的防复发改造之一。
const cleanups = []
let suiteHome = null
beforeEach(() => {
  suiteHome = isolatedHome('dsh-my-remote-suite-')
})
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
  if (suiteHome !== null) {
    suiteHome.restore()
    suiteHome = null
  }
})

function tempHome(seed) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-my-remote-settings-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const patchFile = patchFileOf(currentProfile())
  if (seed !== undefined) {
    // fail-closed：目标必须在临时目录内、且不在真实 ~/.dsh 下，否则抛错中止。
    assertIsolatedPatchPath(patchFile)
    mkdirSync(join(home, 'profiles', currentProfile()), { recursive: true })
    writeFileSync(patchFile, seed)
  }
  cleanups.push(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  })
  return { home, patchFile }
}

/** 最小响应桩：记录 writeHead/end。 */
function fakeResponse() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(payload) {
      this.body = payload ?? ''
    },
  }
}

/** 最小请求桩：默认来自本机 host 的 GET；空 body 抛错（同 dsh-shared readJsonBody 的坏 JSON 路径）。 */
function fakeRequest({ method = 'GET', url = SETTINGS_PATH, headers = { host: '127.0.0.1:3080' }, body = '' } = {}) {
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body === '') throw new SyntaxError('Unexpected end of JSON input')
      yield body
    },
  }
}

async function call(handler, request) {
  const response = fakeResponse()
  await handler(request, response)
  return {
    status: response.status,
    headers: response.headers,
    json: response.body === '' ? null : JSON.parse(response.body),
  }
}

/** apply（webServer 就绪时机可配）并返回设置端点 handler。 */
async function boot(config, { webServer = 'ready', seed } = {}) {
  const env = tempHome(seed)
  const host = createHostCtx({ webServer })
  apply(host.ctx, config)
  if (webServer === 'late') host.provideWebServer()
  // inject 回调排在微任务里（cordis 真实行为）：先等一轮，再进条件轮询。
  await host.settle()
  const route = await waitFor(() => host.routes.find((r) => r.path === SETTINGS_ROUTE_PREFIX), {
    message: 'apply 必须注册设置配置路由（经 ctx.root.inject 局部等待 webServer）',
  })
  return { api: route, routes: host.routes, host, patchFile: env.patchFile }
}

/**
 * 从 patch 文件文本里取出该行 config 块（`  config:` 到文件末尾 / 下一个顶层条目）。
 * 用于验「嵌套 webhooks 与手写键没被写坏」——按行边界切，不依赖具体缩进宽度。
 */
function configBlock(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line === '  config:')
  if (start === -1) return ''
  const out = []
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- /.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n')
}

/** config 块里的 webhook url 列表（供「没被写坏」与重启闭环断言）。 */
function webhookUrls(text) {
  return configBlock(text)
    .split('\n')
    .filter((line) => line.trim().startsWith('url:'))
    .map((line) =>
      line
        .trim()
        .replace(/^url:\s*/, '')
        .replace(/^'|'$/g, ''),
    )
}

/**
 * patch 文件文本 → 该行插件 config（模拟 loader 重启后解析 patch 并传给 apply）。
 *
 * 标量走 dsh-shared 的 extractConfig；**嵌套 webhooks 它解析不了**（只认 4 空格
 * 标量行），这里按缩进补齐 —— 重启闭环必须真的把 webhooks 传回 apply，否则
 * 「重启后手写 webhook 仍在」这条断言测的是空气。
 */
function configForApply(text) {
  const config = extractConfig(text, 'remote') ?? {}
  const lines = configBlock(text).split('\n')
  const start = lines.findIndex((line) => line.trim() === 'webhooks:')
  if (start === -1) return config
  const webhooks = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.startsWith('      ')) break
    const item = line.match(/^\s*- ([A-Za-z0-9_]+): ?(.*)$/)
    const field = line.match(/^\s*([A-Za-z0-9_]+): ?(.*)$/)
    const match = item ?? field
    if (match === null) continue
    if (item !== null) webhooks.push({})
    const entry = webhooks[webhooks.length - 1]
    if (entry === undefined) continue
    const raw = match[2].replace(/^'|'$/g, '')
    entry[match[1]] = raw.startsWith('[')
      ? raw
          .slice(1, -1)
          .split(',')
          .map((part) => part.trim().replace(/^'|'$/g, ''))
      : raw === 'true'
        ? true
        : raw === 'false'
          ? false
          : raw
  }
  return { ...config, webhooks }
}

// ── 用例 ───────────────────────────────────────────────────────────────

test('路由注册在常驻 root 上：webServer 晚就绪也注册成功、插件 fiber 回收后仍在', async () => {
  const env = tempHome()
  const host = createHostCtx({ webServer: 'late' })
  apply(host.ctx, {})
  // 插件 fiber 被 loader 回收（真实：apply 返回后即发生）——路由不得随之消失
  host.recyclePluginFiber()
  assert.equal(
    host.routes.some((r) => r.path === SETTINGS_ROUTE_PREFIX),
    false,
    'webServer 未就绪时不注册（inject 子 fiber 处于 PENDING）',
  )
  host.provideWebServer()
  await host.settle()
  await host.settle()
  const route = await waitFor(() => host.routes.find((r) => r.path === SETTINGS_ROUTE_PREFIX), {
    message: 'webServer 晚就绪后 inject 回调补执行，路由注册成功',
  })
  assert.equal(route.kind, 'prefix', 'prefix 路由（client 按前缀拉取）')
  assert.ok(host.rootEffects.length > 0, '注册落到常驻 root 链上（挂插件自身 fiber 会被 loader 回收 → 真实环境 404）')
  assert.equal(host.pluginEffects.length, 0, '不得把设置路由注册挂在插件自身 fiber 上')
  // 重复 apply 去重：宿主 WebServer.register 对重复 (kind, path) 直接抛错
  assert.doesNotThrow(() => apply(host.ctx, {}), '重复 apply 不抛 duplicate route')
  await host.settle()
  assert.equal(host.routes.filter((r) => r.path === SETTINGS_ROUTE_PREFIX).length, 1, '重复 apply 后该路由恰好一条')
  void env
})

test('GET 契约：默认值 + apiToken 只回布尔（绝不回显完整 token）', async () => {
  const { api } = await boot({})
  const res = await call(api.handler, fakeRequest())
  assert.equal(res.status, 200, 'GET → 200')
  assert.equal(res.headers['content-type'], 'application/json', 'JSON content-type')
  assert.deepEqual(
    res.json.value,
    { apiTokenSet: false, askTimeoutMs: 0, approvalTimeoutMs: 0, webhooks: [] },
    '默认值：两个超时 0、无 webhook、未配置 token',
  )
  assert.equal(TOKEN_MASK, '••••••••', '掩码常量固定（client 端显示「已配置」用）')
  assert.ok(!('apiToken' in res.json.value), 'GET 响应里没有 apiToken 字段（不回显完整 token）')

  const withToken = await boot({ apiToken: 'super-secret-token' })
  const masked = await call(withToken.api.handler, fakeRequest())
  assert.equal(masked.json.value.apiTokenSet, true, '配置了 token → apiTokenSet=true')
  assert.ok(
    !JSON.stringify(masked.json).includes('super-secret-token'),
    '响应体任何位置都不得出现 token 明文：' + masked.json.body,
  )
})

test('PUT 写回 profile patch（行 id = remote）并立即热生效', async () => {
  const { api, patchFile } = await boot({})
  const saved = await call(
    api.handler,
    fakeRequest({
      method: 'PUT',
      body: JSON.stringify({
        apiToken: 'tok-123',
        askTimeoutMs: 5000,
        approvalTimeoutMs: 7000,
        webhooks: [{ name: '中转', url: 'https://relay.example.com/hook', events: ['ask'], enabled: true }],
      }),
    }),
  )
  assert.equal(saved.status, 200, '合法 payload → 200')
  assert.equal(saved.json.ok, true, 'ok=true')

  assert.ok(existsSync(patchFile), 'patch 文件已创建')
  const text = readFileSync(patchFile, 'utf8')
  assert.ok(text.includes('- id: remote'), '写回行 id = remote（与 cordis.patch.yml 一致）')
  const config = extractConfig(text, 'remote')
  assert.equal(config.apiToken, 'tok-123', 'token 落盘')
  assert.equal(config.askTimeoutMs, 5000, 'askTimeoutMs 落盘')
  assert.equal(config.approvalTimeoutMs, 7000, 'approvalTimeoutMs 落盘')
  assert.deepEqual(webhookUrls(text), ['https://relay.example.com/hook'], 'webhook 条目落盘')

  // 保存即生效：同一 handler 的 GET 立刻反映新值
  const after = await call(api.handler, fakeRequest())
  assert.equal(after.json.value.askTimeoutMs, 5000, '热生效：askTimeoutMs 立即更新')
  assert.equal(after.json.value.approvalTimeoutMs, 7000, '热生效：approvalTimeoutMs 立即更新')
  assert.equal(after.json.value.apiTokenSet, true, '热生效：token 置位')
  assert.equal(after.json.value.webhooks.length, 1, '热生效：webhook 列表立即更新')

  // 重启闭环：patch 里的值被下一次 apply 读到
  const restarted = await boot({
    ...extractConfig(text, 'remote'),
    webhooks: [{ name: '中转', url: 'https://relay.example.com/hook' }],
  })
  const reloaded = await call(restarted.api.handler, fakeRequest())
  assert.equal(reloaded.json.value.askTimeoutMs, 5000, '重启后 askTimeoutMs 从 patch 读回')
})

test('写回先合并该行已有键：用户手写的 end/ask/approval 与其它插件行都不被抹掉', async () => {
  const seed = [
    '- id: some-other-plugin',
    '  config:',
    '    keep: 1',
    '- id: remote',
    '  config:',
    '    end: false',
    '    ask: false',
    '    approval: true',
    "    handWritten: 'keep-me'",
    '',
  ].join('\n')
  const { api, patchFile } = await boot(undefined, { seed })
  const saved = await call(api.handler, fakeRequest({ method: 'PUT', body: JSON.stringify({ askTimeoutMs: 1234 }) }))
  assert.equal(saved.status, 200, '合法 payload → 200')
  const text = readFileSync(patchFile, 'utf8')
  const config = extractConfig(text, 'remote')
  assert.equal(config.askTimeoutMs, 1234, '本次修改落盘')
  assert.equal(config.end, false, '用户手写的 end 保留（不合并会丢）')
  assert.equal(config.ask, false, '用户手写的 ask 保留')
  assert.equal(config.approval, true, '用户手写的 approval 保留')
  assert.equal(config.handWritten, 'keep-me', '用户手写的未知键保留')
  assert.deepEqual(extractConfig(text, 'some-other-plugin'), { keep: 1 }, '其它插件的行原样保留')
  assert.equal(text.split('- id: remote').length - 1, 1, '该行 id 恰好一条（不产生幽灵行）')
})

test('用户手写的 webhooks 嵌套列表：未提交该字段时原样保留，不整单重写', async () => {
  const seed = [
    '- id: remote',
    '  config:',
    '    askTimeoutMs: 100',
    '    webhooks:',
    '      - name: 手写渠道',
    '        url: https://hand.example.com/hook',
    "        events: ['ask', 'approval']",
    '        enabled: true',
    '        headers:',
    "          Authorization: 'Bearer abc'",
    '',
  ].join('\n')
  const { api, patchFile } = await boot(undefined, { seed })
  const saved = await call(api.handler, fakeRequest({ method: 'PUT', body: JSON.stringify({ askTimeoutMs: 200 }) }))
  assert.equal(saved.status, 200)
  const text = readFileSync(patchFile, 'utf8')
  const block = configBlock(text)
  assert.ok(block.includes('https://hand.example.com/hook'), '手写 webhook url 保留：\n' + text)
  assert.ok(block.includes('手写渠道'), '手写 webhook 名称保留')
  assert.ok(block.includes('Bearer abc'), 'webhook 自定义 headers 保留（写坏 = 用户渠道鉴权失效）')
  assert.equal(extractConfig(text, 'remote').askTimeoutMs, 200, '本次修改落盘')
  // 重启闭环：手写 webhook 被下一次 apply 读回（loader 重启后会解析 patch 再 apply）
  const restarted = await boot(configForApply(text), { seed: text })
  const reloaded = await call(restarted.api.handler, fakeRequest())
  assert.equal(
    reloaded.json.value.webhooks.length,
    1,
    '重启后手写 webhook 仍在：' + JSON.stringify(reloaded.json.value),
  )
  assert.equal(reloaded.json.value.webhooks[0].url, 'https://hand.example.com/hook', '重启后 url 一致')
  assert.deepEqual(webhookUrls(text), ['https://hand.example.com/hook'], '该行 webhook url 恰好一条')
})

test('发来的 webhook 未带 headers 时按名称继承原条目（隐藏字段不被抹掉）', async () => {
  const seed = [
    '- id: remote',
    '  config:',
    '    webhooks:',
    '      - name: 中转',
    '        url: https://relay.example.com/hook',
    '        headers:',
    "          Authorization: 'Bearer keep'",
    '',
  ].join('\n')
  const { api, patchFile } = await boot(undefined, { seed })
  const saved = await call(
    api.handler,
    fakeRequest({
      method: 'PUT',
      body: JSON.stringify({
        webhooks: [{ name: '中转', url: 'https://relay.example.com/v2', events: ['ask'], enabled: false }],
      }),
    }),
  )
  assert.equal(saved.status, 200)
  const text = readFileSync(patchFile, 'utf8')
  assert.ok(text.includes('Bearer keep'), '同名单条的 headers 被继承（不丢鉴权头）：\n' + text)
  assert.ok(text.includes('https://relay.example.com/v2'), '本次修改的 url 落盘')
  assert.ok(text.includes('enabled: false'), 'enabled 落盘')
})

test('apiToken 掩码语义：未提交 / 空串 → 保持原值；显式新值才替换', async () => {
  const { api, patchFile } = await boot({ apiToken: 'original-token' })

  // 未提交该字段（编辑其它字段）
  await call(api.handler, fakeRequest({ method: 'PUT', body: JSON.stringify({ askTimeoutMs: 10 }) }))
  assert.equal(extractConfig(readFileSync(patchFile, 'utf8'), 'remote').apiToken, 'original-token', '未提交 → 原值保留')
  assert.equal((await call(api.handler, fakeRequest())).json.value.apiTokenSet, true, 'token 仍视为已配置')

  // 提交空串（client 的「留空则不修改」语义）
  await call(api.handler, fakeRequest({ method: 'PUT', body: JSON.stringify({ apiToken: '', askTimeoutMs: 11 }) }))
  assert.equal(extractConfig(readFileSync(patchFile, 'utf8'), 'remote').apiToken, 'original-token', '空串 → 原值保留')

  // 显式新值
  await call(api.handler, fakeRequest({ method: 'PUT', body: JSON.stringify({ apiToken: 'brand-new' }) }))
  assert.equal(extractConfig(readFileSync(patchFile, 'utf8'), 'remote').apiToken, 'brand-new', '显式新值 → 替换')
})

test('非法值只忽略该字段并回退当前值，不整单拒绝（合法字段照常落盘）', async () => {
  const { api, patchFile } = await boot({ askTimeoutMs: 42, approvalTimeoutMs: 43 })
  const saved = await call(
    api.handler,
    fakeRequest({
      method: 'PUT',
      body: JSON.stringify({
        askTimeoutMs: -5,
        approvalTimeoutMs: 'oops',
        webhooks: 'not-an-array',
        apiToken: 12345,
      }),
    }),
  )
  assert.equal(saved.status, 200, '非法字段 → 200（不整单拒绝）')
  const text = readFileSync(patchFile, 'utf8')
  const config = extractConfig(text, 'remote')
  assert.equal(config.askTimeoutMs, 42, '负数 → 回退当前值')
  assert.equal(config.approvalTimeoutMs, 43, '字符串 → 回退当前值')
  assert.ok(!text.includes('not-an-array'), '非法 webhooks 不落盘')
  assert.ok(!text.includes('12345'), '非字符串 token 不落盘')
  assert.ok(!text.includes('NaN'), '绝不写 NaN 进 patch')
})

test('请求体非对象 / 坏 JSON → 400 且不落盘；共享字段仍可单独提交', async () => {
  const { api, patchFile } = await boot({})
  for (const body of ['', 'null', '[]', '"x"', '42', 'not json']) {
    const res = await call(api.handler, fakeRequest({ method: 'PUT', body }))
    assert.equal(res.status, 400, `body=${JSON.stringify(body)} → 400`)
    assert.equal(res.json.ok, false, 'ok=false')
  }
  assert.equal(existsSync(patchFile), false, '非法 payload 一律不落盘')

  // 只提交 webhooks（其余项保持原值）
  const only = await call(
    api.handler,
    fakeRequest({ method: 'PUT', body: JSON.stringify({ webhooks: [{ name: 'a', url: 'https://a.example.com' }] }) }),
  )
  assert.equal(only.status, 200, '单项提交 → 200')
  assert.equal(only.json.value.webhooks.length, 1, 'webhook 列表更新')
  assert.equal(only.json.value.askTimeoutMs, 0, '未提交项保持原值')
})

test('保存失败 → 500 + ok:false，且内存生效值不被污染（不假装保存成功）', async () => {
  const env = tempHome()
  // patch 路径被目录占用 → 原子写的 rename 目标不是文件，落盘必然失败
  mkdirSync(env.patchFile, { recursive: true })
  const host = createHostCtx({})
  apply(host.ctx, { askTimeoutMs: 7 })
  await host.settle()
  await host.settle()
  const api = await waitFor(() => host.routes.find((r) => r.path === SETTINGS_ROUTE_PREFIX), {
    message: '设置路由已注册',
  })
  const failed = await call(api.handler, fakeRequest({ method: 'PUT', body: JSON.stringify({ askTimeoutMs: 999 }) }))
  assert.equal(failed.status, 500, '落盘失败 → 500')
  assert.equal(failed.json.ok, false, 'ok=false（client 据此提示保存失败）')
  assert.equal((await call(api.handler, fakeRequest())).json.value.askTimeoutMs, 7, '内存未被污染')
})

test('安全契约：围栏对 PUT/GET 同样生效（403 且不落盘），未知 path / 方法 404', async () => {
  const { api, patchFile } = await boot({})
  for (const headers of [
    { host: 'evil.example.com' },
    { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' },
    { host: '127.0.0.1:3080', origin: 'https://evil.example.com' },
  ]) {
    const res = await call(
      api.handler,
      fakeRequest({ method: 'PUT', headers, body: JSON.stringify({ askTimeoutMs: 1 }) }),
    )
    assert.equal(res.status, 403, `非可信来源 ${JSON.stringify(headers)} → 403`)
    assert.equal(res.json.ok, false, 'ok=false')
  }
  assert.equal(existsSync(patchFile), false, '403 一律不落盘')

  assert.equal(
    (await call(api.handler, fakeRequest({ url: `${SETTINGS_ROUTE_PREFIX}/other` }))).status,
    404,
    '未知 path → 404',
  )
  for (const method of ['DELETE', 'PATCH', 'POST']) {
    assert.equal((await call(api.handler, fakeRequest({ method }))).status, 404, `${method} 未实现 → 404`)
  }
})

test('热生效贯通：PUT 后 channels.list() 与 /remote/api/info 立即读到新 webhook', async () => {
  const { api, routes } = await boot({})
  const info = routes.find((r) => r.path === '/remote/api')
  assert.ok(info, '既有 /remote/api 路由仍在（设置页不得挤掉远程指令入口）')
  const before = await call(info.handler, fakeRequest({ url: '/remote/api/info' }))
  assert.equal(before.json.value.webhooks, 0, '初始无 webhook')

  await call(
    api.handler,
    fakeRequest({ method: 'PUT', body: JSON.stringify({ webhooks: [{ name: 'n', url: 'https://n.example.com' }] }) }),
  )
  await yieldLoop()
  const after = await call(info.handler, fakeRequest({ url: '/remote/api/info' }))
  assert.equal(after.json.value.webhooks, 1, '热生效：/remote/api/info 立即反映新 webhook 数（同一个 options 对象）')
})

test('行 id 与 cordis.patch.yml 的插件行一致（写错 = 幽灵行、配置永不生效）', async () => {
  const { api } = await boot({})
  await call(api.handler, fakeRequest({ method: 'PUT', body: JSON.stringify({ askTimeoutMs: 1 }) }))
  const patchYml = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.ok(patchYml.includes('- id: remote'), 'cordis.patch.yml 的插件行 id 是 remote')
  assert.notEqual(
    SETTINGS_ROUTE_PREFIX,
    '/remote/api',
    '设置前缀必须与既有 /remote/api 分开（同址会让后注册的 prefix 路由抛 duplicate）',
  )
})
