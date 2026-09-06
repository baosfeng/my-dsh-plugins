# Changelog

本文件记录 dsh-think-zh-expand 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.8] - 2026-09-06

### 变更

- feat(observability): #155 插件日志体系补齐——7 插件关键行为/异常结构化日志（基础层） (#159)

## [0.4.7] - 2026-09-04

### 变更

- fix(think-zh-expand): 剥离模型输出的 xml 控制标签（<review>/<think>/<answer>）——原样渲染成裸文本的"无效标签"效果
- docs: #106 安装命令统一加 --trust-lockfile (#113)

## [0.4.6] - 2026-09-01

### 变更

- fix(think-zh-expand): #73 思考块样式完全回官方默认（ReasoningRow） (#98)
- chore(release): dsh-think-zh-expand v0.4.5（自动 bump patch + CHANGELOG 生成）
- Merge branch 'issue-57-think-visual-rollback'
- fix(ui): dsh-think-zh-expand 思考正文浅灰区分——覆盖 MarkdownView 的 primary 色，思考/非思考一眼可辨（issue #57）
- fix(ui): dsh-think-zh-expand 思考块视觉回退官方基线——撤销 issue #54 卡片化翻新

## [0.4.5] - 2026-08-31

### 变更

- Merge branch 'issue-57-think-visual-rollback'
- fix(ui): dsh-think-zh-expand 思考正文浅灰区分——覆盖 MarkdownView 的 primary 色，思考/非思考一眼可辨（issue #57）
- fix(ui): dsh-think-zh-expand 思考块视觉回退官方基线——撤销 issue #54 卡片化翻新
- chore(release): dsh-think-zh-expand v0.4.4（自动 bump patch + CHANGELOG 生成）
- feat(ui): dsh-think-zh-expand 思考块视觉翻新——折叠图标/层级（issue #54）
- chore(deps): 升级 react 19 兼容性——13 个插件 peer 声明 ^18.2.0 || ^19.2.0（issue #49）
- style(format): 全仓 prettier 格式化（issue #44）
- feat(release): 发版流程强制跨插件依赖校验与真实环境验证（issue #39）

## [0.4.4] - 2026-08-28

### 变更

- feat(ui): dsh-think-zh-expand 思考块视觉翻新——折叠图标/层级（issue #54）
- chore(deps): 升级 react 19 兼容性——13 个插件 peer 声明 ^18.2.0 || ^19.2.0（issue #49）
- style(format): 全仓 prettier 格式化（issue #44）
- feat(release): 发版流程强制跨插件依赖校验与真实环境验证（issue #39）

## [0.4.3] - 2026-08-27

### 变更

- docs(think-zh-expand): README 移除 @max-null/dsh-chinese-thinking 提及（issue #33）
- refactor(md-render,think-zh-expand): 渲染职责迁移——MarkdownView 迁至 dsh-md-render（issue #31）
- docs+test: 全面审查修复——文档同步补全 + mermaid 测试增强

## [Unreleased]

### 变更

- **跨插件依赖声明修复（issue #39）**：`peerDependencies` 补声明 `"dsh-md-render": "^0.1.1"`（client 端 `require('dsh-md-render')` 的依赖包，此前仅 `dsh.client.external` 声明、npm 分发层面缺失导致用户环境加载崩溃）；发版流程（`scripts/release.mjs`）新增跨插件依赖强制校验（require 必须声明、依赖必须已发布且已打 tag）+ 真实环境验证强制（`verify-real-profile.mjs --addons`，失败阻断发版）。
- **渲染职责迁移（issue #31）**：MarkdownView 渲染逻辑（`lib/parts/markdown.part.js`）整体迁至 [dsh-md-render](../dsh-md-render/README.md)（统一 MarkdownView：表格 / 公式 / 代码块容器）；本插件只保留「思考内容默认展开 + 界面中文化」职责。assistant-step 渲染器经 `require('dsh-md-render')` 跨插件调用其 MarkdownView 组件（`package.json` 新增 `dsh.client.external: ["dsh-md-render"]` 声明，ModuleLoader 保证 dsh-md-render 先 materialize）；MarkdownView 渲染样式（`.tzx-md` 系列）随 dsh-md-render 注入，本插件样式表仅保留 assistant/思考块/已停止标记。
- **md-code-block 容器归属**：代码块容器 `div.md-code-block` 由 dsh-md-render 产出（结构保持），dsh-mermaid-render 无需改动。
- **测试**：`test/client-render.mjs` 与 Gherkin steps 改为双 bundle 加载（先 dsh-md-render 后本插件，模拟 ModuleLoader 跨 bundle require）；新增迁移断言（本插件 bundle 不含 `tryTable`/`MarkdownView` 函数定义、`require('dsh-md-render')` 调用存在）；`zh.feature` 新增「渲染职责由 dsh-md-render 提供」场景。

