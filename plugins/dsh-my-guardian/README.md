# dsh-my-guardian — 插件守护

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

**dsh-my-guardian**：DSH 插件隔离与失败兜底——新装/刚更新的插件先进候选区，启动完成后由守护插件逐个热挂载，成功自动转正、失败自动隔离、连续失败冻结，附一键安全模式与侧边栏诊断面板。

![插件守护面板：候选失败隔离 + 转正运行中 + 安全模式开关](https://unpkg.com/dsh-my-guardian/assets/panel-main.png)

![失败自动隔离：错误详情可查](https://unpkg.com/dsh-my-guardian/assets/panel-error-detail.png)

## 功能

- **两段式加载**：新插件先进候选区，坏插件不再拖垮 `dsh web` 启动（DSH 启动名册是 all-or-nothing，任一插件失败即整个进程起不来）。
- **失败自动隔离**：挂载失败记录尝试次数 + 失败类型 + 错误摘要，连续失败 **3 次冻结**，需手动重试。
- **挂载前依赖预检**：检查候选插件 `peerDependencies` 是否安装、版本是否满足；**硬缺失**与**版本不满足**分开成句、分开字段、分开徽标，不进入挂载。宿主提供的包（`@deepseek-ai/*`、`react`/`react-dom`）不给 `dsh plugin add` 建议（按提示执行会把宿主自有包装进 profile）。
- **成功自动转正**：挂载成功的插件进入持久化清单，后续启动自动恢复。
- **运行中热挂载**：运行期间往候选区加条目即自动挂载，无需重启。
- **安全模式**：一键跳过全部候选/已转正插件，快速救回被插件搞坏的环境。
- **诊断面板**：侧边栏「插件守护」页签（宿主原生扩展点）——状态列表 / 重试 / 移除 / 错误详情 / 失败分类徽标 / 安全模式开关 / 最近事件。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-my-guardian --trust-lockfile`——无需克隆本仓库；依赖 `dsh-shared` 随 npm 自动安装。link 方式供本仓库开发者使用。

```sh
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-guardian
```

装完**硬刷新浏览器**（Cmd/Ctrl+Shift+R）。手动安装：在 profile 的 `cordis.patch.yml` insert 列表**第一行**加 `id: guardian` / `name: 'dsh-my-guardian'`——守护插件自己是看门狗，必须最先加载。

## 使用

候选区文件 `~/.dsh/profiles/web/cordis.staged.json`（与 `cordis.patch.yml` 同目录），每项为 `{ id, name, config? }`：`id` 唯一标识、`name` 插件包名（profile 内可解析）、`config` 可选配置。

```json
[{ "id": "my-plugin", "name": "dsh-my-plugin", "config": { "option": 1 } }]
```

写入后自动挂载：成功则该条从候选文件移除（转正），失败则保留。面板状态：运行中（可移除）/ 待加载（安全模式等）/ 失败 ×N（重试或移除）/ 冻结（连续失败 3 次，重试解除冻结）。失败条目带失败类型徽标（依赖缺失 / 版本不满足 / 代码错误 / 其他），并在存在**可执行**的修复命令时附安装建议（宿主提供的包、含空格/管道的版本范围不给命令）。

**启动名册静态预检**：直接写进 `cordis.patch.yml` / profile / bundles 的插件仍由 DSH 启动时 all-or-nothing 加载，守护每次启动对名册做静态预检（包可解析、`peerDependencies` 满足、无重复 entry id），问题写入 `$DSH_HOME/guardian/startup-issues.json`（`type` 区分 `unresolvable` / `dependency-missing` / `dependency-mismatch` / `duplicate-id`，依赖字段分 `missingDeps` / `mismatchedDeps`）并在面板「最近事件」置顶展示；**预检只记录告警，不阻断启动**。

## 配置

**无应用层配置项**（插件激活即生效）。运行时状态：`$DSH_HOME/guardian/state.json` 持久化候选/转正清单、失败次数、安全模式与事件日志（损坏自动降级为空状态）；**安全模式**为面板开关，也可直接编辑 `state.json` 的 `safeMode: true`，开启后候选/已转正插件都不加载。

## 诚实的边界

- 提供的是**加载时序与失败处置的兜底隔离**，不是进程级资源隔离（server 端插件仍在同一 Node 进程，client 端仍在同一浏览器页面）。
- **启动阶段的正式核心区（`cordis.patch.yml`）仍遵循 all-or-nothing**：新插件请先进候选区验证，稳定后再考虑放核心区。

## 相关文档

→ [插件治理概述](../../docs/插件治理/概述.md)
