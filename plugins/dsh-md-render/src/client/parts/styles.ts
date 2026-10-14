// ── 样式（**本插件自有的视觉语言**，随 activation 注入）────────────────────
// 口径（最高优先级）：「全部使用我们自己的，外观也是」—— 本文件**不再对齐官方视觉**：
// 布局 / 形状 / 间距 / 层级 / 边框 / 圆角 / 强调方式全部由本插件自己设计，官方样式只作为
// 「颜色与主题来源」被读取（--dsw-alias-* 语义色随深浅色自动切换，绝不硬编码十六进制）。
//
// **markdown 内容的外观真源 = 渲染原型**（docs/md渲染/原型/）：其几何（8/12/18/980）、字号阶梯
// （21/17/15/14/13/12）、间距（4/8/12/16/24）、动效（150ms/220ms + cubic-bezier(.28,0,.22,1)）、
// 线索色比例与交互状态逐条对齐，由 test/prototype-alignment.mjs 机器钉死（漂移即红）。
// 原型用 apple 固定十六进制，本插件**不照搬**——同名语义映射到宿主 --dsw-* 派生（见该测试的
// 「有意偏离」段与 docs/md渲染/概述.md）。
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
.tzx-md,.dsh-md-render-text-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.dsh-md-render-lang-switch,.dsh-md-render-text-toggle,.dsh-md-render-copy,.dsh-md-render-mermaid-fs,.dsh-md-render-img-lightbox,.dsh-md-render-fallback{
--mdr-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-link));
--mdr-accent-text:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 62%,var(--dsw-alias-label-primary));
--mdr-accent-soft:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 12%,transparent);
--mdr-accent-line:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 55%,transparent);
--mdr-tint:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 6%,transparent);
/* 原型 03 条派生线索色（08-prototype.html 的 :root 派生块）——**颜色类一律宿主语义 token**：
   原型的 apple 十六进制与"按比例混色"都不照搬，因为混色方向在深色态会反转（见下 scrim）。
   逐字对齐原型的只有**几何 / 字号 / 间距 / 动效**（见 test/prototype-alignment.mjs）。 */
--mdr-code-bg:var(--dsw-alias-markdown-inline-code);
--mdr-hairline:var(--dsw-alias-border-l1);
--mdr-ok-ink:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-label-primary));
--mdr-bad-ink:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,var(--dsw-alias-label-primary));
/* 遮罩**必须**取宿主的遮罩 token：label-primary 在深色态是近白，按比例混会得到 55% 白雾
   （原型 §D2 警告过的"一片浅灰"，只是换了个成因）。宿主 bg-mask-* 是固定黑，深浅两态都变暗。 */
--mdr-scrim:var(--dsw-alias-bg-mask-3);
--mdr-line:var(--dsw-alias-border-l2);
--mdr-line-soft:var(--dsw-alias-border-l1);
--mdr-line-strong:color-mix(in srgb,var(--dsw-alias-label-primary) 26%,transparent);
--mdr-surface:var(--dsw-alias-markdown-code-block);
/* 几何：逐字对齐原型 02-style.md（--radius-sm/md/lg/pill = 8 / 12 / 18 / 980） */
--mdr-radius-sm:8px;--mdr-radius-md:12px;--mdr-radius-lg:18px;--mdr-pill:980px;
/* 字号阶梯：h1–h6 逐字对齐原型（21 / 17 / 15 / 14 / 13 / 12）——**原型取值是「正文 14px」下的基线**，
   这里改用宿主的**内容字号轴**平移，跟随「设置 → 外观 → 字号大小」（12–17）：正文 / 表格读
   --dsh-content-font-size；h1–h3 用 calc(原型值 + --dsh-content-font-delta)（宿主官方 markdown 同款写法，
   它 h1 也是 calc(21px + delta)）；h5 / h6 / 小字档**不缩放** —— 与宿主对 dense secondary text 的策略一致
   （缩到 11–12px 以下会掉可读性）。行高用相对倍数，天然跟随。 */
