/**
 * dsh-my-guardian — client half (browser). SOURCE TEMPLATE.
 *
 * A dsh-better-sidebar tab ("插件守护 / Plugin Guardian") showing the staged
 * and promoted plugin entries managed by the server half:
 *  - per-entry status (running / pending / failed ×N / frozen),
 *  - the last error for failed entries (expandable),
 *  - actions: retry (unfreeze + remount), remove from the roster,
 *  - a safe-mode switch that unmounts everything the guardian mounted.
 *
 * Data source: GET/POST /guardian/api/* (server half), polled while the tab
 * is visible. Styling follows the better-sidebar design language: DSH
 * semantic tokens, flat surfaces, hairline borders.
 *
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs splices the
 * `lib/parts/*.part.js` pieces into the PART placeholder markers below
 * (each piece is plain function-declaration text sharing this factory scope;
 * the browser ModuleLoader does not support relative-path require) and writes
 * lib/client.js — the file actually served by DSH, which MUST be committed
 * (CI runs node --check + tests against it, not against this template).
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-guardian',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    const TAB_ID = 'dsh-my-guardian:panel'
    const POLL_MS = 5000

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
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

    // ── i18n ──────────────────────────────────────────────────────────────
function isZh() {
  try {
    return (navigator.language || 'en').toLowerCase().startsWith('zh')
  } catch {
    return false
  }
}

const strings = {
  title: () => (isZh() ? '插件守护' : 'Plugin Guardian'),
  safeMode: () => (isZh() ? '安全模式' : 'Safe mode'),
  safeModeDesc: () =>
    isZh()
      ? '开启后所有候选/已转正插件（候选区 cordis.staged.json 中的条目）都不再加载，用于快速恢复环境。注意：安全模式只作用于启动后挂载的候选插件；若插件直接写进启动名册（cordis.patch.yml / profile），DSH 启动时仍是 all-or-nothing——请把新插件先放进候选区。'
      : 'Skips every staged/promoted plugin mount — fast recovery. Note: this only covers entries mounted after boot (cordis.staged.json); plugins in the boot roster (cordis.patch.yml / profile) are still all-or-nothing — put new plugins in the staged file first.',
  staged: () => (isZh() ? '候选' : 'staged'),
  promoted: () => (isZh() ? '转正' : 'promoted'),
  entries: () => (isZh() ? '插件条目' : 'Plugin entries'),
  empty: () => (isZh() ? '暂无候选插件' : 'No staged plugins'),
  emptyHint: () =>
    isZh()
      ? '新插件请写入 cordis.staged.json（与 cordis.patch.yml 同目录），启动后自动加载'
      : 'Add entries to cordis.staged.json next to cordis.patch.yml — they load on startup',
  running: () => (isZh() ? '运行中' : 'running'),
  pending: () => (isZh() ? '待加载' : 'pending'),
  failed: () => (isZh() ? '失败' : 'failed'),
  frozen: () => (isZh() ? '冻结' : 'frozen'),
  retry: () => (isZh() ? '重试' : 'Retry'),
  remove: () => (isZh() ? '移除' : 'Remove'),
  removeConfirm: () => (isZh() ? '移除该插件条目？' : 'Remove this plugin entry?'),
  removeConfirmDesc: () =>
    isZh()
      ? '将从名册中卸载并移除，候选区文件不受影响'
      : 'Unmounts and drops it from the roster; the staged file is untouched',
  cancel: () => (isZh() ? '取消' : 'Cancel'),
  confirmRemove: () => (isZh() ? '确认移除' : 'Remove'),
  expandError: () => (isZh() ? '错误详情' : 'Error details'),
  collapseError: () => (isZh() ? '收起' : 'Collapse'),
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  events: () => (isZh() ? '最近事件' : 'Recent events'),
  attempts: (n) => (isZh() ? `失败 ${n} 次` : `failed ×${n}`),
  frozenHint: () =>
    isZh()
      ? '已冻结：连续失败停止自动重试——点击刷新按钮手动重试，或移除该条目'
      : 'Frozen: auto-retry stopped after repeated failures — retry manually or remove the entry',
  failureDependency: () => (isZh() ? '依赖缺失' : 'Dependency'),
  failureCode: () => (isZh() ? '代码错误' : 'Code error'),
  failureOther: () => (isZh() ? '其他' : 'Other'),
  installHint: () => (isZh() ? '安装建议' : 'Install'),
  // ── startup-roster issues (issue #144) ─────────────────────────────────
  startupIssues: () => (isZh() ? '启动区问题' : 'Startup roster issues'),
  startupIssueFix: () => (isZh() ? '修复' : 'Fix'),
  startupIssueRemove: () => (isZh() ? '移除' : 'Remove'),
  startupIssueUnresolvable: () => (isZh() ? '包不可解析' : 'Unresolvable'),
  startupIssueDependency: () => (isZh() ? '依赖缺失' : 'Dependency'),
  startupIssueDuplicate: () => (isZh() ? '重复 id' : 'Duplicate id'),
}

// ── api ───────────────────────────────────────────────────────────────
async function api(path, body) {
  const response = await fetch(
    `/guardian/api/${path}`,
    body === undefined
      ? { headers: { accept: 'application/json' } }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  const payload = await response.json().catch(() => ({ ok: false, error: { message: 'bad response' } }))
  if (!payload.ok) throw new Error(payload.error?.message ?? 'request failed')
  return payload.value
}

function formatTime(time) {
  if (typeof time !== 'number' || !Number.isFinite(time)) return ''
  const date = new Date(time)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function statusLabel(status) {
  switch (status) {
    case 'running':
      return strings.running()
    case 'pending':
      return strings.pending()
    case 'failed':
      return strings.failed()
    case 'frozen':
      return strings.frozen()
    default:
      return status
  }
}

/** Failure-classification badge label (issue #86): dependency / code / other. */
function failureTypeLabel(type) {
  switch (type) {
    case 'dependency':
      return strings.failureDependency()
    case 'code':
      return strings.failureCode()
    case 'other':
      return strings.failureOther()
    default:
      return type
  }
}

