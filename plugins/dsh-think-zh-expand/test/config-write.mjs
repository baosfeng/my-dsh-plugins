import { test, afterEach } from 'vitest'
/**
 * Host-half config WRITE surface test（issue #383 宿主设置面板）。
 *
 * 需求：设置页可视化编辑 `defaultExpanded` → 保存 → PUT
 * `/think-zh-expand/api/config` → 写回 profile patch 文件（`- id: think-zh-expand`，
 * 与 cordis.patch.yml 的行 id 一致）并立即热生效（不必等 HMR 重载）。
 *
 * 本文件钉住六条底线：
 *  1. GET 契约不变（默认 true / 显式 false 原样）；PUT 成功后同一 handler 的
 *     GET 立即反映新值（保存即生效）；
 *  2. 写回**先合并该行已有键**——`writePatchConfig` 的语义是「删同 id 旧条目 →
 *     追加新条目」，不合并就会抹掉用户手写的其它配置项；其它插件的行必须原样保留；
 *  3. **只认布尔**：字段非布尔 / 缺失一律回退默认 true（配置面永远不能让本插件
 *     从「默认展开」变成折叠），且**脏值绝不落盘**；
 *  4. 请求体非对象 / 非法 JSON → 400 且不落盘（宁可拒绝，也不写坏配置）；
 *  5. 既有安全契约不变：围栏对 PUT 同样生效（403 且不落盘）；未知 path / 方法 404；
 *  6. 重启闭环：写下的值被下一次 apply 读到并生效；行 id 与 cordis.patch.yml 一致
 *     （写错行 id = 多一条幽灵行、配置永不生效）。
 *
 * 断言全部写在 test() 内（Stryker vitest-runner 归因要求，同 host-smoke.mjs）。
 * 所有落盘都写进临时 DSH_HOME，真实 ~/.dsh 绝不触碰。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_EXPANDED,
  CONFIG_ROW_ID,
  CONFIG_ROUTE_PREFIX,
  apply,
  createConfigHandler,
  normalizeConfigPayload,
} from '../lib/index.js'
import { currentProfile, extractConfig, patchFileOf } from 'dsh-shared'

const CONFIG_PATH = `${CONFIG_ROUTE_PREFIX}/config`

/** 用例结束统一清理临时 DSH_HOME（断言失败也不泄漏环境变量）。 */
const cleanups = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

/** 每个用例一个临时 DSH_HOME，返回 { home, patchFile, restore }。 */
function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-think-zh-expand-write-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const patchFile = patchFileOf(currentProfile())
  const restore = () => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
  cleanups.push(restore)
  return { home, patchFile, restore }
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

/** 最小请求桩：默认来自本机 host 的 GET 配置请求；body 走异步迭代器。 */
function fakeRequest({ method = 'GET', url = CONFIG_PATH, headers = { host: '127.0.0.1:3080' }, body = '' } = {}) {
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== '') yield body
    },
  }
}

/** 调一次 handler，返回 { status, headers, json }。 */
async function call(handler, request) {
  const response = fakeResponse()
  await handler(request, response)
  return {
    status: response.status,
    headers: response.headers,
    json: response.body === '' ? null : JSON.parse(response.body),
  }
}

