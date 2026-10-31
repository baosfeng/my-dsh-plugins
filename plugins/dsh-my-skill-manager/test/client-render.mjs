/* global document */
/**
 * Client render-path test (skill deck rewrite): loads lib/client.js with a
 * stubbed react (stateful hooks + microtask re-render), stubbed browser
 * globals and a canned /my-skill-manager/api, then asserts the prototype's
 * feature surface: command bar, cards/table, filters, dual-scope switches,
 * focus detail + SKILL.md preview, batch bar with inline confirm, diagnostics
 * page, toast, empty / loading / error states and the a11y contract.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── stubbed react: createElement + stateful hooks + microtask re-render ───
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

function createRenderer(component) {
  const slots = []
  let index = 0
  let pendingEffects = []
  let tree = null
  let scheduled = false
  let stopped = false
  let queue = Promise.resolve()

  function schedule() {
    if (stopped || scheduled) return
    scheduled = true
    queue = queue.then(() => {
      scheduled = false
      if (!stopped) render()
    })
  }

  function useState(initial) {
    const position = index
    index += 1
    if (slots[position] === undefined || slots[position].kind !== 'state') {
      slots[position] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
    }
    const slot = slots[position]
    return [
      slot.value,
      (next) => {
        if (slots[position] !== slot) return
        slot.value = typeof next === 'function' ? next(slot.value) : next
        schedule()
      },
    ]
  }

  function useEffect(effect, deps) {
    const position = index
    index += 1
    const previous = slots[position]
    const stableDeps = Array.isArray(deps) ? deps : undefined
    const changed =
      previous === undefined ||
      previous.kind !== 'effect' ||
      stableDeps === undefined ||
      previous.deps === undefined ||
      stableDeps.length !== previous.deps.length ||
      stableDeps.some((dep, at) => dep !== previous.deps[at])
    if (!changed) return
    if (previous !== undefined && previous.kind === 'effect' && typeof previous.cleanup === 'function') {
      previous.cleanup()
    }
    slots[position] = {
      kind: 'effect',
      deps: stableDeps === undefined ? undefined : stableDeps.slice(),
      cleanup: undefined,
    }
    pendingEffects.push(() => {
      const cleanup = effect()
      const stored = slots[position]
      if (stored !== undefined && typeof cleanup === 'function') stored.cleanup = cleanup
    })
  }

  function render() {
    index = 0
    pendingEffects = []
    tree = component({})
    const effects = pendingEffects
    pendingEffects = []
    for (const run of effects) run()
    return tree
  }

  async function settle() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await Promise.resolve()
      if (!scheduled) return
    }
  }

  function unmount() {
    if (stopped) return
    stopped = true
    for (const slot of slots) {
      if (slot !== undefined && slot.kind === 'effect' && typeof slot.cleanup === 'function') slot.cleanup()
    }
  }

  return {
    hooks: { useState, useEffect },
    render,
    settle,
    unmount,
    get tree() {
      return tree
    },
  }
}

// ── browser globals ──────────────────────────────────────────────────────
let registered = null
const documentListeners = new Map()
const styleNodes = []
let storedSession = null

global.window = {
  __ModuleLoader__: {
    load: (registration) => {
      registered = registration
    },
  },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
}
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
global.localStorage = {
  getItem: (key) => (key === 'dsh.sessions.current' ? storedSession : null),
  setItem: () => {},
}
global.document = {
  documentElement: { lang: 'zh-CN' },
  head: {
    appendChild(node) {
      styleNodes.push(node)
    },
    removeChild() {},
  },
  body: {
    appendChild() {},
    removeChild() {},
  },
  activeElement: null,
  createElement(tagName) {
    return {
      tagName,
      attrs: {},
      style: {},
      setAttribute(name, value) {
        this.attrs[name] = String(value)
      },
      appendChild() {},
      removeChild() {},
      select() {},
    }
  },
  addEventListener(type, handler) {
    if (!documentListeners.has(type)) documentListeners.set(type, new Set())
    documentListeners.get(type).add(handler)
  },
  removeEventListener(type, handler) {
    if (documentListeners.has(type)) documentListeners.get(type).delete(handler)
  },
  execCommand: () => true,
}

function dispatchDocument(type, event) {
  const handlers = documentListeners.get(type)
  if (handlers === undefined) return
  for (const handler of Array.from(handlers)) handler(event)
}

// ── canned fetch ─────────────────────────────────────────────────────────
const fetchCalls = []
let cannedResponses = []

function emptyList() {
  return {
    cwd: '',
    projectRoot: '',
    scannedAt: 0,
    skills: [],
    globalDisabled: [],
    projectDisabled: [],
    diagnostics: { missing: [] },
    usage: {},
  }
}

global.fetch = (url, options) => {
  fetchCalls.push({ url: String(url), options: options ?? {} })
  const body = cannedResponses.shift() ?? { ok: true, value: emptyList() }
  return Promise.resolve({ json: () => Promise.resolve(body) })
}

function resetFetch(responses) {
  fetchCalls.length = 0
  cannedResponses = responses.slice()
}

// ── load bundle + register the settings tab ───────────────────────────────
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered through window.__ModuleLoader__.load')
assert.equal(registered.id, 'dsh-my-skill-manager')

const stubbedReact = { createElement, useState: null, useEffect: null }
// The factory destructures hooks from require('react'); bind them to the
// renderer-agnostic wrappers exposed through a mutable holder set per mount.
let activeHooks = null
stubbedReact.useState = (initial) => activeHooks.useState(initial)
stubbedReact.useEffect = (effect, deps) => activeHooks.useEffect(effect, deps)

const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbedReact
  throw new Error('unexpected require: ' + spec)
})
assert.equal(typeof exportsObj.apply, 'function')

let capturedTab = null
const mockSlots = {
  inject: (name, register) => {
    const tab = register()
    if (name === 'settings.plugins.tab') capturedTab = tab
    return () => {}
  },
  register: (options, component) => ({ options, component }),
}
const ctx = {
  get: (name, strict = true) => (name === 'slots' ? (strict ? undefined : mockSlots) : undefined),
  effect: (fn) => {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
}
exportsObj.apply(ctx)
assert.ok(capturedTab, 'settings tab registered without a strict slots provider')
assert.equal(capturedTab.options.id, 'my-skill-manager')
assert.equal(capturedTab.options.name, 'settings.plugins.tab')
assert.equal(typeof capturedTab.component, 'function')

// ── tree helpers (expand pure function components, then walk) ─────────────
function expand(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(expand)
  const type = node.type
  if (type === undefined || type === null) throw new Error('React error #130: element type is undefined')
  if (typeof type === 'function') return expand(type(node.props ?? {}))
  return { type, props: { ...node.props, children: expand(node.props?.children) } }
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string') {
    visit(node)
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  visit(node)
  walk(node.props.children, visit)
}

function findAll(tree, predicate) {
  const out = []
  walk(tree, (node) => {
    if (typeof node !== 'string' && predicate(node)) out.push(node)
  })
  return out
}

function byClass(tree, className) {
  return findAll(tree, (node) =>
    String(node.props.className ?? '')
      .split(' ')
      .includes(className),
  )
}

function byRole(tree, role) {
  return findAll(tree, (node) => node.props.role === role)
}

function textOf(tree) {
  const parts = []
  walk(tree, (node) => {
    if (typeof node === 'string') parts.push(node)
  })
  return parts.join('|')
}

function buttonWithText(tree, needle) {
  return findAll(tree, (node) => node.type === 'button' && textOf(node).includes(needle))
}

function byAria(tree, label) {
  return findAll(tree, (node) => node.type === 'button' && node.props['aria-label'] === label)
}

function switchFor(tree, name, scopeLabel) {
  return findAll(
    tree,
    (node) =>
      node.type === 'button' &&
      node.props.role === 'switch' &&
      typeof node.props['aria-label'] === 'string' &&
      node.props['aria-label'].includes(name) &&
      node.props['aria-label'].includes(scopeLabel),
  )
}

const fakeEvent = (extra = {}) => ({
  stopPropagation() {},
  preventDefault() {},
  target: { closest: () => null },
  ...extra,
})

function click(node, extra) {
  assert.equal(typeof node?.props?.onClick, 'function', 'element must be clickable')
  node.props.onClick(fakeEvent(extra))
}

function change(node, value) {
  assert.equal(typeof node?.props?.onChange, 'function', 'element must be changeable')
  node.props.onChange({ target: { value } })
}

function toggleBox(node, checked) {
  assert.equal(typeof node?.props?.onChange, 'function', 'checkbox must be changeable')
  node.props.onChange({ target: { checked } })
}

// ── fixtures ─────────────────────────────────────────────────────────────
const SCANNED_AT = new Date(2026, 9, 24, 18, 12, 33).getTime()
const USED_AT = new Date(2026, 9, 23, 18, 20).getTime()

function deckPayload() {
  return {
    cwd: '/work/proj',
    projectRoot: '/work/proj',
    scannedAt: SCANNED_AT,
    skills: [
      {
        name: 'agent-browser',
        description: '使用本地 CLI 完成浏览器自动化与截图',
        source: 'user-agents',
        provider: 'filesystem',
        path: '/u/agent-browser/SKILL.md',
        cataloged: true,
        invocation: { modelInvocable: true, userInvocable: true },
        usage: { count: 8, lastUsedAt: USED_AT, lastSource: 'model' },
      },
      {
        name: 'codebase-memory',
        description: '按调用链与影响面查符号',
        source: 'project-dsh',
        provider: 'filesystem',
        path: '/work/proj/skills/codebase-memory/SKILL.md',
        cataloged: true,
        invocation: { modelInvocable: true, userInvocable: false },
      },
      {
        name: 'web-search',
        description: '宿主内置联网检索',
        source: 'bundled',
        provider: 'filesystem',
        path: '/b/web-search/SKILL.md',
        cataloged: true,
        invocation: { modelInvocable: true, userInvocable: true },
      },
      {
        // 目录扫描发现、当前调用方 catalog 不可见：仍是可管理的正常 skill，
        // 不算异常（异常只认 diagnostics.missing）。
        name: 'draft-skill',
        description: '目录扫描发现的正常技能',
        source: 'user-agents',
        provider: 'filesystem',
        path: '/u/draft-skill/SKILL.md',
        cataloged: false,
      },
    ],
    globalDisabled: ['web-search'],
    projectDisabled: ['codebase-memory'],
    diagnostics: {
      missing: [
        { name: 'old-skill', path: '/u/old-skill', reason: 'broken-symlink' },
        { name: 'draft2', path: '/p/draft2', reason: 'missing-skill-md' },
      ],
    },
    usage: {
      'agent-browser': { count: 8, lastUsedAt: USED_AT, lastSource: 'model' },
    },
  }
}

const SKILL_MD = Array.from({ length: 20 }, (_, index) => 'line-' + String(index + 1)).join('\n')

async function mount(options = {}) {
  const { lang = 'zh-CN', session = null, responses = [] } = options
  document.documentElement.lang = lang
  storedSession = session === null ? null : JSON.stringify({ sessionId: session })
  resetFetch(responses)
  // Bind the factory's hook closures to this renderer before the first render.
  const renderer = createRenderer(capturedTab.component)
  activeHooks = renderer.hooks
  renderer.render()
  await renderer.settle()
  return renderer
}

/** Mount with a session + deck payload (the common case). */
async function mountDeck(overrides = {}) {
  const payload = { ok: true, value: deckPayload() }
  const renderer = await mount({
    session: 'sess-1',
    responses: [{ ok: true, value: { cwd: '/work/proj' } }, payload],
    ...overrides,
  })
  return renderer
}

