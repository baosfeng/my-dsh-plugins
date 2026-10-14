# 04 细化轮记录（一轮一个维度）

## R1 视觉 · 套 apple 风格包
- 做什么：`:root` 整段粘 apple 的 56 槽；排版改用 --text-* 阶梯；卡片走发丝边 + 单侧强调线索；
  控件改胶囊；主操作实心蓝。
- 自测：verify 全过（56 槽完整 / 零裸色值 / 断点齐 / 无溢出 / 对比度达标）。
- 存档：`history/04-r1.html`

## R1b 视觉（按用户反馈修订）
反馈原文：「按钮越少越好，多用图标描述，尤其是最后一个复制，完全和页面不协调」

改动：
1. **去掉实心蓝主按钮**：「复制整段 markdown」→ 底部行右侧一个安静的无边框图标按钮（hover 才显背景）。
2. **文字按钮 → 图标**：
   - 代码卡：`图表 / Markdown / 源码` 三个文字按钮 → 一个**分段图标控件**（柱状 / 文档 / 尖括号），复制与换行 → 图标按钮。
   - 图表卡：`预览 / 代码` → 分段图标；`适应 / 铺满 / 100%` → **一个缩放控件**（− 100% +）+ 一个「适应容器」图标；`PNG / SVG` → 一个导出图标。
   - 顶栏：`浅色 / 设置` 文字 → 图标。
3. **文字搬到 hover 提示**：每个图标带 `data-dsh-md-render-tip` + `aria-label`（md-render 的原话：快捷键与手势全部写进按钮 hover 提示）。
4. 计数变化：原始 `--accent` 从 6 处降到 **5 处**（可见实心用法只剩「已勾选任务框」）。

自测：verify 全过（无横向溢出 / 对比度达标 / 断点齐 / 56 槽完整 / 零裸色值）。
存档：`history/04-r1b.html`

## 待办（下一轮起）
- R2 状态轮：hover / focus / active / disabled / **empty / loading（流式）/ error（mermaid 失败回落）**
- R3 内容层级轮：标题层级、密度、长回答节奏

## R1c 视觉（第二轮反馈）
反馈原文：「提示的时候看不见文字，然后不常用的最好是放到设置里面，而不是在这里面，比如换行」

改动：
1. **修 bug：hover 提示被裁掉**。根因是 `.card{overflow:hidden}` 把浮层切了（截图上只剩一条黑边）。
   改为 `.card{overflow:visible}` + 头部/预览区各自收圆角；提示加 z-index 与阴影。现在 hover/focus 能看到「复制」等文字。
2. **换行按钮撤出块头**，改到「设置 → 插件 → 渲染」（和 md-render 真实的设置面板一致：那里本来就有
   渲染总开关、上下文注入、思考块展开、mermaid 注入等开关）。块头只留高频动作。
3. 结果：代码块块头 = 视图切换（分段图标）+ 复制；图表块头 = 视图切换 + 缩放 + 适应 + 导出。

**新立的规矩（写进本产物）**：块头最多 3 组控件，只放「与这个块当场相关且高频」的动作；
其余（换行、渲染总开关、思考块展开…）一律进设置面板。
自测：verify 全过。存档：`history/04-r1c.html`

## R2 状态轮（只做状态，不改版式）
产物尾部新增「R2 · 状态」清单（`data-od-id="state-sheet"`），逐项摆出：
1. 图标按钮：默认 / hover / focus / 按下 / 禁用
2. 分段控件 + 缩放控件：默认 / hover / 禁用
3. 复制反馈：默认 → 已复制（✓，1.6s 自动回退）→ 失败（剪贴板不可用，指路「查看源码」）
4. 流式渲染中：骨架条 + 光标 + 「等内容稳定再渲染」，整段复制置灰
5. 图表加载中：骨架 + 引擎懒加载说明，工具条整体禁用
6. 图表渲染失败：**首屏即源码** + 一行灰字错误原因 + 重试（绝不静默丢内容）
7. 空态：语言识别失败时语言胶囊留空；本回答无围栏块时不显示元素栏

