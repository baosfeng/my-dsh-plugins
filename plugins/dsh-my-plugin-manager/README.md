# dsh-my-plugin-manager

> DSH（DeepSeek Harness）公共插件管理面板：**市场浏览/搜索、一键安装/卸载、更新检查、已安装插件管理**——统一维护插件生命周期，插件可独立于 DSH 发版节奏更新。纯官方依赖（面板挂在官方设置页扩展点，不依赖第三方插件）。

[![npm](https://img.shields.io/npm/v/dsh-my-plugin-manager)](https://www.npmjs.com/package/dsh-my-plugin-manager)

![插件管理面板：已安装列表 + 卸载/更新检查](./assets/screenshot.png)

![插件管理面板：市场搜索区块](./assets/market.png)

![插件详情页：README 预览 + 版本历史时间线 + 依赖展示（issue #90）](./assets/detail.png)

## 功能

- **市场浏览/搜索**：输入关键词搜索 npm 插件市场（名称 / 版本 / 描述 / 作者），一键安装；
- **一键安装/卸载**：走 `dsh plugin --profile <p> add|remove`（与 CLI 同一数据源，自动维护 profile package.json 与 bundle patch），无需手工编辑 `cordis.patch.yml`；
- **更新检查**：`pnpm outdated` 检测已安装插件是否有新版本（插件独立于 dsh 主程序发版节奏）；
- **已安装插件管理**：只显示用户安装的插件（官方/内置命名空间自动过滤），名称 / 版本 / 启用状态 / 运行相位 + 卸载入口；
- **插件详情页**：市场 / 已安装点击「详情」打开——README 预览（复用 dsh-md-render MarkdownView，缺装回退纯文本）、版本历史时间线（npm `time`）、依赖 / 对等依赖展示（peer 缺失项高亮）、元数据（作者 / 许可证 / 仓库 / 月下载量），详情页内可直接选版本一键安装（issue #90）。

## 安装

```bash
# npm 安装（推荐）
dsh plugin --profile web add dsh-my-plugin-manager --trust-lockfile

# 或从本仓库 link 安装
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-plugin-manager
```

## 使用

1. 打开 DSH Web 设置 → 插件 → **插件管理**；
2. **已安装**区块：查看插件清单（名称 / 版本 / 状态），逐行「卸载」，顶部「检查更新」显示可更新项（`旧版 → 新版`）；
3. **市场**区块：输入关键词搜索 npm 插件（如 `dsh-file-activity`），点「安装」即写入 profile；
4. 安装/卸载**落盘即时生效**（profile package.json / cordis.patch.yml），新插件在下次重启 DSH 后加载（候选区热挂载由 dsh-my-guardian 负责）。

## 实现要点

- **数据源**：安装/卸载/更新检查全部走 `dsh plugin --profile web`（pnpm）命令，与官方 CLI 同一数据源，不做手写 patch 编辑；
- **已安装清单**：官方 `pluginInventory` 服务（loader 条目）+ profile `node_modules` 版本读取（支持 scoped 包）；只列出用户安装的插件，官方命名空间（`@deepseek-ai/*`、`cordis`/`cordis:*`、`@koishijs/*`）过滤（issue #28）；
- **市场搜索**：npm registry search API（`keywords:dsh` 全覆盖）；
- **profile 名**：进程参数 `--profile` 优先，默认 `web`。

## 开发

```bash
npm run build   # 拼接 lib/parts/*.part.js → lib/client.js
npm test        # vitest（server 单测 + API 集成 + client 渲染路径）
```

## 相关文档

→ [插件管理概述](../../docs/插件管理/概述.md) · [需求清单](../../docs/插件管理/需求清单.md)
