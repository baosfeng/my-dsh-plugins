# dsh-my-guardian — 插件守护

> DSH（DeepSeek Harness）插件隔离与失败兜底：**新装/刚更新的插件先进候选区，由守护插件在启动完成后逐个热挂载——成功自动转正，失败自动隔离记录，连续失败冻结，一键安全模式**，配套侧边栏诊断面板。

## 为什么需要

DSH 的 Cordis 插件加载是 **all-or-nothing**：启动时任何插件 `import` 失败 / `apply` 抛错 / 依赖缺失，整个 `dsh web` 都会起不来（fail-loud 退出）。装一个新插件把环境搞坏，是插件用户最常踩的坑。

本插件借鉴 VS Code（Extension Host 崩溃自动重启 + 禁用问题扩展）、IntelliJ（Dynamic Plugins 运行时装卸）、systemd（失败计数超限即停）的思路，利用 DSH loader 的**运行时动态挂载 API**（失败可捕获、可回滚），把"新插件"从启动路径挪到启动之后：

```
cordis.patch.yml（核心区：只放稳定插件，守护插件自身）
        ↓ 新插件写进
cordis.staged.json（候选区）
        ↓ DSH 启动完成后
守护插件逐个依赖预检 + 热挂载
        ├─ 成功 → 自动转正（进入持久化清单，每次启动自动恢复）
        └─ 失败 → 自动隔离（记录次数 + 失败类型/错误，连续 3 次冻结）
```

## 功能

- **两段式加载**：新装/更新插件先进候选区，启动不阻塞、坏插件不拖垮进程。
- **失败自动隔离**：挂载失败自动记录（尝试次数 + 失败类型 + 错误摘要），连续失败 **3 次冻结**，需手动重试。
- **挂载前依赖预检**：候选插件挂载前检查 `peerDependencies`——仓库内 `dsh-*` 依赖是否安装、官方依赖版本是否满足；缺失/不满足即标记「依赖缺失」并给出安装建议（如 `dsh plugin add <依赖>`），不进入挂载。
- **成功自动转正**：挂载成功的插件进入持久化清单（`$DSH_HOME/guardian/state.json`），后续每次启动自动恢复挂载。
- **安全模式**：一键跳过所有候选/已转正插件，快速恢复被插件搞坏的环境。
- **诊断面板**：dsh-better-sidebar 侧边栏"插件守护"页签——状态列表 / 重试 / 移除 / 错误详情 / 失败分类徽标 / 安全模式开关 / 最近事件。
- **运行中热挂载**：DSH 运行期间往候选区加条目，自动挂载，无需重启。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-my-guardian --trust-lockfile`——无需克隆本仓库；以下 link 方式供本仓库开发者使用。依赖 `dsh-shared`（server 端共享工具包）随 npm 自动安装，无需手动处理。

### 方式一：dsh plugin（推荐）

```sh
# 1) 克隆本仓库（任意目录）
git clone https://github.com/baosfeng/my-dsh-plugins.git
# 2) 以本地 link 方式安装（将 <仓库路径> 替换为上面的克隆目录）
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-guardian
```

装完**硬刷新浏览器**（Cmd/Ctrl+Shift+R）。

### 方式二：手动

1. 克隆本仓库后，在 `~/.dsh/profiles/web/package.json` 的 dependencies 增加 `"dsh-my-guardian": "link:<仓库路径>/plugins/dsh-my-guardian"`
2. `cd ~/.dsh/profiles/web && pnpm install`
3. 在 `~/.dsh/profiles/web/cordis.patch.yml` 的 insert 列表**第一行**加：

```yaml
- insert:
    - id: guardian
      name: 'dsh-my-guardian'