**verify 抓到我自己的 bug**：新写的小字直接用 `--success` / `--danger` 原色，压在对白上对比度只有
3.03:1 与 4.44:1（低于 4.5:1）。按 craft color 的规矩加两个「文字级」派生色
（`--mdr-ok-ink` / `--mdr-bad-ink`，语义色向正文色混），复测通过。
自测：verify 全过（对比度达标 / 无溢出 / 断点齐 / 56 槽完整 / 零裸色值）。存档：`history/04-r2.html`

## R3 内容层级轮（只动层级、节奏、密度）
1. **回答级 meta 行**：时间 / 用时 / token / 模型 —— 12px 灰字，不与正文争层级。
2. **h1–h6 全档位**：h1 21 半粗（左竖条）、h2 17 半粗（下边框）、h3 15、h4 14（次级色）、
   h5 13、h6 12 大写小字 —— 越深越靠**字重 + 颜色**而不是字号（Apple 的做法）。
3. **加了一条追问回答**做长文测试：h1 → h2 → h3 → h4 → h5 → h6、嵌套列表、表格、引用，
   专门验层级是否够用、密度是否读得下去。
4. **右栏从"元素类型清单"改成真正的标题树**：h1/h2/h3 三级缩进 + 当前项强调色左标，
   长回答里能当导航用；元素统计降级为标题下的一行 meta。

### R3b 节奏修正（自己发现的）
flex 的 gap 与 margin **会叠加**：h2 上方实际 = 12(gap) + 24(margin) = 36px，h3 也偏大，长回答发飘。
改成"标题 margin 归零、只按相邻兄弟加一档"：h2 24 / h3 20 / h4–h6 16（含 gap）。实测：
`p→h2=36`（章节断）`h2→h3=12` `h4→p=16`。
自测：verify 全过。存档：`history/04-r3.html`（层级）→ `history/04-r3b.html`（节奏修正）

## 收口（05 交付版）
1. 过 `web-prototype` checklist 时抓到**「编造指标」**：第二条回答的表格写了无来源的「约七成命中率」→
   改成「依据」列（不猜 / 内容长相（不做） / 会话事件流原文）；时间、用时、token 数属示例数据，
   页面底部加了一行显式声明（否则算 P0）。
2. 冻结为 `05-prototype.html`（内容同 04），逐条自测写入 `05-checklist.md`。
3. 顺手修了 skill 的一个 bug：`odops brief` 生成的澄清单带行内注释，`parseBrief` 没剥注释，
   `platform` 会变成 "web   # DSH Web GUI 对话面"。已修 + 加防回归自测（selftest 50/50）。
4. 门禁：`odops verify 05-prototype.html --template web-prototype --platform web --browser` 全过
   （唯一未跑项：官方 anti-slop lint 需要桌面 daemon）。

## 范围修正（用户明确：只做 markdown 渲染，其他不要碰）
反馈原文：「首先，我得明确一下，我们只做 markdown 渲染，其他的不要碰」

处理：交付版**重做为 markdown 渲染样张**，把不属于 markdown 渲染的东西全部移出：
- 移出宿主 chrome：会话列表、顶栏、「本回答大纲」右栏；
- 移出其他渲染器：代码块卡片（语言胶囊 / 三态 / 复制 / 换行）、mermaid 图表卡片（工具条 / 缩放 / 导出）、
  思考块、上下文注入块的卡片外壳与控件；
- 移出为那些控件做的状态清单；保留的只有 markdown 元素自己的状态（链接 hover/focus、表格行 hover、任务框勾选）。

新交付版内容 = 渲染器**全部产出元素**的样张（按 own-markdown.ts 实际的 class 清单组织）：
标题阶梯 · 行内（strong/em/del/code/a/br/raw-HTML 转义）· 列表（无序/有序含 start/嵌套/任务列表）·
引用（含嵌套）· 表格（三档对齐 + 非标准写法容错后同样落样式）· 分隔线 · 图片（含 alt）· 纯文本回落 · 元素状态。

