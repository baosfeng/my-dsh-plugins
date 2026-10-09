# 发版前人工自测清单 — dsh-md-render@0.4.0

- 验证环境：DSH_HOME=/tmp/dsh-verify-real-3099 / 端口 3099 / 浏览器 ______ / 实例版本 ______
- 待验插件处于启用态：是 / 否（带禁用位时插件被加载但不运行 → 页签不出现、API 404；先查两处禁用位：`<profile>/.dsh-market/state.json`、`cordis.patch.yml` 的 `disabled: true`）
- 起隔离实例的完整命令见 `skills/verifying-dsh-plugins/references/isolation-instance.md`（本文只写「看到什么算过」）
- 前置：profile 的 roster 已删除 `- id: think-zh-expand`、`- id: mermaid-render` 两行；浏览器开 DevTools（Console + Network + Elements）

## 一、markdown 内容渲染

- [ ] **表格容错 ①（缺管道符分隔行）**：发一条含 `a | b` 换行 `---` 的消息 → 渲染为**两列表格**（不是 setext 标题）
- [ ] **表格容错 ②（分隔行单元格数不等）**：`| a | b |` / `| --- |` → 渲染为表格，缺的单元格留空
- [ ] **GFM 原生表格不动**：标准写法 `| a | b |` + `| --- | --- |` 的外观与插件禁用时**逐像素一致**（对齐、斑马纹、宽度不变）
- [ ] **text 围栏块 markdown 化**：发 ```text 围栏块（内含标题 / 列表 / 加粗 / 链接）→ 按 markdown 渲染，不是灰底纯文本
- [ ] **text / plaintext / txt 三种标记同效**：换成 ```plaintext 与 ```txt 标记 → 行为同上
- [ ] **每块独立「查看原文」**：同一消息里放两个 text 围栏块 → 点第 1 块的「查看原文」只翻第 1 块（按钮变「查看渲染」），第 2 块保持渲染态
- [ ] **非 text 标记不变**：```js / ```json / ```bash 与**无标记**围栏块 → 仍是官方代码块（高亮 / 语言标签 / 行号），没有「查看原文」按钮
- [ ] **上下文注入块渲染**：触发一条上下文注入正文（子 agent 回传消息最直接）→ 该 `pre[data-context-text]` 内 markdown 被渲染；DevTools Elements 里原文节点**仍存在且 `hidden`**（不是被删除）
- [ ] **整段复制按钮**：`MarkdownView` 容器右上出现 `.dsh-md-render-copy` → 点击后粘贴到编辑器，内容**不含**代码块 banner 文案与按钮文案，变 `.dsh-md-render-copy-done` 后自动复原
- [ ] **流式中不显示复制按钮**：消息流式输出期间容器带 `[data-streaming]` → 复制按钮 `display:none`；流结束后出现

## 二、mermaid 图表

- [ ] **代码块 → 图表卡片**：发 ```mermaid 与 ```mmd 各一个围栏块 → 均渲染为图表卡片（不是代码块），SVG 正确
- [ ] **预览 / 代码切换**：点卡片头「代码」→ 显示源码；点「预览」→ 回到图；`data-dsh-md-render-mermaid-view` 随切换变化
- [ ] **引擎走 asset 而非内联**：Network 面板出现 `GET /md-render/assets/mermaid-10.9.3.min.js` → **200**（二次加载 304 亦可）；client bundle 体积**无** 3 MB 级增长
- [ ] **引擎加载失败降级**：DevTools Network 里把 `/md-render/assets/*` 设为 **Block request URL** 后刷新页面再发 mermaid 块 → 卡片显示失败原因 + 重试按钮 + **原始源码**（绝不空白 / 不静默丢内容）
- [ ] **恢复后重试成功**：取消 Block 后点「重试」→ 卡片渲染出图，错误态消失
- [ ] **导出按钮**：点「下载 PNG」得到非空 `.png`、点「下载 SVG」得到可打开 `.svg`；「复制代码」粘贴出源码原文

## 三、思考块默认展开（`thinking.defaultExpanded`）

- [ ] **默认 true：新挂载行自动展开**：发一条会产生思考行的消息 → 新出现的思考行**已展开**（内容可见）；展开动画 / 结构 / a11y 与官方一致（不是自绘节点）
- [ ] **手动折叠不被反复展开**：把某条思考行手动折叠 → **持续观察 30 秒 + 再发一条新消息**，该行**保持折叠**（插件对同一行只派发一次点击）
- [ ] **多行独立**：同一消息里多个思考行 → 各自独立展开，互不影响
- [ ] **设为 false = 纯官方默认**：设置页关掉「思考默认展开」（或 patch 写 `thinking.defaultExpanded: false`）→ 新思考行**默认折叠**，与插件禁用时行为一致
- [ ] **热生效**：改开关后**不重启**，下一条新消息即按新值表现

