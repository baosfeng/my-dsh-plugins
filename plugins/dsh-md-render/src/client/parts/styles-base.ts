// ── 设计系统底座（token + 通用控件 + 动效纪律）────────────────────────────
// 口径：本文件只提供「设计 token / 通用控件 / 动效 / 焦点环 / 滚动条」，
// markdown 内容样式在 styles-markdown.ts，两条路只共用这里的类名与变量。
//
// 颜色纪律（静态断言 test/mdr-styles.mjs 钉死）：
//   · 一律取宿主语义变量 --dsw-*，或用 color-mix(in srgb, …) 派生；
//   · **不写裸十六进制**、不用 --shiki-token-*（那是官方高亮的调色板）；
//   · 遮罩取宿主 --dsw-alias-bg-mask-3（深色态 label-primary 是近白，按比例混会得到白雾）。
//
// 几何 / 字号 / 间距 / 动效照原型 docs/原型重构/dsh-md-render.html（8–91、828–1035、1083–1113）。
// 本文件是 client 端的**脚本模式片段**（与 tsconfig.client.json 一致：无 import/export，
// 编译后注入 __ModuleLoader__ factory 作用域），因此用 `const` 而非 `export const`；
// 聚合器 styles.ts 直接按变量名拼接。
const STYLES_BASE: string = `
/* ══ 设计 token（只在自有根元素上定义：自定义属性不外溢到宿主元素）══ */
.mdr-root,.mdr-md{
/* ── 色彩 26 项（原型 9–38 的语义位 → 宿主语义色 / color-mix 派生）── */
--mdr-bg:var(--dsw-alias-bg-layer-1);
--mdr-bg-elevated:var(--dsw-alias-bg-layer-2);
--mdr-bg-hover:var(--dsw-alias-interactive-bg-hover);
--mdr-surface:color-mix(in srgb,var(--dsw-alias-markdown-code-block) 66%,transparent);
--mdr-surface-raised:color-mix(in srgb,var(--dsw-alias-markdown-code-block-banner) 58%,transparent);
--mdr-border:color-mix(in srgb,var(--dsw-alias-label-primary) 15%,transparent);
--mdr-border-soft:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);
--mdr-border-strong:color-mix(in srgb,var(--dsw-alias-label-primary) 26%,transparent);
--mdr-text:var(--dsw-alias-label-primary);
--mdr-text-2:var(--dsw-alias-label-secondary);
--mdr-text-3:var(--dsw-alias-label-tertiary);
--mdr-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-link));
--mdr-accent-hover:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 78%,var(--dsw-alias-label-primary));
--mdr-accent-soft:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 14%,transparent);
--mdr-on-accent:var(--dsw-alias-label-primary-foreground);
--mdr-success:var(--dsw-alias-state-success-primary);
--mdr-success-soft:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);
--mdr-warn:var(--dsw-alias-state-warn-label);
--mdr-warn-soft:color-mix(in srgb,var(--dsw-alias-state-warn-label) 14%,transparent);
--mdr-danger:var(--dsw-alias-state-error-primary);
--mdr-danger-soft:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);
--mdr-code-bg:var(--dsw-alias-markdown-inline-code);
--mdr-toast-bg:var(--dsw-alias-markdown-code-block-banner);
--mdr-overlay:var(--dsw-alias-bg-mask-3);
--mdr-shadow:var(--dsw-shadow-lv2);
--mdr-focus-ring:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 45%,transparent);
/* ── Liquid Glass 材质 / 排版 token（02-style §2 取值 + §5 清单）──
   全部带默认值：未接管 / 宿主主题不支持模糊时仍然可读（backdrop-filter 不支持即不生效）。 */
--mdr-font-sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue",Arial,sans-serif;
--mdr-font-mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
--mdr-material:blur(22px) saturate(180%);
--mdr-card-shadow:0 12px 32px color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent),inset 0 1px 0 color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);
--mdr-hairline:var(--mdr-border-soft);
--mdr-heading-weight:600;
--mdr-heading-tracking:-.015em;
--mdr-body-gap:12px;
--mdr-quote-bg:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 10%,transparent);
--mdr-quote-border:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 55%,transparent);
--mdr-table-head-bg:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 40%,transparent);
--mdr-frame-head-bg:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 34%,transparent);
/* ── 几何（原型 76–79）── */
--mdr-radius-sm:6px;
--mdr-radius-md:12px;
--mdr-radius-lg:14px;
--mdr-radius-pill:980px;
/* ── 字号阶梯（原型 80–83）── */
--mdr-fs-xs:12px;
--mdr-fs-sm:14px;
--mdr-fs-base:16px;
--mdr-fs-lg:18px;
/* ── 间距（原型 84–88：4/8/12/16/24，无 space-5）── */
--mdr-space-1:4px;
--mdr-space-2:8px;
--mdr-space-3:12px;
--mdr-space-4:16px;
--mdr-space-6:24px;
/* ── 动效（原型 89–90 + 设计基线 §五 的缓动）── */
--mdr-motion-fast:150ms;
--mdr-motion-base:220ms;
--mdr-ease:cubic-bezier(.28,0,.22,1);
color:var(--mdr-text-2);
font-family:var(--mdr-font-sans);
font-size:var(--mdr-fs-sm);
line-height:1.6;
}

/* ── 深色玻璃覆盖 ────────────────────────────────────────────────────────
   宿主信号（核对自参考源 deepseek-harness）：
   · body[data-ds-dark-theme]：packages/client/ui-layout/src/client/theme-presenter.ts:15 定义、:75-76 写入；
   · html.style.color-scheme：同文件 :71（boot-theme.ts:20-24 首屏也写）。
   颜色仍全部走 --dsw-* 派生；这里只调整透明度 / 阴影强度，不引入新色值。
   若无该属性（主题服务未就绪 / 宿主改契约），回落浅色取值，surface 66% 仍在 54% 红线之上。 */
body[data-ds-dark-theme] :is(.mdr-root,.mdr-md){
--mdr-surface:color-mix(in srgb,var(--dsw-alias-markdown-code-block) 62%,transparent);
--mdr-surface-raised:color-mix(in srgb,var(--dsw-alias-markdown-code-block-banner) 52%,transparent);
--mdr-card-shadow:0 14px 36px color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent),inset 0 1px 0 color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);
--mdr-table-head-bg:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);
--mdr-frame-head-bg:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);
}

/* ══ 通用控件（只有本文件定义，其他路只引用类名）══ */

/* 文字按钮：原型 .text-btn（828–877） */
.mdr-btn{
display:inline-flex;
align-items:center;
gap:var(--mdr-space-1);
height:24px;
padding:0 6px;
border:1px solid transparent;
border-radius:6px;
background:transparent;
color:var(--mdr-text-2);
font-size:11.5px;
line-height:1;
white-space:nowrap;
flex:none;
cursor:pointer;
transition:background var(--mdr-motion-fast) var(--mdr-ease),color var(--mdr-motion-fast) var(--mdr-ease),border-color var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-btn:hover:not(:disabled){background:var(--mdr-bg-hover);color:var(--mdr-text)}
.mdr-btn:disabled{opacity:.35;cursor:default}
.mdr-btn.is-on{background:var(--mdr-accent-soft);color:var(--mdr-accent)}
.mdr-btn.is-copied{color:var(--mdr-success)}
.mdr-btn>svg{width:12px;height:12px;flex:none}

/* 图标按钮：原型 .icon-btn（828–859）—— 决策 1：24×24，不用旧的 26 */
.mdr-icon-btn{
display:inline-flex;
align-items:center;
justify-content:center;
position:relative;
flex:none;
width:24px;
height:24px;
padding:0;
border:1px solid transparent;
border-radius:6px;
background:transparent;
color:var(--mdr-text-3);
cursor:pointer;
transition:background var(--mdr-motion-fast) var(--mdr-ease),color var(--mdr-motion-fast) var(--mdr-ease),opacity var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-icon-btn:hover:not(:disabled){background:var(--mdr-bg-hover);color:var(--mdr-text)}
.mdr-icon-btn:disabled{opacity:.35;cursor:default}
.mdr-icon-btn.is-on{background:var(--mdr-accent-soft);color:var(--mdr-accent)}
.mdr-icon-btn>svg{width:15px;height:15px;flex:none}

/* 分段控件：原型 .segmented / .seg-btn（1004–1035） */
.mdr-seg{
display:inline-flex;
align-items:center;
gap:2px;
padding:3px;
border:1px solid var(--mdr-border-soft);
border-radius:var(--mdr-radius-md);
background:var(--mdr-bg-elevated);
flex:none;
}
.mdr-seg-btn{
display:inline-flex;
align-items:center;
gap:6px;
height:26px;
padding:0 12px;
border:0;
border-radius:6px;
background:transparent;
color:var(--mdr-text-2);
font-size:12px;
line-height:1;
white-space:nowrap;
cursor:pointer;
transition:background var(--mdr-motion-fast) var(--mdr-ease),color var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-seg-btn:hover{background:var(--mdr-bg-hover);color:var(--mdr-text)}
.mdr-seg-btn.is-active{background:var(--mdr-accent-soft);color:var(--mdr-accent);font-weight:500}

/* 胶囊：原型 .pill（902–932） */
.mdr-pill{
display:inline-flex;
align-items:center;
gap:var(--mdr-space-1);
height:20px;
max-width:100%;
padding:0 7px;
border:1px solid var(--mdr-border-soft);
border-radius:10px;
background:var(--mdr-bg-elevated);
color:var(--mdr-text-2);
font-size:10.5px;
line-height:1;
white-space:nowrap;
flex:none;
}
.mdr-pill-accent{color:var(--mdr-accent);background:var(--mdr-accent-soft);border-color:transparent}
.mdr-pill-success{color:var(--mdr-success);background:var(--mdr-success-soft);border-color:transparent}

/* 开关：原型 .switch（963–1003）—— 44×26，20px 圆钮 translateX(18px) */
.mdr-switch{
position:relative;
flex:none;
width:44px;
height:26px;
padding:0;
border:1px solid var(--mdr-border);
border-radius:10px;
background:var(--mdr-surface-raised);
cursor:pointer;
transition:background var(--mdr-motion-fast) var(--mdr-ease),border-color var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-switch::after{
content:'';
position:absolute;
top:2px;
left:2px;
width:20px;
height:20px;
border-radius:50%;
background:var(--mdr-text-2);
transition:transform var(--mdr-motion-fast) var(--mdr-ease),background var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-switch[aria-checked='true']{background:var(--mdr-accent);border-color:var(--mdr-accent)}
.mdr-switch[aria-checked='true']::after{transform:translateX(18px);background:var(--mdr-on-accent)}
.mdr-switch:hover{border-color:var(--mdr-accent)}

/* 底部提示：原型 #toast（1050 一带的浮层形态） */
.mdr-toast{
position:fixed;
left:50%;
bottom:var(--mdr-space-6);
z-index:80;
max-width:min(420px,80vw);
padding:6px 12px;
border:1px solid var(--mdr-border);
border-radius:var(--mdr-radius-md);
background:var(--mdr-toast-bg);
color:var(--mdr-text);
font-size:12px;
line-height:1.4;
box-shadow:var(--mdr-shadow);
opacity:0;
pointer-events:none;
transform:translate(-50%,8px);
transition:opacity var(--mdr-motion-base) var(--mdr-ease),transform var(--mdr-motion-base) var(--mdr-ease);
}
.mdr-toast.is-on{opacity:1;transform:translate(-50%,0)}
.mdr-toast.is-warn{color:var(--mdr-warn);border-color:color-mix(in srgb,var(--mdr-warn) 45%,transparent)}

/* 浮层提示：原型 [data-tip]（1083–1113）—— ::after 取 attr，hover / focus 浮现 */
[data-mdr-tip]{position:relative}
[data-mdr-tip]::after{
content:attr(data-mdr-tip);
position:absolute;
left:50%;
bottom:calc(100% + 6px);
z-index:70;
padding:4px 7px;
border:1px solid var(--mdr-border);
border-radius:6px;
background:var(--mdr-surface-raised);
color:var(--mdr-text);
font-size:11px;
line-height:1.4;
white-space:nowrap;
box-shadow:var(--mdr-shadow);
opacity:0;
pointer-events:none;
transform:translate(-50%,4px);
transition:opacity var(--mdr-motion-fast) var(--mdr-ease),transform var(--mdr-motion-fast) var(--mdr-ease);
}
[data-mdr-tip]:hover::after,[data-mdr-tip]:focus-visible::after{opacity:1;transform:translate(-50%,0)}

/* ══ 焦点环（自有强调色光晕；宿主指针模态的全局规则抹不到自有规则）══ */
:is(.mdr-btn,.mdr-icon-btn,.mdr-seg-btn,.mdr-switch):focus-visible{
outline:2px solid var(--mdr-focus-ring);
outline-offset:1px;
}
.mdr-switch:focus-visible{outline:none;box-shadow:0 0 0 3px var(--mdr-accent-soft)}

/* ══ 滚动条（细、低对比：只在自有滚动容器上生效）══ */
.mdr-scroll{scrollbar-width:thin;scrollbar-color:var(--mdr-border) transparent}
.mdr-scroll::-webkit-scrollbar{width:8px;height:8px}
.mdr-scroll::-webkit-scrollbar-track{background:transparent}
.mdr-scroll::-webkit-scrollbar-thumb{background:var(--mdr-border);border-radius:var(--mdr-radius-pill)}
.mdr-scroll::-webkit-scrollbar-thumb:hover{background:var(--mdr-border-strong)}

/* ══ 动效纪律（设计基线 §五）══
   · hover / 微状态 = --mdr-motion-fast(150ms)；进入 UI = --mdr-motion-base(220ms)
   · 只动 transform / opacity；动效不作为状态变化的唯一信号
   · prefers-reduced-motion：全部关掉，不做「缩短式」妥协 */
@media (prefers-reduced-motion:reduce){
:where(.mdr-root,.mdr-md) *,:where(.mdr-root,.mdr-md) *::before,:where(.mdr-root,.mdr-md) *::after{
transition:none!important;
animation:none!important;
}
[data-mdr-tip]::after,.mdr-toast{transition:none!important}
}
`

exports.STYLES_BASE = STYLES_BASE
