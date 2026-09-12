// ── styles (DSH semantic tokens, injected on activate, removed on teardown) ──
// Mirrors the dsh-file-activity design language (issue #54): tight 2px 6px 8px
// body, 26px rows with hover fills, 24px circular icon buttons, two-line empty
// states, and motion on every state change. All colors ride the DSH semantic
// tokens (--dsw-alias-*), typography rides the font roles (--dsw-font-*).
const STYLES: string = `
.dsh-my-memory-root { display:flex; flex-direction:column; gap:8px; padding:2px 6px 8px;
  font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); }
.dsh-my-memory-toolbar { display:flex; flex-direction:column; gap:4px; }
.dsh-my-memory-pathbar { display:flex; gap:6px; align-items:center; }
/* 路径输入/加载/刷新按钮由官方 Input/Button 提供视觉（issue #143 试点）；
   仅保留布局微调：路径输入 wrapper 撑满剩余宽度。 */
.dsh-my-memory-path-input { flex:1; min-width:0; }
.dsh-my-memory-iconbtn { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0;
  border:none; border-radius:50%; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; flex:none;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-iconbtn svg { display:block; }
.dsh-my-memory-iconbtn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.dsh-my-memory-iconbtn:disabled { opacity:.4; cursor:default; }
.dsh-my-memory-iconbtn-danger:hover:not(:disabled) { color:var(--dsw-alias-state-error-primary); }
.dsh-my-memory-status { display:flex; align-items:center; gap:5px; font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); }
.dsh-my-memory-status svg { display:block; flex:none; }
.dsh-my-memory-loading { padding:4px 2px; }
.dsh-my-memory-spinner { display:inline-block; width:12px; height:12px; border-radius:50%; flex:none;
  border:2px solid color-mix(in srgb, var(--dsw-alias-accent) 30%, transparent); border-top-color:var(--dsw-alias-accent);
  animation:dsh-my-memory-spin 800ms linear infinite; }
.dsh-my-memory-saved { color:var(--dsw-alias-state-success-primary); }
.dsh-my-memory-error { display:flex; align-items:center; gap:6px; font:var(--dsw-font-xxs-12);
  color:var(--dsw-alias-state-error-primary); white-space:pre-wrap; }
.dsh-my-memory-sections { display:flex; flex-direction:column; gap:8px; }
.dsh-my-memory-section { display:flex; flex-direction:column; gap:6px; padding:8px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); }
/* The project scope gets a subtle accent border (keeps the two scopes
    distinguishable without breaking the neutral baseline — 之前 45% 边框 +
   6% 底色过于抢眼，弱化为 28% 描边 + 中性底). */
.dsh-my-memory-section-project { border-color:color-mix(in srgb, var(--dsw-alias-accent) 28%, transparent); }
.dsh-my-memory-section-head { display:flex; align-items:center; gap:8px; }
.dsh-my-memory-section-title { font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
/* 分区徽标由官方 Pill 提供视觉（issue #143 试点）；排序 Pill 仅保留靠右布局。 */
.dsh-my-memory-sort { margin-left:auto; }
.dsh-my-memory-note { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); line-height:1.7; }
.dsh-my-memory-empty { display:flex; align-items:flex-start; gap:8px; padding:12px 10px;
  font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); }
.dsh-my-memory-empty-body { display:flex; flex-direction:column; gap:2px; }
.dsh-my-memory-empty-main { font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
.dsh-my-memory-empty-icon { display:inline-flex; margin-top:1px; color:var(--dsw-alias-label-dimmed); }
.dsh-my-memory-empty-hint { color:var(--dsw-alias-label-dimmed); font:var(--dsw-font-xxxs-11); line-height:1.7; }
/* 条目卡片化：背景 + 边框 + 圆角，与内容视觉分离；hover 高亮边框（issue #110）。 */
.dsh-my-memory-row { display:flex; flex-direction:column; gap:4px; box-sizing:border-box; width:100%; min-height:26px;
  margin:0; padding:8px 10px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2);
  border-radius:6px;
  transition:border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out), background var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-row:hover { border-color:color-mix(in srgb, var(--dsw-alias-accent) 40%, transparent);
  background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-memory-row-editing { border-color:var(--dsw-alias-accent); }
.dsh-my-memory-row-head { display:flex; align-items:center; gap:8px; }
.dsh-my-memory-row-desc-wrap { display:flex; align-items:center; gap:4px; flex:1; min-width:0; }
.dsh-my-memory-desc { flex:1; min-width:0; font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); word-break:break-word; }
.dsh-my-memory-expand { display:inline-flex; align-items:center; gap:3px; flex:none; height:20px; padding:0 6px; border-radius:4px;
  cursor:pointer; border:none; background:transparent; color:var(--dsw-alias-accent); font:var(--dsw-font-xxxs-11);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-expand svg { display:block; flex:none; transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-expand-open svg { transform:rotate(180deg); }
.dsh-my-memory-expand:hover { background:var(--dsw-alias-interactive-bg-hover); }
/* 操作区：统一右侧图标组，与内容用分隔线分离；删除 hover 保持红色警示。 */
.dsh-my-memory-actions { display:flex; align-items:center; gap:2px; flex:none; padding-left:8px;
  border-left:1px solid var(--dsw-alias-border-l2); }
.dsh-my-memory-meta { display:flex; align-items:center; gap:4px; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); }
.dsh-my-memory-meta-icon { display:inline-flex; color:var(--dsw-alias-label-dimmed); }
.dsh-my-memory-addbar { display:flex; gap:6px; align-items:center; }
.dsh-my-memory-addbar-wrap { display:flex; flex-direction:column; gap:3px; }
.dsh-my-memory-entry-hint { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-state-warn-primary);
  line-height:1.7; padding:0 2px; }
/* 新增/编辑输入由官方 Input 提供视觉（issue #143 试点）；仅保留撑满布局。 */
.dsh-my-memory-add-input { flex:1; min-width:0; }
.dsh-my-memory-btn-save { display:inline-flex; align-items:center; gap:5px; height:28px; padding:0 12px; border-radius:6px; cursor:pointer;
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color:var(--dsw-alias-state-success-primary); font:var(--dsw-font-xxs-12);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-btn-save svg { display:block; flex:none; }
.dsh-my-memory-btn-save:hover:not(:disabled) { background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent); }
.dsh-my-memory-btn-save:disabled { opacity:.4; cursor:default; }
.dsh-my-memory-confirm { display:flex; flex-direction:column; gap:6px; padding:8px 10px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1); animation:dsh-my-memory-row-in 150ms var(--ds-ease-in-out); }
.dsh-my-memory-confirm-save { border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent); }
.dsh-my-memory-confirm-delete { border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.dsh-my-memory-confirm-head { display:flex; align-items:center; gap:6px; }
.dsh-my-memory-confirm-head svg { display:block; flex:none; }
.dsh-my-memory-confirm-text { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-primary); }
.dsh-my-memory-confirm-desc { font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); word-break:break-word; }
.dsh-my-memory-confirm-summary { display:flex; flex-direction:column; gap:2px; padding:4px 6px; border-radius:4px;
  background:color-mix(in srgb, var(--dsw-alias-accent) 8%, transparent); }
.dsh-my-memory-confirm-summary-label { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); }
.dsh-my-memory-confirm-summary-text { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-secondary); word-break:break-word; }
.dsh-my-memory-confirm-actions { display:flex; gap:6px; align-items:center; }
.dsh-my-memory-confirm-ok { display:inline-flex; align-items:center; gap:5px; height:26px; padding:0 12px; border-radius:6px; cursor:pointer;
  font:var(--dsw-font-xxs-12);
  transition:filter var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-confirm-ok svg { display:block; flex:none; }
.dsh-my-memory-confirm-ok-save { border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, transparent);
  background:var(--dsw-alias-state-success-primary); color:var(--dsw-alias-label-primary-foreground); }
.dsh-my-memory-confirm-ok-delete { border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent);
  background:var(--dsw-alias-state-error-primary); color:var(--dsw-alias-label-primary-foreground); }
.dsh-my-memory-confirm-ok:hover { filter:brightness(1.1); }
.dsh-my-memory-confirm-cancel { display:inline-flex; align-items:center; gap:5px; height:26px; padding:0 12px; border-radius:6px; cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1); background:transparent; color:var(--dsw-alias-label-secondary);
  font:var(--dsw-font-xxs-12);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-confirm-cancel svg { display:block; flex:none; }
.dsh-my-memory-confirm-cancel:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
@keyframes dsh-my-memory-row-in { from { opacity:0; transform:translateY(1px); } to { opacity:1; transform:none; } }
@keyframes dsh-my-memory-spin { to { transform:rotate(360deg); } }
/* ── issue #78 渐进式索引记忆：候选区块 + 元数据徽标 + 演进历史 ── */
.dsh-my-memory-candidates { display:flex; flex-direction:column; gap:6px; padding:8px; border-radius:8px;
  border:1px dashed color-mix(in srgb, var(--dsw-alias-accent) 45%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-accent) 4%, var(--dsw-alias-bg-layer-1)); }
.dsh-my-memory-row-candidate { border-style:dashed; }
.dsh-my-memory-ct-badge { flex:none; display:inline-flex; align-items:center; height:16px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-accent);
  background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent); }
.dsh-my-memory-conf-badge { flex:none; display:inline-flex; align-items:center; height:16px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); }
.dsh-my-memory-conflict-badge { flex:none; display:inline-flex; align-items:center; height:16px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-state-warn-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 15%, transparent); }
.dsh-my-memory-source-badge { flex:none; display:inline-flex; align-items:center; height:16px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary);
  background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); }
.dsh-my-memory-meta-sep { color:var(--dsw-alias-label-dimmed); }
.dsh-my-memory-history-entry { display:inline-flex; font:var(--dsw-font-xxxs-11);
  color:var(--dsw-alias-label-tertiary); }
.dsh-my-memory-iconbtn-confirm:hover:not(:disabled) { color:var(--dsw-alias-state-success-primary); }
`.trim()

const STYLE_TAG: string = 'data-dsh-my-memory'

// 导出给其他 part 文件使用