// ── event log ─────────────────────────────────────────────────────────
// Event type → badge label + color variant (mirrors the dfa-op chip style).
const EVENT_LABELS = {
  promote: () => (isZh() ? '转正' : 'Promoted'),
  'entry-init': () => (isZh() ? '初始化' : 'Init'),
  'entry-dispose': () => (isZh() ? '释放' : 'Disposed'),
  quarantine: () => (isZh() ? '隔离' : 'Quarantined'),
  freeze: () => (isZh() ? '冻结' : 'Frozen'),
  'update-failed': () => (isZh() ? '更新失败' : 'Update failed'),
  safe: () => (isZh() ? '安全模式' : 'Safe mode'),
  'safe-mode': () => (isZh() ? '安全模式' : 'Safe mode'),
  skip: () => (isZh() ? '跳过' : 'Skipped'),
  'startup-issue': () => (isZh() ? '启动区问题' : 'Startup issue'),
}

/** Badge color variant for an event type; unknown types fall back to the
 *  neutral tertiary chip. */
function eventVariant(type) {
  switch (type) {
    case 'promote':
      return 'success'
    case 'entry-init':
      return 'accent'
    case 'quarantine':
    case 'update-failed':
    case 'startup-issue':
      return 'danger'
    case 'freeze':
    case 'safe':
    case 'safe-mode':
      return 'warn'
    default:
      return 'neutral'
  }
}

/** Startup-issue badge label (issue #144): unresolvable / dependency / dup. */
function startupIssueLabel(type) {
  switch (type) {
    case 'unresolvable':
      return strings.startupIssueUnresolvable()
    case 'dependency':
      return strings.startupIssueDependency()
    case 'duplicate-id':
      return strings.startupIssueDuplicate()
    default:
      return type
  }
}

function eventLabel(type) {
  return (EVENT_LABELS[type] ?? (() => type))()
}

    // ── shared icons (inline, stroke=currentColor, matching better-sidebar) ──
// Single source of truth for the plugin UI icon set (issue #54 阶段 0).
// Extracted from dsh-file-activity's lib/parts/icons.part.js; every plugin's
// scripts/build.mjs splices this file via the `shared: true` piece marker.
// Keep the stroke=currentColor outline style — it inherits the surrounding
// text color and reads on both light and dark themes.
const ICON_STROKE = 1.8
const iconSvg = (children, size) =>
  createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: ICON_STROKE,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    children.map((child, i) =>
      child === null || child === undefined || typeof child === 'boolean'
        ? child
        : createElement(child.type, { key: i, ...child.props }),
    ),
  )