## [0.4.2] - 2026-08-25

### 变更

- **npm 页面元数据优化**：description 改为中英双语（中文在前）；README 效果截图引用改为绝对 URL（unpkg），npm 包页面可直接显示图片。

## [0.4.1] - 2026-08-25

### 变更

- **Client 端方案 B 拆分**：`client.src.js` 模板 + 5 个片段（`lib/parts/`）经 `scripts/build.mjs` 拼接生成 `client.js`；eslint 尺寸规则覆盖 src/parts 源码、构建产物排除。
- 行为不变（纯重构）。

## [0.4.0] - 2026-08-23

### 新增

- **工具中文化**：对话/轨迹里的工具卡片标题（`Search`/`Bash`/`Read`/`Write`/`Edit`/`Code`/`Inspect` 等官方硬编码英文，源码标注 "design literals, not translatable copy"）在卡片行内替换为中文；轨迹视图 Tool Catalog 的工具名与描述（`web_search` + 英文描述）按「工具名→中文」映射整体替换（描述按工具名索引，不匹配英文原文）；others 卡片摘要 `工具名 · …` 前缀同步替换。未覆盖工具保留英文。新增 `test/client-render.mjs` 用例 11 覆盖映射纯函数。

### 修复

- **client-render 测试零依赖化**：`test/client-render.mjs` 此前 require 本机绝对路径的 react（`/Users/bsfeng/.npm-global/...`），GitHub Actions ubuntu runner 上必然 `MODULE_NOT_FOUND` 崩溃，导致远程 CI 失败。现改为自写最小 `createElement` stub（children 语义与 React 一致），CI 与本机均可运行，测试随 `npm test` 在 CI 全量执行。

- **行内代码支持 CommonMark 多反引号配对**：思考/正文里模型引用的 `` `agent/status` `` 这类「双反引号包裹、内容含单个反引号」的文本此前被错误解析——分隔反引号裸露、`agent/status` 退化为裸文本、出现空白内容的 code 高亮块。现按 CommonMark 语义将 N 个反引号开闭配对整体渲染为 `<code>`（内容按规范裁去紧贴分隔符的空格），单反引号、无内容的连续反引号串（````）行为保持不变。新增 `test/client-render.mjs` 用例 7-10 覆盖。

## [0.3.0] - 2026-08-23

### 新增

- **思考块渲染 Markdown / Mermaid 图表**：思考（reasoning）内容此前为纯文本显示，思考里出现的 markdown（`\`\`mermaid`、表格、列表、标题等）会以原始语法文本显示。现让思考块复用正文的轻量 Markdown 渲染器——思考里的代码块 / 标题 / 列表 / 引用 / 表格均正常渲染，`mermaid` 代码块交给 [dsh-mermaid-render](../dsh-mermaid-render/README.md) 渲染成图表卡片。
- **README 效果图**：顶部新增真实现场效果图（思考块展开 + Markdown/Mermaid 渲染）。

## [0.2.1] - 2026-08-23

### 修复

- **文本块 Markdown 渲染补全表格支持**：轻量渲染器此前只支持代码块/标题/列表/引用/行内样式，表格（`| a | b |` + 分隔行）会被当作普通段落显示为纯文本。现支持标准 GFM 表格：表头 + 分隔行（含 `:---:` 居中 / `---:` 右对齐）+ 数据行，单元格内粗体/斜体/行内代码/链接正常渲染；无分隔行的管道行仍按段落回退。新增 `test/client-render.mjs` 渲染测试覆盖。

## [0.2.0] - 2026-08-23

### 新增

- **界面标签中文化（Client 端）**：官方 UI 的 zh 字典未翻译完且存在硬编码英文（轨迹视图的 Thinking / Tool Call / Tools / ASSISTANT / Duration / Turns 等，对话视图的 Tool call / System prompt / Messages 等），`locale.register` 无法覆盖已注册字典——通过 DOM 层精准文本替换补齐：完全匹配词表的叶子文本节点替换为中文，排除代码块 / 输入区避免误伤消息正文，MutationObserver 跟随 React 重渲染持续生效。

## [0.1.0] - 2026-08-23

### 新增

- **思考强制中文（Server 端）**：通过 `systemPrompt.section` 注入固定中文指令（`name: dsh-think-zh`、`order: -90`），思考与回复始终使用中文。
- **思考默认展开（Client 端）**：替换 `assistant-step` 节点渲染器——reasoning 块默认展开完整内容（可点击收起、流式中保持展开），文本块轻量 Markdown 渲染，图片复用内置渲染。
