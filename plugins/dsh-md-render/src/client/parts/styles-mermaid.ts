// ── mermaid 卡片样式（STYLES_MERMAID）───────────────────────────────────
// 视觉真源 = docs/原型重构/dsh-md-render.html（.mm-card 段 1617–1937 / 全屏
// dialog 1850–1937）。几何 / 字号 / 间距逐条照原型；颜色**只取宿主语义变量**
// 或 color-mix 派生（禁裸十六进制、禁 --shiki-token-*），深浅主题自动跟随。
//
// 作用域纪律：本文件只写**自有类名**（.mdr-mm-*）与**自有 data-* 标记**；
// 通用控件（.mdr-icon-btn / .mdr-seg / .mdr-pill / .mdr-switch / [data-mdr-tip]）
// 由 styles-base.ts 定义，这里只在必要处锁行内尺寸，不重复定义外观。
// 状态切换一律走属性选择器（[data-mdr-mm-view] / [aria-pressed] / [aria-checked]
// / [hidden]），JS 侧不写 classList / cssText / el.style。
//
// 官方的围栏 <pre> 隐藏：块上的标记由 mermaid-scan 写（宿主块级标记是既有契约），
// 这里同时接受新口径 data-mdr-mm-block-view（集成窗口切换后自动生效）。
const STYLES_MERMAID: string = `
/* ══ 卡片作用域 token（自定义属性不外溢到宿主元素）══ */
.mdr-mm-card,.mdr-mm-dialog{
--mdr-mm-line:var(--dsw-alias-border-l2);
--mdr-mm-line-soft:var(--dsw-alias-border-l1);
--mdr-mm-accent:var(--mdr-accent,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)));
--mdr-mm-accent-soft:var(--mdr-accent-soft,color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 12%,transparent));
--mdr-mm-surface:var(--mdr-surface,var(--dsw-alias-markdown-code-block));
--mdr-mm-elevated:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 82%,var(--dsw-alias-markdown-code-block));
--mdr-mm-code-bg:var(--dsw-alias-markdown-inline-code);
--mdr-mm-hover:var(--dsw-alias-interactive-bg-hover);
--mdr-mm-text:var(--dsw-alias-label-primary);
--mdr-mm-text-2:var(--dsw-alias-label-secondary);
--mdr-mm-text-3:var(--dsw-alias-label-tertiary);
--mdr-mm-danger:color-mix(in srgb,var(--dsw-alias-state-error-primary) 72%,var(--dsw-alias-label-primary));
--mdr-mm-danger-soft:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);
--mdr-mm-scrim:var(--dsw-alias-bg-mask-3);
--mdr-mm-mono:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
--mdr-mm-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);
--mdr-mm-motion:150ms;--mdr-mm-motion-in:220ms;--mdr-mm-ease:cubic-bezier(0.28,0,0.22,1);
}

/* ══ 卡片外壳 ══ */
.mdr-mm-card{position:relative;display:flex;flex-direction:column;min-width:0;border:1px solid var(--mdr-mm-line);border-radius:var(--mdr-radius-lg,10px);background:var(--mdr-mm-surface);color:var(--mdr-mm-text);overflow:hidden;backdrop-filter:var(--mdr-material,none);box-shadow:var(--mdr-card-shadow,var(--mdr-mm-shadow));animation:mdr-mm-in var(--mdr-mm-motion-in) var(--mdr-mm-ease)}
@keyframes mdr-mm-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}

/* ══ 卡片头：标题胶囊 / 类型 / 工具条（7 8 7 10 + 发丝下边）══ */
.mdr-mm-head{display:flex;align-items:center;gap:7px;padding:7px 8px 7px 10px;border-bottom:1px solid var(--mdr-mm-line-soft);min-width:0;flex-wrap:nowrap}
.mdr-mm-title{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:var(--mdr-radius-sm,6px);background:var(--mdr-mm-accent-soft);color:var(--mdr-mm-accent);font-size:11px;font-weight:600;line-height:22px;white-space:nowrap;flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis}
.mdr-mm-kind{font-size:10px;color:var(--mdr-mm-text-3);white-space:nowrap;flex:none;overflow:hidden;text-overflow:ellipsis;max-width:104px}
.mdr-mm-toolbar{display:flex;align-items:center;gap:4px;margin-left:auto;flex:none}
/* 工具条按钮 24×24（原型 .icon-btn；外观在 styles-base，这里只锁卡片头尺寸） */
.mdr-mm-toolbar .mdr-icon-btn{width:24px;height:24px}
/* 视图分段：带文字「预览 / 代码」（原型 .segmented 紧凑档） */
.mdr-mm-toolbar .mdr-seg{padding:2px;border-radius:7px}
.mdr-mm-toolbar .mdr-seg-btn{height:20px;padding:0 8px;font-size:11px;border-radius:5px;gap:4px}

/* ══ 缩放分段：− 100% + 收在一个 24 高胶囊里 ══ */
.mdr-mm-zoom{display:inline-flex;align-items:center;gap:0;height:24px;border:1px solid var(--mdr-mm-line);border-radius:6px;overflow:hidden;background:var(--mdr-mm-elevated);flex:none}
.mdr-mm-zoom .mdr-icon-btn{width:22px;height:22px;border-radius:0}
.mdr-mm-zoom-val{min-width:42px;text-align:center;font-size:10.5px;color:var(--mdr-mm-text-2);font-variant-numeric:tabular-nums;padding:0 2px;border-left:1px solid var(--mdr-mm-line-soft);border-right:1px solid var(--mdr-mm-line-soft);line-height:22px;flex:none}

/* ══ 更多菜单：低频操作（导出 / 缩放模式 / 复制）══ */
.mdr-mm-menu{position:absolute;top:34px;right:8px;z-index:40;width:196px;padding:5px;background:var(--mdr-mm-elevated);border:1px solid var(--mdr-mm-line);border-radius:var(--mdr-radius-md,10px);box-shadow:var(--mdr-mm-shadow);display:flex;flex-direction:column;gap:1px}
.mdr-mm-menu[hidden]{display:none}
.mdr-mm-menu-item{display:flex;align-items:center;gap:8px;height:29px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--mdr-mm-text-2);font-size:11.5px;line-height:1;text-align:left;width:100%;white-space:nowrap;cursor:pointer;transition:background var(--mdr-mm-motion) var(--mdr-mm-ease),color var(--mdr-mm-motion) var(--mdr-mm-ease)}
.mdr-mm-menu-item:hover{background:var(--mdr-mm-hover);color:var(--mdr-mm-text)}
.mdr-mm-menu-item:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--mdr-mm-accent)}
.mdr-mm-menu-item[disabled]{opacity:0.4;cursor:default}
.mdr-mm-menu-item svg{flex:none;color:var(--mdr-mm-text-3)}
.mdr-mm-check{margin-left:auto;display:inline-flex;color:var(--mdr-mm-accent);flex:none}
.mdr-mm-menu-item[aria-checked="true"]{color:var(--mdr-mm-text)}
.mdr-mm-menu-sep{height:1px;background:var(--mdr-mm-line-soft);margin:4px 2px}
.mdr-mm-menu-label{font-size:10px;color:var(--mdr-mm-text-3);padding:5px 8px 2px;letter-spacing:0.04em}

/* ══ 卡片体：点阵底 + 14 内边距 + 最小高 190 ══ */
.mdr-mm-body{padding:14px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 1px 1px,var(--mdr-mm-line-soft) 1px,transparent 0) 0 0/16px 16px;min-height:190px;overflow:auto;position:relative}
.mdr-mm-canvas{display:flex;align-items:center;justify-content:center;width:100%}
.mdr-mm-canvas svg{max-width:100%;height:auto;color:var(--mdr-mm-text-2)}
/* 降级引擎（panzoom 不可用）用 SVG 宽高属性缩放，取消 max-width 封顶 */
.mdr-mm-body[data-mdr-mm-engine="attribute"] .mdr-mm-canvas svg{max-width:none}
.mdr-mm-md-fallback{padding:14px;min-height:190px;font-family:var(--mdr-mm-mono);font-size:11.5px;line-height:1.7;color:var(--mdr-mm-text-2);white-space:pre-wrap;overflow-wrap:anywhere}
.mdr-mm-error-src{margin:0;padding:10px 12px;border:1px solid var(--mdr-mm-line-soft);border-radius:6px;font-family:var(--mdr-mm-mono);font-size:11.5px;line-height:1.7;color:var(--mdr-mm-text-2);white-space:pre-wrap;overflow-wrap:anywhere;background:var(--mdr-mm-surface)}
.mdr-mm-code{margin:0;padding:14px;font-family:var(--mdr-mm-mono);font-size:11.5px;line-height:1.7;color:var(--mdr-mm-text-2);white-space:pre;overflow:auto;background:var(--mdr-mm-code-bg);min-height:190px;tab-size:2}
.mdr-mm-md{padding:14px;min-height:190px}

/* 三态视图：图表 / Markdown / 源码（属性驱动，不切 class） */
.mdr-mm-card[data-mdr-mm-view="source"] .mdr-mm-body,
.mdr-mm-card[data-mdr-mm-view="source"] .mdr-mm-md,
.mdr-mm-card[data-mdr-mm-view="markdown"] .mdr-mm-body,
.mdr-mm-card[data-mdr-mm-view="markdown"] .mdr-mm-code,
.mdr-mm-card[data-mdr-mm-view="diagram"] .mdr-mm-code,
.mdr-mm-card[data-mdr-mm-view="diagram"] .mdr-mm-md{display:none}

/* ══ 底栏：常显「渲染为… 图表 / Markdown / 源码」══ */
.mdr-mm-foot{display:flex;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid var(--mdr-mm-line-soft);font-size:10px;color:var(--mdr-mm-text-3);min-width:0;flex-wrap:wrap}
.mdr-mm-foot-label{flex:none}
.mdr-mm-modes{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--mdr-mm-line-soft);border-radius:6px;background:var(--mdr-mm-elevated)}
.mdr-mm-mode{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border:0;border-radius:4px;background:transparent;color:var(--mdr-mm-text-2);font-size:10.5px;line-height:1;cursor:pointer;white-space:nowrap;transition:background var(--mdr-mm-motion) var(--mdr-mm-ease),color var(--mdr-mm-motion) var(--mdr-mm-ease)}
.mdr-mm-mode:hover{background:var(--mdr-mm-hover);color:var(--mdr-mm-text)}
.mdr-mm-mode[aria-pressed="true"]{background:var(--mdr-mm-accent-soft);color:var(--mdr-mm-accent)}
.mdr-mm-mode:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--mdr-mm-accent)}
.mdr-mm-spacer{margin-left:auto}
.mdr-mm-meta{font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ══ 加载 / 失败态（失败态以源码为主视觉，原因降为一行）══ */
.mdr-mm-loading{display:flex;align-items:center;gap:8px;padding:14px;font-size:11.5px;color:var(--mdr-mm-text-3);min-height:190px}
.mdr-mm-loading svg{flex:none;animation:mdr-mm-spin 0.9s linear infinite}
@keyframes mdr-mm-spin{to{transform:rotate(360deg)}}
.mdr-mm-error{padding:14px;display:flex;flex-direction:column;gap:8px;min-height:190px;background:var(--mdr-mm-code-bg)}
.mdr-mm-error-msg{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid color-mix(in srgb,var(--mdr-mm-danger) 32%,transparent);border-radius:6px;background:var(--mdr-mm-danger-soft);font-size:11px;line-height:1.5;color:var(--mdr-mm-danger);overflow-wrap:anywhere}
.mdr-mm-error-msg svg{flex:none}
.mdr-mm-retry{margin-left:auto;flex:none}
.mdr-mm-notice{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--mdr-mm-line-soft);font-size:11px;line-height:1.5}
.mdr-mm-notice[data-mdr-mm-notice="ok"]{color:var(--dsw-alias-state-success-primary)}
.mdr-mm-notice[data-mdr-mm-notice="error"]{color:var(--mdr-mm-danger)}
.mdr-mm-notice svg{flex:none}

/* ══ 全屏浮窗：原生 <dialog>（90vw × 85vh + 遮罩）══ */
.mdr-mm-dialog{width:90vw;height:85vh;max-width:none;max-height:none;margin:auto;border:1px solid var(--mdr-mm-line);border-radius:var(--mdr-radius-lg,10px);background:var(--mdr-mm-elevated);color:var(--mdr-mm-text);padding:0;overflow:hidden;box-shadow:var(--mdr-mm-shadow)}
.mdr-mm-dialog::backdrop{background:var(--mdr-mm-scrim);backdrop-filter:blur(2px)}
.mdr-mm-dialog[open]{display:flex;flex-direction:column;animation:mdr-mm-in var(--mdr-mm-motion-in) var(--mdr-mm-ease)}
.mdr-mm-dialog-head{height:48px;flex:none;display:flex;align-items:center;gap:9px;padding:0 12px;border-bottom:1px solid var(--mdr-mm-line-soft);min-width:0}
.mdr-mm-dialog-path{font-size:10.5px;color:var(--mdr-mm-text-3);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdr-mm-dialog-actions{margin-left:auto;display:flex;align-items:center;gap:5px;flex:none}
.mdr-mm-dialog-body{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;padding:24px;background:radial-gradient(circle at 1px 1px,var(--mdr-mm-line-soft) 1px,transparent 0) 0 0/18px 18px}
.mdr-mm-dialog-body .mdr-mm-canvas svg{max-width:100%;max-height:100%;width:auto;height:auto}
.mdr-mm-dialog-body[data-mdr-mm-engine="attribute"] .mdr-mm-canvas svg{max-width:none;max-height:none}
.mdr-mm-dialog-foot{height:40px;flex:none;display:flex;align-items:center;gap:10px;padding:0 14px;border-top:1px solid var(--mdr-mm-line-soft);font-size:10.5px;color:var(--mdr-mm-text-3);flex-wrap:nowrap;min-width:0}
.mdr-mm-dialog-foot .mdr-mm-meta{overflow:hidden;text-overflow:ellipsis}

/* 官方围栏 <pre> 的隐藏（自有块级标记驱动；新口径标记一并接受）*/
.md-code-block[data-dsh-md-render-mermaid-view] pre,
.md-code-block[data-mdr-mm-block-view] pre{display:none}

/* 进动效 / 降级引擎的离屏渲染容器（量得到布局、看不见）*/
.mdr-mm-offscreen{position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none}

@media (prefers-reduced-motion:reduce){
.mdr-mm-card,.mdr-mm-dialog[open],.mdr-mm-loading svg{animation:none}
.mdr-mm-menu-item,.mdr-mm-mode{transition:none}
}
`