const icon = {
  clock: (size = 16) =>
    iconSvg([createElement('circle', { cx: 12, cy: 12, r: 9 }), createElement('path', { d: 'M12 7v5l3 2' })], size),
  refresh: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
        createElement('polyline', { points: '21 3 21 9 15 9' }),
      ],
      size,
    ),
  trash: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M3 6h18' }),
        createElement('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }),
        createElement('path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }),
      ],
      size,
    ),
  chevronRight: (size = 14) => iconSvg([createElement('polyline', { points: '9 6 15 12 9 18' })], size),
  chevronDown: (size = 14) => iconSvg([createElement('polyline', { points: '6 9 12 15 18 9' })], size),
  file: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
        createElement('path', { d: 'M14 2v6h6' }),
      ],
      size,
    ),
  folder: (size = 16) =>
    iconSvg(
      [
        createElement('path', {
          d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
        }),
      ],
      size,
    ),
  external: (size = 15) =>
    iconSvg(
      [
        createElement('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
        createElement('polyline', { points: '15 3 21 3 21 9' }),
        createElement('line', { x1: 10, y1: 14, x2: 21, y2: 3 }),
      ],
      size,
    ),
  close: (size = 15) =>
    iconSvg(
      [
        createElement('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
        createElement('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
      ],
      size,
    ),
  help: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 12, cy: 12, r: 9 }),
        createElement('path', { d: 'M9.1 9.2a3 3 0 0 1 5.8 1.2c0 1.8-2.7 2.4-2.7 3.6' }),
        createElement('line', { x1: 12, y1: 17.2, x2: 12.01, y2: 17.2 }),
      ],
      size,
    ),
  // ── generic action icons (issue #54 阶段 0) ─────────────────────────────
  // Added for the upcoming plugin UI refresh: save/confirm (check), add/
  // install (plus), market search (search), settings entry (settings).
  check: (size = 16) => iconSvg([createElement('polyline', { points: '20 6 9 17 4 12' })], size),
  plus: (size = 16) =>
    iconSvg(
      [
        createElement('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
        createElement('line', { x1: 5, y1: 12, x2: 19, y2: 12 }),
      ],
      size,
    ),
  pencil: (size = 15) =>
    iconSvg([createElement('path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' })], size),
  search: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 11, cy: 11, r: 8 }),
        createElement('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }),
      ],
      size,
    ),
  settings: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 12, cy: 12, r: 3 }),
        createElement('path', {
          d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
        }),
      ],
      size,
    ),
  // 警告（issue #54 阶段 1 新增）：安全护栏告警类型图标（投毒/提示注入），
  // 三角警示 + 感叹号，stroke=currentColor 风格与其余图标一致。
  alert: (size = 16) =>
    iconSvg(
      [
        createElement('path', {
          d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
        }),
        createElement('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
        createElement('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }),
      ],
      size,
    ),
  // 代码（issue #54 阶段 1 新增）：尖括号 `</>`，预览/代码切换的代码视图
  // 图标（dsh-mermaid-render 卡片），stroke=currentColor 风格与其余图标一致。
  code: (size = 16) =>
    iconSvg(
      [
        createElement('polyline', { points: '16 18 22 12 16 6' }),
        createElement('polyline', { points: '8 6 2 12 8 18' }),
      ],
      size,
    ),
  // 下载（issue #85 新增）：箭头入托盘，图表导出按钮（dsh-mermaid-render
  // 卡片下载 PNG/SVG），stroke=currentColor 风格与其余图标一致。
  download: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
        createElement('polyline', { points: '7 10 12 15 17 10' }),
        createElement('line', { x1: 12, y1: 15, x2: 12, y2: 3 }),
      ],
      size,
    ),
  // 复制（issue #85 新增）：双层矩形，复制源码按钮（dsh-mermaid-render
  // 卡片复制代码），stroke=currentColor 风格与其余图标一致。
  copy: (size = 16) =>
    iconSvg(
      [
        createElement('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
        createElement('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
      ],
      size,
    ),
}

// Common-language / file-type badges (issue #24): brand fill + contrast
// ink, reading on both light and dark themes. Unmapped extensions keep the
// neutral currentColor file icon above. [bg, fg ink, short mark]
const FILE_BADGES = {
  // JavaScript / TypeScript
  js: ['#F7DF1E', '#323330', 'JS'],
  mjs: ['#F7DF1E', '#323330', 'JS'],
  cjs: ['#F7DF1E', '#323330', 'JS'],
  ts: ['#3178C6', '#ffffff', 'TS'],
  mts: ['#3178C6', '#ffffff', 'TS'],
  cts: ['#3178C6', '#ffffff', 'TS'],
  tsx: ['#3178C6', '#ffffff', 'TSX'],
  jsx: ['#3178C6', '#ffffff', 'JSX'],
  // 后端语言
  java: ['#007396', '#ffffff', 'JAVA'],
  c: ['#A8B9CC', '#111111', 'C'],
  cpp: ['#00599C', '#ffffff', 'C++'],
  cxx: ['#00599C', '#ffffff', 'C++'],
  cc: ['#00599C', '#ffffff', 'C++'],
  hpp: ['#00599C', '#ffffff', 'C++'],
  h: ['#A8B9CC', '#111111', 'H'],
  hh: ['#A8B9CC', '#111111', 'H'],
  cs: ['#68217A', '#ffffff', 'C#'],
  csharp: ['#68217A', '#ffffff', 'C#'],
  go: ['#00ADD8', '#ffffff', 'GO'],
  rs: ['#CE422B', '#ffffff', 'RS'],
  rb: ['#B51624', '#ffffff', 'RB'],
  php: ['#777BB4', '#ffffff', 'PHP'],
  py: ['#3776AB', '#ffffff', 'PY'],
  swift: ['#F05138', '#ffffff', 'SWIFT'],
  kt: ['#7F52FF', '#ffffff', 'KT'],
  kotlin: ['#7F52FF', '#ffffff', 'KT'],
  dart: ['#0175C2', '#ffffff', 'DART'],
  scala: ['#DC322F', '#ffffff', 'SCALA'],
  lua: ['#2C2C7C', '#ffffff', 'LUA'],
  pl: ['#0298C3', '#ffffff', 'PERL'],
  r: ['#336DC3', '#ffffff', 'R'],
  m: ['#C1272D', '#ffffff', 'MAT'],
  mm: ['#C1272D', '#ffffff', 'MAT'],
  // Web / 前端
  html: ['#E34F26', '#ffffff', '</>'],
  htm: ['#E34F26', '#ffffff', '</>'],
  css: ['#663399', '#ffffff', 'CSS'],
  scss: ['#CD6799', '#ffffff', 'SCSS'],
  sass: ['#CD6799', '#ffffff', 'SCSS'],
  vue: ['#42B883', '#ffffff', 'VUE'],
  svelte: ['#FF3E00', '#ffffff', 'SVELTE'],
  // 数据 / 结构化
  json: ['#F7DF1E', '#323330', '{}'],
  sql: ['#00758F', '#ffffff', 'SQL'],
  csv: ['#2E7D32', '#ffffff', 'CSV'],
  db: ['#0F62FE', '#ffffff', 'DB'],
  sqlite: ['#0F62FE', '#ffffff', 'DB'],
  sqlite3: ['#0F62FE', '#ffffff', 'DB'],
  xml: ['#FF6F00', '#ffffff', 'XML'],
  svg: ['#FF6F00', '#ffffff', 'SVG'],
  // 文档
  md: ['#42A5F5', '#ffffff', 'M↓'],
  markdown: ['#42A5F5', '#ffffff', 'M↓'],
  txt: ['#90A4AE', '#ffffff', 'TXT'],
  text: ['#90A4AE', '#ffffff', 'TXT'],
  log: ['#90A4AE', '#ffffff', 'TXT'],
  pdf: ['#E5202B', '#ffffff', 'PDF'],
  doc: ['#2B579A', '#ffffff', 'DOC'],
  docx: ['#2B579A', '#ffffff', 'DOC'],
  xls: ['#217346', '#ffffff', 'XLS'],
  xlsx: ['#217346', '#ffffff', 'XLS'],
  ppt: ['#D24726', '#ffffff', 'PPT'],
  pptx: ['#D24726', '#ffffff', 'PPT'],
  // 配置 / 构建
  yml: ['#CB171E', '#ffffff', 'YML'],
  yaml: ['#CB171E', '#ffffff', 'YML'],
  toml: ['#8D6E63', '#ffffff', 'TOML'],
  ini: ['#546E7A', '#ffffff', 'CFG'],
  cfg: ['#546E7A', '#ffffff', 'CFG'],
  config: ['#546E7A', '#ffffff', 'CFG'],
  env: ['#F9A825', '#323330', 'ENV'],
  properties: ['#7B1FA2', '#ffffff', 'PROP'],
  lock: ['#37474F', '#ffffff', 'LOCK'],
  dockerfile: ['#2496ED', '#ffffff', 'DOCK'],
  docker: ['#2496ED', '#ffffff', 'DOCK'],
  makefile: ['#607D8B', '#ffffff', 'MAKE'],
  gradle: ['#02303A', '#ffffff', 'GRADLE'],
  cmake: ['#265774', '#ffffff', 'CMAKE'],
  ipynb: ['#F37726', '#ffffff', 'JNB'],
  // 脚本 / Shell
  sh: ['#89E051', '#111111', '>_'],
  bash: ['#89E051', '#111111', '>_'],
  zsh: ['#89E051', '#111111', '>_'],
  ps1: ['#012456', '#ffffff', 'PS1'],
  bat: ['#546E7A', '#ffffff', 'CMD'],
  cmd: ['#546E7A', '#ffffff', 'CMD'],
  // 打包 / 二进制
  zip: ['#FFA726', '#323330', 'ZIP'],
  tar: ['#FFA726', '#323330', 'ZIP'],
  gz: ['#FFA726', '#323330', 'ZIP'],
  '7z': ['#FFA726', '#323330', 'ZIP'],
  rar: ['#FFA726', '#323330', 'ZIP'],
  exe: ['#0078D4', '#ffffff', 'EXE'],
  msi: ['#0078D4', '#ffffff', 'EXE'],
  wasm: ['#654FF0', '#ffffff', 'WASM'],
  // 图片 / 媒体
  png: ['#8E44AD', '#ffffff', 'IMG'],
  jpg: ['#8E44AD', '#ffffff', 'IMG'],
  jpeg: ['#8E44AD', '#ffffff', 'IMG'],
  gif: ['#8E44AD', '#ffffff', 'IMG'],
  webp: ['#8E44AD', '#ffffff', 'IMG'],
  ico: ['#8E44AD', '#ffffff', 'IMG'],
  bmp: ['#8E44AD', '#ffffff', 'IMG'],
  // 版本控制
  gitignore: ['#F05032', '#ffffff', 'GIT'],
  gitattributes: ['#F05032', '#ffffff', 'GIT'],
}

/** One self-colored badge svg: rounded brand rect + short contrast mark.
 *  Mark font scales by length so 5-6 char marks (JAVA/SCALA/SWIFT) stay
 *  inside the 24×24 viewBox. */
const badgeIcon = ([bg, fg, mark], size) =>
  createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
    },
    createElement('rect', { x: 1, y: 1, width: 22, height: 22, rx: 5, fill: bg }),
    createElement(
      'text',
      {
        x: 12,
        y: 16,
        textAnchor: 'middle',
        fontSize: mark.length <= 2 ? 9 : mark.length <= 4 ? 7 : 5.5,
        fontWeight: 700,
        fill: fg,
      },
      mark,
    ),
  )

