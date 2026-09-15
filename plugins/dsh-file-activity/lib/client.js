/**
 * dsh-file-activity — client half (browser).
 *
 * A native right-Sidebar tab ("文件活动 / File Activity") built on the HOST's
 * own extension points (issue #187 batch 2 — no third-party sidebar service):
 *  - the tab type registers into `ctx.sidebarRightTabs` (stage one) and its
 *    body / chip title into the keyed `sidebar.right.pane.tab` and
 *    `sidebar.right.pane.tab.title` seats (stage two);
 *  - clicking a file opens a FLOATING preview implemented by this plugin inside
 *    the `shell.overlay` list seat: recent access history (agent + plugin
 *    routes), per-file create/modify/read counts flattened by folder, and the
 *    preview window itself — clicking outside / Esc / × closes it;
 *  - a document-preview descriptor registers with `ctx.documentPreviews`
 *    (metadata only: the native document owner reads the bytes);
 *  - auto-opens once per session by default, with its toggle in the Web
 *    Settings → Plugins tab (`settings.plugins.tab`).
 *
 * Data source: the plugin host half (fs/observed for agent tools) + this
 * half's fetch interception for the plugin's own file routes, both persisted
 * host-side; the tab polls /file-activity/api/stats.
 *
 * Styling follows the DSH design language: all colors ride the DSH semantic
 * tokens (--dsw-alias-*), typography rides the font roles (--dsw-font-*),
 * motion rides --ds-*. Flat surfaces (no box-shadow), hairline borders, 28px
 * circular icon controls with hover fills, and 8px-radius rows with hover
 * fills. The stylesheet is injected once per activation and torn down with the
 * fiber, so HMR/disable leaves no residue.
 *
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs splices the
 * `lib/parts/*.part.js` pieces into the PART placeholder markers below (each
 * piece is plain function-declaration text sharing this factory scope; the
 * browser ModuleLoader does not support relative-path require) and writes
 * lib/client.js — the file actually served by DSH, which MUST be committed
 * (CI runs node --check + tests against it, not against this template).
 */
