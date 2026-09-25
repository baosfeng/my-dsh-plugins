# dsh-plugin-dev-mode

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh--agent--preset-4d6bfe)](https://github.com/topics/dsh-agent-preset)

<div align="center">
  <img alt="DSH Web 模式选择器：安装本 bundle 后出现「插件开发模式」条目" src="./assets/preset-selector.png" width="720" />
</div>

**DSH 插件开发模式**：一个 **agent preset 声明包（bundle 形态）**，向 DSH 提供名为「插件开发模式」（`plugin-dev`）的 Agent 预设——启用 **Cordis 工具集**（`cordis_inspect_*` 运行时检查 + 动态插件生命周期 `cordis_define`/`run`/`stop`/`undefine`），用于开发、调试和维护 DSH 插件与动态 Cordis 插件。与 shipped「创造模式」（官方 `cordis` preset）同为该工具集的载体，区别在于本模式**工具组合更精简**（去掉 plan mode、委派工具与 web 搜索，prompt 开销更低）。

> 载体是 `cordis.patch.yml` 里的一行 `@deepseek-ai/dsh-agent-preset` 声明（Loader 行 id `preset-plugin-dev`），经 `plugin_manager` 的 `install_bundle` 装载。**要求宿主 DSH ≥ 0.1.7-rc.2**。

## 功能

- **Cordis 工具集**：`cordis_inspect_list/query/self` 运行时检查 + `cordis_define/run/stop/undefine` 动态插件生命周期，支持 `@pluginId` 上下文注入。
- **精简工具组合**：shell、文件读写（read/write/edit/glob/grep）、后台任务、goal、ask、todo、技能加载 + compaction。
- **配套技能**：`editing-cordis-compositions`、`cordis-plugin-development`、`cordis-composition-reference` 直接来自宿主自带的 `@deepseek-ai/dsh-agent-preset` 包（`skill-filesystem.customSkillDirs` 解析该包，不随本包副本分发）——所以技能内容永远与读取本 preset 的宿主版本一致，不会漂移。
- **省 token**：相比 shipped「创造模式」去掉了 plan mode、subagent/workflow/ralph 委派工具与 web 搜索。

## 安装

让 agent 调用 `plugin_manager` 工具（`action: install_bundle`，`target` = 本目录绝对路径）：

```text
plugin_manager { action: "install_bundle", target: "/path/to/my-dsh-plugins/plugins/dsh-plugin-dev-mode" }
```

`install_bundle` 自己完成包安装与 bundle 选择，**不要**用 shell 命令复现这些步骤。装完在**新会话**里于 Web 模式选择器中选择「插件开发模式」；`plugin_manager` 的 `list_plugins` 能看到 `preset-plugin-dev` 行及其激活状态。

> ⚠️ **0.1.5-rc.1 及更早宿主不可用**：preset 目录资产机制（`$DSH_HOME/.agent-presets/<id>/` + `preset.yml` + `agent.cordis.yml`，由 `@deepseek-ai/dsh-agent-presets` 读取）在 0.1.7-rc.2 已被移除，本包也已不再提供该形态资产；而本包的声明行需要宿主提供 `@deepseek-ai/dsh-agent-preset` 与 `agent-preset-registry`（0.1.5-rc.1 没有）。升级宿主前，本插件在该宿主下**不可用**。

## 配置

无配置项：声明行的 `config` 只有 `id`（`plugin-dev`）、`name`、`description` 与 `plugins` 列表（`order` 有意留空，与原 `preset.yml` 一致）。本包不含 JS 代码，不挂 cordis service。

## 注意事项

- **建议把默认 preset 设为 `standard`**：在 Web 设置 General 的 agent preset 一栏选择，让日常会话不带 Cordis 工具集，进一步省 token。
- **信任边界**：Cordis 工具集会把模型写的 JavaScript 在运行时求值，且它写出的组合会成为其他会话挂载的 preset——请把使用本 preset 的会话视为 shell 访问权限。

## 卸载

```text
plugin_manager { action: "remove_bundle", target: "dsh-plugin-dev-mode" }
```

之后「插件开发模式」从模式选择器中消失（已启动的会话保留其启动时的插件版本）。

## 相关文档

→ [插件开发模式概述](../../docs/插件开发模式/概述.md)