/** File-type icon dispatcher: branded badge for known extensions, the
 *  neutral file icon for everything else (case-insensitive, tolerates a
 *  leading dot like ".md"). */
const fileIconByExt = (ext, size = 14) => {
  const spec =
    FILE_BADGES[
      String(ext ?? '')
        .toLowerCase()
        .replace(/^\./, '')
    ]
  return spec === undefined ? icon.file(size) : badgeIcon(spec, size)
}

    // ── row ────────────────────────────────────────────────────────────────
/** Row head: source chip + name + status badge + failure-category badge. */
function RowHead({ entry, source }) {
  return createElement(
    'div',
    { className: 'dsh-my-guardian-row-head' },
    createElement(
      'span',
      { className: 'dsh-my-guardian-source' },
      source === 'staged' ? strings.staged() : strings.promoted(),
    ),
    createElement('span', { className: 'dsh-my-guardian-name', title: entry.id }, entry.name),
    createElement(
      'span',
      { className: `dsh-my-guardian-badge dsh-my-guardian-badge-${entry.status}` },
      statusLabel(entry.status),
    ),
    typeof entry.failureType === 'string' && entry.failureType !== ''
      ? createElement(
          'span',
          {
            className: `dsh-my-guardian-category dsh-my-guardian-category-${entry.failureType}`,
            title: entry.failureType,
          },
          failureTypeLabel(entry.failureType),
        )
      : null,
  )
}