window.__ModuleLoader__.load({
  id: 'dsh-file-activity',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useMemo, useState, useSyncExternalStore } = require('react')

    const TAB_ID = 'dsh-file-activity'
    const TAB_KIND = 'file-activity'
    const PREVIEW_ID = 'dsh-file-activity-preview'
    const AUTO_OPEN_KEY = 'dsh-file-activity:auto-opened:'
    const AUTO_OPEN_PREF_KEY = 'dsh-file-activity:autoOpen'
    const POLL_MS = 6000

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
    'use strict'
// ── i18n ──────────────────────────────────────────────────────────────
function isZh() {
  try {
    const lang = (navigator.language || 'en').toLowerCase()
    return lang.startsWith('zh')
  } catch {
    return false
  }
}
const strings = {
  title: () => (isZh() ? '文件活动' : 'File Activity'),
  recent: () => (isZh() ? '最近访问' : 'Recent'),
  stats: () => (isZh() ? '文件统计' : 'File Stats'),
  empty: () => (isZh() ? '暂无文件活动记录' : 'No file activity yet'),
  emptyHint: () =>
    isZh()
      ? '在侧边栏打开文件、编辑保存，或让 agent 读写文件（创建/读取/修改），都会记录在这里。点击任意文件将在侧边栏内用原生预览打开（代码高亮 / Markdown 渲染 / 图片 / PDF…）。'
      : 'Opening files in the sidebar, editing, or agent file operations (create/read/modify) are recorded here. Click any file to open it in the sidebar with native preview (syntax highlighting / Markdown rendering / images / PDF…).',
  refresh: () => (isZh() ? '刷新' : 'Refresh'),
  clear: () => (isZh() ? '清空' : 'Clear'),
  clearConfirm: () => (isZh() ? '确定清空当前会话的全部文件活动记录？' : 'Clear all file activity for this session?'),
  read: () => (isZh() ? '读取' : 'read'),
  create: () => (isZh() ? '新增' : 'create'),
  modify: () => (isZh() ? '修改' : 'modify'),
  delete: () => (isZh() ? '删除' : 'delete'),
  readShort: () => (isZh() ? '读' : 'R'),
  createShort: () => (isZh() ? '增' : 'C'),
  modifyShort: () => (isZh() ? '改' : 'M'),
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  created: () => (isZh() ? '创建' : 'Created'),
  lastSeen: () => (isZh() ? '最近访问' : 'Last seen'),
  justNow: () => (isZh() ? '刚刚' : 'just now'),
  minutesAgo: (m) => (isZh() ? `${m} 分钟前` : `${m}m ago`),
  hoursAgo: (h) => (isZh() ? `${h} 小时前` : `${h}h ago`),
  daysAgo: (d) => (isZh() ? `${d} 天前` : `${d}d ago`),
  closePreview: () => (isZh() ? '关闭预览' : 'Close preview'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  previewUnsupported: () => (isZh() ? '该文件类型暂不支持预览' : 'This file type cannot be previewed yet'),
  previewFailed: () => (isZh() ? '预览加载失败' : 'Preview failed to load'),
  fileMissing: () => (isZh() ? '文件不存在或已被删除' : 'This file no longer exists'),
  fileOutside: () =>
    isZh() ? '文件位于工作区外，暂无法读取内容' : 'The file is outside the workspace and cannot be read',
  downloadToView: () => (isZh() ? '下载查看' : 'download to view'),
  clickOutsideToClose: () => (isZh() ? '点击外部关闭' : 'Click outside to close'),
  guideDescription: () =>
    isZh()
      ? '查看 agent 与侧边栏读写过的文件（最近访问 + 目录统计）'
      : 'Files the agent and the sidebar touched (recent + tree)',
  autoOpenLabel: () => (isZh() ? '会话开始时自动打开' : 'Auto-open on session start'),
  autoOpenHint: () =>
    isZh()
      ? '每个会话首次打开时自动显示本页；关闭后仍可从侧边栏右上角的「新标签页」手动打开。'
      : 'Shows this page once per session. When off, open it from the sidebar new-tab control.',
  tabUnavailable: () => (isZh() ? '侧边栏扩展点不可用' : 'Sidebar extension point unavailable'),
  tabUnavailableHint: () =>
    isZh()
      ? '本插件未能注册页签（宿主原生 API 可能已变更）。原因见浏览器控制台。'
      : 'This plugin could not register its tab (the host native API may have changed). See the browser console.',
  autoCloseHint: () => (isZh() ? '预览失败，即将自动关闭' : 'Preview failed — closing automatically'),
}

    'use strict'
// ── path / time formatting helpers ────────────────────────────────────
function basenameOf(path) {
  const norm = path.split('\\').join('/')
  const idx = norm.lastIndexOf('/')
  return idx === -1 ? norm : norm.slice(idx + 1)
}
/** Compact relative time: 刚刚 / N 分钟前 / N 小时前 / N 天前 / MM/DD. */
function formatRelative(time) {
  if (typeof time !== 'number' || !Number.isFinite(time)) return ''
  const diff = Date.now() - time
  if (diff < 30_000) return strings.justNow()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return strings.minutesAgo(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return strings.hoursAgo(hours)
  const days = Math.floor(hours / 24)
  if (days < 7) return strings.daysAgo(days)
  const date = new Date(time)
  return `${date.getMonth() + 1}/${date.getDate()}`
}
/** Local wall-clock HH:MM:SS (used in tooltips; full precision). */
function formatTime(time) {
  const date = new Date(time)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

    'use strict'
// ── directory tree construction ───────────────────────────────────────
/**
 * Collapse chain directories: a directory whose only child is another
 * directory merges into it (a → a.b → a.b.c …). Deep single-child paths
 * render as one dotted label with the file(s) directly beneath.
 * `root` itself is never collapsed (its name is '' and would drop the
 * top-level directory).
 */
function compressChains(node, isRoot) {
  for (const child of node.children) {
    if (child.type === 'dir') compressChains(child, false)
  }
  if (isRoot) return
  while (node.children.length === 1 && node.children[0].type === 'dir') {
    const only = node.children[0]
    node.name = `${node.name}.${only.name}`
    node.children = only.children
    node.compressed = true
  }
}
/**
 * Sort a directory node: directories first (alphabetically), then files
 * (by total activity, then name); recurse into directories.
 */
function sortNode(node) {
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    if (a.type === 'dir') return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    const ta = a.read + a.create + a.modify
    const tb = b.read + b.create + b.modify
    return tb - ta || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  })
  for (const child of node.children) {
    if (child.type === 'dir') sortNode(child)
  }
}
/**
 * Build a nested directory tree from per-file counts, keyed by the file's
 * absolute path. Every directory node aggregates its subtree counters and
 * sorts directories first (alphabetically), then files (by activity).
 */
function buildTree(counts) {
  const root = { type: 'dir', name: '', path: '', children: [], read: 0, create: 0, modify: 0 }
  for (const [abs, counter] of Object.entries(counts)) {
    const parts = abs.split('/').filter((part) => part !== '')
    if (parts.length === 0) continue
    const name = parts[parts.length - 1]
    let node = root
    for (const dir of parts.slice(0, -1)) {
      let child = node.children.find((c) => c.type === 'dir' && c.name === dir)
      if (child === undefined) {
        child = {
          type: 'dir',
          name: dir,
          path: `${node.path}/${dir}`,
          children: [],
          read: 0,
          create: 0,
          modify: 0,
        }
        node.children.push(child)
      }
      node = child
      node.read += counter.read
      node.create += counter.create
      node.modify += counter.modify
    }
    node.children.push({
      type: 'file',
      name,
      abs,
      read: counter.read,
      create: counter.create,
      modify: counter.modify,
      firstSeen: counter.firstSeen,
      lastSeen: counter.lastSeen,
    })
  }
  sortNode(root)
  compressChains(root, true)
  return root
}

    'use strict'
// ── tiny external store ───────────────────────────────────────────────
function createStore(initial) {
  let state = initial
  const listeners = new Set()
  return {
    getSnapshot: () => state,
    set(patch) {
      state = { ...state, ...patch }
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
// ── shared store slot ─────────────────────────────────────────────────
//
// The tab body renders inside a session-scoped seat while the floating preview
// renders inside the root-scoped 'shell.overlay' seat, so the store the two
// halves share cannot travel as a prop from one to the other. One module-level
// reference is enough: the overlay seat is mounted for the plugin's whole
// lifetime and only ever reads the CURRENT store, and a rebuild replaces the
// reference before the new overlay renders.
/** The store the overlay seat reads; set once per activation. */
let sharedDataStore = null
/** Publish the activation's store for the root-scoped overlay seat. */
function registerSharedStore(store) {
  sharedDataStore = store
}
/** The activation's store, or null before apply() ran. */
function sharedStore() {
  return sharedDataStore
}

    'use strict'
// ── data access (host routes) ─────────────────────────────────────────
async function fetchStats(sessionId) {
  const response = await fetch(`/file-activity/api/stats?sessionId=${encodeURIComponent(sessionId)}`)
  const json = await response.json()
  if (json === null || typeof json !== 'object' || json.ok !== true) return null
  return json.value
}
/** Resolve the session working directory through the sidebar's native API. */
async function fetchSessionCwd(sessionId) {
  try {
    const response = await fetch('/sidebar/api/session.cwd', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    const json = await response.json()
    const cwd = json?.value?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : ''
  } catch {
    return ''
  }
}
function postRecord(sessionId, path, op) {
  if (typeof sessionId !== 'string' || sessionId === '' || typeof path !== 'string' || path === '') return
  void fetch('/file-activity/api/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, path, op }),
  }).catch(() => {})
}
function postClear(sessionId) {
  void fetch('/file-activity/api/clear', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {})
}
/** Plugin media route URL for a recorded path (authorized per session). */
function mediaUrlOf(sessionId, path) {
  return `/file-activity/file?${new URLSearchParams({ sessionId, path })}`
}
/** Plugin text route URL (`as=text`): fs.read-shaped JSON for recorded text. */
function textUrlOf(sessionId, path) {
  return `/file-activity/file?${new URLSearchParams({ sessionId, path, as: 'text' })}`
}

    'use strict'
// ── fetch interception: the plugin's own file routes ───────────────────
//
// Before the native migration this module also watched the THIRD-PARTY
// sidebar's routes (/sidebar/api/fs.read|fs.write, /sidebar/file). Those are
// the host's internal surface now, fed by the host's own file provider and
// document owner — the plugin neither opens nor owns them, so observing them
// would record host traffic that is already recorded through the plugin's
// fs/observed host half. What remains is the plugin's own media/text route,
// whose reads ARE the user's previews.
/** Record requests for the plugin's own file route (media + text previews). */
function recordOwnMediaOpen(url, init) {
  if (url.pathname !== '/file-activity/file') return
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return
  const sessionId = url.searchParams.get('sessionId')
  const path = url.searchParams.get('path')
  if (sessionId !== null && path !== null) postRecord(sessionId, path, 'read')
}
/** Observe a resolved fetch URL and record plugin file operations. */
function observeSidebarFetch(url, init) {
  try {
    recordOwnMediaOpen(url, init)
  } catch {
    // observation must never break the underlying call
  }
}
function installFetchInterceptor() {
  const original = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const result = original(input, init)
    let url
    try {
      if (typeof input === 'string') url = new URL(input, window.location.href)
      else if (input instanceof URL) url = input
      else return result // Request instances: skip observation
    } catch {
      return result
    }
    observeSidebarFetch(url, init)
    return result
  }
  return () => {
    window.fetch = original
  }
}

    'use strict'
// ── auto-open (enabled by default) ────────────────────────────────────
//
// Native flow: the tab is a PAGE type, so opening it means
// `ctx.sidebarRight.openTab(kind)` — there is no layout snapshot to inspect
// and no session id to read from a third-party sidebar service anymore.
//
// Timing is the whole problem. The navigation controller throws
// "sidebarRight: no session surface is mounted" when the right column has not
// mounted its session surface yet — which is exactly the state during the
// first paint of a fresh page. The previous third-party sidebar used to answer with a snapshot
// and the old code simply gave up when it was missing, which is how the tab
// could silently never auto-open. Here the attempt is RETRIED with the timers
// until the surface is up, and a permanent failure is recorded through
// markDegraded() instead of disappearing.
/** Retry cadence while the right column has not mounted its session surface. */
const AUTO_OPEN_RETRY_MS = 1000
/** Give up after this many attempts (~30s) and degrade observably. */
const AUTO_OPEN_MAX_TRIES = 30
/**
 * Pending retry timer id (0 = none).
 *
 * There is deliberately NO "already attempted" flag guarding this module: a
 * rejected registration or an HMR rebuild re-runs apply(), and the second run
 * must still be able to bring the tab back. `openTab` is idempotent — it
 * focuses the existing page instead of duplicating it.
 */
let autoOpenTimer = 0
/**
 * Whether this BROWSER TAB already had its auto-open attempt.
 *
 * The native API exposes no "current session id" to a plugin (`openTab`
 * targets the mounted session, and the layout store is the host's own), so a
 * per-session marker cannot be written from here. The marker is therefore
 * per-browser-tab: one attempt per page load, which is exactly the visible
 * behaviour — the session's tab record itself is persisted host-side, so
 * revisiting a session that already shows the tab merely focuses it.
 */
function isAutoOpenAttempted() {
  const key = AUTO_OPEN_KEY + 'loaded'
  try {
    return window.sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
/** Mark this browser tab as already attempted. */
function markAutoOpenAttempted() {
  try {
    window.sessionStorage.setItem(AUTO_OPEN_KEY + 'loaded', '1')
  } catch {
    // ignore
  }
}
/** The most recent controller refusal, surfaced when retries run out. */
let lastAutoOpenError = null
/** One open attempt: true when the controller accepted it. */
function tryOpenTab(ctx, tries) {
  try {
    ctx.sidebarRight.openTab(TAB_KIND, { revealIfOpened: false })
    return true
  } catch (error) {
    if (tries === 0) lastAutoOpenError = error
    return false
  }
}
/**
 * Open the tab once the session surface exists, then stop. The tab record
 * itself is persisted host-side, so a session that already shows it is not
 * reopened: `openTab` focuses the existing page instead of duplicating it.
 * @param ctx - client context carrying the navigation controller.
 * @returns disposer cancelling a pending retry.
 */
function installAutoOpen(ctx) {
  if (!autoOpenEnabled()) return () => {}
  if (isAutoOpenAttempted()) return () => {}
  let tries = 0
  const attempt = () => {
    tries += 1
    if (tryOpenTab(ctx, tries - 1)) {
      autoOpenTimer = 0
      markAutoOpenAttempted()
      return
    }
    if (tries >= AUTO_OPEN_MAX_TRIES) {
      autoOpenTimer = 0
      markDegraded('auto-open', lastAutoOpenError ?? 'sidebarRight: session surface never mounted')
      return
    }
    autoOpenTimer = window.setTimeout(attempt, AUTO_OPEN_RETRY_MS)
  }
  attempt()
  return () => {
    if (autoOpenTimer !== 0) {
      window.clearTimeout(autoOpenTimer)
      autoOpenTimer = 0
    }
  }
}

    'use strict'
// ── native document previews (metadata + plain-text renderer) ──────────
//
// The HOST owns file content on the native side: a registered preview only
// declares WHICH suffixes this implementation recognizes and HOW the document
// owner should deliver the bytes ('text-pages' = paged text window,
// 'bytes-complete' = whole file). The owner then injects the prepared
// DocumentContent into the 'sidebar.right.tab.document' seat, keyed by this
// implementation's id — so the renderer never fetches anything itself
// (the responsibility split that made 第三方查看器注册表的 matchFileViewer
// obsolete; its fetchStrategy belonged to the third-party viewer).
//
// Scope of the registration: filenames whose suffixes no shipped renderer
// claims. Anything the host already renders (code / markdown / image / pdf /
// html) keeps winning: those implementations outrank this one by longest
// suffix, and a 'fallback' band type (the shipped text preview) still beats
// nothing-else-matches. This descriptor exists so a recorded log/diff/ndjson
// file opens with a real renderer instead of the "nothing can view this"
// notice.
//
// Degradation is explicit and observable (issue #187 batch 2): a rejected
// registration is logged with its cause and marked on <html> so it can never
// fail silently.
/** Suffixes this implementation claims (no leading dot; compound is allowed). */
const PREVIEW_EXTENSIONS = ['log', 'jsonl', 'ndjson', 'diff', 'patch']
/**
 * Record an extension-point failure so it is visible to users, tests and e2e.
 * The <html> markers are `data-dfa-degraded` (which stage failed) plus
 * `data-dfa-degraded-cause` (why), which makes a missing tab diagnosable from
 * the page itself instead of only from the browser console.
 */
function markDegraded(kind, error) {
  const message = error instanceof Error ? error.message : String(error)
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[dsh-file-activity] ' + kind + ' 注册失败: ' + message)
  }
  try {
    const root = typeof document === 'undefined' ? undefined : document.documentElement
    if (root !== undefined && root !== null && root.dataset !== undefined) {
      root.dataset.dfaDegraded = kind
      root.dataset.dfaDegradedCause = message.slice(0, 200)
    }
  } catch {
    // observation only: a missing document must not break activation
  }
}
/** Register the native document-preview descriptor (metadata only). */
function registerDocumentPreviews(ctx) {
  ctx.effect(
    () =>
      ctx.documentPreviews.register({
        id: TAB_ID,
        extensions: PREVIEW_EXTENSIONS,
        // 'extension' lets this implementation win over a shipped one on the
        // same suffix; distinct suffixes keep the shipped renderers in charge.
        priority: 'extension',
        title: () => strings.title(),
        loading: 'text-pages',
      }),
    'dsh-file-activity: document previews',
  )
}

    // ── shared icons (inline, stroke=currentColor, matching better-sidebar) ──
// Single source of truth for the plugin UI icon set (issue #54 阶段 0).
// Extracted from dsh-file-activity's lib/parts/icons.part.js; every plugin's
// scripts/build.mjs splices this file via the `shared: true` piece marker.
// Keep the stroke=currentColor outline style — it inherits the surrounding
// text color and reads on both light and dark themes.
const ICON_STROKE = 1.8
const iconSvg = (children, size) =>
  createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: ICON_STROKE,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    children.map((child, i) =>
      child === null || child === undefined || typeof child === 'boolean'
        ? child
        : createElement(child.type, { key: i, ...child.props }),
    ),
  )

const icon = {
  clock: (size = 16) =>
    iconSvg([createElement('circle', { cx: 12, cy: 12, r: 9 }), createElement('path', { d: 'M12 7v5l3 2' })], size),
  refresh: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
        createElement('polyline', { points: '21 3 21 9 15 9' }),
      ],
      size,
    ),
  trash: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M3 6h18' }),
        createElement('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }),
        createElement('path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }),
      ],
      size,
    ),
  chevronRight: (size = 14) => iconSvg([createElement('polyline', { points: '9 6 15 12 9 18' })], size),
  chevronDown: (size = 14) => iconSvg([createElement('polyline', { points: '6 9 12 15 18 9' })], size),
  file: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
        createElement('path', { d: 'M14 2v6h6' }),
      ],
      size,
    ),
  folder: (size = 16) =>
    iconSvg(
      [
        createElement('path', {
          d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
        }),
      ],
      size,
    ),
  external: (size = 15) =>
    iconSvg(
      [
        createElement('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
        createElement('polyline', { points: '15 3 21 3 21 9' }),
        createElement('line', { x1: 10, y1: 14, x2: 21, y2: 3 }),
      ],
      size,
    ),
  close: (size = 15) =>
    iconSvg(
      [
        createElement('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
        createElement('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
      ],
      size,
    ),
  help: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 12, cy: 12, r: 9 }),
        createElement('path', { d: 'M9.1 9.2a3 3 0 0 1 5.8 1.2c0 1.8-2.7 2.4-2.7 3.6' }),
        createElement('line', { x1: 12, y1: 17.2, x2: 12.01, y2: 17.2 }),
      ],
      size,
    ),
  // ── generic action icons (issue #54 阶段 0) ─────────────────────────────
  // Added for the upcoming plugin UI refresh: save/confirm (check), add/
  // install (plus), market search (search), settings entry (settings).
  check: (size = 16) => iconSvg([createElement('polyline', { points: '20 6 9 17 4 12' })], size),
  plus: (size = 16) =>
    iconSvg(
      [
        createElement('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
        createElement('line', { x1: 5, y1: 12, x2: 19, y2: 12 }),
      ],
      size,
    ),
  pencil: (size = 15) =>
    iconSvg([createElement('path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' })], size),
  search: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 11, cy: 11, r: 8 }),
        createElement('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }),
      ],
      size,
    ),
  settings: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 12, cy: 12, r: 3 }),
        createElement('path', {
          d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
        }),
      ],
      size,
    ),
  // 警告（issue #54 阶段 1 新增）：安全护栏告警类型图标（投毒/提示注入），
  // 三角警示 + 感叹号，stroke=currentColor 风格与其余图标一致。
  alert: (size = 16) =>
    iconSvg(
      [
        createElement('path', {
          d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
        }),
        createElement('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
        createElement('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }),
      ],
      size,
    ),
  // 代码（issue #54 阶段 1 新增）：尖括号 `</>`，预览/代码切换的代码视图
  // 图标（dsh-mermaid-render 卡片），stroke=currentColor 风格与其余图标一致。
  code: (size = 16) =>
    iconSvg(
      [
        createElement('polyline', { points: '16 18 22 12 16 6' }),
        createElement('polyline', { points: '8 6 2 12 8 18' }),
      ],
      size,
    ),
  // 下载（issue #85 新增）：箭头入托盘，图表导出按钮（dsh-mermaid-render
  // 卡片下载 PNG/SVG），stroke=currentColor 风格与其余图标一致。
  download: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
        createElement('polyline', { points: '7 10 12 15 17 10' }),
        createElement('line', { x1: 12, y1: 15, x2: 12, y2: 3 }),
      ],
      size,
    ),
  // 复制（issue #85 新增）：双层矩形，复制源码按钮（dsh-mermaid-render
  // 卡片复制代码），stroke=currentColor 风格与其余图标一致。
  copy: (size = 16) =>
    iconSvg(
      [
        createElement('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
        createElement('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
      ],
      size,
    ),
  // 箭头向上（更新图标）：向上的箭头，表示更新操作
  arrowUp: (size = 16) =>
    iconSvg(
      [
        createElement('line', { x1: 12, y1: 19, x2: 12, y2: 5 }),
        createElement('polyline', { points: '5 12 12 5 19 12' }),
      ],
      size,
    ),
  // 电源关（禁用图标）：圆形电源按钮，表示禁用操作
  powerOff: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }),
        createElement('line', { x1: 12, y1: 2, x2: 12, y2: 12 }),
      ],
      size,
    ),
  // 电源开（启用图标）：圆形电源按钮，表示启用操作
  powerOn: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }),
        createElement('line', { x1: 12, y1: 2, x2: 12, y2: 12 }),
      ],
      size,
    ),
}