--mdr-fs-h1:calc(21px + var(--dsh-content-font-delta,0px));
--mdr-fs-h2:calc(17px + var(--dsh-content-font-delta,0px));
--mdr-fs-h3:calc(15px + var(--dsh-content-font-delta,0px));
--mdr-fs-h4:var(--dsh-content-font-size,14px);
--mdr-fs-h5:13px;--mdr-fs-h6:12px;
--mdr-fs-body:var(--dsh-content-font-size,14px);--mdr-fs-xs:12px;
/* 间距阶梯：对齐原型 --space-*（4 / 8 / 12 / 16 / 24） */
--mdr-space-1:4px;--mdr-space-2:8px;--mdr-space-3:12px;--mdr-space-4:16px;--mdr-space-6:24px;
/* 动效：对齐原型 --motion-fast / --motion-base / --ease-standard */
--mdr-motion-fast:150ms;--mdr-motion-base:220ms;--mdr-ease:cubic-bezier(0.28,0,0.22,1);
/* 焦点环：对齐原型 --focus-ring（4px 强调色光晕；inset 变体给会被 overflow 裁掉的滚动区） */
--mdr-focus-ring:0 0 0 4px color-mix(in srgb,var(--mdr-accent) 35%,transparent);
--mdr-focus-ring-inset:inset 0 0 0 4px color-mix(in srgb,var(--mdr-accent) 35%,transparent);
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
   这个容器里。层级、字号、间距、强调方式**全部由本插件定义**（不取官方 markdown 排版 token），
   且**逐条对齐渲染原型**（段序与 08-prototype.html 的「markdown 渲染」段一一对应，便于比对）。 */
.tzx-md{position:relative;display:flex;flex-direction:column;gap:var(--mdr-space-3);min-width:0;font-size:var(--mdr-fs-body);line-height:1.6;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.tzx-md p{margin:0}
.tzx-md h1,.tzx-md h2,.tzx-md h3,.tzx-md h4,.tzx-md h5,.tzx-md h6{margin-top:0;font-weight:600}
.tzx-md h1{padding-left:var(--mdr-space-3);border-left:3px solid var(--mdr-accent-line);font-size:var(--mdr-fs-h1);line-height:1.25;letter-spacing:-.015em}
.tzx-md h2{padding-bottom:var(--mdr-space-1);border-bottom:1px solid var(--mdr-line-soft);font-size:var(--mdr-fs-h2);line-height:1.35;letter-spacing:-.01em}
.tzx-md h3{font-size:var(--mdr-fs-h3);line-height:1.4;letter-spacing:-.005em}
.tzx-md h4{font-size:var(--mdr-fs-h4);line-height:1.4;color:var(--dsw-alias-label-secondary)}
.tzx-md h5{font-size:var(--mdr-fs-h5);line-height:1.45;letter-spacing:.01em;color:var(--dsw-alias-label-secondary)}
.tzx-md h6{font-size:var(--mdr-fs-h6);line-height:1.5;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
/* 标题间距走原型的「相邻兄弟加距 + 标题后紧贴」机制（不靠标题自身 margin-top） */
.tzx-md>*+h1{margin-top:var(--mdr-space-3)}
.tzx-md>*+h2{margin-top:var(--mdr-space-3)}
.tzx-md>*+h3{margin-top:var(--mdr-space-2)}
.tzx-md>*+h4,.tzx-md>*+h5,.tzx-md>*+h6{margin-top:var(--mdr-space-1)}
.tzx-md h1+*,.tzx-md h2+*,.tzx-md h3+*,.tzx-md h4+*,.tzx-md h5+*,.tzx-md h6+*{margin-top:0}
.tzx-md ul,.tzx-md ol{margin:0;padding-left:var(--mdr-space-6);display:flex;flex-direction:column;gap:var(--mdr-space-1)}
.tzx-md li>p{margin:0}
.tzx-md li::marker{color:var(--mdr-accent-text);font-weight:600}
.tzx-md ol>li::marker{font-variant-numeric:tabular-nums}
.tzx-md ul ul,.tzx-md ul ol,.tzx-md ol ul,.tzx-md ol ol{margin-top:var(--mdr-space-1);gap:var(--mdr-space-1)}
.tzx-md blockquote{margin:0;padding:var(--mdr-space-3) var(--mdr-space-4);border-left:3px solid var(--mdr-accent-line);border-radius:0 var(--mdr-radius-md) var(--mdr-radius-md) 0;background:var(--mdr-tint);color:var(--dsw-alias-label-secondary)}
.tzx-md blockquote p{margin:0}
/* 嵌套引用降级：左竖线转中性、底色更淡，不与一级引用抢层级（原型同款） */
.tzx-md blockquote blockquote{margin-top:var(--mdr-space-2);border-left-color:var(--mdr-line);background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}
.tzx-md hr{border:0;align-self:stretch;height:1px;margin:var(--mdr-space-2) 0;background:linear-gradient(90deg,transparent,var(--mdr-line) 15%,var(--mdr-line) 85%,transparent)}
.tzx-md a{border-radius:3px;color:var(--dsw-alias-link);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--dsw-alias-link) 40%,transparent);text-decoration-thickness:1px;text-underline-offset:3px;transition:color var(--mdr-motion-fast) var(--mdr-ease),text-decoration-color var(--mdr-motion-fast) var(--mdr-ease)}
.tzx-md a:hover{text-decoration-color:currentColor}
.tzx-md a:active{color:var(--dsw-alias-label-primary)}
.tzx-md a:focus-visible{outline:none;box-shadow:var(--mdr-focus-ring)}
.tzx-md strong{font-weight:600}
.tzx-md em{font-style:italic}
.tzx-md del{color:var(--dsw-alias-label-secondary);text-decoration:line-through}
/* 行内代码：原型 .86em / 8px 圆角 / 中性发丝边 / 4% 底色 / 强调色文字（深色自动跟随） */
.tzx-md code.dsh-md-render-md-code{padding:2px 6px;border:1px solid var(--mdr-hairline);border-radius:var(--mdr-radius-sm);background:var(--mdr-code-bg);font-family:var(--mdr-mono);font-size:.86em;line-height:1.5;color:var(--mdr-accent-text)}
/* 裸链接退化成纯文本样式（原型：muted + 点状下划线） */
.tzx-md .dsh-md-render-md-link-plain{color:var(--dsw-alias-label-secondary);text-decoration:underline dotted}
/* 图片 alt：原型实测 meta 一档对 12px 小字只有 3.62:1，改用 muted 一档（过 4.5:1） */
.tzx-md .dsh-md-render-md-img-alt{color:var(--dsw-alias-label-secondary);font-size:var(--mdr-fs-xs)}
.tzx-md img.dsh-md-render-md-img{max-width:100%;height:auto;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md);background:var(--mdr-surface)}
/* 可放大的图片（own-markdown.ts 追加 dsh-md-render-img-zoom）：指针与键盘都能触达 */
.tzx-md img.dsh-md-render-md-img.dsh-md-render-img-zoom{cursor:zoom-in;transition:border-color var(--mdr-motion-fast) var(--mdr-ease)}
.tzx-md img.dsh-md-render-md-img.dsh-md-render-img-zoom:hover{border-color:var(--mdr-accent-line)}
.tzx-md img.dsh-md-render-md-img.dsh-md-render-img-zoom:focus-visible{outline:none;box-shadow:var(--mdr-focus-ring)}
.tzx-md .dsh-md-render-md-html{color:var(--dsw-alias-label-secondary)}
.tzx-md .dsh-md-render-md-plain{margin:0;padding:var(--mdr-space-3) var(--mdr-space-4);border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md);background:var(--mdr-surface);font-family:var(--mdr-mono);font-size:var(--mdr-fs-xs);line-height:1.7;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}
/* 任务列表：勾选框也自绘（原生 disabled checkbox **不认** accent-color，实测宿主里恒为灰；
   ::before 画方框、::after 用 border 折角画勾，色彩全部取宿主语义变量 → 深浅色自动跟随。
   真实 input 仅 opacity:0（仍在无障碍树里，勾选状态可被读出），:has() 失配时整层退化为原生控件。
   勾选确认动效（原型 §D3）：勾形 rotate(45deg) scale(.6→1) + opacity，全长 150ms，只动 transform / opacity。 */