/** Row meta: entry id + failure attempts + last failure time. */
function RowMeta({ entry }) {
  return createElement(
    'div',
    { className: 'dsh-my-guardian-row-meta' },
    createElement('span', null, entry.id),
    entry.attempts > 0
      ? createElement('span', { className: 'dsh-my-guardian-attempts' }, strings.attempts(entry.attempts))
      : null,
    typeof entry.lastFailedAt === 'number' && Number.isFinite(entry.lastFailedAt)
      ? createElement('span', null, formatTime(entry.lastFailedAt))
      : null,
  )
}

/** Expandable error-detail toggle (chevron + label). */
function ErrorToggle({ expanded, onToggle }) {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-guardian-link',
      onClick: onToggle,
    },
    expanded ? icon.chevronDown(12) : icon.chevronRight(12),
    expanded ? strings.collapseError() : strings.expandError(),
  )
}

/** Inline remove confirmation (destructive, red). */
function RemoveConfirm({ busy, onConfirm, onCancel }) {
  return createElement(
    'div',
    { className: 'dsh-my-guardian-confirm' },
    createElement(
      'div',
      { className: 'dsh-my-guardian-confirm-head' },
      icon.trash(15),
      createElement('div', { className: 'dsh-my-guardian-confirm-text' }, strings.removeConfirm()),
    ),
    createElement('div', { className: 'dsh-my-guardian-confirm-desc' }, strings.removeConfirmDesc()),
    createElement(
      'div',
      { className: 'dsh-my-guardian-confirm-actions' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-guardian-confirm-ok',
          disabled: busy,
          onClick: onConfirm,
        },
        icon.trash(14),
        strings.confirmRemove(),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-guardian-confirm-cancel',
          disabled: busy,
          onClick: onCancel,
        },
        icon.close(14),
        strings.cancel(),
      ),
    ),
  )
}