/** 构造带 webServer 的 ctx（捕获注册的路由）并 apply，返回路由与 patch 路径。 */
function boot(config, { home, patchFile } = {}) {
  const env = home === undefined ? tempHome() : { home, patchFile, restore: () => {} }
  const routes = []
  const ctx = {
    systemPrompt: { section: () => () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: (name) => (name === 'webServer' ? { register: (route) => (routes.push(route), () => {}) } : undefined),
    effect: (fn) => fn(),
  }
  apply(ctx, config)
  const api = routes[0]
  assert.ok(api, 'apply 必须注册配置路由')
  return { api, routes, patchFile: env.patchFile, home: env.home }
}

/** 写盘后读回该行 config（模拟 loader 重新解析 patch 文件）。 */
function persistedConfig(patchFile) {
  return extractConfig(readFileSync(patchFile, 'utf8'), CONFIG_ROW_ID)
}

test('normalizeConfigPayload：只认布尔，其余（含缺失 / 字符串 / 数字 / null）回退默认 true', () => {
  assert.equal(DEFAULT_EXPANDED, true, '默认值 true（「默认展开」是产品定位）')
  assert.deepEqual(normalizeConfigPayload({ defaultExpanded: true }), { defaultExpanded: true }, '显式 true')
  assert.deepEqual(normalizeConfigPayload({ defaultExpanded: false }), { defaultExpanded: false }, '显式 false')
  assert.deepEqual(normalizeConfigPayload({}), { defaultExpanded: true }, '字段缺失 → 回退 true')
  assert.deepEqual(
    normalizeConfigPayload({ defaultExpanded: 'false' }),
    { defaultExpanded: true },
    '字符串 → 回退 true',
  )
  assert.deepEqual(normalizeConfigPayload({ defaultExpanded: 0 }), { defaultExpanded: true }, '数字 → 回退 true')
  assert.deepEqual(normalizeConfigPayload({ defaultExpanded: null }), { defaultExpanded: true }, 'null → 回退 true')
  for (const payload of [null, undefined, [], 'x', 42, true]) {
    assert.equal(normalizeConfigPayload(payload), undefined, `非对象 ${JSON.stringify(payload) ?? 'undefined'} → 400`)
  }
})

test('PUT 合法布尔：写回 profile patch（行 id = think-zh-expand）并立即热生效', async () => {
  const { api, patchFile } = boot({ defaultExpanded: true })
  const before = await call(api.handler, fakeRequest())
  assert.deepEqual(before.json.value, { defaultExpanded: true }, 'GET 初始为 true')

  const saved = await call(
    api.handler,
    fakeRequest({ method: 'PUT', body: JSON.stringify({ defaultExpanded: false }) }),
  )
  assert.equal(saved.status, 200, '合法 payload → 200')
  assert.equal(saved.json.ok, true, 'ok=true')
  assert.equal(saved.headers['content-type'], 'application/json', 'JSON content-type')

  assert.ok(existsSync(patchFile), 'patch 文件已创建')
  assert.equal(api.kind, 'prefix', '仍是 prefix 路由（client 端按前缀拉取）')
  assert.equal(api.path, CONFIG_ROUTE_PREFIX, '路由前缀不变')
  assert.deepEqual(persistedConfig(patchFile), { defaultExpanded: false }, '落盘值为布尔 false')

  const after = await call(api.handler, fakeRequest())
  assert.deepEqual(after.json.value, { defaultExpanded: false }, '保存即生效：同一 handler 的 GET 立刻反映新值')
})

test('PUT 合并该行已有键：不抹掉用户手写的其它配置项，也不动其它插件的行', async () => {
  const env = tempHome()
  mkdirSync(join(env.home, 'profiles', currentProfile()), { recursive: true })
  writeFileSync(
    env.patchFile,
    [
      '- id: some-other-plugin',
      '  config:',
      '    keep: 1',
      `- id: ${CONFIG_ROW_ID}`,
      '  config:',
      '    defaultExpanded: false',
      "    keepMe: 'x'",
      '',
    ].join('\n'),
  )
  const { api } = boot(undefined, { home: env.home, patchFile: env.patchFile })
  const saved = await call(api.handler, fakeRequest({ method: 'PUT', body: JSON.stringify({ defaultExpanded: true }) }))
  assert.equal(saved.status, 200, '合法 payload → 200')
  const text = readFileSync(env.patchFile, 'utf8')
  assert.deepEqual(
    extractConfig(text, CONFIG_ROW_ID),
    { defaultExpanded: true, keepMe: 'x' },
    '已有键 keepMe 保留，defaultExpanded 更新（不合并会把它抹掉）',
  )
  assert.deepEqual(extractConfig(text, 'some-other-plugin'), { keep: 1 }, '其它插件的行原样保留')
  assert.equal(text.split(`- id: ${CONFIG_ROW_ID}`).length - 1, 1, '该行 id 恰好一条（不产生幽灵行）')
})

test('该行尚不存在（patch 里只有别的插件行）时追加新条目，已有行原样保留', async () => {
  const env = tempHome()
  mkdirSync(join(env.home, 'profiles', currentProfile()), { recursive: true })
  writeFileSync(env.patchFile, ['- id: some-other-plugin', '  config:', '    keep: 1', ''].join('\n'))
  const { api } = boot(undefined, { home: env.home, patchFile: env.patchFile })
  const saved = await call(
    api.handler,
    fakeRequest({ method: 'PUT', body: JSON.stringify({ defaultExpanded: false }) }),
  )
  assert.equal(saved.status, 200, '首次保存 → 200')
  const text = readFileSync(env.patchFile, 'utf8')
  assert.deepEqual(extractConfig(text, CONFIG_ROW_ID), { defaultExpanded: false }, '追加了新条目')
  assert.deepEqual(extractConfig(text, 'some-other-plugin'), { keep: 1 }, '已有行原样保留')
})

test('行为断言：非法 payload → 400 且不落盘（空 body / null / 数组 / 标量 / 坏 JSON）', async () => {
  const { api, patchFile } = boot(undefined)
  for (const body of ['', 'null', '[]', '"x"', '42', 'not json']) {
    const res = await call(api.handler, fakeRequest({ method: 'PUT', body }))
    assert.equal(res.status, 400, `body=${JSON.stringify(body)} → 400`)
    assert.equal(res.json.ok, false, 'ok=false')
  }
  assert.equal(existsSync(patchFile), false, '非法 payload 一律不落盘')
})

test('非法字段值回退默认 true 写盘（脏值绝不落盘）+ 重启闭环读到该值', async () => {
  const { api, patchFile } = boot({ defaultExpanded: false })
  const saved = await call(
    api.handler,
    fakeRequest({ method: 'PUT', body: JSON.stringify({ defaultExpanded: 'false' }) }),
  )
  assert.equal(saved.status, 200, '字段非法按回退处理，不报错')
  const text = readFileSync(patchFile, 'utf8')
  assert.deepEqual(
    extractConfig(text, CONFIG_ROW_ID),
    { defaultExpanded: true },
    "回退 true，绝不把 'false' 字符串写进 patch",
  )
  assert.ok(!text.includes("'false'"), 'patch 文件里没有字符串脏值')

  // 重启闭环：新 ctx 用 patch 里的 config 重新 apply → 生效值为 true
  const restarted = boot(extractConfig(text, CONFIG_ROW_ID), { patchFile })
  assert.deepEqual((await call(restarted.api.handler, fakeRequest())).json.value, { defaultExpanded: true })
})

test('安全契约：围栏对 PUT 同样生效（403 且不落盘），未知 path / 方法 404', async () => {
  const { api, patchFile } = boot(undefined)
  const forged = await call(
    api.handler,
    fakeRequest({
      method: 'PUT',
      headers: { host: 'evil.example.com' },
      body: JSON.stringify({ defaultExpanded: false }),
    }),
  )
  assert.equal(forged.status, 403, '非本机 host → 403')
  assert.equal(existsSync(patchFile), false, '403 不落盘')

  const crossSite = await call(
    api.handler,
    fakeRequest({
      method: 'PUT',
      headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ defaultExpanded: false }),
    }),
  )
  assert.equal(crossSite.status, 403, '跨站 PUT → 403')
  assert.equal(existsSync(patchFile), false, '跨站不落盘')

  assert.equal(
    (await call(api.handler, fakeRequest({ method: 'PUT', url: `${CONFIG_ROUTE_PREFIX}/other` }))).status,
    404,
    'PUT 到未知 path → 404',
  )
  for (const method of ['DELETE', 'PATCH', 'POST']) {
    assert.equal((await call(api.handler, fakeRequest({ method }))).status, 404, `${method} 未实现 → 404`)
  }
})