## 四、设置页（单 tab「渲染」三分组）

- [ ] **单 tab**：设置 → 插件 → 只有 **1 个「渲染」tab**（不是 3 个），tab 内三分组：**Markdown 增强 / 思考块 / Mermaid 图表**
- [ ] **开关项齐全**：整段复制、text 围栏块渲染、上下文注入块渲染、思考默认展开、注入 mermaid 能力说明、渲染 mermaid 代码块（共 6 项），默认全开
- [ ] **配置读写落盘**：关掉任一项 → `$DSH_HOME/profiles/web/cordis.patch.yml` 里 `md-render` 行的 config 变为**命名空间结构**（`markdown.*` / `thinking.*` / `mermaid.*`），且**行内原有手写键未被抹掉**
- [ ] **重启回读一致**：重启隔离实例 → 设置页仍显示刚才的值，行为一致
- [ ] **legacy 扁平键兼容**：在 patch 里手写旧键（`copyButton: false` / `textFenceMarkdown: false` / `contextMarkdown: false` / `defaultExpanded: false` / `injectPrompt: false`）→ 重启后**旧键仍生效**（对应能力关闭）；且**段内键优先**（同时写 `copyButton: false` 与 `markdown.copyButton: true` → 生效的是 true）
- [ ] **API 一致**：`curl -s http://127.0.0.1:3099/md-render/api/config` → 返回归一后的三分组结构；非本机请求 → 403

## 五、硬约束验收（重点：非 markdown 区域与官方默认完全一致）

- [ ] **无节点级替换**：DevTools 里插件**未注册任何 `conversation.chat.node` seat** —— 对照官方默认，消息节点层级 / 结构无插件插入的包裹节点（本插件只 inject `settings.plugins.tab`）
- [ ] **非 markdown 区域零差异**：同一个会话分别在**插件启用 / 禁用**下打开同一段普通消息（纯文本、代码块、工具调用卡、思考行）→ 非本插件接管的区域外观、间距、布局**逐项一致**（用 Elements 面板对比 class 与 inline style，应完全相同）
- [ ] **无全局 CSS 覆盖**：Elements → Styles 里官方节点上的规则**没有一条来自插件**（插件样式只作用于自有类名 `.dsh-md-render-*` / `.tzx-md`；无 `body`/`*`/官方类名选择器）
- [ ] **不写官方元素属性**：插件接管块之外的官方元素上**没有**插件写入的 `style` / `class` / `aria-*`（自带 `data-*` 标记除外）
- [ ] **单 MutationObserver**：Console 执行 `performance.getEntriesByType('mark')` 或按需检查无「观察器叠加导致的重扫风暴」—— 连续发 5 条消息，页面**不卡顿**、无重复渲染闪烁
- [ ] **Console 干净**：整轮走查中 Console **无未捕获异常**（warn 级 mermaid 超限提示可接受）

## 六、破坏性变更核对

- [ ] **旧路由 404**：`/think-zh-expand/api/*`、`/mermaid-render/api/*`、`/mermaid-render/assets/*`、`/md/api/config` 全部 **404**（新路径 `/md-render/api/config`、`/md-render/assets/*` 为 200）
- [ ] **asset 路由方法**：`HEAD /md-render/assets/mermaid-10.9.3.min.js` → 200（无 body）；非 GET/HEAD → 405；带 ETag 且二次请求 304
- [ ] **设置页 3 tab → 1 tab**：见第四节第一条
- [ ] **旧包下线不报错**：roster 里删掉 `think-zh-expand` / `mermaid-render` 两行后实例**正常启动**（`$DSH_HOME/dsh-web.log` 无 `plugin tree failed to load`）；若**故意留着**旧行 → 明确启动报错（loader 指向不存在的包）
- [ ] **思考增强能力仍可用**：中文思考指令由 dsh-my-memory「全局提示词」提供（本插件不再注入），思考块默认展开仍生效

## 未验证项与环境限制

（如实记录：无凭据、无 agent 事件、权限被拒、跳过的条目等；没跑过的不要写成通过）

- ______

## 收尾（强制）

按 `skills/verifying-dsh-plugins/references/verification-steps.md` 步骤 4 五步复查：停 3099 实例 → 删 `/tmp/dsh-verify-real-3099` → `ls` 复查 → 无残留进程 → 无遗留 `choose folder` 进程。**不要动主实例 3080**。
