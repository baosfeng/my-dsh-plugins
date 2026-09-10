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
