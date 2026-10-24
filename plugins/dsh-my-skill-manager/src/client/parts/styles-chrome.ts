// ── styles/STYLE_CHROME：技能台样式分片（构建期按顺序拼接为 STYLES）───────
const STYLE_CHROME: string = `
/* ── 命令条（564px 硬约束：所有行 nowrap + min-width:0，禁止横向滚动）── */
.dsh-my-skill-manager-command {
  flex: none; display: flex; flex-direction: column; gap: 8px;
  min-width: 0; max-width: 100%;
}
.dsh-my-skill-manager-search-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; min-width: 0;
}
.dsh-my-skill-manager-search {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px;
  height: 34px; padding: 0 9px; border-radius: 8px;
  background: var(--skm-surface); box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-tertiary);
}
.dsh-my-skill-manager-search:focus-within {
  box-shadow: inset 0 0 0 1px var(--skm-accent), 0 0 0 3px var(--skm-accent-ring);
}
.dsh-my-skill-manager-search-input {
  flex: 1; min-width: 0; border: 0; outline: none; background: none;
  color: var(--dsw-alias-label-primary); font: var(--dsw-font-xs-13);
  caret-color: var(--skm-accent); text-overflow: ellipsis;
}
.dsh-my-skill-manager-search-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-kbd {
  flex: none; display: inline-flex; align-items: center; height: 18px; padding: 0 5px;
  border-radius: 4px; background: var(--skm-surface-2);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
  font-family: inherit;
}
.dsh-my-skill-manager-search-clear {
  flex: none; display: grid; place-items: center; width: 18px; height: 18px;
  border-radius: 4px; color: var(--dsw-alias-label-tertiary);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-search-clear:hover { background: var(--skm-hover); color: var(--dsw-alias-label-primary); }
/* 重新扫描：图标按钮（34×34），名称走 aria-label + title */
.dsh-my-skill-manager-scan {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; padding: 0; border-radius: 8px;
  background: var(--skm-surface); box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-scan:hover:not(:disabled) { background: var(--skm-surface-2); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-scan:disabled { cursor: progress; color: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-scan-loading svg { animation: dsh-my-skill-manager-spin .9s linear infinite; }
/* 筛选按钮（图标 + 文字 + 生效条件数） */
.dsh-my-skill-manager-filter-wrap { position: relative; flex: none; }
.dsh-my-skill-manager-filter-btn {
  display: inline-flex; align-items: center; gap: 5px; height: 34px; padding: 0 9px;
  border-radius: 8px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
  transition: background var(--skm-ease), color var(--skm-ease), box-shadow var(--skm-ease);
}
.dsh-my-skill-manager-filter-btn:hover { background: var(--skm-surface-2); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-filter-btn[aria-expanded="true"] {
  background: var(--skm-surface-2); color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-filter-btn-active {
  box-shadow: inset 0 0 0 1px var(--skm-accent); color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-filter-btn-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px;
  background: var(--skm-accent-soft); color: var(--skm-accent);
  font: var(--dsw-font-xxxs-strong-11); font-variant-numeric: tabular-nums;
}
/* 概览行：4 个紧凑统计段（等分）+ 行末诊断入口 */
.dsh-my-skill-manager-stats-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; min-width: 0;
}
.dsh-my-skill-manager-stats {
  flex: 1; min-width: 0; display: flex; overflow: hidden; border-radius: 8px;
  background: var(--skm-surface); box-shadow: inset 0 0 0 1px var(--skm-border);
}
.dsh-my-skill-manager-stat {
  flex: 1 1 0; min-width: 0; display: flex; align-items: center; justify-content: center;
  gap: 4px; height: 30px; padding: 0 4px; overflow: hidden; white-space: nowrap;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
  box-shadow: inset -1px 0 0 var(--skm-border);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-stat:last-child { box-shadow: none; }
.dsh-my-skill-manager-stat-label {
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
.dsh-my-skill-manager-stat b {
  flex: none; font-size: 15px; font-weight: 600; line-height: 1;
  color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums;
}
.dsh-my-skill-manager-stat:hover { background: var(--skm-hover); }
.dsh-my-skill-manager-stat[aria-pressed="true"] { background: var(--skm-accent-soft); }
.dsh-my-skill-manager-stat[aria-pressed="true"] b { color: var(--skm-accent); }
.dsh-my-skill-manager-stat-warn b { color: var(--skm-warn); }
.dsh-my-skill-manager-diag-entry {
  flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: 30px; min-width: 30px; padding: 0 7px; border-radius: 8px;
  background: var(--skm-warn-soft); color: var(--skm-warn);
  box-shadow: inset 0 0 0 1px var(--skm-warn);
  font: var(--dsw-font-xxxs-strong-11); white-space: nowrap;
  transition: background var(--skm-ease);
}
.dsh-my-skill-manager-diag-entry b { font-variant-numeric: tabular-nums; }
.dsh-my-skill-manager-diag-entry:hover { background: var(--skm-surface-2); }
.dsh-my-skill-manager-diag-entry-idle {
  background: var(--skm-surface); color: var(--dsw-alias-label-tertiary);
  box-shadow: inset 0 0 0 1px var(--skm-border);
}
.dsh-my-skill-manager-project-note {
  display: flex; align-items: center; gap: 5px; min-width: 0;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-project-note span {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── 筛选面板（弹出层，替代常驻的 chips 两行）── */
.dsh-my-skill-manager-filter-panel {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 40;
  box-sizing: border-box; width: min(280px, calc(100vw - 32px));
  display: flex; flex-direction: column; gap: 10px; padding: 10px;
  border-radius: 10px; background: var(--dsw-alias-bg-layer-3, var(--skm-surface));
  box-shadow:
    0 0 0 1px var(--skm-border-strong),
    0 10px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);
  animation: dsh-my-skill-manager-fade .15s ease-out both;
}
.dsh-my-skill-manager-filter-panel-title {
  color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-strong-12);
}
.dsh-my-skill-manager-filter-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dsh-my-skill-manager-filter-group-label {
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); letter-spacing: .04em;
}
.dsh-my-skill-manager-filter-chip-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.dsh-my-skill-manager-filter-switch { width: 100%; justify-content: space-between; }
.dsh-my-skill-manager-filter-actions {
  display: flex; align-items: center; justify-content: flex-end; gap: 6px;
  margin-top: 2px; padding-top: 8px; box-shadow: inset 0 1px 0 var(--skm-border);
}
.dsh-my-skill-manager-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 23px; padding: 0 8px;
  border-radius: 999px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
  transition: background var(--skm-ease), color var(--skm-ease), box-shadow var(--skm-ease);
}
.dsh-my-skill-manager-chip b {
  font: var(--dsw-font-xxxs-strong-11); color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
.dsh-my-skill-manager-chip:hover { background: var(--skm-surface-2); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-chip[aria-pressed="true"] {
  background: var(--skm-accent-soft); box-shadow: inset 0 0 0 1px var(--skm-accent);
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-chip[aria-pressed="true"] b { color: var(--skm-accent); }
.dsh-my-skill-manager-src-dot {
  flex: none; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
}
.dsh-my-skill-manager-chip .dsh-my-skill-manager-src-dot { width: 5px; height: 5px; margin-right: 1px; }
.dsh-my-skill-manager-src-dot-project { background: var(--skm-accent); }
.dsh-my-skill-manager-src-dot-user { background: var(--dsw-alias-label-secondary); }
.dsh-my-skill-manager-src-dot-bundled { background: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-src-dot-other { background: var(--dsw-alias-label-dimmed); }
.dsh-my-skill-manager-src-dot-anomaly { background: var(--skm-warn); }

/* ── 工具条（单行：结果数 + 可截断扫描时间 + 右侧图标组）── */
.dsh-my-skill-manager-toolbar {
  flex: none; display: flex; align-items: center; gap: 6px;
  height: 34px; flex-wrap: nowrap; min-width: 0; overflow: hidden;
}
.dsh-my-skill-manager-result {
  flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
}
.dsh-my-skill-manager-result b {
  font: var(--dsw-font-xxxs-strong-11); color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
}
.dsh-my-skill-manager-scan-time {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-toolbar-right {
  flex: none; margin-left: auto; display: flex; align-items: center; gap: 4px;
}
.dsh-my-skill-manager-seg {
  display: inline-flex; flex: none; padding: 2px; border-radius: 7px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
}
.dsh-my-skill-manager-seg button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 24px; padding: 0; border-radius: 5px;
  color: var(--dsw-alias-label-secondary);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-seg button:hover { color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-seg button[aria-pressed="true"] {
  background: var(--skm-surface-3); color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-sortwrap { position: relative; flex: none; }
.dsh-my-skill-manager-tool-text {
  display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 7px;
  border-radius: 7px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-tool-text:hover,
.dsh-my-skill-manager-tool-text[aria-expanded="true"] {
  background: var(--skm-surface-2); color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-sort-dir {
  flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px;
  color: var(--dsw-alias-label-secondary); transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-sort-dir:hover { background: var(--skm-hover); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-select-btn {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border-radius: 7px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary);
  transition: background var(--skm-ease), color var(--skm-ease), box-shadow var(--skm-ease);
}
.dsh-my-skill-manager-select-btn:hover { background: var(--skm-surface-2); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-select-btn[aria-pressed="true"] {
  background: var(--skm-accent-soft); box-shadow: inset 0 0 0 1px var(--skm-accent);
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; width: 164px; padding: 6px;
  border-radius: 10px; background: var(--dsw-alias-bg-layer-3, var(--skm-surface));
  box-shadow:
    0 0 0 1px var(--skm-border-strong),
    0 10px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);
  animation: dsh-my-skill-manager-fade .15s ease-out both;
}
.dsh-my-skill-manager-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%; height: 30px; padding: 0 8px;
  border-radius: 6px; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-menu-item:hover { background: var(--skm-hover); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-menu-item[aria-checked="true"] { color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-menu-check {
  display: inline-grid; place-items: center; width: 14px; color: var(--skm-accent); opacity: 0;
}
.dsh-my-skill-manager-menu-item[aria-checked="true"] .dsh-my-skill-manager-menu-check { opacity: 1; }

`.trim()
