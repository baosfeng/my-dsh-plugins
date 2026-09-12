# dsh-file-activity

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh--better--sidebar-4d6bfe)](https://github.com/topics/dsh-better-sidebar)

<div align="center">
  <img alt="文件活动插件截图（最近访问 / 文件统计）" src="https://unpkg.com/dsh-file-activity/assets/screenshot.png" width="340" />
  <br />
  <img alt="浮窗预览：点击文件复用侧边栏内置 Markdown 渲染" src="https://unpkg.com/dsh-file-activity/assets/preview-float.png" width="340" />
  <br />
  <img alt="浮窗 HTML 预览：内容撑满整个浮窗主体（issue #111）" src="https://unpkg.com/dsh-file-activity/assets/preview-float-0.5.6.png" width="340" />
</div>

**DSH 侧边栏文件活动插件**（基于 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 扩展）：在 better-sidebar 中新增「文件活动」页签，记录 agent 工具与侧边栏自身的文件读取/新增/修改事件，提供**最近访问**（LRU）与**文件统计**（树形目录）两块视图，点击文件弹出浮窗预览。

## 功能

在 better-sidebar 中新增「文件活动」页签：

1. **最近访问**：按 LRU 记录文件读取 / 新增 / 修改事件（agent 工具读写 + 侧边栏打开/编辑保存都会记录），**每会话最多保留 5 条，同一文件只出现一次**（再次访问会移到列表最前）；区块标题可**点击折叠/展开**；点击任意文件即弹出**浮窗预览**，浮窗内**复用侧边栏内置渲染**（代码高亮 / Markdown 渲染 / 图片 / PDF / HTML，见下方「浮窗预览」）。
2. **文件统计**：每个文件的「读取 / 新增 / 修改」次数，按文件**绝对路径**组织成**树形目录**；连续单子目录的路径链自动**压缩为点号标签**（如 `a/b/c` → `a.b.c`），文件直接列在下方；**每个文件夹行可点击展开/收起**（箭头指示状态）；每个文件行内显示**相对时间**（刚刚 / N 分钟前 / N 小时前 / N 天前），悬停可查看**创建 / 最近访问**的完整时钟时间：

   ```
   Users/                    ← 树根 = 绝对路径根（/）
     bsfeng.IdeaProjects.my-dsh-plugins   ← 连续单子目录压缩为一行
       README.md
       lib/
         index.js
         client.js
   ```

3. **默认启用**：页签注册后默认开启（无需在设置页勾选），且每个会话首次打开时**自动打开**本页（可在侧边栏设置中关闭自动打开）。

## 工作原理

- **Server 端**（`lib/index.js`）：监听 DSH `fs/observed` 事件捕获 agent 的 `read` / `write` / `edit` / `str_replace_editor` / `read_image` 等文件操作；提供 `/file-activity/api` 路由（`stats` / `record` / `clear`）；状态按会话持久化到 `$DSH_HOME/file-activity.json`（**JSON Lines 增量 append + 阈值原子 compact**，见下「资源治理」）。
  - `write` 通过每会话的已知文件表自动区分**新增**（首次接触）与**修改**（再次写入）。
- **Client 端**（`lib/client.js`）：通过 `ctx.betterSidebar.registerTab` 注册页签；fetch 拦截捕获侧边栏自身操作（`/sidebar/api/fs.read`、`/sidebar/api/fs.write`、`/sidebar/file` 媒体预览）并上报 server；数据按会话（session）**分桶隔离**（`bySession`），每个会话只渲染自己的记录——新建/切换会话立即显示该会话的数据，**不会残留上一个会话的记录**；点击文件通过 `ctx.betterSidebar.matchFileViewer(path)` 匹配内置 viewer 并挂载其组件，打开浮窗预览。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-file-activity --trust-lockfile`——无需克隆本仓库；依赖自动级联安装：`dsh-better-sidebar`（宿主，提供侧边栏扩展点）与 `dsh-shared`（server 端共享工具包）均声明为 dependencies，安装时自动安装并加入 profile bundles，无需手动单独处理。

```sh
# 方式一：dsh plugin（推荐）
# 1) 克隆本仓库（任意目录）
git clone https://github.com/baosfeng/my-dsh-plugins.git
# 2) 以本地 link 方式安装（将 <仓库路径> 替换为上面的克隆目录）
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-file-activity

# 方式二：手动
# 1) 克隆本仓库后，在 ~/.dsh/profiles/web/package.json 的 dependencies 增加：
#    "dsh-file-activity": "link:<仓库路径>/plugins/dsh-file-activity"
# 2) 在 ~/.dsh/profiles/web 下执行 pnpm install
# 3) 在 ~/.dsh/profiles/web/cordis.patch.yml 增加：
#    - insert:
#        - id: file-activity
#          name: 'dsh-file-activity'
```

装完后**硬刷新浏览器**（Cmd/Ctrl+Shift+R）。

> 编辑 profile 的 `cordis.patch.yml` 会在运行中通过 Cordis HMR 热挂载 server 端，无需重启 `dsh web`；client 端在页面刷新后生效。

## 使用

- 侧边栏 `+` 菜单 → 文件活动（或会话开始自动打开）。
- 点击任意文件行 → 弹出**浮窗预览**：浮窗内**复用侧边栏内置的 file viewer** 渲染（代码语法高亮 / Markdown 富文本 / 图片 / PDF / HTML），不打开侧边栏编辑器标签，也不自建预览实现；**点击浮窗外任意处或按 `Esc` 即可关闭**，大文件可在浮窗内滚动。
- 顶部「刷新」手动重载，「清空」删除当前会话全部记录。

### 浮窗预览（复用内置渲染）

点击文件（最近访问 / 文件统计中的任意文件行）会打开一个**悬浮预览窗**，窗口内容由侧边栏**内置的文件查看器**（file viewer）渲染 —— 通过 `ctx.betterSidebar.matchFileViewer(path)` 拿到匹配的 viewer，取其 `component` 挂载，并按 viewer 的 `fetchStrategy` 取内容（`fsRead` 文本 / `mediaUrl` 媒体 / `custom` 自定义）。浮窗为轻量交互：**点击浮窗外任意处、按 `Esc` 或点标题栏右上 `×` 都能关闭**；浮窗主体是可滚动区域，长文件或大图在窗内滚动查看。

- **代码**（后台为侧边栏内置 CodeMirror 编辑器）：语法高亮 + 行号；支持 预览/编辑 切换与保存。
- **Markdown**（`.md` / `.markdown`）：渲染后的富文本预览，可切换 预览/编辑 模式。
- **图片**（png / jpg / jpeg / gif / webp / svg / bmp / ico / avif）：通过媒体路由渲染。
- **PDF**：浏览器原生 PDF 查看器（浮窗内嵌，工具栏提供下载）。
- **HTML**：沙箱化渲染预览，内容**撑满整个浮窗主体**（iframe 随浮窗尺寸自适应、内部滚动，与代码/Markdown/图片预览体验一致，issue #111）。
- 其余文件按内置 viewer 的 `matchFileViewer` 回退匹配（如 `binary-download` 下载未知二进制）。

> 💡 **工作区外文件也能预览**：文件活动记录的是 agent 实际触碰过的文件，路径可能在会话工作区之外（如 `/tmp` 临时文件）。侧边栏自带的媒体路由只允许工作区内文件，因此图片/PDF 的字节由插件自身的 `/file-activity/file` 路由提供——它按会话记录授权（只放行本会话记录过的路径，未记录的路径一律 403），fence 与侧边栏一致。Markdown/代码/HTML 文本则仍走侧边栏 `fs.read`（不被工作区限制）。

## 配置

「设置 → 侧边卡片 → 文件活动」卡片齿轮：`会话开始时自动打开`（默认开）。

## 数据说明

- 按会话（session）隔离存储（服务端 `$DSH_HOME/file-activity.json` 按 sessionId 分桶 + 前端 `bySession` 分桶展示）；**DSH 重启后历史数据自动恢复**（持久化加载）；新建/切换会话不残留其他会话的记录。

## 资源治理（issue #197）

写放大与无界增长防护（9/2 事故同构模式整改）：

- **增量落盘**：每次记录只追加一行 JSON（`{"s","p","o","t"}`，落盘字节 ≈ 事件本体字节 ×1.0），
  累计行数达到按状态体积自适应的阈值时做一次原子 compact（tmp+rename 重写快照行），
  文件大小与写入量双向有界（实测写放大 1.0×，旧实现 2,073×）；
- **三维入口上限（LRU 淘汰，非静默丢弃）**：每会话路径 ≤ 300、全局路径 ≤ 20000、会话数 ≤ 64；
  超限淘汰最久未活动条目/会话，淘汰计数暴露在 `store.stats()` 且写 warn 日志（首次 + 每 10 次）；
- **显式护栏**：compact 快照受 `minIntervalMs`（体积分级节流）与 `maxBytes`（8MB 硬上限，超限拒绝写 + 告警）约束；
- **升级兼容**：旧的全量 JSON 快照（单行/多行）仍可读取，首次启动一次性改写为 JSON Lines；
  文件里只有事件行（未 compact）时也能按行序完整重放（不丢数据）。
- 最近访问列表每会话最多保留 5 条（LRU：同一文件仅一条，重复访问移到最前），文件统计不受条数限制。
- agent 的 `bash`/`git` 等命令内部的文件触碰不在此跟踪范围（只跟踪 DSH 原生文件工具与侧边栏操作）。

## 依赖

| 依赖                 | 用途                              | 可选                           |
| -------------------- | --------------------------------- | ------------------------------ |
| `dsh-better-sidebar` | 侧边栏页签注册 + 浮窗 file viewer | 否（前置，v0.12+，推荐 v0.14） |
| `cordis`             | 插件运行时                        | 是（宿主提供）                 |

## 相关文档

→ [文件活动追踪模块文档](../../docs/文件活动追踪/概述.md) · [需求清单](../../docs/文件活动追踪/需求清单.md) · [CHANGELOG](CHANGELOG.md)