/* ⚠️ 这里**不写** cursor / :focus-within：真实 input 由 own-markdown.ts 渲染为 disabled+readOnly
   （markdown 是模型输出快照，勾选无法持久 —— 见文档「有意偏离」），写了就是永不触发的死规则。
   勾选态由 :has(:checked) 跟随**原文语义**（- [x]）呈现，键盘焦点环留给真正可交互的元素。 */
.tzx-md .dsh-md-render-md-task{position:absolute;left:0;top:6px;width:15px;height:15px;margin:0;appearance:none;border:0;background:transparent;opacity:0}
.tzx-md .dsh-md-render-md-task-item{position:relative;list-style:none;margin-left:calc(-1 * var(--mdr-space-6));padding-left:var(--mdr-space-6)}
.tzx-md .dsh-md-render-md-task-item::before{content:"";position:absolute;left:0;top:6px;width:15px;height:15px;border:1.5px solid var(--dsw-alias-label-tertiary);border-radius:5px;background-color:transparent;transition:background-color var(--mdr-motion-fast) var(--mdr-ease),border-color var(--mdr-motion-fast) var(--mdr-ease)}
.tzx-md .dsh-md-render-md-task-item:hover::before{border-color:var(--dsw-alias-label-secondary)}
.tzx-md .dsh-md-render-md-task-item:has(>.dsh-md-render-md-task:checked)::before{border-color:var(--mdr-accent);background-color:var(--mdr-accent)}
.tzx-md .dsh-md-render-md-task-item::after{content:"";position:absolute;left:4.5px;top:9px;width:4px;height:7.5px;border:solid var(--dsw-alias-label-primary-foreground);border-width:0 1.5px 1.5px 0;transform:rotate(45deg) scale(.6);opacity:0;transition:transform var(--mdr-motion-fast) var(--mdr-ease),opacity var(--mdr-motion-fast) var(--mdr-ease)}
.tzx-md .dsh-md-render-md-task-item:has(>.dsh-md-render-md-task:checked)::after{transform:rotate(45deg) scale(1);opacity:1}
@supports not selector(:has(*)){.tzx-md .dsh-md-render-md-task{position:static;width:auto;height:auto;opacity:1;appearance:auto}.tzx-md .dsh-md-render-md-task-item{padding-left:0}.tzx-md .dsh-md-render-md-task-item::before,.tzx-md .dsh-md-render-md-task-item::after{display:none}}
/* 表格：圆角外框 + 中性表头薄底 + 发丝行线 + 行 hover（原型同款；表头不再是强调色薄底） */
.tzx-md .dsh-md-render-md-table-wrap{overflow-x:auto;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md)}
.tzx-md table.dsh-md-render-md-table{border-collapse:collapse;width:100%;font-size:var(--mdr-fs-body);line-height:1.55}
.tzx-md .dsh-md-render-md-table th,.tzx-md .dsh-md-render-md-table td{padding:var(--mdr-space-2) var(--mdr-space-3);text-align:left;vertical-align:top;border-bottom:1px solid var(--mdr-line-soft)}
.tzx-md .dsh-md-render-md-table th{font-weight:600;background:var(--mdr-surface)}
.tzx-md .dsh-md-render-md-table tbody tr td{transition:background-color var(--mdr-motion-fast) var(--mdr-ease)}
.tzx-md .dsh-md-render-md-table tbody tr:hover td{background:var(--mdr-tint)}
.tzx-md .dsh-md-render-md-table tbody tr:last-child td{border-bottom:0}
.tzx-md .dsh-md-render-md-left{text-align:left}
.tzx-md .dsh-md-render-md-center{text-align:center}
.tzx-md .dsh-md-render-md-right{text-align:right}
/* 窄视口表格降到小字（原型 768 断点同款） */
@media (max-width:768px){.tzx-md table.dsh-md-render-md-table{font-size:var(--mdr-fs-xs)}}
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
/* container-type：把**卡片自身**声明为查询容器 —— 分档要按「可用宽度（消息列宽）」判，
   不是视口（大屏 + 侧栏展开时列可能只有 380px，视口断点判不到）。见下方 @container 分档。 */
