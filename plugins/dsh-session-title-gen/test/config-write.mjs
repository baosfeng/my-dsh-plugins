import { test, afterEach } from 'vitest'
/**
 * dsh-session-title-gen — 设置页**写入面**契约测试（issue #385）。
 *
 * 需求：设置页可视化编辑 8 项配置 → 保存 → PUT `/session-title-gen/api/config`
 * → 写回 profile 的 `cordis.patch.yml`（行 id `session-title-gen`，与插件 bundle patch
 * 的行 id 一致）并**立即热生效**（不必等 watchUserPatches 重载、不必重启 DSH）。
 *
 * 本文件钉住六条底线（对应 issue #385 验收标准）：
 *  1. GET/PUT 契约：PUT 成功后同一 handler 的 GET 立刻反映新值（保存即生效）；
 *  2. 写回**先合并该行已有键**——`writePatchConfig` 的语义是「删同 id 旧条目 → 追加新条目」，
 *     不合并会抹掉用户手写的其它键（数据破坏）；其它插件的行必须原样保留；
 *  3. **非法字段只忽略该字段并回退默认**，同一请求里的合法字段照常生效（不整单拒绝），
 *     且脏值绝不落盘；字段缺失则保留当前生效值；
 *  4. 请求体非对象 / 非法 JSON → 400 且不落盘；落盘失败 → 500 且内存生效值不被污染；
 *  5. 围栏对 PUT 同样生效（403 且不落盘）；
 *  6. **热生效**：PUT 启用/停用与模板改动立刻影响标题生成（监听器挂载/卸载 + 生成读生效值），
 *     重启后由 patch 文件读回（重启闭环）。
 *
 * 断言全部写在 test() 内（Stryker vitest-runner 归因要求）。所有落盘都写进临时 DSH_HOME，
 * 真实 ~/.dsh 绝不触碰。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentProfile, extractConfig, patchFileOf } from 'dsh-shared'
import { apply } from '../lib/index.js'
import { CONFIG_ROW_ID, CONFIG_ROUTE_PREFIX } from '../lib/config-routes.js'
import { DEFAULT_SETTINGS, normalizeConfigPatch, resolveConfig } from '../lib/config.js'
import { createHostCtx, dispatchSessionEvent, mockSession } from './helpers/host-ctx.mjs'

const CONFIG_PATH = `${CONFIG_ROUTE_PREFIX}/config`

/** 用例结束统一清理临时 DSH_HOME（断言失败也不泄漏环境变量）。 */
const cleanups = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

/** 每个用例一个临时 DSH_HOME，返回 { home, patchFile }。 */
function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-session-title-gen-write-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  cleanups.push(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  })
  return { home, patchFile: patchFileOf(currentProfile()) }
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

/** 最小请求桩：body 走异步迭代器（readJsonBody 契约）。 */
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

/** 用真实契约宿主桩 apply，返回注册的路由与 patch 路径。 */
async function boot(config, { home, patchFile } = {}) {
  const env = home === undefined ? tempHome() : { home, patchFile }
  const host = createHostCtx({ webServer: 'ready' })
  apply(host.ctx, config)
  await host.settle()
  const api = host.routes[0]
  assert.ok(api, 'apply 必须注册配置路由（经 ctx.inject 局部等待服务、注册落常驻 root）')
  return { api, host, patchFile: env.patchFile, home: env.home }
}

/** 写盘后读回该行 config（模拟 loader 重新解析 patch 文件）。 */
function persistedConfig(patchFile) {
  return extractConfig(readFileSync(patchFile, 'utf8'), CONFIG_ROW_ID)
}

/** 人类首条消息事件（触发生成）。 */
function userEvent(text = '帮我加设置页') {
  return { type: 'user/message', seq: 0, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } }
}

