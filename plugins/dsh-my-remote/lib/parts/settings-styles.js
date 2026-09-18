// ── 设置页样式（issue #385）────────────────────────────────────────────────
// 只用宿主语义变量（--dsw-*），跟随深浅主题，不硬编码色值。
//
// 本文件是 part 片段（构建期拼接进 __ModuleLoader__ factory 作用域），无 import/export。

const MY_REMOTE_SETTINGS_STYLES = `
.dsh-my-remote-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-my-remote-section{display:flex;flex-direction:column;gap:8px}
.dsh-my-remote-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dsh-my-remote-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-remote-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-my-remote-label{font:var(--dsw-font-xs-strong-13)}
.dsh-my-remote-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dsh-my-remote-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-remote-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-my-remote-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-remote-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dsh-my-remote-input{flex:none;width:180px;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-remote-actions{display:flex;align-items:center;gap:8px}
.dsh-my-remote-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-remote-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-remote-btn-danger{color:var(--dsw-alias-state-error-primary)}
.dsh-my-remote-btn-danger:hover{border-color:var(--dsw-alias-state-error-primary)}
.dsh-my-remote-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-my-remote-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
.dsh-my-remote-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-remote-webhook-editor{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-remote-webhook-field{display:flex;flex-direction:column;gap:4px}
.dsh-my-remote-webhook-field-label{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dsh-my-remote-webhook-input{height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-remote-webhook-events{display:flex;flex-wrap:wrap;gap:6px}
.dsh-my-remote-webhook-event{display:flex;align-items:center;gap:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}
`
