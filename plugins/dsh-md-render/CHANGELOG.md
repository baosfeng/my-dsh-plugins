# Changelog

本文件记录 dsh-md-render 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 公共 API 承诺面：`MarkdownView`（导出 / props / 自有 DOM 类名清单见 [README「公共 API 契约」](README.md)）；改类名清单 = 破坏性变更，须同步 README 与本文件。

## [Unreleased]

### 变更

- **预览交互便捷性 8 项**（对照市面成熟产品的取证调研后落地，见 #473；每条都带真机实测数字）：
  - **图表「适应」变成跟随容器的保持态**（draw.io 的 `Fit Window` 同款语义）：新增 `fitMode`，绑定 `document.fullscreenchange` + `ResizeObserver(frame)`（不可用退回 `window resize`），容器 / 全屏 / 窗口尺寸变化时自动重算 fit；用户一旦手动缩放 / 平移 / 双击即退出该模式。**真机实测**：窗口 1280×380 → frame 654×268 → pct **84%**；恢复 1280×720 → frame 654×320 → pct **101%**（此前全屏 / resize 后停在旧比例，图缩在一角、下方大片空白）。
  - **进浏览器全屏前先收掉浮窗**（PhotoSwipe 官方配方：两层容器绝不同时存在）：此前实测进全屏后 `<dialog>` 仍 `open: true`、两层模态叠加；现在点「浏览器全屏」后 `dialogOpen: true → false`，并在 `fullscreenchange` 时按 fitMode 重新适应。
  - **双击 = 「适应 ↔ 实际大小」切换**（Panzoom 的 `toggleZoom`、viewer.js 的 `toggleOnDblclick`、lightGallery 三家一致），不再是 `reset`；键盘 `0` 保留为真正的复位。**判据必须按状态（`fitMode`）而非「当前比例是否接近 fit 值」** —— fit ≈ 100%（图接近 1:1）时容差判据会两次双击都判「接近 fit」，永远回不去。
  - **新增「铺满」（适应宽度）**：PhotoSwipe 的 `fill` / Panzoom 的 `cover` 语义，按容器宽度填满、高度超出可拖动。**真机实测**：`svg 宽 101 → 654 = frame 宽 654`，`fillRatio = 1.000`。
  - **缩放锚点跟随手势中心**（mermaid.live 的 `zoomAtPoint` 同款）：ctrl+wheel 用鼠标指针位置、Safari `gesturechange` 用手势中心。**踩坑记录**：panzoom **4.6.2** 的签名是 `zoomToPoint(scale, event)` —— **scale 在前**（证据在库自身：`function v(e,t,n,o){ … t.clientX … }`，而它的 `zoomWithWheel` 是 `v(h(…), e, t, e)`）；较新版本才是 `(point, scale)`。顺序传反时它**不抛错、只是静默不动**（事件已到达、console 零报错、transform 纹丝不动），因此这次同时加了**调用后校验**：`getScale()` 没变即视为失败并回退到居中缩放。
  - **代码块补回「换行切换」**（官方 `CodeToolbar` 有 wrap/unwrap，自研版此前漏掉 = **能力倒退**）：按钮排在复制之前，**默认不换行**（默认视觉零变化），切换时给 `pre` 追加 `dsh-md-render-code-wrap`；`aria-pressed` / `title` / `aria-label` 同步。**真机实测**：`自动换行 → 取消换行`、`aria-pressed false → true`、`white-space: pre → pre-wrap`。
  - **markdown 图片「点击放大」**（medium-zoom / 各灯箱库的通行做法）：原生 `<dialog>` 模态（与本插件浮窗同款做法，零依赖），图片 `object-fit: contain`，**Esc / 点遮罩 / 点图片三路关闭**，并保留键盘可达（Enter / 空格）；`src` 仍过 `mdSafeImageSrc` 白名单，未放行的地址不打开灯箱。
  - **工具条补全快捷键与手势提示**：`+ - 0`、方向键、双击切换、双指捏合**此前全都实现了却没有任何提示**（viewer.js / draw.io 都有显式文档）。现写进每个按钮的 hover `title`（`aria-label` 保持简短，屏幕阅读器读的是它）。