test('resolveConfig：8 项默认值与类型护栏（缺省 / 非法一律回退默认）', () => {
  assert.deepEqual(resolveConfig(undefined), DEFAULT_SETTINGS, '未配置 → 全默认')
  assert.deepEqual(resolveConfig(null), DEFAULT_SETTINGS, 'null → 全默认')
  assert.deepEqual(resolveConfig({}), DEFAULT_SETTINGS, '空配置 → 全默认')
  assert.equal(resolveConfig({ enabled: false }).enabled, false, 'enabled=false 保留（唯一非默认的开关语义）')
  assert.equal(resolveConfig({ enabled: 'no' }).enabled, true, '非布尔 enabled → 默认 true')
  assert.equal(resolveConfig({ template: '' }).template, DEFAULT_SETTINGS.template, '空模板 → 默认模板')
  assert.equal(resolveConfig({ provider: 'p', model: 'm' }).provider, 'p', 'provider 生效')
  assert.equal(resolveConfig({ provider: '' }).provider, '', '空 provider = 跟随会话')
  assert.equal(resolveConfig({ maxTitleBytes: 0 }).maxTitleBytes, 80, '0 非正整数 → 默认')
  assert.equal(resolveConfig({ maxTitleBytes: -1 }).maxTitleBytes, 80, '负数 → 默认')
  assert.equal(resolveConfig({ timeoutMs: 'x' }).timeoutMs, 30000, '字符串 → 默认')
  assert.equal(resolveConfig({ maxInputBytes: 1024 }).maxInputBytes, 1024, '合法正整数生效')
})

test('normalizeConfigPatch：字段缺失保留当前值；字段非法回退默认（不整单拒绝）', () => {
  const current = { ...DEFAULT_SETTINGS, template: '{description}', maxTitleBytes: 42 }
  assert.equal(normalizeConfigPatch(null, current), undefined, 'null → undefined（400）')
  assert.equal(normalizeConfigPatch([], current), undefined, '数组 → undefined（400）')
  assert.equal(normalizeConfigPatch('x', current), undefined, '标量 → undefined（400）')
  assert.equal(normalizeConfigPatch({}, current), undefined, '空对象没有可应用字段 → undefined（400，不写盘）')

  const partial = normalizeConfigPatch({ enabled: false }, current)
  assert.equal(partial.enabled, false, '给出的字段生效')
  assert.equal(partial.template, '{description}', '缺失字段保留当前值')
  assert.equal(partial.maxTitleBytes, 42, '缺失字段保留当前值（数字）')

  const dirty = normalizeConfigPatch({ template: 'X {description}', maxTitleBytes: 'abc', timeoutMs: 0 }, current)
  assert.equal(dirty.template, 'X {description}', '同一请求里的合法字段照常生效（不整单拒绝）')
  assert.equal(dirty.maxTitleBytes, 80, '非法字段回退默认值')
  assert.equal(dirty.timeoutMs, 30000, '0 非法 → 回退默认')
})

test('PUT 合法 8 项：写回 profile patch（行 id = session-title-gen）并立即热生效', async () => {
  const { api, patchFile } = await boot({})
  const before = await call(api.handler, fakeRequest())
  assert.deepEqual(before.json.value, DEFAULT_SETTINGS, 'GET 初始为默认值')

  const next = { ...DEFAULT_SETTINGS, template: '{description}', maxTitleBytes: 60 }
  const saved = await call(api.handler, fakeRequest({ method: 'PUT', body: JSON.stringify(next) }))
  assert.equal(saved.status, 200, '合法 payload → 200')
  assert.equal(saved.json.ok, true)
  assert.deepEqual(saved.json.value, next, '响应回规整后的完整 8 项（client 用它回填表单）')
  assert.equal(saved.headers['content-type'], 'application/json', 'JSON content-type')

  assert.ok(existsSync(patchFile), 'patch 文件已创建')
  assert.deepEqual(
    persistedConfig(patchFile),
    {
      enabled: true,
      template: '{description}',
      maxTitleBytes: 60,
      maxInputBytes: 4096,
      maxOutputTokens: 64,
      timeoutMs: 30000,
    },
    '落盘 8 项（provider/model 为空 → 不写该键）',
  )
  assert.deepEqual((await call(api.handler, fakeRequest())).json.value, next, '保存即生效：GET 立刻反映新值')
})

