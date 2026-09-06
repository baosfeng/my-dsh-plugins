import { test } from 'vitest'
/**
 * dsh-md-render — 配置 API 单测（issue #84 配置化）。
 *
 * 验证设置页配置读写闭环：
 *  - buildOptions：全部增强开关默认开启；显式 false 关闭；非法值回退默认；
 *  - GET  /md/api/config → 当前生效开关（含默认值）；
 *  - PUT  /md/api/config → 保存配置：写入 profile cordis.patch.yml
 *    （持久化）+ 更新内存（立即生效）；
 *  - 持久化：保存到临时 profile → 重新 apply（模拟重启）→ 配置生效；
 *  - 非法输入 400；非本机来源 403；未知方法 404。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, buildOptions } from '../lib/index.js'
import { extractConfig, patchFileOf } from 'dsh-shared'

const tmpDirs = []
const disposeAlls = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-md-render-api-'))
  tmpDirs.push(dir)
  return dir
}

function mockResponse() {
  const res = {
    writeHeadStatus: 0,
    writeHeadHeaders: null,
    written: [],
    ended: false,
    destroyed: false,
    closeHandlers: [],
    writeHead(status, headers) {
      res.writeHeadStatus = status
      res.writeHeadHeaders = headers
    },
    write(chunk) {
      res.written.push(String(chunk))
      return true
    },
    end(value) {
      res.ended = true
      if (value !== undefined) res.written.push(String(value))
    },
    destroy() {
      res.destroyed = true
    },
    on(_event, handler) {
      if (_event === 'close') res.closeHandlers.push(handler)
    },
    removeListener() {},
    emitClose() {
      for (const h of res.closeHandlers.splice(0)) h()
    },
  }
  return res
}

function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', secFetchSite, origin, body = '' } = {}) {
  const headers = { host }
  if (secFetchSite !== undefined) headers['sec-fetch-site'] = secFetchSite
  if (origin !== undefined) headers.origin = origin
  return {
    url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

/** Boot the plugin with a mocked ctx; DSH_HOME points at dir (or a fresh temp dir). */
function boot(config, dir) {
  const home = dir ?? tempDir()
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const routes = []
  const disposers = []
  const logs = []
  const ctx = {
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
    },
    get() {
      return undefined
    },
    effect(fn) {
      const dispose = fn()
      assert.equal(typeof dispose, 'function', 'every ctx.effect must return a disposer')
      disposers.push(dispose)
      return dispose
    },
    webServer: {
      register(registration) {
        routes.push(registration)
        return () => {
          const i = routes.indexOf(registration)
          if (i !== -1) routes.splice(i, 1)
        }
      },
    },
  }
  apply(ctx, config ?? {})
  assert.equal(routes.length, 1, 'one /md/api prefix registration')
  const registration = routes[0]
  assert.equal(registration.kind, 'prefix', 'prefix routing')
  assert.equal(registration.path, '/md/api', 'route prefix path')
  return {
    registration,
    disposers,
    logs,
    restore() {
      for (const dispose of disposers.splice(0)) dispose()
      if (oldHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = oldHome
    },
  }
}

async function call(registration, request) {
  const response = mockResponse()
  await registration.handler(request, response)
  const payload = response.written.join('')
  let body
  try {
    body = JSON.parse(payload)
  } catch {
    body = payload
  }
  return { status: response.writeHeadStatus, body, response }
}

test('buildOptions：全部增强开关默认开启', () => {
  const options = buildOptions(undefined)
  for (const key of [
    'copyButton',
    'syntaxHighlight',
    'languageLabel',
    'lineNumbers',
    'taskList',
    'strikethrough',
    'image',
    'nestedList',
    'mathStructures',
    'tableSort',
    'tableFold',
  ]) {
    assert.equal(options[key], true, `${key} defaults on`)
  }
})

test('buildOptions：显式 false 关闭、非法值回退默认', () => {
  const options = buildOptions({ copyButton: false, lineNumbers: 'nope', tableFold: false })
  assert.equal(options.copyButton, false, 'copyButton off')
  assert.equal(options.tableFold, false, 'tableFold off')
  assert.equal(options.lineNumbers, true, 'non-boolean falls back to default on')
  assert.equal(options.syntaxHighlight, true, 'missing key defaults on')
})

