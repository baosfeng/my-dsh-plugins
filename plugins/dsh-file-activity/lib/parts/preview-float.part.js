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
