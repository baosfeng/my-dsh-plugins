# 04 轮次与决策记录

## r1 · 2026-10-21 · 首版 4 套主题对照

**目标**：给用户一个能点的单页，4 套候选 × 浅/深，全部控件 1:1 还原真实 md-render 结构。

**做法**

- 以 `src/client/parts/{styles-base,styles-markdown,styles-code,styles-mermaid}.ts` 为真源，类名与结构逐条对齐：
  `.mdr-root/.mdr-md`、`.mdr-fence*`、`.mdr-mm-*`、`.mdr-ctx*`、`.mdr-copy*`、`.mdr-seg/.mdr-icon-btn/.mdr-pill`。
- 单文件 `08-prototype.html`：同一份 DOM，`<html data-theme>` 切 4 套主题、`data-mode` 切浅/深；主题层只做 token 覆写。
- 页内 `:root` 模拟 `--dsw-*` 浅/深两套：这是全文件**唯一**出现原始色值的地方（8 位 hex），主题层零裸色值。
- 演示件（主题条 / 深浅切换 / 决策面板）打 `data-od-id="demo-only:*"`，并写明不进产品。

**这一轮解决的问题**

| 问题 | 处理 |
|---|---|
| 外链（RFC / 内部文档）被判「引用外部资源」P0 | 改成同源相对路径 `/docs/...`；真实 markdown 渲染里本来就是同源链接 |
| `:root` 缺核心 6 个语义变量（P0） | `:root` 补 `--bg/--surface/--fg/--muted/--border/--accent`，深色态再绑一次 |
| 5/7 个顶层区块缺 `data-od-id`（P0） | `main` + 4 个主题面板 + 全屏 dialog 全部补锚点 |
| 断点 1440/1024/768/390 不全（P0） | 媒体查询精确改成 `max-width:1440/1024/768/390px` |
| Editorial Paper 中文不是衬线 | `ui-serif` 在 Chromium 对 CJK 不生效；把 `"Songti SC"` 放栈首后实测为 Songti |
| Glassmorphism 浅色被背景光斑洗白 | 材质 48% → 58%，背景光斑 opacity 0.95 → 0.7；深色 44% → 54% |
| mermaid 45% 缩放后图太小 | 基准 SVG 600×250 → 1200×500，缩放从 `transform:scale` 改为 `zoom`（参与布局，不产生溢出） |
| mermaid「代码」分段点了没内容 | `<pre class="mdr-mm-code" hidden>` 的 HTML `hidden` 属性压过 CSS 视图规则，移除 |

**自测证据**

- `odops verify .open-design/08-prototype.html --platform web --browser` → **exit 0**（全部 ok，仅 3 条 warn，见 05-checklist）。
- 真实点击（agent-browser `click`，非合成 `el.click()`）：
  - 主题切到 liquid-glass、深浅切到 dark → `data-theme/data-mode` 生效，`--mdr-material` = `blur(22px) saturate(180%)`；
  - 围栏「复制」→ 文案变「已复制」+ `.is-copied`；自动换行 → `data-mdr-wrap=on`；行号 → `data-mdr-lines=on`；
  - mermaid「代码」分段 → 源码 `display:block`、图表隐藏；更多菜单打开；全屏 dialog `open=true` 且 SVG 已克隆；
  - 关闭全屏、缩放 + → 60%。
- 390 宽度整页截图检查：表格/代码在各自容器内横向滚动，页面本身无横向溢出。

**产物**

- `08-prototype.html`（单文件，CSS 内联，无外部请求）
- `shots/p-1440.jpg` / `p-1024.jpg` / `p-768.jpg`（jpg q80，均 ≤600KB）

## 待用户决策

1. 选哪一套主题（可混搭，例如 Liquid Glass 的卡片 + Apple Native 的代码卡）。
2. 玻璃系若入选，确认卡片材质最低不透明度 54%（浅色）/ 54%（深色）这条可读性红线。
3. 是否保留 Editorial Paper 作为「阅读模式」第二主题（需要主题切换能力，当前插件没有）。
