// ── 样式（DSH 语义 token，随 activation 注入 / teardown 卸载）──────
// 前缀 dsh-my-guard-（issue #54：与 dsh-my-observability- 前缀分离，消除跨插件类名冲突）。
const STYLES = `
.dsh-my-guard-panel{display:flex;flex-direction:column;gap:10px;padding:2px 6px 8px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
.dsh-my-guard-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 6px 2px}
.dsh-my-guard-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dsh-my-guard-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;
  border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-guard-iconbtn svg{display:block}
.dsh-my-guard-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-my-guard-iconbtn:disabled{opacity:.4;cursor:default}
/* ── 告警时间线：卡片式告警行（类型图标 + 徽章 + 严重度 + 时间 + 消息 + 操作）── */
.dsh-my-guard-timeline{display:flex;flex-direction:column;gap:6px;max-height:calc(100vh - 320px);overflow-y:auto}
.dsh-my-guard-alert{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;
  animation:dsh-my-guard-row-in 150ms var(--ds-ease-in-out);
  transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-guard-alert-confirmed{opacity:.55}
.dsh-my-guard-alert-head{display:flex;align-items:center;gap:6px}
.dsh-my-guard-alert-icon{flex:none;display:flex;align-items:center}
.dsh-my-guard-icon-danger{color:var(--dsw-alias-state-error-primary)}
.dsh-my-guard-icon-warn{color:var(--dsw-alias-state-warn-primary)}
.dsh-my-guard-icon-info{color:var(--dsw-alias-state-info-primary)}
.dsh-my-guard-badge{flex:none;font:var(--dsw-font-xxxs-strong-11);border-radius:4px;padding:1px 6px}
.dsh-my-guard-badge-danger{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
.dsh-my-guard-badge-warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)}
.dsh-my-guard-badge-info{color:var(--dsw-alias-state-info-primary);background:color-mix(in srgb, var(--dsw-alias-state-info-primary) 14%, transparent)}
.dsh-my-guard-sev{flex:none;font:var(--dsw-font-xxxs-strong-11);border-radius:4px;padding:1px 6px}
.dsh-my-guard-sev-high{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}
.dsh-my-guard-sev-medium{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent)}
.dsh-my-guard-sev-low{color:var(--dsw-alias-state-info-primary);background:color-mix(in srgb, var(--dsw-alias-state-info-primary) 10%, transparent)}
.dsh-my-guard-time{flex:none;margin-left:auto;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dsh-my-guard-alert-msg{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);line-height:1.5;margin-top:4px;word-break:break-word}
.dsh-my-guard-alert-meta{font:var(--dsw-font-mono-xxs);font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5;margin-top:2px;word-break:break-all}
.dsh-my-guard-alert-explain{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.5;margin-top:2px;word-break:break-word}
.dsh-my-guard-alert-snippet{font:var(--dsw-font-mono-xxs);font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5;margin-top:2px;word-break:break-all}
.dsh-my-guard-alert-hint{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-dimmed);line-height:1.5;margin-top:2px}
.dsh-my-guard-alert-actions{display:flex;align-items:flex-end;justify-content:space-between;gap:6px;margin-top:4px}
.dsh-my-guard-alert-actions>.dsh-my-guard-alert-hint{flex:1;min-width:0;margin-top:0}
.dsh-my-guard-alert-confirmed{display:flex;align-items:center;gap:4px;font:var(--dsw-font-xxxs-strong-11);color:var(--dsw-alias-state-success-primary);margin-top:4px}
.dsh-my-guard-alert-confirmed svg{display:block;flex:none}
/* ── 按钮（图标 + 文字，hover/active/disabled 过渡）── */
.dsh-my-guard-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 12px;cursor:pointer;flex:none;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-guard-btn svg{display:block;flex:none}
.dsh-my-guard-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-guard-btn:active:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 55%, transparent)}
.dsh-my-guard-btn:disabled{opacity:.4;cursor:default}
.dsh-my-guard-btn-primary{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-interactive-primary);
  background:color-mix(in srgb, var(--dsw-alias-interactive-primary) 16%, transparent)}
.dsh-my-guard-btn-confirm{padding:2px 10px;font:var(--dsw-font-xxxs-strong-11)}
/* ── 状态区：loading / 空 / 错误 ── */
.dsh-my-guard-state{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-guard-state svg{flex:none;animation:dsh-my-guard-spin 1s linear infinite}
.dsh-my-guard-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:16px 8px;text-align:center;
  font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.7}
.dsh-my-guard-empty-icon{display:flex;color:var(--dsw-alias-state-success-primary)}
.dsh-my-guard-empty-hint{display:block;color:var(--dsw-alias-label-dimmed);font:var(--dsw-font-xxxs-11)}
.dsh-my-guard-error{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);
  color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;word-break:break-all;line-height:1.7}
.dsh-my-guard-error-text{flex:1;min-width:0}
@keyframes dsh-my-guard-row-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}
@keyframes dsh-my-guard-spin{to{transform:rotate(360deg)}}
/* ── 工具区块：扫描 / 注入检测 ── */
.dsh-my-guard-section{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}
.dsh-my-guard-tool-row{display:flex;gap:6px;align-items:center}
.dsh-my-guard-input{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;
  transition:border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-guard-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-my-guard-input:focus{outline:none;border-color:var(--dsw-alias-interactive-primary)}
.dsh-my-guard-input:disabled{opacity:.4;cursor:default}
.dsh-my-guard-tool-input{flex:1}
.dsh-my-guard-textarea{min-height:52px;resize:vertical;font:var(--dsw-font-xxs-12)}
.dsh-my-guard-feedback{display:flex;flex-direction:column;gap:4px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);word-break:break-all;line-height:1.5}
.dsh-my-guard-feedback-ok{flex-direction:row;align-items:center;gap:5px;color:var(--dsw-alias-state-success-primary)}
.dsh-my-guard-feedback-ok svg{display:block;flex:none}
.dsh-my-guard-feedback-error{color:var(--dsw-alias-state-error-primary)}
.dsh-my-guard-feedback-head{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary)}
.dsh-my-guard-issue{display:flex;flex-direction:column;gap:2px;border-radius:6px;padding:6px 8px;font:var(--dsw-font-xxs-12)}
.dsh-my-guard-issue-high{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)}
.dsh-my-guard-issue-medium{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent)}
.dsh-my-guard-issue-low{background:color-mix(in srgb, var(--dsw-alias-state-info-primary) 10%, transparent)}
.dsh-my-guard-issue-sev{font:var(--dsw-font-xxxs-strong-11);text-transform:uppercase}
.dsh-my-guard-issue-high .dsh-my-guard-issue-sev{color:var(--dsw-alias-state-error-primary)}
.dsh-my-guard-issue-medium .dsh-my-guard-issue-sev{color:var(--dsw-alias-state-warn-primary)}
.dsh-my-guard-issue-low .dsh-my-guard-issue-sev{color:var(--dsw-alias-state-info-primary)}
.dsh-my-guard-issue-rule{font:var(--dsw-font-mono-xxs);font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-my-guard-issue-msg{color:var(--dsw-alias-label-primary);line-height:1.5}
/* ── 自定义护栏规则 + 告警通知（issue #88）── */
.dsh-my-guard-rules-section{gap:8px}
.dsh-my-guard-rules-hint{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);line-height:1.6}
.dsh-my-guard-empty-rules{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);padding:4px 2px}
.dsh-my-guard-rule-list{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto}
.dsh-my-guard-rule-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-my-guard-rule-row .dsh-my-guard-input{flex:1;min-width:120px}
.dsh-my-guard-rule-select{flex:0 0 auto;width:86px}
.dsh-my-guard-rule-desc{flex:2}
.dsh-my-guard-notify-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.dsh-my-guard-check{display:inline-flex;align-items:center;gap:6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-my-guard-check input{accent-color:var(--dsw-alias-interactive-primary)}
.dsh-my-guard-cooldown{display:inline-flex;align-items:center;gap:6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}
.dsh-my-guard-cooldown-input{flex:0 0 auto;width:64px}
.dsh-my-guard-notify-hint{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dsh-my-guard-effective{color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxxs-strong-11)}
`

function injectStyles(): () => void {
  if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-my-guard', 'styles')
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style)
  }
}