test('buildOptions：选择项默认值 + 合法值生效 + 非法值回退默认（issue #146）', () => {
  const def = buildOptions(undefined)
  assert.equal(def.copyButtonPosition, 'bottom-right', 'copy button position defaults to bottom-right (#74 原始诉求)')
  assert.equal(def.codeTheme, 'bright', 'code theme defaults to bright（明亮高对比）')
  const picked = buildOptions({ copyButtonPosition: 'header', codeTheme: 'one-dark' })
  assert.equal(picked.copyButtonPosition, 'header', 'valid position picked')
  assert.equal(picked.codeTheme, 'one-dark', 'valid theme picked')
  const bad = buildOptions({ copyButtonPosition: 'left', codeTheme: 'neon' })
  assert.equal(bad.copyButtonPosition, 'bottom-right', 'invalid position falls back to default')
  assert.equal(bad.codeTheme, 'bright', 'invalid theme falls back to default')
})

test('GET /md/api/config：返回全部开关默认开启', async () => {
  const api = boot({})
  try {
    const { status, body } = await call(api.registration, mockRequest({ url: '/md/api/config' }))
    assert.equal(status, 200, 'GET config status')
    assert.equal(body.ok, true, 'ok flag')
    assert.equal(body.value.copyButton, true, 'copyButton default on')
    assert.equal(body.value.tableFold, true, 'tableFold default on')
    assert.equal(body.value.copyButtonPosition, 'bottom-right', 'position default returned (issue #146)')
    assert.equal(body.value.codeTheme, 'bright', 'theme default returned (issue #146)')
  } finally {
    api.restore()
  }
})

test('PUT /md/api/config：写入 patch 文件（持久化）+ 更新内存', async () => {
  const dir = tempDir()
  const api = boot({}, dir)
  try {
    const payload = JSON.stringify({ copyButton: false, syntaxHighlight: false })
    const { status } = await call(
      api.registration,
      mockRequest({ url: '/md/api/config', method: 'PUT', body: payload }),
    )
    assert.equal(status, 200, 'PUT config status')
    // patch 文件已写入 md-render 行 + config 块（完整开关集）
    const file = patchFileOf('web')
    assert.equal(join(dir, 'profiles/web/cordis.patch.yml'), file, 'patch file path under profile')
    const patchText = readFileSync(file, 'utf8')
    assert.ok(patchText.includes('- id: md-render'), 'patch row id present')
    const saved = extractConfig(patchText, 'md-render')
    assert.equal(saved.copyButton, false, 'saved copyButton')
    assert.equal(saved.syntaxHighlight, false, 'saved syntaxHighlight')
    assert.equal(saved.tableFold, true, 'unset key persisted as default true')
    // 内存已更新（GET 反映新值）
    const { body } = await call(api.registration, mockRequest({ url: '/md/api/config' }))
    assert.equal(body.value.copyButton, false, 'in-memory copyButton updated')
    assert.equal(body.value.syntaxHighlight, false, 'in-memory syntaxHighlight updated')
  } finally {
    api.restore()
  }
})

test('PUT 选择项（合法值）→ 200 + patch 持久化 + 内存更新（issue #146）', async () => {
  const dir = tempDir()
  const api = boot({}, dir)
  try {
    const payload = JSON.stringify({ copyButtonPosition: 'header', codeTheme: 'one-dark' })
    const { status } = await call(
      api.registration,
      mockRequest({ url: '/md/api/config', method: 'PUT', body: payload }),
    )
    assert.equal(status, 200, 'PUT select config status')
    const file = patchFileOf('web')
    const saved = extractConfig(readFileSync(file, 'utf8'), 'md-render')
    assert.equal(saved.copyButtonPosition, 'header', 'position persisted to patch file')
    assert.equal(saved.codeTheme, 'one-dark', 'theme persisted to patch file')
    const { body } = await call(api.registration, mockRequest({ url: '/md/api/config' }))
    assert.equal(body.value.copyButtonPosition, 'header', 'in-memory position updated')
    assert.equal(body.value.codeTheme, 'one-dark', 'in-memory theme updated')
  } finally {
    api.restore()
  }
})