// Common-language / file-type badges (issue #24): brand fill + contrast
// ink, reading on both light and dark themes. Unmapped extensions keep the
// neutral currentColor file icon above. [bg, fg ink, short mark]
const FILE_BADGES = {
  // JavaScript / TypeScript
  js: ['#F7DF1E', '#323330', 'JS'],
  mjs: ['#F7DF1E', '#323330', 'JS'],
  cjs: ['#F7DF1E', '#323330', 'JS'],
  ts: ['#3178C6', '#ffffff', 'TS'],
  mts: ['#3178C6', '#ffffff', 'TS'],
  cts: ['#3178C6', '#ffffff', 'TS'],
  tsx: ['#3178C6', '#ffffff', 'TSX'],
  jsx: ['#3178C6', '#ffffff', 'JSX'],
  // 后端语言
  java: ['#007396', '#ffffff', 'JAVA'],
  c: ['#A8B9CC', '#111111', 'C'],
  cpp: ['#00599C', '#ffffff', 'C++'],
  cxx: ['#00599C', '#ffffff', 'C++'],
  cc: ['#00599C', '#ffffff', 'C++'],
  hpp: ['#00599C', '#ffffff', 'C++'],
  h: ['#A8B9CC', '#111111', 'H'],
  hh: ['#A8B9CC', '#111111', 'H'],
  cs: ['#68217A', '#ffffff', 'C#'],
  csharp: ['#68217A', '#ffffff', 'C#'],
  go: ['#00ADD8', '#ffffff', 'GO'],
  rs: ['#CE422B', '#ffffff', 'RS'],
  rb: ['#B51624', '#ffffff', 'RB'],
  php: ['#777BB4', '#ffffff', 'PHP'],
  py: ['#3776AB', '#ffffff', 'PY'],
  swift: ['#F05138', '#ffffff', 'SWIFT'],
  kt: ['#7F52FF', '#ffffff', 'KT'],
  kotlin: ['#7F52FF', '#ffffff', 'KT'],
  dart: ['#0175C2', '#ffffff', 'DART'],
  scala: ['#DC322F', '#ffffff', 'SCALA'],
  lua: ['#2C2C7C', '#ffffff', 'LUA'],
  pl: ['#0298C3', '#ffffff', 'PERL'],
  r: ['#336DC3', '#ffffff', 'R'],
  m: ['#C1272D', '#ffffff', 'MAT'],
  mm: ['#C1272D', '#ffffff', 'MAT'],
  // Web / 前端
  html: ['#E34F26', '#ffffff', '</>'],
  htm: ['#E34F26', '#ffffff', '</>'],
  css: ['#663399', '#ffffff', 'CSS'],
  scss: ['#CD6799', '#ffffff', 'SCSS'],
  sass: ['#CD6799', '#ffffff', 'SCSS'],
  vue: ['#42B883', '#ffffff', 'VUE'],
  svelte: ['#FF3E00', '#ffffff', 'SVELTE'],
  // 数据 / 结构化
  json: ['#F7DF1E', '#323330', '{}'],
  sql: ['#00758F', '#ffffff', 'SQL'],
  csv: ['#2E7D32', '#ffffff', 'CSV'],
  db: ['#0F62FE', '#ffffff', 'DB'],
  sqlite: ['#0F62FE', '#ffffff', 'DB'],
  sqlite3: ['#0F62FE', '#ffffff', 'DB'],
  xml: ['#FF6F00', '#ffffff', 'XML'],
  svg: ['#FF6F00', '#ffffff', 'SVG'],
  // 文档
  md: ['#42A5F5', '#ffffff', 'M↓'],
  markdown: ['#42A5F5', '#ffffff', 'M↓'],
  txt: ['#90A4AE', '#ffffff', 'TXT'],
  text: ['#90A4AE', '#ffffff', 'TXT'],
  log: ['#90A4AE', '#ffffff', 'TXT'],
  pdf: ['#E5202B', '#ffffff', 'PDF'],
  doc: ['#2B579A', '#ffffff', 'DOC'],
  docx: ['#2B579A', '#ffffff', 'DOC'],
  xls: ['#217346', '#ffffff', 'XLS'],
  xlsx: ['#217346', '#ffffff', 'XLS'],
  ppt: ['#D24726', '#ffffff', 'PPT'],
  pptx: ['#D24726', '#ffffff', 'PPT'],
  // 配置 / 构建
  yml: ['#CB171E', '#ffffff', 'YML'],
  yaml: ['#CB171E', '#ffffff', 'YML'],
  toml: ['#8D6E63', '#ffffff', 'TOML'],
  ini: ['#546E7A', '#ffffff', 'CFG'],
  cfg: ['#546E7A', '#ffffff', 'CFG'],
  config: ['#546E7A', '#ffffff', 'CFG'],
  env: ['#F9A825', '#323330', 'ENV'],
  properties: ['#7B1FA2', '#ffffff', 'PROP'],
  lock: ['#37474F', '#ffffff', 'LOCK'],
  dockerfile: ['#2496ED', '#ffffff', 'DOCK'],
  docker: ['#2496ED', '#ffffff', 'DOCK'],
  makefile: ['#607D8B', '#ffffff', 'MAKE'],
  gradle: ['#02303A', '#ffffff', 'GRADLE'],
  cmake: ['#265774', '#ffffff', 'CMAKE'],
  ipynb: ['#F37726', '#ffffff', 'JNB'],
  // 脚本 / Shell
  sh: ['#89E051', '#111111', '>_'],
  bash: ['#89E051', '#111111', '>_'],
  zsh: ['#89E051', '#111111', '>_'],
  ps1: ['#012456', '#ffffff', 'PS1'],
  bat: ['#546E7A', '#ffffff', 'CMD'],
  cmd: ['#546E7A', '#ffffff', 'CMD'],
  // 打包 / 二进制
  zip: ['#FFA726', '#323330', 'ZIP'],
  tar: ['#FFA726', '#323330', 'ZIP'],
  gz: ['#FFA726', '#323330', 'ZIP'],
  '7z': ['#FFA726', '#323330', 'ZIP'],
  rar: ['#FFA726', '#323330', 'ZIP'],
  exe: ['#0078D4', '#ffffff', 'EXE'],
  msi: ['#0078D4', '#ffffff', 'EXE'],
  wasm: ['#654FF0', '#ffffff', 'WASM'],
  // 图片 / 媒体
  png: ['#8E44AD', '#ffffff', 'IMG'],
  jpg: ['#8E44AD', '#ffffff', 'IMG'],
  jpeg: ['#8E44AD', '#ffffff', 'IMG'],
  gif: ['#8E44AD', '#ffffff', 'IMG'],
  webp: ['#8E44AD', '#ffffff', 'IMG'],
  ico: ['#8E44AD', '#ffffff', 'IMG'],
  bmp: ['#8E44AD', '#ffffff', 'IMG'],
  // 版本控制
  gitignore: ['#F05032', '#ffffff', 'GIT'],
  gitattributes: ['#F05032', '#ffffff', 'GIT'],
}