**verify 又抓到两条真问题**：
1. 只有 1024 / 768 断点，缺 1440 → 澄清单要求响应式，直接判 P0；
2. 图片 alt 文本原用 `--meta`，对 13px 小字实测 **3.62:1**（低于 4.5:1）→ 改用 `--muted`。
（另外：CSS 注释里写了裸 hex，也会被裸色值检查算进去 —— 注释里同样不能留色值。）

自测：`odops verify 05-prototype.html --template web-prototype --platform web --browser` 机械项全过。
存档：`history/05-prototype-chrome-v1.html`（旧的三栏版）→ `history/05-prototype-md.html`（本版）

## 阶段流水线对齐（按新规矩：骨架 → 填充 → 交互 → 填色 → 动画 → 原型）
本项目实际执行顺序与阶段对照（颜色提前做了，如实记录、不假装按序）：

| 阶段 | 本项目产物 | 状态 |
|---|---|---|
| 0 前置澄清 | `00-brief.md` | 完成 |
| 1 选模版 | `01-template.md` | 完成 |
| 2 定风格 | `02-style.md` | 完成（用户确认） |
| 3 骨架 | `03-layouts/a|b|c.html` → `03-layout.html` | 完成（用户选定 A） |
| 4 填充 | `04-fill.html` | 完成（真实文案/数据；**填色提前于本轮，见 R1**） |
| 5 交互 | `05-interaction.html` | **本轮完成** |
| 6 填色 | 已并入 04/05（apple `:root` 整段） | 提前完成 |
| 7 动画 | — | 待开始 |
| 8 原型 | 旧的 `05-prototype.html` 已归档 | 待收口 |

### 阶段 5 交互：让控件真的有反应
不是画状态图，是**真能点**（用 CDP 真点击实测，不是合成 click）：
1. **任务框真的能勾**：去掉 `disabled`，原生 input + `:has()` 样式跟随；实测点一下 → 已勾选 3/5 → 4/5，样式同步；
2. **图片点击放大**：原生 `<dialog>` 模态，点图/回车打开，Esc、点遮罩、点图、关闭按钮四路退出，关闭后焦点回到图片；键盘可达（`role=button` + Enter/Space）；
3. **整段 markdown 复制**：真点击 → `data-state="copied"`（"已复制"，1.6s 自动回退）；剪贴板不可用时回落 `execCommand`，两条路都不通才显示失败态（并指路手动选择）；
   实测：合成 `click()` 因缺用户激活而走失败分支，**CDP 真点击**返回 `copied` —— 两条路径都验过；
4. **链接 active 态**、**锚点平滑滚动**（`prefers-reduced-motion` 下关闭平滑）。

自测：`odops verify 05-interaction.html --template web-prototype --platform web --browser` 机械项全过。
存档：`history/05-interaction.html`；实测截图：`05-i-task.png` / `05-i-lightbox.png` / `05-i-copy.png`

### 阶段 7 动画（`07-motion.html`）
只为「状态确认」与「进入 UI」而动，全长走 token，只动 transform / opacity：
| 动效 | 值 | 实测 |
|---|---|---|
| 复制按钮状态确认 | `--motion-fast` 150ms + 勾形 scale→1.12 | 计算样式 `0.15s` |
| 链接 / 表格行 hover | 150ms 颜色过渡（高频 ≤200ms） | `0.15s` |
| 任务框勾选 | 勾形 `rotate(45deg) scale(.6→1)` + opacity 150ms | 未勾选态 transform 矩阵 = scale 0.6 |
| 图片放大浮窗 | `--motion-base` 220ms，opacity + scale(.985→1)，遮罩淡入 | `@keyframes dlg-in` |
| **明确不做** | 整页 / 章节淡入、元素逐个浮现 | 装饰性动效拖慢阅读（craft animation-discipline） |

