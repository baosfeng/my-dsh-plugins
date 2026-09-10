// ── 样式（DSH 语义 token，随 activation 注入）───────────────────────
const STYLES = `
.dtr-panel{display:flex;flex-direction:column;gap:12px;padding:12px;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary)}
.dtr-section{display:flex;flex-direction:column;gap:8px}
.dtr-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dtr-switch-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dtr-switch-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dtr-switch-label{font:var(--dsw-font-xs-strong-13)}
.dtr-switch-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
/* issue #58: toggle 开关开/关一眼可分——关态灰色轨道（tertiary 混合，
   不再白底融入面板背景），开态圆点换对比墨色；与 dsh-my-notify / 
   dsh-my-skill-manager 的开关方案一致。开启色用 success-primary（绿色）：
   --dsw-alias-state-info-primary 在 DSH 主题中未定义（dsh-client-ui-theme
   仅定义 business/error/success/warn），var() 无效会渲染为透明（PR #63 实测） */
.dtr-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background 120ms var(--ds-ease-in-out),border-color 120ms var(--ds-ease-in-out)}
.dtr-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dtr-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform 120ms var(--ds-ease-in-out),background 120ms var(--ds-ease-in-out)}
.dtr-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dtr-task{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:4px}
.dtr-task-head{display:flex;align-items:center;gap:6px;min-width:0}
.dtr-badge{flex:none;font:var(--dsw-font-xxxs-strong-11);border-radius:4px;padding:1px 6px}
.dtr-badge-active{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent)}
.dtr-badge-checking{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)}
.dtr-badge-done{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)}
.dtr-badge-failed{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
.dtr-badge-paused{color:var(--dsw-alias-label-tertiary);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 14%, transparent)}
.dtr-task-desc,.dtr-desc{font:var(--dsw-font-xxs-12);line-height:1.5;word-break:break-word;color:var(--dsw-alias-label-primary)}
.dtr-task-meta{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dtr-actions{display:flex;gap:6px;flex-wrap:wrap}
.dtr-btn{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 10px;cursor:pointer}
.dtr-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dtr-question{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-layer-2)}
.dtr-question-text{font:var(--dsw-font-xxs-12);line-height:1.5}
.dtr-input{font:var(--dsw-font-xxs-12);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;width:100%;box-sizing:border-box}
.dtr-textarea{resize:vertical;min-height:44px;font:var(--dsw-font-xxs-12);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;width:100%;box-sizing:border-box}
.dtr-empty{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);padding:8px 0}
.dtr-answered{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
`

// ── 设置页样式（issue #27 配置可视化，随 slots 注册注入）─────────────
const SETTINGS_STYLES = `
.dtr-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dtr-settings-section{display:flex;flex-direction:column;gap:8px}
.dtr-settings-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dtr-settings-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dtr-settings-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dtr-settings-label{font:var(--dsw-font-xs-strong-13)}
.dtr-settings-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dtr-settings-input{flex:none;width:180px;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dtr-settings-actions{display:flex;align-items:center;gap:8px}
.dtr-settings-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dtr-settings-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
.dtr-settings-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
`
