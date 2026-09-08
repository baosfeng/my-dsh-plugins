import { test } from 'vitest'
/**
 * Client render-path test (issue #86): loads the guardian client bundle with a
 * stubbed react (real createElement; hooks stubbed to a controllable map),
 * registers the tab through a mocked betterSidebar service, then renders the
 * view component with seeded states and asserts the failure-classification
 * badge (依赖缺失 / 代码错误 / 其他) and the install suggestion appear in the
 * element tree.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── stubbed react ─────────────────────────────────────────────────────────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

let seedState = null
let hookValues = new Map()
function resetHooks() {
  hookValues = new Map()
}
const stubbed = {
  createElement,
  useState: (initial) => {
    const idx = hookValues.size
    if (!hookValues.has(idx)) {
      let value = typeof initial === 'function' ? initial() : initial
      // the first useState in useGuardianState is the big state object —
      // seed it so the panel renders with real data
      if (value !== null && typeof value === 'object' && typeof value.safeMode !== 'undefined' && seedState !== null) {
        value = seedState
      }
      hookValues.set(idx, [value, (next) => hookValues.set(idx, [next, hookValues.get(idx)[1]])])
    }
    return hookValues.get(idx)
  },
  useEffect: () => {},
  useMemo: (fn) => fn(),
}

// ── browser globals ────────────────────────────────────────────────────────
let registered = null
global.window = {
  __ModuleLoader__: {
    load: (registration) => {
      registered = registration
    },
  },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
  confirm: () => true,
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) }),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
}
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) })

// ── load bundle ────────────────────────────────────────────────────────────
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  throw new Error('unexpected require: ' + spec)
})
assert.equal(typeof exportsObj.apply, 'function')

// ── mock betterSidebar service + context ───────────────────────────────────
let capturedTab = null
const mockService = {
  registerTab: (descriptor) => {
    capturedTab = descriptor
    return () => {}
  },
}
const ctx = {
  effect: (fn) => fn(),
  // 严格模拟 cordis 的 ctx.get(name, strict = true)：服务提供者 fiber 未
  // active 时 strict 取法返回 undefined、strict=false 才返回服务对象。
  // 防回归（首屏时序）：侧边栏页签注册不得依赖 betterSidebar 提供者已 active。
  get: (name, strict = true) => (name === 'betterSidebar' ? (strict ? undefined : mockService) : undefined),
}
exportsObj.apply(ctx)
assert.ok(capturedTab, 'tab registered while the betterSidebar provider fiber is not active yet')
assert.equal(capturedTab.id, 'dsh-my-guardian:panel')

const scope = { sessionId: 'sess-test', cwd: '/work' }

// ── render the view with a seeded state and collect texts ──────────────────
function renderTexts(seed) {
  resetHooks()
  seedState = seed
  const element = capturedTab.component({ ctx, scope, visible: true })
  const tree = element.type(element.props)
  const texts = []
  walk(tree, texts)
  return texts
}

function walk(node, texts) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    texts.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, texts)
    return
  }
  if (typeof node.type === 'function') {
    walk(node.type(node.props), texts)
    return
  }
  walk(node.props?.children, texts)
}

const dependencyEntry = {
  id: 'dsh-bad',
  name: 'dsh-bad',
  attempts: 1,
  frozen: false,
  lastError: '缺少依赖 dsh-shared（请先安装）',
  lastFailedAt: Date.now(),
  failureType: 'dependency',
  missingDeps: ['dsh-shared'],
  installHint: 'dsh plugin add dsh-shared',
  status: 'failed',
}

test('dependency-failure row shows the category badge and install suggestion', () => {
  const texts = renderTexts({
    safeMode: false,
    staged: [dependencyEntry],
    promoted: [],
    events: [],
    loaded: true,
  })
  const joined = texts.join('|')
  assert.ok(joined.includes('依赖缺失'), 'dependency category badge rendered')
  assert.ok(joined.includes('dsh plugin add dsh-shared'), 'install suggestion rendered')
  assert.ok(joined.includes('dsh-bad'), 'plugin name rendered')
  assert.ok(joined.includes('安装建议'), 'install-hint label rendered')
})

test('code/other failure entries render their own category badge', () => {
  const codeEntry = { ...dependencyEntry, id: 'dsh-code', name: 'dsh-code', failureType: 'code', installHint: null }
  const codeTexts = renderTexts({ safeMode: false, staged: [codeEntry], promoted: [], events: [], loaded: true })
  assert.ok(codeTexts.join('|').includes('代码错误'), 'code category badge rendered')

  const otherEntry = { ...dependencyEntry, id: 'dsh-other', name: 'dsh-other', failureType: 'other', installHint: null }
  const otherTexts = renderTexts({ safeMode: false, staged: [otherEntry], promoted: [], events: [], loaded: true })
  assert.ok(otherTexts.join('|').includes('其他'), 'other category badge rendered')
})

test('running entry without a failure type renders no category badge', () => {
  const runningEntry = { ...dependencyEntry, id: 'dsh-run', name: 'dsh-run', status: 'running', failureType: null }
  const texts = renderTexts({ safeMode: false, staged: [], promoted: [runningEntry], events: [], loaded: true })
  const joined = texts.join('|')
  assert.ok(joined.includes('运行中'), 'running status rendered')
  assert.ok(!joined.includes('依赖缺失') && !joined.includes('代码错误'), 'no category badge for a running entry')
})

test('startup roster issues block renders pinned with fix command and removal hint', () => {
  const texts = renderTexts({
    safeMode: false,
    staged: [],
    promoted: [],
    events: [],
    startupIssues: [
      {
        type: 'unresolvable',
        entryId: 'ghost',
        name: 'dsh-ghost',
        message: '插件包 dsh-ghost 无法解析（profile node_modules 中不存在），启动 import 将失败',
        fix: 'dsh plugin add dsh-ghost',
        remove: '从启动名册（cordis.patch.yml / profile）中删除该条目行，或标记 disabled: true 暂缓加载',
      },
      {
        type: 'dependency',
        entryId: 'needy',
        name: 'dsh-needy',
        message: '缺少依赖 dsh-shared（请先安装）',
        missingDeps: ['dsh-shared'],
        installHint: 'dsh plugin add dsh-shared',
        fix: 'dsh plugin add dsh-shared',
        remove: '从启动名册（cordis.patch.yml / profile）中删除该条目行，或标记 disabled: true 暂缓加载',
      },
      {
        type: 'duplicate-id',
        entryId: 'dup',
        name: 'dsh-first',
        message: '名册存在重复条目 id "dup"（2 处：dsh-first、dsh-second），加载时将抛 duplicate loader entry id',
        fix: null,
        remove: '从名册中删除重复的条目行（每个 id 保留一条）',
      },
    ],
    startupCheckedAt: 1756000000000,
    loaded: true,
  })
  const joined = texts.join('|')
  assert.ok(joined.includes('启动区问题'), 'startup-issues block title rendered')
  assert.ok(joined.includes('dsh-ghost') && joined.includes('包不可解析'), 'unresolvable badge + name rendered')
  assert.ok(joined.includes('dsh plugin add dsh-ghost'), 'repair command rendered')
  assert.ok(joined.includes('dsh plugin add dsh-shared'), 'dependency repair command rendered')
  assert.ok(joined.includes('缺少依赖 dsh-shared'), 'dependency message rendered')
  assert.ok(joined.includes('重复 id') && joined.includes('dsh-first'), 'duplicate-id badge + name rendered')
  assert.ok(joined.includes('从启动名册（cordis.patch.yml / profile）中删除该条目行'), 'removal hint rendered')
  assert.ok(joined.includes('修复') && joined.includes('移除'), 'fix/remove labels rendered')
})

test('startup issues block is absent when the roster is healthy', () => {
  const texts = renderTexts({
    safeMode: false,
    staged: [],
    promoted: [],
    events: [],
    startupIssues: [],
    startupCheckedAt: 1756000000000,
    loaded: true,
  })
  const joined = texts.join('|')
  assert.ok(!joined.includes('启动区问题'), 'no startup-issues block when empty')
})

console.log('ALL GUARDIAN CLIENT RENDER-PATH TESTS PASSED')

test('script-style suite (assertions ran at module load)', () => {})
