/**
 * Step definitions for file-icons.feature (GitHub issue #24) — client-side
 * rendering acceptance: loads the client bundle with a stubbed react, renders
 * the FileActivityView with per-file counts, and asserts each row's icon.
 *
 * NOTE: this file must NOT call setWorldConstructor — file-activity.steps.mjs
 * already owns the world; scenarios here use the default per-scenario world.
 */
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── stub react + browser globals (mirrors test/client-render.mjs) ──────────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

const hookValues = new Map()
const stubbed = {
  createElement,
  useState: (initial) => {
    const idx = hookValues.size
    if (!hookValues.has(idx)) {
      const value = typeof initial === 'function' ? initial() : initial
      hookValues.set(idx, [value, () => {}])
    }
    return hookValues.get(idx)
  },
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

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
const emptyStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
global.localStorage = emptyStorage
global.sessionStorage = emptyStorage
global.window.localStorage = emptyStorage
global.window.sessionStorage = emptyStorage
global.document = {
  head: { appendChild: () => {} },
  documentElement: { dataset: {} },
  createElement: () => ({ setAttribute: () => {}, textContent: '', parentNode: null }),
}
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) })

eval(fs.readFileSync(new URL('../../../lib/client.js', import.meta.url), 'utf8'))
if (!registered) throw new Error('client bundle did not register a tab')
const bundle = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  throw new Error('unexpected require: ' + spec)
})

/** Badge name (business language) → brand fill, kept in sync with FILE_BADGES. */
const BADGE_FILLS = {
  JS: '#F7DF1E',
  Markdown: '#42A5F5',
  JSON: '#F7DF1E',
  Python: '#3776AB',
  HTML: '#E34F26',
  CSS: '#663399',
  TSX: '#3178C6',
  Shell: '#89E051',
  YAML: '#CB171E',
  Java: '#007396',
  C: '#A8B9CC',
  'C++': '#00599C',
  'C#': '#68217A',
  Go: '#00ADD8',
  Rust: '#CE422B',
  Ruby: '#B51624',
  PHP: '#777BB4',
  SQL: '#00758F',
  Swift: '#F05138',
  Kotlin: '#7F52FF',
  Dart: '#0175C2',
  Scala: '#DC322F',
  Lua: '#2C2C7C',
  Vue: '#42B883',
  XML: '#FF6F00',
  CSV: '#2E7D32',
  DB: '#0F62FE',
  PDF: '#E5202B',
  TXT: '#90A4AE',
  TOML: '#8D6E63',
  CFG: '#546E7A',
  ZIP: '#FFA726',
  EXE: '#0078D4',
  IMG: '#8E44AD',
  Docker: '#2496ED',
  DOCK: '#2496ED',
  Gradle: '#02303A',
  Jupyter: '#F37726',
  PowerShell: '#012456',
  CMD: '#546E7A',
  GIT: '#F05032',
  ENV: '#F9A825',
  MAKE: '#607D8B',
  CMAKE: '#265774',
}

/** First <rect> fill of a row's icon svg, or null when it is not a badge. */
function badgeFillOf(svg) {
  const children = Array.isArray(svg.props.children) ? svg.props.children : [svg.props.children]
  const rect = children.find((c) => c && c.type === 'rect')
  return rect ? rect.props.fill : null
}

/** Collect each stats row's icon svg, keyed by the row's absolute-path title. */
function collectIcons(tree) {
  const byTitle = new Map()
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') return
    if (Array.isArray(node)) {
      for (const c of node) walk(c)
      return
    }
    const props = node.props ?? {}
    if (props.className === 'dfa-row' && typeof props.title === 'string' && props.title.startsWith('/')) {
      const children = Array.isArray(props.children) ? props.children : [props.children]
      const iconSpan = children.find(
        (c) => c && typeof c === 'object' && String(c.props?.className ?? '').startsWith('dfa-row-icon'),
      )
      if (iconSpan) byTitle.set(props.title, iconSpan.props.children)
    }
    walk(props.children)
  }
  walk(tree)
  return byTitle
}

// ── Given ──────────────────────────────────────────────────────────────────
Given('客户端已加载文件活动页签', function () {
  // The tab now registers through the HOST's native extension points
  // (issue #187 batch 2): capture the body seat and mount it directly.
  let capturedTabBody = null
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (_slot, factory) => factory(),
      register: (options, component) => {
        if (options.name === 'sidebar.right.pane.tab') capturedTabBody = component
        return () => {}
      },
    },
    sidebarRightTabs: { register: () => () => {}, entries: () => [] },
    documentPreviews: { register: () => () => {}, candidates: () => [] },
    sidebarRight: { openTab: () => {}, openResource: () => {}, isExpanded: () => true, active: () => undefined },
  }
  bundle.apply(ctx)
  if (capturedTabBody === null) throw new Error('tab body seat was not registered')
  hookValues.clear()
  const seat = capturedTabBody({ sessionId: 'sess-icons', visible: true })
  this.element = { type: seat.type, props: seat.props }
  this.dataStore = this.element.props.dataStore
})

// ── When ───────────────────────────────────────────────────────────────────
When('统计视图加载了文件 {string}', function (path) {
  this.paths = this.paths ?? []
  this.paths.push(path)
})

When('渲染统计视图', function () {
  const counts = {}
  for (const p of this.paths) counts[p] = { read: 1, create: 0, modify: 0 }
  this.dataStore.set({ bySession: { 'sess-icons': { recent: [], counts, loading: false } } })
  hookValues.clear()
  const tree = this.element.type(this.element.props)
  this.icons = collectIcons(tree)
})

// ── Then ───────────────────────────────────────────────────────────────────
Then('{string} 行显示 {string} 徽章', function (path, badgeName) {
  const fill = BADGE_FILLS[badgeName]
  assert.ok(fill, `unknown badge name "${badgeName}"`)
  const svg = this.icons.get(path)
  assert.ok(svg, `row icon exists for ${path}`)
  assert.equal(badgeFillOf(svg), fill, `${path} shows the ${badgeName} badge (${fill})`)
})

Then('{string} 行显示普通文件图标', function (path) {
  const svg = this.icons.get(path)
  assert.ok(svg, `row icon exists for ${path}`)
  assert.equal(badgeFillOf(svg), null, `${path} keeps the neutral file icon`)
})
