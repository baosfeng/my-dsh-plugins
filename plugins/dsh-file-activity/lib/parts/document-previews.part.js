'use strict'
// ── native document previews (metadata + plain-text renderer) ──────────
//
// The HOST owns file content on the native side: a registered preview only
// declares WHICH suffixes this implementation recognizes and HOW the document
// owner should deliver the bytes ('text-pages' = paged text window,
// 'bytes-complete' = whole file). The owner then injects the prepared
// DocumentContent into the 'sidebar.right.tab.document' seat, keyed by this
// implementation's id — so the renderer never fetches anything itself
// (the responsibility split that made better-sidebar's matchFileViewer
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
