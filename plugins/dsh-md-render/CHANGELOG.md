# Changelog

本文件记录 dsh-md-render 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 公共 API 承诺面：`MarkdownView`（导出 / props / 自有 DOM 类名清单见 [README「公共 API 契约」](README.md)）；改类名清单 = 破坏性变更，须同步 README 与本文件。

## [0.4.0]

**合并原 `dsh-think-zh-expand` 与 `dsh-mermaid-render`，两个旧包自本版本起下线**（仓库移除，npm 标记 deprecated，不 unpublish）。

### 新增

- **mermaid 图表卡片**：`mermaid` / `mmd` 围栏块渲染为卡片（预览 / 代码切换、导出 PNG / SVG），失败回显错误原因 + 重试 + 原始源码；引擎 `assets/mermaid-10.9.3.min.js`（3.34 MB）由 host 半静态托管于 `/md-render/assets`、client 按需 fetch，**不内联进 bundle**（#185 的 4.48 MB base64 冗余教训）。
- **思考块默认展开**：对官方折叠行派发一次真实 click（外观 / 结构 / a11y 全走官方），`WeakSet` 一次性动作、尊重用户手动折叠。
- **mermaid 能力说明**注入为独立 system-prompt section（name `dsh-mermaid-render` / order `100`，与旧包同名同序，宿主按 name 去重）；开关 `mermaid.injectPrompt`。
- 新增开关 `mermaid.render` 与命名空间配置 `markdown.*` / `thinking.*` / `mermaid.*`；设置页由 3 个 tab 合并为 1 个「渲染」tab 三分组。
- 设置页同时注册 `plugins.bundle.config`（对齐宿主官方契约），使配置页在「插件」面板的组合包详情页也可达；原 `settings.plugins.tab` 入口保留不变。

### 变更

- 单一 `MutationObserver` 按语言分流（思考行 → 上下文块 → text 围栏 → mermaid），合并前两个插件各装一个观察器。
- 路由收口：`/md-render/api/config`（GET/PUT）+ `/md-render/assets/*`（GET/HEAD，ETag / 304 / 405），路径来自单一真源 `src/routes/paths.ts`，构建期注入 client 产物。
- 配置持久化先合并 patch 行内已有键再写入（合并前会把用户手写的 config 键一并抹掉）。

### 破坏性变更

- `dsh-think-zh-expand` / `dsh-mermaid-render` 包不再可用：profile roster 里的 `- id: think-zh-expand` / `- id: mermaid-render` 行**必须删除**，否则 loader 指向不存在的包。
- 旧路由一律 404：`/md/api/config` → `/md-render/api/config`；`/think-zh-expand/api/*`、`/mermaid-render/api/*`、`/mermaid-render/assets/*` 消失。
- 配置结构由扁平键改为命名空间；**读取兼容旧扁平键**（`copyButton` / `textFenceMarkdown` / `contextMarkdown` / `defaultExpanded` / `injectPrompt`），写入一律新结构。
- 设置页 3 个 tab → 1 个「渲染」tab。

### 移除

- 自绘助手节点 / 自绘思考块（`AssistantStepView` / `ThinkBlock` / `stripControlTags`）：**不注册任何 `conversation.chat.node` 节点级 seat**，思考内容 markdown 由官方 `ReasoningRow` 提供。
- 中文思考指令 section（原 `dsh-think-zh`）不迁入 —— 由 dsh-my-memory 的「全局提示词」提供。

## [0.3.1]

### 修复

- react / react-dom peer 范围过窄 `^18.2.0 || ^19.3.0` → `^18.2.0 || ^19.2.0`（宿主实际提供 19.2.8，原范围不满足导致 guardian 报 dependency-mismatch）。

## [0.3.0]

### 移除（与官方重复的实现，官方 0.1.7-rc.2 起内置）

- 自实现 GFM 表格渲染、公式排版（KaTeX）、代码块增强（shiki 高亮 / 语言标签 / 行号 / 复制）、轨迹视图 markdown 接管与 DOM 表格扫描；
- 旧配置开关 `syntaxHighlight` / `languageLabel` / `lineNumbers` / `taskList` / `strikethrough` / `image` / `nestedList` / `mathStructures` / `tableSort` / `tableFold` / `copyButtonPosition` / `codeTheme`（patch 文件里的旧键保留无害、被忽略）。

### 变更

- 全部渲染交给官方 `MarkdownText`：两个注入点（text 围栏块、`pre[data-context-text]`）经 `react-dom/client` 把官方组件挂到自有容器里；`MarkdownView` 变为官方渲染 + 表格容错 + 整段复制；官方组件不可用时真降级（`<pre>` 兜底 / 注入点不动宿主 DOM）。
- 表格容错保留为纯文本规范化（`table-normalize.ts`）：只处理官方 GFM 不认的两种分隔行写法。
- 客户端产物 165 KB → 43 KB。
