# dsh-md-render

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <!-- 真实截图：非思考模式不标准表格渲染为表格（独立实例验证） -->
  <img alt="非思考模式 markdown 表格渲染增强（不标准表格渲染为表格）" src="./assets/md-table-render.png" width="480" />
  <br />
  <!-- 真实截图：公式结构渲染（issue #82，独立实例验证） -->
  <img alt="公式结构渲染：分数 / 根号 / 上下标 / 求和 / 块级公式" src="./assets/math-frac.png" width="480" />
  <br />
  <!-- 真实截图：设置页增强开关（issue #84，独立实例验证） -->
  <img alt="设置 → 插件 → 渲染：11 个增强功能开关（默认全开）" src="./assets/settings-tab.png" width="480" />
</div>

**DSH 对话统一 Markdown 渲染插件**（issue #31 渲染职责迁移）：提供统一 **MarkdownView** 组件（表格 / 公式 / 代码块容器），承接 dsh-think-zh-expand 迁出的渲染职责；并在 DOM 层做**表格渲染增强**——非思考模式下模型输出的 markdown 表格，包括**无首尾管道符、分隔行变体**等不标准格式，自动识别并渲染为**真正的表格**（表头 / 边框 / 对齐），宽表格支持**横向滚动**。

## 功能

- **统一 MarkdownView**（供 dsh-think-zh-expand 跨插件调用）：代码块 / 标题 / 列表 / 引用 / 表格（含对齐）/ **公式** / 粗体 / 斜体 / 行内代码 / 链接；代码块保持 `div.md-code-block` 容器结构（dsh-mermaid-render 无需改动即可扫描）。
- **公式渲染**（自实现零依赖）：行内 `$...$` 渲染为公式样式（货币 `$5` / 变量 `a$b` / 块级 `$$` 保护），块级 `$$...$$` 渲染为居中公式块。
- **公式结构渲染**（issue #82）：常见数学结构自动排版——**分数** `\frac{a}{b}`（上下结构 + 分数线）、**根号** `\sqrt{x}`、**上下标** `x^2` / `x_i`、**求和/积分** `\sum` / `\int`（带上下限）、**希腊字母** `\alpha` 等命令转符号；自实现轻量 LaTeX 子集解析器（零依赖，不引 KaTeX/MathJax），输出语义化嵌套结构（`dsh-md-render-frac` / `-sqrt` / `-supsub` / `-big`），样式走 DSH 语义 token、深浅主题自适应；**无法解析的公式保持原文**（不误伤、不报错）；受 `mathStructures` 配置开关门控（关闭时退回轻量渲染）。
- **公式错误提示**：公式内容异常（未闭合 `$`、空公式、内容以空白开头、块级未闭合/空）时渲染为错误标记（`span.dsh-md-render-math-error` / `div.dsh-md-render-math-error`），显示原文 + 错误样式（DSH 语义 token `--dsw-alias-state-error-primary`），不破坏整体布局；货币 `$5` / 变量 `a$b` / 块级 `$$` 保护不误报。
- **不标准表格也能渲染**：增强表格检测——表头/数据行只需含 `|` 且 ≥2 列（允许无首尾管道符），分隔行支持 `--- | ---`、`-|-|-`、`---` 等变体；模型输出的"半成品"表格不再以纯文本段落展示。
- **对齐标记**：`:---` 左对齐、`:---:` 居中、`---:` 右对齐，逐列生效。
- **宽表格横向滚动**：表格外层 `div.dsh-md-render-table-scroll` 容器 `overflow-x: auto`，宽表格不撑破消息气泡；容器下方带滚动提示条（chevron 图标 + 「横向滚动」）。
- **表头 / 边框样式**：表头底色 + 加粗、行分隔线、斑马纹与 hover 行反馈，样式走 DSH 语义 token（`--dsw-alias-*` / `--dsw-font-*`），深浅主题自适应。
- **兼容 dsh-think-zh-expand**：think-zh-expand 跨插件 require 本插件 MarkdownView（`dsh.client.external`）；识别其渲染器产出的 `div.tzx-md` 容器；已渲染的表格（`table.tzx-table`）不重复处理。
- **兼容内置 MarkdownText**：识别内置渲染器的 `div.md-table-wide` 宽表格容器，不干扰已渲染表格。
- **上下文注入块 markdown 渲染**（issue #196）：宿主 `ContextBody` 把上下文注入正文（**子 agent 回传消息** / AGENTS.md 等 workspace 指令 / 回忆注入）渲染为 `pre[data-context-text="true"]` **纯文本**（`white-space:pre-wrap`），其中的 markdown 全部以原文显示（`**粗体**`、`- 列表`、`| 表格 |`）。本插件在 DOM 层把这类块渲染为真正的 markdown（标题 / 粗体 / 行内代码 / 列表 / 引用 / 代码块 / 表格），复用 MarkdownView 的输出类名，样式与既有增强一致；原文 `pre` 置 `hidden` 保留（宿主仍持有节点，可随时回退）。
- **流式兼容**：MutationObserver 跟随消息流式渲染；流式中的容器（`[data-streaming]` 祖先）等内容稳定后再处理。
- **一键复制**（issue #74）：每个代码块（按钮默认右下角 hover 显示，可配置为头部与语言标签同排）+ 整段 markdown 内容右下角有复制按钮（hover 才显示，不遮挡内容），点击一键复制代码内容（不含语言标记）/ 整段纯文本（不含按钮文案）；复制成功按钮短暂显示「已复制」；流式渲染中不显示按钮，避免复制到半截内容。
- **代码块语法高亮**（issue #80）：常见语言（javascript/typescript/python/json/bash/markdown/yaml 等）的关键字/字符串/注释/数字/函数名着色（CSS 类 `dsh-md-render-tok-*` + 可配置主题色板，深浅主题自适应）；自实现轻量 tokenizer（零依赖）；未知语言（如 mermaid）回退纯文本；超长代码块（>500 行）跳过高亮防卡顿。
- **代码主题**（issue #146）：内置 5 套代码主题色板（token 色 + 代码块背景/边框色）——`bright`（默认，明亮高对比：柔和白底 + 深色 token，解决白底刺眼观感）/ `github-light` / `github-dark` / `one-dark` / `nord`；设置页下拉选择，保存即生效、重启不丢；深浅色自适应保留（暗色系统下每套主题有暗色变体）。
- **代码块语言标签**（issue #80）：从 `code.language-*` 类提取语言名，渲染在代码块头部（与复制按钮同排），别名归一（js→javascript、py→python、sh→bash）。
- **代码块行号**（issue #80，可配置开关）：代码块左侧显示行号（CSS counter 伪元素，不污染 code/pre 文本——mermaid/复制读取原代码不受影响）；默认开，可经设置页或 `config.lineNumbers: false` 关闭。
- **增强功能配置化**（issue #84 / #146）：全部增强功能独立配置开关（默认开启）+ 选择型配置（复制按钮位置 / 代码主题），设置页（设置 → 插件 → 渲染）可视化编辑（开关 + 下拉），保存即生效、重启不丢（写入 profile patch 文件），配置变更热生效（无需重启）。
- **零依赖**：表格检测与渲染全部自实现，无第三方库、无 CDN。