/** Row actions: retry (refresh) + remove (trash) circular icon buttons. */
function RowActions({ entry, busy, onRetry, onRemove }) {
  return createElement(
    'div',
    { className: 'dsh-my-guardian-actions' },
    entry.status === 'failed' || entry.status === 'frozen'
      ? createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-guardian-iconbtn dsh-my-guardian-iconbtn-success',
            'aria-label': strings.retry(),
            title: strings.retry(),
            disabled: busy,
            onClick: onRetry,
          },
          icon.refresh(15),
        )
      : null,
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-guardian-iconbtn dsh-my-guardian-iconbtn-danger',
        'aria-label': strings.remove(),
        title: strings.remove(),
        disabled: busy,
        onClick: onRemove,
      },
      icon.trash(15),
    ),
  )
}

/** 冻结行提示（连败停止自动重试，需手动操作）。 */
function FrozenHint({ status }) {
  if (status !== 'frozen') return null
  return createElement('div', { className: 'dsh-my-guardian-freeze-hint' }, strings.frozenHint())
}

function EntryRow({ entry, source, onAction }) {
  // 失败/冻结行默认展开错误详情（用户之前必须手动点开才看得到真正报错）。
  const [expanded, setExpanded] = useState(
    () =>
      typeof entry.lastError === 'string' &&
      entry.lastError !== '' &&
      (entry.status === 'failed' || entry.status === 'frozen'),
  )
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const hasError = typeof entry.lastError === 'string' && entry.lastError !== ''
  const isDepFailure = entry.failureType === 'dependency'
  const installHint =
    isDepFailure && typeof entry.installHint === 'string' && entry.installHint !== '' ? entry.installHint : null

  const run = (kind) => {
    setBusy(true)
    Promise.resolve(onAction(kind, entry)).finally(() => setBusy(false))
  }

  return createElement(
    'div',
    { className: 'dsh-my-guardian-row' },
    createElement(RowHead, { entry, source }),
    createElement(RowMeta, { entry }),
    createElement(FrozenHint, { status: entry.status }),
    installHint
      ? createElement(
          'div',
          { className: 'dsh-my-guardian-install-hint' },
          createElement('span', { className: 'dsh-my-guardian-install-hint-label' }, strings.installHint()),
          createElement('code', null, installHint),
        )
      : null,
    hasError ? createElement(ErrorToggle, { expanded, onToggle: () => setExpanded(!expanded) }) : null,
    expanded && hasError ? createElement('pre', { className: 'dsh-my-guardian-error-detail' }, entry.lastError) : null,
    confirming
      ? createElement(RemoveConfirm, {
          busy,
          onConfirm: () => {
            setConfirming(false)
            run('remove')
          },
          onCancel: () => setConfirming(false),
        })
      : null,
    createElement(RowActions, {
      entry,
      busy,
      onRetry: () => run('retry'),
      onRemove: () => setConfirming(true),
    }),
  )
}

    // ── view ───────────────────────────────────────────────────────────────
/** State + data loading + user actions for the panel. Polls /guardian/api
 *  while the tab is visible; actions re-fetch on success, flag the load
 *  error banner on failure. */
function useGuardianState(visible) {
  const [state, setState] = useState({
    safeMode: false,
    staged: [],
    promoted: [],
    events: [],
    loaded: false,
  })
  const [loadFailed, setLoadFailed] = useState(false)

  const load = () => {
    api('state')
      .then((value) => {
        setState({ ...value, loaded: true })
        setLoadFailed(false)
      })
      .catch(() => setLoadFailed(true))
  }

  useEffect(() => {
    load()
    if (visible === false) return
    const timer = window.setInterval(load, POLL_MS)
    return () => window.clearInterval(timer)
  }, [visible])

  const onAction = (kind, entry) => {
    const request = { id: entry.id }
    const path = kind === 'retry' ? 'retry' : 'remove'
    return api(path, request)
      .then(() => load())
      .catch(() => setLoadFailed(true))
  }

  const onSafeMode = (enabled) => {
    api('safemode', { enabled })
      .then(() => load())
      .catch(() => setLoadFailed(true))
  }

  return { state, loadFailed, reload: load, onAction, onSafeMode }
}