/** One self-colored badge svg: rounded brand rect + short contrast mark.
 *  Mark font scales by length so 5-6 char marks (JAVA/SCALA/SWIFT) stay
 *  inside the 24×24 viewBox. */
const badgeIcon = ([bg, fg, mark], size) =>
  createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
    },
    createElement('rect', { x: 1, y: 1, width: 22, height: 22, rx: 5, fill: bg }),
    createElement(
      'text',
      {
        x: 12,
        y: 16,
        textAnchor: 'middle',
        fontSize: mark.length <= 2 ? 9 : mark.length <= 4 ? 7 : 5.5,
        fontWeight: 700,
        fill: fg,
      },
      mark,
    ),
  )

/** File-type icon dispatcher: branded badge for known extensions, the
 *  neutral file icon for everything else (case-insensitive, tolerates a
 *  leading dot like ".md"). */
const fileIconByExt = (ext, size = 14) => {
  const spec =
    FILE_BADGES[
      String(ext ?? '')
        .toLowerCase()
        .replace(/^\./, '')
    ]
  return spec === undefined ? icon.file(size) : badgeIcon(spec, size)
}

    'use strict'
// ── themed stylesheet (injected once per activation) ──────────────────
// Mirrors the host explorer surface: tight 2px 6px 8px body,
// 30px rows, box-sizing border-box indentation, folder rows use the
// strong type face to read as directories, files stay regular.
/**
 * Inject this activation's stylesheet into the document head exactly once per
 * fiber. Static CSS only: it must not sit behind any service check, or an HMR
 * rebuild / service reload can leave an already-rendered tab unstyled. The
 * disposer removes only this fiber's own <style> element, so a rebuild always
 * keeps at least one copy.
 */
function injectStyles(ctx) {
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-file-activity', 'styles')
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, 'dsh-file-activity: styles')
}
const STYLES = `
.dfa { display:flex; flex-direction:column; height:100%; overflow-y:auto; overflow-x:hidden;
  padding:2px 6px 8px; gap:2px; font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); }
.dfa-iconbtn { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0;
  border:none; border-radius:50%; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; flex:none;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dfa-iconbtn svg { display:block; }
.dfa-iconbtn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.dfa-iconbtn:disabled { opacity:.4; cursor:default; }
.dfa-iconbtn-danger:hover:not(:disabled) { color:var(--dsw-alias-state-error-primary); }
.dfa-iconbtn-xs { width:20px; height:20px; }
.dfa-section-head-actions { display:flex; align-items:center; gap:2px; flex:none; }
.dfa-section { margin-top:4px; }
.dfa-section-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:2px 6px 2px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary); text-transform:uppercase; letter-spacing:.04em; }
.dfa-section-head-toggle { display:flex; align-items:center; gap:5px; cursor:pointer; color:var(--dsw-alias-label-secondary); border:none; background:transparent; padding:0;
  font:var(--dsw-font-xxxs-strong-11); text-transform:uppercase; letter-spacing:.04em; }
.dfa-section-head-toggle:hover { color:var(--dsw-alias-label-primary); }
.dfa-section-head-toggle svg { display:block; flex:none; }
.dfa-empty { padding:8px 6px; font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); line-height:1.7; }
.dfa-empty-hint { display:block; margin-top:2px; color:var(--dsw-alias-label-dimmed); font:var(--dsw-font-xxxs-11); }
.dfa-list { display:flex; flex-direction:column; gap:0; }
.dfa-row { display:flex; align-items:center; gap:6px; box-sizing:border-box; width:100%; min-height:26px;
  margin:0; padding:0 8px; border:none; background:transparent; border-radius:8px; cursor:pointer; text-align:left;
  animation:dfa-row-in 150ms var(--ds-ease-in-out); font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); }
.dfa-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dfa-row-dir { font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
.dfa-chevron { flex:none; display:flex; align-items:center; color:var(--dsw-alias-label-tertiary); }
.dfa-row-icon { flex:none; display:flex; align-items:center; color:var(--dsw-alias-label-secondary); }
/* Strong folder-vs-file separation: folders get the brand accent ink so the
   directory rows read as the colorful navigation spine; files stay neutral
   and faint, so the eye separates them instantly. */
.dfa-icon-folder { color:var(--dsw-alias-accent); }
.dfa-icon-file { color:var(--dsw-alias-label-tertiary); }
.dfa-row-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dfa-name-file { color:var(--dsw-alias-label-secondary); }
.dfa-time { flex:none; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); white-space:nowrap; }
.dfa-op { flex:none; display:inline-flex; align-items:center; justify-content:center; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); }
.dfa-op-create { color:var(--dsw-alias-state-success-primary); background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); }
.dfa-op-modify { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dfa-op-read { color:var(--dsw-alias-accent); background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent); }
.dfa-op-delete { color:var(--dsw-alias-state-error-primary); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
.dfa-counts { flex:none; display:flex; align-items:center; gap:3px; }
.dfa-count { flex:none; display:inline-flex; align-items:center; justify-content:center; height:15px; padding:0 4px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); }
.dfa-count-create { color:var(--dsw-alias-state-success-primary); background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); }
.dfa-count-modify { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent); }
.dfa-count-read { color:var(--dsw-alias-accent); background:color-mix(in srgb, var(--dsw-alias-accent) 10%, transparent); }
/* ── floating preview window (uses the sidebar's native viewer rendering) ──
   A transparent-ish scrim fills the viewport and closes the window on any
   outside click / Escape; the window itself stops propagation. Its body is a
   scroll container so large files scroll inside. */
.dfa-fp-overlay { position:fixed; inset:0; z-index:1990; background:rgba(0,0,0,0.12); }
.dfa-fp { position:fixed; top:56px; right:340px; width:min(720px, calc(100vw - 376px)); height:76vh; max-height:860px;
  background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l2); border-radius:10px; box-shadow:var(--dsw-shadow-lv2); z-index:2000;
  display:flex; flex-direction:column; overflow:hidden; }
.dfa-fp-head { display:flex; align-items:center; gap:6px; padding:6px 8px; border-bottom:1px solid var(--dsw-alias-border-l1); flex:none; }
.dfa-fp-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
.dfa-fp-hint { flex:none; font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); opacity:0.8; }
.dfa-fp-actions { display:flex; align-items:center; gap:2px; flex:none; }
/* issue #111: the preview body is a FLEX COLUMN so the mounted viewer
   component (the host's TextEditor for html/code/markdown, the image
   wrap, and the pdf frame) actually fills the window. Their roots size via
   flex:1 (html iframe .editorHtml, .editorCm, .editorMd, .editorImageWrap,
   .dfa-pdf), which is IGNORED in a block context — so the HTML iframe, which
   otherwise has a fixed browser-default height, rendered as a thin top strip
   with the rest of the window dark. Making the body a flex column lets every
   viewer's flex:1 child stretch to the full .dfa-fp-body height and scroll
   internally, so content fills the window and follows window resizes. */
.dfa-fp-body { flex:1; display:flex; flex-direction:column; overflow:auto; padding:10px 12px; min-height:0; }
.dfa-fp-note { color:var(--dsw-alias-label-tertiary); font:var(--dsw-font-xxs-12); }
.dfa-fp-err { color:var(--dsw-alias-state-error-primary); font:var(--dsw-font-xxs-12); white-space:pre-wrap; word-break:break-all; }
/* PDF preview: a native browser PDF frame filled from the plugin's own media
   route, with a download fallback in the toolbar. */
.dfa-pdf { display:flex; flex-direction:column; width:100%; height:100%; }
.dfa-pdf-toolbar { flex:none; display:flex; justify-content:flex-end; padding:2px 4px 6px; }
.dfa-pdf-download { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-accent); text-decoration:none; }
.dfa-pdf-download:hover { text-decoration:underline; }
.dfa-pdf-frame { flex:1; min-height:0; width:100%; border:none; border-radius:6px; background:transparent; }
@keyframes dfa-row-in { from { opacity:0; transform:translateY(1px); } to { opacity:1; transform:none; } }
/* issue #60: 移除 #25 的侧边栏页签选中态品牌蓝覆盖（[class*="tab"][class*=
   "tabActive"] 全局子串选择器误伤宿主对话/工作区 tab 选中态，出现用户不
   想要的蓝色高亮）。页签选中态回归宿主原生样式（issue #187 批 2：原生
   dockkit 页签自己负责选中态，本插件不再覆盖）。 */
/* issue #187 批 2：页签 chip 由本插件的 title 席位渲染（原生 chip 无图标
   API），因此标题连同图标一起画在这里。 */
.dfa-chip { display:inline-flex; align-items:center; gap:4px; min-width:0; }
/* 扩展点注册失败的显式提示（绝不静默失效）。 */
.dfa-degraded { margin:6px 2px; padding:6px 8px; border-radius:6px;
  border:1px solid var(--dsw-alias-state-error-primary); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
.dfa-degraded-title { font:var(--dsw-font-xs-13); color:var(--dsw-alias-state-error-primary); }
.dfa-degraded-hint { margin-top:2px; font:var(--dsw-font-xxs-12); opacity:.8; }
/* 设置页（settings.plugins.tab）：开关行。 */
.dfa-set { display:flex; flex-direction:column; gap:10px; padding:10px 2px; }
.dfa-set-title { font:var(--dsw-font-sm-14); }
.dfa-set-row { display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer; }
.dfa-set-text { display:flex; flex-direction:column; gap:2px; min-width:0; }
.dfa-set-label { font:var(--dsw-font-xs-13); }
.dfa-set-hint { font:var(--dsw-font-xxs-12); opacity:.75; }
.dfa-set-switch { flex:none; width:16px; height:16px; accent-color:var(--dsw-alias-accent); cursor:pointer; }
/* 浮窗正文：Markdown / 代码 / 纯文本 / 图片四种渲染体。 */
.dfa-fp-md { height:100%; overflow:auto; padding:2px 4px; }
.dfa-fp-code { height:100%; overflow:auto; }
.dfa-fp-pre { margin:0; padding:8px 10px; overflow:auto; height:100%; font:var(--dsw-font-xxs-12);
  white-space:pre-wrap; word-break:break-word; }
.dfa-fp-img { display:block; margin:auto; max-width:100%; max-height:100%; object-fit:contain; }
/* HTML 预览（issue #266 C）：沙箱 iframe 撑满浮窗主体并内部滚动（与 PDF 一致）。 */
.dfa-fp-html { display:flex; flex-direction:column; width:100%; height:100%; }
.dfa-fp-html-frame { flex:1; min-height:0; width:100%; border:none; border-radius:6px; background:#fff; }
`

    'use strict'
