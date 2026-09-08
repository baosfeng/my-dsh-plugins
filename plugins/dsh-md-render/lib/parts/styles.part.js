// ── 样式（DSH 语义 token，随 activation 注入）──────────────────
// 视觉基准：dsh-file-activity（issue #54 阶段 0 UI 规范）——线性图标、
// 语义 token 着色、hover/transition 反馈；适配对话内渲染场景。
// 前缀 dsh-md-render-（issue #54：与 dsh-mermaid-render 前缀分离，
// 消除跨插件类名冲突）；.tzx-md 系列为统一 MarkdownView 的输出样式
// （issue #31 从 dsh-think-zh-expand 迁移，对外契约类名 tzx-* /
// md-code-block 保持不动）。
const STYLES = `
.tzx-md{display:flex;flex-direction:column;gap:8px;min-width:0;font:var(--dsw-font-s-14);line-height:22px;color:var(--dsw-alias-label-primary)}
.tzx-md .tzx-p{margin:0}
.tzx-md h1,.tzx-md h2,.tzx-md h3,.tzx-md h4{margin:0;font-weight:600;line-height:1.35}
.tzx-md ul,.tzx-md ol{margin:0;padding-left:26px}
.tzx-md li{margin:2px 0}
.tzx-md .tzx-pre{margin:0;background:var(--dsh-md-render-code-bg,var(--dsw-alias-markdown-code-block));border:1px solid var(--dsh-md-render-code-border,var(--dsw-alias-border-l1));border-radius:8px;padding:12px 16px 12px 12px;overflow:auto;font:var(--dsw-font-markdown-code-block-small);color:var(--dsh-md-render-code-fg,var(--dsw-alias-label-primary));transition:border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.tzx-md .tzx-pre:hover{border-color:var(--dsw-alias-border-l2)}
.tzx-md code{background:var(--dsw-alias-markdown-code-block);border-radius:4px;padding:0 4px;font:var(--dsw-font-markdown-code-block-small)}
.tzx-md .tzx-pre code{background:none;padding:0}
.tzx-md .tzx-bq{margin:0;padding:2px 0 2px 12px;border-left:3px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.tzx-md .tzx-bq p{margin:0}
.tzx-md .tzx-table{border-collapse:collapse;margin:0;font-size:14px;line-height:22px}
.tzx-md .tzx-table th,.tzx-md .tzx-table td{border:1px solid var(--dsw-alias-border-l1);padding:6px 12px}
.tzx-md .tzx-table th{background:var(--dsw-alias-markdown-code-block);font-weight:600}
.tzx-md .tzx-table tbody tr{transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.tzx-md .tzx-table tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tzx-md a{color:var(--dsw-alias-accent-primary)}
.dsh-md-render-math{font:var(--dsw-font-markdown-code-block-small);font-style:italic;color:var(--dsw-alias-label-primary)}
.dsh-md-render-math-block{margin:0;text-align:center;font:var(--dsw-font-markdown-code-block-small);font-style:italic;color:var(--dsw-alias-label-primary);padding:4px 0}
.dsh-md-render-math-error{display:inline-flex;align-items:center;gap:4px;font:var(--dsw-font-markdown-code-block-small);font-style:italic;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);border-radius:4px;padding:0 4px}
.dsh-md-render-math-error svg{display:block;flex:none}
div.dsh-md-render-math-error{margin:0;text-align:center;justify-content:center;padding:4px 8px}
/* ── 公式结构（issue #82）：分数 / 根号 / 上下标 / 求和积分、希腊字母 ──
   自实现轻量 LaTeX 子集（零依赖）：frac(a,b) 上下结构 + 分数线、
   sqrt(x) 根号符号 + 顶部根号线、x^2 / x_i 上下标、sum / int 符号 +
   上下限；flex 布局走语义 token（currentColor 继承，深浅主题自适应）。
   无法解析的公式命令回退原文（不误伤，见 math.part.js / syntax.part.js）。 */
.dsh-md-render-math,.dsh-md-render-math-block{white-space:normal}
.dsh-md-render-math .dsh-md-render-frac,.dsh-md-render-math .dsh-md-render-sqrt,.dsh-md-render-math .dsh-md-render-supsub,.dsh-md-render-math .dsh-md-render-big,.dsh-md-render-math .dsh-md-render-seq,.dsh-md-render-math-block .dsh-md-render-frac,.dsh-md-render-math-block .dsh-md-render-sqrt,.dsh-md-render-math-block .dsh-md-render-supsub,.dsh-md-render-math-block .dsh-md-render-big,.dsh-md-render-math-block .dsh-md-render-seq{display:inline;font-style:italic;white-space:nowrap}
.dsh-md-render-frac{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;margin:0 2px;line-height:1.25}
.dsh-md-render-frac-num{padding:1px 4px 0}
.dsh-md-render-frac-den{border-top:1px solid currentColor;padding:0 4px 1px}
.dsh-md-render-sqrt{display:inline-flex;align-items:center;vertical-align:middle;margin:0 2px}
.dsh-md-render-sqrt-symbol{font-size:1.2em;line-height:1;padding-right:1px}
.dsh-md-render-sqrt-body{display:inline-flex;flex-direction:column;justify-content:center;border-top:1px solid currentColor;padding:1px 2px 0}
.dsh-md-render-supsub{display:inline-flex;align-items:flex-start;vertical-align:middle;margin:0 1px}
.dsh-md-render-supsub-base{line-height:1.3}
.dsh-md-render-supsub-scripts{display:inline-flex;flex-direction:column;align-items:flex-start;font-size:.7em;line-height:1.05;margin-left:1px}
.dsh-md-render-big{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;margin:0 2px;line-height:1.1}
.dsh-md-render-big-limits{display:flex;flex-direction:column;align-items:center;font-size:.7em;line-height:1.05}
.dsh-md-render-big-symbol{font-size:1.5em;line-height:1}
.dsh-md-render-seq{display:inline}
.dsh-md-render-table-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);transition:border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-table-scroll:hover{border-color:var(--dsw-alias-border-l2)}
.dsh-md-render-table{border-collapse:collapse;width:max-content;max-width:max-content;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.dsh-md-render-table th,.dsh-md-render-table td{padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);max-width:min(30vw,320px);min-width:100px}
.dsh-md-render-table th{text-align:start;font-weight:600;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-markdown-code-block);font:var(--dsw-font-markdown-table-head)}
.dsh-md-render-table td{font:var(--dsw-font-markdown-table)}
.dsh-md-render-table tbody tr{transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-table tbody tr:nth-child(even){background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 40%, transparent)}
.dsh-md-render-table tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-md-render-table code{font-size:13px}
.dsh-md-render-table th{cursor:pointer;user-select:none}
.dsh-md-render-sort-arrow{display:inline-block;margin-left:4px;font-size:12px;line-height:1;color:var(--dsw-alias-label-tertiary);transition:color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-table th[data-sorted] .dsh-md-render-sort-arrow{color:var(--dsw-alias-accent-primary)}
.dsh-md-render-table tr.dsh-md-render-folded-row{display:none}
.dsh-md-render-table-fold{display:block;margin:8px auto 0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);padding:4px 12px;cursor:pointer;transition:border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out),color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-table-fold:hover{border-color:var(--dsw-alias-accent-primary);color:var(--dsw-alias-accent-primary)}
.dsh-md-render-scroll-hint{display:flex;align-items:center;gap:4px;padding:2px 8px;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-scroll-hint svg{display:block;flex:none}
.dsh-md-render-prefix,.dsh-md-render-suffix{margin:0}
/* ── 复制按钮（issue #74）：代码块 / 整段内容一键复制 ──
   整段内容按钮绝对定位右下角；代码块按钮位置可配置（issue #146）：
   bottom-right（默认，与 #74 原始诉求一致）= md-code-block 直接子元素
   绝对定位右下角，header = 头部与语言标签同排（issue #80 布局）。
   hover 才显示（不干扰阅读）；DSH 语义 token 深浅主题自适应；流式渲染
   中（[data-streaming] 祖先）隐藏，避免复制到半截内容。 */
.md-code-block{position:relative}
.tzx-md{position:relative}
.dsh-md-render-copy{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;font:var(--dsw-font-xxxs-11);line-height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;cursor:pointer;opacity:0;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out),color var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-code-head>.dsh-md-render-copy{margin-left:auto}
.md-code-block>.dsh-md-render-copy{position:absolute;right:8px;bottom:8px}
.tzx-md>.dsh-md-render-copy{position:absolute;right:8px;bottom:8px}
.md-code-block:hover .dsh-md-render-copy,.tzx-md:hover>.dsh-md-render-copy{opacity:1}
.dsh-md-render-copy:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dsh-md-render-copy-done{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
[data-streaming] .dsh-md-render-copy{display:none}
/* ── 代码块增强（issue #80）：头部语言标签 + 行号 + 语法高亮 ──
   header 行与复制按钮（#74）同排；行号用 CSS counter 伪元素（不污染
   pre/code 文本内容，mermaid/复制读取原文本不受影响）；token 类走
   固定色板 + prefers-color-scheme 深浅两套，随 activation 注入/卸载。 */
.dsh-md-render-code-head{display:flex;align-items:center;gap:8px;padding:4px 8px;font:var(--dsw-font-xxxs-11);line-height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsh-md-render-code-bg,color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent));border:1px solid var(--dsh-md-render-code-border,var(--dsw-alias-border-l1));border-bottom:none;border-radius:8px 8px 0 0}
.dsh-md-render-code-lang{text-transform:lowercase;letter-spacing:.02em;user-select:none}
.md-code-block .tzx-pre{border-top:none;border-radius:0 0 8px 8px}
.tzx-md .tzx-pre code{display:block;white-space:normal;counter-reset:dsh-md-render-line}
.dsh-md-render-code-line{display:block;white-space:pre;position:relative;padding-left:2.25em;counter-increment:dsh-md-render-line}
.dsh-md-render-code-line::before{content:counter(dsh-md-render-line);position:absolute;left:0;width:1.75em;text-align:right;color:var(--dsw-alias-label-tertiary);user-select:none}
/* ── 代码主题（issue #146）：内置 5 套可配置色板，经 data-theme 选择 ──
   每套定义 5 个 token 色（kw/str/com/num/fn）+ 代码块背景/边框色；
   bright（默认）= 明亮高对比：柔和白底 + 深色 token，解决白底刺眼观感
   （不用高饱和青色系）；github-light / github-dark / one-dark / nord 为
   知名编辑器色板。深浅色自适应保留：每套主题均有 prefers-color-scheme
   暗色变体（github-light 暗色变体 = github-dark 官方色板；github-dark /
   one-dark / nord 本身为暗色主题，两套相同）。仅实际高亮的代码块携带
   data-theme（syntaxHighlight 关闭 / 未知语言 / 超长跳过高亮时无
   data-theme → 保持 DSH 语义 token 默认样式，主题不影响纯文本代码块）。 */
/* 每个主题含自洽前景色 --dsh-md-render-code-fg（init：#146 只改了背景/
   token 色，文字色继承宿主 .tzx-md → 系统暗色 + 宿主浅色时深背景黑字
   不可见）。现在背景与前景色同源于主题，代码块内文字恒可见（修复）。 */
.md-code-block[data-theme]{--dsh-md-render-c-kw:#6d28d9;--dsh-md-render-c-str:#15803d;--dsh-md-render-c-com:#78716c;--dsh-md-render-c-num:#b45309;--dsh-md-render-c-fn:#1d4ed8;--dsh-md-render-code-bg:#fafaf9;--dsh-md-render-code-border:#d6d3d1;--dsh-md-render-code-fg:#1f2328}
.md-code-block[data-theme="github-light"]{--dsh-md-render-c-kw:#cf222e;--dsh-md-render-c-str:#0a3069;--dsh-md-render-c-com:#6e7781;--dsh-md-render-c-num:#0550ae;--dsh-md-render-c-fn:#8250df;--dsh-md-render-code-bg:#ffffff;--dsh-md-render-code-border:#d0d7de;--dsh-md-render-code-fg:#1f2328}
.md-code-block[data-theme="github-dark"]{--dsh-md-render-c-kw:#ff7b72;--dsh-md-render-c-str:#a5d6ff;--dsh-md-render-c-com:#8b949e;--dsh-md-render-c-num:#79c0ff;--dsh-md-render-c-fn:#d2a8ff;--dsh-md-render-code-bg:#0d1117;--dsh-md-render-code-border:#30363d;--dsh-md-render-code-fg:#e6edf3}
.md-code-block[data-theme="one-dark"]{--dsh-md-render-c-kw:#c678dd;--dsh-md-render-c-str:#98c379;--dsh-md-render-c-com:#5c6370;--dsh-md-render-c-num:#d19a66;--dsh-md-render-c-fn:#61afef;--dsh-md-render-code-bg:#282c34;--dsh-md-render-code-border:#3e4451;--dsh-md-render-code-fg:#abb2bf}
.md-code-block[data-theme="nord"]{--dsh-md-render-c-kw:#b48ead;--dsh-md-render-c-str:#a3be8c;--dsh-md-render-c-com:#616e88;--dsh-md-render-c-num:#d08770;--dsh-md-render-c-fn:#81a1c1;--dsh-md-render-code-bg:#2e3440;--dsh-md-render-code-border:#434c5e;--dsh-md-render-code-fg:#d8dee9}
/* 暗色系统：bright / github-light 背景被反转成深色 → 前景色同步变浅
   （保持主题内自洽可见）；github-dark / one-dark / nord 本身深色背景，基础
   规则的前景色已是浅色，无需重复覆盖。 */
@media (prefers-color-scheme:dark){.md-code-block[data-theme]{--dsh-md-render-c-kw:#c4b5fd;--dsh-md-render-c-str:#86efac;--dsh-md-render-c-com:#64748b;--dsh-md-render-c-num:#f87171;--dsh-md-render-c-fn:#93c5fd;--dsh-md-render-code-bg:#1e1f26;--dsh-md-render-code-border:#3a3b45;--dsh-md-render-code-fg:#cbd5e1}.md-code-block[data-theme="github-light"]{--dsh-md-render-c-kw:#ff7b72;--dsh-md-render-c-str:#a5d6ff;--dsh-md-render-c-com:#8b949e;--dsh-md-render-c-num:#79c0ff;--dsh-md-render-c-fn:#d2a8ff;--dsh-md-render-code-bg:#0d1117;--dsh-md-render-code-border:#30363d;--dsh-md-render-code-fg:#c9d1d9}}
.dsh-md-render-tok-keyword{color:var(--dsh-md-render-c-kw)}
.dsh-md-render-tok-string{color:var(--dsh-md-render-c-str)}
.dsh-md-render-tok-comment{color:var(--dsh-md-render-c-com);font-style:italic}
.dsh-md-render-tok-number{color:var(--dsh-md-render-c-num)}
.dsh-md-render-tok-function{color:var(--dsh-md-render-c-fn)}
/* ── 语法补全（issue #81）：任务列表 / 删除线 / 图片 ──
   任务列表：checkbox 与文本同排、状态色走 accent；删除线 <del>
   line-through 弱化次级字色；图片块级自适应、失败占位。 */
.tzx-md del,.dsh-md-render-del{text-decoration:line-through;color:var(--dsw-alias-label-secondary)}
.dsh-md-render-task-checkbox{width:14px;height:14px;margin:0 6px 0 0;vertical-align:-2px;accent-color:var(--dsw-alias-accent-primary);cursor:pointer;flex:none}
.dsh-md-render-img{display:block;max-width:100%;max-height:40vh;margin:4px 0;border-radius:8px;object-fit:contain}
.dsh-md-render-img-fallback{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}
`
