/**
 * legacy 配置读兼容 + 持久化不抹用户手写键（issue #463 防回归）。
 *
 * 两条必须钉死的契约：
 *  1. **读时兼容旧扁平键**：合并前 dsh-md-render 把开关写在 patch 行顶层
 *     （copyButton / textFenceMarkdown / contextMarkdown），用户 profile 已落盘；
 *     升级后必须仍然生效（映射进 markdown 段）。
 *  2. **写入不抹用户手写键**：dsh-shared 的 writePatchConfig 是「删旧条目 → 追加
 *     新条目」语义、不合并行内已有键 —— 直接写会把用户手写的 config 键抹掉。
 *     persistConfig 必须先 extractConfig 取回行内现有 config 再展开写入。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dirSync } from 'tmp'
import { apply } from '../lib/index.js'
import { createConfigState, normalizeConfigPayload } from '../lib/config.js'
import { extractConfig, patchFileOf } from 'dsh-shared'

const tmpDirs = []
function tempDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-md-render-legacy-' }).name
  tmpDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function mockResponse() {
  const res = {
    status: 0,
    written: [],
    writeHead(s) {
      res.status = s
    },
    write(c) {
      res.written.push(String(c))
      return true
    },
    end(v) {
      if (v !== undefined) res.written.push(String(v))
    },
  }
  return res
}
function mockRequest({ url, method = 'GET', body = '' } = {}) {
  return {
    url,
    method,
    headers: { host: '127.0.0.1:3080' },
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}
async function call(registration, request) {
  const response = mockResponse()
  await registration.handler(request, response)
  let body
  try {
    body = JSON.parse(response.written.join(''))
  } catch {
    body = response.written.join('')
  }
  return { status: response.status, body }
}

/** 启动插件并把 profile patch 文件预置为给定文本（模拟升级前的落盘状态）。 */
function boot(dir, patchText) {
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const file = patchFileOf('web')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, patchText ?? '', 'utf8')
  const routes = []
  const disposers = []
  const ctx = {
    logger: { info() {}, warn() {} },
    get() {
      return undefined
    },
    effect(fn) {
      const d = fn()
      disposers.push(d)
      return d
    },
    webServer: {
      register(r) {
        routes.push(r)
        return () => {}
      },
    },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx, {})
  const registration = routes.find((r) => r.path === '/md-render/api')
  assert.ok(registration, 'config route registered')
  return {
    file,
    registration,
    restore() {
      for (const d of disposers.splice(0)) if (typeof d === 'function') d()
      if (oldHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = oldHome
    },
  }
}

test('createConfigState：旧扁平键读进 markdown 段（用户 profile 已落盘）', () => {
  const state = createConfigState({ copyButton: false, textFenceMarkdown: true, contextMarkdown: false })
  assert.deepEqual(state.markdown, { copyButton: false, textFenceMarkdown: true, contextMarkdown: false })
  assert.deepEqual(state.thinking, { defaultExpanded: true }, 'thinking default on')
  assert.deepEqual(state.mermaid, { injectPrompt: true, render: true }, 'mermaid default on')
})

test('createConfigState：旧扁平键 defaultExpanded / injectPrompt 读兼容', () => {
  const state = createConfigState({ defaultExpanded: false, injectPrompt: false })
  assert.equal(state.thinking.defaultExpanded, false, 'old flat defaultExpanded honoured')
  assert.equal(state.mermaid.injectPrompt, false, 'old flat injectPrompt honoured')
})

test('createConfigState：段内键优先，旧扁平键只在段内缺该键时生效', () => {
  const state = createConfigState({ copyButton: false, markdown: { copyButton: true } })
  assert.equal(state.markdown.copyButton, true, 'nested markdown wins over the legacy flat key')
  assert.equal(state.markdown.textFenceMarkdown, true, 'missing nested key falls back to default')
})

