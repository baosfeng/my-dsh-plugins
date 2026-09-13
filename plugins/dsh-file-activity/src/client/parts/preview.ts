// ── floating preview window (own renderer, shell.overlay seat) ─────────
//
// History: this window used to mount the third-party sidebar's built-in
// viewer, picked by the third-party sidebar's matchFileViewer(path), and fed it the
// bytes its `fetchStrategy` asked for. That service is gone (issue #187
// batch 2), so the window renders the recorded file itself:
//
//   image (svg/png/…/avif/webp/gif)  →  <img src> on the plugin's media route
//   pdf                              →  <iframe src> on the same route, with a
//                                        download fallback (native PDF frame,
//                                        no viewer hand-off needed)
//   everything else                  →  the plugin's own text route, rendered
//                                        by the host's MarkdownText / CodeBlock
//                                        atoms (staticModules: zero install)
//                                        and a <pre> fallback.
//
// The route matters: file activity records files the agent touched ANYWHERE
// (scratch files in /tmp, sibling repos, ~/.dsh), while the host's file
// provider is fenced to the session workspace. The plugin's own route
// authorizes exactly the paths this session recorded.

/** host API JSON response (fields probed defensively: ok / value.content / error.message). */
interface ApiJson {
  ok?: unknown
  value?: { content?: unknown }
  error?: { message?: string }
}

/** 查看器加载状态：loading（拉取中）/ ready（有内容或直接挂载）/ error。 */
interface PreviewLoad {
  status: 'loading' | 'ready' | 'error'
  /** Identifier of the renderer chosen for this path ('image'/'pdf'/'text'/'markdown'). */
  viewer?: { id: string } | null
  content?: string
  mediaUrl?: string
  message?: string
}

/** Props of the window body renderer. */
interface PreviewBodyProps {
  load: PreviewLoad
  path: string
  title: string
  sessionId: string
}

/** Image suffixes the browser renders natively. */
const IMAGE_EXT = /^(svg|png|jpe?g|gif|webp|avif|bmp|ico)$/i
/** Suffixes rendered as Markdown. */
const MARKDOWN_EXT = /^(md|markdown|mdx)$/i

/** Lower-case suffix of a path ('' when it has none). extOf (rows.ts) works on
 *  a file NAME, so the basename is sliced off first. */
function extOfPath(path: string): string {
  return extOf(path.slice(path.lastIndexOf('/') + 1))
}

/** Official UI atoms come from the host's staticModules (zero install). */
function uiAtoms(): Record<string, unknown> {
  try {
    return require('@deepseek-ai/dsh-client-ui-primitives')
  } catch {
    return {}
  }
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
function fsReadError(json: ApiJson | null, viewer: { id: string } | null): PreviewLoad {
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
 * Load the recorded file's text through the plugin's own route, falling back
 * to the host sidebar route when the plugin refuses the path. Whatever the
 * host viewer used to do with its own fetchStrategy, this window does the
 * reading itself now — the routes are the same ones the previous
 * implementation used for its fsRead strategy.
 */
async function loadFsReadContent(
  viewer: { id: string } | null,
  path: string,
  scope: SessionScope | null,
  sessionId: string,
): Promise<PreviewLoad> {
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
function viewerOf(path: string): string {
  const ext = extOfPath(path)
  if (IMAGE_EXT.test(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (MARKDOWN_EXT.test(ext)) return 'markdown'
  return 'text'
}

/** Fetch the bytes the chosen renderer needs (media URL, or text content). */
async function fetchPreviewLoad(target: PreviewTarget): Promise<PreviewLoad> {
  const viewer = { id: viewerOf(target.abs) }
  if (viewer.id === 'image' || viewer.id === 'pdf') {
    return { status: 'ready', viewer, mediaUrl: mediaUrlOf(target.sessionId, target.abs) }
  }
  return loadFsReadContent(viewer, target.abs, null, target.sessionId)
}

/**
 * Resolve the file's renderer and load what it needs; failures become an
 * error state shown in the window.
 */
function usePreviewLoader(target: PreviewTarget): PreviewLoad {
  const [load, setLoad] = useState<PreviewLoad>({ status: 'loading', viewer: null })
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
function TextBody({ load, path }: PreviewBodyProps): unknown {
  const text = load.content ?? ''
  const ui = uiAtoms() as any
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
function ImageBody({ load, title }: PreviewBodyProps): unknown {
  return createElement('img', { className: 'dfa-fp-img', src: load.mediaUrl, alt: title })
}

/** Preview window body: loading note / error panel / renderer mount. */
function renderPreviewBody(
  load: PreviewLoad,
  ctx: ClientContext,
  store: unknown,
  scope: SessionScope | null,
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
  const props: PreviewBodyProps = { load, path, title, sessionId }
  if (load.viewer?.id === 'image') return ImageBody(props)
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
function usePreviewDismiss(load: PreviewLoad, onClose: () => void): void {
  useEffect(() => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {}
    const handler = (event: any) => {
      if (!isInsideFloating(event && event.target)) onClose()
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [onClose])

  useEffect(() => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {}
    const handler = (event: any) => {
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
  scope: SessionScope | null,
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
        'data-dfa-preview': '1',
        onClick: (event: { stopPropagation?: () => void } | null) => {
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
function FloatingPreviewOverlay(): unknown {
  const store = sharedStore()
  const state = useSyncExternalStore(
    store === null ? () => () => {} : store.subscribe,
    store === null ? () => null : store.getSnapshot,
  )
  const preview = state === null || state === undefined ? null : state.preview
  const sessionId = preview === null ? '' : preview.sessionId
  // Hooks must run unconditionally: the loader is fed an empty target while
  // the window is closed (it then never resolves a load, and nothing renders).
  const target: PreviewTarget = preview ?? { abs: '', name: '', sessionId: '' }
  const load = usePreviewLoader(target)
  const onClose = () => {
    if (store !== null) store.set({ preview: null })
  }
  usePreviewDismiss(load, onClose)
  if (preview === null) return null
  return renderFloatingWindow(
    load,
    undefined as unknown as ClientContext,
    null,
    null,
    preview.abs,
    preview.name,
    sessionId,
    onClose,
  )
}

/** Register the overlay seat (list slot: additive, never replaces host UI). */
function registerPreviewOverlay(ctx: ClientContext, dataStore: DataStore<DataState>): void {
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
function PdfPreview({ src, download, title }: { src: string; download: string; title: string }): unknown {
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
