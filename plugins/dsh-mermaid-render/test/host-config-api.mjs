import { test } from 'vitest'
/**
 * dsh-mermaid-render — 宿主设置面板的配置 API 单测（issue #383）。
 *
 * 需求：设置页可视化编辑 `injectPrompt`（默认 true，**仅显式 false 关闭**），
 * 保存后写回 profile patch 文件（`- id: mermaid-render`，与 cordis.patch.yml
 * 的行 id 一致）并立即生效（撤销/注册 systemPrompt section），重启不丢。
 *
 * 本文件钉住六条底线：
 *  1. GET 返回当前生效值（含默认 true）；
 *  2. PUT 持久化到 profile patch + 内存更新 + 当前进程 section 状态跟随；
 *  3. **非法值回退默认（true），绝不把非法值写进 patch**（写坏配置会让下次
 *     apply 读到字符串 'yes' 之类的脏值）；请求体非对象则 400 且不落盘；
 *  4. 重启闭环：patch 里的值被下一次 apply 读到并生效；
 *  5. 安全围栏 / 404 兜底与既有路由契约（assets 静态路由不受影响）；
 *  6. 非法值/缺失字段不得静默关闭能力（fail-safe 方向是「保持开」）。
 *
 * 断言对象是构建产物 lib/index.js（CI 只跑产物，不跑构建）。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { extractConfig, patchFileOf } from 'dsh-shared'

const ROUTE_PATH = '/mermaid-render/api'
const ASSET_ROUTE_PATH = '/mermaid-render/assets'
const ROW_ID = 'mermaid-render'

/** 每个用例一个临时 DSH_HOME（真实 ~/.dsh 绝不触碰）。 */
function tempHome() {
  return mkdtempSync(join(tmpdir(), 'dsh-mermaid-render-api-'))
}

/** 假的 res：把 writeHead/end 的参数收进对象（与 asset-route.mjs 同风格）。 */
function mockResponse() {
  const res = {
    head: null,
    body: undefined,
    writeHead(code, headers) {
      res.head = { code, headers }
    },
    end(body) {
      res.body = body
    },
  }
  return res
}

/** 假的 req：headers + 可异步迭代的 body（dsh-shared 的 readJsonBody 契约）。 */
function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', secFetchSite, origin, body = '' } = {}) {
  const headers = { host }
  if (secFetchSite !== undefined) headers['sec-fetch-site'] = secFetchSite
  if (origin !== undefined) headers.origin = origin
  return {
    url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== '') yield body
    },
  }
}

/**
 * 挂载插件：捕获路由注册、systemPrompt section 生命周期（注册 + 撤销）、日志。
 * `dir` 为临时 DSH_HOME（patch 文件写到这里）。
 */
