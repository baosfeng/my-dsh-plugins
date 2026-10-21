// ── markdown 内容渲染样式（自有 vdom 的全部外观）────────────────────────
// 真源：docs/原型重构/dsh-md-render.html 1116–1321（.md-body 一族）+ 设计基线 §二 markdown。
// 口径：
//   · 正文 13px / 1.72，标题阶梯 18 / 16 / 14 / 14 / 13 / 12；
//   · 列表 ::marker 用三级文字色，任务列表是只读复选框（input[disabled][readonly] +
//     :has() 画勾，勾形 150ms），已完成项灰字 + 删除线；
//   · 表格走圆角外框 + 中性表头 + 行 hover；引用 2px 强调左线 + 薄底 + 7px 右圆角，
//     表格卡是 Liquid Glass 材质（backdrop-filter + 统一卡片阴影）；
//     嵌套引用降级为中性细线；
//   · 行内码 6px 圆角（--mdr-radius-sm）+ 发丝边 + 宿主行内码底 + 强调文字色；
//   · 整段复制按钮绝对定位右上角，hover / focus 浮现。
// 颜色只取 styles-base.ts 的 --mdr-* token（或宿主 --dsw-*），本文件**不写裸十六进制**。
// 脚本模式片段（无 import/export），与 styles-base.ts 同作用域拼接。
const STYLES_MARKDOWN: string = `
/* ══ markdown 正文根 ══ */
.mdr-md{
display:flex;
flex-direction:column;
gap:var(--mdr-body-gap);
min-width:0;
position:relative;
font-family:var(--mdr-font-sans);
font-size:13px;
line-height:1.72;
color:var(--mdr-text-2);
}

/* ══ 段落 / 标题（原型 1126–1147 + 任务口径 h1–h6 = 18/16/14/14/13/12）══ */
.mdr-md p{margin:0}
.mdr-md h1,.mdr-md h2,.mdr-md h3,.mdr-md h4,.mdr-md h5,.mdr-md h6{
margin:2px 0 0;
color:var(--mdr-text);
font-weight:var(--mdr-heading-weight);
line-height:1.4;
letter-spacing:var(--mdr-heading-tracking);
}
.mdr-md h1{font-size:18px}
.mdr-md h2{font-size:16px}
.mdr-md h3{font-size:14px}
.mdr-md h4{font-size:14px}
.mdr-md h5{font-size:13px}
.mdr-md h6{font-size:12px;color:var(--mdr-text-2)}

/* ══ 强调 / 链接（原型 1162–1173）══ */
.mdr-md strong{color:var(--mdr-text);font-weight:600}
.mdr-md em{font-style:italic}
.mdr-md del{color:var(--mdr-text-3)}
.mdr-md a{
color:var(--mdr-accent);
text-decoration:none;
border-bottom:1px solid color-mix(in srgb,var(--mdr-accent) 35%,transparent);
transition:border-bottom-color var(--mdr-motion-fast) var(--mdr-ease),color var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-md a:hover{border-bottom-color:var(--mdr-accent);color:var(--mdr-accent-hover)}

/* ══ 列表（原型 1148–1161）══ */
.mdr-md ul,.mdr-md ol{
margin:0;
padding-left:20px;
display:flex;
flex-direction:column;
gap:3px;
}
.mdr-md li{min-width:0}
.mdr-md li::marker{color:var(--mdr-text-3)}

/* ══ 任务列表（原型 1229–1266；只读复选框 + :has 勾形）══ */
.mdr-md-task-list{list-style:none;padding-left:2px;gap:var(--mdr-space-1)}
.mdr-md-task-item{
display:flex;
align-items:flex-start;
gap:7px;
position:relative;
}
.mdr-md-check{
width:14px;
height:14px;
margin:4px 0 0;
flex:none;
border:1px solid var(--mdr-border);
border-radius:var(--mdr-radius-sm);
background:var(--mdr-surface);
appearance:none;
-webkit-appearance:none;
cursor:default;
transition:background var(--mdr-motion-fast) var(--mdr-ease),border-color var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-md-task-item::after{
content:'';
position:absolute;
left:5px;
top:8px;
width:3px;
height:7px;
border:solid var(--mdr-on-accent);
border-width:0 1.5px 1.5px 0;
transform:rotate(45deg);
opacity:0;
transition:opacity var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-md-task-item:has(>.mdr-md-check:checked)::after{opacity:1}
.mdr-md-task-item:has(>.mdr-md-check:checked)>.mdr-md-check{
background:var(--mdr-accent);
border-color:var(--mdr-accent);
}
.mdr-md-task-item.is-done{color:var(--mdr-text-3)}
.mdr-md-task-item.is-done span,
.mdr-md-task-item.is-done strong{
color:var(--mdr-text-3);
text-decoration:line-through;
text-decoration-color:var(--mdr-border);
}

/* ══ 表格（原型 1196–1228：圆角外框 + 中性表头 + 行 hover）══ */
.mdr-md-table-wrap{
overflow-x:auto;
border:1px solid var(--mdr-border);
border-radius:var(--mdr-radius-md);
background:var(--mdr-surface);
backdrop-filter:var(--mdr-material);
box-shadow:var(--mdr-card-shadow);
max-width:100%;
}
.mdr-md-table{
width:100%;
border-collapse:collapse;
font-size:12px;
min-width:420px;
}
.mdr-md-table th{
background:var(--mdr-table-head-bg);
color:var(--mdr-text-2);
font-weight:600;
text-align:left;
padding:7px 10px;
border-bottom:1px solid var(--mdr-border);
white-space:nowrap;
}
.mdr-md-table td{
padding:7px 10px;
border-bottom:1px solid var(--mdr-border-soft);
color:var(--mdr-text-2);
vertical-align:top;
}
.mdr-md-table tr:last-child td{border-bottom:0}
.mdr-md-table tbody tr td{transition:background var(--mdr-motion-fast) var(--mdr-ease)}
.mdr-md-table tbody tr:hover td{background:var(--mdr-bg-hover)}

/* ══ 引用（原型 1174–1184：2px 强调左线 + 薄底 + 7px 右圆角）══ */
.mdr-md blockquote{
margin:0;
padding:6px 12px;
border-left:2px solid var(--mdr-quote-border);
background:var(--mdr-quote-bg);
border-radius:0 7px 7px 0;
color:var(--mdr-text-2);
}
.mdr-md blockquote p{margin:0}
.mdr-md blockquote blockquote{
background:transparent;
border-left-color:var(--mdr-border);
border-radius:0 var(--mdr-radius-sm) var(--mdr-radius-sm) 0;
}

/* ══ 分隔线（原型 1185–1189）══ */
.mdr-md hr{margin:2px 0;border:0;border-top:1px solid var(--mdr-border-soft)}

/* ══ 图片（原型 1190–1195）══ */
.mdr-md img{
max-width:100%;
display:block;
border:1px solid var(--mdr-border-soft);
border-radius:var(--mdr-radius-md);
}
.mdr-md-img{cursor:zoom-in}
.mdr-md-img:focus-visible{outline:2px solid var(--mdr-focus-ring);outline-offset:2px}
.mdr-md-img-alt{color:var(--mdr-text-3);font-style:italic}
.mdr-md-link-plain{color:var(--mdr-text-2);word-break:break-all}

/* ══ 行内码（4px 圆角 + 发丝边 + 宿主行内码底 + 强调文字）══ */
.mdr-md :not(pre)>code{
padding:1px 4px;
border:1px solid var(--mdr-border-soft);
border-radius:var(--mdr-radius-sm);
background:var(--mdr-code-bg);
color:var(--mdr-accent);
font-family:var(--mdr-font-mono);
font-size:12px;
line-height:1.5;
overflow-wrap:anywhere;
}

/* ══ 代码块兜底（围栏块由 MdrCodeBlock 接管；解析层未就绪时落这里）══ */
.mdr-md-pre{
margin:0;
padding:10px 12px;
border:1px solid var(--mdr-border-soft);
border-radius:var(--mdr-radius-md);
background:var(--mdr-code-bg);
color:var(--mdr-text-2);
font-family:var(--mdr-font-mono);
font-size:11.5px;
line-height:1.65;
white-space:pre-wrap;
word-break:break-word;
overflow-x:auto;
}
.mdr-md-pre>code{padding:0;border:0;background:transparent;color:inherit;font-size:inherit}

/* ══ 整段复制按钮（原型 1267–1281：右上角 hover / focus 浮现）══ */
.mdr-md-copy{
position:absolute;
top:-2px;
right:0;
opacity:0;
transition:opacity var(--mdr-motion-fast) var(--mdr-ease),color var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-md:hover .mdr-md-copy,.mdr-md-copy:focus-visible{opacity:1}
.mdr-md .mdr-md-copy.is-copied{opacity:1;color:var(--mdr-success)}
.mdr-md-copy:focus-visible{outline:2px solid var(--mdr-focus-ring);outline-offset:1px}

/* ══ 解析异常兜底（原文一字不丢）══ */
.mdr-md-plain{
margin:0;
padding:10px 12px;
border:1px solid var(--mdr-border-soft);
border-radius:var(--mdr-radius-md);
background:var(--mdr-code-bg);
color:var(--mdr-text-2);
font-family:var(--mdr-font-mono);
font-size:11.5px;
line-height:1.65;
white-space:pre-wrap;
word-break:break-word;
}

/* ══ 动效纪律：markdown 内容的过渡在 reduced-motion 下全关 ══ */
@media (prefers-reduced-motion:reduce){
.mdr-md a,.mdr-md img,.mdr-md .mdr-md-copy,.mdr-md .mdr-md-check,
.mdr-md .mdr-md-task-item::after,.mdr-md-table tbody tr td{transition:none}
}
`

exports.STYLES_MARKDOWN = STYLES_MARKDOWN