.dsh-md-render-code{container-type:inline-size;position:relative;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--mdr-line);border-left:3px solid var(--mdr-accent);border-radius:var(--mdr-radius-md);background:var(--mdr-surface);box-shadow:var(--dsw-shadow-lv1)}
.dsh-md-render-code-head{display:flex;align-items:center;justify-content:flex-end;gap:var(--mdr-space-1);row-gap:2px;flex-wrap:wrap;padding:6px 10px 6px 12px;background:var(--mdr-tint);border-bottom:1px solid var(--mdr-line-soft)}
.dsh-md-render-code-lang{margin-right:auto;min-width:0;overflow:hidden;padding:1px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 22%,transparent);border-radius:var(--mdr-pill);background:var(--mdr-accent-soft);font-family:var(--mdr-mono);font-size:10px;font-weight:600;line-height:16px;letter-spacing:.08em;text-transform:uppercase;text-overflow:ellipsis;white-space:nowrap;color:var(--mdr-accent-text)}
.dsh-md-render-code-lang:empty{display:none}
.dsh-md-render-code-actions{display:inline-flex;align-items:center;gap:var(--mdr-space-1);flex:none}
.dsh-md-render-code-pre{margin:0;padding:12px 14px;overflow:auto;max-height:70vh;background:transparent;font-family:var(--mdr-mono);font-size:12.5px;line-height:1.7;tab-size:2;color:var(--dsw-alias-label-primary);white-space:pre;overflow-wrap:normal;word-break:normal}
.dsh-md-render-code-pre:focus-visible{outline:none;box-shadow:var(--mdr-focus-ring-inset)}
.dsh-md-render-code-pre code{font:inherit;color:inherit;background:none;border:0;padding:0;white-space:inherit;word-break:inherit}
/* ── 插件控件统一形态：胶囊按钮（复制 / 查看原文 / 整段复制 / 导出 / 视图切换）── */
/* 统一 26px 方格图标按钮：图标常显、宽度恒定 —— 收起文字后不塌、排布整齐。
   position:relative 是浮层（下方 ::after）的定位锚点。 */