function boot(config, dir) {
  const home = dir ?? tempHome()
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const routes = []
  const sections = []
  const disposed = []
  const logs = []
  const ctx = {
    effect: (fn) => fn(),
    get: () => undefined,
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
    webServer: {
      register: (options) => {
        routes.push(options)
        return () => {}
      },
    },
    systemPrompt: {
      section: (options) => {
        sections.push(options)
        return () => disposed.push(options.name)
      },
    },
  }
  apply(ctx, config)
  const findRoute = (path) => routes.find((route) => route.path === path)
  const api = findRoute(ROUTE_PATH)
  assert.ok(api, `apply 必须注册 ${ROUTE_PATH} 路由`)
  assert.equal(api.kind, 'prefix', 'API 路由按前缀注册')
  return {
    api,
    routes,
    sections,
    disposed,
    logs,
    home,
    findRoute,
    restore() {
      if (oldHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = oldHome
      rmSync(home, { recursive: true, force: true })
    },
  }
}

/** 调一次路由处理函数，返回 {status, body}。 */
async function call(route, request) {
  const response = mockResponse()
  await route.handler(request, response)
  let body
  try {
    body = JSON.parse(response.body)
  } catch {
    body = response.body
  }
  return { status: response.head.code, body }
}

const getConfig = (api) => call(api, mockRequest({ url: `${ROUTE_PATH}/config` }))
const putConfig = (api, payload) =>
  call(
    api,
    mockRequest({
      url: `${ROUTE_PATH}/config`,
      method: 'PUT',
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    }),
  )

test('GET config：默认注入开启（injectPrompt=true）', async () => {
  const api = boot(undefined)
  try {
    const { status, body } = await getConfig(api.api)
    assert.equal(status, 200, 'GET 返回 200')
    assert.equal(body.ok, true, 'ok 标记')
    assert.equal(body.value.injectPrompt, true, '默认注入开启')
  } finally {
    api.restore()
  }
})

test('GET config：显式 false 关闭；非法应用层配置回退默认（保持开）', async () => {
  const off = boot({ injectPrompt: false })
  try {
    const { body } = await getConfig(off.api)
    assert.equal(body.value.injectPrompt, false, '显式 false 生效')
  } finally {
    off.restore()
  }
  const bad = boot({ injectPrompt: 'yes' })
  try {
    const { body } = await getConfig(bad.api)
    assert.equal(body.value.injectPrompt, true, '非法配置回退默认（保持开，不静默关能力）')
  } finally {
    bad.restore()
  }
})

test('PUT config：写回 profile patch（行 id 与 cordis.patch.yml 一致）+ 内存更新 + section 撤销', async () => {
  const api = boot(undefined)
  try {
    assert.equal(api.sections.length, 1, '默认挂载时注入一条 section')
    const { status, body } = await putConfig(api.api, { injectPrompt: false })
    assert.equal(status, 200, 'PUT 返回 200')
    assert.equal(body.ok, true, 'ok 标记')

    const file = patchFileOf('web')
    assert.equal(join(api.home, 'profiles/web/cordis.patch.yml'), file, 'patch 路径 = profile 层 cordis.patch.yml')
    const text = readFileSync(file, 'utf8')
    assert.ok(text.includes(`- id: ${ROW_ID}`), `patch 行 id 必须是 ${ROW_ID}（bundle patch 的插件行 id）`)
    assert.equal(extractConfig(text, ROW_ID).injectPrompt, false, 'patch 里持久化 false')

    const { body: after } = await getConfig(api.api)
    assert.equal(after.value.injectPrompt, false, '内存已更新（无需等热重载）')
    assert.deepEqual(api.disposed, ['dsh-mermaid-render'], '当前进程的 section 被撤销（立即生效）')
  } finally {
    api.restore()
  }
})

test('PUT config：关闭后再开启 → 重新注册 section + patch 更新为 true', async () => {
  const api = boot({ injectPrompt: false })
  try {
    assert.equal(api.sections.length, 0, '关闭状态挂载时不注册 section')
    const { status } = await putConfig(api.api, { injectPrompt: true })
    assert.equal(status, 200, 'PUT 返回 200')
    assert.equal(api.sections.length, 1, '重新注册 section（保存即生效）')
    const saved = extractConfig(readFileSync(patchFileOf('web'), 'utf8'), ROW_ID)
    assert.equal(saved.injectPrompt, true, 'patch 更新为 true')
  } finally {
    api.restore()
  }
})

test('PUT config：非法值回退默认 true，且不把非法值写进 patch（不写坏配置）', async () => {
  const api = boot(undefined)
  try {
    for (const bad of ['yes', 1, null, {}, []]) {
      const { status, body } = await putConfig(api.api, { injectPrompt: bad })
      assert.equal(status, 200, `非法值 ${JSON.stringify(bad)} 按默认处理（不是 400）`)
      assert.equal(body.ok, true, 'ok 标记')
      const saved = extractConfig(readFileSync(patchFileOf('web'), 'utf8'), ROW_ID)
      assert.equal(typeof saved.injectPrompt, 'boolean', 'patch 里必须是布尔值（非法值不得落盘）')
      assert.equal(saved.injectPrompt, true, '非法值回退默认 true')
    }
    const { body: after } = await getConfig(api.api)
    assert.equal(after.value.injectPrompt, true, '内存仍为默认 true')
    assert.deepEqual(api.disposed, [], '非法值不该改变生效状态（不撤销也不重复注册）')
  } finally {
    api.restore()
  }
})

test('PUT config：空对象/缺失字段 → 默认 true（缺失不等于关闭）', async () => {
  const api = boot(undefined)
  try {
    const { status } = await putConfig(api.api, {})
    assert.equal(status, 200, '空对象按默认处理')
    const saved = extractConfig(readFileSync(patchFileOf('web'), 'utf8'), ROW_ID)
    assert.equal(saved.injectPrompt, true, '缺失字段按默认 true 落盘')
  } finally {
    api.restore()
  }
})

test('PUT config：请求体非对象 → 400 且不落盘（不写坏配置）', async () => {
  const api = boot(undefined)
  try {
    for (const raw of ['[]', '"x"', 'null', 'not-json']) {
      const { status } = await putConfig(api.api, raw)
      assert.equal(status, 400, `非对象请求体 ${raw} 必须被拒`)
    }
    assert.equal(existsSync(patchFileOf('web')), false, '非法请求不得创建/破坏 patch 文件')
    const { body } = await getConfig(api.api)
    assert.equal(body.value.injectPrompt, true, '配置保持默认不变')
  } finally {
    api.restore()
  }
})

test('重启闭环：patch 里的 false 被下一次 apply 读到（不再注入）', async () => {
  const api = boot(undefined)
  let reboot
  try {
    await putConfig(api.api, { injectPrompt: false })
    const saved = extractConfig(readFileSync(patchFileOf('web'), 'utf8'), ROW_ID)
    // 模拟重启：loader 重新解析 patch 行 config → 再次 apply（同一临时 DSH_HOME）。
    reboot = boot(saved, api.home)
    assert.equal(reboot.sections.length, 0, '重启后不再注入说明段')
    assert.ok(
      reboot.logs.some((line) => line.includes('已挂载')),
      '关闭注入仍照常挂载（client 渲染不受影响）',
    )
  } finally {
    if (reboot) reboot.restore()
    api.restore()
  }
})

test('安全围栏：非 loopback / 跨站请求 403，且 PUT 被拒时不落盘', async () => {
  const api = boot(undefined)
  try {
    const foreign = await call(api.api, mockRequest({ url: `${ROUTE_PATH}/config`, host: 'evil.example.com' }))
    assert.equal(foreign.status, 403, '非受信 Host 403')
    const crossSite = await call(api.api, mockRequest({ url: `${ROUTE_PATH}/config`, secFetchSite: 'cross-site' }))
    assert.equal(crossSite.status, 403, 'cross-site 403')
    const badPut = await putConfig(api.api, { injectPrompt: false })
    assert.equal(badPut.status, 200, '本机 PUT 正常（对照组）')
    const blocked = await call(
      api.api,
      mockRequest({
        url: `${ROUTE_PATH}/config`,
        method: 'PUT',
        host: 'evil.example.com',
        body: JSON.stringify({ injectPrompt: true }),
      }),
    )
    assert.equal(blocked.status, 403, '非受信来源 PUT 403')
    const saved = extractConfig(readFileSync(patchFileOf('web'), 'utf8'), ROW_ID)
    assert.equal(saved.injectPrompt, false, '被拒的 PUT 不改变已保存配置')
  } finally {
    api.restore()
  }
})

test('未知 API 方法 / 错误动词 → 404', async () => {
  const api = boot(undefined)
  try {
    const unknown = await call(api.api, mockRequest({ url: `${ROUTE_PATH}/nope` }))
    assert.equal(unknown.status, 404, '未知方法 404')
    const wrongVerb = await call(api.api, mockRequest({ url: `${ROUTE_PATH}/config`, method: 'POST' }))
    assert.equal(wrongVerb.status, 404, 'GET/PUT 之外的动词 404')
    const root = await call(api.api, mockRequest({ url: `${ROUTE_PATH}` }))
    assert.equal(root.status, 404, '缺方法名 404')
  } finally {
    api.restore()
  }
})

test('既有路由契约未破坏：assets 静态路由照常注册在 /mermaid-render/assets', async () => {
  const api = boot(undefined)
  try {
    const assets = api.findRoute(ASSET_ROUTE_PATH)
    assert.ok(assets, 'assets 路由仍注册（client 端 fetch 引擎的路径不能变）')
    assert.equal(assets.kind, 'prefix', 'assets 仍按前缀托管')
    assert.equal(typeof assets.handler, 'function', 'assets handler 仍可调用')
    assert.equal(api.routes.length, 2, '恰好两条路由：assets + api（不多注册）')
  } finally {
    api.restore()
  }
})
