'use strict'
const PANEL_STYLES = `
.dsh-my-notify-panel{container-type:inline-size;display:flex;flex-direction:column;height:100%;min-height:0;padding:2px 2px 0;color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:2px 2px 0}
.dsh-my-notify-p-kicker{margin:0 0 6px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);letter-spacing:.14em}
.dsh-my-notify-p-title{margin:0;font:var(--dsw-font-l-20);letter-spacing:-.01em}
.dsh-my-notify-p-lede{margin:6px 0 0;max-width:46ch;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);line-height:1.7}
.dsh-my-notify-p-head-side{display:flex;flex:none;flex-direction:column;align-items:flex-end;gap:8px}
.dsh-my-notify-p-meta{margin:0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);line-height:1.7;text-align:right}
.dsh-my-notify-p-ghost{min-height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-notify-p-ghost:hover{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-ghost:focus-visible{outline:2px solid var(--dsw-alias-accent);outline-offset:3px}
.dsh-my-notify-p-tabs{display:flex;gap:26px;margin:22px 2px 0;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto;scrollbar-width:none}
.dsh-my-notify-p-tabs::-webkit-scrollbar{display:none}
.dsh-my-notify-p-tab{position:relative;flex:none;min-height:44px;padding:0 1px 11px;border:0;background:none;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);cursor:pointer;white-space:nowrap}
.dsh-my-notify-p-tab::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;background:transparent}
.dsh-my-notify-p-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-tab[aria-selected="true"]::after{background:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-tab:hover{color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-tab:focus-visible{outline:2px solid var(--dsw-alias-accent);outline-offset:4px;border-radius:4px}
.dsh-my-notify-p-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:28px;flex:1;min-height:0;padding:20px 2px 0}
.dsh-my-notify-p-compose{min-width:0;min-height:0;overflow:auto;padding-right:4px}
.dsh-my-notify-p-preview{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:auto}
.dsh-my-notify-p-compose-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}
.dsh-my-notify-p-event{margin:0;font:var(--dsw-font-s-strong-14)}
.dsh-my-notify-p-event-sub{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-p-switch{display:inline-flex;align-items:center;gap:9px;min-height:44px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-notify-p-switch[data-static="true"]{cursor:default;color:var(--dsw-alias-label-tertiary)}
.dsh-my-notify-p-switch input{position:absolute;opacity:0;width:1px;height:1px;margin:0}
.dsh-my-notify-p-switch i{display:block;width:38px;height:22px;border-radius:999px;background:var(--dsw-alias-border-l3);transition:background .16s ease}
.dsh-my-notify-p-switch i::after{content:"";display:block;width:18px;height:18px;margin:2px;border-radius:50%;background:var(--dsw-alias-switch-thumb);box-shadow:0 1px 2px rgba(0,0,0,.18);transition:transform .16s ease}
.dsh-my-notify-p-switch input:checked+i{background:var(--dsw-alias-accent)}
.dsh-my-notify-p-switch input:checked+i::after{transform:translateX(16px)}
.dsh-my-notify-p-switch input:focus-visible+i{outline:2px solid var(--dsw-alias-accent);outline-offset:3px}
.dsh-my-notify-p-field{margin-bottom:14px}
.dsh-my-notify-p-label-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px}
.dsh-my-notify-p-label{display:block;margin-bottom:8px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-p-label-row .dsh-my-notify-p-label{margin-bottom:0}
.dsh-my-notify-p-hint{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11)}
.dsh-my-notify-p-input,.dsh-my-notify-p-textarea{width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);padding:0 12px;transition:border-color .16s ease,box-shadow .16s ease}
.dsh-my-notify-p-input{height:44px}
.dsh-my-notify-p-textarea{min-height:80px;padding:10px 12px;resize:vertical;font:var(--dsw-font-xs-13);line-height:1.65}
.dsh-my-notify-p-input:hover,.dsh-my-notify-p-textarea:hover{border-color:var(--dsw-alias-border-l3)}
.dsh-my-notify-p-input:focus,.dsh-my-notify-p-textarea:focus{outline:none;border-color:var(--dsw-alias-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-accent) 16%,transparent)}
.dsh-my-notify-p-vars{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:2px 0 16px}
.dsh-my-notify-p-vars-label{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);margin-right:2px}
.dsh-my-notify-p-var{min-height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer;transition:border-color .16s ease,color .16s ease}
.dsh-my-notify-p-var:hover{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-var:focus-visible{outline:2px solid var(--dsw-alias-accent);outline-offset:2px}
.dsh-my-notify-p-var-more{min-height:36px;padding:0 6px;border:0;background:none;color:var(--dsw-alias-link);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-notify-p-var-sheet{margin:-8px 0 18px;max-height:220px;overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dsh-my-notify-p-delivery{margin-top:2px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-my-notify-p-delivery-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:9px}
.dsh-my-notify-p-chips{display:flex;flex-wrap:wrap;gap:8px}
.dsh-my-notify-p-chip{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:transparent;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);cursor:pointer;transition:background .16s ease,border-color .16s ease,color .16s ease}
.dsh-my-notify-p-chip i{width:7px;height:7px;border-radius:50%;border:1.5px solid currentColor}
.dsh-my-notify-p-chip[aria-pressed="true"]{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-chip[aria-pressed="true"] i{background:var(--dsw-alias-accent);border-color:var(--dsw-alias-accent)}
.dsh-my-notify-p-chip:hover{border-color:var(--dsw-alias-border-l3)}
.dsh-my-notify-p-chip:focus-visible{outline:2px solid var(--dsw-alias-accent);outline-offset:3px}
.dsh-my-notify-p-ask{margin-top:14px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-my-notify-p-ask-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.dsh-my-notify-p-seg{min-height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-notify-p-seg[aria-selected="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-strong-12)}
.dsh-my-notify-p-preview-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 10px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-p-card-stage{width:100%}
.dsh-my-notify-p-card-skeleton{min-height:280px;display:grid;place-items:center;padding:16px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);text-align:center}
.dsh-my-notify-p-preview-status{margin:10px 0 0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);line-height:1.6}
.dsh-my-notify-p-preview-status[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}
.dsh-my-notify-p-dots{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-top:14px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-p-dot{width:20px;height:20px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:50%;cursor:pointer}
.dsh-my-notify-p-dot[data-tone="green"]{background:#33544a}
.dsh-my-notify-p-dot[data-tone="blue"]{background:#3a4a63}
.dsh-my-notify-p-dot[data-tone="orange"]{background:#7a5344}
.dsh-my-notify-p-dot[data-tone="grey"]{background:#3c3c39}
.dsh-my-notify-p-dot[aria-pressed="true"]{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1),0 0 0 3.5px var(--dsw-alias-label-tertiary)}
.dsh-my-notify-p-dot:focus-visible{outline:2px solid var(--dsw-alias-accent);outline-offset:3px}
.dsh-my-notify-p-auto{min-height:32px;padding:0 4px;border:0;background:none;color:var(--dsw-alias-link);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-notify-p-card-hint{margin:10px 0 0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);line-height:1.6}
.dsh-my-notify-p-actions{display:flex;align-items:center;gap:14px;flex:none;margin-top:6px;padding:12px 2px 2px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-my-notify-p-reset{min-height:36px;padding:0 4px;border:0;background:none;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-notify-p-reset:hover{color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-status{margin:0 auto 0 0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-p-status[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}
.dsh-my-notify-p-status[data-kind="ok"]{color:var(--dsw-alias-state-success-primary)}
.dsh-my-notify-p-btn{min-height:44px;padding:0 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);cursor:pointer}
.dsh-my-notify-p-btn:hover{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-btn-primary{padding:0 22px;border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground);font:var(--dsw-font-xs-strong-13)}
.dsh-my-notify-p-btn-primary:hover{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground);opacity:.88}
.dsh-my-notify-p-btn:focus-visible{outline:2px solid var(--dsw-alias-accent);outline-offset:3px}
.dsh-my-notify-p-drawer{position:fixed;inset:0;z-index:3000;display:flex;justify-content:flex-end}
.dsh-my-notify-p-drawer-scrim{position:absolute;inset:0;background:color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent)}
.dsh-my-notify-p-drawer-panel{position:relative;display:flex;flex-direction:column;width:min(640px,100%);height:100%;background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);box-shadow:-18px 0 48px rgba(0,0,0,.16)}
.dsh-my-notify-p-drawer-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-my-notify-p-drawer-title{margin:0;font:var(--dsw-font-s-strong-14)}
.dsh-my-notify-p-drawer-tabs{display:flex;gap:4px;padding:8px 18px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-my-notify-p-drawer-tab{min-height:40px;padding:0 12px;border:0;border-bottom:2px solid transparent;background:none;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);cursor:pointer}
.dsh-my-notify-p-drawer-tab[aria-selected="true"]{border-bottom-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary)}
.dsh-my-notify-p-drawer-body{flex:1;min-height:0;overflow:auto;padding:14px 18px 24px}
.dsh-my-notify-p-drawer-body .dsh-my-notify-toggle{width:38px;min-width:38px;height:22px;min-height:22px;border-radius:999px}
.dsh-my-notify-p-drawer-body .dsh-my-notify-toggle::after{top:3px;left:3px;width:16px;height:16px}
.dsh-my-notify-p-drawer-body .dsh-my-notify-toggle[data-on="true"]::after{transform:translateX(16px)}
.dsh-my-notify-p-drawer-close{margin-left:auto;min-height:40px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer}
@media (prefers-reduced-motion:reduce){.dsh-my-notify-panel *{transition:none!important}}
@container (max-width: 719px){
.dsh-my-notify-p-grid{grid-template-columns:minmax(0,1fr);gap:22px}
.dsh-my-notify-p-head-side{flex-direction:row;align-items:center}
.dsh-my-notify-p-preview{order:-1}
.dsh-my-notify-p-lede{max-width:none}
.dsh-my-notify-p-meta{display:none}
}
`