test('PUT 合并该行已有键：不抹掉用户手写的其它键，也不动其它插件的行', async () => {
  const env = tempHome()
  mkdirSync(join(env.home, 'profiles', currentProfile()), { recursive: true })
  writeFileSync(
    env.patchFile,
    [
      '- id: some-other-plugin',
      '  config:',
      '    keep: 1',
      `- id: ${CONFIG_ROW_ID}`,
      '  disabled: true',
      '  config:',
      '    enabled: false',
      "    keepMe: 'x'",
      "    provider: 'legacy'",
      '',
    ].join('\n'),
  )
  const { api } = await boot(undefined, { home: env.home, patchFile: env.patchFile })
  const saved = await call(
    api.handler,
    fakeRequest({ method: 'PUT', body: JSON.stringify({ ...DEFAULT_SETTINGS, provider: '' }) }),
  )
  assert.equal(saved.status, 200, '合法 payload → 200')
  const text = readFileSync(env.patchFile, 'utf8')
  const row = extractConfig(text, CONFIG_ROW_ID)
  assert.equal(row.keepMe, 'x', '用户手写的其它键保留（不合并会把它抹掉）')
  assert.equal(row.enabled, true, '本次提交的键更新')
  assert.equal(row.provider, undefined, 'provider 清空 = 删除该键（跟随会话）')
  assert.deepEqual(extractConfig(text, 'some-other-plugin'), { keep: 1 }, '其它插件的行原样保留')
  assert.equal(text.split(`- id: ${CONFIG_ROW_ID}`).length - 1, 1, '该行 id 恰好一条（不产生幽灵行）')
})

test('该行尚不存在时追加新条目，已有行原样保留', async () => {
  const env = tempHome()
  mkdirSync(join(env.home, 'profiles', currentProfile()), { recursive: true })
  writeFileSync(env.patchFile, ['- id: some-other-plugin', '  config:', '    keep: 1', ''].join('\n'))
  const { api } = await boot(undefined, { home: env.home, patchFile: env.patchFile })
  const res = await call(api.handler, fakeRequest({ method: 'PUT', body: JSON.stringify(DEFAULT_SETTINGS) }))
  assert.equal(res.status, 200, '首次保存 → 200')
  const text = readFileSync(env.patchFile, 'utf8')
  assert.equal(persistedConfig(env.patchFile)?.enabled, true, '追加了新条目')
  assert.deepEqual(extractConfig(text, 'some-other-plugin'), { keep: 1 }, '已有行原样保留')
})

test('非法 payload → 400 且不落盘（空 body / null / 数组 / 标量 / 空对象 / 坏 JSON）', async () => {
  const { api, patchFile } = await boot(undefined)
  for (const body of ['', 'null', '[]', '"x"', '42', '{}', 'not json']) {
    const res = await call(api.handler, fakeRequest({ method: 'PUT', body }))
    assert.equal(res.status, 400, `body=${JSON.stringify(body)} → 400`)
    assert.equal(res.json.ok, false, 'ok=false')
  }
  assert.equal(existsSync(patchFile), false, '非法 payload 一律不落盘')
})