/** Visual switch (role=switch): track + sliding thumb, checked = enabled.
 *  Semantics match the previous checkbox exactly: clicking reports the NEW
 *  checked state via onToggle. */
function Switch({ checked, disabled, label, onToggle }) {
  return createElement(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': label,
      className: `dsh-my-guardian-switch${checked ? ' dsh-my-guardian-switch-on' : ''}`,
      disabled,
      onClick: onToggle,
    },
    createElement(
      'span',
      { className: 'dsh-my-guardian-switch-track' },
      createElement('span', { className: 'dsh-my-guardian-switch-thumb' }),
    ),
  )
}

/** Safe-mode switch bar: icon + title + switch + hint, wired to the host API. */
function SafeModeBar({ safeMode, onSafeMode }) {
  return createElement(
    'div',
    { className: `dsh-my-guardian-safemode${safeMode ? ' dsh-my-guardian-safemode-on' : ''}` },
    createElement(
      'div',
      { className: 'dsh-my-guardian-safemode-head' },
      createElement('span', { className: 'dsh-my-guardian-safemode-icon' }, icon.settings(16)),
      createElement('span', { className: 'dsh-my-guardian-safemode-title' }, strings.safeMode()),
      createElement(Switch, {
        checked: safeMode === true,
        label: strings.safeMode(),
        onToggle: () => onSafeMode(!safeMode),
      }),
    ),
    createElement('div', { className: 'dsh-my-guardian-hint' }, strings.safeModeDesc()),
  )
}

/** Staged + promoted entries as rows; empty state when there are none. */
function EntryList({ rows, onAction }) {
  if (rows.length === 0) {
    return createElement(
      'div',
      { className: 'dsh-my-guardian-empty' },
      createElement('span', { className: 'dsh-my-guardian-empty-icon' }, icon.folder(20)),
      strings.empty(),
      createElement('span', { className: 'dsh-my-guardian-empty-hint' }, strings.emptyHint()),
    )
  }
  return createElement(
    'div',
    { className: 'dsh-my-guardian-section' },
    createElement(
      'div',
      { className: 'dsh-my-guardian-section-head' },
      createElement('span', { className: 'dsh-my-guardian-section-title' }, strings.entries()),
      createElement('span', { className: 'dsh-my-guardian-section-count' }, String(rows.length)),
    ),
    createElement(
      'div',
      { className: 'dsh-my-guardian-list' },
      rows.map(({ entry, source }) =>
        createElement(EntryRow, {
          key: `${source}:${entry.id}`,
          entry,
          source,
          onAction,
        }),
      ),
    ),
  )
}

/** 高频噪音事件：每次启动/热重载都会大量产生，挤掉真正重要的诊断信息。 */
const EVENT_NOISE = new Set(['entry-init', 'entry-dispose'])

/** Recent guardian event log: badge + key info + time per entry.
 *  过滤 entry-init/entry-dispose 噪音，优先展示隔离/冻结/更新失败等关键事件。 */
function EventList({ events }) {
  const important = events.filter((event) => !EVENT_NOISE.has(event.type))
  if (important.length === 0) return null
  return createElement(
    'div',
    { className: 'dsh-my-guardian-events' },
    createElement('div', { className: 'dsh-my-guardian-events-title' }, icon.clock(14), strings.events()),
    important.map((event, index) =>
      createElement(
        'div',
        {
          className: 'dsh-my-guardian-event',
          key: index,
          title: event.message,
        },
        createElement(
          'span',
          { className: `dsh-my-guardian-event-badge dsh-my-guardian-event-${eventVariant(event.type)}` },
          eventLabel(event.type),
        ),
        createElement('span', { className: 'dsh-my-guardian-event-message' }, event.message),
        createElement('span', { className: 'dsh-my-guardian-event-time' }, formatTime(event.time)),
      ),
    ),
  )
}

/** 启动区问题（issue #144）：启动名册静态预检发现的问题条目，置顶展示
 *  修复命令与移除提示——名册中的坏条目是 all-or-nothing 启动失败的源头。 */
