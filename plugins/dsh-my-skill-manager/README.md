# dsh-my-skill-manager

> DSH（DeepSeek Harness）Skill 管理插件：分「全局 / 项目」查看 skill 列表，按项目启用/禁用，支持手动刷新与扫描诊断。**禁用的 skill 不再注入该项目会话：模型不可见、不可加载。** 纯官方依赖（面板挂在官方设置页扩展点，不依赖第三方插件）。

[![npm](https://img.shields.io/npm/v/dsh-my-skill-manager)](https://www.npmjs.com/package/dsh-my-skill-manager)

![Skill 管理面板：全局 / 项目分区 + 启用/禁用开关](./assets/screenshot.png)

## 功能

- **Skill 列表（分「全局 / 项目」两维度显示）**：每个 skill 显示名称、描述、来源（`user-dsh` / `user-agents` / `custom` / `bundled` / `project-dsh` / `project-agents`）、状态（启用/已禁用）。**项目视角只显示该项目的 skill**（`project-dsh` / `project-agents`），全局 skill 只在全局视角查看。列表 = 官方 catalog + 目录扫描补充：目录中存在但官方 catalog 未收录的条目显示「未收录」徽标（host 层 filesystem 发现被官方禁用时，filesystem skills 均以此形式展示，列表与实际目录一致）。
- **按项目启用/禁用**：
  - 全局禁用：所有项目生效（配置存 `$DSH_HOME/skills.enabled.json`）；
  - 项目禁用：仅当前项目生效，**也可在项目内禁用全局 skill**（配置存 `<项目根>/.dsh/skills.enabled.json`，随仓库提交、可版本化）；
  - 禁用的 skill 在合并目录中被「已禁用」占位覆盖（rank-0 provider），模型侧不可见、`get()` 拒绝加载正文。
- **手动刷新**：新建 skill 后点「刷新」立即可见（`GET /my-skill-manager/api/rescan` 失效官方目录缓存后重扫），无需重启。
- **扫描诊断**：目录中 frontmatter 异常 / 符号链接异常的条目（缺 SKILL.md、缺 name/description、非法名字等）在面板「扫描诊断」区块显示缺失名单 + 原因。
- **设置页面板**：设置 → 插件 → 「Skill 管理」页签（官方 slots 扩展点，无需 dsh-better-sidebar）。

## 安装

```bash
# npm 安装（推荐）
dsh plugin --profile web add dsh-my-skill-manager --trust-lockfile

# 或从本仓库 link 安装
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-skill-manager
```

## 使用

1. 打开 DSH Web 设置 → 插件 → **Skill 管理**；
2. 「全局」区块：切换任意 skill 的全局启用/禁用；
3. 在顶部输入**项目根路径**后点「加载」，即进入该项目视角——**只显示该项目的 skill**，可切换该项目内的启用/禁用（含全局 skill 的项目内禁用）；
4. 新建 skill 后点「刷新」立即可见；若出现「扫描诊断」区块，说明有 skill 目录条目未被收录（如符号链接异常、frontmatter 缺失），按提示修复后刷新即可；
5. 修改即时生效（catalog 自动失效重算），无需重启。

## 配置格式

```jsonc
// <项目根>/.dsh/skills.enabled.json 或 $DSH_HOME/skills.enabled.json
{
  "global": { "disabled": ["some-global-skill"] },
  "project": { "disabled": ["web-search"] },
}
```

- `global.disabled`：全局禁用（所有项目生效）；
- `project.disabled`：当前项目禁用（可禁用项目级与全局级 skill）。

## 实现要点

- **禁用机制**：向 `ctx.skills` 注册 rank-0 占位 provider（全局层）。官方 filesystem provider 的 rank 为 100–500、runtime 为 250，同层合并时 rank 0 占位优先——被禁用名字的真实 skill 不再进入模型目录；`list()` 按会话 `cwd` 解析项目配置，实现「项目覆盖全局」。
- **配置变化即时生效**：保存后调用 `control.invalidate()` 使 skill 目录缓存失效重算。

## 开发

TypeScript 源码在 `src/`（server 端 `src/*.ts` + client 端 `src/client/parts/*.ts`），
编译产物 `lib/*.js` / `lib/client.js` 必须提交（CI 只跑 `node --check` + 测试，不跑构建）。

```bash
npm run build      # tsc 编译 src/ + 拼接 client parts → lib/（产物需提交）
npm run typecheck  # tsc --noEmit（server + client 两套配置）
npm test           # vitest（server + client 渲染路径）
```

## 相关文档

→ [Skill 管理概述](../../docs/Skill管理/概述.md) · [需求清单](../../docs/Skill管理/需求清单.md)