## 工作原理

- **统一 MarkdownView**（`lib/parts/markdown.part.js`）：从 dsh-think-zh-expand 迁移的轻量 Markdown 渲染管线（`mdInline` + 块级 `tryXxx`），输出结构保持迁移前约定（`div.tzx-md` / `p.tzx-p` / `table.tzx-table` / `div.md-code-block`）；新增行内/块级公式渲染；`exports.MarkdownView` 供 think-zh-expand 跨 bundle require。
- **复制按钮**（`lib/parts/copy.part.js` + `codeblock.part.js`，issue #74 / #146）：MarkdownView 在每个 `div.md-code-block`（默认右下角、`header` 位置为头部与语言标签同排）与 `div.tzx-md` 容器右下角渲染 `button.dsh-md-render-copy`；点击时从 DOM 取文本——代码块取 `code` 元素文本、内容块递归收集纯文本并跳过按钮文案；`navigator.clipboard.writeText` 优先、失败回退 `document.execCommand('copy')`（textarea 中转）；流式渲染中由 CSS（`[data-streaming] .dsh-md-render-copy{display:none}`）隐藏。
- **公式结构解析器**（`lib/parts/math.part.js` + `math-symbols.part.js` + `math-render.part.js`，issue #82）：轻量 LaTeX 子集自实现（tokenize `\命令` / `{组}` / `^` `_` + 递归下降）——`\frac{a}{b}` → `span.dsh-md-render-frac`（num/den 上下 + 分数线）、`\sqrt{x}` → `-sqrt`（√ + 顶部根号线）、`x^2` / `x_i` → `-supsub`（base + 上下标）、`\sum_{i=1}^{n}` / `\int_0^1` → `-big`（∑/∫ + 上下限）、`\alpha` 等命令 → Unicode 符号；**回退**：结构命令参数不完整（`\frac{a}{b`）→ 整个公式保持原文（不报错、不误伤），未知命令当文本保留；受 `mathStructures` 开关门控（#84），关闭时公式结构不渲染（退回轻量样式/原文）。
- **代码块增强**（`lib/parts/highlight.part.js` tokenizer + `codeblock.part.js` 渲染，issue #80 / #146）：tokenizer 为纯函数单遍扫描，按语言规则拆分 token 输出 `<span class="dsh-md-render-tok-*">`；`div.md-code-block` 内新增头部 `div.dsh-md-render-code-head`（语言名 + 复制按钮位），`code` 内按行输出 `div.dsh-md-render-code-line`（行号经 CSS counter `::before` 显示，不进入文本内容）；未知语言/超长代码块（>500 行）跳过高亮；行号开关 `config.lineNumbers` 经 `apply(ctx)` 读取，`setRenderOptions` 可编程切换。代码主题（issue #146）：高亮代码块携带 `data-theme` 属性选择 `styles.part.js` 内置色板（5 套主题 × 深浅变体），关闭高亮/未知语言/超长时无 `data-theme`（保持 DSH 默认样式）。
- **DOM 层表格增强**（`lib/parts/detect|render|scanner.part.js`）：扫描 `[data-conversation-scroll]` 内的 `div.tzx-md`（MarkdownView 输出）与 `div.md-table-wide`（内置 MarkdownText 的宽表格容器）容器；对容器内以纯文本段落（`p.tzx-p`）形式存在的表格文本，用增强检测规则解析（表头 + 分隔行 + 数据行 + 对齐），将段落替换为 `div.dsh-md-render-table-scroll > table.dsh-md-render-table`（thead/tbody/逐列对齐）；单元格内的 `**bold**` / `` `code` `` / `*em*` / `[link]` 行内格式重新渲染。
- **上下文注入块渲染**（`lib/parts/context-markdown.part.js`，issue #196）：扫描 `pre[data-context-text="true"]`（宿主 ContextBody 的稳定 data 契约，随会话内容变化由 MutationObserver 兜底重扫）；纯文本 → DOM markdown（`renderContextMarkdown`，块级顺序：围栏 / 标题 / 引用 / 列表 / 段落；段落命中 `parseTable` 时直接复用 `renderTable`，不标准表格同样渲染）。**与 React 共存的约束**：不修改 `pre` 的子结构（宿主 `<pre>{text}</pre>` 的文本 diff 会整体改写 textContent），只在 `pre` 之前插入渲染容器并置 `hidden`；容器带 `data-signature`（长度 + djb2 哈希），重扫时签名一致且容器在位则跳过（幂等），宿主重建节点冲掉容器后由兜底重扫重建；超过 200 000 字符的块跳过，避免单块渲染卡顿。
- **构建**（`scripts/build.mjs`）：把 `lib/parts/*.part.js` 片段拼接进 `lib/client.src.js` 模板，生成 `lib/client.js`（DSH 实际服务的单一 `__ModuleLoader__` bundle）。
- **Server 端**（`lib/index.js` + `lib/routes.js`）：提供应用层配置（issue #84 / #146）——`apply(ctx, config)` 读取全部增强开关（默认开启）+ 选择项（`copyButtonPosition` / `codeTheme`，`SELECT_KEYS` 校验合法枚举）；`GET/PUT /md/api/config` 配置读写（loopback 信任围栏），保存写入 profile patch 文件（复用 dsh-shared 配置持久化），DSH watchUserPatches 热重载。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-md-render --trust-lockfile`——无需克隆本仓库；以下 link 方式供本仓库开发者使用。