.dsh-md-render-code-copy,.dsh-md-render-code-wrap-btn,.dsh-md-render-text-toggle,.dsh-md-render-copy,.dsh-md-render-mermaid-eb,.dsh-md-render-mermaid-vt{position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:26px;height:26px;padding:0;border:1px solid var(--mdr-line);border-radius:var(--mdr-pill);background:transparent;font:inherit;font-size:11px;font-weight:500;line-height:1;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:color var(--mdr-motion-fast) var(--mdr-ease),background-color var(--mdr-motion-fast) var(--mdr-ease),border-color var(--mdr-motion-fast) var(--mdr-ease),opacity var(--mdr-motion-fast) var(--mdr-ease)}
.dsh-md-render-code-copy:hover,.dsh-md-render-code-wrap-btn:hover,.dsh-md-render-text-toggle:hover,.dsh-md-render-copy:hover,.dsh-md-render-mermaid-eb:hover:not(:disabled),.dsh-md-render-mermaid-vt:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--mdr-accent-line);color:var(--dsw-alias-label-primary)}
.dsh-md-render-code-copy:focus-visible,.dsh-md-render-code-wrap-btn:focus-visible,.dsh-md-render-text-toggle:focus-visible,.dsh-md-render-copy:focus-visible,.dsh-md-render-mermaid-eb:focus-visible,.dsh-md-render-mermaid-vt:focus-visible{outline:none;box-shadow:var(--mdr-focus-ring)}
/* ── 控件「文字收起、只留图标」，悬停 / 键盘聚焦用**浮层**显示文字（用户口径）──
   为什么用浮层而不是就地撑开：就地撑开会把同一行相邻按钮推开 —— 鼠标扫过时整排抖动。
   浮层走 absolute（零布局位移）+ 向下弹出（top:100%）：卡片是 overflow:hidden，
   向上的浮层会被裁掉。
   文字来源是按钮的 data-dsh-md-render-tip（动作名，可较长）；aria-label 保持简短供屏幕阅读器 —— 两者职责不同。
   为什么必须每个按钮都有图标：没有图标的按钮收起文字就成空按钮，所以本轮补齐了
   maximize / fit / fill / minus / wrap / markdown / eye（共享图标集）并给所有控件接上。 */
:is(.tzx-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.md-code-block) [data-dsh-md-render-tip]::after{content:attr(data-dsh-md-render-tip);position:absolute;top:calc(100% + 5px);right:0;z-index:2;padding:2px var(--mdr-space-2);border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:400;line-height:16px;white-space:nowrap;box-shadow:var(--dsw-shadow-lv2);pointer-events:none;opacity:0;transform:translateY(-2px);transition:opacity var(--mdr-motion-fast) var(--mdr-ease),transform var(--mdr-motion-fast) var(--mdr-ease)}
:is(.tzx-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.md-code-block) [data-dsh-md-render-tip]:hover::after,
:is(.tzx-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.md-code-block) [data-dsh-md-render-tip]:focus-visible::after{opacity:1;transform:none}
/* 状态变化不能只靠悬停才知道（原型 §D 纪律）：复制成功 / 失败时浮层**常显**，
   与「图标换勾 + 语义色」一起构成不依赖鼠标的状态信号。 */
.dsh-md-render-copy[data-state="copied"]::after,.dsh-md-render-copy[data-state="failed"]::after,
.dsh-md-render-code-copy[data-state="copied"]::after{opacity:1;transform:none}
/* 触屏既没有 hover、也没有"悬停可发现"：按钮就地带文字（否则只剩图标，无从判断按钮做什么） */
@media (hover:none){
:is(.dsh-md-render-code-copy,.dsh-md-render-code-wrap-btn,.dsh-md-render-text-toggle,.dsh-md-render-copy,.dsh-md-render-mermaid-eb,.dsh-md-render-mermaid-vt){width:auto;min-width:26px;padding:0 var(--mdr-space-2)}
:is(.tzx-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.md-code-block) [data-dsh-md-render-tip]::before{content:attr(data-dsh-md-render-tip);white-space:nowrap}
:is(.tzx-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.md-code-block) [data-dsh-md-render-tip]::after{display:none}
}
/* ── 收纳取代「按宽度藏按钮」（用户口径 + 原型同步改版）──
   非核心进「更多」菜单后，常驻操作位只剩 3 个（视图切换 / 缩放分段 / 更多）：按钮从 8 个降到 3 个，
   就不存在「窄了该藏谁」的问题 —— 更少的按钮比「藏着但仍在」更干净。
   容器分档只留一条有实际意义的兜底：极窄（<360px）时缩放百分比值让位给图表（它是纯信息，不是操作）。
   降级：不支持 @container 的环境里百分比照常显示。 */
@container (max-width:359px){.dsh-md-render-mermaid-zoom-pct{display:none}}
/* 缩放分段：− / 百分比 / + 收进**一个**胶囊 —— 视觉上是一个控件，卡片头因此只需一行 */
.dsh-md-render-seg{display:inline-flex;align-items:center;flex:none;padding:2px;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-pill);background:var(--mdr-tint)}
.dsh-md-render-seg>.dsh-md-render-mermaid-eb{border:0;background:transparent}
/* ── 「更多」菜单：低频按钮的**收纳处**（而不是长期占位）──
   绝对定位贴到触发按钮下方、右对齐：纯 CSS 定位（不写 el.style），锚点是工具条容器（position:relative）。
   菜单放在卡片内 —— 卡片没有 overflow 裁切（代码块才有，而代码块没有菜单）。 */