- **外观换成插件自己的视觉语言（不再对齐 / 照抄官方样式）**（用户口径：「全部使用我们自己的，外观也是，就是全部我们自己来」）：
  - **背景**：渲染内核上一轮已全换自研（marked + highlight.js），但 `styles.ts` 仍刻意逐像素对齐官方 —— 排版取 `--dsw-font-markdown-*` shorthand、语法着色取官方 shiki 的 `--shiki-token-*` 逐 token 对齐、行内代码取 `--dsw-alias-markdown-inline-code`，结果**外观与官方一致、用户看不出变化**。本次改为**一套自有设计语言**。
  - **自有设计 token `--mdr-*`**：只在本插件自有根元素（`.tzx-md` / `.dsh-md-render-code` / `.dsh-md-render-mermaid-card` / 自有控件）上定义与使用；圆角 6/10/12px、胶囊 `999px`、线（`--mdr-line`/`-soft`）、强调色（取宿主 `--dsw-alias-state-business-primary`，带 `--dsw-alias-link` 兜底）、等宽栈（取宿主 `--ds-font-family-code`）。**颜色仍全部取宿主语义变量、零硬编码十六进制** → 深浅色自动跟随。
  - **代码块辨识点**：语言名改成**强调色大写胶囊**（`JS` / `JSON` / `BASH`，10px + 字距；语言识别失败时 `:empty` 直接不渲染，绝不出现空胶囊）；**头部不再是通栏灰带**（语言胶囊 + 5% 强调色薄底 + 发丝分隔线，与代码区同属一个圆角容器 + 轻阴影 + 左侧 3px 强调竖条）；**复制按钮默认隐形**，hover / 键盘 `focus-within` / 触屏（`@media (hover:none)`）三路浮现；代码区 12.5px/1.7 等宽（官方 11px/19px）、`tab-size:2`、**长行横向滚动**（官方是 `pre-wrap` + `break-all`）。
  - **markdown 自有层级**：正文 14px/1.75（官方 24/14）；`h1` 20px/700 + 左侧 3px 强调竖条；`h2` 17px/700 + 下边框；`h3`–`h5` 自有字号；`h6` 大写小字（字距 .08em）；列表标记染色（`li::marker`）+ 项间距 5px；引用块 = 左侧 3px 强调竖线 + 6% 强调淡背景 + 右侧圆角；分隔线 = 两侧渐隐的发丝线；表格 = 圆角外框 + 强调色表头薄底 + 发丝行线 + 行 hover；行内代码 = 胶囊 + 强调色染色（向正文色收敛保对比度）；任务列表勾选框自绘（原生 **disabled** checkbox 不认 `accent-color`、实测恒为灰：改 `appearance:none` + `::before` 画框 + `:has()` 驱动的描边勾形，`:has()` 失配时 `@supports` 退化为原生控件）。
  - **统一设计系统**：代码卡片 / markdown 卡片 / 图表卡片同一套边框 · 圆角 · 层次 · 胶囊控件；图表卡片标题与语言胶囊同一「标签」形态（强调色 + 大写 + 字距），分段控件激活态走自有强调色，图表区加极淡点阵底。
  - **语法着色换成自有语义映射 `--mdr-syn-*`**（不再逐 token 对齐官方 shiki）：蓝=关键字、绿=字符串、琥珀=数值/常量、灰=注释（斜体）、弱蓝=函数、次级灰=属性/标点；每一色都由**宿主状态色向正文色 `color-mix`** 得到。**对比度实测**（真实浏览器取计算色，背景 `#f9fafb` 浅色 / `#1b1b1c` 深色）：浅色下 keyword 4.42→**4.87**、string 3.30→**5.57**、comment 3.18→**5.08**、constant 4.02→**4.69**、parameter 3.43→**5.55**、function 6.03→**9.12**；深色下全部 ≥ **6.12** —— 官方有 3 个 token（string / comment / parameter）低于 WCAG AA 4.5，本插件**零个**。
  - **顺带修掉的两处静默失效**：① 旧样式引用宿主里**根本不存在**的 `--dsw-alias-accent` / `--dsw-alias-accent-primary`（分段控件激活态与「查看原文」按下态实际是「未设置」）；② 代码 diff 的增删色把**背景 token**（8%/12% 透明度的 `--dsw-alias-code-diff-added/deleted`）当**文字色**用 → 浅色下几乎不可见，现改用宿主状态色向正文色混合（5.53 / 5.57）。
  - **无障碍**：宿主在指针模态下会把官方 `:focus-visible` 描边抹成透明（`ui-theme/focus.css`），因此自有控件一律自绘**强调色 2px focus 环**（+2px 外偏移；可滚动代码区 -2px 内缩避免被 `overflow` 裁掉），链接与代码区也可聚焦；语言名胶囊之外仍保留文本（不靠颜色单独传达信息）。
  - **静态断言**：新增 `test/own-visual-language.mjs`（9 条）钉住「外观自研」—— 不出现十六进制色值、不引用官方 markdown 排版 shorthand / `--shiki-token-*` / 不存在的 accent token、自有 token 与三张卡片的辨识点齐全、每个语法色都由宿主语义变量取或派生、焦点环齐全、产物与源码不漂移。**反向验证**：把 `styles.ts` 改回旧值并重建 → 该文件 **9/9 全红**；恢复后全绿。
  - client 产物 214 KB → 221 KB（样式表 6.2 KB → 13 KB；体积门禁上限 151 KB，仍有余量）。

