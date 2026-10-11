# Changelog

本文件记录 dsh-md-render 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 公共 API 承诺面：`MarkdownView`（导出 / props / 自有 DOM 类名清单见 [README「公共 API 契约」](README.md)）；改类名清单 = 破坏性变更，须同步 README 与本文件。

## [Unreleased]

### 新增

- **确证无语言的围栏块按 markdown 兜底**（#470 需求 3）：模型常把**实际是 markdown** 的内容用**无标记**围栏包起来（`**加粗**` 这类），官方 CodeBlock 按等宽代码块原样显示就丢了排版。语言判定新增 `confirmed` 语义，区分「**确证无语言**」（走兜底渲染）与「**识别失败**」（保持官方默认，绝不猜）——只放宽前者，**不是**内容启发式判定。`text` 家族同时补上 `md` / `markdown` 标记；兜底块同样带「查看原文」一键切回。
- **围栏语言手动切换**（#470 需求 4）：块内「图表 / Markdown / 源码」三态控件（hover / 键盘 focus / 触屏 `@media (hover:none)` 三路可达，只做 hover 手机点不到）。优先级 **手动覆盖 > 语言索引 > DOM 契约**，用于模型把 Java 写成 ```js 这类误判——属用户**显式意图**，与「自动判定绝不猜语言」不冲突。覆盖值按内容哈希记入 `sessionStorage`（刷新后仍记得），有界（100 条）。
- **图表浮窗 + 缩放 / 平移**（#470 需求 1）：卡片可开**页面内 `<dialog>` 模态浮窗**（90vw × 85vh + 遮罩；Esc / 关闭按钮 / 点遮罩三路退出；搬的是**宿主节点**而非卡片本身，关闭时原位归还，宿主重渲染后仍有兜底）——实测 `document.fullscreenElement === null`，**不是**浏览器 Fullscreen API（真机反馈「要的是浮窗式最大化」，原生全屏降为面板内二级按钮）。缩放 / 平移由 vendored `@panzoom/panzoom@4.6.2` 提供，走 `assets/` 懒加载（对 `lib/client.js` 增量 **0**，不挤占体积门禁）：工具条（全屏 / 适应宽度 / 实际大小 / 缩小 / 放大）、**Ctrl+滚轮捏合**（macOS 触控板派发的正是 `wheel + ctrlKey`）、键盘 `+ - 0` 与方向键、双击复位；非浮窗态**裸滚轮不拦截**（避免滚动陷阱），仅 ctrlKey 或浮窗态接管。

### 修复

- **mermaid 失败态以源码为主**（#470 需求 2）：渲染失败时**首屏直接展示原始源码**（可复制），错误原因降为一行灰字、保留「重试」，并把视图钉在源码——此前首屏是错误提示，用户要的是内容而不是报错。
- **缩放工具条「看得见、点不到」**（真机反馈「点放大还是没反应」）：宿主消息区底部被输入框浮层覆盖（实测浮层占 `y=449~577`，而卡片高 408 + 浮层 128 > 可视区 501），而工具条排在卡片**最底部** —— hit-test 实测 5 个按钮的中心点**全部**命中 composer 而非按钮自身，是典型的幽灵按钮。修法：把缩放工具条移到**图表上方**（卡片头部之下），彻底离开浮层区域。修复后同一 hit-test 5 个按钮全部 `SELF-OK`，**真实鼠标点击**（非程序化 `click()`）实测 scale `1 → 1.25 → 1.563 → 1.953`。
- **图表放大时图跑出可视区**（真机反馈「点放大没反应」）：mermaid 的 `<svg>` 自带 `max-width` = 图表自然宽度，在变换层里**左对齐**，而 panzoom 以**变换层几何中心**为缩放锚点 —— 两者中心实测相差 **277px**，放大近 2 倍后图被推到容器外侧（卡片看着一片空白，像是没反应）。修法：变换层改 flex 居中，使锚点与图中心重合（实测中心偏移 277px → **0.5px**）；已加防回归断言。
- **接管块残留官方 banner 头**：官方 banner 的标签被宿主写死为本地化「代码块」（语言名不进 DOM），对已 markdown 化的块是**错误信息**且白占 42px。现将 banner 容器与内容容器**一并隐藏**（规则限定在接管视图值上，切回「查看原文」时不再匹配、官方 banner 自动恢复）；未接管的块不受影响（实测 `js` / `json` / `bash` 与工具输出块 banner 仍为 42px）。
- **围栏语言识别在「历史会话 + 冷启动」下失效**（真实浏览器实测 `toggles=0` / `views=0`）：官方 `CodeBlock` 只在 shiki **认识**该语言时才把语言原名写进 banner（其余一律显示本地化标签「代码块」），且**非空**代码块的 `<code>` 不带 `language-*` —— `text` / `plaintext` / `txt` / `mermaid` / `mmd` 与「无语言」块在 DOM 里逐字段完全相同，纯 DOM 读法 100% 静默失败。
  - **语言判定主源改为 client 侧会话事件流索引**（新增 `src/client/parts/lang-source.ts`）：从 `ctx.sessions.binding(id).eventSource` 的原始 Session 事件（`assistant/message.data.message.content[]` / `user/message.data.content[]`，含 `reasoning`，只取 `surfaceOp === 'append'`）解析围栏块，建「hash(规范化代码) → 语言」表；DOM 侧按 `<pre>.textContent` 算同一哈希查表。该窗口**天然含历史**，因此**冷启动 / 重启后打开历史会话也能命中**（host 实时索引为空时的唯一来源），命中即 **零 RPC**；host 半只订阅 `session/event`、不读历史，故此前该场景永不命中。
  - **兜底保留两级**（原行为完整保留）：host 半实时索引（`GET /md-render/api/langs` 批量查询）与 DOM 契约读法（`code.language-*` → banner infostring，空围栏分支仍有效）。三者都拿不到 → 不接管（绝不猜语言、绝不误伤「无语言」块）。
  - 映射口径：同哈希多候选按 **DOM 文档序 FIFO**；候选互不相同且 DOM 内同哈希块数与候选数不符 → **整块放弃**（静默退回官方形态）。
  - 增量维护：只在事件源 `revision` 变化时吸收**新事件**（流式期间窗口每批重发，全量重扫会把 CPU 拖垮）；会话切换整表重置；全程 `try/catch`，任何异常 → 空表 → 全链路退回现状。
  - **零新增硬依赖**：用 `ctx.get('sessions', false)` 惰性取（cordis 4 的 `ReflectService.get` 契约即「without the inject requirement」，与设置页取 `slots` 同款写法），`exports.inject` 保持 `[]`；实测 `inject: ['sessions']` 在服务缺失时会让 `apply` 根本不执行（整个 client 半失效），`inject: { optional: [...] }` 在 cordis 4.0.4 不被支持。

