// ── styles/STYLE_DECK：技能台样式分片（构建期按顺序拼接为 STYLES）───────
const STYLE_DECK: string = `
/* ── 列表容器 ── */
.dsh-my-skill-manager-stage { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
.dsh-my-skill-manager-list,
.dsh-my-skill-manager-table-wrap,
.dsh-my-skill-manager-state,
.dsh-my-skill-manager-diag {
  flex: 1; min-height: 0; overflow: auto;
  scrollbar-width: thin; scrollbar-color: var(--skm-scroll) transparent;
}
.dsh-my-skill-manager-list { padding: 2px 2px 4px; }
.dsh-my-skill-manager-list::-webkit-scrollbar,
.dsh-my-skill-manager-table-wrap::-webkit-scrollbar,
.dsh-my-skill-manager-state::-webkit-scrollbar,
.dsh-my-skill-manager-diag::-webkit-scrollbar { width: 8px; height: 8px; }
.dsh-my-skill-manager-list::-webkit-scrollbar-thumb,
.dsh-my-skill-manager-table-wrap::-webkit-scrollbar-thumb,
.dsh-my-skill-manager-state::-webkit-scrollbar-thumb,
.dsh-my-skill-manager-diag::-webkit-scrollbar-thumb {
  background: var(--skm-scroll); border-radius: 8px;
}
.dsh-my-skill-manager-list::-webkit-scrollbar-track,
.dsh-my-skill-manager-table-wrap::-webkit-scrollbar-track,
.dsh-my-skill-manager-state::-webkit-scrollbar-track,
.dsh-my-skill-manager-diag::-webkit-scrollbar-track { background: transparent; }

/* ── 来源分组 ── */
.dsh-my-skill-manager-group { padding-bottom: 6px; }
.dsh-my-skill-manager-group-head {
  position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 7px;
  padding: 7px 2px 6px; margin-bottom: 7px;
  background: var(--skm-surface);
  box-shadow: inset 0 -1px 0 var(--skm-border);
}
.dsh-my-skill-manager-group-head h3 {
  margin: 0; font: var(--dsw-font-xxxs-strong-11); letter-spacing: .04em;
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-group-count {
  display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 4px;
  background: var(--skm-surface-2); box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11);
  font-variant-numeric: tabular-nums;
}
.dsh-my-skill-manager-group-provider {
  margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-group-body { display: flex; flex-direction: column; gap: 7px; }

/* ── 技能卡 ── */
.dsh-my-skill-manager-card {
  position: relative; padding: 9px 10px 8px 16px; border-radius: 10px;
  background: var(--skm-surface); box-shadow: inset 0 0 0 1px var(--skm-border);
  transition: background var(--skm-ease), box-shadow var(--skm-ease);
}
.dsh-my-skill-manager-card:hover { background: var(--skm-surface-2); }
.dsh-my-skill-manager-card-selected {
  box-shadow: inset 0 0 0 1px var(--skm-accent), 0 0 0 3px var(--skm-accent-ring);
}
.dsh-my-skill-manager-card-bar {
  position: absolute; left: 0; top: 0; bottom: 0; width: 3px; border-radius: 10px 0 0 10px;
  background: var(--skm-success);
}
.dsh-my-skill-manager-card-off .dsh-my-skill-manager-card-bar { background: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-card-anomaly .dsh-my-skill-manager-card-bar { background: var(--skm-warn); }
.dsh-my-skill-manager-card-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-my-skill-manager-checkbox {
  flex: none; width: 13px; height: 13px; margin: 0;
  accent-color: var(--skm-accent); cursor: pointer;
}
.dsh-my-skill-manager-card-open {
  display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; text-align: left;
}
.dsh-my-skill-manager-name {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: var(--dsw-font-xs-strong-13); letter-spacing: .01em;
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-card-off .dsh-my-skill-manager-name { color: var(--dsw-alias-label-secondary); }
.dsh-my-skill-manager-badge {
  display: inline-flex; align-items: center; flex: none; height: 16px; padding: 0 5px;
  border-radius: 4px; background: var(--skm-surface-3);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-strong-11); white-space: nowrap;
}
.dsh-my-skill-manager-badge-warn {
  background: var(--skm-warn-soft); color: var(--skm-warn); box-shadow: inset 0 0 0 1px var(--skm-warn);
}
.dsh-my-skill-manager-badge-quiet {
  background: transparent; color: var(--dsw-alias-label-tertiary);
  box-shadow: inset 0 0 0 1px var(--skm-border);
}
.dsh-my-skill-manager-usage {
  display: inline-flex; align-items: center; gap: 4px; margin-left: auto; flex: none;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
.dsh-my-skill-manager-usage svg { color: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-chevron {
  flex: none; color: var(--dsw-alias-label-tertiary);
  transition: transform .18s var(--ds-ease-in-out);
}
.dsh-my-skill-manager-card[data-expanded="true"] .dsh-my-skill-manager-chevron { transform: rotate(180deg); }
.dsh-my-skill-manager-desc {
  margin: 4px 0 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); line-height: 1.5;
}
.dsh-my-skill-manager-card-off .dsh-my-skill-manager-desc { color: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-card-foot { display: flex; align-items: center; gap: 8px; min-height: 20px; flex-wrap: wrap; }
.dsh-my-skill-manager-scopes { display: inline-flex; align-items: center; gap: 10px; transition: opacity var(--skm-ease); }
.dsh-my-skill-manager-scopes-dim { opacity: .55; }
.dsh-my-skill-manager-foot-note {
  margin-left: auto; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
}

/* ── 开关 ── */
.dsh-my-skill-manager-switch {
  display: inline-flex; align-items: center; gap: 5px; padding: 1px 2px; border-radius: 6px;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
  transition: color var(--skm-ease);
}
.dsh-my-skill-manager-switch:hover:not(:disabled) { color: var(--dsw-alias-label-secondary); }
.dsh-my-skill-manager-track {
  position: relative; display: inline-block; flex: none; width: 26px; height: 15px;
  border-radius: 999px; background: var(--skm-track);
  box-shadow: inset 0 0 0 1px var(--skm-border-strong);
  transition: background var(--skm-ease), box-shadow var(--skm-ease);
}
.dsh-my-skill-manager-knob {
  position: absolute; top: 1.5px; left: 1.5px; width: 12px; height: 12px;
  border-radius: 50%; background: var(--skm-knob);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);
  transition: transform .16s var(--ds-ease-in-out), background var(--skm-ease);
}
.dsh-my-skill-manager-switch[aria-checked="true"] { color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-switch[aria-checked="true"] .dsh-my-skill-manager-track {
  background: var(--skm-accent-soft); box-shadow: inset 0 0 0 1px var(--skm-accent);
}
.dsh-my-skill-manager-switch[aria-checked="true"] .dsh-my-skill-manager-knob {
  transform: translateX(11px); background: var(--skm-accent);
}
.dsh-my-skill-manager-switch-warn .dsh-my-skill-manager-track {
  background: var(--skm-warn-soft); box-shadow: inset 0 0 0 1px var(--skm-warn);
}
.dsh-my-skill-manager-switch-warn .dsh-my-skill-manager-knob { background: var(--skm-warn); }
.dsh-my-skill-manager-switch:disabled { cursor: not-allowed; opacity: .45; }
.dsh-my-skill-manager-switch-mini { gap: 0; }
.dsh-my-skill-manager-switch-mini .dsh-my-skill-manager-track { width: 22px; height: 13px; }
.dsh-my-skill-manager-switch-mini .dsh-my-skill-manager-knob { top: 1.5px; left: 1.5px; width: 10px; height: 10px; }
.dsh-my-skill-manager-switch-mini[aria-checked="true"] .dsh-my-skill-manager-knob { transform: translateX(9px); }

/* ── 内联错误 ── */
.dsh-my-skill-manager-inline-error {
  display: flex; align-items: flex-start; gap: 7px; margin-top: 8px; padding: 7px 8px;
  border-radius: 7px; background: var(--skm-danger-soft);
  box-shadow: inset 0 0 0 1px var(--skm-danger);
  color: var(--skm-danger); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-inline-error > svg { margin-top: 1px; color: var(--skm-danger); }
.dsh-my-skill-manager-inline-error-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dsh-my-skill-manager-inline-error-title {
  color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxxs-strong-11);
}
.dsh-my-skill-manager-inline-error-msg {
  color: var(--dsw-alias-label-secondary); line-height: 1.45; word-break: break-word;
}

/* ── 焦点详情 ── */
.dsh-my-skill-manager-detail {
  display: grid; grid-template-columns: 1fr 1fr; margin-top: 9px; padding-top: 9px;
  box-shadow: inset 0 1px 0 var(--skm-border);
  animation: dsh-my-skill-manager-fade .18s ease-out both;
}
.dsh-my-skill-manager-detail-col { min-width: 0; padding-right: 12px; }
.dsh-my-skill-manager-detail-col-right {
  padding-right: 0; padding-left: 12px; box-shadow: inset 1px 0 0 var(--skm-border);
}
.dsh-my-skill-manager-detail-desc {
  margin: 0 0 7px; color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12); line-height: 1.55;
}
.dsh-my-skill-manager-meta { margin: 0; display: flex; flex-direction: column; gap: 5px; }
.dsh-my-skill-manager-meta-row {
  display: grid; grid-template-columns: 52px 1fr; gap: 6px; align-items: start;
  font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-meta-row dt { color: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-meta-row dd {
  margin: 0; min-width: 0; display: flex; align-items: flex-start; gap: 4px; flex-wrap: wrap;
  color: var(--dsw-alias-label-secondary);
}
.dsh-my-skill-manager-meta-code {
  color: var(--dsw-alias-label-secondary); font-size: 10.5px; line-height: 1.45;
  word-break: break-all;
}
.dsh-my-skill-manager-cap {
  display: inline-flex; align-items: center; height: 17px; padding: 0 5px; border-radius: 4px;
  background: var(--skm-surface-2); box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-icon-btn {
  display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 7px;
  color: var(--dsw-alias-label-secondary);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-icon-btn:hover { background: var(--skm-hover); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-icon-btn-sm {
  flex: none; width: 20px; height: 20px; border-radius: 5px; color: var(--dsw-alias-label-tertiary);
}
.dsh-my-skill-manager-preview-head {
  display: flex; align-items: center; gap: 6px; margin-bottom: 5px;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-preview-note { font-style: normal; opacity: .8; }
.dsh-my-skill-manager-mini-btn {
  margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
  height: 22px; padding: 0 6px; border-radius: 5px;
  background: var(--skm-surface-2); box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-mini-btn:hover { color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-pre {
  margin: 0; padding: 7px 8px; max-height: 240px; overflow: auto;
  border-radius: 7px; background: var(--skm-code-bg);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--skm-code-fg); font-size: 10.5px; line-height: 1.5; white-space: pre;
  scrollbar-width: thin; scrollbar-color: var(--skm-scroll) transparent;
}
.dsh-my-skill-manager-pre::-webkit-scrollbar { width: 7px; height: 7px; }
.dsh-my-skill-manager-pre::-webkit-scrollbar-thumb { background: var(--skm-scroll); border-radius: 7px; }
.dsh-my-skill-manager-preview-state {
  display: block; padding: 7px 8px; border-radius: 7px; background: var(--skm-code-bg);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); line-height: 1.5;
}
.dsh-my-skill-manager-preview-state-error { color: var(--skm-danger); }
.dsh-my-skill-manager-preview-retry {
  margin-top: 5px; display: inline-flex; align-items: center; gap: 4px;
  height: 22px; padding: 0 8px; border-radius: 5px;
  background: var(--skm-surface-2); box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-usage-stats {
  display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-usage-stats b { font: var(--dsw-font-xxxs-strong-11); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-missing {
  display: flex; flex-direction: column; gap: 5px; padding: 9px; border-radius: 7px;
  background: var(--skm-warn-soft); box-shadow: inset 0 0 0 1px var(--skm-warn);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); line-height: 1.5;
}
.dsh-my-skill-manager-missing b { color: var(--skm-warn); font: var(--dsw-font-xxxs-strong-11); }
.dsh-my-skill-manager-missing code { font-size: 10.5px; word-break: break-all; color: var(--dsw-alias-label-secondary); }

`.trim()