`prefers-reduced-motion`：模拟开启后实测 `transition-duration: 0s`、`animation-name: none`、
`matchMedia('(prefers-reduced-motion: reduce)').matches === true` —— 全部关掉，不做"缩短式妥协"。

### 阶段 8 原型（`08-prototype.html`）= 交付
- `odops verify 08-prototype.html --template web-prototype --platform web --browser` **机械项全过**；
- 交付四件套齐：交付件本体 + 打开方式 + 对照截图（1440/1024/768 + 交互实测两张）+ 自测与决策链（`08-checklist.md` / 本文件 / `history/`）；
- 唯一没跑的项：官方 anti-slop lint（需要桌面 daemon）；
- 用户口径：**不逐阶段验收，一次性完成** —— 因此 7、8 两阶段连续推进，未在中间停下等确认。

产物命名按阶段：`03-layout → 04-fill → 05-interaction → 07-motion → 08-prototype`（06 填色已提前并入 04/05）。
history 存档：`04-r1/r1b/r1c/r2/r3/r3b`（早期轮次）、`05-prototype-chrome-v1`、`05-prototype-md-v1`、`05-interaction`、`07-motion`、`08-prototype`。

### 深色态（填色补充，用户"继续"后一并完成）
- 两个入口：`<html data-ds-dark-theme>`（宿主约定，也可 `#dark` 预览）+ `prefers-color-scheme: dark`（可 `data-ds-light-theme` 压回）；
- 做法：深色原始值只在 `:root` 出现一次，换绑块全走 `var()`，**不复制组件规则**；
- 深底动作蓝另取一支、遮罩抽成 `--scrim` token、语义色换深底版本；示意图保持浅色资产不反相；
- 实测（两种入口各跑一遍文本对比度扫描，共 89 处文本）：**失败 0**；
- 截图：`08-dark-1440.png` / `08-dark-1200.png`；`verify` 浅色门禁仍全过。

### 官方 lint 补跑（用户提醒"可以用 CLI 自己校验"）
- 桌面应用没开，但可以**用 Electron 自带 node 起一个 headless daemon**：
  `ELECTRON_RUN_AS_NODE=1 <app 二进制> <官方 daemon-cli.mjs> --no-open --port 7456`；
  普通 `node` 起不来（better-sqlite3 ABI 145 vs 147，实测 `ERR_DLOPEN_FAILED`）。
- `odops doctor` → daemon OK；`odops lint 08-prototype.html --fail-on p1` → **clean — 0 findings（P0 0 / P1 0 / P2 0）**；
  `odops verify` 里那一行也从"未跑"变成 **ok 官方 anti-slop lint 干净**。
- 跑完**立刻收掉 daemon**（`pkill -f "daemon-cli.mjs --no-open"`，已确认无残留、7456 无监听、无 Open Design 进程），
  免得和桌面应用同写一份 `app.sqlite`。
- 两条官方自检需要 agent runtime 的 `OD_TOOL_TOKEN`（`deliverable-syntax check`、`tools design-systems read`）→ 裸 CLI 拿不到，
  汇报里按"没跑"处理；`odops export` 需要已存在的项目（`/api/projects` 为空）。
- **知识已沉淀进 skill**：SKILL.md 新增「应用没开时怎么跑官方 lint（headless daemon）」一节 + 常见现象两条；
  `references/design-systems.md` §8 补了同样一条。

### 读代码盘官方 CLI 级校验（用户要求"好好看看代码"）
读法：CLI chunk `cli-MPHJVOEF.mjs`（492KB / 175 条 Usage）+ 服务端 `server-WTGXM3LB.mjs`（11MB / 498 条 `/api/*` 路由），
并逐条实测。

