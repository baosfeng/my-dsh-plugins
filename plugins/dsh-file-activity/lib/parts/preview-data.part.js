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
  if (MARKDOWN_EXT.test(ext)) return 'markdown'
  return 'text'
}
/** Fetch the bytes the chosen renderer needs (media URL, or text content). */
async function fetchPreviewLoad(target) {
  const viewer = { id: viewerOf(target.abs) }
  if (viewer.id === 'image' || viewer.id === 'pdf') {
    return { status: 'ready', viewer, mediaUrl: mediaUrlOf(target.sessionId, target.abs) }
  }
  return loadFsReadContent(viewer, target.abs, null, target.sessionId)
}
