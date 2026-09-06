// ── styles (DSH semantic tokens, injected on activate, removed on teardown) ──
// Visual language follows the dsh-file-activity baseline (issue #54): flat
// surfaces, hairline borders, 24px circular icon buttons with hover fills,
// 8px-radius rows with hover fills, badge chips, and a role=switch toggle
// (track + sliding thumb, checked = success accent). All colors ride the
// --dsw-alias-* tokens; motion rides --ds-*.
// issue #69 重设计：标题区（标题+唯一刷新按钮）/ 分段控件 / 状态 chip /
// 折叠诊断条；移除路径输入相关样式。
const STYLES = `
.dsh-my-skill-manager-root { display:flex; flex-direction:column; gap:8px; padding:2px 6px 8px;
  font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); }
/* ── header: title + single refresh action (issue #69) ─────────────────── */
.dsh-my-skill-manager-header { display:flex; align-items:center; gap:8px; min-height:28px; }
.dsh-my-skill-manager-header-title { flex:1; min-width:0; font:var(--dsw-font-m-strong-16); color:var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-header-hint { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); }
/* 刷新按钮由官方 Button 提供视觉（issue #143 试点）；加载时图标旋转。 */
.dsh-my-skill-manager-spin { animation:dsh-my-skill-manager-spin 900ms linear infinite; }
@keyframes dsh-my-skill-manager-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
/* ── view switch: segmented control (全局 | 当前项目) ─────────────────────
   分段按钮由官方 Pill 提供视觉（issue #143 试点）；容器保留。 */
.dsh-my-skill-manager-switchseg { display:inline-flex; gap:2px; padding:2px; border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover); align-self:flex-start; }
.dsh-my-skill-manager-status { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); padding:4px 6px; }
.dsh-my-skill-manager-saved { color:var(--dsw-alias-state-success-primary); }
.dsh-my-skill-manager-error { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-state-error-primary); padding:4px 6px; white-space:pre-wrap; }
.dsh-my-skill-manager-section { display:flex; flex-direction:column; gap:2px; margin-top:4px; }
.dsh-my-skill-manager-section-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:2px 6px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary); text-transform:uppercase; letter-spacing:.04em; }
.dsh-my-skill-manager-section-title { font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-label-tertiary);
  text-transform:uppercase; letter-spacing:.04em; }
/* ── sort + unused filter bar (issue #91) ────────────────────────────────
   排序分段由官方 Pill 提供视觉（issue #143 试点）；「未使用」开启态经
   className 覆写为 warn 语义色（官方 Pill active 为 accent，过滤语义用 warn）。 */
.dsh-my-skill-manager-sortbar { display:inline-flex; align-items:center; gap:2px; }
.dsh-my-skill-manager-unused-on { color:var(--dsw-alias-state-warn-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-skill-manager-hint { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); padding:0 6px 4px; line-height:1.7; }
.dsh-my-skill-manager-empty { display:flex; flex-direction:column; align-items:center; gap:4px; padding:12px 6px;
  font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); line-height:1.7; }
.dsh-my-skill-manager-empty-icon { color:var(--dsw-alias-label-dimmed); }
.dsh-my-skill-manager-empty-hint { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-dimmed); }
.dsh-my-skill-manager-row { display:flex; flex-direction:column; gap:2px; padding:6px 8px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1); background:transparent;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out);
  animation:dsh-my-skill-manager-row-in 150ms var(--ds-ease-in-out); }
.dsh-my-skill-manager-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-skill-manager-row-disabled { opacity:.72; }
.dsh-my-skill-manager-row-head { display:flex; align-items:center; gap:6px; min-width:0; }
.dsh-my-skill-manager-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
/* ── not-cataloged badge (warn chip in the row head) ───────────────────────
   官方 Pill 承载（issue #143 试点）；仅覆写 warn 语义色（官方 Pill 中性底）。 */
.dsh-my-skill-manager-chip-warn { color:var(--dsw-alias-state-warn-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-skill-manager-desc { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-secondary); }
.dsh-my-skill-manager-row-source { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); margin-top:2px; }
.dsh-my-skill-manager-row-meta { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-dimmed); }
/* ── switch (role=switch): track + sliding thumb, checked = enabled ────────
   Off = neutral grey track, on = success accent; both thumb and track
   transition on --ds-transition-duration-slow. */
.dsh-my-skill-manager-switch { flex:none; width:34px; height:20px; padding:0; border:none; background:transparent; cursor:pointer; }
.dsh-my-skill-manager-switch-track { display:block; width:34px; height:20px; border-radius:10px;
  background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 25%, transparent);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-skill-manager-switch-thumb { display:block; width:16px; height:16px; margin:2px; border-radius:50%;
  background:var(--dsw-alias-label-tertiary);
  transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out), background var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-skill-manager-switch-on .dsh-my-skill-manager-switch-track { background:var(--dsw-alias-state-success-primary); }
.dsh-my-skill-manager-switch-on .dsh-my-skill-manager-switch-thumb { transform:translateX(14px); background:var(--dsw-alias-label-primary-foreground); }
.dsh-my-skill-manager-switch:hover:not(:disabled) .dsh-my-skill-manager-switch-track { background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 40%, transparent); }
.dsh-my-skill-manager-switch:hover:not(:disabled).dsh-my-skill-manager-switch-on .dsh-my-skill-manager-switch-track { background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 85%, var(--dsw-alias-label-tertiary)); }
.dsh-my-skill-manager-switch:disabled { opacity:.4; cursor:default; }
/* ── diagnostics: collapsible warn bar (issue #69) ──────────────────────── */
.dsh-my-skill-manager-diag { display:flex; flex-direction:column; gap:2px; margin-top:4px; }
.dsh-my-skill-manager-diag-bar { display:flex; align-items:center; gap:6px; padding:4px 8px; border-radius:8px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, var(--dsw-alias-border-l1));
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); cursor:pointer;
  font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-diag-badge { flex:none; display:inline-flex; align-items:center; height:17px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-strong-11); color:var(--dsw-alias-state-warn-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.dsh-my-skill-manager-diag-title { font:var(--dsw-font-xxs-strong-12); color:var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-diag-count { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-diag-chevron { margin-left:auto; color:var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-diag-body { display:flex; flex-direction:column; gap:2px; padding:2px 0 0 8px; }
.dsh-my-skill-manager-diag-row { display:flex; align-items:center; gap:6px; padding:4px 8px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1); background:transparent;
  animation:dsh-my-skill-manager-row-in 150ms var(--ds-ease-in-out); }
.dsh-my-skill-manager-diag-name { flex:none; font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-diag-reason { flex:none; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-state-warn-primary); }
.dsh-my-skill-manager-diag-path { flex:1; min-width:0; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
@keyframes dsh-my-skill-manager-row-in { from { opacity:0; transform:translateY(1px); } to { opacity:1; transform:none; } }
`.trim()

const STYLE_TAG = 'data-dsh-my-skill-manager'
