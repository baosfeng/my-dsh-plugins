// ── 样式聚合器（**唯一**对外导出的样式表，随 activation 注入）──────────────
// 口径（最高优先级）：「全部使用我们自己的，外观也是」——视觉语言全部由本插件定义，
// 宿主样式只作为**颜色与主题来源**被读取（--dsw-* / --dsh-* 语义变量随深浅色自动切换，
// 绝不硬编码十六进制）。视觉真源 = docs/md渲染/原型（docs/原型重构/dsh-md-render.html）。
//
// 架构（v2，三路拆分后）：样式按「谁用谁写」拆成 5 个 part，本文件只做**有序聚合**——
//   ① styles-base.ts      设计 token / 通用控件（.mdr-btn / .mdr-seg / .mdr-switch / .mdr-toast…）/ 动效纪律
//   ② styles-markdown.ts  markdown 内容（.mdr-root .mdr-md 下的排版 / 表格 / 任务列表）
//   ③ styles-code.ts      围栏块（卡片头 / 行号 / 语言胶囊 / 三态底栏）+ 设置页之外的交互件
//   ④ styles-mermaid.ts   mermaid 卡片 / 全屏 dialog / 缩放工具条
//   ⑤ styles-settings.ts  设置页（双 tab / 分组头 / 开关行 / 保存与恢复默认）
// 顺序即级联顺序：base 在前提供 token 与通用控件，其余按功能区叠加。改样式只改对应 part，
// 本文件保持「只有一行拼接」——静态断言（test/mdr-*.mjs）钉住各 part 的导出与几何。
//
// 硬约束（test/static-assertions.mjs 钉死）：只写自有 DOM 与自有 data-* 作用域；不用 el.style；
// 颜色只用宿主语义变量或 color-mix 派生（禁裸十六进制、禁 --shiki-token-*）。
const STYLES: string = STYLES_BASE + STYLES_MARKDOWN + STYLES_CODE + STYLES_MERMAID + STYLES_SETTINGS