// ── row rendering helpers (recent list & stats tree) ──────────────────
const opClass = (op) =>
  op === 'create'
    ? 'dfa-op-create'
    : op === 'modify'
      ? 'dfa-op-modify'
      : op === 'delete'
        ? 'dfa-op-delete'
        : 'dfa-op-read'
const opLabel = (op) =>
  op === 'create'
    ? strings.create()
    : op === 'modify'
      ? strings.modify()
      : op === 'delete'
        ? strings.delete()
        : strings.read()
/** Tooltip for a stats file row: absolute path + created / last-seen times. */
const fileTitle = (abs, firstSeen, lastSeen) => {
  const times = []
  if (typeof firstSeen === 'number') times.push(`${strings.created()} ${formatTime(firstSeen)}`)
  if (typeof lastSeen === 'number') times.push(`${strings.lastSeen()} ${formatTime(lastSeen)}`)
  return times.length > 0 ? `${abs}\n${times.join(' · ')}` : abs
}
/** Count pills for a file/dir node — only actions that actually happened are
 *  shown (a zero count renders no pill; all-zero nodes render no pill group,
 *  keeping untouched files visually quiet). */
const countPills = (node) => {
  const pills = []
  if (node.read > 0)
    pills.push(createElement('span', { className: 'dfa-count dfa-count-read' }, `${strings.readShort()} ${node.read}`))
  if (node.create > 0)
    pills.push(
      createElement('span', { className: 'dfa-count dfa-count-create' }, `${strings.createShort()} ${node.create}`),
    )
  if (node.modify > 0)
    pills.push(
      createElement('span', { className: 'dfa-count dfa-count-modify' }, `${strings.modifyShort()} ${node.modify}`),
    )
  if (pills.length === 0) return null
  return createElement('span', { className: 'dfa-counts', style: { paddingLeft: '6px' } }, ...pills)
}
/** Extension of a file name (lowercase, no leading dot); '' when none.
 *  Dotfiles map to their whole name ('.gitignore' → 'gitignore') so the
 *  badge table can cover them; 'notes.' still yields ''. */
const extOf = (name) => {
  const dot = name.lastIndexOf('.')
  if (dot > 0) return name.slice(dot + 1).toLowerCase()
  if (dot === 0) return name.slice(1).toLowerCase()
  return ''
}
/** Extension-less but common build files → their badge key. */
const NAME_BADGES = {
  makefile: 'makefile',
  dockerfile: 'dockerfile',
  'cmakelists.txt': 'cmake',
}
/** Badge key for a file name: basename match first, then extension. */
const badgeKeyOf = (name) => {
  const base = name.toLowerCase()
  const named = NAME_BADGES[base]
  if (named !== undefined) return named
  return extOf(name)
}
/** A stats-tree file row: icon + name + count pills + relative time. */
const fileRow = (file, depth, onOpen) =>
  createElement(
    'div',
    {
      key: file.abs,
      className: 'dfa-row',
      onClick: () => onOpen(file.abs),
      style: { paddingLeft: 8 + depth * 20 },
      title: fileTitle(file.abs, file.firstSeen, file.lastSeen),
    },
    createElement('span', { className: 'dfa-row-icon dfa-icon-file' }, fileIconByExt(badgeKeyOf(file.name))),
    createElement('span', { className: 'dfa-row-name dfa-name-file' }, file.name),
    countPills(file),
    file.lastSeen ? createElement('span', { className: 'dfa-time' }, formatRelative(file.lastSeen)) : null,
  )
/** One stats-tree node: file rows render inline, dirs toggle collapse. */
function renderTreeNode(node, depth, collapsedDirs, onToggleDir, onOpen) {
  if (node.type === 'file') return fileRow(node, depth, onOpen)
  const collapsed = collapsedDirs.has(node.path)
  return createElement(
    'div',
    { key: node.path },
    createElement(
      'div',
      {
        className: 'dfa-row dfa-row-dir',
        onClick: () => onToggleDir(node.path),
        style: { paddingLeft: 8 + depth * 20 },
        title: `${node.path}/`,
      },
      createElement('span', { className: 'dfa-chevron' }, collapsed ? icon.chevronRight(13) : icon.chevronDown(13)),
      createElement('span', { className: 'dfa-row-icon dfa-icon-folder' }, icon.folder(14)),
      createElement('span', { className: 'dfa-row-name' }, node.compressed ? node.name : node.name + '/'),
      countPills(node),
    ),
    collapsed
      ? null
      : node.children.map((child) => renderTreeNode(child, depth + 1, collapsedDirs, onToggleDir, onOpen)),
  )
}
/** A recent-list row: op badge + basename + relative time. */
const recentEntry = (entry, onOpen) =>
  createElement(
    'div',
    {
      key: `${entry.path}:${entry.time}:${entry.op}`,
      className: 'dfa-row',
      onClick: () => onOpen(entry.path),
      title: entry.path,
    },
    createElement('span', { className: `dfa-op ${opClass(entry.op)}` }, opLabel(entry.op)),
    createElement('span', { className: 'dfa-row-name' }, basenameOf(entry.path)),
    createElement('span', { className: 'dfa-time' }, formatRelative(entry.time)),
  )
/** Toggle a key in a Set (directory collapse state). */
function toggleInSet(set, key) {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}
/** Clear the current session's records host-side and reset its bucket. */
function clearSessionData(dataStore, sessionId) {
  if (!window.confirm(strings.clearConfirm())) return
  postClear(sessionId)
  const current = dataStore.getSnapshot()
  dataStore.set({
    bySession: {
      ...(current.bySession ?? {}),
      [sessionId]: { recent: [], counts: {}, loading: false },
    },
  })
}
/** Manual refresh: fetch stats + the authoritative cwd for this session. */
function refreshSessionData(dataStore, sessionId, setCwd, setError) {
  if (sessionId === '') return
  void fetchStats(sessionId)
    .then((value) => {
      if (value === null) return
      setCwd((prev) => prev || value.cwd || '')
      const current = dataStore.getSnapshot()
      dataStore.set({
        bySession: {
          ...(current.bySession ?? {}),
          [sessionId]: { recent: value.recent ?? [], counts: value.counts ?? {}, loading: false },
        },
      })
      setError(false)
    })
    .catch(() => setError(true))
  void fetchSessionCwd(sessionId).then((cwd) => {
    if (cwd !== '') setCwd(cwd)
  })
}

    'use strict'
// ── view component ────────────────────────────────────────────────────
/** Shared empty bucket for sessions that have never loaded data (stable ref). */
const EMPTY_SESSION = { recent: [], counts: {}, loading: true }
/** tab.visible out of the host's SidebarRightTabInfo; undefined when the
 *  information (or its shape) is unavailable. */