```sh
# 1) 克隆本仓库（任意目录）
git clone https://github.com/baosfeng/my-dsh-plugins.git
# 2) 以本地 link 方式安装（将 <仓库路径> 替换为上面的克隆目录）
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-md-render
```

装完后**重启 `dsh web`**（bundle 层在启动时组合），再硬刷新浏览器（Cmd/Ctrl+Shift+R）。

> 与 [dsh-think-zh-expand](../dsh-think-zh-expand/README.md) 配合：该插件替换消息渲染器后，text/reasoning 块走本插件的统一 MarkdownView（`tzx-md` 容器），本插件在其上做表格渲染增强；思考模式（reasoning 块）的表格渲染不受影响。**注意依赖方向**：think-zh-expand 依赖本插件（`dsh.client.external`），两个插件须同时启用。

## 使用

无需任何操作，插件激活即生效。模型输出表格（含不标准格式）时自动渲染：

```markdown
| 插件                | 版本  |
| ------------------- | ----- |
| dsh-file-activity   | 0.4.2 |
| dsh-think-zh-expand | 0.4.2 |
```

上面的表格（无首尾管道符）会自动渲染为带表头、边框、对齐的表格；列数 ≥4 的宽表格支持横向滚动。行内公式 `$x^2$` 渲染为上标结构，`$\frac{a}{b}$`、`$\sqrt{x}$`、`$\sum_{i=1}^{n} i$`、`$\alpha \beta$` 等常见数学结构自动排版；块级公式 `$$E=mc^2$$` 居中显示。

