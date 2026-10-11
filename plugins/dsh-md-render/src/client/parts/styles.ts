// ── 样式（**本插件自有的视觉语言**，随 activation 注入）────────────────────
// 口径（最高优先级）：「全部使用我们自己的，外观也是」—— 本文件**不再对齐官方视觉**：
// 布局 / 形状 / 间距 / 层级 / 边框 / 圆角 / 强调方式全部由本插件自己设计，官方样式只作为
// 「颜色与主题来源」被读取（--dsw-alias-* 语义色随深浅色自动切换，绝不硬编码十六进制）。
//
// 设计语言（一眼可辨的辨识点）：
//  ① **胶囊**：语言名 / 卡片标题 = 强调色 + 大写 + 字距的胶囊标签（官方是 11px 灰字标签）；
//     所有插件控件（复制 / 查看原文 / 导出 / 视图切换）统一为胶囊按钮，focus-visible 走
//     自家强调色描边 + 光晕（官方只给 2px 官方描边，指针模态下还会被宿主全局规则抹掉）。
//  ② **强调竖条**：代码卡片左侧 3px 强调色竖线、markdown 卡片左侧 2px 淡强调线、
//     h1 左侧 3px 竖线、引用块左侧 3px 竖线 —— 同一条"我们渲染的"视觉线索。
//  ③ **头部不再是通栏灰带**：语言胶囊 + 右侧 hover/focus 才浮现的复制按钮，
//     头部只留一层 5% 强调色薄底 + 一条发丝分隔线，与代码区同属一个圆角容器。
//  ④ **自有排版尺度**：正文 14px/1.75、标题 20/17/15.5/14.5/13.5/12（h6 大写小字），
//     代码 12.5px/1.7 等宽（官方 11px/19px）——不再使用 --dsw-font-markdown-* 排版 shorthand。
//  ⑤ **自有语法配色**：五色语义映射（蓝=关键字/紫罗兰?见下）全部由宿主状态色向正文色混合得到，
//     对比度不低于官方 shiki 调色板（实测见报告），且与块的强调色同源。
// 硬约束（test/static-assertions.mjs 钉死）：只写自有 DOM 与自有 data-* 作用域；不用 el.style；
// 不覆盖官方类名外观（官方子树的隐藏仍走「自有 CSS + 自有 data-* 视图值」那条既有路径）。
// 语法着色不再取 --shiki-token-*（那是官方 shiki 的调色板，逐 token 对齐等于照抄官方外观）；
// 改由本插件自己的语义映射 + color-mix 向正文色收敛，任何主题下都有对比度兜底。
const STYLES: string = `
/* ══ 设计 token（只在自有根元素上定义：自定义属性不会外溢到官方元素）══ */
.tzx-md,.dsh-md-render-text-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.dsh-md-render-lang-switch,.dsh-md-render-text-toggle,.dsh-md-render-copy,.dsh-md-render-mermaid-fs,.dsh-md-render-fallback{
--mdr-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-link));
--mdr-accent-text:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 62%,var(--dsw-alias-label-primary));
--mdr-accent-soft:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 12%,transparent);
--mdr-accent-line:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 55%,transparent);
--mdr-tint:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 5%,transparent);
--mdr-line:var(--dsw-alias-border-l2);
--mdr-line-soft:var(--dsw-alias-border-l1);
--mdr-line-strong:color-mix(in srgb,var(--dsw-alias-label-primary) 26%,transparent);
--mdr-surface:var(--dsw-alias-markdown-code-block);
--mdr-radius-sm:6px;--mdr-radius-md:10px;--mdr-radius-lg:12px;--mdr-pill:999px;
--mdr-mono:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
--mdr-syn-keyword:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 88%,var(--dsw-alias-label-primary));
--mdr-syn-string:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-label-primary));
--mdr-syn-number:color-mix(in srgb,var(--dsw-alias-state-warn-label) 70%,var(--dsw-alias-label-primary));
--mdr-syn-function:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 50%,var(--dsw-alias-label-primary));
--mdr-syn-comment:color-mix(in srgb,var(--dsw-alias-label-tertiary) 78%,var(--dsw-alias-label-primary));
--mdr-syn-deleted:color-mix(in srgb,var(--dsw-alias-state-error-primary) 85%,var(--dsw-alias-label-primary));
--mdr-syn-variable:var(--dsw-alias-label-secondary);
}
/* ══ 自研 markdown 内容（.tzx-md 作用域）══
   own-markdown.ts 产出的 p / h1–h6 / ul / ol / table / blockquote / a / code 全部落在
   这个容器里。层级、字号、间距、强调方式**全部由本插件定义**（不取官方 markdown 排版 token）。 */
.tzx-md{position:relative;display:flex;flex-direction:column;gap:10px;min-width:0;font-size:14px;line-height:1.75;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.tzx-md p{margin:0}
.tzx-md h1,.tzx-md h2,.tzx-md h3,.tzx-md h4,.tzx-md h5,.tzx-md h6{margin:0;font-weight:600}
.tzx-md h1{margin-top:8px;padding-left:12px;border-left:3px solid var(--mdr-accent);font-size:20px;line-height:1.4;font-weight:700;letter-spacing:-.01em}
.tzx-md h2{margin-top:6px;padding-bottom:6px;border-bottom:1px solid var(--mdr-line);font-size:17px;line-height:1.45;font-weight:700}
.tzx-md h3{margin-top:6px;font-size:15.5px;line-height:1.5}
.tzx-md h4{margin-top:6px;font-size:14.5px;line-height:1.55}
.tzx-md h5{font-size:13.5px;line-height:1.6;letter-spacing:.01em}
.tzx-md h6{font-size:12px;line-height:1.6;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.tzx-md>:first-child{margin-top:0}
.tzx-md ul,.tzx-md ol{margin:0;padding-left:24px;display:flex;flex-direction:column;gap:5px}
.tzx-md li>p{margin:0}
.tzx-md li::marker{color:var(--mdr-accent-text);font-weight:600}
.tzx-md ul ul,.tzx-md ul ol,.tzx-md ol ul,.tzx-md ol ol{margin-top:4px;gap:4px}
.tzx-md blockquote{margin:0;padding:8px 12px;border-left:3px solid var(--mdr-accent-line);border-radius:0 var(--mdr-radius-md) var(--mdr-radius-md) 0;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 6%,transparent);color:var(--dsw-alias-label-secondary)}
.tzx-md blockquote p{margin:0}
.tzx-md hr{border:0;align-self:stretch;height:1px;margin:6px 0;background:linear-gradient(90deg,transparent,var(--mdr-line) 15%,var(--mdr-line) 85%,transparent)}
.tzx-md a{border-radius:3px;color:var(--dsw-alias-link);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--dsw-alias-link) 45%,transparent);text-decoration-thickness:1px;text-underline-offset:3px}
.tzx-md a:hover{text-decoration-color:currentColor}
.tzx-md a:focus-visible{outline:2px solid var(--mdr-accent);outline-offset:2px}
.tzx-md strong{font-weight:600}
.tzx-md em{font-style:italic}
.tzx-md del{color:var(--dsw-alias-label-secondary);text-decoration:line-through}
/* 行内代码：胶囊 + 强调色染色（颜色向正文色收敛保证对比度，深浅色自动跟随） */
.tzx-md code.dsh-md-render-md-code{padding:1px 6px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 20%,transparent);border-radius:var(--mdr-radius-sm);background:var(--dsw-alias-markdown-inline-code);font-family:var(--mdr-mono);font-size:.88em;line-height:1.5;color:var(--mdr-accent-text)}
.tzx-md .dsh-md-render-md-link-plain{color:var(--dsw-alias-label-secondary)}
.tzx-md .dsh-md-render-md-img-alt{color:var(--dsw-alias-label-tertiary);font-size:12.5px}
.tzx-md img.dsh-md-render-md-img{max-width:100%;height:auto;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md)}
.tzx-md .dsh-md-render-md-html{color:var(--dsw-alias-label-secondary)}
.tzx-md .dsh-md-render-md-plain{margin:0;padding:12px 14px;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md);background:var(--mdr-surface);font-family:var(--mdr-mono);font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}
/* 任务列表：勾选框也自绘（原生 disabled checkbox **不认** accent-color，实测宿主里恒为灰；
   ::before 画方框、::after 用 border 折角画勾，色彩全部取宿主语义变量 → 深浅色自动跟随。
   真实 input 仅 opacity:0（仍在无障碍树里，勾选状态可被读出），:has() 失配时整层退化为原生控件） */
.tzx-md .dsh-md-render-md-task{position:absolute;left:0;top:6px;width:14px;height:14px;margin:0;appearance:none;border:0;background:transparent;opacity:0}
.tzx-md .dsh-md-render-md-task-item{position:relative;list-style:none;margin-left:-24px;padding-left:22px;display:flex;align-items:flex-start;gap:2px}
.tzx-md .dsh-md-render-md-task-item::before{content:"";position:absolute;left:0;top:6px;width:14px;height:14px;border:1.5px solid var(--mdr-line-strong);border-radius:4px;background-color:transparent}
.tzx-md .dsh-md-render-md-task-item:has(>.dsh-md-render-md-task:checked)::before{border-color:var(--mdr-accent);background-color:var(--mdr-accent)}
.tzx-md .dsh-md-render-md-task-item:has(>.dsh-md-render-md-task:checked)::after{content:"";position:absolute;left:4.5px;top:8.5px;width:4px;height:7.5px;border:solid var(--dsw-alias-label-primary-foreground);border-width:0 1.5px 1.5px 0;transform:rotate(45deg)}
@supports not selector(:has(*)){.tzx-md .dsh-md-render-md-task{position:static;width:auto;height:auto;opacity:1;appearance:auto}.tzx-md .dsh-md-render-md-task-item{padding-left:0}.tzx-md .dsh-md-render-md-task-item::before,.tzx-md .dsh-md-render-md-task-item::after{display:none}}
/* 表格：自有边框风格 —— 圆角外框 + 强调色表头薄底 + 发丝行线 + 行 hover 反馈 */
.tzx-md .dsh-md-render-md-table-wrap{overflow-x:auto;border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-md)}
.tzx-md table.dsh-md-render-md-table{border-collapse:collapse;width:100%;font-size:13.5px;line-height:1.6}
.tzx-md .dsh-md-render-md-table th,.tzx-md .dsh-md-render-md-table td{padding:8px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--mdr-line-soft)}
.tzx-md .dsh-md-render-md-table th{font-weight:600;letter-spacing:.01em;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 7%,transparent);border-bottom:1px solid var(--mdr-line)}
.tzx-md .dsh-md-render-md-table tbody tr:last-child td{border-bottom:0}
.tzx-md .dsh-md-render-md-table tbody tr:hover td{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 4%,transparent)}
.tzx-md .dsh-md-render-md-left{text-align:left}
.tzx-md .dsh-md-render-md-center{text-align:center}
.tzx-md .dsh-md-render-md-right{text-align:right}
.dsh-md-render-fallback{display:block;margin:0;padding:12px 14px;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md);background:var(--mdr-surface);font-family:var(--mdr-mono);font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-primary);white-space:pre-wrap}
/* ══ 围栏块的 markdown 卡片：与代码卡片同一套边框 / 圆角 / 层次（自有设计系统）══
   block-render.ts 追加在 md-code-block 内；接管后隐藏官方全部直接子元素
   （banner 标签被宿主写死为「代码块」，对自研渲染的块是错误信息）；切回「源码」时自动恢复。 */
.dsh-md-render-text-md{padding:14px 16px 16px 18px;border:1px solid var(--mdr-line);border-left:2px solid var(--mdr-accent-line);border-radius:var(--mdr-radius-md);background:var(--mdr-surface);box-shadow:var(--dsw-shadow-lv1)}
.md-code-block[data-dsh-md-render-text-view="markdown"]>:not([class*=dsh-md-render]):not(.tzx-md){display:none}
.md-code-block[data-dsh-md-render-text-view="code"]>:not([class*=dsh-md-render]):not(.tzx-md){display:none}
.md-code-block[data-dsh-md-render-text-view="source"]>.dsh-md-render-text-md{display:none}
.md-code-block[data-dsh-md-render-text-view="source"]>.dsh-md-render-code-host{display:none}
/* ══ 自研代码块（own-code.ts）：真实语言名胶囊 + 复制（hover / focus 浮现）+ 语法高亮 ══ */
.dsh-md-render-code-host{display:block;min-width:0}
.dsh-md-render-code{position:relative;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--mdr-line);border-left:3px solid var(--mdr-accent);border-radius:var(--mdr-radius-md);background:var(--mdr-surface);box-shadow:var(--dsw-shadow-lv1)}
.dsh-md-render-code-head{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:6px 10px 6px 12px;background:var(--mdr-tint);border-bottom:1px solid var(--mdr-line-soft)}
.dsh-md-render-code-lang{margin-right:auto;min-width:0;overflow:hidden;padding:1px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 22%,transparent);border-radius:var(--mdr-pill);background:var(--mdr-accent-soft);font-family:var(--mdr-mono);font-size:10px;font-weight:600;line-height:16px;letter-spacing:.08em;text-transform:uppercase;text-overflow:ellipsis;white-space:nowrap;color:var(--mdr-accent-text)}
.dsh-md-render-code-lang:empty{display:none}
.dsh-md-render-code-actions{display:inline-flex;align-items:center;gap:6px;flex:none}
.dsh-md-render-code-pre{margin:0;padding:12px 14px;overflow:auto;max-height:70vh;background:transparent;font-family:var(--mdr-mono);font-size:12.5px;line-height:1.7;tab-size:2;color:var(--dsw-alias-label-primary);white-space:pre;overflow-wrap:normal;word-break:normal}
.dsh-md-render-code-pre:focus-visible{outline:2px solid var(--mdr-accent);outline-offset:-2px}
.dsh-md-render-code-pre code{font:inherit;color:inherit;background:none;border:0;padding:0;white-space:inherit;word-break:inherit}
/* ── 插件控件统一形态：胶囊按钮（复制 / 查看原文 / 整段复制 / 导出 / 视图切换）── */
.dsh-md-render-code-copy,.dsh-md-render-text-toggle,.dsh-md-render-copy,.dsh-md-render-mermaid-eb,.dsh-md-render-mermaid-vt{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border:1px solid var(--mdr-line);border-radius:var(--mdr-pill);background:transparent;font:inherit;font-size:11px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:color var(--ds-transition-duration-slow) var(--ds-ease-in-out),background-color var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out),opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-code-copy:hover,.dsh-md-render-text-toggle:hover,.dsh-md-render-copy:hover,.dsh-md-render-mermaid-eb:hover:not(:disabled),.dsh-md-render-mermaid-vt:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--mdr-accent-line);color:var(--dsw-alias-label-primary)}
.dsh-md-render-code-copy:focus-visible,.dsh-md-render-text-toggle:focus-visible,.dsh-md-render-copy:focus-visible,.dsh-md-render-mermaid-eb:focus-visible,.dsh-md-render-mermaid-vt:focus-visible{outline:2px solid var(--mdr-accent);outline-offset:2px}
/* 复制按钮：默认隐形，hover / 键盘 focus-within / 触屏常显三路可现 */
.dsh-md-render-code-copy{opacity:0}
.dsh-md-render-code:hover .dsh-md-render-code-copy,.dsh-md-render-code:focus-within .dsh-md-render-code-copy{opacity:1}
@media (hover:none){.dsh-md-render-code-copy{opacity:1}}
.dsh-md-render-text-toggle{align-self:flex-end;margin-top:4px}
.dsh-md-render-text-toggle[aria-pressed="true"]{border-color:var(--mdr-accent-line);background:var(--mdr-accent-soft);color:var(--mdr-accent-text)}
/* ── 语法着色：本插件自己的语义映射（不取官方 shiki 调色板）──
   每一色都由宿主**状态色**向正文色混合得到：深浅色自动跟随，且对比度不低于官方调色板
   （官方 keyword #d6336c ≈4.5:1、string #2f9e44 ≈3.3:1；本映射见报告实测）。 */
.dsh-md-render-code-pre .hljs-keyword,.dsh-md-render-code-pre .hljs-selector-tag,.dsh-md-render-code-pre .hljs-literal,.dsh-md-render-code-pre .hljs-doctag,.dsh-md-render-code-pre .hljs-meta{color:var(--mdr-syn-keyword)}
.dsh-md-render-code-pre .hljs-string,.dsh-md-render-code-pre .hljs-regexp,.dsh-md-render-code-pre .hljs-symbol,.dsh-md-render-code-pre .hljs-bullet,.dsh-md-render-code-pre .hljs-addition,.dsh-md-render-code-pre .hljs-template-tag{color:var(--mdr-syn-string)}
.dsh-md-render-code-pre .hljs-comment,.dsh-md-render-code-pre .hljs-quote{color:var(--mdr-syn-comment);font-style:italic}
.dsh-md-render-code-pre .hljs-number,.dsh-md-render-code-pre .hljs-constant,.dsh-md-render-code-pre .hljs-built_in,.dsh-md-render-code-pre .hljs-type,.dsh-md-render-code-pre .hljs-class,.dsh-md-render-code-pre .hljs-tag{color:var(--mdr-syn-number)}
.dsh-md-render-code-pre .hljs-title,.dsh-md-render-code-pre .hljs-title.function_,.dsh-md-render-code-pre .hljs-title.class_,.dsh-md-render-code-pre .hljs-section,.dsh-md-render-code-pre .hljs-function{color:var(--mdr-syn-function)}
.dsh-md-render-code-pre .hljs-attr,.dsh-md-render-code-pre .hljs-attribute,.dsh-md-render-code-pre .hljs-variable,.dsh-md-render-code-pre .hljs-template-variable,.dsh-md-render-code-pre .hljs-params,.dsh-md-render-code-pre .hljs-property,.dsh-md-render-code-pre .hljs-punctuation{color:var(--mdr-syn-variable)}
.dsh-md-render-code-pre .hljs-link,.dsh-md-render-code-pre .hljs-name,.dsh-md-render-code-pre .hljs-selector-id,.dsh-md-render-code-pre .hljs-selector-class{color:var(--dsw-alias-link)}
.dsh-md-render-code-pre .hljs-deletion{color:var(--mdr-syn-deleted)}
.dsh-md-render-code-pre .hljs-emphasis{font-style:italic}
.dsh-md-render-code-pre .hljs-strong{font-weight:600}
/* ── 上下文注入块（pre[data-context-text]）渲染容器 ──
   插在宿主 pre 之前，宿主 pre 置 hidden（React 拥有该子树，不改其子结构）。 */
.dsh-md-render-context-md{padding:0}
/* ── 整段 markdown 复制按钮（hover / focus-within 浮现，流式中隐藏）── */
.dsh-md-render-copy{opacity:0}
.tzx-md>.dsh-md-render-copy{position:absolute;right:10px;bottom:10px;background:var(--dsw-alias-bg-layer-2)}
.tzx-md:hover>.dsh-md-render-copy,.tzx-md:focus-within>.dsh-md-render-copy{opacity:1}
.tzx-md>.dsh-md-render-copy:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--mdr-accent-line);color:var(--dsw-alias-label-primary)}
.dsh-md-render-copy-done{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
[data-streaming] .dsh-md-render-copy{display:none}
[data-streaming] .dsh-md-render-text-toggle{display:none}
/* ── mermaid 图表卡片（自有 DOM）：与代码 / markdown 卡片同一套边框 / 圆角 / 层次 ── */
.dsh-md-render-mermaid-host{display:block;min-width:0}
.md-code-block[data-dsh-md-render-mermaid-view]>:not([class*=dsh-md-render]):not(.tzx-md){display:none}
.dsh-md-render-mermaid-card{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-lg);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1);font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);animation:dsh-md-render-mermaid-card-in 150ms var(--ds-ease-in-out)}
.dsh-md-render-mermaid-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-md-render-mermaid-card-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.dsh-md-render-mermaid-export{display:inline-flex;gap:2px;flex:none}
.dsh-md-render-mermaid-eb svg,.dsh-md-render-mermaid-vt svg,.dsh-md-render-mermaid-card-title svg{display:block;flex:none}
.dsh-md-render-mermaid-eb:disabled{opacity:.45;cursor:not-allowed}
.dsh-md-render-mermaid-notice{border-radius:var(--mdr-radius-sm);padding:4px 10px;font-size:12px;line-height:20px}
.dsh-md-render-mermaid-notice-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-md-render-mermaid-notice-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
/* 卡片标题与代码块语言胶囊同一形态：强调色 + 大写 + 字距（自有标签语言） */
.dsh-md-render-mermaid-card-title{display:flex;align-items:center;gap:5px;padding:1px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 22%,transparent);border-radius:var(--mdr-pill);background:var(--mdr-accent-soft);font-family:var(--mdr-mono);font-size:10px;font-weight:600;line-height:16px;letter-spacing:.08em;text-transform:uppercase;color:var(--mdr-accent-text)}
.dsh-md-render-mermaid-view-toggle{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--mdr-line);border-radius:var(--mdr-pill);background:var(--mdr-tint);flex:none}
.dsh-md-render-mermaid-vt{border:0;background:transparent}
.dsh-md-render-mermaid-view-toggle>.dsh-md-render-mermaid-vt-active{background:var(--mdr-accent-soft);color:var(--mdr-accent-text);font-weight:600}
.dsh-md-render-mermaid-svg{position:relative;overflow:auto;max-height:70vh;min-height:160px;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md);background-image:radial-gradient(color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent) 1px,transparent 1px);background-size:18px 18px}
.dsh-md-render-mermaid-svg[data-dsh-md-render-zoom]{overflow:hidden}
.dsh-md-render-mermaid-canvas{transform-origin:0 0;display:flex;align-items:center;justify-content:center}
.dsh-md-render-mermaid-svg svg{max-width:100%;height:auto}
.dsh-md-render-mermaid-code{margin:0;padding:12px 14px;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md);background:var(--mdr-surface);overflow:auto;font-family:var(--mdr-mono);font-size:12px;line-height:1.7;white-space:pre-wrap}
.dsh-md-render-mermaid-loading{display:flex;align-items:center;gap:6px;padding:8px 6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-mermaid-loading svg{flex:none;animation:dsh-md-render-mermaid-spin 1s linear infinite}
/* 失败态：源码是主视觉（第一屏），红横幅降为一行灰字提示（#470 需求 2） */
.dsh-md-render-mermaid-error{display:flex;flex-direction:column;gap:6px}
.dsh-md-render-mermaid-error-line{display:flex;align-items:center;gap:6px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-mermaid-error-line svg{flex:none;color:var(--dsw-alias-state-error-primary)}
.dsh-md-render-mermaid-error-msg{white-space:pre-wrap;word-break:break-all}
.dsh-md-render-mermaid-retry{margin-left:auto;flex:none}
/* ── 「渲染为…」语言手动切换控件（自有 DOM）── hover / 键盘 focus-within / 触屏常显三路，
   作用域 = 自有块级标记，不碰官方 class。 */
.md-code-block[data-dsh-md-render-lang-switch]>.dsh-md-render-lang-switch{display:flex;justify-content:flex-end;margin-top:4px;padding:2px;border:1px solid var(--mdr-line);border-radius:var(--mdr-pill);background:var(--mdr-tint);opacity:0;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.md-code-block[data-dsh-md-render-lang-switch]:hover>.dsh-md-render-lang-switch{opacity:1}
.md-code-block[data-dsh-md-render-lang-switch]:focus-within>.dsh-md-render-lang-switch{opacity:1}
@media (hover:none){.md-code-block[data-dsh-md-render-lang-switch]>.dsh-md-render-lang-switch{opacity:1}}
/* ── 图表缩放 / 浮窗（需求 1，自有 DOM）──
   工具条按钮复用卡片按钮类；浮窗 = 页面内 <dialog> 模态（**非**浏览器全屏），
   卡片临时移入面板：遮罩 / Esc / 焦点归还 / 背景滚动锁定全由浏览器兜底。 */
.dsh-md-render-mermaid-zoom{display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap}
.dsh-md-render-mermaid-zoom-pct{display:inline-flex;align-items:center;justify-content:flex-end;min-width:40px;font-family:var(--mdr-mono);font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-md-render-mermaid-fs{display:flex;flex-direction:column;gap:6px;width:90vw;height:85vh;max-width:none;max-height:none;margin:auto;padding:8px 10px;border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-lg);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2);font-size:14px;color:var(--dsw-alias-label-primary)}
.dsh-md-render-mermaid-fs::backdrop{background:color-mix(in srgb,var(--dsw-alias-label-primary) 45%,transparent)}
.dsh-md-render-mermaid-fs-bar{display:flex;justify-content:flex-end;gap:6px;flex:none}
.dsh-md-render-mermaid-fs>.dsh-md-render-mermaid-host{flex:1;min-height:0;display:flex;flex-direction:column}
.dsh-md-render-mermaid-fs .dsh-md-render-mermaid-card{flex:1;min-height:0;overflow:hidden;padding:0;border:0;box-shadow:none}
.dsh-md-render-mermaid-fs .dsh-md-render-mermaid-svg{max-height:none;flex:1;min-height:0}
/* ── 离屏渲染容器（失败时的炸弹图只落这里）── 必须在布局树内（display:none 会量不到尺寸）。 */
.dsh-md-render-offscreen{position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none}
@keyframes dsh-md-render-mermaid-card-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}
@keyframes dsh-md-render-mermaid-spin{to{transform:rotate(360deg)}}
`