```

> ⚠️ **守护插件自身必须放在正式核心区第一行**（它自己是"看门狗"：启动时加载，随后才管理候选插件）。

## 使用

### 候选区文件

新建 `~/.dsh/profiles/web/cordis.staged.json`（与 `cordis.patch.yml` 同目录）：

```json
[{ "id": "my-plugin", "name": "dsh-my-plugin", "config": { "option": 1 } }]
```

- `id`：唯一标识（不能与现有插件行 id 冲突）
- `name`：插件包名（profile node_modules 中可解析）
- `config`：可选，插件的配置

写入文件后守护插件会自动挂载；挂载成功该条自动从候选文件移除（转正），失败则保留（状态记录在面板中可见）。

### 面板

侧边栏 → "插件守护"页签：

| 状态    | 含义                   | 操作                   |
| ------- | ---------------------- | ---------------------- |
| 运行中  | 已挂载                 | 移除                   |
| 待加载  | 尚未处理（安全模式等） | —                      |
| 失败 ×N | 挂载失败 N 次          | 重试 / 移除            |
| 冻结    | 连续失败 3 次          | 重试（解除冻结）/ 移除 |

失败条目额外带**失败类型徽标**（依赖缺失 / 代码错误 / 其他），依赖缺失时并展示安装建议命令（如 `dsh plugin add dsh-shared`）。

### 启动名册静态预检（issue #144）

候选区只兜住"走候选区"的插件；**直接写进启动名册（`cordis.patch.yml` / profile / bundles）的插件仍由 DSH 启动时 all-or-nothing 加载**。守护在每次启动时对名册做静态预检（不实际加载插件）：

- **包可解析**：名册中 `dsh-*` 插件的包必须在 profile node_modules 中存在
- **peerDependencies 满足**：复用候选挂载的依赖预检
- **无重复 entry id**：名册中同一 id 出现多次（加载时 `EntryGroup.update` 会抛 `duplicate loader entry id`）

发现的问题写入 `$DSH_HOME/guardian/startup-issues.json`（原子写，名册健康也写空报告 + 检查时间），面板「最近事件」顶部**置顶**展示启动区问题，每条给出修复命令（`dsh plugin add ...`）与移除提示。**预检失败不阻断启动**——只记录、只告警，最坏情况是为启动失败留下排查记录。

### 效果截图（真实 DSH 实例验证）

侧边栏"插件守护"诊断面板（独立 3081 端口隔离 DSH 实例实测）：

![插件守护面板：候选失败隔离 + 转正运行中 + 安全模式开关](https://unpkg.com/dsh-my-guardian/assets/panel-main.png)

![失败自动隔离：错误详情可查](https://unpkg.com/dsh-my-guardian/assets/panel-error-detail.png)

> 截图环境：隔离 DSH 验证实例（`/tmp/dsh-3085`，端口 3085）。候选区写入 `fake-needy`（peer 依赖 `fake-never-installed-dep` 缺失 → 依赖预检拦截，分类徽标「依赖缺失」+ 安装建议 `dsh plugin add fake-never-installed-dep` + 自动隔离冻结）与 `fake-simple`（无依赖 → 热挂载成功自动转正「运行中」）。

## 配置

**无应用层配置项**（`apply(ctx)` 不接收 config 参数，设置页无可视化配置入口；插件激活即生效）。运行时状态与开关：

- **状态文件**：`$DSH_HOME/guardian/state.json`（`~/.dsh/guardian/state.json`）——持久化候选/转正清单、失败次数、安全模式、事件日志。损坏自动降级为空状态，不影响启动。
- **安全模式**：面板开关（或直接编辑 `state.json` 的 `safeMode: true`）。开启后所有候选/已转正插件不再加载；恢复环境后关闭开关即重新加载。

## 诚实的边界

- 本插件提供的是**加载时序与失败处置的兜底隔离**，不是进程级资源隔离（server 端插件仍在同一 Node 进程，client 端仍在同一浏览器页面）。进程级隔离需要 DSH 框架支持 worker/子进程 + RPC（演进建议见 [docs/插件治理/概述.md](../../docs/插件治理/概述.md)）。
- **启动阶段的正式核心区（`cordis.patch.yml`）仍遵循 all-or-nothing**。请把一切新插件先放入候选区验证，稳定后再考虑放核心区。

## 依赖

| 依赖                 | 用途                                                                                                           | 可选           |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | -------------- |
| `cordis`             | 插件运行时                                                                                                     | 是（宿主提供） |
| `dsh-better-sidebar` | 侧边栏「插件守护」诊断面板（**可选增强，不参与依赖声明**：未安装时自动跳过面板注册，API / 候选区治理不受影响） | 否（可选增强） |
| `react`              | client 端组件                                                                                                  | 是（宿主提供） |
| `dsh-my-notify`      | 失败 / 冻结事件浏览器通知                                                                                      | 是             |

## 相关文档

→ [插件治理概述](../../docs/插件治理/概述.md) · [需求清单](../../docs/插件治理/需求清单.md)
