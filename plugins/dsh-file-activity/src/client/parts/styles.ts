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
