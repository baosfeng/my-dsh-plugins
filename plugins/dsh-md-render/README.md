# dsh-md-render

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <img alt="非思考模式 markdown 表格渲染增强（不标准表格渲染为表格）" src="./assets/md-table-render.png" width="480" />
  <br />
  <img alt="公式结构渲染：分数 / 根号 / 上下标 / 求和 / 块级公式" src="./assets/math-frac.png" width="480" />
  <br />
  <img alt="设置 → 插件 → 渲染：增强功能开关" src="./assets/settings-tab.png" width="480" />
</div>

**DSH 对话统一 Markdown 渲染插件**：提供跨插件复用的统一 **MarkdownView** 组件，并在 DOM 层做**表格渲染增强**——非思考模式下模型输出的不标准 markdown 表格（无首尾管道符、分隔行变体）自动识别并渲染为真正的表格；另含公式结构、代码块高亮与一键复制等增强，全部自实现、零依赖。

## 功能

- **统一 MarkdownView**：标题 / 列表 / 引用 / 表格（含对齐）/ 代码块 / 行内与块级公式 / 行内格式；代码块保持 `div.md-code-block` 容器结构，dsh-mermaid-render 无需改动即可扫描。
- **表格增强**：表头与数据行只需含 `|` 且 ≥2 列即可识别（分隔行支持 `--- | ---`、`-|-|-`、`---` 变体），`:---` / `:---:` / `---:` 对齐逐列生效；宽表格自动横向滚动。
- **公式**：行内 `$…$` 与块级 `$$…$$`；常见结构（分数 / 根号 / 上下标 / 求和积分 / 希腊字母）自实现轻量排版，不引 KaTeX / MathJax；**无法解析的公式保持原文**，货币 `$5`、变量 `a$b` 不被误伤，异常公式以错误标记显示原文。
- **代码块**：语法高亮（未知语言与超长代码块回退纯文本）、语言标签（js→javascript 等别名归一）、行号、5 套代码主题。
- **一键复制**：代码块与整段 markdown 各带复制按钮（hover 显示，位置可配，流式渲染中不显示）。
- **上下文注入块渲染**：宿主以纯文本 `pre[data-context-text="true"]` 呈现的上下文注入正文（**子 agent 回传消息**、AGENTS.md 等）在 DOM 层渲染为 markdown；原文节点保留并置 `hidden`。
- **增强可配置**：全部增强独立开关、默认开启，可在设置 → 插件 → 渲染 页签可视化编辑，保存即生效、重启不丢。

## 配置

写入 `cordis.patch.yml` 对应插件行的 `config`（设置页保存后同样落盘到 profile patch 文件）：

| 配置键               | 默认           | 作用                                                                                   |
| -------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `copyButton`         | `true`         | 复制按钮（代码块 / 整段）                                                              |
| `syntaxHighlight`    | `true`         | 代码块语法高亮                                                                         |
| `languageLabel`      | `true`         | 代码块语言标签                                                                         |
| `lineNumbers`        | `true`         | 代码块行号（CSS counter，不污染代码文本）                                              |
| `taskList`           | `true`         | 任务列表 checkbox                                                                      |
| `strikethrough`      | `true`         | 删除线                                                                                 |
| `image`              | `true`         | 图片渲染                                                                               |
| `nestedList`         | `true`         | 嵌套列表                                                                               |
| `mathStructures`     | `true`         | 公式结构排版（关闭退回轻量样式 / 原文）                                                |
| `tableSort`          | `true`         | 表头排序                                                                               |
| `tableFold`          | `true`         | 长表格折叠                                                                             |
| `copyButtonPosition` | `bottom-right` | 复制按钮位置：`bottom-right` 右下角 / `header` 头部同排                                |
| `codeTheme`          | `bright`       | 代码主题：`bright`（明亮高对比）/ `github-light` / `github-dark` / `one-dark` / `nord` |

> 开关须为布尔值、选择项须为枚举合法值，非法 / 缺省保持默认；配置变更热生效，无需重启。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-md-render --trust-lockfile`——无需克隆本仓库；以下 link 方式供本仓库开发者使用。

```bash
# 1) 克隆本仓库（任意目录）
git clone https://github.com/baosfeng/my-dsh-plugins.git
# 2) 以本地 link 方式安装（将 <仓库路径> 替换为上面的克隆目录）
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-md-render
```

装完后**重启 `dsh web`**（bundle 层在启动时组合），再硬刷新浏览器。

> 与 [dsh-think-zh-expand](../dsh-think-zh-expand/README.md) 配合：该插件替换消息渲染器后，text / reasoning 块走本插件的 MarkdownView（`tzx-md` 容器）。**依赖方向**：think-zh-expand 依赖本插件（`dsh.client.external`），两者须同时启用。

## 公共 API 契约（semver 承诺）

对外唯一承诺的 API 是 **`MarkdownView`**：`require('dsh-md-render').MarkdownView` 存在且为 React 函数组件，props 为 `{ text: string }`（额外 props 被忽略，非字符串降级为文本）；bundle id 为 `dsh-md-render`。移除 / 改名 / 必需 props 变更 = major。

**输出类名清单**（跨插件可见的 DOM 契约，类名或层级变更 = major）：

| 类名                                                                           | 含义                                                     |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `tzx-md`                                                                       | 渲染根容器                                               |
| `tzx-p`                                                                        | 段落                                                     |
| `tzx-table`                                                                    | 表格（`thead` / `tbody` 子结构）                         |
| `md-code-block`                                                                | 代码块容器（`dsh-mermaid-render` 靠它扫描 mermaid 围栏） |
| `tzx-pre`                                                                      | 代码块 pre                                               |
| `dsh-md-render-code-head` / `dsh-md-render-code-lang`                          | 代码块头部与语言标签                                     |
| `dsh-md-render-math` / `dsh-md-render-math-block` / `dsh-md-render-math-error` | 行内公式 / 块级公式 / 公式错误标记                       |
| `dsh-md-render-copy`                                                           | 复制按钮                                                 |

其余 exports（`parseTable` / `renderTable` / `setRenderOptions` / `applyContextMarkdown` 等）属内部实现面，随重构变动，下游不得依赖。契约由 `test/markdown-view-contract.mjs` 钉住；改契约需同步本 README 与 `CHANGELOG.md`。

## 已知限制

- 表格必须能从段落文本中识别：需含 `|` 且 ≥2 列 + 分隔行；纯空格分隔的「表格」无法识别。
- 公式结构覆盖高频结构，非完整 LaTeX 排版（零依赖约束）；无法解析的公式与异常公式（未闭合 `$`、空公式等）保持原文或标错误，不静默吞掉。
- 宿主自行渲染、不经过本插件管线的 markdown（如轨迹视图）不在增强范围内。

## 相关文档

→ [md 渲染模块文档](../../docs/md渲染/概述.md) · [CHANGELOG](CHANGELOG.md)