- **内容渲染完全换成插件自己的实现（不再调用官方 `MarkdownText` / `CodeBlock`）**（用户口径：「markdown 需要全部替换为我们自己的渲染」「代码渲染使用我们自己的，不要使用原生的」）：
  - **所有围栏块都由自研渲染器接管**（此前只接管 `text` 家族的围栏块，`js` / `json` / `bash` 等一律走官方 `CodeBlock`）：`text` / `plaintext` / `txt` / `md` / `markdown` 与**确证无语言**的块 → **自研 markdown 渲染**（真实 `h1`–`h6` / `ul` / `ol` / `table` / `blockquote` / `a` / `code` 标签，自有 `dsh-md-render-md-*` class）；其余语言 → **自研代码块**：banner 显示**围栏 info string 的真实语言名**（官方那套是 `supportsHighlighting(lang) ? lang : labels.codeLabel`，不认识的标记一律显示本地化标签「代码块」——用户不满的正是这个）+ 复制 + 长行横向滚动 + 语法高亮。
  - **解析层 marked 18.1.0**：marked 词法树 → 自有 React vdom（不是 innerHTML；raw HTML 与官方同口径地当字面文本，链接只放行 `http`/`https`/`mailto` 与同源相对路径）。既有表格容错（GFM 不认的两种分隔行写法）在新解析层上原样接上。
  - **高亮层 highlight.js 11.12.0**：用 hljs 结果里的 `_emitter` 令牌树 → 自有 vdom `hljs-*` span（class 口径与 hljs `scopeToCSSClass` 逐字一致），**全程没有 innerHTML / dangerouslySetInnerHTML**；着色取**本插件自己的语义映射** `--mdr-syn-*`（宿主状态色向正文色混合，深浅色自动跟随，见上方「外观」条目），不再取官方 shiki 调色板。
  - **两个库都走 `assets/` 懒加载**（与 mermaid 引擎同一模式；用户口径「打包体积不用控，只控启动速度」）：`assets/marked-18.1.0.umd.js`（47 KB，MIT）与 `assets/highlightjs-11.12.0.min.js`（129 KB，BSD-3-Clause）由 host 半静态托管，client 首次真正需要时 fetch + 注入 `<script>`，**不进 `lib/client.js`**；就绪通知触发一次重扫，把加载窗口内落在官方形态的块补渲染。
  - **降级链**（真降级）：解析层没就绪 → 块保持宿主官方形态；hljs 没就绪 / 语言不认识 / 单块 > 6 万字符 → 纯文本代码块（内容一字不少）；`react-dom/client` 不可用 → DOM 注入点不动宿主 DOM。
  - `pre[data-context-text]` 上下文注入块与公共 API `MarkdownView` 同样换成自研渲染器（解析层没就绪时 `MarkdownView` 落 `<pre>` 兜底，且订阅就绪通知后重渲染）。
  - 「渲染为…」三态控件（图表 / Markdown / 源码）对**所有**围栏块可用；视图状态属性 `data-dsh-md-render-text-view` 新增取值 `code`，自有 CSS 对 `markdown` / `code` 两个接管视图都隐藏官方直接子元素，切「源码」即恢复官方原样。
  - **门控先于语言判定**：流式块（`[data-streaming]`）与开关关闭的块**一次索引请求都不发**（此前语言判定在门控之前，流式期间会放大请求量）。
  - 产物依赖面收窄：client 半**不再 require 官方 UI 组件库**（`@deepseek-ai/dsh-client-ui-primitives`），只依赖平台 seed 模块 `react` + `react-dom/client`；新增静态断言（不 require 官方组件、自研渲染器无 innerHTML 路径、两个新 assets URL 必须出现在产物里、`code` 视图的隐藏规则）。
  - client 产物 178 KB → 214 KB（新增自研渲染器；两个库不进 bundle）。**升级后必须重启 `dsh web`**：host 半的资源白名单在启动时固定，老 host 会把两个新 assets URL 判 404（此时真降级为官方形态，不报错）。