| 层 | 命令 | 端点 | 令牌 | 结论 |
|---|---|---|---|---|
| **产物内容** | `od lint <file\|-> [--fail-on …] [--json] [--agent-message]` | POST `/api/artifacts/lint` | 免 | ✅ **唯一一条产物级 CLI 验证**；`lintArtifact(html)` 是纯函数（无 DB/项目依赖）；实测交付版 **0 findings** |
| 环境 | `od doctor [--json]` | `/api/daemon/status` 等 | 免 | ✅ 可用 |
| 数据库 | `od daemon db verify [--quick]` | `/api/daemon/db/verify` | 免 | ✅ 可用 |
| 插件 | `od plugin validate\|verify\|doctor\|canon --check\|simulate\|diff` | 插件系列 | 免 | ✅ 可用，但与产物无关 |
| 交付物语法 | `od tools deliverable-syntax check` | `/api/tools/deliverable-syntax/check` | 要 `OD_TOOL_TOKEN` | ❌ agent runtime 专用 |
| 设计体系包审计 | 本版本 CLI 里**不存在**（服务端仅在一段 prompt 字符串里提到） | — | — | ❌ 用 `odops style-check` |
| 5 维设计评审 | 不是 CLI：`design-templates/critique` 模板 + `/api/critique/conformance`（rollout 指标） | — | 需模型 | ❌ 需 agent + 模型 |
| 导出 | `od export <file> --project <id> --format …` | `/api/projects/:id/export/*` | 免 | 用户明确不需要 |

**沉淀进 skill（工具化，不只是记文档）**：
1. `odops daemon start|stop|status` —— 起/停 headless daemon：内部用 **Electron 的 node** 跑官方 CLI
   （官方 `od daemon start --headless` 用普通 node 实测 `ERR_DLOPEN_FAILED`，ABI 145 vs 147）；
   桌面应用在跑时**拒绝启动**（避免两个实例同写 `app.sqlite`）；停用官方 `od daemon stop`（比 pkill 干净）。
2. `odops lint` 透传 `--agent-message`（官方 linter 能吐可直接拼 prompt 的 `<artifact-lint>` 块）。
3. 修掉 `odops od <cmd> --help` 被自身 help 拦截的 bug（现在真的透传给 od）。
4. SKILL.md 新增「官方校验到底有哪些（CLI 级）」清单表 + 「桌面应用没开时怎么跑官方 lint」改为 `odops daemon` 流程；
   `references/design-systems.md` §8 同步。
5. selftest +3（od 透传 --help、daemon status exit 4、daemon status 无副作用）→ **53/53**。

## 附录 · 用户真机走查后的第二轮改版（工具条收纳式）

用户在浏览器里逐条走查交付件后提了四条，原型据此改版（并同步落到插件实现）：

| # | 用户反馈 | 原型改法 |
|---|---|---|
| 1 | 「这么多图标放这里好看吗？部分非核心的还长期霸占这里」 | 撤回「按宽度藏按钮」，改成**收纳**：常驻 3 项 +「更多」菜单装 6 项低频操作 |
| 2 | 「最多只能保持一行，而不是两行」 | 缩放 − / 百分比 / + 收进**一个胶囊**并进头部；头部 `flex-wrap:nowrap`，空间不够时压标题省略号 |
| 3 | 「这两个是不是重复了？外面有的，里面就别有了」 | 菜单里删掉「渲染为 Markdown / 源码」（与常驻的「预览 / 代码」是同一意图的两套入口） |
| 4 | 「这里显示为复制按钮就行了，hover 过去的时候才显示」 | 整段复制按钮改成 26px 图标按钮 + 悬停浮层（`data-dsh-md-render-tip`） |

同时把「响应式」的正确口径定下来：**按容器宽度（消息列宽）判，而不是视口** —— 原型原有 3 条响应式里 2 条是页面架子的内边距、1 条是视口口径（大屏窄列判不到）。

⚠️ 本轮**未跑**官方 `odops lint` / `verify`：它们需要 Open Design 桌面应用在运行（当时未启动），且本机 `odops` 版本没有 `verify` 子命令。静态自检（内联脚本语法 / 标签配对 / 断点齐全）已过；机械校验由插件侧 `test/prototype-alignment.mjs` 的「工具条对齐」用例承担（含原型侧交叉校验）。