## [0.4.0]

**合并原 `dsh-think-zh-expand` 与 `dsh-mermaid-render`，两个旧包自本版本起下线**（仓库移除，npm 标记 deprecated，不 unpublish）。

### 新增

- **mermaid 图表卡片**：`mermaid` / `mmd` 围栏块渲染为卡片（预览 / 代码切换、导出 PNG / SVG），失败回显错误原因 + 重试 + 原始源码；引擎 `assets/mermaid-10.9.3.min.js`（3.34 MB）由 host 半静态托管于 `/md-render/assets`、client 按需 fetch，**不内联进 bundle**（#185 的 4.48 MB base64 冗余教训）。
- **思考块默认展开**：对官方折叠行派发一次真实 click（外观 / 结构 / a11y 全走官方），`WeakSet` 一次性动作、尊重用户手动折叠。
- **mermaid 能力说明**注入为独立 system-prompt section（name `dsh-mermaid-render` / order `100`，与旧包同名同序，宿主按 name 去重）；开关 `mermaid.injectPrompt`。
- 新增开关 `mermaid.render` 与命名空间配置 `markdown.*` / `thinking.*` / `mermaid.*`；设置页由 3 个 tab 合并为 1 个「渲染」tab 三分组。
- 设置页同时注册 `plugins.bundle.config`（对齐宿主官方契约），使配置页在「插件」面板的组合包详情页也可达；原 `settings.plugins.tab` 入口保留不变。

### 修复

- **围栏语言识别在真实宿主（0.2.0-rc.2）100% 失效**（issue #466）：官方 `CodeBlock` 的 banner 只在 shiki **认识**该语言时才写语言原名（`isKnownLanguage(lang) ? lang : labels.codeLabel`），**非空**代码块的 `<code>` 也不带 `language-*` —— `text` / `plaintext` / `txt` / `mermaid` / `mmd` 块与「无语言」块在 DOM 里逐字段完全相同（实测 14 个块 HTML 一致、接管数 toggles=0 / views=0）。现改为**两级语言来源**：DOM 契约优先（`js` / `json` / `bash` 等**零额外请求**），DOM 只给本地化标签「代码块」时回落到 host 半的围栏语言索引。
- 新增 host 半**围栏语言索引**：订阅 `session/event`（`user/message` / `assistant/message`，含 `reasoning`）解析消息 markdown 原文，按「围栏块内容哈希 → 语言」建**有界**索引（2000 条 FIFO、只登记本插件接管的 5 种语言、**零磁盘 IO**）；client 半按块内容哈希经 `GET /md-render/api/langs?h=…` **批量**查询（同一次扫描合成一次请求、结果有缓存、未命中最多重试 2 次、失败静默降级）。查表只在块稳定后（`[data-streaming]` 门控 + 400ms 稳定窗口）发生；查不到即保持官方默认，**绝不误伤「无语言」块**。
- `langs` 查询与 `config` 共用 `/md-render/api` 前缀与同一 loopback 信任围栏（不新增第三条路由前缀）。

### 变更

- 单一 `MutationObserver` 按语言分流（思考行 → 上下文块 → text 围栏 → mermaid），合并前两个插件各装一个观察器。
- 路由收口：`/md-render/api/config`（GET/PUT）+ `/md-render/assets/*`（GET/HEAD，ETag / 304 / 405），路径来自单一真源 `src/routes/paths.ts`，构建期注入 client 产物。
- 配置持久化先合并 patch 行内已有键再写入（合并前会把用户手写的 config 键一并抹掉）。

### 破坏性变更

- `dsh-think-zh-expand` / `dsh-mermaid-render` 包不再可用：profile roster 里的 `- id: think-zh-expand` / `- id: mermaid-render` 行**必须删除**，否则 loader 指向不存在的包（宿主仅告警跳过，不阻断启动）。
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