test('normalizeConfigPayload：非法结构 / 非法字段 / 未知字段', () => {
  assert.equal(normalizeConfigPayload(null), undefined, 'null rejected')
  assert.equal(normalizeConfigPayload([1]), undefined, 'array rejected')
  assert.equal(normalizeConfigPayload('x'), undefined, 'scalar rejected')
  assert.equal(normalizeConfigPayload({ markdown: { copyButton: 'yes' } }), undefined, 'non-boolean rejected')
  assert.equal(normalizeConfigPayload({ thinking: { defaultExpanded: 1 } }), undefined, 'thinking non-boolean rejected')
  assert.equal(normalizeConfigPayload({ mermaid: [] }), undefined, 'section must be an object')
  assert.deepEqual(
    normalizeConfigPayload({ markdown: { copyButton: false } }),
    { markdown: { copyButton: false } },
    'valid patch',
  )
  assert.deepEqual(
    normalizeConfigPayload({ copyButton: false }),
    { markdown: { copyButton: false } },
    'legacy flat mapped to markdown section',
  )
})

test('GET /md-render/api/config 返回命名空间结构', async () => {
  const dir = tempDir()
  const booted = boot(dir, '')
  const { status, body } = await call(booted.registration, mockRequest({ url: '/md-render/api/config' }))
  booted.restore()
  assert.equal(status, 200)
  assert.deepEqual(body.value, {
    markdown: { copyButton: true, textFenceMarkdown: true, contextMarkdown: true },
    thinking: { defaultExpanded: true },
    mermaid: { injectPrompt: true, render: true },
  })
})

test('PUT 写回 patch 文件：新结构 + 保留用户手写键', async () => {
  const dir = tempDir()
  const seeded = [
    '- id: md-render',
    '  config:',
    '    copyButton: true',
    '    syntaxHighlight: true',
    '    codeTheme: ' + String.fromCharCode(39) + 'github-light' + String.fromCharCode(39),
    '',
  ].join('\n')
  const booted = boot(dir, seeded)
  const put = await call(
    booted.registration,
    mockRequest({
      url: '/md-render/api/config',
      method: 'PUT',
      body: JSON.stringify({ markdown: { copyButton: false }, thinking: { defaultExpanded: false } }),
    }),
  )
  assert.equal(put.status, 200, 'save ok')
  const saved = extractConfig(readFileSync(booted.file, 'utf8'), 'md-render')
  booted.restore()
  assert.equal(saved.markdown.copyButton, false, 'nested markdown change persisted')
  assert.equal(saved.markdown.textFenceMarkdown, true, 'untouched markdown key persisted')
  assert.equal(saved.thinking.defaultExpanded, false, 'thinking change persisted')
  assert.equal(saved.syntaxHighlight, true, 'user hand-written key must survive')
  assert.equal(saved.codeTheme, 'github-light', 'user hand-written string key must survive')
})

test('PUT 旧扁平键也接受（老客户端 / 手写 patch 行）', async () => {
  const dir = tempDir()
  const booted = boot(dir, '')
  const put = await call(
    booted.registration,
    mockRequest({ url: '/md-render/api/config', method: 'PUT', body: JSON.stringify({ copyButton: false }) }),
  )
  const after = await call(booted.registration, mockRequest({ url: '/md-render/api/config' }))
  const saved = extractConfig(readFileSync(booted.file, 'utf8'), 'md-render')
  booted.restore()
  assert.equal(put.status, 200, 'legacy flat payload accepted')
  assert.equal(after.body.value.markdown.copyButton, false, 'memory updated')
  assert.equal(saved.markdown.copyButton, false, 'persisted under the namespaced key')
})

test('PUT 非法输入 → 400 且不落盘', async () => {
  const dir = tempDir()
  const booted = boot(dir, '')
  const bad = await call(
    booted.registration,
    mockRequest({
      url: '/md-render/api/config',
      method: 'PUT',
      body: JSON.stringify({ markdown: { copyButton: 'yes' } }),
    }),
  )
  const saved = extractConfig(readFileSync(booted.file, 'utf8'), 'md-render')
  booted.restore()
  assert.equal(bad.status, 400, 'invalid payload rejected')
  assert.equal(saved, undefined, 'nothing written on rejection')
})

test('非 loopback 来源 → 403；未知方法 → 404', async () => {
  const dir = tempDir()
  const booted = boot(dir, '')
  const external = mockRequest({ url: '/md-render/api/config' })
  external.headers.host = 'evil.example.com'
  external.headers['sec-fetch-site'] = 'cross-site'
  const denied = await call(booted.registration, external)
  const unknown = await call(booted.registration, mockRequest({ url: '/md-render/api/nope' }))
  booted.restore()
  assert.equal(denied.status, 403, 'external origin blocked')
  assert.equal(unknown.status, 404, 'unknown method')
})
