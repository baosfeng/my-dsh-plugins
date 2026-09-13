/**
 * Client contract test: the plugin's client half now rides the HOST's native
 * sidebar extension points (issue #187 batch 2) instead of the third-party
 * third-party sidebar service. This suite pins the migration contract:
 *
 *   1. injects the native services (slots / sidebarRightTabs / documentPreviews)
 *      and NOT the old third-party service;
 *   2. two-stage tab registration — sidebarRightTabs.register(def) plus the
 *      body and chip-title seats under the same id;
 *   3. documentPreviews registration carries metadata only (no byte fetching:
 *      the document owner reads the bytes on the native side);
 *   4. the floating preview mounts into the shell.overlay list seat;
 *   5. degradation is OBSERVABLE — a rejected registration logs and marks the
 *      document, it never fails silently;
 *   6. auto-open calls sidebarRight.openTab and retries when no session surface
 *      is mounted yet.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── minimal react stand-in (real element tree, simple hook slots) ──────────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}
let hookIndex = 0
const hookStore = []
const stubbedReact = {
  createElement,
  useState: (initial) => {
    const i = hookIndex++
    if (!hookStore[i]) hookStore[i] = [typeof initial === 'function' ? initial() : initial, () => {}]
    return hookStore[i]
  },
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}
const resetHooks = () => {
  hookIndex = 0
  hookStore.length = 0
}

// ── browser globals ────────────────────────────────────────────────────────
let registered = null
const warnings = []
const errors = []
const timers = []
global.window = {
  __ModuleLoader__: {
    load: (registration) => {
      registered = registration
    },
  },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
  confirm: () => true,
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) }),
  setTimeout: (fn, ms) => {
    timers.push({ fn, ms })
    return timers.length
  },
  clearTimeout: (id) => {
    if (timers[id - 1]) timers[id - 1].cleared = true
  },
  setInterval: () => 1,
  clearInterval: () => {},
}
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
const storage = new Map()
const localStorageStub = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
}
global.localStorage = localStorageStub
// the bundle reads window.localStorage (the browser shape), so the stub is
// reachable through the window object as well
global.window.localStorage = localStorageStub
const tabStorage = new Map()
const sessionStorageStub = {
  getItem: (k) => (tabStorage.has(k) ? tabStorage.get(k) : null),
  setItem: (k, v) => tabStorage.set(k, String(v)),
  removeItem: (k) => tabStorage.delete(k),
}
global.sessionStorage = sessionStorageStub
// the bundle reads window.sessionStorage (the browser shape), so the stub is
// reachable through the window object as well
global.window.sessionStorage = sessionStorageStub
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) })
global.document = {
  head: { appendChild: () => {} },
  documentElement: { dataset: {} },
  createElement: () => ({ setAttribute: () => {}, textContent: '', parentNode: null }),
}
global.console = {
  ...console,
  warn: (...args) => warnings.push(args.join(' ')),
  error: (...args) => errors.push(args.join(' ')),
}

// ── native service doubles ─────────────────────────────────────────────────
const calls = { tabs: [], panes: [], titles: [], previews: [], overlays: [], settings: [] }
/** Run every pending timer in order, skipping the ones that were cleared. */
const flushTimers = () => {
  const pending = timers.splice(0, timers.length)
  for (const t of pending) {
    if (!t.cleared) t.fn()
  }
}
const makeCtx = (overrides = {}) => ({
  effect: (fn) => fn(),
  slots: {
    inject: (slot, factory) => factory(),
    register: (options, component) => {
      const bucket =
        options.name === 'sidebar.right.pane.tab'
          ? calls.panes
          : options.name === 'sidebar.right.pane.tab.title'
            ? calls.titles
            : options.name === 'shell.overlay'
              ? calls.overlays
              : options.name === 'settings.plugins.tab'
                ? calls.settings
                : null
      assert.ok(bucket, 'unexpected slot: ' + options.name)
      bucket.push({ options, component })
      return () => {}
    },
  },
  sidebarRightTabs: {
    register: (definition) => {
      calls.tabs.push(definition)
      return () => {}
    },
  },
  documentPreviews: {
    register: (definition) => {
      calls.previews.push(definition)
      return () => {}
    },
  },
  sidebarRight: {
    openTab: (kind) => {
      calls.openTab = calls.openTab || []
      calls.openTab.push(kind)
    },
    openResource: () => {},
    isExpanded: () => true,
    active: () => undefined,
  },
  ...overrides,
})

// ── load the built bundle ──────────────────────────────────────────────────
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbedReact
  throw new Error('unexpected require: ' + spec)
})

// 1. native services only
assert.deepEqual(
  exportsObj.inject,
  ['slots', 'sidebarRightTabs', 'documentPreviews', 'sidebarRight'],
  'client injects the native sidebar services',
)
assert.equal(typeof exportsObj.apply, 'function')