function readSeatVisible(info) {
  if (info === null || typeof info !== 'object') return undefined
  const tab = info.tab
  if (tab === null || typeof tab !== 'object') return undefined
  const visible = tab.visible
  return typeof visible === 'boolean' ? visible : undefined
}
/**
 * Resolve whether this seat is on screen.
 *
 * The native seat hands the component **no** `visible` prop: the host dispatches
 * it as `renderSlot('sidebar.right.pane.tab', {}, { hookContext })`, so the owner
 * props share is empty and everything live arrives through the injected
 * `useTabInfo()` hook (SidebarRightTabInfo.tab.visible). Reading `props.visible`
 * alone is therefore always `undefined` — the pre-#266 (`if (!visible) return`)
 * guard was constant-true, so an opened panel never loaded and never polled
 * (it only showed data after a manual Refresh).
 *
 * Order: the host hook first, then the legacy prop, then visible by default.
 * Defaulting to visible is the deliberate failure direction (issue #266): if the
 * hook is unavailable or the host shape changes again, the panel must still
 * load — the cost is one polling panel, the alternative is a blank one.
 */
function useSeatVisible(useTabInfo, legacyVisible) {
  const info = typeof useTabInfo === 'function' ? useTabInfo() : undefined
  const seatVisible = readSeatVisible(info)
  if (seatVisible !== undefined) return seatVisible
  return legacyVisible !== false
}
/**
 * Polling loader for one session: fetches stats on mount and on a fixed
 * interval while visible, prefers the sidebar's authoritative session.cwd
 * for relative display, and writes results into the per-session bucket.
 */
function useSessionLoader(visible, sessionId, scope, dataStore, setCwd, setError) {
  useEffect(() => {
    if (!visible || sessionId === '') return
    let cancelled = false
    const load = () => {
      void fetchStats(sessionId)
        .then((value) => {
          if (cancelled || value === null) return
          setCwd((prev) => prev || value.cwd || '')
          const current = dataStore.getSnapshot()
          dataStore.set({
            bySession: {
              ...(current.bySession ?? {}),
              [sessionId]: {
                recent: value.recent ?? [],
                counts: value.counts ?? {},
                loading: false,
              },
            },
          })
          setError(false)
        })
        .catch(() => {
          if (!cancelled) setError(true)
        })
    }
    load()
    void fetchSessionCwd(sessionId).then((cwd) => {
      if (!cancelled && cwd !== '') setCwd(cwd)
    })
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [visible, sessionId, dataStore])
}
/** Error banner element, or null when the last load succeeded. */
function renderError(error) {
  if (!error) return null
  return createElement(
    'div',
    {
      style: {
        color: 'var(--dsw-alias-state-error-primary)',
        padding: '4px 6px',
        font: 'var(--dsw-font-xxs-12)',
      },
    },
    strings.loadError(),
  )
}
/** "最近访问" section: collapsible head with refresh/clear actions. */
function renderRecentSection(recent, recentOpen, onToggle, onRefresh, onClear, onOpen) {
  return createElement(
    'div',
    { className: 'dfa-section' },
    createElement(
      'div',
      { className: 'dfa-section-head' },
      createElement(
        'button',
        { className: 'dfa-section-head-toggle', onClick: onToggle },
        recentOpen ? icon.chevronDown(13) : icon.chevronRight(13),
        strings.recent(),
      ),
      createElement(
        'span',
        { className: 'dfa-section-head-actions' },
        createElement(
          'button',
          {
            className: 'dfa-iconbtn dfa-iconbtn-xs',
            onClick: onRefresh,
            title: strings.refresh(),
            'aria-label': strings.refresh(),
          },
          icon.refresh(14),
        ),
        createElement(
          'button',
          {
            className: 'dfa-iconbtn dfa-iconbtn-xs dfa-iconbtn-danger',
            onClick: onClear,
            title: strings.clear(),
            'aria-label': strings.clear(),
          },
          icon.trash(14),
        ),
      ),
    ),
    !recentOpen
      ? null
      : recent.length === 0
        ? createElement(
            'div',
            { className: 'dfa-empty' },
            strings.empty(),
            createElement('span', { className: 'dfa-empty-hint' }, strings.emptyHint()),
          )
        : createElement(
            'div',
            { className: 'dfa-list' },
            recent.map((entry) => recentEntry(entry, onOpen)),
          ),
  )
}
/** "文件统计" section: the directory tree, or an empty hint. */
function renderStatsSection(tree, collapsedDirs, onToggleDir, onOpen) {
  return createElement(
    'div',
    { className: 'dfa-section' },
    createElement('div', { className: 'dfa-section-head' }, strings.stats()),
    tree.children.length === 0
      ? createElement('div', { className: 'dfa-empty' }, strings.empty())
      : createElement(
          'div',
          { className: 'dfa-list' },
          tree.children.map((child) => renderTreeNode(child, 0, collapsedDirs, onToggleDir, onOpen)),
        ),
  )
}
/**
 * The file-activity tab. Each session renders only its own store bucket:
 * a fresh conversation shows an empty list immediately, with no residue
 * from the previous session. Clicking any file opens a FLOATING preview
 * that reuses the sidebar's NATIVE viewer via matchFileViewer.
 */
function FileActivityView({
  ctx,
  store,
  scope,
  sessionId: seatSessionId,
  visible: legacyVisible,
  useTabInfo,
  dataStore,
}) {
  const data = useSyncExternalStore(dataStore.subscribe, dataStore.getSnapshot)
  const [, setCwd] = useState(scope?.cwd || '')
  const [error, setError] = useState(false)
  const [recentOpen, setRecentOpen] = useState(true)
  const [collapsedDirs, setCollapsedDirs] = useState(() => new Set())
  // Native seats pass sessionId directly; the legacy scope object still works.
  const sessionId = seatSessionId ?? scope?.sessionId ?? ''
  // issue #266 A: the native seat passes NO visible prop — visibility comes
  // from the injected useTabInfo() (see useSeatVisible).
  const visible = useSeatVisible(useTabInfo, legacyVisible)
  const sessionData = (data.bySession ?? {})[sessionId] ?? EMPTY_SESSION
  const tree = useMemo(() => buildTree(sessionData.counts ?? {}), [sessionData.counts])
  useEffect(() => {
    if (scope?.cwd) setCwd(scope.cwd)
  }, [scope?.cwd])
  useSessionLoader(visible, sessionId, scope, dataStore, setCwd, setError)
  // Switching conversations closes any floating preview left open by the
  // previous session (preview is shared UI state; session data never
  // crosses sessions anymore).
  useEffect(() => {
    dataStore.set({ preview: null })
  }, [sessionId, dataStore])
  // Switching tabs hides this view: close any floating preview so it never
  // lingers over the main UI (issue #76).
  useEffect(() => {
    closePreviewOnHidden(visible, dataStore)
  }, [visible, dataStore])
  const toggleDir = (path) => setCollapsedDirs((prev) => toggleInSet(prev, path))
  // The floating preview itself lives in the root-scoped 'shell.overlay' seat
  // (registered by registerPreviewOverlay), so this view only publishes the
  // target — together with the owning session, which authorizes the routes.
  const openPreview = (path) => dataStore.set({ preview: { abs: path, name: basenameOf(path), sessionId } })
  const onClear = () => clearSessionData(dataStore, sessionId)
  const onRefresh = () => refreshSessionData(dataStore, sessionId, setCwd, setError)
  const recent = sessionData.recent ?? []
  return createElement(
    'div',
    { className: 'dfa' },
    renderError(error),
    renderDegraded(),
    renderRecentSection(recent, recentOpen, () => setRecentOpen((v) => !v), onRefresh, onClear, openPreview),
    renderStatsSection(tree, collapsedDirs, toggleDir, openPreview),
  )
}
/**
 * Degradation notice: shown when this activation failed to register one of the
 * host extension points (registerTabType / documentPreviews / auto-open). The
 * panel is also marked with data-dfa-degraded so the e2e suite can assert the
 * failure instead of hunting a missing tab.
 * @returns the notice element, or null when nothing degraded.
 */
function renderDegraded() {
  try {
    const markers = typeof document === 'undefined' ? undefined : document.documentElement?.dataset
    if (markers === undefined || markers === null || markers.dfaDegraded === undefined) return null
  } catch {
    return null
  }
  return createElement(
    'div',
    { className: 'dfa-degraded', 'data-dfa-degraded': '1' },
    createElement('div', { className: 'dfa-degraded-title' }, strings.tabUnavailable()),
    createElement('div', { className: 'dfa-degraded-hint' }, strings.tabUnavailableHint()),
  )
}

    'use strict'
// ── preview data access (routes, viewer choice, loading) ────────────────
//
// The floating window used to mount the third-party sidebar's built-in viewer,
// picked by the third-party sidebar matchFileViewer(path), and fed it the bytes its
// fetchStrategy asked for. That service is gone (issue #187 batch 2), so this
// module does the reading itself through the plugin's own routes:
//
//   /file-activity/file?sessionId&path        → raw bytes (image / pdf)
//   /file-activity/file?sessionId&path&as=text → fs.read-shaped JSON text
//
// The route matters: file activity records files the agent touched ANYWHERE
// (scratch files in /tmp, sibling repos, ~/.dsh), while the host's file
// provider is fenced to the session workspace. The plugin route authorizes
// exactly the paths this session recorded.
/** Image suffixes the browser renders natively. */
const IMAGE_EXT = /^(svg|png|jpe?g|gif|webp|avif|bmp|ico)$/i
/** Suffixes rendered as Markdown. */
const MARKDOWN_EXT = /^(md|markdown|mdx)$/i
/** Suffixes rendered as a sandboxed HTML document (issue #266 C). */
const HTML_EXT = /^(html?|xhtml)$/i
/** Lower-case suffix of a path ('' when it has none). extOf (rows.ts) works on
 *  a file NAME, so the basename is sliced off first. */
function extOfPath(path) {
  return extOf(path.slice(path.lastIndexOf('/') + 1))
}
/** Official UI atoms come from the host's staticModules (zero install). */
function uiAtoms() {
  try {
    return require('@deepseek-ai/dsh-client-ui-primitives')
  } catch {
    return {}
  }
}
/** Resolve a possibly-relative path against the session cwd. */
function resolvePath(path, cwd) {
  if (typeof path !== 'string' || path === '') return path
  if (path.startsWith('/')) return path
  if (typeof cwd === 'string' && cwd !== '') return `${cwd.replace(/\/+$/, '')}/${path}`
  return path
}
/** Whether the fs.read API response carries a text content payload. */
function isFsReadOk(json) {
  return json !== null && typeof json === 'object' && json.ok === true && typeof json.value?.content === 'string'
}
/** Error load state from an fs.read API response (or a generic message).
 *  Raw system errors are translated to friendly, locale-aware messages
 *  (issue #68): deleted files and workspace-fenced paths must never surface
 *  ENOENT / "is outside workspace" verbatim. */
function fsReadError(json, viewer) {
  const raw = json?.error?.message ?? ''
  let message
  if (raw === '') message = strings.previewFailed()
  else if (/ENOENT|no such file|does not exist|cannot resolve/i.test(raw)) message = strings.fileMissing()
  else if (/outside workspace/i.test(raw)) message = strings.fileOutside()
  else message = raw
  return { status: 'error', viewer, message }
}
/** Plugin text route (fs.read-shaped JSON), or null on any failure. */
async function fetchTextContent(sessionId, path) {
  try {
    const response = await fetch(textUrlOf(sessionId, path))
    return await response.json()
  } catch {
    return null
  }
}
/**
 * Load the recorded file's text through the plugin's own route, falling back
 * to the host sidebar route when the plugin refuses the path. Whatever the
 * host viewer used to do with its own fetchStrategy, this window does the
 * reading itself now — the routes are the same ones the previous
 * implementation used for its fsRead strategy.
 */
async function loadFsReadContent(viewer, path, scope, sessionId) {
  const cwd = scope === null || scope === undefined ? '' : scope.cwd
  const target = resolvePath(path, cwd ?? '')
  const own = await fetchTextContent(sessionId, target)
  if (isFsReadOk(own)) return { status: 'ready', viewer, content: own.value.content }
  try {
    const response = await fetch('/sidebar/api/fs.read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, path: target }),
    })
    const json = await response.json()
    if (isFsReadOk(json)) return { status: 'ready', viewer, content: json.value.content }
    return fsReadError(json, viewer)
  } catch {
    return fsReadError(own, viewer)
  }
}
/** Which renderer a recorded path gets. */
function viewerOf(path) {
  const ext = extOfPath(path)
  if (IMAGE_EXT.test(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (HTML_EXT.test(ext)) return 'html'
  if (MARKDOWN_EXT.test(ext)) return 'markdown'
  return 'text'
}
/** Fetch the bytes the chosen renderer needs (media URL, or text content). */
async function fetchPreviewLoad(target) {
  const viewer = { id: viewerOf(target.abs) }
  // image / pdf / html are served as BYTES by the plugin's own media route;
  // html goes through an iframe (see HtmlBody), not through the text path.
  if (viewer.id === 'image' || viewer.id === 'pdf' || viewer.id === 'html') {
    return { status: 'ready', viewer, mediaUrl: mediaUrlOf(target.sessionId, target.abs) }
  }
  return loadFsReadContent(viewer, target.abs, null, target.sessionId)
}

    'use strict'
// ── floating preview window (own renderer, shell.overlay seat) ─────────
//
// History: this window used to mount the third-party sidebar's built-in
// viewer and let it fetch its own bytes. That service is gone (issue #187
// batch 2), so the window renders the recorded file itself:
//
//   image (svg/png/jpeg/gif/webp/avif/bmp/ico) → <img src> on the plugin media route
//   pdf                                        → <iframe src> on the same route
//   markdown                                   → host MarkdownText atom
//   anything else                              → host CodeBlock atom, else <pre>
//
// The overlay lives in the root-scoped 'shell.overlay' list seat (the host's
// own floating layer: above every column, click-through unless the entry opts
// into pointer events) and renders nothing at all while no preview is open.
// Data access (routes, viewer choice, loading) lives in preview-data.ts.
/** Milliseconds after which an error-state preview closes itself (issue #76):
 *  a shell that failed to load any content is useless, so it must not linger
 *  over the main UI until the user finds the × button. */
const AUTO_CLOSE_MS = 2500
/** Whether a pointerdown target lies inside the floating window. The window
 *  surface carries the .dfa-fp class; anything else counts as "outside"
 *  and dismisses the preview (issue #76 — click anywhere outside closes). */
function isInsideFloating(target) {
  if (!target || typeof target.closest !== 'function') return false
  return target.closest('.dfa-fp') !== null
}
/** Click behavior for the window surface: in the error state ANY click
 *  closes the shell (there is no content to interact with), otherwise the
 *  click is swallowed so the viewer's own interactions keep working. */
function previewClickAction(load, event) {
  if (load.status === 'error') return 'close'
  if (event && event.stopPropagation) event.stopPropagation()
  return 'stop'
}
/** Close the floating preview when the tab goes hidden (switching tabs /
 *  operating the main UI), so it never lingers over the interface. */
function closePreviewOnHidden(visible, dataStore) {
  if (!visible) dataStore.set({ preview: null })
}
function usePreviewLoader(target) {
  const [load, setLoad] = useState({ status: 'loading', viewer: null })
  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading', viewer: { id: viewerOf(target.abs) } })
    fetchPreviewLoad(target)
      .then((next) => {
        if (!cancelled) setLoad(next)
      })
      .catch((error) => {
        if (!cancelled)
          setLoad({
            status: 'error',
            viewer: null,
            message: error instanceof Error ? error.message : String(error),
          })
      })
    return () => {
      cancelled = true
    }
  }, [target.abs, target.sessionId])
  return load
}
/** Text body: the host's own Markdown / code atoms, with a plain <pre> fallback. */
function TextBody({ load, path }) {
  const text = load.content ?? ''
  const ui = uiAtoms()
  if (load.viewer?.id === 'markdown' && typeof ui.MarkdownText === 'function') {
    return createElement('div', { className: 'dfa-fp-md' }, createElement(ui.MarkdownText, { text }))
  }
  if (typeof ui.CodeBlock === 'function') {
    return createElement(
      'div',
      { className: 'dfa-fp-code' },
      createElement(ui.CodeBlock, { code: text, language: extOfPath(path) }),
    )
  }
  return createElement('pre', { className: 'dfa-fp-pre' }, text)
}
/** Image body: the plugin's media route renders the recorded bytes. */
function ImageBody({ load, title }) {
  return createElement('img', { className: 'dfa-fp-img', src: load.mediaUrl, alt: title })
}
/**
 * HTML body: a SANDBOXED iframe over the plugin's media route (issue #266 C —
 * the README promised a sandboxed iframe while the code rendered the markup as
 * a code block).
 *
 * Two independent sandbox layers, deliberately without `allow-same-origin`:
 *  - the iframe's `sandbox` attribute gives the document an opaque origin, so
 *    a previewed page cannot read the host's storage, cookies or same-origin
 *    APIs, and cannot reach the parent document;
 *  - the route answers text/html with a response-level
 *    `Content-Security-Policy: sandbox …` header, so the SAME protection holds
 *    when the URL is opened directly instead of inside this iframe.
 * Scripts/forms stay enabled so interactive documents (charts, demos) work;
 * navigation of the top window is not granted.
 */
