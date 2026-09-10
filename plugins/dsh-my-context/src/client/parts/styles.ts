// ── 样式（DSH 语义 token，随 activation 注入 / teardown 卸载）──────
const STYLES: string = `
.dso-panel{display:flex;flex-direction:column;gap:10px;padding:12px;color:var(--dsw-alias-label-primary)}
.dso-toolbar{display:flex;flex-direction:column;gap:8px}
.dso-select{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px}
.dso-input{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px}
.dso-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dso-card{display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px}
.dso-card-head{display:flex;align-items:center;gap:8px;justify-content:space-between}
.dso-card-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dso-stat-row{display:flex;gap:8px;flex-wrap:wrap}
.dso-stat{display:flex;flex-direction:column;gap:2px;flex:1;min-width:90px}
.dso-stat-value{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dso-stat-label{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dso-comp{display:flex;flex-direction:column;gap:6px}
.dso-comp-row{display:flex;align-items:center;gap:8px}
.dso-comp-label{flex:none;width:64px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dso-comp-track{flex:1;height:10px;background:var(--dsw-alias-bg-layer-1);border-radius:5px;overflow:hidden}
.dso-comp-fill{height:100%;border-radius:5px}
.dso-comp-system{background:var(--dsw-alias-state-info-primary)}
.dso-comp-tools{background:var(--dsw-alias-state-warn-primary)}
.dso-comp-user{background:var(--dsw-alias-interactive-primary)}
.dso-comp-inject{background:var(--dsw-alias-state-error-primary)}
.dso-comp-assistant{background:var(--dsw-alias-state-success-primary)}
.dso-comp-tool{background:var(--dsw-alias-label-tertiary)}
.dso-comp-value{flex:none;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dso-timeline{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto}
.dso-request{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px}
.dso-request-head{display:flex;align-items:center;gap:8px;justify-content:space-between}
.dso-request-meta{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.6;margin-top:2px}
.dso-badge{flex:none;font:var(--dsw-font-xxxs-strong-11);border-radius:4px;padding:1px 6px}
.dso-badge-llm{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)}
.dso-badge-budget{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
.dso-time{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dso-empty{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);text-align:center;padding:16px 8px;line-height:1.7}
.dso-section{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}
.dso-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dso-repo-row{display:flex;gap:8px;align-items:center}
.dso-budget-input{flex:none;width:110px}
.dso-budget-mode{flex:none;width:96px}
.dso-btn{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 12px;cursor:pointer}
.dso-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dso-btn:disabled{opacity:.5;cursor:default}
.dso-btn-primary{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-interactive-primary);
  background:color-mix(in srgb, var(--dsw-alias-interactive-primary) 16%, transparent)}
.dso-feedback{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);word-break:break-all;line-height:1.5}
.dso-alert{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px}
.dso-alert-danger{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent)}
.dso-alert-warn{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent)}
.dso-alert-head{display:flex;align-items:center;gap:8px;justify-content:space-between}
.dso-alert-msg{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);line-height:1.5;margin-top:2px}
.dso-usage{display:flex;flex-direction:column;gap:4px}
.dso-usage-track{height:10px;background:var(--dsw-alias-bg-layer-1);border-radius:5px;overflow:hidden}
.dso-usage-fill{height:100%;border-radius:5px;transition:width .3s ease}
.dso-usage-normal{background:var(--dsw-alias-interactive-primary)}
.dso-usage-warn{background:var(--dsw-alias-state-warn-primary)}
.dso-usage-alert{background:var(--dsw-alias-state-error-primary)}
.dso-usage-critical{background:var(--dsw-alias-state-error-primary)}
.dso-usage-meta{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dso-overflow-normal{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)}
.dso-overflow-warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)}
.dso-overflow-alert{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
.dso-overflow-critical{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
.dso-suggest{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}
.dso-suggest-title{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);margin-bottom:4px}
.dso-suggest-list{margin:0;padding-left:18px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.6}
.dso-badge-overflow{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
`

function injectStyles(): () => void {
  if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-my-context', 'styles')
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style)
  }
}
