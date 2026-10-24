// ── styles/STYLE_TABLE：技能台样式分片（构建期按顺序拼接为 STYLES）───────
const STYLE_TABLE: string = `
/* ── 紧凑表 ── */
.dsh-my-skill-manager-table-wrap { padding-right: 2px; }
.dsh-my-skill-manager-table {
  width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed;
  font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-table thead th {
  position: sticky; top: 0; z-index: 2; height: 28px; padding: 0 6px;
  background: var(--skm-surface);
  box-shadow: inset 0 -1px 0 var(--skm-border);
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11);
  text-align: left; letter-spacing: .02em;
}
.dsh-my-skill-manager-th-sort { padding: 0 2px; }
.dsh-my-skill-manager-sortbtn {
  display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 4px;
  border-radius: 5px; color: var(--dsw-alias-label-tertiary); font: inherit;
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-sortbtn:hover { background: var(--skm-hover); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-sortbtn svg { opacity: .4; }
.dsh-my-skill-manager-table th[aria-sort="ascending"] .dsh-my-skill-manager-sortbtn,
.dsh-my-skill-manager-table th[aria-sort="descending"] .dsh-my-skill-manager-sortbtn {
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-table th[aria-sort="ascending"] .dsh-my-skill-manager-sortbtn svg,
.dsh-my-skill-manager-table th[aria-sort="descending"] .dsh-my-skill-manager-sortbtn svg {
  opacity: 1; color: var(--skm-accent);
}
.dsh-my-skill-manager-col-check { width: 26px; }
.dsh-my-skill-manager-col-source { width: 58px; }
.dsh-my-skill-manager-col-usage { width: 40px; }
.dsh-my-skill-manager-col-recent { width: 78px; }
.dsh-my-skill-manager-col-scope { width: 66px; }
.dsh-my-skill-manager-row { height: 32px; }
.dsh-my-skill-manager-row:hover td { background: var(--skm-hover); }
.dsh-my-skill-manager-row td {
  padding: 0 6px; background: transparent;
  box-shadow: inset 0 -1px 0 var(--skm-border);
  color: var(--dsw-alias-label-secondary); vertical-align: middle; white-space: nowrap;
}
.dsh-my-skill-manager-row[data-expanded="true"] .dsh-my-skill-manager-chevron { transform: rotate(180deg); }
.dsh-my-skill-manager-row-selected td { background: var(--skm-selected); }
.dsh-my-skill-manager-row-selected td:first-child {
  box-shadow: inset 2px 0 0 var(--skm-accent), inset 0 -1px 0 var(--skm-border);
}
.dsh-my-skill-manager-row-name { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dsh-my-skill-manager-row-bar {
  flex: none; width: 2px; height: 12px; border-radius: 1px; background: var(--skm-success);
}
.dsh-my-skill-manager-row-off .dsh-my-skill-manager-row-bar { background: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-row-anomaly .dsh-my-skill-manager-row-bar { background: var(--skm-warn); }
.dsh-my-skill-manager-row-open {
  display: flex; align-items: center; gap: 6px; min-width: 0; text-align: left;
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-row-open .dsh-my-skill-manager-name { font: var(--dsw-font-xxxs-strong-11); }
.dsh-my-skill-manager-row-open .dsh-my-skill-manager-chevron { opacity: .55; }
.dsh-my-skill-manager-th-scope { text-align: center; }
.dsh-my-skill-manager-scope-cell {
  display: flex; align-items: center; justify-content: center; gap: 4px;
}
.dsh-my-skill-manager-detail-row td {
  padding: 0 8px 10px; background: var(--skm-surface);
  box-shadow: inset 0 -1px 0 var(--skm-border);
}
.dsh-my-skill-manager-detail-row .dsh-my-skill-manager-detail { margin-top: 8px; padding-top: 8px; }
.dsh-my-skill-manager-detail-row .dsh-my-skill-manager-inline-error { margin-bottom: 8px; }

/* ── 批量操作条 ── */
.dsh-my-skill-manager-action {
  flex: none; height: 76px; display: flex; align-items: center; gap: 10px; padding: 0 12px;
  margin-bottom: 8px; border-radius: 9px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-accent);
  animation: dsh-my-skill-manager-fade .18s ease-out both;
}
.dsh-my-skill-manager-action-info {
  display: flex; align-items: center; gap: 7px; flex-wrap: wrap; min-width: 0;
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12);
}
.dsh-my-skill-manager-action-info > svg { color: var(--skm-accent); }
.dsh-my-skill-manager-action-info b {
  font: var(--dsw-font-s-strong-14); color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
}
.dsh-my-skill-manager-action-note { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.dsh-my-skill-manager-action-btns {
  margin-left: auto; display: flex; align-items: center; gap: 6px; flex: none;
}
.dsh-my-skill-manager-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 26px; padding: 0 10px; border-radius: 7px;
  background: var(--skm-surface-2); box-shadow: inset 0 0 0 1px var(--skm-border-strong);
  color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-btn:hover:not(:disabled) { background: var(--skm-surface-3); }
.dsh-my-skill-manager-btn:disabled { opacity: .4; cursor: not-allowed; }
.dsh-my-skill-manager-btn-primary {
  background: var(--skm-accent); color: var(--skm-on-accent); box-shadow: none;
}
.dsh-my-skill-manager-btn-primary:hover:not(:disabled) { background: var(--skm-accent-strong); }
.dsh-my-skill-manager-btn-ghost { background: none; box-shadow: none; color: var(--dsw-alias-label-secondary); }
.dsh-my-skill-manager-btn-ghost:hover:not(:disabled) { background: var(--skm-hover); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-btn-danger { background: var(--skm-danger); color: var(--skm-on-accent); box-shadow: none; }
.dsh-my-skill-manager-btn-danger-ghost {
  background: none; box-shadow: inset 0 0 0 1px var(--skm-danger); color: var(--skm-danger);
}
.dsh-my-skill-manager-btn-danger-ghost:hover:not(:disabled) { background: var(--skm-danger-soft); }
.dsh-my-skill-manager-action-confirm {
  background: var(--skm-danger-soft); box-shadow: inset 0 0 0 1px var(--skm-danger);
}
.dsh-my-skill-manager-action-confirm > svg { color: var(--skm-danger); }
.dsh-my-skill-manager-action-confirm .dsh-my-skill-manager-action-info {
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-action-confirm .dsh-my-skill-manager-action-info em {
  font-style: normal; color: var(--dsw-alias-label-tertiary); font-size: 10.5px;
}

/* ── 状态页：加载 / 空 / 失败 ── */
.dsh-my-skill-manager-state { padding: 2px; }
.dsh-my-skill-manager-empty,
.dsh-my-skill-manager-error {
  flex: 1; min-height: 320px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; padding: 28px 24px; text-align: center;
}
.dsh-my-skill-manager-empty > svg { margin-bottom: 10px; color: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-error > svg { margin-bottom: 10px; color: var(--skm-danger); }
.dsh-my-skill-manager-empty h2,
.dsh-my-skill-manager-error h2 {
  margin: 0 0 6px; color: var(--dsw-alias-label-primary); font: var(--dsw-font-s-strong-14);
}
.dsh-my-skill-manager-empty p,
.dsh-my-skill-manager-error p {
  margin: 0; max-width: 372px; color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12); line-height: 1.6; white-space: pre-wrap;
}
.dsh-my-skill-manager-error p code {
  color: var(--skm-warn); font-size: 11px; word-break: break-all;
}
.dsh-my-skill-manager-empty-actions {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  margin-top: 14px; flex-wrap: wrap;
}
.dsh-my-skill-manager-empty-preview {
  display: inline-flex; align-items: center; gap: 8px; margin-top: 14px; padding: 7px 10px;
  border-radius: 8px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-skeleton { display: flex; flex-direction: column; gap: 8px; padding: 6px 2px; }
.dsh-my-skill-manager-skel-head {
  width: 110px; height: 10px; border-radius: 4px; background: var(--skm-surface-3);
  animation: dsh-my-skill-manager-pulse 1.4s ease-in-out infinite;
}
.dsh-my-skill-manager-skel-card {
  height: 72px; display: flex; flex-direction: column; gap: 9px; padding: 12px 14px;
  border-radius: 10px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  animation: dsh-my-skill-manager-pulse 1.4s ease-in-out infinite;
}
.dsh-my-skill-manager-skel-line { height: 8px; border-radius: 4px; background: var(--skm-surface-3); }
.dsh-my-skill-manager-w25 { width: 25%; }
.dsh-my-skill-manager-w40 { width: 40%; }
.dsh-my-skill-manager-w55 { width: 55%; }
.dsh-my-skill-manager-w70 { width: 70%; }

/* ── 诊断台 ── */
.dsh-my-skill-manager-diag { padding: 2px 2px 8px; }
.dsh-my-skill-manager-diag-head {
  display: flex; align-items: center; gap: 10px; padding: 6px 2px 12px; margin-bottom: 12px;
  box-shadow: inset 0 -1px 0 var(--skm-border);
}
.dsh-my-skill-manager-diag-title h2 {
  margin: 0; color: var(--dsw-alias-label-primary); font: var(--dsw-font-s-strong-14);
}
.dsh-my-skill-manager-diag-title p {
  margin: 2px 0 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-diag-head .dsh-my-skill-manager-btn { margin-left: auto; }
.dsh-my-skill-manager-diag-card {
  padding: 12px; margin-bottom: 10px; border-radius: 10px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
}
.dsh-my-skill-manager-diag-card-head {
  display: flex; align-items: flex-start; gap: 9px; margin-bottom: 10px;
}
.dsh-my-skill-manager-diag-card-head > svg { margin-top: 1px; color: var(--skm-warn); }
.dsh-my-skill-manager-diag-card-head h3 {
  margin: 0; color: var(--dsw-alias-label-primary); font: var(--dsw-font-xs-strong-13);
}
.dsh-my-skill-manager-diag-card-head p {
  margin: 2px 0 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-diag-card-head .dsh-my-skill-manager-badge { margin-left: auto; }
.dsh-my-skill-manager-diag-meta { margin: 0; display: flex; flex-direction: column; gap: 7px; }
.dsh-my-skill-manager-diag-meta .dsh-my-skill-manager-meta-row {
  grid-template-columns: 38px 1fr; font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-diag-meta .dsh-my-skill-manager-meta-row dd { align-items: center; }
.dsh-my-skill-manager-diag-meta .dsh-my-skill-manager-meta-code { font-size: 10.5px; }
.dsh-my-skill-manager-diag-foot {
  margin-top: 14px; text-align: center; color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-diag-empty {
  padding: 40px 16px; text-align: center; color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxs-12);
}

/* ── Toast ── */
.dsh-my-skill-manager-toast {
  position: absolute; left: 50%; bottom: 14px; z-index: 80;
  transform: translateX(-50%);
  display: flex; align-items: center; gap: 7px;
  max-width: min(640px, calc(100% - 24px)); padding: 8px 12px; border-radius: 8px;
  background: var(--skm-surface-3);
  box-shadow:
    0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent),
    inset 0 0 0 1px var(--skm-border-strong);
  color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12);
  animation: dsh-my-skill-manager-fade .18s ease-out both;
  pointer-events: none;
}
.dsh-my-skill-manager-toast-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--skm-accent); }
.dsh-my-skill-manager-toast[data-kind="error"] .dsh-my-skill-manager-toast-dot { background: var(--skm-danger); }
.dsh-my-skill-manager-toast[data-kind="success"] .dsh-my-skill-manager-toast-dot { background: var(--skm-success); }

/* ── 收窄 ── */
@media (max-width: 560px) {
  .dsh-my-skill-manager-detail { grid-template-columns: 1fr; }
  .dsh-my-skill-manager-detail-col { padding-right: 0; }
  .dsh-my-skill-manager-detail-col-right {
    padding-left: 0; margin-top: 9px; padding-top: 9px;
    box-shadow: inset 0 1px 0 var(--skm-border);
  }
  .dsh-my-skill-manager-foot-note { display: none; }
  .dsh-my-skill-manager-group-provider { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-my-skill-manager-root *,
  .dsh-my-skill-manager-root *::before,
  .dsh-my-skill-manager-root *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
    scroll-behavior: auto !important;
  }
}
`.trim()
