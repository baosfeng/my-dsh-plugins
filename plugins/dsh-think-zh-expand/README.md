# dsh-think-zh-expand

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <img alt="思考块默认展开并渲染 Markdown 与 Mermaid 图表" src="https://unpkg.com/dsh-think-zh-expand/assets/think-markdown.png" width="340" />
</div>

**DSH 思考增强插件**：让 agent 的思考（reasoning）与回复强制使用中文，对话里的思考内容**默认展开显示**（替代内置的单行折叠），并把界面残留的硬编码英文（Thinking / Tool Call 等）**中文化**。

## 功能

### 1. 思考强制中文（Server 端）

通过 `systemPrompt.section` 注入一条固定系统提示（`order: -90`，persona 之前最先读到），内容为**结构化语言规则**（最高优先级，不可被上下文覆盖）：

> 强制要求：思考过程（reasoning）必须用简体中文书写；最终回复默认简体中文（跟随用户语言）。
> 关键场景：英文错误消息/日志/堆栈不改变语言；大量英文上下文不"带偏"输出。
> 代码与术语：代码、命令、文件路径、标识符与技术术语保持原文，不翻译。

无论用户用什么语言提问，模型的思考过程与回答都使用中文。

### 2. 思考默认展开（Client 端）

内置的思考块（`ReasoningRow`）默认折叠成单行摘要，只显示第一行；本插件替换 `conversation.chat.node` 的 `assistant-step` 渲染器：

- **思考块默认展开**：完整思考内容直接显示，点击标题行可收起（流式生成中强制保持展开）；思考内容**同样走统一 Markdown 渲染**（代码块 / 标题 / 列表 / 引用 / 表格 / 公式 / **Mermaid 图表**），思考里出现的 markdown 语法不再以原始文本显示，mermaid 代码块会渲染成图表卡片；
- **文本块统一 Markdown 渲染**：优先由 [dsh-md-render](../dsh-md-render/README.md) 提供（issue #31 渲染职责迁移：本插件不再包含渲染逻辑，经 `dsh.client.external` 跨插件 require 其 MarkdownView 组件）——代码块 / 标题 / 列表 / 引用 / **表格**（含对齐）/ **公式** / 粗体 / 行内代码 / 链接；
- **图片块**复用内置 `renderMessageImages` 渲染；
- **tool-call 块**与内置行为一致（由独立节点渲染）。

