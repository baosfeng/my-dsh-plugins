// ── styles (DSH semantic tokens, injected on activate, removed on teardown) ──
// Visual language follows the dsh-file-activity baseline (issue #54): flat
// surfaces, hairline borders, 24px circular icon buttons with hover fills,
// 8px-radius rows with hover fills, dfa-op style badge chips, a role=switch
// toggle (track + sliding thumb, checked = success accent) and 150ms row
// entrance animations. All colors ride the --dsw-alias-* tokens; motion
// rides --ds-*.
const STYLES = `
.dsh-my-guardian-root { display:flex; flex-direction:column; gap:2px; padding:2px 6px 8px;
  font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); }
/* ── safe-mode bar: switch + title + hint; on = warn-tinted frame ────────── */
.dsh-my-guardian-safemode { display:flex; flex-direction:column; gap:2px; padding:6px 8px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1); background:transparent;
  transition:border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out), background var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-guardian-safemode-on { border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 6%, transparent); }
.dsh-my-guardian-safemode-head { display:flex; align-items:center; gap:6px; min-width:0; }
.dsh-my-guardian-safemode-icon { flex:none; display:flex; align-items:center; color:var(--dsw-alias-label-tertiary);
  transition:color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-guardian-safemode-on .dsh-my-guardian-safemode-icon { color:var(--dsw-alias-state-warn-primary); }
.dsh-my-guardian-safemode-title { flex:1; min-width:0; font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
.dsh-my-guardian-hint { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); line-height:1.7; }
/* ── switch (role=switch): track + sliding thumb, checked = enabled ────────
   Off = neutral grey track, on = success accent; both thumb and track
   transition on --ds-transition-duration-slow. */
.dsh-my-guardian-switch { flex:none; width:34px; height:20px; padding:0; border:none; background:transparent; cursor:pointer; }
.dsh-my-guardian-switch-track { display:block; width:34px; height:20px; border-radius:10px;
  background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 25%, transparent);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-guardian-switch-thumb { display:block; width:16px; height:16px; margin:2px; border-radius:50%;
  background:var(--dsw-alias-label-tertiary);
  transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out), background var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-guardian-switch-on .dsh-my-guardian-switch-track { background:var(--dsw-alias-state-success-primary); }
.dsh-my-guardian-switch-on .dsh-my-guardian-switch-thumb { transform:translateX(14px); background:var(--dsw-alias-label-primary-foreground); }
.dsh-my-guardian-switch:hover:not(:disabled) .dsh-my-guardian-switch-track { background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 40%, transparent); }
.dsh-my-guardian-switch:hover:not(:disabled).dsh-my-guardian-switch-on .dsh-my-guardian-switch-track { background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 85%, var(--dsw-alias-label-tertiary)); }
.dsh-my-guardian-switch:disabled { opacity:.4; cursor:default; }
/* ── load / error / empty states ────────────────────────────────────────── */
.dsh-my-guardian-loading { display:flex; align-items:center; gap:6px; padding:8px 6px;
  font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); }
.dsh-my-guardian-loading-icon { display:flex; flex:none; animation:dsh-my-guardian-spin 1s linear infinite; }
.dsh-my-guardian-error { display:flex; align-items:center; gap:6px; padding:6px 8px; border-radius:8px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  font:var(--dsw-font-xxs-12); color:var(--dsw-alias-state-error-primary); white-space:pre-wrap; word-break:break-all; line-height:1.7; }
.dsh-my-guardian-error-text { flex:1; min-width:0; }
.dsh-my-guardian-empty { display:flex; flex-direction:column; align-items:center; gap:4px; padding:16px 8px; text-align:center;
  font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); line-height:1.7; }
.dsh-my-guardian-empty-icon { display:flex; color:var(--dsw-alias-label-dimmed); }
.dsh-my-guardian-empty-hint { display:block; color:var(--dsw-alias-label-dimmed); font:var(--dsw-font-xxxs-11); }
/* ── entry list section ─────────────────────────────────────────────────── */
.dsh-my-guardian-section { display:flex; flex-direction:column; gap:2px; margin-top:4px; }
.dsh-my-guardian-section-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:2px 6px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary); text-transform:uppercase; letter-spacing:.04em; }
.dsh-my-guardian-section-title { font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary);
  text-transform:uppercase; letter-spacing:.04em; }
.dsh-my-guardian-section-count { font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary); }
.dsh-my-guardian-list { display:flex; flex-direction:column; gap:2px; }
.dsh-my-guardian-row { display:flex; flex-direction:column; gap:2px; padding:6px 8px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1); background:transparent;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out);
  animation:dsh-my-guardian-row-in 150ms var(--ds-ease-in-out); }
.dsh-my-guardian-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-guardian-row-head { display:flex; align-items:center; gap:6px; min-width:0; }
.dsh-my-guardian-source { flex:none; display:inline-flex; align-items:center; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary); background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-guardian-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
/* status badge chips, mirroring the dfa-op style */
.dsh-my-guardian-badge { flex:none; display:inline-flex; align-items:center; justify-content:center; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); }
.dsh-my-guardian-badge-running { color:var(--dsw-alias-state-success-primary); background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); }
.dsh-my-guardian-badge-pending { color:var(--dsw-alias-accent); background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent); }
.dsh-my-guardian-badge-failed { color:var(--dsw-alias-state-error-primary); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
.dsh-my-guardian-badge-frozen { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
/* failure-classification badge chips (issue #86): dependency / code / other */
.dsh-my-guardian-category { flex:none; display:inline-flex; align-items:center; justify-content:center; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); }
.dsh-my-guardian-category-dependency { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-guardian-category-code { color:var(--dsw-alias-state-error-primary); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.dsh-my-guardian-category-other { color:var(--dsw-alias-label-tertiary); background:var(--dsw-alias-interactive-bg-hover); }
/* install-suggestion line for dependency failures */
.dsh-my-guardian-install-hint { display:flex; align-items:center; gap:5px; padding:3px 6px; border-radius:6px;
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 6%, transparent);
  font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); }
.dsh-my-guardian-install-hint-label { flex:none; color:var(--dsw-alias-label-tertiary); }
.dsh-my-guardian-install-hint code { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:var(--dsw-font-xxxs-11);
  color:var(--dsw-alias-state-success-primary); word-break:break-all; }
.dsh-my-guardian-row-meta { display:flex; align-items:center; gap:6px; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); }
.dsh-my-guardian-attempts { color:var(--dsw-alias-state-error-primary); }
.dsh-my-guardian-freeze-hint { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-state-warn-primary); line-height:1.6; }
.dsh-my-guardian-link { display:inline-flex; align-items:center; gap:3px; padding:0; border:none; background:transparent; cursor:pointer;
  font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary);
  transition:color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-guardian-link svg { display:block; flex:none; }
.dsh-my-guardian-link:hover { color:var(--dsw-alias-state-error-primary); }
.dsh-my-guardian-error-detail { white-space:pre-wrap; word-break:break-all; font:var(--dsw-font-xxs-12); margin:2px 0 0; padding:4px 6px; border-radius:6px;
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); color:var(--dsw-alias-state-error-primary);
  max-height:120px; overflow:auto; }
/* ── inline remove confirmation (destructive, red) ───────────────────────── */
.dsh-my-guardian-confirm { display:flex; flex-direction:column; gap:6px; padding:8px 10px; border-radius:8px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 6%, transparent);
  animation:dsh-my-guardian-row-in 150ms var(--ds-ease-in-out); }
.dsh-my-guardian-confirm-head { display:flex; align-items:center; gap:6px; }
.dsh-my-guardian-confirm-head svg { display:block; flex:none; }
.dsh-my-guardian-confirm-text { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-primary); }
.dsh-my-guardian-confirm-desc { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); line-height:1.7; }
.dsh-my-guardian-confirm-actions { display:flex; gap:6px; align-items:center; }
.dsh-my-guardian-confirm-ok { display:inline-flex; align-items:center; gap:5px; height:26px; padding:0 12px; border-radius:6px; cursor:pointer;
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
  color:var(--dsw-alias-state-error-primary); font:var(--dsw-font-xxs-12);
  transition:filter var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-guardian-confirm-ok svg { display:block; flex:none; }
.dsh-my-guardian-confirm-ok:hover { filter:brightness(1.1); }
.dsh-my-guardian-confirm-cancel { display:inline-flex; align-items:center; gap:5px; height:26px; padding:0 12px; border-radius:6px; cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1); background:transparent; color:var(--dsw-alias-label-secondary); font:var(--dsw-font-xxs-12);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-guardian-confirm-cancel svg { display:block; flex:none; }
.dsh-my-guardian-confirm-cancel:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
/* ── row actions: circular icon buttons (danger hover for remove) ───────── */
.dsh-my-guardian-actions { display:flex; align-items:center; gap:2px; }
.dsh-my-guardian-iconbtn { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0;
  border:none; border-radius:50%; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; flex:none;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-guardian-iconbtn svg { display:block; }
.dsh-my-guardian-iconbtn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.dsh-my-guardian-iconbtn:disabled { opacity:.4; cursor:default; }
.dsh-my-guardian-iconbtn-danger:hover:not(:disabled) { color:var(--dsw-alias-state-error-primary); }
.dsh-my-guardian-iconbtn-success:hover:not(:disabled) { color:var(--dsw-alias-state-success-primary); }
.dsh-my-guardian-iconbtn-xs { width:20px; height:20px; }
/* ── event log: badge + key info + time, mirroring the dfa-op chips ─────── */
.dsh-my-guardian-events { display:flex; flex-direction:column; gap:2px; margin-top:4px; }
.dsh-my-guardian-events-title { display:flex; align-items:center; gap:5px; padding:2px 6px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary); text-transform:uppercase; letter-spacing:.04em; }
.dsh-my-guardian-events-title svg { display:block; flex:none; }
.dsh-my-guardian-event { display:flex; align-items:center; gap:6px; padding:3px 6px; border-radius:6px;
  animation:dsh-my-guardian-row-in 150ms var(--ds-ease-in-out); }
.dsh-my-guardian-event:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-guardian-event-badge { flex:none; display:inline-flex; align-items:center; justify-content:center; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); }
.dsh-my-guardian-event-success { color:var(--dsw-alias-state-success-primary); background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); }
.dsh-my-guardian-event-accent { color:var(--dsw-alias-accent); background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent); }
.dsh-my-guardian-event-danger { color:var(--dsw-alias-state-error-primary); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
.dsh-my-guardian-event-warn { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-guardian-event-neutral { color:var(--dsw-alias-label-tertiary); background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-guardian-event-message { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-secondary); }
.dsh-my-guardian-event-time { flex:none; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); white-space:nowrap; }
/* ── startup-roster issues (issue #144): pinned block above the list ────── */
.dsh-my-guardian-startup-issues { display:flex; flex-direction:column; gap:2px; margin-top:4px; padding:6px 8px; border-radius:8px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 6%, transparent);
  animation:dsh-my-guardian-row-in 150ms var(--ds-ease-in-out); }
.dsh-my-guardian-startup-issues-title { display:flex; align-items:center; gap:5px; padding:0 2px 3px;
  font:var(--dsw-font-xxs-strong-12); color:var(--dsw-alias-state-error-primary); }
.dsh-my-guardian-startup-issues-title svg { display:block; flex:none; }
.dsh-my-guardian-startup-issues-count { display:inline-flex; align-items:center; justify-content:center; min-width:17px; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-primary-foreground); background:var(--dsw-alias-state-error-primary); }
.dsh-my-guardian-startup-issues-time { flex:1; text-align:right; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); }
.dsh-my-guardian-startup-issue { display:flex; flex-direction:column; gap:2px; padding:5px 6px; border-radius:6px;
  border:1px solid var(--dsw-alias-border-l1); background:transparent; }
.dsh-my-guardian-startup-issue:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-guardian-startup-issue-head { display:flex; align-items:center; gap:6px; min-width:0; }
.dsh-my-guardian-startup-issue-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
.dsh-my-guardian-startup-issue-badge-unresolvable { color:var(--dsw-alias-state-error-primary); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
.dsh-my-guardian-startup-issue-badge-duplicate-id { color:var(--dsw-alias-state-error-primary); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
.dsh-my-guardian-startup-issue-badge-dependency { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-guardian-startup-issue-message { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-secondary); line-height:1.6; }
.dsh-my-guardian-startup-issue-line { display:flex; align-items:flex-start; gap:5px; padding:2px 0;
  font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); line-height:1.6; min-width:0; }
.dsh-my-guardian-startup-issue-label { flex:none; color:var(--dsw-alias-label-tertiary); }
.dsh-my-guardian-startup-issue-line code { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:var(--dsw-font-xxxs-11);
  color:var(--dsw-alias-state-success-primary); word-break:break-all; }
.dsh-my-guardian-startup-issue-remove { min-width:0; word-break:break-all; }
@keyframes dsh-my-guardian-row-in { from { opacity:0; transform:translateY(1px); } to { opacity:1; transform:none; } }
@keyframes dsh-my-guardian-spin { to { transform:rotate(360deg); } }
`
