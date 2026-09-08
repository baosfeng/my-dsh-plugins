# Changelog

本文件记录 dsh-md-render 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 修复

- **代码块主题前景色自洽**：代码主题（codeTheme）此前只定义背景/边框/token 色，代码块文字色继承宿主 `.tzx-md` 的 `--dsw-alias-label-primary`。当系统 `prefers-color-scheme: dark` 而宿主 DSH 为浅色主题时，暗色变体把代码块背景反转成深色（如 `github-light` → `#0d1117`），文字仍是浅色主题的黑字 → **深背景黑字，代码内容不可见**。修复：为每个主题（含暗色变体）定义自洽前景色 `--dsh-md-render-code-fg`，`.tzx-pre` 的 `color` 使用它（fallback 宿主 primary），代码块内文字恒可见、不受宿主主题影响。
- **代码块行号贴边**：行号列由 `3.5em` 缩窄到 `2.25em`、`::before` 宽由 `3em` 缩到 `1.75em`，`pre` 左内边距由 `16px` 收紧到 `12px`，行号更贴近代码块左边缘、与代码内容间距更紧凑。

### 测试

- 新增 `test/codeblock-theme-css.mjs`：静态断言主题契约——`.tzx-pre` 的 `color` 使用 `--dsh-md-render-code-fg`、每个 `data-theme`（含暗色变体的 bright/github-light）定义前景色、浅色/深色主题前景与背景亮度互补（自洽可见）。

## [0.1.7] - 2026-09-07

### 变更

- chore(plugins): #165 清理失效的 dsh.client.inject 声明（13 插件） (#167)

## [0.1.6] - 2026-09-06

### 变更

- feat(observability): #155 插件日志体系补齐——7 插件关键行为/异常结构化日志（基础层） (#159)
- feat(md-render): #146 代码块复制按钮位置可配置 + 内置 5 套代码主题 (#150)

## [0.1.5] - 2026-09-04

### 变更

- fix(md-render): 渲染设置页加载失败诊断——区分 404（服务端未加载）/403（围栏）/网络错误 + 针对性提示 + 重试按钮

## [0.1.4] - 2026-09-04

### 修复

- 修复 client 端 `ctx.config` 访问导致的 `cannot get property "config" without inject`（插件客户端 failed to apply，渲染/设置页不可用）：改为默认全开 + 异步 GET /md/api/config 拉取真实配置（0.1.3 发布版本缺陷修复）

### 变更

- 验证清单与效果图同步

## [0.1.3] - 2026-09-04

### 新增

- [#84](https://github.com/baosfeng/my-dsh-plugins/issues/84) 增强功能配置化：11 个开关（copyButton/syntaxHighlight/languageLabel/lineNumbers/taskList/strikethrough/image/nestedList/mathStructures/tableSort/tableFold）+ 设置 → 插件 → 渲染 页签 + 配置持久化（GET/PUT /md/api/config）+ 热生效
- [#82](https://github.com/baosfeng/my-dsh-plugins/issues/82) 公式渲染增强：轻量 LaTeX 子集（分数 \frac / 根号 \sqrt / 上下标 / \sum \int / 希腊字母），受 mathStructures 开关门控，零依赖

## [0.1.2] - 2026-08-28

### 变更

- feat(ui): dsh-md-render 表格/代码块视觉统一——前缀拆分（issue #54）
- chore(deps): 升级 react 19 兼容性——13 个插件 peer 声明 ^18.2.0 || ^19.2.0（issue #49）
- style(format): 全仓 prettier 格式化（issue #44）
- fix(ci): 修复 7 个 eslint 质量门禁错误（CI lint 失败，issue #36 范围）

## [0.1.1] - 2026-08-29

### 新增

- **统一 MarkdownView（issue #31 渲染职责迁移）**：承接 dsh-think-zh-expand 迁出的渲染职责——`lib/parts/markdown.part.js` 提供统一 MarkdownView 组件（`mdInline` + 块级 `tryXxx` 管线），输出结构保持迁移前约定（`div.tzx-md` / `p.tzx-p` / `table.tzx-table` / `div.md-code-block`）；`exports.MarkdownView` 供 think-zh-expand 跨插件 require（其 `dsh.client.external` 声明依赖本插件）。
- **公式渲染（自实现零依赖）**：行内 `$...$` 渲染为 `span.dsh-md-render-math`（货币 `$5` / 变量 `a$b` / 块级 `$$` 保护），块级 `$$...$$`（单行/多行）渲染为 `div.dsh-md-render-math-block`。
- **公式错误提示（issue #32）**：公式内容异常（行内未闭合 `$`、内容以空白开头/空公式、跨行、块级未闭合/空）渲染为 `span.dsh-md-render-math-error` / `div.dsh-md-render-math-error`——显示原文 + 错误样式（DSH 语义 token `--dsw-alias-state-error-primary`，参考内置 `katex-error` 语义），不破坏整体布局；货币/变量/块级保护不误报。
- **md-code-block 容器归属**：代码块容器 `div.md-code-block`（含 `pre.tzx-pre` > `code.language-*`）由本插件 MarkdownView 产出，dsh-mermaid-render 无需改动即可扫描。
- **测试**：新增 `test/markdown-view.mjs`（表格/公式/代码块容器/回退/多反引号断言）；Gherkin 新增统一渲染器场景（标准表格/代码块容器/公式/公式错误提示）。

## [0.1.0] - 2026-08-27

### 新增

- **非思考模式 markdown 表格渲染增强**：扫描 `div.tzx-md`（dsh-think-zh-expand 的 MarkdownView 输出）与 `div.md-table-wide`（内置 MarkdownText 宽表格容器）内的表格文本段落，识别并渲染为真正的 `<table>`（表头 thead / 数据 tbody / 逐列对齐）。
- **增强表格检测**：表头/数据行只需含 `|` 且 ≥2 列（允许无首尾管道符）；分隔行支持 `--- | ---`、`-|-|-`、`---` 等变体；对齐标记 `:---` 左、`:---:` 中、`---:` 右。
- **宽表格横向滚动**：表格外层 `div.dsh-md-render-table-scroll` 容器 `overflow-x: auto`，宽表格不撑破消息气泡。
- **表格样式**：表头底色 + 加粗、行分隔线，走 DSH 语义 token，深浅主题自适应；样式随 activation 注入、fiber teardown 卸载。
- **兼容 dsh-think-zh-expand**：已渲染的表格（`table.tzx-table`）不重复处理；思考模式（reasoning 块）表格渲染不受影响。
- **流式兼容**：MutationObserver 跟随流式渲染，流式中的容器（`[data-streaming]` 祖先）等内容稳定后再处理。
- **零依赖**：表格检测与渲染全部自实现，无第三方库、无 CDN。