> ℹ️ **渲染三级回退（issue #293）**：本插件 client 端**不再硬依赖** `dsh-md-render`，按以下顺序解析渲染组件：
>
> 1. **`dsh-md-render`（推荐同时安装）**：用它提供的 `MarkdownView`，行为与 0.4.9 完全一致（增强表格容错 / 宽表滚动 / 代码高亮），`.tzx-md` 系列样式随它注入；
> 2. **宿主官方组件**：未装 `dsh-md-render` 时自动用宿主 staticModules 提供的 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`（官方 GFM + KaTeX 渲染，零安装、零体积、无需 external 声明）——**开箱即可正常渲染**（缺的只是 md-render 的表格容错与代码高亮增强）；
> 3. **纯文本兜底**：极旧/裁剪宿主连官方组件表都没有时，回退 `<pre data-dsh-think-zh-expand-fallback="true">`，渲染期仍不抛错。
>
> 0.4.9 及更早版本只把 `require('dsh-md-render')` 包了 try/catch（`MarkdownView = null`）却仍裸调 `createElement(MarkdownView, …)`，渲染期会抛 `Element type is invalid … but got: null`——是**假降级**（见 [踩坑：假降级](../../docs/踩坑/假降级-只catch-require不等于优雅降级.md)）。

### 3. 界面标签中文化（Client 端）

官方 UI 的 zh 字典未翻译完、且存在硬编码英文（轨迹视图的 `Thinking` / `Tool Call` / `Tools` / `Duration` / `Turns` / `ASSISTANT` 等，对话视图的 `Tool call` / `System prompt` / `Messages` 等）。由于 `locale.register` 对已注册的同 ns+locale 字典重复注册会抛错，无法经 locale 服务补译，本插件在 DOM 层做**精准文本替换**：

- 只替换「完全等于」词表的叶子文本节点（`Thinking`→`思考`、`Tool Call`→`工具调用`、`Duration`→`用时`、`Turn 5`→`第 5 轮` 等）；
- 排除代码块 / 输入区 / 脚本区，**不会误伤消息正文与代码内容**；
- MutationObserver 跟随 React 重渲染持续生效，插件卸载即断开。

**工具卡片与工具目录中文化**（官方 `VARIANT_TITLES` 注释为 "design literals, not translatable copy"，无 i18n 路径）：

- 工具调用卡片标题（`Search`→`搜索`、`Bash`→`命令行`、`Read`→`读取`、`Write`→`写入`、`Edit`→`编辑`、`Code`→`代码`，以及 cordis 的 `Inspect`→`检查`、`Run Cordis Plugin`→`运行 Cordis 插件` 等）**只在工具卡片行内**（祖先含 `data-chat-call-id`）替换；
- 轨迹视图 Tool Catalog 的工具名与描述按「工具名 → 中文」映射整体替换（`web_search`→`网络搜索`、`bash`→`命令行` 等，描述按工具名索引、不匹配英文原文，DSH 升级改文案不失效）；
- others 卡片摘要 `工具名 · …` 的前缀工具名同步替换（`ask_user_question · …`→`询问用户 · …`）；未覆盖的工具保留英文。

样式全部走 DSH 语义 token（`--dsw-alias-*` / `--dsw-font-*`），随激活注入、随 fiber 卸载，HMR/禁用无残留。

## 工作原理

- **Server 端**（`lib/index.js`）：`inject: ['systemPrompt']`，`apply` 里调用 `ctx.systemPrompt.section({ name: 'dsh-think-zh', order: -90, text })`。section 名 `dsh-think-zh`（order -90）。
- **Client 端**（`lib/client.js`）：`inject: ['slots']`，三个职责——① `ctx.slots.inject('conversation.chat.node', ...)` + `ctx.slots.register({ key: 'assistant-step', priority: -1, registrant: 'dsh-think-zh-expand' }, ...)` 以更低优先级覆盖内置渲染器（与 dsh-better-sidebar 覆盖内置席位的方式一致）；② `systemPrompt` 与渲染器之外，`ctx.effect` 注入样式表（随 fiber 卸载）；③ `ctx.effect` 安装界面中文化（MutationObserver 文本节点精准替换，随 fiber 卸载断开）。渲染组件经 factory 顶层三级解析得到并绑定为 `MarkdownView`：`require('dsh-md-render')`（`dsh.client.external: ["dsh-md-render"]` 声明，装了就用）→ `require('@deepseek-ai/dsh-client-ui-primitives').MarkdownText`（宿主静态模块表，官方兜底）→ `<pre data-dsh-think-zh-expand-fallback="true">`（纯文本）。任一级 require 抛错或导出畸形都安全落到下一级，渲染期永不抛错。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-think-zh-expand dsh-md-render --trust-lockfile`——无需克隆本仓库；`dsh-md-render` 可选（不装则自动用官方组件渲染，见上文三级回退），但推荐连装以获得增强表格渲染。以下 link 方式供本仓库开发者使用。

```bash
# 1) 克隆本仓库（任意目录）
git clone https://github.com/baosfeng/my-dsh-plugins.git
# 2) 以本地 link 方式安装（将 <仓库路径> 替换为上面的克隆目录）
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-think-zh-expand
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-md-render
```

- server 端改动需重启 `dsh web`；
- client 端改动浏览器硬刷新（Cmd/Ctrl+Shift+R）即可。

## 配置

无配置项。插件激活即生效。

## 依赖

| 依赖                                    | 用途                                                                          | 可选                                            |
| --------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| `@deepseek-ai/dsh-system-prompt`        | host 端 systemPrompt 服务                                                     | 是（缺省时 server 端不注入）                    |
| `react`                                 | client 端组件                                                                 | —                                               |
| `dsh-md-render`                         | client 端统一 MarkdownView（跨插件 require，`dsh.client.external`，**首选**） | 是（缺失时回退官方 `MarkdownText`，渲染仍可用） |
| `@deepseek-ai/dsh-client-ui-primitives` | 兜底渲染组件 `MarkdownText`（宿主 staticModules 提供，无需安装/声明）         | 是（缺失时回退 `<pre>` 纯文本）                 |

## 相关文档

→ [思考增强模块文档](../../docs/思考增强/概述.md) · [需求清单](../../docs/思考增强/需求清单.md) · [CHANGELOG](CHANGELOG.md)