- **图表缩放改为「有感」**（真机反馈「点放大还是没反应」）：
  - **打开即适应容器**（contain）：此前初始 `scale=1`，小图（`flowchart LR X-->Y` 仅约 114px 宽）躺在 654px 宽的卡片里缩成一角。现在首次绑定与开浮窗都按 contain 自动放大 —— 实测扁图 `114×50 → 365×160`（**320%**）。
  - **「适应」不再是 reset**：改为真正的 contain（容器与图固有尺寸取宽高比例的**较小**者）。此前 reset 到 1 对已撑满高度的图毫无变化，用户点它只会觉得「没反应」。
  - **裁剪容器补 `min-height:160px`**：扁图的容器原先只有约 50px 高 → contain 高度比恒为 1 → 图永远放不大，这是「图一直很小」的**根因**；contain 的「可用空间」也改为取**裁剪容器**而非变换层（变换层高度由内容决定，扁图仅 50px）。
  - **放大步长 1.25 → 1.5**，并新增**实时百分比标签**（`320%` / `225%`）—— 此前步长 25% 对小图肉眼几不可辨，用户感知就是「没反应」。

### 新增

- **确证无语言的围栏块按 markdown 兜底**（#470 需求 3）：模型常把**实际是 markdown** 的内容用**无标记**围栏包起来（`**加粗**` 这类），官方 CodeBlock 按等宽代码块原样显示就丢了排版。语言判定新增 `confirmed` 语义，区分「**确证无语言**」（走兜底渲染）与「**识别失败**」（保持官方默认，绝不猜）——只放宽前者，**不是**内容启发式判定。`text` 家族同时补上 `md` / `markdown` 标记；兜底块同样带「查看原文」一键切回。
- **围栏语言手动切换**（#470 需求 4）：块内「图表 / Markdown / 源码」三态控件（hover / 键盘 focus / 触屏 `@media (hover:none)` 三路可达，只做 hover 手机点不到）。优先级 **手动覆盖 > 语言索引 > DOM 契约**，用于模型把 Java 写成 ```js 这类误判——属用户**显式意图**，与「自动判定绝不猜语言」不冲突。覆盖值按内容哈希记入 `sessionStorage`（刷新后仍记得），有界（100 条）。
- **图表浮窗 + 缩放 / 平移**（#470 需求 1）：卡片可开**页面内 `<dialog>` 模态浮窗**（90vw × 85vh + 遮罩；Esc / 关闭按钮 / 点遮罩三路退出；搬的是**宿主节点**而非卡片本身，关闭时原位归还，宿主重渲染后仍有兜底）——实测 `document.fullscreenElement === null`，**不是**浏览器 Fullscreen API（真机反馈「要的是浮窗式最大化」，原生全屏降为面板内二级按钮）。缩放 / 平移由 vendored `@panzoom/panzoom@4.6.2` 提供，走 `assets/` 懒加载（对 `lib/client.js` 增量 **0**，不挤占体积门禁）：工具条（全屏 / 适应宽度 / 实际大小 / 缩小 / 放大）、**Ctrl+滚轮捏合**（macOS 触控板派发的正是 `wheel + ctrlKey`）、键盘 `+ - 0` 与方向键、双击复位；非浮窗态**裸滚轮不拦截**（避免滚动陷阱），仅 ctrlKey 或浮窗态接管。

