# dsh-my-plugin-manager

> **DSH 插件市场与更新检查面板**：设置页「插件市场」页签里的只读三件套——npm 市场关键词搜索、插件详情增强（README / 版本历史 / 依赖 / 月下载量）、更新检查（`dsh plugin outdated`）。
>
> **安装 / 卸载 / 启停 / 插件清单不在本插件范围**：官方已默认内置插件管理（侧边栏插件页 + `dsh plugin` CLI + tool-plugin-manager），且官方刻意让设置页插件列表保持只读——本插件不再在其上叠一层可写管理。

[![npm](https://img.shields.io/npm/v/dsh-my-plugin-manager)](https://www.npmjs.com/package/dsh-my-plugin-manager)

![插件市场：关键词搜索 + 详情入口](./assets/market.png)

![插件详情：README 预览 + 版本历史时间线 + 依赖展示](./assets/detail.png)

## 功能

- **市场搜索**：按关键词搜索 npm 插件市场（名称 / 版本 / 描述 / 作者），官方 install 只接受 spec 文本、没有市场浏览，这是官方没有的能力；
- **更新检查**：跑 `dsh plugin --profile <p> outdated --json`，列出「当前 → 最新」（官方没有 outdated / latest 面）；
- **插件详情**：README 预览、版本历史时间线、依赖 / 对等依赖（peer 缺失高亮）、元数据（作者 / 许可证 / 仓库 / 月下载量），并可切换版本查看依赖；
- **只读**：面板不写 profile —— 安装 / 卸载 / 启停 / 清单请用官方插件页。

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

1. 打开 DSH Web 设置 → 插件 → **插件市场**；
2. **市场**区块：输入关键词（如 `dsh-file-activity`）点「搜索」，点结果行或「详情」查看 README / 版本历史 / 依赖；
3. **更新检查**区块：点右上角刷新图标，列出已安装插件里「旧版 → 新版」的条目；
4. **安装 / 卸载 / 启停 / 插件清单**：用官方**侧边栏插件页**（`dsh plugin --profile web add|remove …`）——设置页的插件列表是官方刻意保留的只读视图。

详情页的 README 预览按两级回退渲染：宿主官方 baseline `MarkdownText`（平台 seed 模块）→ 纯文本 `<pre>`。

## 相关文档

→ [插件管理概述](../../docs/插件管理/概述.md)