test('写盘失败 → 500 + ok:false，且内存生效值不被污染（不假装保存成功）', async () => {
  const env = tempHome()
  // patch 路径被目录占用 → 原子写的 rename 目标不是文件，落盘必然失败。
  mkdirSync(env.patchFile, { recursive: true })
  const { api } = boot({ defaultExpanded: true }, { home: env.home, patchFile: env.patchFile })
  const failed = await call(
    api.handler,
    fakeRequest({ method: 'PUT', body: JSON.stringify({ defaultExpanded: false }) }),
  )
  assert.equal(failed.status, 500, '落盘失败 → 500')
  assert.equal(failed.json.ok, false, 'ok=false（client 据此提示保存失败）')
  assert.deepEqual((await call(api.handler, fakeRequest())).json.value, { defaultExpanded: true }, '内存未被污染')
})

test('createConfigHandler 直调：GET 契约不变（默认 true / 显式 false 原样）', async () => {
  const writes = []
  const handler = createConfigHandler(
    () => false,
    async (next) => {
      writes.push(next)
    },
  )
  const res = await call(handler, fakeRequest())
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.value, { defaultExpanded: false }, '读回调原样暴露')
  assert.equal(res.headers['cache-control'], 'no-cache', 'no-cache（改动即时可见）')
  assert.deepEqual(writes, [], 'GET 绝不触发写入')
})

test('CONFIG_ROW_ID 与 cordis.patch.yml 的行 id 一致（写错 = 幽灵行、配置永不生效）', () => {
  assert.equal(CONFIG_ROW_ID, 'think-zh-expand', '行 id 固定为 think-zh-expand')
  const patchYml = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.ok(patchYml.includes(`- id: ${CONFIG_ROW_ID}`), 'cordis.patch.yml 用同一行 id：' + CONFIG_ROW_ID)
})
