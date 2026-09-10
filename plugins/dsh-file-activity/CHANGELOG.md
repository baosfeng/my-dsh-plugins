# Changelog

本文件记录 dsh-file-activity 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.5.8] - 2026-09-10

### 变更

- feat(ts): 第四轮 JS→TS 迁移（5 个插件，server + client 全量）

## [0.5.7] - 2026-09-07

### 变更

- fix(deps): update package-lock.json to fix CI/CD failures
- feat(observability): #155 插件状态查询聚合——统一 status-query 事件 + /plugin-status API (#170)
- chore(plugins): #165 清理失效的 dsh.client.inject 声明（13 插件） (#167)

## [0.5.6] - 2026-09-04

### 变更

- chore(release): dsh-file-activity v0.5.6（#111 浮窗预览 + 验证清单）
- fix(file-activity): #111 HTML 预览内容撑满浮窗 (#116)
- docs: #106 安装命令统一加 --trust-lockfile (#113)

## [0.5.5] - 2026-09-02

### 变更

- fix(scripts): #72 插件依赖未随安装自动安装（dsh-shared 未发布 npm） (#96)
- fix(file-activity): 浮窗预览失焦自动关闭（issue #76） (#95)
- fix(file-activity): #72 补充 dsh-better-sidebar 级联安装——dependencies 声明 + 缺失提示
- style: prettier 全量格式修复（CI 格式门禁）

## [Unreleased]

### 变更

- fix(ui): 浮窗预览失焦自动关闭——点击外部任意处/切换页签即关，预览失败 2.5s 自动关闭或点击任意处关闭，头部「点击外部关闭」提示（issue #76）

## [0.5.4] - 2026-09-01

### 变更

- fix(file-activity): 浮窗预览优雅降级与工作区外文本读取（issue #68）

## [0.5.3] - 2026-09-01

### 变更

- fix(ui): 9 个插件未定义 token danger-primary 改用 error-primary（DSH 主题仅定义 business/error/success/warn）

## [0.5.2] - 2026-08-31

### 变更

- fix(ui): dsh-file-activity 移除页签选中态品牌蓝覆盖，回归宿主默认样式（issue #60）
- feat(ui): dsh-mermaid-render 卡片翻新——图标/前缀/状态（issue #54）
- feat(ui): dsh-my-guard 安全护栏面板翻新——图标/前缀/状态/交互（issue #54）
- feat(ui): 共享图标系统 + UI 规范文档（issue #54 阶段0）
- refactor(shared): 抽取 dsh-shared 共享工具包，10 个插件迁移消除重复实现（issue #45）
- chore(deps): 升级 react 19 兼容性——13 个插件 peer 声明 ^18.2.0 || ^19.2.0（issue #49）
- style(format): 全仓 prettier 格式化（issue #44）

## [0.5.1] - 2026-08-27

### 变更

- feat(file-activity): 侧边栏页签选中态改用品牌蓝，三态一眼可分（issue #25）
- feat(file-activity): 文件活动列表按文件类型显示专属彩色图标（issue #24）

## [0.5.0] - 2026-08-26

### 变更

- feat(file-activity): bash 命令文件操作识别（rm/touch/mv/cp/tee/重定向）+ 0 值计数徽标过滤
- docs+test: 全面审查修复——文档同步补全 + mermaid 测试增强

## [0.4.7] - 2026-08-25

### 变更

- **npm 页面元数据优化**：description 改为中英双语（中文在前）；README 效果截图引用改为绝对 URL（unpkg），npm 包页面可直接显示图片。

## [0.4.6] - 2026-08-25

### 变更

- **Server 端按 P2 模块拆分**：`lib/index.js`（434 行）按职责拆分为 fence/state/store/observer/api-route/media-route 子模块（入口 50 行），覆盖率/变异统计范围同步扩展至全部 server 文件（Stryker 变异 90.91% ≥ 70%）。
- **Client 端方案 B 拆分**：`client.src.js` 模板 + 13 个片段（`lib/parts/`）经 `scripts/build.mjs` 拼接生成 `client.js`；eslint 尺寸规则覆盖 src/parts 源码、构建产物排除。
- **client-render 测试零依赖化**：不再硬编码本机 react 绝对路径，改为自写 createElement stub（CI 跨平台可跑）。
- 行为不变（纯重构）。

