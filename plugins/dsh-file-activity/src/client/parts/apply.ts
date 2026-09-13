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
function registerTabType(ctx: ClientContext): void {
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        // No patterns: this is a page type, opened by kind (ctx.sidebarRight.openTab).
        title: () => strings.title(),
      }),
    'dsh-file-activity: tab type',
  )
}

/** registerTab step two: the body seat (keyed by the definition id). */
function registerTabBody(ctx: ClientContext, dataStore: DataStore<DataState>): void {
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, function (props: unknown) {
          const injected = Object.assign({}, props, { dataStore })
          return createElement(FileActivityView, injected)
        }),
      ),
    'dsh-file-activity: tab body',
  )
}

/** registerTab step three: the chip title seat (a live, localized label). */
function registerTabTitle(ctx: ClientContext): void {
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

/** Mount probe: report client activation to the host state (synthetic
 *  session id, invisible in the UI — confirms the client half actually
 *  loaded after a page refresh). */
function mountProbe(): void {
  void fetch('/file-activity/api/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: '__probe__', path: 'mounted', op: 'read' }),
  }).catch(() => {})
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
function guarded(kind: string, register: () => void): void {
  try {
    register()
  } catch (error) {
    markDegraded(kind, error)
  }
}

exports.inject = ['slots', 'sidebarRightTabs', 'documentPreviews', 'sidebarRight']

exports.apply = function apply(ctx: ClientContext): void {
  // Stylesheet first, unconditionally (HMR pitfall — see the header note).
  injectStyles(ctx)
  // Failing loudly beats failing silently: a rejected registration (id taken,
  // kind taken, seat missing) is recorded so the user and the e2e suite can
  // see WHY the tab never appeared.
  guarded('tab', () => registerTabType(ctx))
  const dataStore = createStore<DataState>({ bySession: {}, preview: null })
  registerSharedStore(dataStore)
  registerTabBody(ctx, dataStore)
  registerTabTitle(ctx)
  registerPreviewOverlay(ctx, dataStore)
  registerSettingsTab(ctx)
  guarded('previews', () => registerDocumentPreviews(ctx))
  mountProbe()

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