function StartupIssuesBlock({ issues, checkedAt }) {
  if (!Array.isArray(issues) || issues.length === 0) return null
  return createElement(
    'div',
    { className: 'dsh-my-guardian-startup-issues' },
    createElement(
      'div',
      { className: 'dsh-my-guardian-startup-issues-title' },
      icon.alert(14),
      strings.startupIssues(),
      createElement('span', { className: 'dsh-my-guardian-startup-issues-count' }, String(issues.length)),
      typeof checkedAt === 'number' && Number.isFinite(checkedAt)
        ? createElement('span', { className: 'dsh-my-guardian-startup-issues-time' }, formatTime(checkedAt))
        : null,
    ),
    issues.map((issue, index) =>
      createElement(
        'div',
        { className: 'dsh-my-guardian-startup-issue', key: index },
        createElement(
          'div',
          { className: 'dsh-my-guardian-startup-issue-head' },
          createElement(
            'span',
            {
              className: `dsh-my-guardian-event-badge dsh-my-guardian-startup-issue-badge-${issue.type}`,
              title: issue.entryId,
            },
            startupIssueLabel(issue.type),
          ),
          createElement('span', { className: 'dsh-my-guardian-startup-issue-name' }, issue.name),
        ),
        createElement('div', { className: 'dsh-my-guardian-startup-issue-message' }, issue.message),
        typeof issue.fix === 'string' && issue.fix !== ''
          ? createElement(
              'div',
              { className: 'dsh-my-guardian-startup-issue-line' },
              createElement('span', { className: 'dsh-my-guardian-startup-issue-label' }, strings.startupIssueFix()),
              createElement('code', null, issue.fix),
            )
          : null,
        typeof issue.remove === 'string' && issue.remove !== ''
          ? createElement(
              'div',
              { className: 'dsh-my-guardian-startup-issue-line' },
              createElement('span', { className: 'dsh-my-guardian-startup-issue-label' }, strings.startupIssueRemove()),
              createElement('span', { className: 'dsh-my-guardian-startup-issue-remove' }, issue.remove),
            )
          : null,
      ),
    ),
  )
}

function GuardianView({ visible }) {
  const { state, loadFailed, reload, onAction, onSafeMode } = useGuardianState(visible)

  if (!state.loaded && !loadFailed) {
    return createElement(
      'div',
      { className: 'dsh-my-guardian-loading' },
      createElement('span', { className: 'dsh-my-guardian-loading-icon' }, icon.refresh(14)),
      strings.loading(),
    )
  }

  const rows = [
    ...state.staged.map((entry) => ({ entry, source: 'staged' })),
    ...state.promoted.map((entry) => ({ entry, source: 'promoted' })),
  ]

  return createElement(
    'div',
    { className: 'dsh-my-guardian-root' },
    createElement(SafeModeBar, { safeMode: state.safeMode, onSafeMode }),
    createElement(StartupIssuesBlock, {
      issues: state.startupIssues,
      checkedAt: state.startupCheckedAt,
    }),
    loadFailed
      ? createElement(
          'div',
          { className: 'dsh-my-guardian-error' },
          createElement('span', { className: 'dsh-my-guardian-error-text' }, strings.loadError()),
          createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-my-guardian-iconbtn dsh-my-guardian-iconbtn-xs',
              'aria-label': strings.retry(),
              title: strings.retry(),
              onClick: reload,
            },
            icon.refresh(14),
          ),
        )
      : null,
    createElement(EntryList, { rows, onAction }),
    createElement(EventList, { events: state.events }),
  )
}

    // ── plugin body ───────────────────────────────────────────────────────
// 零第三方依赖：不 inject better-sidebar（那是第三方插件服务）。面板是
// 可选增强——ctx.get('betterSidebar') 动态获取，服务不存在时静默跳过，
// 核心治理能力（候选区/隔离/安全模式）纯 server 端，不受影响。
exports.apply = function apply(ctx) {
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-my-guardian', 'styles')
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, 'dsh-my-guardian: styles')

  // strict=false：首屏加载时 betterSidebar 服务（由 dsh-better-sidebar 提供）
  // 的提供者 fiber 尚未 active，cordis 的 ctx.get(name, strict = true) 在
  // strict 模式下会返回 undefined，注册代码会静默 return（侧边栏看不到本
  // 插件页签，HMR 重载后才出现）；取到实例即可——未安装 better-sidebar 时
  // 仍返回 undefined（下面的判空降级不变），实际渲染发生在注册之后，安全。
  const service = ctx.get('betterSidebar', false)
  if (service === undefined) return

  ctx.effect(
    () =>
      service.registerTab({
        id: TAB_ID,
        title: () => strings.title(),
        order: 80,
        single: true,
        component: ({ scope, visible }) => createElement(GuardianView, { sessionId: scope.sessionId, visible }),
      }),
    'dsh-my-guardian: tab registration',
  )
}


    return module.exports
  },
})
