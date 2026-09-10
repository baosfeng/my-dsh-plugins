// ── styles (DSH semantic tokens, injected on activate, removed on teardown) ──
// Visual baseline: dsh-file-activity (issue #54) — flat surfaces, hairline
// borders, 24px circular icon buttons, brand badges, 8px-radius rows with
// hover fills, 150ms row entrance animation. All colors ride --dsw-alias-*,
// typography rides --dsw-font-*, motion rides --ds-*.
const STYLES: string = `
.dsh-my-plugin-manager-root { display:flex; flex-direction:column; gap:2px; padding:2px 6px 8px;
  font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); }
.dsh-my-plugin-manager-hint { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); line-height:1.7; padding:2px 6px; }
.dsh-my-plugin-manager-status { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); padding:2px 6px; }
.dsh-my-plugin-manager-saved { color:var(--dsw-alias-state-success-primary); }
.dsh-my-plugin-manager-new { color:var(--dsw-alias-state-warn-primary); }
.dsh-my-plugin-manager-error { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-state-error-primary);
  padding:4px 6px; white-space:pre-wrap; word-break:break-all; }
.dsh-my-plugin-manager-section { display:flex; flex-direction:column; gap:2px; margin-top:4px; }
.dsh-my-plugin-manager-section-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:2px 6px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary); text-transform:uppercase; letter-spacing:.04em; }
.dsh-my-plugin-manager-section-title { font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary);
  text-transform:uppercase; letter-spacing:.04em; }
.dsh-my-plugin-manager-section-head-actions { display:flex; align-items:center; gap:2px; flex:none; }
.dsh-my-plugin-manager-iconbtn { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0;
  border:none; border-radius:50%; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; flex:none;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-plugin-manager-iconbtn svg { display:block; }
.dsh-my-plugin-manager-iconbtn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.dsh-my-plugin-manager-iconbtn:disabled { opacity:.4; cursor:default; }
.dsh-my-plugin-manager-iconbtn-xs { width:20px; height:20px; }
.dsh-my-plugin-manager-row { display:flex; flex-direction:column; gap:2px; padding:6px 8px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1); background:transparent;
  animation:dsh-my-plugin-manager-row-in 150ms var(--ds-ease-in-out);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-plugin-manager-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-plugin-manager-row-head { display:flex; align-items:center; gap:6px; min-width:0; }
.dsh-my-plugin-manager-row-icon { flex:none; display:flex; align-items:center; color:var(--dsw-alias-label-tertiary); }
.dsh-my-plugin-manager-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
.dsh-my-plugin-manager-ver { flex:none; display:inline-flex; align-items:center; justify-content:center; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-accent);
  background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent); }
.dsh-my-plugin-manager-state { flex:none; display:inline-flex; align-items:center; justify-content:center; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); }
.dsh-my-plugin-manager-state-on { color:var(--dsw-alias-state-success-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); }
.dsh-my-plugin-manager-state-off { color:var(--dsw-alias-label-tertiary);
  background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 12%, transparent); }
.dsh-my-plugin-manager-update { flex:none; display:inline-flex; align-items:center; justify-content:center; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-state-warn-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-plugin-manager-author { flex:none; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); white-space:nowrap; }
.dsh-my-plugin-manager-desc { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-secondary); line-height:1.5;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.dsh-my-plugin-manager-actions { display:flex; gap:6px; margin-top:4px; }
.dsh-my-plugin-manager-btn { display:inline-flex; align-items:center; gap:5px; flex:none; height:24px; padding:0 10px; border-radius:5px; cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-secondary);
  font:var(--dsw-font-xxs-12);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-plugin-manager-btn svg { display:block; }
.dsh-my-plugin-manager-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.dsh-my-plugin-manager-btn:disabled { opacity:.4; cursor:default; }
.dsh-my-plugin-manager-btn-primary { color:var(--dsw-alias-accent); border-color:color-mix(in srgb, var(--dsw-alias-accent) 45%, transparent); }
.dsh-my-plugin-manager-btn-primary:hover:not(:disabled) { color:var(--dsw-alias-accent); }
.dsh-my-plugin-manager-btn-danger { color:var(--dsw-alias-state-error-primary); border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); }
.dsh-my-plugin-manager-btn-danger:hover:not(:disabled) { color:var(--dsw-alias-state-error-primary); }
.dsh-my-plugin-manager-searchbar { display:flex; gap:6px; align-items:center; padding:0 6px; }
.dsh-my-plugin-manager-search-input { flex:1; min-width:0; height:28px; padding:0 8px; border-radius:6px;
  border:1px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-primary);
  font:var(--dsw-font-s-14); }
.dsh-my-plugin-manager-search-input:focus { outline:none; border-color:var(--dsw-alias-accent); }
.dsh-my-plugin-manager-empty { display:flex; flex-direction:column; align-items:center; gap:2px; padding:10px 6px;
  font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); line-height:1.7; text-align:center; }
.dsh-my-plugin-manager-empty svg { color:var(--dsw-alias-label-dimmed); }
.dsh-my-plugin-manager-empty-hint { color:var(--dsw-alias-label-dimmed); font:var(--dsw-font-xxxs-11); }
.dsh-my-plugin-manager-name-btn { flex:1; min-width:0; padding:0; border:none; background:transparent; text-align:left; cursor:pointer;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
.dsh-my-plugin-manager-name-btn:hover { color:var(--dsw-alias-accent); text-decoration:underline; }
.dsh-my-plugin-manager-btn-ghost { color:var(--dsw-alias-label-secondary); }
.dsh-my-plugin-manager-detail { position:absolute; inset:0; z-index:10; display:flex; flex-direction:column; gap:2px;
  padding:0 6px 8px; overflow-y:auto; border:1px solid var(--dsw-alias-border-l1); border-radius:8px;
  background:var(--dsw-alias-bg-elevated); }
.dsh-my-plugin-manager-detail-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 6px 2px;
  position:sticky; top:0; background:var(--dsw-alias-bg-elevated); }
.dsh-my-plugin-manager-detail-title { font:var(--dsw-font-m-strong-16); color:var(--dsw-alias-label-primary); min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-my-plugin-manager-detail-body { display:flex; flex-direction:column; gap:8px; padding:4px 6px; }
.dsh-my-plugin-manager-detail-meta { display:flex; flex-direction:column; gap:4px; }
.dsh-my-plugin-manager-detail-toolbar { display:flex; gap:8px; align-items:center; }
.dsh-my-plugin-manager-detail-version { height:24px; padding:0 6px; border-radius:5px; flex:none; border:1px solid var(--dsw-alias-border-l2);
  background:transparent; color:var(--dsw-alias-label-secondary); font:var(--dsw-font-xxs-12); }
.dsh-my-plugin-manager-detail-desc { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-secondary); line-height:1.6; }
.dsh-my-plugin-manager-detail-tags { display:flex; flex-wrap:wrap; gap:6px; }
.dsh-my-plugin-manager-detail-tag { display:inline-flex; align-items:center; padding:2px 6px; border-radius:4px; font:var(--dsw-font-xxxs-11);
  color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-plugin-manager-detail-tag-link { color:var(--dsw-alias-accent); text-decoration:none; }
.dsh-my-plugin-manager-detail-tag-link:hover { text-decoration:underline; }
.dsh-my-plugin-manager-detail-section { display:flex; flex-direction:column; gap:4px; }
.dsh-my-plugin-manager-detail-section-title { font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary);
  text-transform:uppercase; letter-spacing:.04em; }
.dsh-my-plugin-manager-readme-plain { margin:0; padding:8px 10px; border-radius:6px; border:1px solid var(--dsw-alias-border-l1);
  max-height:320px; overflow-y:auto; font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-secondary);
  white-space:pre-wrap; word-break:break-word; }
.dsh-my-plugin-manager-timeline { display:flex; flex-direction:column; gap:0; }
.dsh-my-plugin-manager-timeline-item { display:flex; align-items:center; gap:8px; padding:4px 0; position:relative; }
.dsh-my-plugin-manager-timeline-dot { flex:none; width:8px; height:8px; border-radius:50%; background:var(--dsw-alias-accent); }
.dsh-my-plugin-manager-timeline-version { flex:1; min-width:0; font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-primary);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-my-plugin-manager-timeline-date { flex:none; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); white-space:nowrap; }
.dsh-my-plugin-manager-deps { display:flex; flex-direction:column; gap:8px; }
.dsh-my-plugin-manager-deps-group { display:flex; flex-direction:column; gap:4px; }
.dsh-my-plugin-manager-deps-label { font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-secondary); }
.dsh-my-plugin-manager-deps-hint { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); line-height:1.6; }
.dsh-my-plugin-manager-dep-table { display:flex; flex-direction:column; gap:2px; }
.dsh-my-plugin-manager-dep-row { display:flex; align-items:center; gap:8px; padding:3px 6px; border-radius:4px;
  border:1px solid var(--dsw-alias-border-l1); font:var(--dsw-font-xxs-12); }
.dsh-my-plugin-manager-dep-row.dsh-my-plugin-manager-dep-missing { border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
.dsh-my-plugin-manager-dep-name { flex:1; min-width:0; color:var(--dsw-alias-label-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-my-plugin-manager-dep-spec { flex:none; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); white-space:nowrap; }
.dsh-my-plugin-manager-dep-missing-badge { flex:none; padding:1px 6px; border-radius:4px; font:var(--dsw-font-xxxs-strong-11);
  color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-plugin-manager-dep-empty { padding:4px 0; }
@keyframes dsh-my-plugin-manager-row-in { from { opacity:0; transform:translateY(1px); } to { opacity:1; transform:none; } }
`.trim()

const STYLE_TAG = 'data-dsh-my-plugin-manager'