## [0.4.5] - 2026-08-24

### 修复

- **状态文件 `sessions` 为 `null` 时崩溃**：`loadState` 只检查 `typeof sessions !== 'object'`，而 `typeof null === 'object'`——手改/损坏的状态文件若把 `sessions` 写成 `null`，加载后 `Object.values(null)` 抛 TypeError（unhandled rejection）。现在显式把 `null` 一并重置为空对象，降级为全新状态不崩溃（复现测试 `host-mutation.mjs` 已永久保留）。

### 变更

- **质量门禁测试体系接入**：测试框架迁移至 Vitest（node:test → vitest，API 兼容）；覆盖率门禁 `lines≥85 / branches≥75 / functions≥80`（当前实测 99.1/91.8/97.5）；新增边界测试 `host-edge.mjs`（12 用例）与变异定向测试 `host-mutation.mjs`（49 用例）；Stryker 变异测试达标（71.76% ≥ 70%）；Gherkin 验收测试 11 场景/56 步骤（`test/features/`）随 `npm test` 运行。

## [0.4.4] - 2026-08-24

### 修复

- **工作区外文件的图片/PDF 预览不再破图**：浮动预览的媒体字节此前走侧边栏的 `/sidebar/file` 路由，而该路由只允许会话工作区（cwd）内的文件——agent 实际触碰过的 `/tmp` 临时文件等工作区外路径点击预览时一律 403，图片显示为破图、PDF 加载失败。现在媒体字节改由插件自身的 `/file-activity/file` 路由提供（**只放行该会话记录过的路径**：未记录 403、文件不存在 404、超 64MB 拒绝；fence 信任校验与侧边栏一致），图片在浮窗内正常渲染；PDF 因侧边栏内置查看器写死媒体路由，浮窗改用浏览器原生 PDF 帧 + 下载兜底。
- Markdown / 代码 / HTML 文本预览不受影响（侧边栏 `fs.read` 本身不限制工作区，`client-render.mjs` + 真实浏览器实测回归通过）。

## [0.4.3] - 2026-08-23

### 变更

- **README 补充现场效果图**：顶部新增真实现场效果图（侧边栏「文件活动」页签 最近访问/文件统计树 + 点击文件的浮窗预览），便于其他用户下载前了解功能。
- **发布包包含效果图**：`package.json` 的 `files` 加入 `assets/`，使 GitHub Release 的 tarball 一并包含效果图资源。

## [0.4.2] - 2026-08-23

### 修复

- **修复页签偶发"纯文字无样式"**：样式注入曾放在 `betterSidebar` 服务判空早退之后，HMR 重建/服务重载瞬间新实例可能跳过注入，导致已渲染的页签失去全部 CSS（纯白文本列表）。样式注入改为 `apply` 无条件最先执行（纯静态 CSS，不依赖任何服务），每个 fiber 持有自己的 `<style>` 元素，重建后至少保留一份。

## [0.4.1] - 2026-08-23

### 修复

- **会话切换不再残留上个会话的文件活动**：前端数据 store 改为按 `sessionId` 分桶（`bySession`），每个会话只渲染自己的数据桶——新建/切换会话瞬间立即显示该会话自己的记录（新会话直接为空），不再在 fetch 完成前显示上一个会话的残留数据；fetch 失败时也不再保留旧数据。切换会话时同时关闭上一个会话遗留的浮窗预览。

## [0.4.0] - 2026-08-22

### 变更