function HtmlBody({ load, title }) {
  return createElement(
    'div',
    { className: 'dfa-fp-html' },
    createElement('iframe', {
      className: 'dfa-fp-html-frame',
      src: load.mediaUrl,
      sandbox: 'allow-scripts allow-forms',
      title,
    }),
  )
}
/** Preview window body: loading note / error panel / renderer mount. */
function renderPreviewBody(load, ctx, store, scope, path, title, sessionId) {
  if (load.status === 'loading') {
    return createElement('div', { className: 'dfa-fp-note' }, strings.loading())
  }
  if (load.status === 'error') {
    return createElement(
      'div',
      { className: 'dfa-fp-err' },
      strings.previewFailed(),
      load.message
        ? createElement('div', { style: { marginTop: '6px', fontSize: '11px', opacity: 0.85 } }, load.message)
        : null,
      createElement('div', { style: { marginTop: '6px', fontSize: '11px', opacity: 0.7 } }, strings.autoCloseHint()),
    )
  }
  const props = { load, path, title, sessionId }
  if (load.viewer?.id === 'image') return ImageBody(props)
  if (load.viewer?.id === 'html') return HtmlBody(props)
  if (load.viewer?.id === 'pdf') {
    const url = mediaUrlOf(sessionId, path)
    return createElement(PdfPreview, { src: url, download: `${url}&download=1`, title })
  }
  return TextBody(props)
}
/**
 * Dismissal affordances (issue #76 — the preview must never linger):
 * 1. pointerdown anywhere OUTSIDE the window closes it (capture phase, so
 *    it fires even if another element sits above the scrim);
 * 2. the scrim's own onClick (kept as a fallback);
 * 3. Escape;
 * 4. the × button;
 * 5. an error state closes itself after AUTO_CLOSE_MS (no content to show).
 */
