# 08 交付：markdown 渲染样张（交付件 · 自测 · 决策链）

**范围**：markdown 渲染（dsh-md-render 自研 markdown 渲染器的产出元素与状态）。
**第二轮扩围**：卡片**工具条控件层**（代码块 banner / mermaid 卡片头 / 缩放 / 导出 / 「渲染为…」的按钮形态、收纳与排布）—— 见 §sec-toolbar。
**不碰**：宿主界面（会话列表 / 顶栏 / 侧栏）、代码块与 mermaid 卡片的**外壳**（边框 / 圆角 / 阴影 / 内边距 / 底色）、思考块、上下文注入块的卡片外壳与控件。

## 交付四件套

| 件 | 位置 |
|---|---|
| 交付件本体 | `08-prototype.html`（单文件自包含：CSS 内联、图片 data URI、脚本内联，无外部依赖） |
| 打开方式 | `open .open-design/08-prototype.html`（默认浏览器）；要并排比多版用 `odops gallery` |
| 对照截图 | `08-final-1440.png` / `08-final-1024.png` / `08-final-768.png` + 交互实测 `08-proof-copy.png` / `08-proof-lightbox.png` |
| 自测与决策链 | 本文件 + `04-rounds.md`（每阶段反馈与改动）+ `history/`（每阶段存档，可回退） |

## A. 机器可判（odops verify --template web-prototype --platform web --browser）

| 项 | 结果 |
|---|---|
| 单文件自包含（无外部 script / link / img / 字体） | ok |
| CSS 内联 · :root 核心 6 变量 + apple 官方 56 槽完整粘贴 | ok |
| :root 之外零裸色值（含注释） | ok |
| 顶层区块 data-od-id（8/8） | ok |
| 响应式断点 1440 / 1024 / 768 齐全 · 无横向溢出 | ok |
| 文本对比度（正文 4.5:1 / 大字 3:1） | ok |
| 官方 anti-slop lint | **未跑**：需要打开 Open Design 桌面应用（daemon） |
| var(--accent) 计数 | warn 5 次（apple focus-ring 1 + 派生线索色 3 + 勾选框填充 1） |
| 触控目标 ≥44px | warn：链接 20px / 任务框 15px（桌面平台不判 P0） |

## B. 渲染器产出元素覆盖（对照 own-markdown.ts 实际 class）

标题 h1–h6（`.md h1–h6`）· 段落与软换行（`p` `br`）· 粗体/斜体/删除线（`strong` `em` `del`）·
行内代码（`-md-code`）· 链接与裸链接退化（`-md-link` `-md-link-plain`）· raw HTML 当字面文本（`-md-html`）·
无序/有序（含 `start`）/嵌套列表（`-md-list` `-md-li`）· 任务列表（`-md-task` `-md-task-item`，自绘勾选框 + `:has()` 退化）·
引用块（`-md-quote`，含嵌套降级）· 表格（`-md-table-wrap` `-md-table` `-md-cell`，三档对齐 + 非标准写法容错）·
分隔线（`-md-hr`）· 图片与 alt（`-md-img` `-md-img-alt`）· 纯文本回落（`-md-plain`）。
以上每个元素在样张中都有一节，标签写在节头上。

## C. 交互（真能点，CDP 真点击实测）

| 交互 | 实测结果 |
|---|---|
| 任务框勾选 | 3/5 → 点击 → **4/5**，`:has()` 样式同步；键盘可聚焦（focus 环） |
| 图片点击放大 | 原生 `<dialog>` 打开（src 正确）；Esc / 点遮罩 / 点图 / 关闭按钮四路退出；关闭后焦点回到图片 |
| 整段 markdown 复制 | 真点击 → `data-state="copied"`（"已复制"，1.6s 回退）；剪贴板不可用回落 `execCommand`；两条都不通才失败态 |
| 锚点跳转 | 平滑滚动；`prefers-reduced-motion` 下改为即时 |

## D. 动画（只为状态确认与进入 UI，全长走 token）

| 动效 | 值 | 实测 |
|---|---|---|
| 复制按钮状态确认 | `--motion-fast` 150ms，颜色过渡 + 勾形 scale(→1.12) | 计算样式 `0.15s` ✅ |
| 表格行 / 链接 hover | 150ms 颜色过渡（高频反馈 ≤200ms） | `0.15s` ✅ |
| 任务框勾选 | 勾形 `rotate(45deg) scale(.6→1)` + opacity，150ms | 未勾选态 transform 矩阵为 scale 0.6 ✅ |
| 图片放大浮窗 | `--motion-base` 220ms，opacity + scale(.985→1)，遮罩淡入 | `@keyframes dlg-in` ✅ |
| `prefers-reduced-motion` | 全部关掉（滚动改即时、过渡/动画 none） | 模拟开启后：`transition-duration: 0s`、`animation-name: none`、`matchMedia` = true ✅ |
| **明确不做** | 整页 / 章节淡入、元素逐个浮现 | 装饰性动效会拖慢阅读（craft animation-discipline） |

## E. 有意偏离（记录在案）

1. **h3–h6 用 `--font-body`**：模版 checklist 要求所有标题用 display 字体；apple 包的分工是 Display 走标题、Text 走密集正文，13–15px 用 Display 反而糊。
2. **原始 `--accent` 只留 1 处可见实心用法**（已勾选任务框），其余走派生线索色（55% 线 / 6% 底 / 混向正文的胶囊文字）。
3. **中文正文行高 1.6**：apple 的 `--leading-body` 1.47 是给拉丁 UI 的，中文偏挤。

