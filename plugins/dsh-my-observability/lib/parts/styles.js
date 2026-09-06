// ── 样式（DSH 语义 token，随 activation 注入 / teardown 卸载）──────
// 前缀 dsh-my-observability-（issue #54：与 dsh-my-guard 前缀分离，消除跨插件类名冲突）。
const STYLES = `
.dsh-my-observability-panel{display:flex;flex-direction:column;gap:10px;padding:2px 6px 8px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
.dsh-my-observability-toolbar{display:flex;flex-direction:column;gap:8px}
.dsh-my-observability-toolbar-row{display:flex;align-items:center;gap:6px}
.dsh-my-observability-select{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px}
.dsh-my-observability-select:disabled{opacity:.4;cursor:default}
.dsh-my-observability-input{flex:1;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px}
.dsh-my-observability-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-repo-row{display:flex;gap:8px;align-items:center}
.dsh-my-observability-repo-input{flex:1}
.dsh-my-observability-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;
  border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-observability-iconbtn svg{display:block}
.dsh-my-observability-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-my-observability-iconbtn:disabled{opacity:.4;cursor:default}
.dsh-my-observability-filters{display:flex;gap:6px;flex-wrap:wrap}
.dsh-my-observability-chip{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);background:transparent;
  border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;cursor:pointer;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-observability-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-my-observability-chip-active{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-interactive-primary);
  background:color-mix(in srgb, var(--dsw-alias-interactive-primary) 12%, transparent)}
/* ── 时间轴：左侧竖线 + 类型色节点圆点 + 类型图标行 ── */
.dsh-my-observability-timeline{display:flex;flex-direction:column;gap:2px;max-height:calc(100vh - 240px);overflow-y:auto;
  padding-left:14px;position:relative}
.dsh-my-observability-timeline::before{content:'';position:absolute;left:5px;top:8px;bottom:8px;width:2px;border-radius:1px;
  background:var(--dsw-alias-border-l2)}
.dsh-my-observability-event{position:relative;display:flex;align-items:flex-start;gap:8px;box-sizing:border-box;width:100%;
  margin:0;padding:5px 8px 5px 0;border:none;background:transparent;border-radius:8px;cursor:pointer;text-align:left;
  font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary);
  animation:dsh-my-observability-row-in 150ms var(--ds-ease-in-out);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-observability-event:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-observability-event:active{background:color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 55%, transparent)}
.dsh-my-observability-node{position:absolute;left:-14px;top:50%;transform:translateY(-50%);width:12px;height:12px;flex:none;
  box-sizing:border-box;border-radius:50%;background:var(--dsw-alias-bg-layer-2);border:2px solid var(--dsw-alias-label-tertiary)}
.dsh-my-observability-node-status{border-color:var(--dsw-alias-state-info-primary)}
.dsh-my-observability-node-llm{border-color:var(--dsw-alias-state-warn-primary)}
.dsh-my-observability-node-call{border-color:var(--dsw-alias-accent)}
.dsh-my-observability-node-plugin{border-color:var(--dsw-alias-state-info-primary)}
.dsh-my-observability-node-result{border-color:var(--dsw-alias-state-success-primary)}
.dsh-my-observability-node-fail{border-color:var(--dsw-alias-state-error-primary)}
.dsh-my-observability-event-icon{flex:none;display:flex;align-items:center;margin-top:1px}
.dsh-my-observability-icon-status{color:var(--dsw-alias-state-info-primary)}
.dsh-my-observability-icon-llm{color:var(--dsw-alias-state-warn-primary)}
.dsh-my-observability-icon-call{color:var(--dsw-alias-accent)}
.dsh-my-observability-icon-plugin{color:var(--dsw-alias-state-info-primary)}
.dsh-my-observability-icon-result{color:var(--dsw-alias-state-success-primary)}
.dsh-my-observability-icon-fail{color:var(--dsw-alias-state-error-primary)}
.dsh-my-observability-event-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dsh-my-observability-event-head{display:flex;align-items:center;gap:8px;justify-content:space-between}
.dsh-my-observability-badge{flex:none;font:var(--dsw-font-xxxs-strong-11);border-radius:4px;padding:1px 6px}
.dsh-my-observability-badge-status{color:var(--dsw-alias-state-info-primary);background:color-mix(in srgb, var(--dsw-alias-state-info-primary) 14%, transparent)}
.dsh-my-observability-badge-llm{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)}
.dsh-my-observability-badge-call{color:var(--dsw-alias-accent);background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent)}
.dsh-my-observability-badge-plugin{color:var(--dsw-alias-state-info-primary);background:color-mix(in srgb, var(--dsw-alias-state-info-primary) 14%, transparent)}
.dsh-my-observability-badge-result{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)}
.dsh-my-observability-badge-fail{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
.dsh-my-observability-time{flex:none;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dsh-my-observability-event-meta{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);line-height:1.6;word-break:break-word}
/* ── 插件事件详情展开（issue #154：原因/参数可查）── */
.dsh-my-observability-event-detail{display:flex;flex-direction:column;gap:2px;margin-top:4px;padding:6px 8px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}
.dsh-my-observability-detail-row{display:flex;gap:8px;font:var(--dsw-font-xxs-12);line-height:1.5;word-break:break-word}
.dsh-my-observability-detail-key{flex:none;font:var(--dsw-font-xxxs-strong-11);color:var(--dsw-alias-label-tertiary);min-width:56px}
.dsh-my-observability-detail-value{color:var(--dsw-alias-label-primary)}
/* ── 状态区：loading / 空 / 错误 ── */
.dsh-my-observability-state{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-state svg{flex:none;animation:dsh-my-observability-spin 1s linear infinite}
.dsh-my-observability-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:16px 8px;text-align:center;
  font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.7}
.dsh-my-observability-empty-icon{display:flex;color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-empty-hint{display:block;color:var(--dsw-alias-label-dimmed);font:var(--dsw-font-xxxs-11)}
.dsh-my-observability-error{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);
  color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;word-break:break-all;line-height:1.7}
.dsh-my-observability-error-text{flex:1;min-width:0}
@keyframes dsh-my-observability-row-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}
@keyframes dsh-my-observability-spin{to{transform:rotate(360deg)}}
/* ── 审计视图：搜索 / 组合过滤 / 导出 / 统计 / 高亮 ── */
.dsh-my-observability-search-row{display:flex;align-items:center;gap:6px}
.dsh-my-observability-search-row .dsh-my-observability-input{flex:1}
.dsh-my-observability-time-row{display:flex;align-items:center;gap:6px}
.dsh-my-observability-time-label{flex:none;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-time-input{flex:1;min-width:0}
.dsh-my-observability-mark{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent);
  color:var(--dsw-alias-label-primary);border-radius:2px;padding:0 1px}
.dsh-my-observability-export{display:flex;flex-direction:column;gap:6px}
.dsh-my-observability-stats{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l2);
  border-radius:6px;padding:8px}
.dsh-my-observability-stats-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dsh-my-observability-stats-table{width:100%;border-collapse:collapse;font:var(--dsw-font-xxs-12)}
.dsh-my-observability-stats-table th,.dsh-my-observability-stats-table td{text-align:left;padding:3px 6px;
  border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dsh-my-observability-stats-table th{font:var(--dsw-font-xxxs-strong-11);color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-stats-empty{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);padding:6px 2px}
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

function injectStyles() {
  if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-my-observability', 'styles')
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style)
  }
}
