# dsh-my-skill-manager

> **DSH Skill 管理插件**：分「全局 / 项目」查看 skill 列表，按项目启用/禁用，支持手动刷新与扫描诊断。**禁用的 skill 不再注入该项目会话：模型不可见、不可加载。** 纯官方依赖（面板挂在官方设置页扩展点）。

[![npm](https://img.shields.io/npm/v/dsh-my-skill-manager)](https://www.npmjs.com/package/dsh-my-skill-manager)

![Skill 管理面板：全局 / 项目分区 + 启用/禁用开关](./assets/screenshot.png)

## 功能

- **Skill 列表**：分「全局 / 项目」两个视角，显示名称、描述、来源（`user-dsh` / `user-agents` / `custom` / `bundled` / `project-dsh` / `project-agents`）与启用状态；项目视角只显示该项目的 skill，目录中存在但官方 catalog 未收录的条目显示「未收录」徽标。
- **按项目启用/禁用**：全局禁用对所有项目生效；项目禁用仅当前项目生效，且可在项目内禁用全局 skill（项目配置随仓库提交、可版本化）。禁用的 skill 在合并目录中被占位覆盖，模型不可见、正文不可加载。
- **手动刷新**：新建 skill 后点「刷新」立即可见，无需重启。
- **扫描诊断**：frontmatter 异常 / 符号链接异常的目录条目在面板显示缺失名单与原因。
- **设置页面板**：设置 → 插件 → 「Skill 管理」（官方 slots 扩展点，无第三方依赖）。

## 安装

```bash
# npm 安装（推荐）
dsh plugin --profile web add dsh-my-skill-manager --trust-lockfile

# 本地 link（本仓库开发者）
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-skill-manager
```

## 配置

启用状态存 JSON，改动即时生效（catalog 自动失效重算）：

```jsonc
// 全局：$DSH_HOME/skills.enabled.json；项目：<项目根>/.dsh/skills.enabled.json
{
  "global": { "disabled": ["some-global-skill"] },
  "project": { "disabled": ["web-search"] },
}
```

- `global.disabled`：全局禁用（所有项目生效）；
- `project.disabled`：当前项目禁用（可禁用项目级与全局级 skill）。

## 相关文档

→ [Skill 管理概述](../../docs/Skill管理/概述.md)
