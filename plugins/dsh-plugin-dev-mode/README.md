# dsh-plugin-dev-mode

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh--agent--preset-4d6bfe)](https://github.com/topics/dsh-agent-preset)

<div align="center">
  <img alt="DSH Web 模式选择器：安装本 bundle 后出现「插件开发模式」条目" src="./assets/preset-selector.png" width="720" />
</div>

**DSH 插件开发模式**：一个 **agent preset 声明包（bundle 形态）**，向 DSH 提供名为「插件开发模式」（`plugin-dev`）的 Agent 预设——启用 **Cordis 工具集**（`cordis_inspect_*` 运行时检查 + 动态插件生命周期 `cordis_define`/`run`/`stop`/`undefine`），用于开发、调试和维护 DSH 插件与动态 Cordis 插件。与 shipped「创造模式」（官方 `cordis` preset）同为该工具集的载体，区别在于本模式**工具组合更精简**（去掉 plan mode、委派工具与 web 搜索，prompt 开销更低）。

> 载体是 `cordis.patch.yml` 里的一行 `@deepseek-ai/dsh-agent-preset` 声明（Loader 行 id `preset-plugin-dev`），装载方式是在 profile 的 `dsh.profile.bundles` 里登记**包名**（`plugin_manager` 的 `set_bundle`）。**要求宿主 DSH ≥ 0.1.7-rc.2**。

## 功能

- **Cordis 工具集**：`cordis_inspect_list/query/self` 运行时检查 + `cordis_define/run/stop/undefine` 动态插件生命周期，支持 `@pluginId` 上下文注入。
- **精简工具组合**：shell、文件读写（read/write/edit/glob/grep）、后台任务、goal、ask、todo、技能加载 + compaction。
- **配套技能**：`editing-cordis-compositions`、`cordis-plugin-development`、`cordis-composition-reference` 直接来自宿主自带的 `@deepseek-ai/dsh-agent-preset` 包（`skill-filesystem.customSkillDirs` 解析该包，不随本包副本分发）——所以技能内容永远与读取本 preset 的宿主版本一致，不会漂移。
- **省 token**：相比 shipped「创造模式」去掉了 plan mode、subagent/workflow/ralph 委派工具与 web 搜索。

## 安装

本包依赖就位后（npm 安装：`dsh plugin --profile web add dsh-plugin-dev-mode`；本仓库源码开发：`link:` 依赖），把**包名**登记进 profile 的 `dsh.profile.bundles`：

```text
plugin_manager { action: "set_bundle", target: "dsh-plugin-dev-mode", enabled: true }
```

手工等价做法：编辑 profile 的 `package.json`，给 `dsh.profile.bundles` 追加字符串 `"dsh-plugin-dev-mode"`（bundles 元素是**包名**，路径只出现在 `dependencies` 的 `link:` 值里）——**须在宿主停止时改**，运行中会被 `plugin_manager` 覆盖。装完在**新会话**里于 Web 模式选择器中选择「插件开发模式」；`plugin_manager` 的 `list_plugins` 能看到 `preset-plugin-dev` 行及其激活状态。

> ⚠️ **别用 `install_bundle`**：在 `link:` 布局下它 `pnpm add <绝对目录>` 不改变依赖值 → 判定不到 `installed`，兜底只认裸包名（会把 link 换成 registry 版本）；`dsh plugin --profile <p> add <目录>` 同理，不追加 `dsh.profile.bundles`。

> ⚠️ **要求宿主 DSH ≥ 0.1.7-rc.2**：声明行需要宿主提供 `@deepseek-ai/dsh-agent-preset` 与 `agent-preset-registry`；低于该版本的宿主下本插件**不可用**。

## 配置

无配置项：声明行的 `config` 只有 `id`（`plugin-dev`）、`name`、`description` 与 `plugins` 列表（`order` 有意留空）。本包不含 JS 代码，不挂 cordis service。

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