// ── tests ────────────────────────────────────────────────────────────────
test('tab registration, i18n label and style injection', () => {
  assert.equal(styleNodes.length, 1, 'one <style> injected on activate')
  assert.equal(styleNodes[0].attrs['data-dsh-my-skill-manager'], 'styles')
  assert.ok(styleNodes[0].textContent.includes('.dsh-my-skill-manager-root'), 'stylesheet injected')
  assert.ok(styleNodes[0].textContent.includes('--dsw-alias-label-primary'), 'uses host semantic tokens')
  assert.ok(!/#[0-9a-fA-F]{3,8}/.test(styleNodes[0].textContent), 'no raw hex colours in the stylesheet')

  document.documentElement.lang = 'zh-CN'
  assert.equal(capturedTab.options.label(), 'Skill 管理')
  document.documentElement.lang = 'en-US'
  assert.equal(capturedTab.options.label(), 'Skill Manager')
  document.documentElement.lang = 'zh-CN'
})

test('loading skeleton then card deck with groups, counts and dual-scope switches', async () => {
  const renderer = await mountDeck()
  try {
    const tree = expand(renderer.tree)
    const text = textOf(tree)
    assert.ok(!text.includes('加载中'), 'skeleton replaced after load')
    assert.ok(byClass(tree, 'dsh-my-skill-manager-skeleton').length === 0)

    // 扫描发现（cataloged:false）的 draft-skill 仍在「用户」组；只有 missing 进「异常」组
    const groupHeads = byClass(tree, 'dsh-my-skill-manager-group-head')
    assert.deepEqual(
      groupHeads.map((head) => textOf(head)),
      [
        '本项目|1|project-dsh · filesystem',
        '用户|2|user-agents · filesystem',
        '内置|1|bundled · filesystem',
        '异常|2|扫描失败 · 需要修复',
      ],
    )
    assert.ok(text.includes('codebase-memory'))
    assert.ok(text.includes('agent-browser'))
    assert.ok(text.includes('web-search'))
    assert.ok(text.includes('使用'), 'usage column labels rendered')

    // 4 overview numbers + diagnostic entry with count
    const stats = byClass(tree, 'dsh-my-skill-manager-stat')
    assert.deepEqual(
      stats.map((stat) => textOf(stat)),
      ['全部|6', '启用|3', '禁用|1', '异常|2'],
      'compact overview segments: label + number',
    )
    assert.equal(stats[0].props['aria-pressed'], true, '全部 active by default')
    const diagEntry = byClass(tree, 'dsh-my-skill-manager-diag-entry')[0]
    assert.ok(String(diagEntry.props['aria-label']).includes('2 项异常'))
    assert.ok(textOf(diagEntry).includes('2'), 'diagnostics entry carries the count')

    // 来源 / 状态 chips 不再常驻；筛选按钮收起它们
    assert.equal(byClass(tree, 'dsh-my-skill-manager-chip').length, 0, 'no always-on chip rows')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-panel').length, 0, 'filter panel closed by default')
    const filterButton = byClass(tree, 'dsh-my-skill-manager-filter-btn')[0]
    assert.ok(filterButton, 'filter button rendered')
    assert.equal(filterButton.props['aria-expanded'], false)
    assert.ok(textOf(filterButton).includes('筛选'))
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-btn-count').length, 0, 'no active-filter badge by default')

    // dual scope switches derive from the two disabled lists
    const globalSwitch = switchFor(tree, 'web-search', '全局')[0]
    assert.equal(globalSwitch.props['aria-checked'], false, 'global switch off via globalDisabled')
    const projectSwitch = switchFor(tree, 'web-search', '本项目')[0]
    assert.equal(projectSwitch.props['aria-checked'], true, 'project switch on')
    const cmGlobal = switchFor(tree, 'codebase-memory', '全局')[0]
    const cmProject = switchFor(tree, 'codebase-memory', '本项目')[0]
    assert.equal(cmGlobal.props['aria-checked'], true)
    assert.equal(cmProject.props['aria-checked'], false)
    assert.ok(String(cmProject.props.className).includes('switch-warn'), 'project-only-off is a warn switch')

    // 目录扫描发现但 catalog 不可见的正常行：照常按来源分组、两个开关可用
    const draftGlobal = switchFor(tree, 'draft-skill', '全局')[0]
    assert.equal(draftGlobal.props['aria-checked'], true, 'scan-discovered skill is enabled by default')
    assert.notEqual(draftGlobal.props.disabled, true, 'global switch is usable')
    const draftProject = switchFor(tree, 'draft-skill', '本项目')[0]
    assert.equal(draftProject.props['aria-checked'], true)
    assert.notEqual(draftProject.props.disabled, true, 'project switch is usable')
    assert.ok(!text.includes('未收录'), 'no "not cataloged" wording anywhere')
    assert.ok(!text.includes('不注入'), 'no misleading "not injected" wording')

    // scan time + result count
    assert.ok(text.includes('上次扫描 18:12:33'))
    assert.ok(byClass(tree, 'dsh-my-skill-manager-result')[0] !== undefined)
    assert.ok(textOf(byClass(tree, 'dsh-my-skill-manager-result')[0]).includes('6'))

    // session + list calls
    assert.ok(fetchCalls[0].url.startsWith('/my-skill-manager/api/session'))
    assert.ok(fetchCalls[0].url.includes('sessionId=sess-1'))
    assert.ok(fetchCalls[1].url.startsWith('/my-skill-manager/api/list'))
    assert.ok(fetchCalls[1].url.includes(encodeURIComponent('/work/proj')))
  } finally {
    renderer.unmount()
  }
})

test('compact 564px layout: icon-only controls and no always-on chip rows', async () => {
  const renderer = await mountDeck()
  try {
    const tree = expand(renderer.tree)
    const viewButtons = findAll(byClass(tree, 'dsh-my-skill-manager-seg')[0], (node) => node.type === 'button')
    assert.equal(viewButtons.length, 2)
    assert.deepEqual(
      viewButtons.map((button) => textOf(button)),
      ['', ''],
      'view switch keeps icons only (no visible text)',
    )
    assert.deepEqual(
      viewButtons.map((button) => button.props['aria-label']),
      ['卡片流', '紧凑表'],
    )
    const scan = byClass(tree, 'dsh-my-skill-manager-scan')[0]
    assert.equal(textOf(scan), '', 'rescan is icon-only')
    assert.equal(scan.props['aria-label'], '重新扫描技能目录')
    const select = byClass(tree, 'dsh-my-skill-manager-select-btn')[0]
    assert.equal(textOf(select), '', 'select is icon-only')
    assert.equal(select.props['aria-label'], '进入选择模式')
    const filterButton = byClass(tree, 'dsh-my-skill-manager-filter-btn')[0]
    assert.equal(textOf(filterButton), '筛选', 'filter button keeps its short label')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-chip').length, 0, 'no always-on chips')
  } finally {
    renderer.unmount()
  }
})

test('filters: search, stat filters, unused only, empty no-result state and Esc', async () => {
  const renderer = await mountDeck()
  try {
    let tree = expand(renderer.tree)
    const searchInput = byClass(tree, 'dsh-my-skill-manager-search-input')[0]
    change(searchInput, 'browser')
    await renderer.settle()
    tree = expand(renderer.tree)
    const names = byClass(tree, 'dsh-my-skill-manager-name').map((node) => textOf(node))
    assert.deepEqual(names, ['agent-browser'], 'search filters the cards')

    change(byClass(tree, 'dsh-my-skill-manager-search-input')[0], 'kubernetes-operator')
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.ok(textOf(tree).includes('没有找到「kubernetes-operator」'))
    assert.ok(byClass(tree, 'dsh-my-skill-manager-empty').length === 1)

    // Esc clears the query (and keeps the deck mounted)
    dispatchDocument('keydown', { key: 'Escape' })
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-search-input')[0].props.value, '')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-empty').length, 0)

    // 打开筛选面板：来源 / 状态 / 只看未使用都在面板里
    click(byClass(tree, 'dsh-my-skill-manager-filter-btn')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    let panel = byRole(tree, 'dialog')[0]
    assert.ok(panel, 'filter panel opens')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-btn')[0].props['aria-expanded'], true)
    assert.ok(byClass(panel, 'dsh-my-skill-manager-chip').length >= 8, 'source + status chips live in the panel')
    const unusedSwitch = byRole(panel, 'switch')[0]
    assert.equal(unusedSwitch.props['aria-checked'], false)

    // 面板内状态筛选「禁用」→ 只剩 web-search（globalDisabled）
    const disabledChip = byClass(panel, 'dsh-my-skill-manager-chip').find((chip) => textOf(chip).startsWith('禁用'))
    click(disabledChip)
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.deepEqual(
      byClass(tree, 'dsh-my-skill-manager-name').map((node) => textOf(node)),
      ['web-search'],
    )
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-btn-count')[0].props.children, '1')

    // Esc 关闭面板但保留筛选条件
    dispatchDocument('keydown', { key: 'Escape' })
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byRole(tree, 'dialog').length, 0, 'Esc closes the filter panel')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-btn')[0].props['aria-expanded'], false)

    // stat: anomaly → only diagnostics.missing rows (draft-skill is manageable, not an anomaly)
    click(byClass(tree, 'dsh-my-skill-manager-stat')[3])
    await renderer.settle()
    tree = expand(renderer.tree)
    const anomalyNames = byClass(tree, 'dsh-my-skill-manager-name').map((node) => textOf(node))
    assert.deepEqual(anomalyNames.sort(), ['draft2', 'old-skill'].sort())

    // unused only (with filters reset)
    click(byClass(tree, 'dsh-my-skill-manager-stat')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    click(byClass(tree, 'dsh-my-skill-manager-filter-btn')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    click(byRole(tree, 'dialog')[0] ? byRole(byRole(tree, 'dialog')[0], 'switch')[0] : null)
    await renderer.settle()
    tree = expand(renderer.tree)
    const unusedNames = byClass(tree, 'dsh-my-skill-manager-name').map((node) => textOf(node))
    assert.ok(!unusedNames.includes('agent-browser'), 'used skill hidden by 只看未使用')
    assert.ok(unusedNames.includes('codebase-memory'))
    assert.ok(unusedNames.includes('draft-skill'), 'scan-discovered unused skill included')
    assert.ok(!unusedNames.includes('old-skill'), 'scan failures have no usage semantics')
    assert.equal(byRole(byRole(tree, 'dialog')[0], 'switch')[0].props['aria-checked'], true)

    // reset filters from the filtered empty state
    change(byClass(tree, 'dsh-my-skill-manager-search-input')[0], 'zzz-not-found')
    await renderer.settle()
    tree = expand(renderer.tree)
    const resetButton = buttonWithText(byRole(tree, 'dialog')[0], '重置')[0]
    click(resetButton)
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-btn-count').length, 0, 'reset clears the badge')
    click(buttonWithText(byRole(tree, 'dialog')[0], '关闭')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.ok(byClass(tree, 'dsh-my-skill-manager-name').length >= 3, 'reset restores the list')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-search-input')[0].props.value, '')
  } finally {
    renderer.unmount()
  }
})

test('filter panel: opens, counts active conditions, closes on outside click and Esc', async () => {
  const renderer = await mountDeck()
  try {
    let tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-btn')[0].props['aria-expanded'], false)
    click(byClass(tree, 'dsh-my-skill-manager-filter-btn')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    const panel = byRole(tree, 'dialog')[0]
    assert.ok(panel, 'filter panel opens')
    assert.equal(panel.props['aria-label'], '筛选')
    assert.ok(byClass(panel, 'dsh-my-skill-manager-filter-group').length >= 2, 'source + status groups')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-btn')[0].props['aria-expanded'], true)

    // 来源「用户」→ 生效条件 1，徽标与 aria-label 同步
    const userChip = byClass(panel, 'dsh-my-skill-manager-chip').find((chip) => textOf(chip).startsWith('用户'))
    click(userChip)
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-btn-count')[0].props.children, '1')
    assert.ok(String(byClass(tree, 'dsh-my-skill-manager-filter-btn')[0].props['aria-label']).includes('1'))

    // 点外部关闭（document click）
    dispatchDocument('click', { target: null })
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byRole(tree, 'dialog').length, 0, 'outside click closes the panel')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-btn-count')[0].props.children, '1', 'conditions kept')

    // Esc 再开再关
    click(byClass(tree, 'dsh-my-skill-manager-filter-btn')[0])
    await renderer.settle()
    dispatchDocument('keydown', { key: 'Escape' })
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byRole(tree, 'dialog').length, 0, 'Esc closes the panel')

    // 重置清空条件与徽标
    click(byClass(tree, 'dsh-my-skill-manager-filter-btn')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    click(buttonWithText(byRole(tree, 'dialog')[0], '重置')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-btn-count').length, 0, 'reset clears the badge')
  } finally {
    renderer.unmount()
  }
})

test('sort menu (four keys + direction) and compact table view with aria-sort', async () => {
  const renderer = await mountDeck()
  try {
    let tree = expand(renderer.tree)
    assert.deepEqual(
      byClass(tree, 'dsh-my-skill-manager-name').map((node) => textOf(node)),
      ['codebase-memory', 'agent-browser', 'draft-skill', 'web-search', 'draft2', 'old-skill'],
      'card groups keep project → user → built-in → issues order with name sort inside',
    )

    // open the sort menu and pick 使用次数
    const sortButton = byClass(tree, 'dsh-my-skill-manager-tool-text')[0]
    click(sortButton)
    await renderer.settle()
    tree = expand(renderer.tree)
    const menuItems = byRole(tree, 'menuitemradio')
    assert.equal(menuItems.length, 4, 'four sort options')
    assert.equal(menuItems[0].props['aria-checked'], true, 'name selected by default')
    click(menuItems[1])
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-tool-text')[0].props.children[1].props.children, '使用次数')
    assert.deepEqual(
      byClass(tree, 'dsh-my-skill-manager-name')
        .map((node) => textOf(node))
        .slice(0, 3),
      ['codebase-memory', 'agent-browser', 'draft-skill'],
      'usage desc keeps the used skill first within its group',
    )

    // direction toggle flips inside groups
    click(byClass(tree, 'dsh-my-skill-manager-sort-dir')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    const firstGroupNames = []
    for (const card of byClass(tree, 'dsh-my-skill-manager-card')) {
      firstGroupNames.push(textOf(byClass(card, 'dsh-my-skill-manager-name')[0]))
    }
    assert.deepEqual(firstGroupNames, [
      'codebase-memory',
      'draft-skill',
      'agent-browser',
      'web-search',
      'draft2',
      'old-skill',
    ])

    // switch to the compact table
    const tableButton = byAria(tree, '紧凑表')[0]
    click(tableButton)
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-table').length, 1)
    const headers = byClass(tree, 'dsh-my-skill-manager-th-sort')
    assert.deepEqual(
      headers.map((node) => node.props['aria-sort']),
      ['none', 'none', 'ascending', 'none'],
      'active sort column exposes aria-sort (direction toggled to ascending)',
    )
    const rows = byClass(tree, 'dsh-my-skill-manager-row')
    assert.equal(rows.length, 6, 'one row per skill (incl. anomalies)')
    // sortable header click shares the same state as the dropdown
    const nameSortButton = findAll(headers[0], (node) => node.type === 'button')[0]
    click(nameSortButton)
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(
      byClass(tree, 'dsh-my-skill-manager-th-sort')[0].props['aria-sort'],
      'ascending',
      'header click sets name ascending',
    )
  } finally {
    renderer.unmount()
  }
})

test('single-scope toggles write config, toast, and inline error + retry', async () => {
  const renderer = await mountDeck()
  try {
    let tree = expand(renderer.tree)
    // enable web-search globally: globalDisabled was ['web-search'] → []
    cannedResponses = [{ ok: true }]
    click(switchFor(tree, 'web-search', '全局')[0])
    await renderer.settle()
    const put = fetchCalls.filter((call) => call.url.startsWith('/my-skill-manager/api/config')).pop()
    assert.ok(put, 'global toggle issues PUT /config')
    assert.equal(put.options.method, 'PUT')
    const payload = JSON.parse(put.options.body)
    assert.equal(payload.scope, 'global')
    assert.deepEqual(payload.disabled, [])
    assert.equal(payload.cwd, '')
    tree = expand(renderer.tree)
    assert.equal(switchFor(tree, 'web-search', '全局')[0].props['aria-checked'], true, 'optimistic state applied')
    assert.ok(textOf(tree).includes('已启用「web-search」 · 全局'))

    // project toggle carries the session cwd
    cannedResponses = [{ ok: true }]
    click(switchFor(tree, 'agent-browser', '本项目')[0])
    await renderer.settle()
    const projectPut = fetchCalls.filter((call) => call.url.startsWith('/my-skill-manager/api/config')).pop()
    const projectPayload = JSON.parse(projectPut.options.body)
    assert.equal(projectPayload.scope, 'project')
    assert.deepEqual(projectPayload.disabled, ['codebase-memory', 'agent-browser'])
    assert.equal(projectPayload.cwd, '/work/proj')

    // failure → inline error + retry succeeds
    cannedResponses = [{ ok: false, error: { code: 'eacces', message: 'EACCES permission denied' } }]
    click(switchFor(tree, 'codebase-memory', '全局')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    const inline = byClass(tree, 'dsh-my-skill-manager-inline-error')
    assert.equal(inline.length, 1, 'inline error rendered on failure')
    assert.ok(textOf(inline[0]).includes('EACCES permission denied'))
    assert.ok(textOf(inline[0]).includes('未能更新「codebase-memory」'))

    cannedResponses = [{ ok: true }]
    const retry = buttonWithText(tree, '重试')[0]
    click(retry)
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-inline-error').length, 0, 'retry clears the inline error')
    const retried = fetchCalls.filter((call) => call.url.startsWith('/my-skill-manager/api/config')).pop()
    assert.deepEqual(JSON.parse(retried.options.body).disabled, ['codebase-memory'])
  } finally {
    renderer.unmount()
  }
})

test('focus detail fetches SKILL.md, previews 15 lines and copies path/content', async () => {
  const written = []
  global.navigator.clipboard = {
    writeText: (value) => {
      written.push(value)
      return Promise.resolve()
    },
  }
  const renderer = await mountDeck()
  try {
    let tree = expand(renderer.tree)
    cannedResponses = [
      {
        ok: true,
        value: {
          name: 'codebase-memory',
          path: '/work/proj/skills/codebase-memory/SKILL.md',
          content: SKILL_MD,
          truncated: true,
        },
      },
    ]
    const openButton = findAll(
      tree,
      (node) =>
        node.type === 'button' &&
        String(node.props.className ?? '').includes('card-open') &&
        textOf(node).includes('codebase-memory'),
    )[0]
    click(openButton)
    await renderer.settle()
    tree = expand(renderer.tree)
    const detailCall = fetchCalls.filter((call) => call.url.startsWith('/my-skill-manager/api/detail')).pop()
    assert.ok(detailCall, 'expanding fetches /detail')
    assert.ok(detailCall.url.includes('name=codebase-memory'))
    assert.ok(detailCall.url.includes('cwd=' + encodeURIComponent('/work/proj')))

    const pre = byClass(tree, 'dsh-my-skill-manager-pre')[0]
    assert.ok(pre !== undefined, 'SKILL.md preview rendered')
    const preview = pre.props.children
    assert.ok(preview.startsWith('line-1'))
    assert.ok(preview.includes('line-15'))
    assert.ok(!preview.includes('line-16'), 'preview limited to 15 lines')
    const detailText = textOf(byClass(tree, 'dsh-my-skill-manager-detail')[0])
    assert.ok(detailText.includes('/work/proj/skills/codebase-memory/SKILL.md'))
    assert.ok(detailText.includes('模型可调用'))
    assert.ok(detailText.includes('用户可调用') === false, 'userInvocable false hides that capability')
    assert.ok(detailText.includes('已截断至 256KB'))

    // copy path
    click(
      findAll(
        tree,
        (node) =>
          node.type === 'button' && String(node.props['aria-label'] ?? '').includes('复制 codebase-memory 的路径'),
      )[0],
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(written.pop(), '/work/proj/skills/codebase-memory/SKILL.md')
    tree = expand(renderer.tree)
    assert.ok(textOf(tree).includes('已复制路径'))

    // copy full SKILL.md
    click(buttonWithText(tree, '复制全文')[0])
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(written.pop(), SKILL_MD)
    tree = expand(renderer.tree)
    assert.ok(textOf(tree).includes('已复制 SKILL.md 全文'))

    // anomaly rows show the reason block instead of a preview and never fetch
    const callsBefore = fetchCalls.length
    click(
      findAll(
        tree,
        (node) =>
          node.type === 'button' &&
          String(node.props.className ?? '').includes('card-open') &&
          textOf(node).includes('old-skill'),
      )[0],
    )
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(fetchCalls.length, callsBefore, 'anomaly detail does not fetch SKILL.md')
    assert.ok(textOf(tree).includes('符号链接的目标不存在'))
  } finally {
    delete global.navigator.clipboard
    renderer.unmount()
  }
})

test('selection mode: bulk bar, inline confirm, two-scope write, Esc layering', async () => {
  const renderer = await mountDeck()
  try {
    let tree = expand(renderer.tree)
    click(byClass(tree, 'dsh-my-skill-manager-select-btn')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-command').length, 0, 'command bar hidden in selection mode')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-action').length, 1, 'bulk bar replaces the command bar')
    assert.ok(textOf(byClass(tree, 'dsh-my-skill-manager-action')[0]).includes('已选 0 项'))

    // check one skill via the card checkbox
    const checkbox = findAll(
      tree,
      (node) => node.type === 'input' && node.props['aria-label'] === '选择 codebase-memory',
    )[0]
    assert.ok(checkbox, 'selection checkbox rendered')
    toggleBox(checkbox, true)
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.ok(textOf(byClass(tree, 'dsh-my-skill-manager-action')[0]).includes('已选 1 项'))

    // 禁用 → inline confirm (no native confirm)
    click(buttonWithText(byClass(tree, 'dsh-my-skill-manager-action')[0], '禁用')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    const confirmBar = byClass(tree, 'dsh-my-skill-manager-action-confirm')[0]
    assert.ok(confirmBar, 'inline confirm bar rendered')
    assert.ok(textOf(confirmBar).includes('确认禁用'))

    // Esc cancels the confirm first, then exits selection
    dispatchDocument('keydown', { key: 'Escape' })
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-action-confirm').length, 0, 'Esc cancels the confirm')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-action').length, 1)
    dispatchDocument('keydown', { key: 'Escape' })
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-action').length, 0, 'Esc exits selection')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-command').length, 1)

    // re-enter, select all (table header checkbox needs the table view)
    click(byClass(tree, 'dsh-my-skill-manager-select-btn')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    click(byAria(tree, '紧凑表')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    const selectAll = findAll(
      tree,
      (node) => node.type === 'input' && node.props['aria-label'] === '选择当前视图全部技能',
    )[0]
    assert.ok(selectAll, 'select-all checkbox in the table header')
    toggleBox(selectAll, true)
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.ok(
      textOf(byClass(tree, 'dsh-my-skill-manager-action')[0]).includes('已选 6 项'),
      'all visible rows selected',
    )
    assert.ok(
      textOf(byClass(tree, 'dsh-my-skill-manager-action')[0]).includes('2 项异常将跳过'),
      'skip note counts only scan failures',
    )

    // disable: confirm then write global + project scopes
    click(buttonWithText(byClass(tree, 'dsh-my-skill-manager-action')[0], '禁用')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    cannedResponses = [{ ok: true }, { ok: true }]
    const confirmButton = buttonWithText(byClass(tree, 'dsh-my-skill-manager-action-confirm')[0], '确认禁用')[0]
    click(confirmButton)
    await renderer.settle()
    const configs = fetchCalls.filter((call) => call.url.startsWith('/my-skill-manager/api/config'))
    assert.equal(configs.length, 2, 'bulk disable writes global + project')
    const scopes = configs.map((call) => JSON.parse(call.options.body).scope).sort()
    assert.deepEqual(scopes, ['global', 'project'])
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-action').length, 0, 'selection exits after the write')
    assert.ok(textOf(tree).includes('已禁用 4 项 · 跳过 2 项异常'))
    assert.equal(switchFor(tree, 'codebase-memory', '全局')[0].props['aria-checked'], false)
  } finally {
    renderer.unmount()
  }
})

test('diagnostics page: uncataloged + scan failures, reasons, copy path, back', async () => {
  const written = []
  global.navigator.clipboard = {
    writeText: (value) => {
      written.push(value)
      return Promise.resolve()
    },
  }
  const renderer = await mountDeck()
  try {
    let tree = expand(renderer.tree)
    click(byClass(tree, 'dsh-my-skill-manager-diag-entry')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-command').length, 0, 'command bar hidden in diagnostics')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-panel').length, 0)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-filter-btn').length, 0)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-toolbar').length, 0)
    const cards = byClass(tree, 'dsh-my-skill-manager-diag-card')
    assert.equal(cards.length, 2, 'only diagnostics.missing entries')
    const diagText = textOf(byClass(tree, 'dsh-my-skill-manager-diag')[0])
    assert.ok(diagText.includes('old-skill') && diagText.includes('坏符号链接'))
    assert.ok(diagText.includes('/u/old-skill'))
    assert.ok(diagText.includes('draft2') && diagText.includes('缺 SKILL.md'))
    assert.ok(!diagText.includes('draft-skill'), 'scan-discovered normal skill is not a diagnostic')
    assert.ok(diagText.includes('扫描异常') && !diagText.includes('未收录'))
    assert.ok(diagText.includes('扫描范围：本项目 · 用户 · 内置'))

    click(
      findAll(
        cards,
        (node) => node.type === 'button' && String(node.props['aria-label'] ?? '').includes('复制 old-skill 的路径'),
      )[0],
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(written.pop(), '/u/old-skill')

    click(findAll(tree, (node) => node.type === 'button' && node.props['aria-label'] === '返回技能台')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-command').length, 1, 'back restores the deck')
  } finally {
    delete global.navigator.clipboard
    renderer.unmount()
  }
})

test('no project context: disabled project scope, note, noproject empty state', async () => {
  const renderer = await mount({
    session: null,
    responses: [
      {
        ok: true,
        value: {
          ...emptyList(),
          skills: [
            {
              name: 'agent-browser',
              description: '浏览器自动化',
              source: 'user-agents',
              provider: 'filesystem',
              path: '/u/agent-browser/SKILL.md',
              cataloged: true,
            },
          ],
        },
      },
    ],
  })
  try {
    let tree = expand(renderer.tree)
    const text = textOf(tree)
    assert.ok(text.includes('未绑定项目 · 本项目作用域不可用'), 'project note in the command bar')
    const projectSwitch = switchFor(tree, 'agent-browser', '本项目')[0]
    assert.equal(projectSwitch.props.disabled, true, 'project switch disabled without a project')
    assert.equal(projectSwitch.props['aria-checked'], false)
    assert.equal(
      fetchCalls[0].url.startsWith('/my-skill-manager/api/list'),
      true,
      'no session call without a session id',
    )

    // 本项目 source filter（面板内）→ noproject empty state with a disabled switch preview
    click(byClass(tree, 'dsh-my-skill-manager-filter-btn')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    const projectChip = byClass(byRole(tree, 'dialog')[0], 'dsh-my-skill-manager-chip').find((chip) =>
      textOf(chip).startsWith('本项目'),
    )
    click(projectChip)
    await renderer.settle()
    tree = expand(renderer.tree)
    click(buttonWithText(byRole(tree, 'dialog')[0], '关闭')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    const emptyText = textOf(byClass(tree, 'dsh-my-skill-manager-empty')[0])
    assert.ok(emptyText.includes('没有可用的项目上下文'))
    const previewSwitch = byClass(tree, 'dsh-my-skill-manager-empty-preview')[0]
    assert.ok(previewSwitch !== undefined)
    assert.equal(byRole(previewSwitch, 'switch')[0].props.disabled, true)

    click(buttonWithText(tree, '查看全部来源')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.ok(byClass(tree, 'dsh-my-skill-manager-name').length === 1, 'show-all returns to the deck')
  } finally {
    renderer.unmount()
  }
})

test('list failure shows the error state and retry rescans', async () => {
  const renderer = await mount({
    session: null,
    responses: [{ ok: false, error: { code: 'eacces', message: 'EACCES permission denied' } }],
  })
  try {
    let tree = expand(renderer.tree)
    const errorNode = byClass(tree, 'dsh-my-skill-manager-error')[0]
    assert.ok(errorNode, 'error state rendered')
    const errorText = textOf(errorNode)
    assert.ok(errorText.includes('扫描失败'))
    assert.ok(errorText.includes('EACCES permission denied'))

    cannedResponses = [
      {
        ok: true,
        value: {
          ...emptyList(),
          skills: [
            {
              name: 'web-search',
              description: '检索',
              source: 'bundled',
              provider: 'filesystem',
              path: '/b/web-search/SKILL.md',
              cataloged: true,
            },
          ],
          scannedAt: SCANNED_AT,
        },
      },
    ]
    click(buttonWithText(tree, '重试扫描')[0])
    await renderer.settle()
    assert.ok(
      fetchCalls.some((call) => call.url.startsWith('/my-skill-manager/api/rescan')),
      'retry issues /rescan',
    )
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-error').length, 0)
    assert.ok(textOf(tree).includes('web-search'))
    assert.ok(textOf(tree).includes('扫描完成 · 1 项，0 项异常'))
  } finally {
    renderer.unmount()
  }
})

test('rescan shows the loading label and a fresh scan time', async () => {
  const renderer = await mountDeck()
  try {
    let tree = expand(renderer.tree)
    cannedResponses = [{ ok: true, value: { ...deckPayload(), scannedAt: SCANNED_AT + 60_000 } }]
    click(byClass(tree, 'dsh-my-skill-manager-scan')[0])
    // 请求发出后、响应落地前：按钮进入扫描中且禁用（同步重渲染观察该帧）
    renderer.render()
    tree = expand(renderer.tree)
    const scan = byClass(tree, 'dsh-my-skill-manager-scan')[0]
    assert.equal(scan.props.disabled, true, 'scan button disabled while scanning')
    assert.ok(String(scan.props['aria-label']).includes('扫描中…'))
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.ok(textOf(tree).includes('上次扫描 18:13:33'), 'scan time refreshed from scannedAt')
    assert.ok(textOf(tree).includes('扫描完成 · 6 项，2 项异常'))
    assert.ok(fetchCalls.some((call) => call.url.startsWith('/my-skill-manager/api/rescan')))
  } finally {
    renderer.unmount()
  }
})

test('keyboard: ⌘K leaves diagnostics and Esc collapses an expanded card', async () => {
  const renderer = await mountDeck()
  try {
    let tree = expand(renderer.tree)
    click(byClass(tree, 'dsh-my-skill-manager-diag-entry')[0])
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-diag').length, 1)
    dispatchDocument('keydown', { key: 'k', metaKey: true, preventDefault() {} })
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-diag').length, 0, '⌘K returns to the deck')
    assert.equal(byClass(tree, 'dsh-my-skill-manager-command').length, 1)

    // 展开一张卡后 Esc 收起详情（搜索词为空时）
    const open = findAll(
      tree,
      (node) =>
        node.type === 'button' &&
        String(node.props.className ?? '').includes('card-open') &&
        textOf(node).includes('web-search'),
    )[0]
    click(open)
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.ok(byClass(tree, 'dsh-my-skill-manager-detail').length >= 1)
    dispatchDocument('keydown', { key: 'Escape' })
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.equal(byClass(tree, 'dsh-my-skill-manager-detail').length, 0, 'Esc collapses the focus detail')
  } finally {
    renderer.unmount()
  }
})

test('scan-discovered skills remain manageable (no false anomaly, no misleading copy)', async () => {
  const renderer = await mountDeck()
  try {
    let tree = expand(renderer.tree)
    const userGroup = byClass(tree, 'dsh-my-skill-manager-group').find((node) => node.props['data-group'] === 'user')
    assert.ok(userGroup, 'user group rendered')
    assert.ok(textOf(userGroup).includes('draft-skill'), 'scan-discovered skill groups by its real source')
    assert.equal(byClass(userGroup, 'dsh-my-skill-manager-card').length, 2)

    const stats = byClass(tree, 'dsh-my-skill-manager-stat').map((node) => textOf(node))
    assert.deepEqual(stats, ['全部|6', '启用|3', '禁用|1', '异常|2'])

    const draftGlobal = switchFor(tree, 'draft-skill', '全局')[0]
    assert.equal(draftGlobal.props['aria-checked'], true, 'enabled by default')
    assert.notEqual(draftGlobal.props.disabled, true, 'global switch usable')

    // 单行启停照常写配置（globalDisabled: ['web-search'] → 追加 draft-skill）
    cannedResponses = [{ ok: true }]
    click(draftGlobal)
    await renderer.settle()
    const put = fetchCalls.filter((call) => call.url.startsWith('/my-skill-manager/api/config')).pop()
    assert.ok(put, 'scan-discovered row writes config')
    assert.equal(JSON.parse(put.options.body).scope, 'global')
    assert.deepEqual(JSON.parse(put.options.body).disabled, ['web-search', 'draft-skill'])
    tree = expand(renderer.tree)
    assert.equal(switchFor(tree, 'draft-skill', '全局')[0].props['aria-checked'], false)
    assert.ok(textOf(tree).includes('已禁用「draft-skill」 · 全局'))

    // 「异常」状态只筛 diagnostics.missing 两条
    click(byClass(tree, 'dsh-my-skill-manager-stat')[3])
    await renderer.settle()
    tree = expand(renderer.tree)
    assert.deepEqual(
      byClass(tree, 'dsh-my-skill-manager-name')
        .map((node) => textOf(node))
        .sort(),
      ['draft2', 'old-skill'],
    )
    assert.ok(!textOf(tree).includes('未收录'))
  } finally {
    renderer.unmount()
  }
})

test('scan-discovered detail reads SKILL.md and labels the source neutrally', async () => {
  const renderer = await mountDeck()
  try {
    let tree = expand(renderer.tree)
    cannedResponses = [
      {
        ok: true,
        value: { name: 'draft-skill', path: '/u/draft-skill/SKILL.md', content: SKILL_MD, truncated: false },
      },
    ]
    const open = findAll(
      tree,
      (node) =>
        node.type === 'button' &&
        String(node.props.className ?? '').includes('card-open') &&
        textOf(node).includes('draft-skill'),
    )[0]
    click(open)
    await renderer.settle()
    tree = expand(renderer.tree)
    const detailCall = fetchCalls.filter((call) => call.url.startsWith('/my-skill-manager/api/detail')).pop()
    assert.ok(detailCall, 'scan-discovered detail is readable')
    assert.ok(detailCall.url.includes('name=draft-skill'))

    const detail = byClass(tree, 'dsh-my-skill-manager-detail')[0]
    const detailText = textOf(detail)
    assert.ok(detailText.includes('目录发现'), 'neutral source label instead of 未收录')
    assert.ok(!detailText.includes('未收录'))
    const rows = byClass(detail, 'dsh-my-skill-manager-meta-row')
    const capsRow = rows.find((row) => textOf(row).startsWith('调用能力'))
    assert.ok(capsRow, 'invocation row rendered')
    assert.ok(textOf(capsRow).includes('—'), 'unknown invocation is shown as — instead of 不可调用')
    assert.equal(byClass(detail, 'dsh-my-skill-manager-pre').length, 1, 'SKILL.md preview rendered')
  } finally {
    renderer.unmount()
  }
})

test('English locale renders English copy and aria labels', async () => {
  const renderer = await mountDeck({ lang: 'en-US' })
  try {
    const tree = expand(renderer.tree)
    const text = textOf(tree)
    assert.ok(byAria(tree, 'Rescan skill directories').length === 1, 'icon-only rescan keeps an English aria-label')
    assert.ok(text.includes('Filter'), 'filter button label in English')
    assert.ok(text.includes('Search name, description or path') === false, 'placeholder is not in the text tree')
    const searchInput = byClass(tree, 'dsh-my-skill-manager-search-input')[0]
    assert.equal(searchInput.props.placeholder, 'Search name, description or path')
    assert.equal(searchInput.props['aria-label'], 'Search skills')
    assert.ok(text.includes('Enabled') && text.includes('Disabled') && text.includes('Issues'))
    assert.ok(!text.includes('启用'), 'no mixed-language copy')
    const globalSwitch = switchFor(tree, 'web-search', 'Global')[0]
    assert.ok(globalSwitch, 'English scope label')
    assert.ok(String(globalSwitch.props['aria-label']).includes('Global scope'))
  } finally {
    renderer.unmount()
  }
})
