// ── 样式（DSH 语义 token，随 activation 注入 / teardown 卸载）──────
// 前缀 dsh-my-observability-（issue #54：与 dsh-my-guard 前缀分离，消除跨插件类名冲突）。
// 轨迹回放面板移除后，其专属样式（时间轴 / 事件行 / 徽标 / 过滤 chip /
// 搜索与时间范围 / 导出 / 统计表）一并删除；保留资源面板、Git 面板、
// 状态区与设置页（设置页样式在 settings.js 片段内自带）。
const STYLES = `
.dsh-my-observability-panel{display:flex;flex-direction:column;gap:10px;padding:2px 6px 8px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
.dsh-my-observability-select{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px}
.dsh-my-observability-select:disabled{opacity:.4;cursor:default}
.dsh-my-observability-input{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px}
.dsh-my-observability-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-repo-row{display:flex;gap:8px;align-items:center}
.dsh-my-observability-repo-input{flex:1}
/* ── 状态区：loading / 空 / 错误 ── */
.dsh-my-observability-state{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-state svg{flex:none;animation:dsh-my-observability-spin 1s linear infinite}
.dsh-my-observability-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:16px 8px;text-align:center;
  font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.7}
@keyframes dsh-my-observability-spin{to{transform:rotate(360deg)}}
/* ── Git 面板 ── */
.dsh-my-observability-status{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-secondary)}
.dsh-my-observability-actions{display:flex;gap:8px;flex-wrap:wrap}
.dsh-my-observability-btn{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 12px;cursor:pointer;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-observability-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-observability-btn:disabled{opacity:.5;cursor:default}
.dsh-my-observability-btn-primary{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-interactive-primary);
  background:color-mix(in srgb, var(--dsw-alias-interactive-primary) 16%, transparent)}
.dsh-my-observability-section{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}
.dsh-my-observability-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dsh-my-observability-diff{max-height:240px;overflow:auto;font:var(--dsw-font-mono-xxs);font-size:11px;line-height:1.5;
  color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);
  border-radius:6px;padding:8px;white-space:pre-wrap;word-break:break-all}
.dsh-my-observability-form{display:flex;flex-direction:column;gap:6px}
.dsh-my-observability-type{flex:none;width:96px}
.dsh-my-observability-textarea{min-height:52px;resize:vertical;font:var(--dsw-font-xxs-12)}
.dsh-my-observability-feedback{font:var(--dsw-font-xxs-12);word-break:break-all;line-height:1.5}
.dsh-my-observability-feedback-ok{color:var(--dsw-alias-state-success-primary)}
.dsh-my-observability-feedback-error{color:var(--dsw-alias-state-error-primary)}
.dsh-my-observability-issue{display:flex;flex-direction:column;gap:2px;border-radius:6px;padding:6px 8px;font:var(--dsw-font-xxs-12)}
.dsh-my-observability-issue-error{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)}
.dsh-my-observability-issue-warning{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent)}
.dsh-my-observability-issue-info{background:color-mix(in srgb, var(--dsw-alias-state-info-primary) 10%, transparent)}
.dsh-my-observability-issue-sev{font:var(--dsw-font-xxxs-strong-11);text-transform:uppercase}
.dsh-my-observability-issue-error .dsh-my-observability-issue-sev{color:var(--dsw-alias-state-error-primary)}
.dsh-my-observability-issue-warning .dsh-my-observability-issue-sev{color:var(--dsw-alias-state-warn-primary)}
.dsh-my-observability-issue-info .dsh-my-observability-issue-sev{color:var(--dsw-alias-state-info-primary)}
.dsh-my-observability-issue-rule{font:var(--dsw-font-mono-xxs);font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-my-observability-issue-msg{color:var(--dsw-alias-label-primary);line-height:1.5}
.dsh-my-observability-review-ok{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-state-success-primary)}
.dsh-my-observability-ai{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.5;
  border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;padding:6px 8px}
/* ── 资源面板 ── */
.dsh-my-observability-resource{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;margin:0 0 8px}
.dsh-my-observability-resource-head{font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-primary);margin-bottom:6px}
.dsh-my-observability-resource-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px}
.dsh-my-observability-resource-metric{display:flex;justify-content:space-between;gap:8px;font:var(--dsw-font-xxs-12)}
.dsh-my-observability-resource-label{color:var(--dsw-alias-label-secondary)}
.dsh-my-observability-resource-value{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono-xxs)}
.dsh-my-observability-resource-alerts{margin-top:6px;display:flex;flex-direction:column;gap:4px}
.dsh-my-observability-resource-alert{font:var(--dsw-font-xxxs-11);border-radius:4px;padding:2px 6px}
.dsh-my-observability-resource-alert-error{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
.dsh-my-observability-resource-alert-warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}
`

function injectStyles(): () => void {
  if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-my-observability', 'styles')
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style)
  }
}