## 开发

```sh
# 修改 lib/client.src.js 或 lib/parts/ 后重新构建
npm run build

# 运行测试（表格检测单测 + MarkdownView 单测 + client 渲染路径 + Gherkin 验收）
npm test
```

> `lib/client.js` 是构建产物，**必须提交**（CI 只跑 `node --check` + 测试，不执行构建）。

## 宿主渲染缺口与插件侧接管（issue #196）

上下文注入正文由宿主 `@deepseek-ai/dsh-client-ui-chat` 的 `ContextBody` 渲染为纯文本（bundle 内实证：`<pre class="ZkiH0q_text" data-context-text="true">` + CSS `white-space:pre-wrap`）。**子 agent 回传消息走的就是这条路径**（`send_message` → agent-message 注入），所以子 agent 消息里的 markdown 从来不会渲染。

按项目决策「宿主渲染/能力缺口一律由本仓库插件侧接管处理，不依赖上游修改、不向上游提 issue」（见 [dsh-plugin-development 技能](../../skills/dsh-plugin-development/SKILL.md)），本插件在 DOM 层接管该渲染：先确证宿主契约 → 内容签名幂等标记 → 契约不匹配时静默退让原文 → MutationObserver 应对 React 重渲染 → 超长内容跳过。原文 `pre` 保留并置 hidden：这是**接管**而非补丁——上游若将来自行支持渲染，本接管可直接下线（但它不以上游修复为前提）。

