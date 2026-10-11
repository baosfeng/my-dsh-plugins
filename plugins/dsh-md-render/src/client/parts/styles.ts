// ── 样式（DSH 语义 token，随 activation 注入）── 只写自有 DOM 与自有 data-* 标记作用域；
// 不用 el.style、不覆盖官方类名外观（硬约束：不对官方元素写 style / class / aria）。
// 颜色 / 字体全部取宿主主题变量：正文与排版 --dsw-font-markdown-* / --dsw-alias-*；
// 语法着色取宿主 shiki token 表 --shiki-token-*（与官方代码块**同一份调色板**，深浅色
// 自动跟随），并带 --dsw-* 兜底，任何变量缺失都不会渲染成不可读的透明字。
const STYLES: string = `
/* ── 自研 markdown 渲染内容（.tzx-md 作用域）──
   own-markdown.ts 产出的 p / h1–h6 / ul / ol / table / blockquote / a / code 全部落在
   这个容器里，排版取宿主 markdown 字体 token，视觉与官方消息正文一致。 */
.tzx-md{position:relative;display:flex;flex-direction:column;gap:8px;min-width:0;font:var(--dsw-font-markdown-base);color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.tzx-md p{margin:0;font:var(--dsw-font-markdown-base)}
.tzx-md h1{font:var(--dsw-font-markdown-h1);margin:0}
.tzx-md h2{font:var(--dsw-font-markdown-h2);margin:0}
.tzx-md h3{font:var(--dsw-font-markdown-h3);margin:0}
.tzx-md h4{font:var(--dsw-font-markdown-h4);margin:0}
.tzx-md h5,.tzx-md h6{font:var(--dsw-font-markdown-base-strong);margin:0}
.tzx-md ul,.tzx-md ol{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:4px}
.tzx-md li{font:var(--dsw-font-markdown-base)}
.tzx-md li>p{margin:0}
.tzx-md blockquote{margin:0;padding:2px 0 2px 12px;border-left:3px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.tzx-md blockquote p{margin:0}
.tzx-md hr{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:4px 0;align-self:stretch}
.tzx-md a{color:var(--dsw-alias-link);text-decoration:none}
.tzx-md a:hover{text-decoration:underline}
.tzx-md strong{font:var(--dsw-font-markdown-base-strong)}
.tzx-md em{font:var(--dsw-font-markdown-base-italic)}
.tzx-md code.dsh-md-render-md-code{font:var(--dsw-font-markdown-code);background:var(--dsw-alias-markdown-inline-code);border-radius:4px;padding:1px 5px}
.tzx-md .dsh-md-render-md-link-plain{color:var(--dsw-alias-label-secondary)}
.tzx-md .dsh-md-render-md-img-alt{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-markdown-small)}
.tzx-md img.dsh-md-render-md-img{max-width:100%;height:auto;border-radius:6px}
.tzx-md .dsh-md-render-md-html{font:var(--dsw-font-markdown-base);color:var(--dsw-alias-label-secondary)}
.tzx-md .dsh-md-render-md-plain{margin:0;white-space:pre-wrap;word-break:break-word;font:var(--dsw-font-markdown-code-block);color:var(--dsw-alias-label-primary)}
.tzx-md .dsh-md-render-md-task{flex:none;margin:0 6px 0 0;accent-color:var(--dsw-alias-accent)}
.tzx-md .dsh-md-render-md-task-item{list-style:none;margin-left:-22px;display:flex;align-items:flex-start;gap:2px}
/* 表格：外层横向滚动（宽表格不撑破消息区），单元格用自有 class 控制对齐。 */
.tzx-md .dsh-md-render-md-table-wrap{overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
.tzx-md table.dsh-md-render-md-table{border-collapse:collapse;width:100%;font:var(--dsw-font-markdown-table)}
.tzx-md .dsh-md-render-md-table th,.tzx-md .dsh-md-render-md-table td{border-bottom:1px solid var(--dsw-alias-border-l1);padding:6px 10px;text-align:left;vertical-align:top}
.tzx-md .dsh-md-render-md-table th{font:var(--dsw-font-markdown-table-head);background:var(--dsw-alias-bg-layer-2)}
.tzx-md .dsh-md-render-md-table tbody tr:last-child td{border-bottom:0}
.tzx-md .dsh-md-render-md-left{text-align:left}
.tzx-md .dsh-md-render-md-center{text-align:center}
.tzx-md .dsh-md-render-md-right{text-align:right}
.dsh-md-render-fallback{margin:0;white-space:pre-wrap;font:var(--dsw-font-markdown-code-block-small);color:var(--dsw-alias-label-primary)}
/* ── 注入容器：围栏块按 markdown 渲染 ──
   block-render.ts 追加在 md-code-block 内；接管后隐藏官方全部直接子元素
   （banner 标签被宿主写死为「代码块」，对自研渲染的块是错误信息）；切回「源码」时自动恢复。 */
.dsh-md-render-text-md{padding:12px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-markdown-code-block)}
.md-code-block[data-dsh-md-render-text-view="markdown"]>:not([class*=dsh-md-render]):not(.tzx-md){display:none}
.md-code-block[data-dsh-md-render-text-view="code"]>:not([class*=dsh-md-render]):not(.tzx-md){display:none}
.md-code-block[data-dsh-md-render-text-view="source"]>.dsh-md-render-text-md{display:none}
.md-code-block[data-dsh-md-render-text-view="source"]>.dsh-md-render-code-host{display:none}
.dsh-md-render-text-toggle{display:inline-flex;align-items:center;align-self:flex-end;margin-top:4px;padding:2px 10px;font:var(--dsw-font-xxxs-11);line-height:20px;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;cursor:pointer;transition:color var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-text-toggle:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dsh-md-render-text-toggle[aria-pressed="true"]{color:var(--dsw-alias-accent-primary);border-color:var(--dsw-alias-accent-primary)}
/* ── 自研代码块（own-code.ts）：banner 显示**真实语言名** + 复制 + 自动换行 + 语法高亮 ── */
.dsh-md-render-code-host{display:block;min-width:0}
.dsh-md-render-code{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-markdown-code-block);overflow:hidden}
.dsh-md-render-code-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 10px;background:var(--dsw-alias-markdown-code-block-banner);border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-md-render-code-lang{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);letter-spacing:.02em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-md-render-code-actions{display:inline-flex;align-items:center;gap:6px;flex:none}
.dsh-md-render-code-copy{display:inline-flex;align-items:center;padding:1px 8px;font:var(--dsw-font-xxxs-11);line-height:18px;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;cursor:pointer;transition:color var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-code-copy:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dsh-md-render-code-pre{margin:0;padding:10px 12px;overflow:auto;max-height:70vh;white-space:pre-wrap;word-break:break-word;font:var(--dsw-font-markdown-code-block);color:var(--dsw-alias-label-primary);background:transparent}
.dsh-md-render-code-pre code{font:inherit;color:inherit;background:none;border:0;padding:0;white-space:inherit;word-break:inherit}
/* 语法着色：hljs 的 scope class → 宿主 shiki token 调色板（官方代码块同一份），全部带 --dsw-* 兜底。 */
.dsh-md-render-code-pre .hljs-keyword,.dsh-md-render-code-pre .hljs-selector-tag,.dsh-md-render-code-pre .hljs-literal,.dsh-md-render-code-pre .hljs-doctag,.dsh-md-render-code-pre .hljs-meta{color:var(--shiki-token-keyword,var(--dsw-alias-label-primary))}
.dsh-md-render-code-pre .hljs-string,.dsh-md-render-code-pre .hljs-regexp,.dsh-md-render-code-pre .hljs-symbol,.dsh-md-render-code-pre .hljs-bullet{color:var(--shiki-token-string,var(--dsw-alias-label-primary))}
.dsh-md-render-code-pre .hljs-comment,.dsh-md-render-code-pre .hljs-quote{color:var(--shiki-token-comment,var(--dsw-alias-label-tertiary));font-style:italic}
.dsh-md-render-code-pre .hljs-number,.dsh-md-render-code-pre .hljs-constant,.dsh-md-render-code-pre .hljs-built_in,.dsh-md-render-code-pre .hljs-type,.dsh-md-render-code-pre .hljs-class{color:var(--shiki-token-constant,var(--dsw-alias-label-primary))}
.dsh-md-render-code-pre .hljs-title,.dsh-md-render-code-pre .hljs-title.function_,.dsh-md-render-code-pre .hljs-title.class_,.dsh-md-render-code-pre .hljs-section,.dsh-md-render-code-pre .hljs-function{color:var(--shiki-token-function,var(--dsw-alias-label-primary))}
.dsh-md-render-code-pre .hljs-attr,.dsh-md-render-code-pre .hljs-attribute,.dsh-md-render-code-pre .hljs-variable,.dsh-md-render-code-pre .hljs-template-variable,.dsh-md-render-code-pre .hljs-params,.dsh-md-render-code-pre .hljs-property{color:var(--shiki-token-parameter,var(--dsw-alias-label-primary))}
.dsh-md-render-code-pre .hljs-punctuation{color:var(--shiki-token-punctuation,var(--dsw-alias-label-secondary))}
.dsh-md-render-code-pre .hljs-link,.dsh-md-render-code-pre .hljs-name,.dsh-md-render-code-pre .hljs-selector-id,.dsh-md-render-code-pre .hljs-selector-class{color:var(--shiki-token-link,var(--dsw-alias-link))}
.dsh-md-render-code-pre .hljs-addition{color:var(--dsw-alias-code-diff-added)}
.dsh-md-render-code-pre .hljs-deletion{color:var(--dsw-alias-code-diff-deleted)}
.dsh-md-render-code-pre .hljs-emphasis{font-style:italic}
.dsh-md-render-code-pre .hljs-strong{font-weight:600}
/* ── 上下文注入块（pre[data-context-text]）渲染容器 ──
   插在宿主 pre 之前，宿主 pre 置 hidden（React 拥有该子树，不改其子结构）。 */
.dsh-md-render-context-md{padding:0}
/* ── 整段 markdown 复制按钮 ── */
.dsh-md-render-copy{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;font:var(--dsw-font-xxxs-11);line-height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;cursor:pointer;opacity:0;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out),color var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.tzx-md>.dsh-md-render-copy{position:absolute;right:8px;bottom:8px}
.tzx-md:hover>.dsh-md-render-copy{opacity:1}
.dsh-md-render-copy:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dsh-md-render-copy-done{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
[data-streaming] .dsh-md-render-copy{display:none}
[data-streaming] .dsh-md-render-text-toggle{display:none}
/* ── mermaid 图表卡片（自有 DOM）── */
.dsh-md-render-mermaid-host{display:block;min-width:0}
.md-code-block[data-dsh-md-render-mermaid-view]>:not([class*=dsh-md-render]):not(.tzx-md){display:none}
.dsh-md-render-mermaid-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 12px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2);font:var(--dsw-font-s-14);line-height:22px;color:var(--dsw-alias-label-primary);animation:dsh-md-render-mermaid-card-in 150ms var(--ds-ease-in-out)}
.dsh-md-render-mermaid-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-md-render-mermaid-card-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.dsh-md-render-mermaid-export{display:inline-flex;gap:2px;flex:none}
.dsh-md-render-mermaid-eb{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l1);background:transparent;border-radius:6px;padding:2px 8px;cursor:pointer;font:var(--dsw-font-xxs-12);line-height:20px;color:var(--dsw-alias-label-secondary);transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-mermaid-eb svg{display:block;flex:none}
.dsh-md-render-mermaid-eb:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-md-render-mermaid-eb:disabled{opacity:.45;cursor:not-allowed}
.dsh-md-render-mermaid-notice{border-radius:6px;padding:4px 10px;font:var(--dsw-font-xxs-12);line-height:20px}
.dsh-md-render-mermaid-notice-ok{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-md-render-mermaid-notice-error{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-md-render-mermaid-card-title{display:flex;align-items:center;gap:5px;font:var(--dsw-font-xxxs-strong-11);color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em}
.dsh-md-render-mermaid-card-title svg{display:block;flex:none}
.dsh-md-render-mermaid-view-toggle{display:inline-flex;gap:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:2px;flex:none}
.dsh-md-render-mermaid-vt{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;border-radius:6px;padding:2px 8px;cursor:pointer;font:var(--dsw-font-xxs-12);line-height:20px;color:var(--dsw-alias-label-secondary);transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-mermaid-vt svg{display:block;flex:none}
.dsh-md-render-mermaid-vt:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-md-render-mermaid-vt-active{background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent);color:var(--dsw-alias-accent);font-weight:600}
.dsh-md-render-mermaid-svg{position:relative;overflow:auto;max-height:70vh;min-height:160px}
.dsh-md-render-mermaid-svg[data-dsh-md-render-zoom]{overflow:hidden}
.dsh-md-render-mermaid-canvas{transform-origin:0 0;display:flex;align-items:center;justify-content:center}
.dsh-md-render-mermaid-svg svg{max-width:100%;height:auto}
.dsh-md-render-mermaid-code{margin:0;background:var(--dsw-alias-markdown-code-block);border-radius:6px;padding:8px 12px;overflow:auto;font:var(--dsw-font-markdown-code-block-small);white-space:pre-wrap}
.dsh-md-render-mermaid-loading{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-mermaid-loading svg{flex:none;animation:dsh-md-render-mermaid-spin 1s linear infinite}
/* 失败态：源码是主视觉（第一屏），红横幅降为一行灰字提示（#470 需求 2） */
.dsh-md-render-mermaid-error{display:flex;flex-direction:column;gap:6px}
.dsh-md-render-mermaid-error-line{display:flex;align-items:center;gap:6px;font:var(--dsw-font-xxs-12);line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-mermaid-error-line svg{flex:none;color:var(--dsw-alias-state-error-primary)}
.dsh-md-render-mermaid-error-msg{white-space:pre-wrap;word-break:break-all}
.dsh-md-render-mermaid-retry{margin-left:auto;flex:none}
/* ── 「渲染为…」语言手动切换控件（自有 DOM）── hover / 键盘 focus-within / 触屏常显三路，
   作用域 = 自有块级标记，不碰官方 class。 */
.md-code-block[data-dsh-md-render-lang-switch]>.dsh-md-render-lang-switch{display:flex;justify-content:flex-end;margin-top:4px;opacity:0;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.md-code-block[data-dsh-md-render-lang-switch]:hover>.dsh-md-render-lang-switch{opacity:1}
.md-code-block[data-dsh-md-render-lang-switch]:focus-within>.dsh-md-render-lang-switch{opacity:1}
@media (hover:none){.md-code-block[data-dsh-md-render-lang-switch]>.dsh-md-render-lang-switch{opacity:1}}
/* ── 图表缩放 / 浮窗（需求 1，自有 DOM）──
   工具条按钮复用卡片按钮类；浮窗 = 页面内 <dialog> 模态（**非**浏览器全屏），
   卡片临时移入面板：遮罩 / Esc / 焦点归还 / 背景滚动锁定全由浏览器兜底。 */
.dsh-md-render-mermaid-zoom{display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap}
.dsh-md-render-mermaid-zoom-pct{display:inline-flex;align-items:center;justify-content:flex-end;min-width:40px;font:var(--dsw-font-xxs-12);line-height:20px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-md-render-mermaid-fs{display:flex;flex-direction:column;gap:6px;width:90vw;height:85vh;max-width:none;max-height:none;margin:auto;padding:8px 10px;border:0;border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2);font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary)}
.dsh-md-render-mermaid-fs::backdrop{background:rgba(0,0,0,.45)}
.dsh-md-render-mermaid-fs-bar{display:flex;justify-content:flex-end;gap:6px;flex:none}
.dsh-md-render-mermaid-fs>.dsh-md-render-mermaid-host{flex:1;min-height:0;display:flex;flex-direction:column}
.dsh-md-render-mermaid-fs .dsh-md-render-mermaid-card{flex:1;min-height:0;overflow:hidden;padding:0;border:0;box-shadow:none}
.dsh-md-render-mermaid-fs .dsh-md-render-mermaid-svg{max-height:none;flex:1;min-height:0}
/* ── 离屏渲染容器（失败时的炸弹图只落这里）── 必须在布局树内（display:none 会量不到尺寸）。 */
.dsh-md-render-offscreen{position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none}
@keyframes dsh-md-render-mermaid-card-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}
@keyframes dsh-md-render-mermaid-spin{to{transform:rotate(360deg)}}
`