test('PUT 选择项非法值 → 400，配置未被修改（issue #146）', async () => {
  const api = boot({})
  try {
    const { status } = await call(
      api.registration,
      mockRequest({ url: '/md/api/config', method: 'PUT', body: JSON.stringify({ codeTheme: 'neon' }) }),
    )
    assert.equal(status, 400, 'invalid select value rejected')
    const { status: badPos } = await call(
      api.registration,
      mockRequest({ url: '/md/api/config', method: 'PUT', body: JSON.stringify({ copyButtonPosition: 'left' }) }),
    )
    assert.equal(badPos, 400, 'invalid position rejected')
    const { body } = await call(api.registration, mockRequest({ url: '/md/api/config' }))
    assert.equal(body.value.codeTheme, 'bright', 'config unchanged')
    assert.equal(body.value.copyButtonPosition, 'bottom-right', 'config unchanged')
  } finally {
    api.restore()
  }
})

test('配置持久化：重新 apply（模拟重启）后配置生效', async () => {
  const dir = tempDir()
  const api = boot({ copyButton: false }, dir)
  try {
    await call(
      api.registration,
      mockRequest({
        url: '/md/api/config',
        method: 'PUT',
        body: JSON.stringify({ tableFold: false, copyButtonPosition: 'header', codeTheme: 'nord' }),
      }),
    )
    // patch 文件路径需在 restore（恢复 DSH_HOME）前计算
    const file = join(dir, 'profiles/web/cordis.patch.yml')
    api.restore()
    // 模拟重启：从 patch 文件重新读取配置，再次 apply
    const patchText = readFileSync(file, 'utf8')
    const persisted = extractConfig(patchText, 'md-render')
    assert.ok(persisted, 'persisted config extracted')
    const api2 = boot(persisted, dir)
    try {
      const { body } = await call(api2.registration, mockRequest({ url: '/md/api/config' }))
      assert.equal(body.value.copyButton, false, 'copyButton restored after restart-like apply')
      assert.equal(body.value.tableFold, false, 'tableFold restored after restart-like apply')
      assert.equal(body.value.lineNumbers, true, 'unset keys restored to default on')
      assert.equal(body.value.copyButtonPosition, 'header', 'position restored after restart-like apply (issue #146)')
      assert.equal(body.value.codeTheme, 'nord', 'theme restored after restart-like apply (issue #146)')
    } finally {
      api2.restore()
    }
  } finally {
    api.restore()
  }
})

test('PUT 非法配置（非布尔）→ 400，配置未被修改', async () => {
  const api = boot({})
  try {
    const { status } = await call(
      api.registration,
      mockRequest({ url: '/md/api/config', method: 'PUT', body: JSON.stringify({ lineNumbers: 'yes' }) }),
    )
    assert.equal(status, 400, 'invalid config rejected')
    const { body } = await call(api.registration, mockRequest({ url: '/md/api/config' }))
    assert.equal(body.value.lineNumbers, true, 'config unchanged')
  } finally {
    api.restore()
  }
})

test('非本机来源 → 403（loopback 信任围栏）', async () => {
  const api = boot({})
  try {
    const { status } = await call(api.registration, mockRequest({ url: '/md/api/config', host: 'evil.example:80' }))
    assert.equal(status, 403, 'untrusted host rejected')
  } finally {
    api.restore()
  }
})

test('未知方法 → 404', async () => {
  const api = boot({})
  try {
    const { status } = await call(api.registration, mockRequest({ url: '/md/api/unknown' }))
    assert.equal(status, 404, 'unknown method rejected')
  } finally {
    api.restore()
  }
})

test('apply 输出 [dsh-md-render] 前缀的启用日志（issue #155）', async () => {
  const api = boot({})
  try {
    assert.ok(api.logs.length >= 1, 'at least one log line emitted')
    assert.ok(api.logs[0].startsWith('[dsh-md-render]'), 'log line carries the unified plugin prefix')
    assert.ok(api.logs[0].includes('已启用'), 'log line describes the enabled behavior')
  } finally {
    api.restore()
  }
})

test('PUT 配置保存输出 info 日志（含变更键，issue #155）', async () => {
  const api = boot({})
  try {
    await call(
      api.registration,
      mockRequest({ url: '/md/api/config', method: 'PUT', body: JSON.stringify({ copyButton: false }) }),
    )
    const saveLog = api.logs.find((line) => line.includes('配置已保存'))
    assert.ok(saveLog !== undefined, 'config-save info log emitted')
    assert.ok(saveLog.startsWith('[dsh-md-render]'), 'save log carries the unified plugin prefix')
    assert.ok(saveLog.includes('copyButton'), 'save log lists the changed key')
  } finally {
    api.restore()
  }
})

test('cleanup temp dirs', () => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const dispose of disposeAlls.splice(0)) dispose()
})