## 已知限制

- 表格必须能从段落文本中识别（含 `|` 分隔且 ≥2 列 + 分隔行）；纯空格分隔的"表格"无法识别（不是标准 markdown 表格）。
- 单元格行内格式（`**bold**` 等）在段落被替换时重新渲染；若原段落已渲染过行内格式（标准表格场景），不重复处理。
- 公式结构渲染覆盖高频结构（分数/根号/上下标/求和积分/希腊字母/常见符号），非完整 LaTeX 排版（不引 KaTeX，零依赖约束）；**无法解析的公式（结构命令参数不完整）保持原文显示**（不误伤、不报错）；异常公式（未闭合 `$` / 空公式 / 内容以空白开头 / 块级未闭合或空）以错误标记显示原文，不静默吞掉。

## 配置

全部增强功能独立配置开关，**默认开启**（issue #84）。设置 → 插件 → 渲染 页签内可视化编辑，保存即生效、重启不丢；也可在 `cordis.patch.yml` 直接配置：

| 配置                 | 默认           | 说明                                                                                                       |
| -------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| `copyButton`         | `true`         | 复制按钮（issue #74，代码块/整段）                                                                         |
| `syntaxHighlight`    | `true`         | 代码块语法高亮（issue #80）                                                                                |
| `languageLabel`      | `true`         | 代码块语言标签（issue #80）                                                                                |
| `lineNumbers`        | `true`         | 代码块行号（issue #80）                                                                                    |
| `taskList`           | `true`         | 任务列表 checkbox（issue #81）                                                                             |
| `strikethrough`      | `true`         | 删除线（issue #81）                                                                                        |
| `image`              | `true`         | 图片渲染（issue #81）                                                                                      |
| `nestedList`         | `true`         | 嵌套列表（issue #81）                                                                                      |
| `mathStructures`     | `true`         | 公式结构（issue #82）                                                                                      |
| `tableSort`          | `true`         | 表头排序（issue #83）                                                                                      |
| `tableFold`          | `true`         | 长表格折叠（issue #83）                                                                                    |
| `copyButtonPosition` | `bottom-right` | 代码块复制按钮位置（issue #146）：`bottom-right` 右下角 / `header` 头部（与语言标签同排）                  |
| `codeTheme`          | `bright`       | 代码主题（issue #146）：`bright`（明亮高对比，默认）/ `github-light` / `github-dark` / `one-dark` / `nord` |

> 示例 patch：`lineNumbers: false` 关闭行号、`syntaxHighlight: false` 关闭语法高亮、`codeTheme: one-dark` 切换代码主题。开关需以布尔值提供、选择项需为枚举合法值，非法/缺省保持默认。设置页保存后无需重启（DSH watchUserPatches 热重载）；issue #80 的 `lineNumbers` 单开关写法保持兼容。

## 依赖

| 依赖                  | 用途                                                                                             | 可选           |
| --------------------- | ------------------------------------------------------------------------------------------------ | -------------- |
| `cordis`              | 插件运行时                                                                                       | 是（宿主提供） |
| `react`               | client 端 MarkdownView 组件                                                                      | —              |
| `dsh-shared`          | server 端配置持久化与 HTTP 工具（issue #84：patch 写入 / 围栏 / JSON 读写）                      | —              |
| `dsh-think-zh-expand` | 其 assistant-step 渲染器跨插件 require 本插件 MarkdownView（依赖方向：think-zh-expand → 本插件） | 是（可配合）   |

## 相关文档

→ [md 渲染模块文档](../../docs/md渲染/概述.md) · [需求清单](../../docs/md渲染/需求清单.md) · [CHANGELOG](CHANGELOG.md)