.dsh-md-render-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:6;min-width:176px;padding:var(--mdr-space-1);border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-md);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2)}
.dsh-md-render-menu[hidden]{display:none}
.dsh-md-render-menu-item{display:flex;align-items:center;gap:var(--mdr-space-2);width:100%;padding:var(--mdr-space-1) var(--mdr-space-2);border:0;border-radius:var(--mdr-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;text-align:left;white-space:nowrap;cursor:pointer}
.dsh-md-render-menu-item:hover,.dsh-md-render-menu-item:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-md-render-menu-item:disabled{opacity:.45;cursor:not-allowed}
.dsh-md-render-menu-item svg{display:block;flex:none}
.dsh-md-render-menu-sep{height:1px;margin:var(--mdr-space-1) 0;border:0;background:var(--mdr-line-soft)}
/* 复制按钮：默认隐形，hover / 键盘 focus-within / 触屏常显三路可现 */
.dsh-md-render-code-copy{opacity:0}
.dsh-md-render-code:hover .dsh-md-render-code-copy,.dsh-md-render-code:focus-within .dsh-md-render-code-copy{opacity:1}
@media (hover:none){.dsh-md-render-code-copy{opacity:1}}
/* 换行切换：与复制按钮同一套浮现策略（hover / focus-within / 触屏常显），
   按下态用强调色胶囊 —— 一眼可辨「当前在看换行还是横向滚动」。 */
.dsh-md-render-code-wrap-btn{opacity:0}
.dsh-md-render-code:hover .dsh-md-render-code-wrap-btn,.dsh-md-render-code:focus-within .dsh-md-render-code-wrap-btn{opacity:1}
@media (hover:none){.dsh-md-render-code-wrap-btn{opacity:1}}
.dsh-md-render-code-wrap-btn[aria-pressed="true"]{border-color:var(--mdr-accent-line);background:var(--mdr-accent-soft);color:var(--mdr-accent-text)}
/* 换行态：长行折行显示（默认态是 white-space:pre 横向滚动，与官方 CodeBlock 的 wrap 语义对齐） */
.dsh-md-render-code-pre.dsh-md-render-code-wrap{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;overflow-x:hidden}
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
/* ⚠️ 尺寸**不再**单开例外（上一轮的 28px 文字胶囊已按「文字收起、只留图标」的口径撤回）：
   现在与卡片工具条同为 26px 方格图标按钮。别再把它撑成带文字的胶囊 —— 那会把整段复制的
   浮现按钮与工具条拉成两套形态。 */
.dsh-md-render-copy{opacity:0}
.tzx-md>.dsh-md-render-copy{position:absolute;right:10px;bottom:10px;background:var(--dsw-alias-bg-layer-2)}
.tzx-md:hover>.dsh-md-render-copy,.tzx-md:focus-within>.dsh-md-render-copy{opacity:1}
.tzx-md>.dsh-md-render-copy:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--mdr-accent-line);color:var(--dsw-alias-label-primary)}
/* 复制成功 / 失败走「文字级」语义色（原型 §E2：原色对 12px 小字对比度不足） */
.dsh-md-render-copy[data-state="copied"],.dsh-md-render-copy-done{border-color:var(--mdr-ok-ink);color:var(--mdr-ok-ink)}
.dsh-md-render-copy[data-state="failed"]{border-color:var(--mdr-bad-ink);color:var(--mdr-bad-ink)}
/* 状态确认动效（原型 §D1）：颜色过渡 150ms + 勾形图标 scale(1.12) */
.dsh-md-render-copy-ico{transition:transform var(--mdr-motion-fast) var(--mdr-ease)}
.dsh-md-render-copy[data-state="copied"] .dsh-md-render-copy-ico{transform:scale(1.12)}
[data-streaming] .dsh-md-render-copy{display:none}
[data-streaming] .dsh-md-render-text-toggle{display:none}
/* ── mermaid 图表卡片（自有 DOM）：与代码 / markdown 卡片同一套边框 / 圆角 / 层次 ── */
.dsh-md-render-mermaid-host{display:block;min-width:0}
.md-code-block[data-dsh-md-render-mermaid-view]>:not([class*=dsh-md-render]):not(.tzx-md){display:none}
.dsh-md-render-mermaid-card{container-type:inline-size;display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-lg);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1);font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);animation:dsh-md-render-mermaid-card-in 150ms var(--ds-ease-in-out)}
.dsh-md-render-mermaid-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:nowrap}
/* 用户口径：卡片头**最多一行**（不换行、不溢出）。空间不够时先压标题（省略号），
   再由 @container 让掉百分比值。position:relative 是「更多」菜单的定位锚点。 */
