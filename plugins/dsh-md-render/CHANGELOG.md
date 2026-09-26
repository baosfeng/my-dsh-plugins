# Changelog

本文件记录 dsh-md-render 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 公共 API 承诺面：`MarkdownView`（导出 / props / 自有 DOM 类名清单见 [README「公共 API 契约」](README.md)）；改类名清单 = 破坏性变更，须同步 README 与本文件。

## [0.3.0]

### 移除（与官方重复的实现，官方 0.1.7-rc.2 已内置）

- **自实现 GFM 表格渲染**（`detect.ts` / `render.ts` / `MarkdownView` 的表格分支）：官方 `micromark-extension-gfm` + 宽表格横向滚动（`ui-primitives/src/markdown/render.tsx`）已覆盖；
- **自实现公式排版**（`math.ts` / `math-render.ts` / `math-symbols.ts`）：官方 `micromark-extension-math` + KaTeX（`katex.tsx`）已覆盖；
- **自实现代码块增强**（`highlight.ts` / `codeblock.ts`）：官方 `CodeBlock.tsx`（shiki 高亮 / 语言标签 / 行号 / 复制 / 主题）已覆盖；
- **轨迹视图 markdown 接管**（`trajectory-markdown.ts` / `dom-markdown.ts`）与 **DOM 表格扫描**：官方轨迹视图本身即用 `MarkdownText` 渲染，接管已无收益；
- **旧配置开关**：`syntaxHighlight` / `languageLabel` / `lineNumbers` / `taskList` / `strikethrough` / `image` / `nestedList` / `mathStructures` / `tableSort` / `tableFold` / `copyButtonPosition` / `codeTheme`（patch 文件里的旧键保留无害、被忽略）。

### 变更

- **全部渲染交给官方 `MarkdownText`**：两个注入点（`text` 围栏块、`pre[data-context-text]` 上下文块）经 `react-dom/client` 把官方组件挂到本插件插入的容器里；`MarkdownView` 变为官方渲染 + 表格容错 + 整段复制；官方组件不可用时真降级（`<pre>` 兜底 / 注入点不动宿主 DOM）；
- **表格容错保留为纯文本规范化**（`table-normalize.ts`）：只规范化官方 GFM 不认的两种分隔行写法（无管道符 / 列数与表头不等），GFM 已接受的写法一字不动（实测证据见 `test/table-normalize.mjs`）；
- **配置面收敛为三项开关**：`copyButton` / `textFenceMarkdown` / `contextMarkdown`（默认全开）；
- 客户端产物 165 KB → 43 KB（`lib/client.js`），新增依赖面为零（只用平台 seed 模块）。

## [0.2.0] - 2026-09-21

### 变更

- docs(dsh-md-render): #393 补 text 围栏块渲染效果图与 README 引用
- feat(dsh-md-render): #393 text/plaintext/txt 围栏块按 markdown 渲染（含查看原文切换） (#395)

## [0.1.9] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- fix: rebuild client.js for mermaid-render and md-render
- chore: 项目全面优化和完善

## [0.1.8] - 2026-09-10

### 变更

- fix(ts): 迁移遗留修复（ambient 声明污染 / 类型契约 / 源码产物同步）
- feat(dsh-my-guard): migrate to TypeScript
- feat: complete TypeScript migration for dsh-md-render
- feat(dsh-md-render): migrate to TypeScript
- fix(dsh-md-render): 代码块主题前景色自洽（深背景黑字不可见）+ 行号贴边
- fix(dsh-md-render): 设置页 tab 首屏注册时序（slots 服务未 active 时静默跳过，strict=false 取服务实例 + 防回归测试）
