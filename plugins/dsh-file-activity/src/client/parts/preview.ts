// ── floating preview window (reuses the sidebar's native viewer) ──────

/** host API JSON 响应（字段防御性访问：ok / value.content / error.message）。 */
interface ApiJson {
  ok?: unknown
  value?: { content?: unknown }
  error?: { message?: string }
}

/** 查看器加载状态：loading（拉取中）/ ready（有内容或直接挂载）/ error。 */
interface PreviewLoad {
  status: 'loading' | 'ready' | 'error'
  viewer?: FileViewer | null
  content?: string
  mediaUrl?: string
  customData?: unknown
  message?: string
}

/** FloatingPreview 的 props（ctx/store/scope 透传给查看器组件）。 */
interface FloatingPreviewProps {
  ctx: ClientContext
  store: unknown
  scope: SessionScope
  preview: PreviewTarget
  onClose: () => void
}

/** PdfPreview 的 props（插件媒体路由 + 下载回退）。 */
interface PdfPreviewProps {
  src: string
  download: string
  title: string
}

/** Resolve a possibly-relative path against the session cwd. */
function resolvePath(path: string, cwd: unknown): string {
  if (typeof path !== 'string' || path === '') return path
  if (path.startsWith('/')) return path
  if (typeof cwd === 'string' && cwd !== '') return `${cwd.replace(/\/+$/, '')}/${path}`
  return path
}

/** Whether the fs.read API response carries a text content payload. */
function isFsReadOk(json: ApiJson | null): json is ApiJson & { value: { content: string } } {
  return json !== null && typeof json === 'object' && json.ok === true && typeof json.value?.content === 'string'
}

/** Error load state from an fs.read API response (or a generic message).
 *  Raw system errors are translated to friendly, locale-aware messages
 *  (issue #68): deleted files and workspace-fenced paths must never surface
 *  ENOENT / "is outside workspace" verbatim. */
function fsReadError(json: ApiJson | null, viewer: FileViewer | null): PreviewLoad {
  const raw = json?.error?.message ?? ''
  let message: string
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
function isInsideFloating(target?: { closest?: (selector: string) => unknown } | null): boolean {
  if (!target || typeof target.closest !== 'function') return false
  return target.closest('.dfa-fp') !== null
}

/** Click behavior for the window surface: in the error state ANY click
 *  closes the shell (there is no content to interact with), otherwise the
 *  click is swallowed so the viewer's own interactions keep working. */
function previewClickAction(load: PreviewLoad, event?: { stopPropagation?: () => void } | null): string {
  if (load.status === 'error') return 'close'
  if (event && event.stopPropagation) event.stopPropagation()
  return 'stop'
}

/** Close the floating preview when the tab goes hidden (switching tabs /
 *  operating the main UI), so it never lingers over the interface. */
function closePreviewOnHidden(visible: boolean, dataStore: DataStore<DataState>): void {
  if (!visible) dataStore.set({ preview: null })
}

/**
 * Load fsRead content through the sidebar API and resolve the viewer's
 * load state (ready with text, or error with the API message). When the
 * sidebar refuses a recorded path (its workspace fence, e.g. agent-read
 * files under ~/.dsh), fall back to the plugin's own text route, which
 * authorizes exactly the paths this session recorded (issue #68).
 */
async function loadFsReadContent(
  viewer: FileViewer,
  path: string,
  scope: SessionScope,
  sessionId: string,
): Promise<PreviewLoad> {
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
async function fetchTextContent(sessionId: string, path: string): Promise<ApiJson | null> {
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
async function fetchPreviewLoad(
  viewer: FileViewer,
  path: string,
  scope: SessionScope,
  sessionId: string,
): Promise<PreviewLoad> {
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
function usePreviewLoader(
  service: SidebarService | undefined,
  path: string,
  sessionId: string,
  scope: SessionScope,
): PreviewLoad {
  const [load, setLoad] = useState<PreviewLoad>({ status: 'loading', viewer: null })
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
function renderPreviewBody(
  load: PreviewLoad,
  ctx: ClientContext,
  store: unknown,
  scope: SessionScope,
  path: string,
  title: string,
  sessionId: string,
): unknown {
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
function usePreviewDismiss(load: PreviewLoad, onClose: () => void): void {
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
function renderFloatingWindow(
  load: PreviewLoad,
  ctx: ClientContext,
  store: unknown,
  scope: SessionScope,
  path: string,
  title: string,
  sessionId: string,
  onClose: () => void,
): unknown {
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

function FloatingPreview({ ctx, store, scope, preview, onClose }: FloatingPreviewProps): unknown {
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
function PdfPreview({ src, download, title }: PdfPreviewProps): unknown {
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