## F. 待办（不阻塞交付）

1. 官方 lint 复跑：打开 Open Design 应用后 `odops verify 08-prototype.html --template web-prototype --browser`；
2. 触屏复估：链接 / 任务框点击区（桌面 20px / 15px）；
3. 深色态：接宿主 `data-ds-dark-theme`（apple 包自带深色方案未接入）；
4. 导出其它格式：`odops export 08-prototype.html --project <id> --format html|pdf|image|pptx --yes`（需 daemon + 项目 id）。

## G. 决策链

`00-brief.md`（平台 / 画布 / 响应式 / **范围**）→ `01-template.md`（web-prototype）→ `02-style.md`（apple + md-render 语言，含 2 处有意偏离）
→ `03-layouts/` + `03-variants.md`（三版骨架，选定 A）→ `03-layout.html` → `04-fill.html`（真实内容）
→ `05-interaction.html`（真交互）→ `07-motion.html`（动效）→ `08-prototype.html`（交付）
（填色在 R1 就做了，顺序偏离已在 `04-rounds.md` 注明）

## D2. 深色态（填色补充）

**两种入口**（都不加任何界面控件，跟随宿主与系统）：
1. 宿主约定：`<html data-ds-dark-theme>`（DSH 原生开关；本产物也可用 `08-prototype.html#dark` 直接预览）；
2. 系统偏好：`@media (prefers-color-scheme: dark)`，可用 `<html data-ds-light-theme>` 显式压回浅色。

**做法**：深色原始取值只在 `:root` 出现一次（`--dark-*`），换绑块里全是 `var()` 引用；
**不复制任何组件规则**（这就是契约要求的"换绑语义 token，不复制组件规则"）。

**实测**：

| 入口 | 结果 |
|---|---|
| `#dark` | `bg: rgb(0,0,0)` · `fg: rgb(245,245,247)` · 检查 89 处文本 · **对比度失败 0** |
| `set media dark`（系统偏好） | 同上：深色生效、**失败 0** |

深色下的调整：动作蓝换成深底那支（`#0a84ff` 系）、遮罩抽成 `--scrim` token（否则会变成一片浅灰）、
语义色换成深底版本；示意图保持浅色资产（跟真实截图一样，不反相）。
截图：`08-dark-1440.png` · `08-dark-1200.png`

## A2. 官方 lint（补跑完成 ✅）

用 **Electron 自带 node 起 headless daemon** 后跑通（桌面应用不需要开）：

```bash
ELECTRON_RUN_AS_NODE=1 "/Applications/Open Design.app/Contents/MacOS/Open Design" \
  "/Applications/Open Design.app/Contents/Resources/app/prebundled/daemon/daemon-cli.mjs" --no-open --port 7456 &
odops doctor                                  # daemon OK
odops lint 08-prototype.html --fail-on p1     # → clean — 0 findings（P0 0 / P1 0 / P2 0）
odops verify 08-prototype.html --template web-prototype --browser   # → ok 官方 anti-slop lint 干净
pkill -f "daemon-cli.mjs --no-open"           # 已收掉，避免与桌面应用同写 app.sqlite
```

**结论：官方 anti-slop lint 对交付版 0 findings。** 原先记为"未跑"的那一项，现在没有缺口了。

仍无法在裸 CLI 完成的官方自检（需要 agent runtime 注入的 `OD_TOOL_TOKEN`，不是我们没跑）：
- `od tools deliverable-syntax check` → `{"ok":false,"error":{"message":"OD_TOOL_TOKEN is required"}}`
- `od tools design-systems read --path preview/colors.html --design-system apple` → 同上

导出其它格式仍需要**一个已存在的 Open Design 项目**（daemon 里 `/api/projects` 返回空数组），
即 `odops export … --project <id>` 暂时无项目可用 —— 这不是权限问题，是还没有项目。


## A3. 官方 CLI 级校验清单（读代码 + 实测，v0.24.1）

| 层 | 命令 | 端点 | 令牌 | 结果 |
|---|---|---|---|---|
| **产物内容** | `odops lint 08-prototype.html --fail-on p1` | POST `/api/artifacts/lint` | 免 | ✅ **clean — 0 findings（P0/P1/P2 全 0）**；`lint` 是纯函数，不依赖项目与 DB |
| 环境 | `od doctor --json` | `/api/daemon/status` 等 | 免 | 可用（daemon / 插件 / 技能 / 设计体系 / atoms） |
| 数据库 | `od daemon db verify [--quick]` | `/api/daemon/db/verify` | 免 | 可用（SQLite integrity + foreign_key） |
| 插件 | `od plugin validate \| verify \| doctor \| canon --check \| simulate \| diff` | 插件系列 | 免 | 与产物无关 |
| 交付物语法 | `od tools deliverable-syntax check` | `/api/tools/deliverable-syntax/check` | 要 `OD_TOOL_TOKEN` | ❌ 裸 CLI 拿不到（agent runtime 专用） |
| 设计体系包审计 | 本版本不存在（CLI chunk 0 次出现） | — | — | ❌ 用 `odops style-check` 顶上 |
| 5 维设计评审 | 不是 CLI：`design-templates/critique` + `/api/critique/conformance`（rollout 指标） | — | 需模型 | ❌ 需 agent + 模型 |

**结论**：产物层面真正的 CLI 级验证就是 `od lint` 一条 —— 已跑，0 findings。
daemon 用 `odops daemon start/stop` 起停（Electron 的 node；官方 `od daemon start --headless` 用普通 node 会 ERR_DLOPEN_FAILED）。
