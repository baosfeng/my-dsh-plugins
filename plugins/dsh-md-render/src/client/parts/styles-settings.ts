// ── 设置页样式（STYLES_SETTINGS）────────────────────────────────────────
// 视觉真源 = docs/原型重构/dsh-md-render.html（设置弹层 3843–4064 + CSS
// 2070–2356 的 **插件内容区**）。插件头部 / 双 tab / 分组头（图标 + 计数徽标）/
// 开关行 / 说明块 / 底部保存与恢复默认，几何字号逐条照原型。
//
// 口径：
//  · 颜色只取宿主 --dsw-* 语义变量或 color-mix 派生（禁裸十六进制）；
//  · 通用控件 .mdr-switch / .mdr-pill / .mdr-seg / .mdr-icon-btn 由 styles-base 定义，
//    这里只锁「设置行内」的排布；开关 44×26 是契约值（styles-base 同值），行内再声明
//    一次是为了防止宿主页面把通用控件挤变形；
//  · 状态全走属性 / [hidden] / aria，不在 JS 里碰 classList / cssText / el.style。
const STYLES_SETTINGS: string = `
/* ══ 根容器（宿主设置页里的插件内容区）══ */
.mdr-set{--mdr-set-line:var(--dsw-alias-border-l2);--mdr-set-line-soft:var(--dsw-alias-border-l1);--mdr-set-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-link));--mdr-set-accent-soft:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 12%,transparent);--mdr-set-surface:var(--dsw-alias-bg-layer-1);--mdr-set-elevated:var(--dsw-alias-bg-layer-2);--mdr-set-hover:var(--dsw-alias-interactive-bg-hover);--mdr-set-text:var(--dsw-alias-label-primary);--mdr-set-text-2:var(--dsw-alias-label-secondary);--mdr-set-text-3:var(--dsw-alias-label-tertiary);--mdr-set-danger:color-mix(in srgb,var(--dsw-alias-state-error-primary) 72%,var(--dsw-alias-label-primary));--mdr-set-motion:150ms;--mdr-set-ease:cubic-bezier(0.28,0,0.22,1);display:flex;flex-direction:column;min-height:0;color:var(--mdr-set-text)}
.mdr-set [hidden]{display:none}

/* ══ 插件头部：图标块 + 标题（包名徽标）+ 简介 + 状态徽标 ══ */
.mdr-set-head{display:flex;align-items:flex-start;gap:10px;padding:14px 20px 12px;border-bottom:1px solid var(--mdr-set-line-soft);flex:none}
.mdr-set-icon{width:34px;height:34px;border-radius:8px;background:var(--mdr-set-accent-soft);color:var(--mdr-set-accent);display:flex;align-items:center;justify-content:center;flex:none}
.mdr-set-info{flex:1;min-width:0}
.mdr-set-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:15px;font-weight:600;line-height:1.4}
.mdr-set-sub{margin:2px 0 0;font-size:11.5px;color:var(--mdr-set-text-3);line-height:1.5}
.mdr-set-meta{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end}

/* ══ 双 tab：渲染 / 关于（分段胶囊 + 右侧提示）══ */
.mdr-set-tabs{display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid var(--mdr-set-line-soft);flex:none;min-width:0}
.mdr-set-tabs .mdr-seg{padding:3px;border-radius:8px}
.mdr-set-tabs .mdr-seg-btn{height:26px;padding:0 12px;font-size:12px}
.mdr-set-tab-hint{margin-left:auto;font-size:11px;color:var(--mdr-set-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ══ 面板（可滚动）══ */
.mdr-set-panel{flex:1;min-height:0;overflow-y:auto;padding:14px 20px 18px}
.mdr-set-panel[hidden]{display:none}

/* ══ 分组：边框卡片 + 分组头（图标 + 标题 + 计数徽标）══ */
.mdr-set-group{border:1px solid var(--mdr-set-line);border-radius:10px;background:var(--mdr-set-surface);margin-bottom:12px;overflow:hidden}
.mdr-set-group-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--mdr-set-line-soft);background:var(--mdr-set-elevated);min-width:0;flex-wrap:wrap}
.mdr-set-group-head svg{flex:none;color:var(--mdr-set-accent)}
.mdr-set-group-head h3{margin:0;font-size:13px;font-weight:600;white-space:nowrap;line-height:1.4}
.mdr-set-group-head .mdr-pill{margin-left:auto}

/* ══ 开关行：标题 + 说明 + 右侧开关 ══ */
.mdr-set-row{display:flex;align-items:flex-start;gap:12px;padding:10px 14px;border-bottom:1px solid var(--mdr-set-line-soft);min-width:0}
.mdr-set-row:last-child{border-bottom:0}
.mdr-set-row-text{flex:1;min-width:0}
.mdr-set-row-title{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;color:var(--mdr-set-text);line-height:1.5;flex-wrap:wrap}
.mdr-set-row-desc{margin:2px 0 0;font-size:11px;color:var(--mdr-set-text-3);line-height:1.55;overflow-wrap:anywhere}
.mdr-set-row-desc code{font-size:10.5px}
.mdr-set-ctrl{display:flex;align-items:center;gap:6px;flex:none;padding-top:1px}
/* 开关行内锁定 44×26（契约值，与 styles-base 的 .mdr-switch 同值）*/
.mdr-set-row .mdr-switch{width:44px;height:26px;flex:none}

/* ══ 说明块（注入能力说明等）══ */
.mdr-set-note{margin:0 14px 10px;padding:8px 10px;border:1px solid var(--mdr-set-line-soft);border-radius:8px;background:var(--mdr-set-elevated);font-size:10.5px;color:var(--mdr-set-text-3);line-height:1.6}
.mdr-set-note strong{color:var(--mdr-set-text-2);font-weight:500}
.mdr-set-note code{font-size:10px}

/* ══ 底部操作：保存 / 恢复默认 / 已保存 / 说明 ══ */
.mdr-set-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:2px 2px 8px}
.mdr-set-save{height:32px;padding:0 14px;display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:8px;background:var(--mdr-set-accent);color:var(--dsw-alias-label-primary-foreground);font-size:12px;font-weight:500;cursor:pointer;transition:background var(--mdr-set-motion) var(--mdr-set-ease)}
.mdr-set-save:hover{background:color-mix(in srgb,var(--mdr-set-accent) 86%,var(--dsw-alias-label-primary-foreground))}
.mdr-set-save:disabled{opacity:0.4;cursor:default}
.mdr-set-reset{height:32px;padding:0 14px;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--mdr-set-line);border-radius:8px;background:transparent;color:var(--mdr-set-text);font-size:12px;cursor:pointer;transition:background var(--mdr-set-motion) var(--mdr-set-ease)}
.mdr-set-reset:hover{background:var(--mdr-set-hover)}
.mdr-set-save:focus-visible,.mdr-set-reset:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--mdr-set-accent) 35%,transparent)}
.mdr-set-saved{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;color:var(--dsw-alias-state-success-primary)}
.mdr-set-foot-hint{font-size:10.5px;color:var(--mdr-set-text-3);line-height:1.6;margin-left:auto;text-align:right}

/* ══ 加载 / 失败态 ══ */
.mdr-set-status{display:flex;align-items:center;gap:8px;padding:14px;font-size:12px;color:var(--mdr-set-text-3)}
.mdr-set-error{padding:10px 14px;border:1px solid color-mix(in srgb,var(--mdr-set-danger) 32%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);font-size:11.5px;color:var(--mdr-set-danger);line-height:1.6;margin-bottom:12px}
.mdr-set-error svg{margin-right:6px;vertical-align:-2px}

@media (prefers-reduced-motion:reduce){
.mdr-set-save,.mdr-set-reset{transition:none}
}
`
