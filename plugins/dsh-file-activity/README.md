# dsh-file-activity

<div align="center">
  <img alt="文件活动插件截图（最近访问 / 文件统计）" src="https://unpkg.com/dsh-file-activity/assets/screenshot.png" width="340" />
  <br />
  <img alt="浮窗预览：点击文件复用侧边栏内置 Markdown 渲染" src="https://unpkg.com/dsh-file-activity/assets/preview-float.png" width="340" />
  <br />
  <img alt="浮窗 HTML 预览：内容撑满整个浮窗主体" src="https://unpkg.com/dsh-file-activity/assets/preview-float-0.5.6.png" width="340" />
</div>

**dsh-file-activity**：DSH 侧边栏文件活动插件（宿主原生侧边栏扩展点，零第三方侧边栏依赖）——在右侧边栏新增「文件活动」页签，记录 agent 工具与插件自身路由的文件读取/新增/修改事件，提供**最近访问**（LRU）与**文件统计**（树形目录）两块视图，点击文件弹出浮窗预览。

## 功能

- **最近访问**：按 LRU 记录文件读取/新增/修改事件（agent 工具读写 + 侧边栏打开/编辑保存），每会话最多 5 条、同一文件只出现一次（再次访问移到最前）；区块标题可折叠，点击文件弹出浮窗预览。
- **文件统计**：按文件**绝对路径**组织成树形目录，每个文件显示「读取/新增/修改」次数与相对时间（悬停看完整时钟时间）；连续单子目录压缩为点号标签（`a/b/c` → `a.b.c`），文件夹行可展开/收起。
- **默认启用**：页签注册后默认开启，且每个会话首次打开时自动打开本页；开关在 **设置 → 插件 → 文件活动**。
- **浮窗预览**：按后缀渲染——代码（语法高亮 + 行号，可切编辑并保存）/ Markdown 富文本 / 图片 / PDF（浏览器原生查看器）/ 沙箱 HTML；点击窗外、按 `Esc` 或点 `×` 关闭，长内容窗内滚动。
- **工作区外文件也能预览**：图片/PDF/HTML 字节走插件自身媒体路由，按 `(sessionId, path)` 授权（只放行本会话记录过的路径，未记录一律 403）；Markdown/代码文本走宿主 `fs.read`。
- **会话隔离**：按会话分桶存储与展示，新建/切换会话立即显示该会话数据，DSH 重启后历史自动恢复。
- **不跟踪 bash/git 等命令内部的文件触碰**，只跟踪 DSH 原生文件工具与侧边栏操作。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-file-activity --trust-lockfile`——无需克隆本仓库；依赖自动级联安装（`dsh-shared` 是唯一 dependencies，侧边栏能力全部来自宿主原生扩展点）。

```sh
# 方式一：dsh plugin（推荐）
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-file-activity

# 方式二：手动 —— 在 profile package.json dependencies 加
#   "dsh-file-activity": "link:<仓库路径>/plugins/dsh-file-activity"
# 再 pnpm install，并在 cordis.patch.yml 加 id: file-activity / name: 'dsh-file-activity'
```

装完**硬刷新浏览器**（Cmd/Ctrl+Shift+R）。编辑 profile 的 `cordis.patch.yml` 会经 Cordis HMR 热挂载 server 端，无需重启 `dsh web`。

## 使用

- 入口：侧边栏「新标签页」（guide）菜单 → 文件活动，或会话开始自动打开。
- 点击任意文件行 → 浮窗预览，不打开侧边栏编辑器标签。
- 顶部「刷新」手动重载，「清空」删除当前会话全部记录。
- 配置：**设置 → 侧边卡片 → 文件活动** 卡片齿轮中的「会话开始时自动打开」（默认开）。
- 资源上限：每会话路径 ≤ 300 / 全局 ≤ 20000 / 会话数 ≤ 64，超限按 LRU 淘汰最久未活动条目（非静默丢弃，写 warn 日志）；审计与写盘按增量追加 + 原子 compact，磁盘用量有界。

## 相关文档

→ [文件活动追踪模块文档](../../docs/文件活动追踪/概述.md) · [CHANGELOG](CHANGELOG.md)
