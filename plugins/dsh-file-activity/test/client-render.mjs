import { test } from 'vitest'
/**
 * Client render-path test: loads the client bundle with a stubbed react
 * (real createElement; hooks stubbed to no-ops), registers the tab through the
 * HOST's native extension points (issue #187 batch 2 — slots / sidebarRightTabs
 * / documentPreviews / sidebarRight), then invokes the view component directly
 * to verify the element tree builds without errors and the folder flattening /
 * dotted-label / recent-list logic produces the expected structure.
 *
 * Clicking a file row publishes a preview TARGET into the shared store; the
 * floating window itself renders in the root-scoped 'shell.overlay' seat, so
 * the preview assertions below mount THAT seat's component.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── stubbed react ─────────────────────────────────────────────────────────
// 渲染路径测试只需要元素树结构（type/props/children），不依赖真实 react：
// 自写最小 createElement（children 语义与 React 一致：单 child 直接赋值、
// 多 child 组装数组、数组 child 原样保留）。CI（ubuntu runner 无 node_modules）
// 与本机均可运行——此前 require 本机绝对路径的 react，导致远程 CI 必然失败。
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

// Hook slots are per RENDER SCOPE (the tab body is one component, the overlay
// seat another): sharing one store between them would let the overlay's first
// useState read the view's slot — the same class of bug React's rules exist to
// prevent. The suite is single-threaded, so a module-level cursor suffices.
const hookStores = new Map()
let hookScope = 'body'
const hookStore = []
const resetHooks = () => {
  hookScope = 'body'
  hookStore.length = 0
  hookStores.set('body', { index: 0, slots: [] })
}
// React's own rule: hooks are read in call order, and the N-th useState call of
// a component always lands on the same slot.
const scopeOf = (name) => {
  let scope = hookStores.get(name)
  if (!scope) {
    scope = { index: 0, slots: [] }
    hookStores.set(name, scope)
  }
  return scope
}
const useScope = (name) => {
  const scope = scopeOf(name)
  scope.index = 0
  hookStore.length = 0
  hookStore.push(...scope.slots)
}
const stubbed = {
  createElement,
  // Slots are keyed by call order and keep their first value, so a second
  // render of the same component reads the same slots (the overlay seat is
  // rendered twice below).
  useState: (initial) => {
    const scope = scopeOf(hookScope)
    const i = scope.index++
    if (!scope.slots[i]) scope.slots[i] = [typeof initial === 'function' ? initial() : initial, () => {}]
    return scope.slots[i]
  },
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

// ── browser globals ────────────────────────────────────────────────────────
let registered = null
const storage = new Map()
const localStorageStub = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
}
const tabStorage = new Map()
const sessionStorageStub = {
  getItem: (k) => (tabStorage.has(k) ? tabStorage.get(k) : null),
  setItem: (k, v) => tabStorage.set(k, String(v)),
  removeItem: (k) => tabStorage.delete(k),
}
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
  setInterval: () => 1,
  clearInterval: () => {},
  // the bundle reads the browser-global storages, not the node globals
  localStorage: localStorageStub,
  sessionStorage: sessionStorageStub,
}
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
global.localStorage = localStorageStub
global.sessionStorage = sessionStorageStub
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) })
global.document = {
  head: { appendChild: () => {} },
  documentElement: { dataset: {} },
  createElement: () => ({ setAttribute: () => {}, textContent: '', parentNode: null }),
}

// ── load bundle ────────────────────────────────────────────────────────────
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  // the official atoms come from the host's staticModules; this suite only
  // needs the module to resolve, not to render anything real
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return {}
  throw new Error('unexpected require: ' + spec)
})
assert.deepEqual(exportsObj.inject, ['slots', 'sidebarRightTabs', 'documentPreviews', 'sidebarRight'])
assert.equal(typeof exportsObj.apply, 'function')

// ── native service doubles + context ──────────────────────────────────────
let capturedTab = null
let capturedTabBody = null
let capturedOverlay = null
const registeredPreviews = []
const registeredSettings = []
const openedTabs = []
const ctx = {
  effect: (fn) => fn(),
  slots: {
    inject: (_slot, factory) => factory(),
    register: (options, component) => {
      if (options.name === 'sidebar.right.pane.tab') capturedTabBody = component
      else if (options.name === 'shell.overlay') capturedOverlay = component
      else if (options.name === 'settings.plugins.tab') registeredSettings.push({ options, component })
      return () => {}
    },
  },
  sidebarRightTabs: {
    register: (definition) => {
      capturedTab = definition
      return () => {}
    },
    entries: () => [],
  },
  documentPreviews: {
    register: (definition) => {
      registeredPreviews.push(definition)
      return () => {}
    },
    candidates: () => [],
  },
  sidebarRight: {
    openTab: (kind) => openedTabs.push(kind),
    openResource: () => {},
    isExpanded: () => true,
    active: () => undefined,
  },
}
exportsObj.apply(ctx)
assert.ok(capturedTab, 'tab type registered')
assert.equal(capturedTab.id, 'dsh-file-activity')
assert.equal(capturedTab.kind, 'file-activity')
assert.equal(capturedTab.title('sidebar://file-activity'), '文件活动')
assert.ok(capturedTabBody, 'tab body seat registered')
assert.ok(capturedOverlay, 'floating preview overlay seat registered')
assert.equal(registeredPreviews.length, 1, 'native document preview registered')
assert.equal(registeredSettings.length, 1, 'settings tab registered')

// ── build the view element with data ───────────────────────────────────────
const seatElement = capturedTabBody({ sessionId: 'sess-test', visible: true })
assert.equal(seatElement.type.name, 'FileActivityView', 'component wired')
// the seat injects this activation's shared store into the view
const element = { type: seatElement.type, props: seatElement.props }

// Seed the store with realistic data (multi-level folders like a.b.c.d + e),
// bucketed per session: the view reads only its own sessionId's bucket.
const dataStore = element.props.dataStore
dataStore.set({
  bySession: {
    'sess-test': {
      recent: [
        { path: '/work/a/b/c/d/e.txt', op: 'create', time: Date.now() },
        { path: '/work/a/b/c/d/e.txt', op: 'read', time: Date.now() },
        { path: '/work/src/components/ui/Button.tsx', op: 'modify', time: Date.now() },
        { path: '/work/README.md', op: 'read', time: Date.now() },
        { path: '/work/legacy/old.txt', op: 'delete', time: Date.now() },
      ],
      counts: {
        '/work/a/b/c/d/e.txt': { read: 1, create: 2, modify: 0 },
        '/work/src/components/ui/Button.tsx': { read: 3, create: 0, modify: 5 },
        '/work/README.md': { read: 1, create: 1, modify: 0 },
        '/work/src/index.ts': { read: 2, create: 0, modify: 1 },
      },
    },
  },
})
resetHooks()
useScope('body')
const tree = element.type(element.props)
assert.ok(tree, 'view tree built')

// Traverse the tree and collect text + clickable rows + labeled icon buttons.
const texts = []
const rows = []
const ariaLabels = []
function walk(node, depth) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    texts.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, depth)
    return
  }
  const props = node.props ?? {}
  if (typeof props.onClick === 'function') {
    rows.push({ title: props.title, depth, onClick: props.onClick })
  }
  if (typeof props['aria-label'] === 'string') ariaLabels.push(props['aria-label'])
  walk(props.children, depth + 1)
}
walk(tree, 0)

// ── assertions ─────────────────────────────────────────────────────────────
const joined = texts.join('|')
// No in-content "文件活动" heading: the tab strip already names the page, so
// the view starts flush with content (refreshed/compact, "immersive").
// NOTE: the empty-state copy legitimately contains the substring 文件活动
// ("暂无文件活动记录"), so the assertion is on an exact text node.
assert.ok(!texts.includes('文件活动'), 'no redundant in-content tab title')
assert.ok(joined.includes('最近访问'), 'recent section')
assert.ok(joined.includes('文件统计'), 'stats section')
// Header action buttons are icon-only but must be reachable & labelled.
assert.ok(ariaLabels.includes('刷新'), 'refresh icon button labelled')
assert.ok(ariaLabels.includes('清空'), 'clear icon button labelled')

// Directory tree with chain compression: single-child directory chains
// collapse into one dotted label (a/b/c/d → a.b.c.d); a directory with
// siblings or files keeps its own level (src/), and no loose labels remain
assert.ok(texts.includes('a.b.c.d'), 'chain dirs compressed to a.b.c.d')
assert.ok(!texts.includes('a/'), 'no loose dir a/ after compression')
assert.ok(!texts.includes('b/'), 'no loose dir b/ after compression')
assert.ok(!texts.includes('c/'), 'no loose dir c/ after compression')
assert.ok(!texts.includes('d/'), 'no loose dir d/ after compression')
assert.ok(texts.includes('src/'), 'dir src/ present (has siblings, not compressed)')
assert.ok(texts.includes('components.ui'), 'chain dirs compressed to components.ui')
assert.ok(!texts.includes('components/'), 'no loose dir components/ after compression')
assert.ok(!texts.includes('ui/'), 'no loose dir ui/ after compression')
assert.ok(!texts.includes('src.components.ui'), 'no flat chain crossing a non-chain dir')
assert.ok(!joined.includes('根目录'), 'no root group label (root files shown flat)')

// File rows carry the absolute path as title (native preview targets);
// directory rows end with '/' and toggle collapse instead:
// 4 stats rows + 5 recent rows = 9 file rows. (Icon-only header actions carry
// a chinese tooltip title, so identify real rows by the leading '/' path.)
const fileRows = rows.filter((r) => typeof r.title === 'string' && r.title.startsWith('/') && !r.title.endsWith('/'))
assert.equal(fileRows.length, 9, `expected 9 file rows, got ${fileRows.length}`)
const titles = fileRows.map((r) => r.title)
assert.ok(titles.includes('/work/a/b/c/d/e.txt'), 'nested file row present')
assert.ok(titles.includes('/work/README.md'), 'root file row present')

// Directory rows are clickable collapse toggles carrying their folder path.
const dirRows = rows.filter((r) => typeof r.title === 'string' && r.title.endsWith('/'))
assert.equal(dirRows.length, 4, `expected 4 directory rows, got ${dirRows.length}`)
assert.ok(
  dirRows.every((r) => typeof r.onClick === 'function'),
  'directory rows toggle collapse on click',
)

// recent entries are also clickable (4 recent rows with path titles)
const recentRows = rows.filter(
  (r) =>
    r.title === '/work/a/b/c/d/e.txt' ||
    r.title === '/work/README.md' ||
    r.title === '/work/src/components/ui/Button.tsx',
)
assert.ok(recentRows.length >= 4, 'recent entries clickable')

// ── per-type file icons (issue #24) ────────────────────────────────────────
// Stats rows render a brand-colored badge for known extensions (markdown /
// tsx / ts …) and keep the neutral stroke file icon for unknown ones (txt).
// Walk the tree collecting each row's icon svg keyed by its file name.
const iconByFile = new Map()
function collectFileIcons(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') return
  if (Array.isArray(node)) {
    for (const c of node) collectFileIcons(c)
    return
  }
  const props = node.props ?? {}
  if (props.className === 'dfa-row') {
    const children = Array.isArray(props.children) ? props.children : [props.children]
    const iconSpan = children.find(
      (c) => c && typeof c === 'object' && String(c.props?.className ?? '').startsWith('dfa-row-icon'),
    )
    const nameSpan = children.find(
      (c) => c && typeof c === 'object' && String(c.props?.className ?? '').startsWith('dfa-row-name'),
    )
    if (iconSpan && nameSpan) iconByFile.set(textOf(nameSpan), iconSpan.props.children)
  }
  collectFileIcons(props.children)
}
function textOf(node) {
  if (node === null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node?.props?.children)
}
function badgeFillOf(svg) {
  const children = Array.isArray(svg.props.children) ? svg.props.children : [svg.props.children]
  const rect = children.find((c) => c && c.type === 'rect')
  return rect ? rect.props.fill : null
}
function badgeMarkOf(svg) {
  const children = Array.isArray(svg.props.children) ? svg.props.children : [svg.props.children]
  const text = children.find((c) => c && c.type === 'text')
  return text ? text.props.children : null
}
collectFileIcons(tree)
assert.equal(iconByFile.size, 4, `4 stats rows each carry an icon, got ${iconByFile.size}`)
assert.equal(badgeFillOf(iconByFile.get('README.md')), '#42A5F5', 'markdown row renders the markdown badge')
assert.equal(badgeMarkOf(iconByFile.get('README.md')), 'M↓', 'markdown badge carries the M↓ mark')
assert.equal(badgeFillOf(iconByFile.get('Button.tsx')), '#3178C6', 'tsx row renders the TypeScript-blue badge')
assert.equal(badgeFillOf(iconByFile.get('index.ts')), '#3178C6', 'ts row renders the TypeScript-blue badge')
assert.equal(badgeFillOf(iconByFile.get('e.txt')), '#90A4AE', 'txt row renders the text badge')
assert.equal(badgeMarkOf(iconByFile.get('e.txt')), 'TXT', 'txt badge carries the TXT mark')

// Directory rows keep the plain folder icon (no file badge) — issue #24
// must not change the folder-vs-file visual separation.
let dirIconSvg = null
function collectDirIcon(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') return
  if (Array.isArray(node)) {
    for (const c of node) collectDirIcon(c)
    return
  }
  const props = node.props ?? {}
  if (props.className === 'dfa-row-icon dfa-icon-folder') dirIconSvg = props.children
  collectDirIcon(props.children)
}
collectDirIcon(tree)
assert.ok(dirIconSvg && dirIconSvg.type === 'svg', 'directory rows keep the folder icon')
assert.equal(badgeFillOf(dirIconSvg), null, 'folder icon is not a file badge')
assert.equal(badgeMarkOf(dirIconSvg), null, 'folder icon carries no badge mark')

// the nested-tree example: a/b/c/d/e.txt renders as dirs a/ b/ c/ d/ with e.txt
assert.ok(texts.includes('e.txt'), 'nested file name present')

// ── zero-count pills are NOT rendered (issue #18) ─────────────────────────
// 0 值动作不渲染对应徽标；从未触碰的动作（读 0 / 增 0 / 改 0）不出现在树中。
for (const zero of ['读 0', '增 0', '改 0', 'R 0', 'C 0', 'M 0']) {
  assert.ok(!texts.includes(zero), `zero pill "${zero}" must not be rendered`)
}
// 有值的动作仍正常显示（e.txt: read1/create2/modify0 → 只显示 读 1 / 增 2）
assert.ok(texts.includes('读 1'), 'read pill rendered for counted read')
assert.ok(texts.includes('增 2'), 'create pill rendered for counted create')
assert.ok(texts.includes('改 5'), 'modify pill rendered for counted modify')
// 目录行同理：只渲染有值的汇总徽标（src/ 子树 read 5 + modify 6，无 create）
assert.ok(texts.includes('读 5'), 'dir subtree read pill rendered')
assert.ok(texts.includes('改 6'), 'dir subtree modify pill rendered')

// ── delete op badge (issue #19): recent delete entries render a 删除 badge ─
assert.ok(texts.includes('删除'), 'delete badge rendered for recent delete entry')
assert.ok(texts.includes('old.txt'), 'deleted file name still visible in recent')

// ── click behavior: every clickable file row opens the FLOATING preview ──
// (which reuses the sidebar's native viewer), NOT the sidebar editor tab.
const clickableRows = rows.filter(
  (r) =>
    typeof r.onClick === 'function' && typeof r.title === 'string' && r.title.startsWith('/') && !r.title.endsWith('/'),
)
const tabOpensBeforeClick = openedTabs.length
for (const row of clickableRows) row.onClick()
assert.equal(openedTabs.length, tabOpensBeforeClick, 'clicking a row does not open any sidebar tab')
const preview = dataStore.getSnapshot().preview
assert.ok(preview !== null && typeof preview === 'object', 'click opens the floating preview')
assert.equal(preview.abs, clickableRows[clickableRows.length - 1].title, 'floating preview targets the clicked file')
assert.equal(preview.sessionId, 'sess-test', 'the preview carries the owning session for the plugin routes')

// ── floating preview: click-outside (scrim overlay) & the close button ────
// both dismiss it; large files scroll inside the window body. The window now
// renders in the ROOT-scoped 'shell.overlay' seat, so that seat's component is
// what gets mounted here.
useScope('overlay')
const fpTree = { type: capturedOverlay, props: {} }
let overlay = null
let closeBtn = null
const fpTexts = []
const walkFp = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    fpTexts.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const c of node) walkFp(c)
    return
  }
  if (typeof node.type === 'function') {
    walkFp(node.type(node.props))
    return
  }
  const props = node.props ?? {}
  if (props.className === 'dfa-fp-overlay') overlay = props
  if (props['aria-label'] === '关闭预览') closeBtn = props
  walkFp(props.children)
}
walkFp(fpTree)
assert.ok(
  fpTexts.includes('加载中…') || fpTexts.includes('Loading…'),
  'floating preview shows its loading state (viewer mounts in a real browser)',
)
assert.ok(overlay && typeof overlay.onClick === 'function', 'scrim overlay present (click-outside dismisses)')
// Clicking OUTSIDE the window dismisses it.
overlay.onClick()
assert.equal(dataStore.getSnapshot().preview, null, 'clicking outside the window closes the floating preview')
// Re-open, then dismiss via the close button.
dataStore.set({ preview: { abs: '/work/README.md', name: 'README.md' } })
assert.ok(closeBtn && typeof closeBtn.onClick === 'function', 'floating preview has a close button')
closeBtn.onClick()
assert.equal(dataStore.getSnapshot().preview, null, 'close button dismisses the floating preview')

// ── floating preview content loading (issue #68) ──────────────────────────
// The sidebar fs.read refuses recorded files outside the session workspace;
// the preview must fall back to the plugin's own recorded-path text route,
// and raw system errors (ENOENT / "is outside workspace") must never surface
// verbatim — they translate to friendly, locale-aware messages.
const internals = exportsObj.__test
assert.ok(internals && typeof internals.loadFsReadContent === 'function', 'test internals exported')
const fsReadViewer = { id: 'markdown', fetchStrategy: 'fsRead' }
const outsidePath = '/Users/bsfeng/.dsh/skills/verifying-dsh-plugins/SKILL.md'

async function withFetch(handler, fn) {
  const original = global.fetch
  global.fetch = handler
  try {
    return await fn()
  } finally {
    global.fetch = original
  }
}

// 场景 1: fs.read 拒绝（工作区外）→ 插件文本路由返回内容 → 预览就绪。
const outsideLoad = await withFetch(
  async (url) => {
    if (url.startsWith('/sidebar/api/fs.read')) {
      return {
        json: () => Promise.resolve({ ok: false, error: { message: `path "${outsidePath}" is outside workspace` } }),
      }
    }
    if (url.startsWith('/file-activity/file?') && url.includes('as=text')) {
      return { json: () => Promise.resolve({ ok: true, value: { content: '# outside text' } }) }
    }
    return { json: () => Promise.resolve({ ok: false, error: { message: 'unexpected fetch: ' + url } }) }
  },
  () => internals.loadFsReadContent(fsReadViewer, outsidePath, { sessionId: 'sess-test', cwd: '/work' }, 'sess-test'),
)
assert.equal(outsideLoad.status, 'ready', 'workspace-fenced text falls back to the plugin text route')
assert.equal(outsideLoad.content, '# outside text', 'fallback content served')

// 场景 2: 文件已删除（fs.read 与插件路由均报 ENOENT/not found）→ 友好提示
// 「文件不存在或已被删除」，原始英文系统错误不再上屏。
const missingLoad = await withFetch(
  async (url) => {
    if (url.startsWith('/sidebar/api/fs.read')) {
      return {
        json: () =>
          Promise.resolve({
            ok: false,
            error: { message: 'cannot resolve target "/tmp/issue-body.md": ENOENT: no such file' },
          }),
      }
    }
    if (url.startsWith('/file-activity/file?') && url.includes('as=text')) {
      return { json: () => Promise.resolve({ ok: false, error: { message: 'file not found' } }) }
    }
    return { json: () => Promise.resolve({ ok: false, error: { message: 'unexpected fetch: ' + url } }) }
  },
  () =>
    internals.loadFsReadContent(
      fsReadViewer,
      '/tmp/issue-body.md',
      { sessionId: 'sess-test', cwd: '/work' },
      'sess-test',
    ),
)
assert.equal(missingLoad.status, 'error', 'deleted file resolves to an error state')
assert.equal(missingLoad.message, '文件不存在或已被删除', 'ENOENT translates to a friendly zh message')
assert.ok(!/ENOENT/i.test(missingLoad.message), 'raw ENOENT never surfaces')

// 场景 3: fsReadError 对常见系统错误做中文翻译（防回归断言）。
assert.equal(
  internals.fsReadError({ error: { message: 'path "/x" is outside workspace' } }, fsReadViewer).message,
  '文件位于工作区外，暂无法读取内容',
  'outside-workspace error translates to a friendly zh message',
)
assert.equal(
  internals.fsReadError({ error: { message: 'other raw error' } }, fsReadViewer).message,
  'other raw error',
  'unknown errors keep their message',
)

// ── floating preview auto-dismiss (issue #76) ────────────────────────────
// The preview must never linger: clicking anywhere outside closes it,
// switching tabs closes it, and an error state closes itself (or on any
// click inside the shell). The behaviors are pure functions exercised here;
// the component wires them into DOM listeners in a real browser.
assert.ok(fpTexts.includes('点击外部关闭'), 'floating preview shows the click-outside hint')
assert.equal(internals.AUTO_CLOSE_MS, 2500, 'error-state auto-close delay is 2.5s')
// pointerdown outside the window → dismiss; inside → keep.
assert.equal(internals.isInsideFloating(null), false, 'null target counts as outside')
assert.equal(internals.isInsideFloating({ closest: () => null }), false, 'outside target dismisses')
assert.equal(internals.isInsideFloating({ closest: () => ({}) }), true, 'inside target keeps the window')
// window-surface click: error state closes on ANY click, ready/loading
// states stop propagation so the viewer's own interactions keep working.
assert.equal(internals.previewClickAction({ status: 'error' }, {}), 'close', 'error state closes on any click')
let stopped = false
const fakeEvent = {
  stopPropagation: () => {
    stopped = true
  },
}
assert.equal(internals.previewClickAction({ status: 'ready' }, fakeEvent), 'stop', 'ready state keeps the window')
assert.equal(stopped, true, 'ready state stops propagation')
assert.equal(internals.previewClickAction({ status: 'loading' }, null), 'stop', 'loading state keeps the window')
// error body renders the friendly message + the auto-close hint.
const errBody = internals.renderPreviewBody(
  { status: 'error', viewer: null, message: '文件不存在或已被删除' },
  null,
  null,
  { sessionId: 'sess-test' },
  '/work/missing.txt',
  'missing.txt',
  'sess-test',
)
const errTexts = []
const walkErr = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    errTexts.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const c of node) walkErr(c)
    return
  }
  walkErr(node.props?.children)
}
walkErr(errBody)
assert.ok(errTexts.includes('预览加载失败'), 'error panel shows the failure title')
assert.ok(errTexts.includes('文件不存在或已被删除'), 'error panel shows the friendly message')
assert.ok(errTexts.includes('预览失败，即将自动关闭'), 'error panel announces the auto-close')
// switching tabs (visible=false) closes the preview; staying visible keeps it.
dataStore.set({ preview: { abs: '/work/README.md', name: 'README.md' } })
internals.closePreviewOnHidden(true, dataStore)
assert.ok(dataStore.getSnapshot().preview !== null, 'visible tab keeps the preview open')
internals.closePreviewOnHidden(false, dataStore)
assert.equal(dataStore.getSnapshot().preview, null, 'hidden tab closes the floating preview')

// ── floating preview body fills the window (issue #111) ──────────────────
// The old third-party viewer (html iframe / code / markdown / image) sized
// its root with `flex:1`, which only works when the mounted viewer sits in a
// FLEX parent. .dfa-fp-body must therefore stay a flex column — otherwise the
// HTML iframe, which has a fixed browser-default height, renders as a thin
// top strip with the rest of the window dark. Rebuild client.js regenerates
// STYLES from lib/parts/styles.part.js; this guards the fill container.
const fpBodyRule = (internals.STYLES.match(/\.dfa-fp-body\s*{[^}]*}/) ?? [])[0] ?? ''
assert.ok(fpBodyRule.includes('display:flex'), 'floating preview body is a flex container (issue #111)')
assert.ok(fpBodyRule.includes('flex-direction:column'), 'floating preview body is a column (issue #111)')
assert.ok(fpBodyRule.includes('flex:1'), 'floating preview body keeps its window-fill flex:1')
assert.ok(fpBodyRule.includes('min-height:0'), 'floating preview body allows shrink so viewer content fits')

// ── HTML preview (issue #266 C): a sandboxed iframe, never a code block ───
// The README promised a sandboxed HTML iframe; viewerOf() had no html branch,
// so .html fell through to the text viewer and rendered as .dfa-fp-code.
assert.equal(internals.viewerOf('/work/demo.html'), 'html', '.html routes to the html viewer')
assert.equal(internals.viewerOf('/work/demo.htm'), 'html', '.htm routes to the html viewer')
assert.equal(internals.viewerOf('/work/page.xhtml'), 'html', '.xhtml routes to the html viewer')
assert.equal(internals.viewerOf('/work/notes.md'), 'markdown', 'markdown still routes to markdown')
assert.equal(internals.viewerOf('/work/app.ts'), 'text', 'plain text still routes to text')
const htmlLoad = {
  status: 'ready',
  viewer: { id: 'html' },
  mediaUrl: '/file-activity/file?sessionId=sess-test&path=%2Fwork%2Fdemo.html',
}
const htmlBody = internals.renderPreviewBody(htmlLoad, null, null, null, '/work/demo.html', 'demo.html', 'sess-test')
assert.equal(htmlBody.type, 'div')
assert.equal(htmlBody.props.className, 'dfa-fp-html', 'html body uses the flex-fill container')
const htmlFrame = htmlBody.props.children
assert.equal(htmlFrame.type, 'iframe', 'html renders an iframe, not .dfa-fp-code')
assert.equal(htmlFrame.props.src, htmlLoad.mediaUrl, 'the iframe loads the plugin media route')
assert.equal(htmlFrame.props.className, 'dfa-fp-html-frame')
assert.ok(String(htmlFrame.props.sandbox).includes('allow-scripts'), 'scripts enabled for interactive documents')
assert.ok(
  !String(htmlFrame.props.sandbox).includes('allow-same-origin'),
  'no allow-same-origin: the document gets an opaque origin',
)
assert.ok(internals.STYLES.includes('.dfa-fp-html-frame'), 'html frame style present')
const htmlFrameRule = (internals.STYLES.match(/\.dfa-fp-html-frame\s*{[^}]*}/) ?? [])[0] ?? ''
assert.ok(htmlFrameRule.includes('flex:1'), 'the html frame fills the window body (issue #111 parity)')
assert.ok(htmlFrameRule.includes('min-height:0'), 'the html frame can shrink so it scrolls internally')

console.log('ALL CLIENT RENDER-PATH TESTS PASSED')
console.log('sample output tree (clickable rows):')
for (const row of rows) console.log('  '.repeat(row.depth) + row.title)

test('script-style suite (assertions ran at module load)', () => {})