### 修复

- **缩放按钮「点了完全没反应」的根因：panzoom 运行时加载失败后，每一次点击都被静默丢弃**（真机反馈第三次「点击放大和缩小没有任何反应」）：
  - **复现证据**（本机真实浏览器）：阻断 `/md-render/assets/panzoom-4.6.2.min.js` 后，卡片百分比停在**硬编码初始值 `100%`**、`data-dsh-md-render-fs="failed"`、变换层无任何绑定 —— 与用户截图的「`100%` + 小图 + 点击无反应」**逐项吻合**。
  - **根因**：`bindZoom()` 的失败分支是 `return undefined`，`zoomEntry()` 拿到 undefined 就**静默丢弃**这次点击；且失败态**没有任何可见样式**（`styles.ts` 里零条 `failed` 规则）→ 从用户视角看就是「按钮坏了」。panzoom 是本插件唯一走**运行时** `fetch` + `<script>` 注入的缩放依赖，加载 / 注入 / UMD 落点任一环节受环境影响都会走到这条静默路径（`100%` 正是未被刷新过的标签初值，与「已绑定但恰好适应出 1.0」在视觉上无法区分，所以只能靠这条数字判据定案）。
  - **修法**：新增**内置降级缩放引擎** `createFallbackZoomer()`（纯 CSS `transform`，零运行时加载 ⇒ **不存在失败面**），接口与 panzoom 完全一致；`bindZoom()` 改为**优先 panzoom、拉不起来就用内置引擎**，并删掉「失败就 `return undefined`」这条静默路径（引擎**构造抛错**同样降级）。降级态锚点取元素自身中心（`transform-origin:50% 50%`），图围绕自己中心缩放。
  - **故障环境实测**（阻断 panzoom 请求 + **真实鼠标点击**）：修复前 `pct ["100%","100%"] · zoomAttr 0 · 点击毫无反应`；修复后 `pct ["101%","324%"]`（自动适应照常生效）、`zoomAttr ["on","on"]`、点「+」`151% → 226%`、点「−」`226% → 151%`，浮窗同样正常。
  - **防回归**：`test/mermaid-zoom.mjs` 两条新用例（拉取失败 / 构造抛错都必须在 `transform` 上真的产生 `scale(1.5)`），替换原先「失败即不绑事件 + 标 failed」的用例 —— 那条断言钉住的正是本次被修掉的错误行为。
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
