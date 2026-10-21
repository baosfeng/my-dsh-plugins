// ── 样式：代码围栏卡 + 交互件（B 路）──────────────────────────────────────
// 视觉真源 = docs/原型重构/dsh-md-render.html：
//   · 围栏块 1404–1600（卡 10px 圆角 + 1px 发丝边 / 头 32 / 语言胶囊 / 行号列 / code 11.5-1.65）
//   · render-mode 三态 1565–1619（底栏「渲染为…」：图表 / Markdown / 源码）
//   · 查看原文 1282–1322、思考块 1324–1410、上下文注入 1938–1990
// 颜色一律取宿主 --dsw-* 语义变量或 color-mix 派生（**禁裸十六进制**、禁 --shiki-token-*）；
// 几何 / 字号 / 间距 / 动效照原型取值。本文件只定义插件自建 .mdr-* 类名；宿主元素仅在
// 「接管态」（div.md-code-block[data-mdr-view]）下按属性选择器隐藏，不覆盖宿主类名外观。

/** 代码围栏 / 上下文块 / 灯箱 / 渲染方式控件的样式（styles.ts 聚合后注入）。 */
const STYLES_CODE: string = `
/* ══ 帧 token（局部定义：只在插件自建节点上生效，不外溢到官方元素）══ */
.mdr-fence,.mdr-block,.mdr-ctx,.mdr-lightbox,.mdr-lang-switch{
--mdr-frame-bg:var(--mdr-surface);
--mdr-frame-layer:var(--mdr-surface-raised);
--mdr-frame-line:var(--mdr-border);
--mdr-frame-hair:var(--mdr-border-soft);
--mdr-frame-ink:var(--mdr-text);
--mdr-frame-ink-2:var(--mdr-text-2);
--mdr-frame-ink-3:var(--mdr-text-3);
--mdr-frame-accent:var(--mdr-accent);
--mdr-frame-accent-soft:var(--mdr-accent-soft);
--mdr-frame-ok:var(--mdr-success);
--mdr-frame-bad:var(--mdr-danger);
--mdr-frame-mono:var(--mdr-font-mono);
--mdr-frame-fast:150ms;
--mdr-frame-ease:cubic-bezier(0.28,0,0.22,1);
/* 语法色：五色语义映射全部由宿主状态色向正文色混合得到（与官方 shiki 调色板无关） */
--mdr-frame-hl-key:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 88%,var(--dsw-alias-label-primary));
--mdr-frame-hl-str:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-label-primary));
--mdr-frame-hl-num:color-mix(in srgb,var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))) 70%,var(--dsw-alias-label-primary));
--mdr-frame-hl-com:color-mix(in srgb,var(--dsw-alias-label-tertiary) 78%,var(--dsw-alias-label-primary));
--mdr-frame-hl-fn:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 50%,var(--dsw-alias-label-primary));
--mdr-frame-hl-tag:var(--dsw-alias-state-success-primary);
--mdr-frame-hl-prop:var(--dsw-alias-label-primary);
}

/* ══ 围栏卡（原型 .fence：10px 圆角 + 1px 发丝边 + 代码底）══ */
.mdr-fence{display:flex;flex-direction:column;min-width:0;border:1px solid var(--mdr-frame-line);border-radius:var(--mdr-radius-lg);overflow:hidden;background:var(--mdr-frame-bg);font-family:var(--mdr-frame-mono);backdrop-filter:var(--mdr-material);box-shadow:var(--mdr-card-shadow)}
.mdr-fence-head{display:flex;align-items:center;gap:6px;height:32px;padding:0 6px 0 9px;background:var(--mdr-frame-head-bg);border-bottom:1px solid var(--mdr-frame-hair);min-width:0}
/* 语言胶囊：10px / 600 / 大写 / 字距 .06em（原型 .lang-pill 1432–1447） */
.mdr-fence-pill{display:inline-flex;align-items:center;height:19px;padding:0 7px;border-radius:var(--mdr-radius-sm);background:var(--mdr-frame-accent-soft);color:var(--mdr-frame-accent);font-family:var(--mdr-frame-mono);font-size:10px;font-weight:600;line-height:1;letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;flex:none}
/* 推断语言（内容识别 / 项目主语言兜底）：虚线边 + 透明底，「原文标注」与「推断」一眼可分；
   几何按 border-box 收进既有 19px 高，不改变头高与胶囊占位 */
.mdr-fence-pill.is-inferred{border:1px dashed color-mix(in srgb,var(--mdr-frame-accent) 52%,var(--mdr-frame-hair));background:transparent;box-sizing:border-box}
/* 推断胶囊的浮层朝下：卡是 overflow:hidden，朝上会被 32px 头裁掉；仍是同一套 [data-mdr-tip] 伪元素 */
.mdr-fence-pill.is-inferred[data-mdr-tip]::after{bottom:auto;top:calc(100% + 6px)}
.mdr-fence-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--mdr-frame-ink-3)}
.mdr-fence-actions{display:flex;align-items:center;gap:1px;margin-left:auto;flex:none}
.mdr-fence-action{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--mdr-frame-ink-3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background var(--mdr-frame-fast) var(--mdr-frame-ease),color var(--mdr-frame-fast) var(--mdr-frame-ease)}
.mdr-fence-action:hover{background:color-mix(in srgb,var(--mdr-frame-ink) 8%,transparent);color:var(--mdr-frame-ink)}
.mdr-fence-action.is-on{color:var(--mdr-frame-accent);background:var(--mdr-frame-accent-soft)}
.mdr-fence-action:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--mdr-frame-accent) 35%,transparent)}
.mdr-fence-copy{height:24px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--mdr-frame-ink-3);font-size:11px;cursor:pointer;opacity:0;transition:opacity var(--mdr-frame-fast) var(--mdr-frame-ease),color var(--mdr-frame-fast) var(--mdr-frame-ease)}
.mdr-fence:hover .mdr-fence-copy,.mdr-fence:focus-within .mdr-fence-copy,.mdr-fence-copy:focus-visible{opacity:1}
.mdr-copy.is-copied{opacity:1;color:var(--mdr-frame-ok)}
.mdr-copy.is-failed{opacity:1;color:var(--mdr-frame-bad)}
@media (hover:none){.mdr-fence-copy{opacity:1}}

/* ══ 代码主体：行号列 + pre（原型 .fence-body 1478–1524）══ */
.mdr-fence-body{display:flex;min-width:0;overflow-x:auto}
.mdr-line-nums{display:none;flex:none;padding:10px 4px 10px 10px;text-align:right;white-space:pre;color:var(--mdr-frame-ink-3);font-family:var(--mdr-frame-mono);font-size:11.5px;line-height:1.65;letter-spacing:0.02em;user-select:none;background:var(--mdr-frame-bg);border-right:1px solid var(--mdr-frame-hair)}
.mdr-fence[data-mdr-lines="on"] .mdr-line-nums{display:block}
.mdr-fence-code{margin:0;padding:10px 12px;min-width:0;font-family:var(--mdr-frame-mono);font-size:11.5px;line-height:1.65;color:var(--mdr-frame-ink-2);white-space:pre;tab-size:2}
.mdr-fence[data-mdr-wrap="on"] .mdr-fence-code{white-space:pre-wrap;word-break:break-word}
.mdr-fence[data-mdr-wrap="on"] .mdr-fence-body{overflow-x:hidden}
.mdr-fence-code .hl-key{color:var(--mdr-frame-hl-key)}
.mdr-fence-code .hl-str{color:var(--mdr-frame-hl-str)}
.mdr-fence-code .hl-num{color:var(--mdr-frame-hl-num)}
.mdr-fence-code .hl-com{color:var(--mdr-frame-hl-com);font-style:italic}
.mdr-fence-code .hl-fn{color:var(--mdr-frame-hl-fn)}
.mdr-fence-code .hl-tag{color:var(--mdr-frame-hl-tag)}
.mdr-fence-code .hl-prop{color:var(--mdr-frame-hl-prop)}

/* ══ 底栏 + 「渲染为…」三态（原型 .fence-foot / .render-mode 1526–1619）══ */
.mdr-fence-foot{display:flex;align-items:center;gap:6px;min-width:0;padding:5px 9px 6px;border-top:1px solid var(--mdr-frame-hair);background:var(--mdr-frame-bg);font-size:10px;color:var(--mdr-frame-ink-3)}
.mdr-fence-note{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdr-rm{display:inline-flex;align-items:center;gap:1px;margin-left:auto;padding:2px;border:1px solid var(--mdr-frame-line);border-radius:6px;background:var(--mdr-frame-layer);flex:none}
.mdr-rm-btn{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border:0;border-radius:4px;background:transparent;color:var(--mdr-frame-ink-3);font-size:10.5px;white-space:nowrap;cursor:pointer;transition:background var(--mdr-frame-fast) var(--mdr-frame-ease),color var(--mdr-frame-fast) var(--mdr-frame-ease)}
.mdr-rm-btn:hover{background:color-mix(in srgb,var(--mdr-frame-ink) 7%,transparent);color:var(--mdr-frame-ink)}
.mdr-rm-btn.is-active{background:var(--mdr-frame-bg);color:var(--mdr-frame-ink);font-weight:500}
.mdr-rm-btn:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--mdr-frame-accent) 35%,transparent)}
.mdr-lang-switch{display:flex;justify-content:flex-end}

/* ══ 上下文注入块（原型 .ctx-block 1938–1987）══ */
.mdr-ctx{display:flex;flex-direction:column;gap:6px;min-width:0;padding:9px 11px;border:1px dashed color-mix(in srgb,var(--mdr-frame-accent) 42%,var(--mdr-frame-line));border-radius:var(--mdr-radius-lg);background:color-mix(in srgb,var(--mdr-frame-accent) 4%,var(--mdr-bg));backdrop-filter:var(--mdr-material);box-shadow:var(--mdr-card-shadow)}
.mdr-ctx-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;font-size:10.5px;color:var(--mdr-frame-accent)}
.mdr-ctx-title{font-size:11px;font-weight:600}
.mdr-ctx-from{color:var(--mdr-frame-ink-3)}
.mdr-ctx-badge{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:4px;background:var(--mdr-frame-accent-soft);color:var(--mdr-frame-accent);font-size:10.5px;font-weight:500;line-height:1;white-space:nowrap;flex:none}
.mdr-ctx-body{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:11.5px;line-height:1.65;color:var(--mdr-frame-ink-2)}

/* ══ 图片灯箱（原生 dialog：遮罩 / Esc / 焦点归还由浏览器兜底）══ */
.mdr-lightbox{position:fixed;inset:0;display:grid;place-items:center;width:100vw;max-width:100vw;height:100vh;max-height:100vh;margin:0;padding:24px;border:0;background:transparent;overflow:visible}
.mdr-lightbox::backdrop{background:var(--dsw-alias-bg-mask-3,color-mix(in srgb,var(--mdr-frame-ink) 45%,transparent))}
.mdr-lightbox[open]{display:grid}
.mdr-lightbox-wrap{position:relative;display:inline-flex;max-width:88vw;max-height:82vh}
.mdr-lightbox-img{display:block;max-width:88vw;max-height:82vh;border-radius:var(--mdr-radius-lg);background:var(--mdr-frame-bg);box-shadow:0 18px 48px color-mix(in srgb,var(--mdr-frame-ink) 28%,transparent)}
.mdr-lightbox-close{position:absolute;top:-14px;right:-14px;width:32px;height:32px;padding:0;border:1px solid var(--mdr-frame-line);border-radius:50%;background:var(--mdr-frame-layer);color:var(--mdr-frame-ink-2);font-size:16px;line-height:1;cursor:pointer}
.mdr-lightbox-close:hover{color:var(--mdr-frame-ink);background:color-mix(in srgb,var(--mdr-frame-ink) 10%,var(--mdr-frame-layer))}
.mdr-lightbox-close:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--mdr-frame-accent) 35%,transparent)}

/* ══ 接管态：显示自建块、隐藏宿主原内容（不改宿主类名与节点）══ */
div.md-code-block[data-mdr-view] > :not(.mdr-block){display:none !important}
.mdr-block{display:block;min-width:0}
/* markdown 卡：与围栏卡同一帧，正文走 A 路的 .mdr-md */
.mdr-block-md{display:flex;flex-direction:column;min-width:0;border:1px solid var(--mdr-frame-line);border-radius:var(--mdr-radius-lg);overflow:hidden;background:var(--mdr-frame-bg);backdrop-filter:var(--mdr-material);box-shadow:var(--mdr-card-shadow)}
.mdr-block-md .mdr-block-body{padding:10px 12px;min-width:0}

/* ══ 复制兜底 textarea（不写 el.style：位置/隐藏全走类名）══ */
.mdr-copy-sink{position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none}

/* ══ 动效降级（原型 prefers-reduced-motion 全关）══ */
@media (prefers-reduced-motion:reduce){.mdr-fence *,.mdr-ctx *,.mdr-lightbox *,.mdr-lang-switch *{transition-duration:0ms !important;animation-duration:0ms !important}}
`

exports.STYLES_CODE = STYLES_CODE
