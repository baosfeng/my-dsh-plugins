# dsh-my-plugin-manager

> **DSH 公共插件管理面板**：市场浏览/搜索、一键安装/卸载、更新检查、已安装插件管理——统一维护插件生命周期，插件可独立于 DSH 发版节奏更新。纯官方依赖（面板挂在官方设置页扩展点）。

[![npm](https://img.shields.io/npm/v/dsh-my-plugin-manager)](https://www.npmjs.com/package/dsh-my-plugin-manager)

![插件管理面板：已安装列表 + 卸载/更新检查](./assets/screenshot.png)

![插件管理面板：市场搜索区块](./assets/market.png)

![插件详情页：README 预览 + 版本历史时间线 + 依赖展示](./assets/detail.png)

## 功能

- **市场浏览/搜索**：按关键词搜索 npm 插件市场（名称 / 版本 / 描述 / 作者），一键安装；
- **一键安装/卸载**：走 `dsh plugin --profile <p> add|remove`（与 CLI 同一数据源，自动维护 profile 配置），无需手工编辑 `cordis.patch.yml`；
- **更新检查**：检测已安装插件是否有新版本；
- **已安装插件管理**：只显示用户安装的插件（官方/内置命名空间自动过滤），含名称、版本、启用状态、运行相位与卸载入口；
- **插件详情页**：README 预览、版本历史时间线、依赖 / 对等依赖展示（peer 缺失高亮）、元数据（作者 / 许可证 / 仓库 / 月下载量），页内可直接选版本安装。

## 安装

```bash
# npm 安装（推荐）
dsh plugin --profile web add dsh-my-plugin-manager --trust-lockfile

# 本地 link（本仓库开发者）
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-plugin-manager
```

## 配置

无插件级配置项。

## 使用

1. 打开 DSH Web 设置 → 插件 → **插件管理**；
2. **已安装**区块：查看插件清单并逐行「卸载」，顶部「检查更新」显示可更新项（`旧版 → 新版`）；
3. **市场**区块：输入关键词搜索后点「安装」；
4. 安装/卸载即时写入 profile 配置，新插件在下次重启 DSH 后加载。

详情页的 README 预览按三级回退渲染：`dsh-md-render` → 宿主官方 `MarkdownText` → 纯文本 `<pre>`。

## 相关文档

→ [插件管理概述](../../docs/插件管理/概述.md)
