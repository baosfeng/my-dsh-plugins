# dsh-plugin-dev-mode

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh--agent--presets-4d6bfe)](https://github.com/topics/dsh-agent-presets)

<div align="center">
  <img alt="DSH Web 模式选择器：安装 preset 后出现「插件开发模式」条目" src="./assets/preset-selector.png" width="720" />
</div>

**DSH 插件开发模式**：一个 agent preset 资产包，向 DSH 提供名为「插件开发模式」（`plugin-dev`）的 Agent 预设——启用 **Cordis 工具集**（`cordis_inspect_*` 运行时检查 + 动态插件生命周期 `cordis_define`/`run`/`stop`/`undefine`），用于开发、调试和维护 DSH 插件与动态 Cordis 插件。与 shipped「创造模式」（官方 `cordis` preset）同为该工具集的载体，区别在于本模式**工具组合更精简**（去掉 plan mode、委派工具与 web 搜索，prompt 开销更低）。

> 这不是运行时插件（无需挂载到 profile），而是 Agent preset 配置资产：安装后可在 DSH Web 的模式选择器中切换使用。

## 功能

- **Cordis 工具集**：`cordis_inspect_list/query/self` 运行时检查 + `cordis_define/run/stop/undefine` 动态插件生命周期，支持 `@pluginId` 上下文注入。
- **精简工具组合**：shell、文件读写（read/write/edit/glob/grep）、后台任务、goal、ask、todo、技能加载 + compaction。
- **自带技能**：`editing-cordis-compositions`、`cordis-plugin-development` 随 preset 目录安装。⚠️ 这两份内容与官方 `@deepseek-ai/dsh-agent-presets` 的 `presets/cordis/skills/` **逐字同源**（差异仅为格式化）——**升级 DSH 后需按官方重新同步**，不要自行改写，否则会与官方语义漂移（本仓库不维护它们的副本内容）。
- **省 token**：相比 shipped「创造模式」去掉了 plan mode、subagent/workflow/ralph 委派工具与 web 搜索。

## 安装

```sh
cd plugins/dsh-plugin-dev-mode
npm run install:preset
```

一键把 preset 复制到 `$DSH_HOME/.agent-presets/plugin-dev/`（`DSH_HOME` 默认 `~/.dsh`）；也可手动复制 `agent.cordis.yml`、`preset.yml` 与 `skills/`。装完**重启 DSH 进程**（preset 启动时读取），再在 Web GUI 模式选择器中切换到「插件开发模式」。本包不发布 npm，也不注册到 profile。

## 配置

无配置项（agent preset 资产包，不注册到 profile、不读插件配置）。

## 注意事项

- **与「创造模式」（shipped cordis）同进程互斥**：Cordis 的 inspect 注册表是进程级单例，同一进程内只能有一个 preset 挂载它——不要同时开启两个带 Cordis 工具集的模式会话。
- 建议把 `~/.dsh/settings.yaml` 的 `agent-presets.default` 设为 `standard`，让日常会话不带 Cordis 工具集，进一步省 token。

## 卸载

```sh
rm -rf ~/.dsh/.agent-presets/plugin-dev
```

重启 DSH 进程后，「插件开发模式」从选择器中消失。

## 相关文档

→ [插件开发模式概述](../../docs/插件开发模式/概述.md)