.dsh-md-render-mermaid-card-actions{position:relative;display:flex;align-items:center;gap:var(--mdr-space-1);margin-left:auto;flex:none;flex-wrap:nowrap}
.dsh-md-render-mermaid-eb svg,.dsh-md-render-mermaid-vt svg,.dsh-md-render-mermaid-card-title svg{display:block;flex:none}
.dsh-md-render-mermaid-eb:disabled{opacity:.45;cursor:not-allowed}
.dsh-md-render-mermaid-notice{border-radius:var(--mdr-radius-sm);padding:4px 10px;font-size:12px;line-height:20px}
.dsh-md-render-mermaid-notice-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-md-render-mermaid-notice-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
/* 卡片标题与代码块语言胶囊同一形态：强调色 + 大写 + 字距（自有标签语言） */
.dsh-md-render-mermaid-card-title{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 22%,transparent);border-radius:var(--mdr-pill);background:var(--mdr-accent-soft);font-family:var(--mdr-mono);font-size:10px;font-weight:600;line-height:16px;letter-spacing:.08em;text-transform:uppercase;color:var(--mdr-accent-text)}
.dsh-md-render-mermaid-view-toggle{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--mdr-line);border-radius:var(--mdr-pill);background:var(--mdr-tint);flex:none}
.dsh-md-render-mermaid-vt{border:0;background:transparent}
.dsh-md-render-mermaid-view-toggle>.dsh-md-render-mermaid-vt-active{background:var(--mdr-accent-soft);color:var(--mdr-accent-text);font-weight:600}
.dsh-md-render-mermaid-svg{position:relative;overflow:auto;max-height:70vh;min-height:160px;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md);background-image:radial-gradient(color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent) 1px,transparent 1px);background-size:18px 18px}
.dsh-md-render-mermaid-svg[data-dsh-md-render-zoom]{overflow:hidden}
/* ⚠️ 变换层**必须留在文档流里**（高度 = 内容固有高度）：容器的 max-height:70vh 配上变换层
   撑开 ⇒ **容器高度随内容自适应**（短图矮、长图封顶 70vh）。曾试过让变换层绝对定位填满容器
   来对齐缩放锚点 —— 结果容器塌回 min-height(160px)：高度自适应没了，fit 又按 160px 算，
   图表被压到 20% 上下（用户真机反馈「所有都是固定高度」）。
   锚点（变换层中心）≠ 容器中心的问题由 zoom-math.ts 的 zoomCenterInFrame 在程序性缩放后
   **显式平移**解决 —— 不要再用改尺寸的方式绕。
   变换层也不写 transform-origin：两个引擎都会内联覆盖成 50% 50%，写在这里只会误导后来者。 */
.dsh-md-render-mermaid-canvas{display:flex;align-items:center;justify-content:center}
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
/* 缩放百分比：分段中间的**显示值**（由 zoom-math.ts 更新 textContent）—— 不是动作名，保留文字 */
.dsh-md-render-mermaid-zoom-pct{display:inline-flex;align-items:center;justify-content:center;min-width:42px;font-family:var(--mdr-mono);font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-md-render-mermaid-fs{display:flex;flex-direction:column;gap:6px;width:90vw;height:85vh;max-width:none;max-height:none;margin:auto;padding:8px 10px;border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-lg);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2);font-size:14px;color:var(--dsw-alias-label-primary)}
.dsh-md-render-mermaid-fs::backdrop{background:color-mix(in srgb,var(--dsw-alias-label-primary) 45%,transparent)}
.dsh-md-render-mermaid-fs-bar{display:flex;justify-content:flex-end;gap:6px;flex:none}
.dsh-md-render-mermaid-fs>.dsh-md-render-mermaid-host{flex:1;min-height:0;display:flex;flex-direction:column}
.dsh-md-render-mermaid-fs .dsh-md-render-mermaid-card{flex:1;min-height:0;overflow:hidden;padding:0;border:0;box-shadow:none}
.dsh-md-render-mermaid-fs .dsh-md-render-mermaid-svg{max-height:none;flex:1;min-height:0}
/* ── 图片放大灯箱（medium-zoom / PhotoSwipe 通行做法）：页面内 <dialog> 模态，
   图片 contain 装入、Esc / 点遮罩 / 点图片三路关闭；焦点归还由浏览器兜底。 ── */
