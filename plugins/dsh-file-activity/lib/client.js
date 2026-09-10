/**
 * dsh-file-activity — client half (browser).
 *
 * Extends dsh-better-sidebar with a "文件活动 / File Activity" tab:
 *  - recent file access history (agent + sidebar operations),
 *  - per-file create/modify/read counts flattened by folder, with multi-level
 *    folders shown as dotted paths (a.b.c.d) and their files indented below,
 *  - clicking any file opens a FLOATING preview that reuses the sidebar's
 *    NATIVE viewer via `ctx.betterSidebar.matchFileViewer(path)` — its own
 *    `component` is mounted (built-in markdown / code / image / pdf / html
 *    renderers), so code gets syntax highlighting and markdown gets rendered
 *    with no hand-rolled preview; clicking outside / Esc / × closes it,
 *  - auto-opens once per session by default (toggleable in the sidebar
 *    settings, enabled by default).
 *
 * Data source: the plugin host half (fs/observed for agent tools) + this
 * half's fetch interception for sidebar file operations (fs.read / fs.write /
 * /sidebar/file media opens), both persisted host-side; the tab polls
 * /file-activity/api/stats.
 *
 * Styling follows the dsh-better-sidebar design language: all colors ride the
 * DSH semantic tokens (--dsw-alias-*), typography rides the font roles
 * (--dsw-font-*), motion rides --ds-*. Flat surfaces (no box-shadow), hairline
 * borders, 28px circular icon controls with hover fills, and 8px-radius rows
 * with hover fills. The stylesheet is injected once per activation and torn
 * down with the fiber, so HMR/disable leaves no residue.
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

    const TAB_ID = 'file-activity:recent'
    const AUTO_OPEN_KEY = 'dsh-file-activity:auto-opened:'
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
// ── fetch interception: sidebar file operations ───────────────────────
function methodOf(init) {
  return (init?.method ?? 'GET').toUpperCase()
}
/** POST body as a plain object (non-string bodies are ignored). */
function parseBody(init) {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : {}
}
/** Record fs.read / fs.write POSTs observed on the sidebar API. */
function recordSidebarFs(url, init) {
  if (url.pathname !== '/sidebar/api/fs.read' && url.pathname !== '/sidebar/api/fs.write') return
  if (methodOf(init) !== 'POST') return
  const body = parseBody(init)
  if (typeof body.sessionId !== 'string' || typeof body.path !== 'string') return
  postRecord(body.sessionId, body.path, url.pathname === '/sidebar/api/fs.write' ? 'write' : 'read')
}
/** Record sidebar media opens (/sidebar/file?sessionId=...&path=...). */
function recordMediaOpen(url, init) {
  if (url.pathname !== '/sidebar/file' || methodOf(init) !== 'GET') return
  const sessionId = url.searchParams.get('sessionId')
  const path = url.searchParams.get('path')
  if (sessionId !== null && path !== null) postRecord(sessionId, path, 'read')
}
/** Observe a resolved fetch URL and record sidebar file operations. */
function observeSidebarFetch(url, init) {
  try {
    recordSidebarFs(url, init)
    recordMediaOpen(url, init)
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
function findTabIn(state, tabId) {
  const leaves = (node) => (node.kind === 'leaf' ? [node] : (node.children ?? []).flatMap(leaves))
  for (const node of [state?.splits, state?.bottomSplits]) {
    if (node === undefined || node === null) continue
    for (const leaf of leaves(node)) {
      if ((leaf.tabs ?? []).some((tab) => tab.type === tabId)) return true
    }
  }
  return false
}
/** Current sidebar snapshot, or null when the service is not ready. */
function sidebarSnapshot(service) {
  try {
    return service.getSnapshot?.()
  } catch {
    return null
  }
}
/** The user disabled auto-open for this tab in the sidebar settings. */
function isAutoOpenDisabled(snapshot, tabId) {
  const settings = snapshot.prefs?.pluginSettings?.[tabId]
  return settings !== undefined && settings.autoOpen === false
}
/** Whether this session was already auto-opened (localStorage marker). */
function isAutoOpenMarked(sessionId) {
  try {
    return Boolean(window.localStorage.getItem(AUTO_OPEN_KEY + sessionId))
  } catch {
    return true
  }
}
/** Persist the auto-opened marker for this session. */
function markAutoOpened(sessionId) {
  try {
    window.localStorage.setItem(AUTO_OPEN_KEY + sessionId, '1')
  } catch {
    // ignore
  }
}
/** Open the tab once per session unless disabled in the plugin settings. */
function tryAutoOpen(service, tabId) {
  const snapshot = sidebarSnapshot(service)
  if (snapshot === undefined || snapshot === null || snapshot.sessionId === undefined || snapshot.state === undefined)
    return
  const sessionId = snapshot.sessionId
  if (isAutoOpenDisabled(snapshot, tabId)) return
  if (isAutoOpenMarked(sessionId)) return
  if (findTabIn(snapshot.state, tabId)) {
    markAutoOpened(sessionId)
    return
  }
  try {
    service.openTab({ type: tabId, title: strings.title(), path: '' })
    markAutoOpened(sessionId)
  } catch (error) {
    console.error('[dsh-file-activity] auto-open failed:', error)
  }
}
function installAutoOpen(ctx, tabId) {
  const service = ctx.betterSidebar
  tryAutoOpen(service, tabId)
  let off = () => {}
  try {
    off = service.subscribeState?.(() => tryAutoOpen(service, tabId)) ?? off
  } catch {
    // service may lack subscribeState on older versions
  }
  return off
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
// Mirrors the better-sidebar explorer surface: tight 2px 6px 8px body,
// 30px rows, box-sizing border-box indentation, folder rows use the
// strong type face to read as directories, files stay regular.
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
   component (better-sidebar's TextEditor for html/code/markdown, the image
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
   想要的蓝色高亮）。页签选中态回归宿主（dsh-better-sidebar）默认样式。 */
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
function FileActivityView({ ctx, store, scope, visible, dataStore }) {
  const data = useSyncExternalStore(dataStore.subscribe, dataStore.getSnapshot)
  const [cwd, setCwd] = useState(scope?.cwd || '')
  const [error, setError] = useState(false)
  const [recentOpen, setRecentOpen] = useState(true)
  const [collapsedDirs, setCollapsedDirs] = useState(() => new Set())
  const sessionId = scope?.sessionId ?? ''
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
  const openPreview = (path) => dataStore.set({ preview: { abs: path, name: basenameOf(path) } })
  const closePreview = () => dataStore.set({ preview: null })
  const onClear = () => clearSessionData(dataStore, sessionId)
  const onRefresh = () => refreshSessionData(dataStore, sessionId, setCwd, setError)
  const recent = sessionData.recent ?? []
  return createElement(
    'div',
    { className: 'dfa' },
    renderError(error),
    renderRecentSection(recent, recentOpen, () => setRecentOpen((v) => !v), onRefresh, onClear, openPreview),
    renderStatsSection(tree, collapsedDirs, toggleDir, openPreview),
    data.preview
      ? createElement(FloatingPreview, {
          ctx,
          store,
          scope,
          preview: data.preview,
          onClose: closePreview,
        })
      : null,
  )
}

    'use strict'
// ── floating preview window (reuses the sidebar's native viewer) ──────
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
/** Milliseconds after which an error-state preview closes itself (issue #76):
 *  a shell that failed to load any content is useless, so it must not linger
 *  over the main UI until the user finds the × button. */
const AUTO_CLOSE_MS = 2500
/** Whether a pointerdown target lies inside the floating window. The window
 *  surface carries the `.dfa-fp` class; anything else counts as "outside"
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
/**
 * Load fsRead content through the sidebar API and resolve the viewer's
 * load state (ready with text, or error with the API message). When the
 * sidebar refuses a recorded path (its workspace fence, e.g. agent-read
 * files under ~/.dsh), fall back to the plugin's own text route, which
 * authorizes exactly the paths this session recorded (issue #68).
 */
async function loadFsReadContent(viewer, path, scope, sessionId) {
  const target = resolvePath(path, scope?.cwd ?? '')
  const response = await fetch('/sidebar/api/fs.read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, path: target }),
  })
  const json = await response.json()
  if (isFsReadOk(json)) return { status: 'ready', viewer, content: json.value.content }
  // The sidebar refused — try OUR recorded-path text route before giving up.
  const textJson = await fetchTextContent(sessionId, path)
  if (isFsReadOk(textJson)) return { status: 'ready', viewer, content: textJson.value.content }
  return fsReadError(json, viewer)
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
 * Fetch the bytes the viewer's fetchStrategy needs (fsRead text /
 * mediaUrl / customData) and resolve its load state.
 */
async function fetchPreviewLoad(viewer, path, scope, sessionId) {
  const strategy = viewer.fetchStrategy
  if (strategy === 'fsRead') return loadFsReadContent(viewer, path, scope, sessionId)
  if (strategy === 'mediaUrl') {
    return { status: 'ready', viewer, mediaUrl: mediaUrlOf(sessionId, path) }
  }
  if (strategy === 'custom') {
    const data = await (viewer.load?.(path, scope) ?? Promise.resolve(undefined))
    return { status: 'ready', viewer, customData: data }
  }
  // 'binary-download' and anything else: mount the viewer's own
  // component (it handles the download / media itself).
  return { status: 'ready', viewer }
}
/**
 * Resolve the file's viewer through the sidebar registry and load the
 * bytes it needs; failures become an error state shown in the window.
 */
function usePreviewLoader(service, path, sessionId, scope) {
  const [load, setLoad] = useState({ status: 'loading', viewer: null })
  useEffect(() => {
    let cancelled = false
    const viewer = service?.matchFileViewer?.(path)
    if (!viewer) {
      setLoad({ status: 'error', viewer: null, message: strings.previewUnsupported() })
      return () => {
        cancelled = true
      }
    }
    setLoad({ status: 'loading', viewer })
    fetchPreviewLoad(viewer, path, scope, sessionId)
      .then((next) => {
        if (!cancelled) setLoad(next)
      })
      .catch((error) => {
        if (!cancelled)
          setLoad({
            status: 'error',
            viewer,
            message: error instanceof Error ? error.message : String(error),
          })
      })
    return () => {
      cancelled = true
    }
  }, [path, sessionId, scope])
  return load
}
/** Preview window body: loading note / error panel / viewer mount. */
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
  if (load.viewer.id === 'pdf') {
    const url = mediaUrlOf(sessionId, path)
    return createElement(PdfPreview, { src: url, download: `${url}&download=1`, title })
  }
  return createElement(load.viewer.component, {
    ctx,
    store,
    scope,
    path,
    title,
    viewerId: load.viewer.id,
    content: load.content,
    mediaUrl: load.mediaUrl,
    customData: load.customData,
  })
}
/**
 * A floating preview window. Instead of re-implementing rendering, it
 * asks the sidebar registry for the file's viewer (`matchFileViewer`),
 * fetches the bytes the viewer's fetchStrategy needs (fsRead text /
 * mediaUrl / customData), then mounts that viewer's own component — so
 * code gets syntax highlighting and markdown gets rendered by the SAME
 * built-in renderers the sidebar's editor tab uses.
 *
 * Media caveat: the sidebar's own media route (/sidebar/file) only serves
 * files inside the session working directory, while file activity records
 * files the agent touched anywhere (/tmp scratch files, sibling repos…).
 * Media bytes therefore come from OUR route (/file-activity/file), which
 * authorizes exactly the paths this session recorded; PDF is the one
 * built-in viewer that fetches its own URL internally (it ignores the
 * `mediaUrl` prop), so it gets a small iframe preview instead.
 */
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
      if (!isInsideFloating(event?.target)) onClose()
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
function FloatingPreview({ ctx, store, scope, preview, onClose }) {
  const sessionId = scope?.sessionId ?? ''
  const path = preview.abs
  const title = preview.name
  const service = ctx.betterSidebar
  const load = usePreviewLoader(service, path, sessionId, scope)
  usePreviewDismiss(load, onClose)
  return renderFloatingWindow(load, ctx, store, scope, path, title, sessionId, onClose)
}
/**
 * Lightweight PDF preview. better-sidebar's built-in PdfView fetches
 * `/sidebar/file` internally (it ignores any injected `mediaUrl` prop),
 * and that route refuses files outside the session working directory — so
 * a recorded /tmp PDF would never load. This tiny view embeds the bytes
 * from OUR media route in a native browser PDF frame, with a download
 * fallback in its toolbar.
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
// ── plugin body ───────────────────────────────────────────────────────
/**
 * The stylesheet is pure static CSS and must NOT depend on the
 * betterSidebar service: inject it first, unconditionally. If it lived
 * behind the `service === undefined` early return, an HMR rebuild or
 * service reload could leave the already-rendered tab WITHOUT its
 * stylesheet — the raw white-text list you see when the CSS is gone.
 * Each fiber owns its own <style> element and the disposer removes
 * only that element, so a rebuild always keeps at least one copy.
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
/** Mount probe: report client activation to the host state (synthetic
 *  session id, invisible in the UI — confirms the client half actually
 *  loaded after a page refresh). */
function mountProbe() {
  void fetch('/file-activity/api/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: '__probe__', path: 'mounted', op: 'read' }),
  }).catch(() => {})
}
/** Register the tab (enabled by default in the Side card settings). */
function registerTab(ctx, dataStore) {
  const service = ctx.betterSidebar
  ctx.effect(
    () =>
      service.registerTab({
        id: TAB_ID,
        title: () => strings.title(),
        icon: (size) => icon.clock(size),
        order: 15,
        single: true,
        settings: {
          pluginToggles: [
            {
              key: 'autoOpen',
              title: () => (isZh() ? '会话开始时自动打开' : 'Auto-open on session start'),
              desc: () =>
                isZh()
                  ? '每个会话首次打开时自动显示本页（可在侧边栏设置中关闭）'
                  : 'Opens this tab once per session by default (turn off here)',
              type: 'switch',
            },
          ],
        },
        component: (props) => createElement(FileActivityView, { ...props, dataStore }),
      }),
    'dsh-file-activity: tab registration',
  )
}
exports.inject = ['betterSidebar']
exports.apply = function apply(ctx) {
  // Stylesheet first, unconditionally (HMR pitfall — see injectStyles).
  injectStyles(ctx)
  const service = ctx.betterSidebar
  if (service === undefined) {
    // 依赖缺失提示（issue #72 同类问题）：dsh-file-activity 的 client 端
    // 依赖 dsh-better-sidebar 提供侧边栏扩展点，未安装时静默返回会让用户
    // 以为插件坏了——明确提示安装方式。
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(
        '[dsh-file-activity] dsh-better-sidebar 未安装：文件活动页签无法挂载。请安装宿主插件：dsh plugin --profile web add dsh-better-sidebar dsh-file-activity',
      )
    }
    return
  }
  // Per-session data store: { bySession: { [sessionId]: { recent, counts, loading } }, preview }
  // Each conversation reads/writes only its own bucket, so switching
  // sessions never leaks another session's file activity into the view.
  const dataStore = createStore({ bySession: {}, preview: null })
  mountProbe()
  // sidebar operations → host record route
  ctx.effect(() => installFetchInterceptor(), 'dsh-file-activity: sidebar fetch observation')
  registerTab(ctx, dataStore)
  // auto-open once per session (default on)
  ctx.effect(() => installAutoOpen(ctx, TAB_ID), 'dsh-file-activity: auto-open')
}
// Internal functions exposed for the render-path test suite only; inert in
// the browser bundle (plain properties on the exports object).
exports.__test = {
  loadFsReadContent,
  fsReadError,
  fetchTextContent,
  textUrlOf,
  strings,
  renderPreviewBody,
  previewClickAction,
  isInsideFloating,
  closePreviewOnHidden,
  AUTO_CLOSE_MS,
  // Static stylesheet text, so the render-path suite can assert the floating
  // preview body keeps its flex-fill container (issue #111).
  STYLES,
}


    return module.exports
  },
})