- **预览改为浮窗预览（复用侧边栏内置渲染）**：点击任意文件（最近访问 / 文件统计）弹出**悬浮预览窗**，窗口内容通过 `ctx.betterSidebar.matchFileViewer(path)` 复用侧边栏**内置的 file viewer** 渲染（代码语法高亮 / Markdown 富文本 / 图片 / PDF / HTML），并按 viewer 的 `fetchStrategy` 取内容（`fsRead` / `mediaUrl` / `custom`）；不再打开侧边栏编辑器标签，也不自建预览组件。浮窗为轻量交互：**点击浮窗外任意处 / `Esc` 键关闭**，标题栏右上保留一个 `×` 关闭按钮；主体为可滚动区域，长文件或大图在窗内滚动查看。
- **UI 全面改版**（遵循 better-sidebar 设计语言）：全部改用 DSH 语义 token（`--dsw-alias-*` 颜色、`--dsw-font-*` 字形、`--ds-*` 动效），flat 无阴影、hairline 细边、8px 圆角行 + hover 底色；样式表随 activation 注入、fiber teardown 卸载（HMR/禁用无残留）。
- **间距收紧 + 去冗余标题**：整体走 better-sidebar explorer 的紧凑规范（`2px 6px 8px` 容器、30px 行、box-sizing 缩进），移除内容区顶部的「文件活动」标题（tab 条已命名本页），刷新/清空改为右上角细颗粒图标按钮，内容紧贴 tab 条（更沉浸）。
- **文件夹 / 文件图标可区分**：目录行用**品牌强调色**的文件夹图标 + 折叠箭头 + **加粗**名字，文件行用**中性淡色**的文件图标 + 常规名字，彩色文件夹 vs 素色文档，一眼可辨。
- **最近访问只显示文件名**：不再展示完整绝对路径，只显示最后的文件名（悬停仍可见完整路径），减少视觉噪音。
- 操作类型用状态色徽标（新增 = success / 修改 = warn / 读取 = 品牌强调色），文件统计目录树与文件行改为彩色计数胶囊；文件/文件夹行加入图标与折叠箭头。
- 时间显示从 `HH:MM:SS` 改为**相对时间**（刚刚 / N 分钟前 / N 小时前 / N 天前 / MM/DD），悬停仍可查看完整时钟时间。

## [0.3.0] - 2026-08-22

### 变更

- 最近访问列表改为 **LRU**：同一文件只保留一条（重复访问移到列表最前、不重复显示），每会话最多保留 **5 条**（原 10 条）；历史数据在加载时自动去重。
- 时间显示改为 **`HH:MM:SS` 时钟格式**（最近访问列表、文件统计行内时间、悬停提示的创建/最近访问时间），不再显示相对时间（"刚刚 / x 分钟前"）。
- **最近访问区块可折叠**：点击区块标题展开/收起列表。
- **文件统计目录树可收纳**：每个文件夹行可点击展开/收起（箭头指示状态），收起后隐藏其子目录与文件。

## [0.2.0] - 2026-08-22

### 变更

- 最近访问列表最多保留 **10 条**（原 300 条），避免列表过长。
- 文件统计新增时间信息：每个文件行内显示**最近访问时间**（相对时间），悬停可查看**创建时间**（首次接触时间）。
- 文件统计改为**树形目录**展示：按文件**绝对路径**组织成完整目录树（逐层嵌套，目录节点显示子树汇总计数），连续单子目录的路径链自动**压缩为点号标签**（`a/b/c` → `a.b.c`），不再使用扁平的「根目录」分组与点号拼接标签。
- 点击文件改为打开**浮窗预览**（不再在侧边栏 tab 栏打开）：图片走媒体路由渲染、PDF 内嵌 iframe、文本/代码经 `fs.read` 滚动展示；浮窗内提供「在侧边栏打开」与「关闭」按钮。
- 浮窗样式改用 DSH 主题变量（`--dsw-alias-*`），深浅主题下均正确显示；文本加载失败时展示具体错误原因（如文件不存在），并支持相对路径按会话 cwd 解析。
- 浮窗**自动关闭**：鼠标移出浮窗约 0.5 秒后自动消失（移回则取消），无需手动点击关闭。

## [0.1.0] - 2026-08-22

### 新增

- 首个版本：基于 dsh-better-sidebar 的「文件活动」侧边栏页签。
- **最近访问**：按时间倒序记录文件读取 / 新增 / 修改事件，点击文件用侧边栏原生预览打开。
- **文件统计**：按文件统计读取 / 新增 / 修改次数，按文件夹平铺展示（多层文件夹以 `.` 拼接）。
- **默认启用 + 自动打开**：页签默认开启，会话首次打开自动展开（可在设置中关闭）。
- 状态按会话持久化到 `$DSH_HOME/file-activity.json`（防抖 + 原子写入）。