function usePreviewDismiss(load, onClose) {
  useEffect(() => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {}
    const handler = (event) => {
      if (!isInsideFloating(event && event.target)) onClose()
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [onClose])
  useEffect(() => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {}
    const handler = (event) => {
      if (event && event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])
  useEffect(() => {
    if (load.status !== 'error') return undefined
    if (typeof window === 'undefined' || typeof window.setTimeout !== 'function') return undefined
    const timer = window.setTimeout(onClose, AUTO_CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [load.status, onClose])
}
/** The floating window element: head (title + hint + close) and body. */
function renderFloatingWindow(load, ctx, store, scope, path, title, sessionId, onClose) {
  return createElement(
    'div',
    { className: 'dfa-fp-overlay', onClick: onClose },
    createElement(
      'div',
      {
        className: 'dfa-fp',
        'data-dfa-preview': '1',
        onClick: (event) => {
          if (previewClickAction(load, event) === 'close') onClose()
        },
      },
      createElement(
        'div',
        { className: 'dfa-fp-head' },
        createElement('span', { className: 'dfa-fp-title' }, title),
        createElement('span', { className: 'dfa-fp-hint' }, strings.clickOutsideToClose()),
        createElement(
          'span',
          { className: 'dfa-fp-actions' },
          createElement(
            'button',
            {
              className: 'dfa-iconbtn',
              title: strings.closePreview(),
              'aria-label': strings.closePreview(),
              onClick: () => onClose(),
            },
            icon.close(15),
          ),
        ),
      ),
      createElement(
        'div',
        { className: 'dfa-fp-body' },
        renderPreviewBody(load, ctx, store, scope, path, title, sessionId),
      ),
    ),
  )
}
/**
 * The floating preview, mounted by the root-scoped 'shell.overlay' list seat
 * (the host's own floating layer: above every column, click-through unless the
 * entry opts into pointer events). It renders nothing at all while no preview
 * is open, so the layer stays invisible.
 */
function FloatingPreviewOverlay() {
  const store = sharedStore()
  const state = useSyncExternalStore(
    store === null ? () => () => {} : store.subscribe,
    store === null ? () => null : store.getSnapshot,
  )
  const preview = state === null || state === undefined ? null : state.preview
  const sessionId = preview === null ? '' : preview.sessionId
  // Hooks must run unconditionally: the loader is fed an empty target while
  // the window is closed (it then never resolves a load, and nothing renders).
  const target = preview ?? { abs: '', name: '', sessionId: '' }
  const load = usePreviewLoader(target)
  const onClose = () => {
    if (store !== null) store.set({ preview: null })
  }
  usePreviewDismiss(load, onClose)
  if (preview === null) return null
  return renderFloatingWindow(load, undefined, null, null, preview.abs, preview.name, sessionId, onClose)
}
/** Register the overlay seat (list slot: additive, never replaces host UI). */
function registerPreviewOverlay(ctx, dataStore) {
  void dataStore
  ctx.effect(
    () =>
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: PREVIEW_ID, order: 100, label: () => strings.title() },
          FloatingPreviewOverlay,
        ),
      ),
    'dsh-file-activity: preview overlay',
  )
}
/**
 * Lightweight PDF preview. The recorded file often lives outside the session
 * workspace, and the host's own PDF route is fenced to it — so the bytes come
 * from the plugin's media route inside a native browser PDF frame, with a
 * download fallback in its toolbar.
 */
function PdfPreview({ src, download, title }) {
  return createElement(
    'div',
    { className: 'dfa-pdf' },
    createElement(
      'div',
      { className: 'dfa-pdf-toolbar' },
      createElement(
        'a',
        {
          className: 'dfa-pdf-download',
          href: download,
          download: true,
          title: strings.downloadToView(),
        },
        strings.downloadToView(),
      ),
    ),
    createElement('iframe', { className: 'dfa-pdf-frame', src, title }),
  )
}

    'use strict'
// ── settings tab (replaces 迁移前的 settings.pluginToggles) ────
//
// The host renders no per-plugin toggle UI for third-party tabs, so this
// plugin contributes its own tab to the Web Settings → Plugins section
// ('settings.plugins.tab': a list seat declared by the settings section). The
// section only exists while it is mounted, so the seat is declared with
// ctx.slots.inject — the declarative form that survives HMR and late mounts
// (a plain register on a not-yet-mounted seat would silently contribute
// nothing).
/** Auto-open preference (plugin-owned; 迁移前的插件偏好已不存在). */
function autoOpenEnabled() {
  try {
    return window.localStorage.getItem(AUTO_OPEN_PREF_KEY) !== '0'
  } catch {
    return true
  }
}
/** Persist the auto-open preference. */
function setAutoOpenEnabled(enabled) {
  try {
    window.localStorage.setItem(AUTO_OPEN_PREF_KEY, enabled ? '1' : '0')
  } catch {
    // storage unavailable (private mode): the in-memory toggle still applies
  }
}
/** One labeled switch row. */
function settingsRow(label, hint, checked, onChange) {
  return createElement(
    'label',
    { className: 'dfa-set-row' },
    createElement(
      'span',
      { className: 'dfa-set-text' },
      createElement('span', { className: 'dfa-set-label' }, label),
      createElement('span', { className: 'dfa-set-hint' }, hint),
    ),
    createElement('input', {
      type: 'checkbox',
      className: 'dfa-set-switch',
      checked,
      onChange: (event) => onChange(event?.target?.checked === true),
    }),
  )
}
/** Settings panel body: the auto-open switch plus its explanatory hint. */
function FileActivitySettings() {
  const [enabled, setEnabled] = useState(autoOpenEnabled)
  return createElement(
    'div',
    { className: 'dfa-set', 'data-dfa-settings': '1' },
    createElement('div', { className: 'dfa-set-title' }, strings.title()),
    settingsRow(strings.autoOpenLabel(), strings.autoOpenHint(), enabled, (next) => {
      setAutoOpenEnabled(next)
      setEnabled(next)
    }),
  )
}
/** Register the settings tab into the settings section's list seat. */
function registerSettingsTab(ctx) {
  ctx.effect(
    () =>
      ctx.slots.inject('settings.plugins.tab', () =>
        ctx.slots.register(
          { name: 'settings.plugins.tab', id: TAB_ID, order: 60, label: () => strings.title() },
          FileActivitySettings,
        ),
      ),
    'dsh-file-activity: settings tab',
  )
}

    'use strict'
// ── plugin body (native sidebar extension points) ─────────────────────
//
// Everything this half needs comes from Cordis services the HOST provides
// (issue #187 batch 2): the tab registry, the slot registry, the document
// preview registry and the right-Sidebar navigation controller. There is no
// third-party sidebar package in the picture anymore, so the page keeps
// working on any host that ships those four services.
//
// The stylesheet is pure static CSS and must NOT depend on any of them:
// inject it first, unconditionally. If it lived behind an early return, an HMR
// rebuild or service reload could leave the already-rendered tab WITHOUT its
// stylesheet — the raw white-text list you see when the CSS is gone. Each
// fiber owns its own <style> element and the disposer removes only that
// element, so a rebuild always keeps at least one copy.
/** registerTab step one: the tab TYPE (what a file-activity page is). */
function registerTabType(ctx) {
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        // No patterns: this is a page type, opened by kind (ctx.sidebarRight.openTab).
        title: () => strings.title(),
        // Guide entry (issue #266 B): the sidebar's "new tab" page is the guide
        // tab, and its doors come from `sidebarRightTabs.guide()` — the entries
        // every registered type contributes. Without one the page was reachable
        // ONLY through auto-open, so closing its chip made it impossible to
        // reopen from the UI. Picking the capsule opens this kind in the guide's
        // place (host GuideBody → actions.openTab(kind, { replaceTab: true })).
        guide: [
          {
            order: 20,
            title: () => strings.title(),
            description: () => strings.guideDescription(),
          },
        ],
      }),
    'dsh-file-activity: tab type',
  )
}
/** registerTab step two: the body seat (keyed by the definition id). */
function registerTabBody(ctx, dataStore) {
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, function (props) {
          const injected = Object.assign({}, props, { dataStore })
          return createElement(FileActivityView, injected)
        }),
      ),
    'dsh-file-activity: tab body',
  )
}
/** registerTab step three: the chip title seat (a live, localized label). */
function registerTabTitle(ctx) {
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, () =>
          createElement('span', { className: 'dfa-chip' }, strings.title()),
        ),
      ),
    'dsh-file-activity: tab title',
  )
}
/**
 * Run one registration, converting a throw into an observable failure.
 *
 * Swallowing is deliberate: the host throws for a taken id or a taken kind, and
 * letting it escape would fail the WHOLE activation (the stylesheet, the
 * floating preview and the settings tab would go with it). What must never
 * happen is a SILENT failure, so the cause is logged, marked on <html> and
 * rendered as a notice inside the tab body.
 */
function guarded(kind, register) {
  try {
    register()
  } catch (error) {
    markDegraded(kind, error)
  }
}
exports.inject = ['slots', 'sidebarRightTabs', 'documentPreviews', 'sidebarRight']
exports.apply = function apply(ctx) {
  // Stylesheet first, unconditionally (HMR pitfall — see the header note).
  injectStyles(ctx)
  // Failing loudly beats failing silently: a rejected registration (id taken,
  // kind taken, seat missing) is recorded so the user and the e2e suite can
  // see WHY the tab never appeared.
  guarded('tab', () => registerTabType(ctx))
  const dataStore = createStore({ bySession: {}, preview: null })
  registerSharedStore(dataStore)
  registerTabBody(ctx, dataStore)
  registerTabTitle(ctx)
  registerPreviewOverlay(ctx, dataStore)
  registerSettingsTab(ctx)
  guarded('previews', () => registerDocumentPreviews(ctx))
  // sidebar operations → host record route
  ctx.effect(() => installFetchInterceptor(), 'dsh-file-activity: sidebar fetch observation')
  // auto-open once per session (default on)
  ctx.effect(() => installAutoOpen(ctx), 'dsh-file-activity: auto-open')
}
// Internal functions exposed for the render-path test suite only; inert in
// the browser bundle (plain properties on the exports object).
exports.__test = {
  loadFsReadContent,
  fsReadError,
  fetchTextContent,
  textUrlOf,
  strings,
  viewerOf,
  renderPreviewBody,
  previewClickAction,
  isInsideFloating,
  closePreviewOnHidden,
  autoOpenEnabled,
  PREVIEW_EXTENSIONS,
  AUTO_CLOSE_MS,
  // Static stylesheet text, so the render-path suite can assert the floating
  // preview body keeps its flex-fill container (issue #111).
  STYLES,
}


    return module.exports
  },
})