test('非法字段回退默认并写盘（脏值绝不落盘）+ 重启闭环读到该值', async () => {
  const { api, patchFile } = await boot({})
  const res = await call(
    api.handler,
    fakeRequest({ method: 'PUT', body: JSON.stringify({ maxTitleBytes: 'abc', enabled: 'yes' }) }),
  )
  assert.equal(res.status, 200, '字段非法按回退处理，不报错')
  assert.equal(res.json.value.maxTitleBytes, 80, '回退默认 80')
  assert.equal(res.json.value.enabled, true, '非法布尔回退默认 true')
  const text = readFileSync(patchFile, 'utf8')
  assert.ok(!text.includes('abc'), 'patch 文件里没有脏值')
  assert.ok(!text.includes("'yes'"), 'patch 文件里没有字符串脏值')

  const restarted = await boot(extractConfig(text, CONFIG_ROW_ID), { patchFile })
  assert.equal((await call(restarted.api.handler, fakeRequest())).json.value.maxTitleBytes, 80, '重启闭环读到落盘值')
})

test('安全契约：围栏对 PUT 同样生效（403 且不落盘），落盘失败 → 500 且内存不污染', async () => {
  const { api, patchFile } = await boot(undefined)
  const forged = await call(
    api.handler,
    fakeRequest({ method: 'PUT', headers: { host: 'evil.example.com' }, body: JSON.stringify(DEFAULT_SETTINGS) }),
  )
  assert.equal(forged.status, 403, '非本机 host → 403')
  assert.equal(existsSync(patchFile), false, '403 不落盘')

  // patch 路径被目录占用 → 原子写的 rename 目标不是文件，落盘必然失败
  const env = tempHome()
  mkdirSync(env.patchFile, { recursive: true })
  const broken = await boot({}, { home: env.home, patchFile: env.patchFile })
  const failed = await call(
    broken.api.handler,
    fakeRequest({ method: 'PUT', body: JSON.stringify({ ...DEFAULT_SETTINGS, enabled: false }) }),
  )
  assert.equal(failed.status, 500, '落盘失败 → 500')
  assert.equal(failed.json.ok, false, 'ok=false（client 据此提示保存失败）')
  assert.equal((await call(broken.api.handler, fakeRequest())).json.value.enabled, true, '内存生效值未被污染')
})

test('保存即热生效：启用 / 换模板 / 停用立刻影响标题生成（不必重启，不等 patch 热重载）', async () => {
  const { api, host } = await boot({ enabled: false })
  assert.equal(host.listeners.length, 0, '禁用启动时不注册 session/event 监听器')

  const on = await call(
    api.handler,
    fakeRequest({ method: 'PUT', body: JSON.stringify({ ...DEFAULT_SETTINGS, template: '{description}' }) }),
  )
  assert.equal(on.status, 200)
  assert.equal(host.listeners.length, 1, '启用后立刻挂上监听器（热生效）')
  assert.equal(host.pluginListeners.length, 0, '监听器落在 root，不挂插件自身 ctx')

  const session = mockSession('s-385-on')
  await dispatchSessionEvent(host, session, userEvent())
  const titles = session.events.filter((event) => event.type === 'session/title')
  assert.equal(titles.length, 1, '启用后生成标题')
  assert.equal(titles[0].data.title, '修复 #385 设置页面板', '新模板立刻生效（无 [工作区] 前缀）')

  const off = await call(
    api.handler,
    fakeRequest({ method: 'PUT', body: JSON.stringify({ ...DEFAULT_SETTINGS, enabled: false }) }),
  )
  assert.equal(off.status, 200)
  assert.equal(host.listeners.length, 0, '停用后监听器移除（零开销）')
  const idle = mockSession('s-385-off')
  await dispatchSessionEvent(host, idle, userEvent())
  assert.equal(idle.events.filter((event) => event.type === 'session/title').length, 0, '停用后不再生成标题')
})

test('CONFIG_ROW_ID 与 cordis.patch.yml 的行 id 一致（写错 = 幽灵行、配置永不生效）', () => {
  assert.equal(CONFIG_ROW_ID, 'session-title-gen', '行 id 固定为 session-title-gen')
  const patchYml = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.ok(patchYml.includes(`- id: ${CONFIG_ROW_ID}`), 'cordis.patch.yml 用同一行 id：' + CONFIG_ROW_ID)
})