/* 原型 §C：图片**直接浮在遮罩上**（不是面板）—— dialog 自身透明、无边框、无内边距；
   尺寸固定为 92vw×92vh 以保留「点空白区（= 遮罩）关闭」这条路径（原型同尺寸口径）。 */
.dsh-md-render-img-lightbox{display:flex;align-items:center;justify-content:center;width:92vw;height:92vh;max-width:none;max-height:none;margin:auto;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;cursor:zoom-out}
/* 遮罩抽成 --mdr-scrim token（原型 §D2：直接拿正文色混，深色态会变成一片浅灰） */
.dsh-md-render-img-lightbox::backdrop{background:var(--mdr-scrim)}
.dsh-md-render-img-lightbox-wrap{position:relative;display:flex;align-items:center;justify-content:center;max-width:100%;max-height:100%}
/* max-height 取 86vh 而不是 100%：给右上角外挂的关闭按钮（-14px -14px）留出可视余量（原型同口径） */
.dsh-md-render-img-lightbox-img{display:block;max-width:100%;max-height:86vh;object-fit:contain;border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-md);box-shadow:var(--dsw-shadow-lv2)}
/* 关闭按钮：32px 圆形，挂在图片右上角外侧（原型同款）；Esc / 点遮罩 / 点图片三路关闭不变 */
.dsh-md-render-img-lightbox-close{position:absolute;top:-14px;right:-14px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:32px;height:32px;padding:0;border:0;border-radius:var(--mdr-pill);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;box-shadow:var(--dsw-shadow-lv2)}
/* 叉线：两条 1.8px 圆角线对折 45°（等价于原型 16px viewBox 的 1.8 stroke path） */
.dsh-md-render-img-lightbox-close::before,.dsh-md-render-img-lightbox-close::after{content:"";position:absolute;width:14px;height:1.8px;border-radius:1px;background:currentColor}
.dsh-md-render-img-lightbox-close::before{transform:rotate(45deg)}
.dsh-md-render-img-lightbox-close::after{transform:rotate(-45deg)}
.dsh-md-render-img-lightbox-close:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-md-render-img-lightbox-close:focus-visible{outline:none;box-shadow:var(--mdr-focus-ring)}
/* 图片放大浮窗进入动效（原型 §D4）：220ms opacity + scale(.985→1)，遮罩淡入 */
.dsh-md-render-img-lightbox[open]{animation:dsh-md-render-dlg-in var(--mdr-motion-base) var(--mdr-ease)}
.dsh-md-render-img-lightbox[open]::backdrop{animation:dsh-md-render-dlg-backdrop-in var(--mdr-motion-base) var(--mdr-ease)}
@keyframes dsh-md-render-dlg-in{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:scale(1)}}
@keyframes dsh-md-render-dlg-backdrop-in{from{opacity:0}to{opacity:1}}
/* ── 离屏渲染容器（失败时的炸弹图只落这里）── 必须在布局树内（display:none 会量不到尺寸）。 */
.dsh-md-render-offscreen{position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none}
@keyframes dsh-md-render-mermaid-card-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}
@keyframes dsh-md-render-mermaid-spin{to{transform:rotate(360deg)}}
/* ══ 动效纪律（原型 §D / craft animation-discipline）══
   · hover 与微状态高频 → --mdr-motion-fast(150ms)；进入 UI → --mdr-motion-base(220ms)
   · 只动 transform / opacity；动画不作为状态变化的唯一信号（勾选框本身、按钮文案同步变化）
   · prefers-reduced-motion：全部关掉，**不做**妥协式"缩短"
   范围：markdown 内容 + 整段复制 + 图片放大浮窗（卡片 / 图表动效不在本轮范围，见文档）。 */
@media (prefers-reduced-motion:reduce){
.tzx-md a,.tzx-md img.dsh-md-render-md-img.dsh-md-render-img-zoom,.tzx-md .dsh-md-render-md-table tbody tr td,.tzx-md .dsh-md-render-md-task-item::before{transition:none}
.tzx-md .dsh-md-render-md-task-item::after{transform:rotate(45deg);opacity:0;transition:none}
.tzx-md .dsh-md-render-md-task-item:has(>.dsh-md-render-md-task:checked)::after{transform:rotate(45deg);opacity:1}
.dsh-md-render-copy,.dsh-md-render-copy-ico,.dsh-md-render-code-copy,.dsh-md-render-code-wrap-btn,.dsh-md-render-text-toggle,.dsh-md-render-mermaid-eb,.dsh-md-render-mermaid-vt{transition:none}
.dsh-md-render-copy[data-state="copied"] .dsh-md-render-copy-ico{transform:none}
:is(.tzx-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.md-code-block) [data-dsh-md-render-tip]::after{transition:none}
.dsh-md-render-img-lightbox[open],.dsh-md-render-img-lightbox[open]::backdrop{animation:none}
}
`