// 2. five native registrations happen in one apply()
const ctx = makeCtx()
exportsObj.apply(ctx)
assert.equal(calls.tabs.length, 1, 'one tab type registered')
const tab = calls.tabs[0]
assert.equal(tab.id, 'dsh-file-activity')
assert.equal(tab.kind, 'file-activity')
assert.equal(typeof tab.title, 'function', 'chip title thunk present')
assert.equal(tab.title('sidebar://file-activity'), '文件活动')
assert.equal(tab.patterns, undefined, 'page type: no address patterns')
assert.equal(calls.panes.length, 1, 'body seat registered')
assert.equal(calls.panes[0].options.key, 'dsh-file-activity', 'body seat keyed by the definition id')
assert.equal(calls.titles.length, 1, 'chip title seat registered')
assert.equal(calls.titles[0].options.key, 'dsh-file-activity')
assert.equal(calls.overlays.length, 1, 'floating preview registered into shell.overlay')
assert.equal(calls.overlays[0].options.name, 'shell.overlay')
assert.equal(calls.overlays[0].options.id, 'dsh-file-activity-preview')
assert.equal(calls.settings.length, 1, 'settings tab registered')
assert.equal(calls.settings[0].options.name, 'settings.plugins.tab')

// 3. preview metadata only — the document owner reads the bytes natively
assert.equal(calls.previews.length, 1, 'one document preview registered')
const preview = calls.previews[0]
assert.equal(preview.id, 'dsh-file-activity')
assert.ok(Array.isArray(preview.extensions) && preview.extensions.length > 0)
assert.equal(preview.priority, 'extension')
assert.equal(preview.loading, 'text-pages')
assert.equal(typeof preview.title, 'function')
assert.equal(typeof preview.fetchStrategy, 'undefined', 'no byte-fetching strategy on the native side')

// 4. the overlay renders the floating window only while a preview is open
const overlay = calls.overlays[0].component({})
assert.equal(overlay, null, 'overlay renders nothing without a preview')
const tabBody = calls.panes[0].component({ sessionId: 'sess-1', tabId: 'tab-1', visible: true })
const dataStore = tabBody.props.dataStore
assert.ok(dataStore, 'tab body component receives the shared store')
resetHooks()
dataStore.set({ preview: { abs: '/work/a.md', name: 'a.md', sessionId: 'sess-1' } })
const opened = calls.overlays[0].component({})
assert.ok(opened, 'overlay renders the floating window while a preview is open')
assert.equal(opened.props.className, 'dfa-fp-overlay')

// 5. degradation is observable: a rejected registration must not be silent
flushTimers()
errors.length = 0
const brokenCtx = makeCtx({
  sidebarRightTabs: {
    register: () => {
      throw new Error('duplicate id')
    },
  },
})
exportsObj.apply(brokenCtx)
assert.equal(global.document.documentElement.dataset.dfaDegraded, 'tab')
assert.ok(
  errors.some((line) => line.includes('dsh-file-activity') && line.includes('duplicate id')),
  'the failure is logged with its cause, got: ' + JSON.stringify(errors),
)

// 6. auto-open retries until a session surface is mounted, then marks the session
resetHooks()
flushTimers()
timers.length = 0
storage.clear()
tabStorage.clear()
calls.openTab = []
let attempts = 0
const retryCtx = makeCtx({
  sidebarRight: {
    openTab: (kind) => {
      attempts += 1
      calls.openTab.push(kind)
      if (attempts < 3) throw new Error('sidebarRight: no session surface is mounted')
    },
    openResource: () => {},
    isExpanded: () => true,
    active: () => undefined,
  },
})
exportsObj.apply(retryCtx)
assert.equal(attempts, 1, 'first attempt is synchronous')
flushTimers()
assert.equal(attempts, 2, 'a refused open schedules a retry')
flushTimers()
assert.equal(attempts, 3, 'auto-open retries until the session surface is mounted')
assert.equal(calls.openTab[2], 'file-activity')
assert.equal(tabStorage.get('dsh-file-activity:auto-opened:loaded'), '1', 'the page records its attempt')
// a second activation in the same browser tab does not open again
exportsObj.apply(retryCtx)
flushTimers()
assert.equal(attempts, 3, 'one attempt per browser tab')

// auto-open off means no attempt at all
resetHooks()
flushTimers()
timers.length = 0
storage.clear()
tabStorage.clear()
storage.set('dsh-file-activity:autoOpen', '0')
calls.openTab = []
exportsObj.apply(makeCtx())
flushTimers()
assert.equal(calls.openTab.length, 0, 'auto-open disabled writes nothing')
storage.clear()

console.log('client-native contract: OK')

test('script-style suite (assertions ran at module load)', () => {})
