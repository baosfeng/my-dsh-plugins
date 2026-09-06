---
name: plugin-workflow
description: 使用当 需要协调 DSH 插件完整生命周期（检查/宿主兼容升级/测试/命名与注册表检查/打包/发布/回滚），或用户想要一个引导式工作流、询问可运行哪些插件能力、需要多个 DSH 插件 skill 串联并统一状态报告时。默认只读发现；仓库写入、依赖/运行时执行、外部发布前分别确认。
---

# 协调 DSH 插件生命周期（plugin-workflow）

作为工作流控制器：让用户先选结果与可选证明，再把每个选中阶段路由到其 owner skill，维护一张阶段账本，最后返回一份有证据支撑的报告。不把 owner skill 的详细规则复制进本 skill。

## 先展示预运行菜单

用户未明确选择工作流时，先展示下方工作流与能力表再运行任何阶段。用用户语言，把 `health-check` 标为推荐首选项，等用户选择。推荐不是选择：不静默默认 `health-check`、不开始发现、不执行任何能力。

接受工作流编号/ID/无歧义的自然语言结果；允许同一回复增删能力（如 `3 + docker-smoke + browser-check`）。简要说明哪些选中能力只读、哪些将跨越确认边界。

捆绑规划器渲染同一确定性菜单且保持只读：

```sh
node <plugin-workflow-skill>/scripts/plan-workflow.mjs            # 菜单
node <plugin-workflow-skill>/scripts/plan-workflow.mjs --workflow compatibility-migration --include registry-query --exclude browser-check --surface ordinary-plugin
```

用户已选结果且上下文足够时，保留选择继续，不再展示菜单。

## 只读发现

只检查让选择具体化的最少上下文：

1. 读仓库规则（AGENTS.md 等）并检查 git 状态（不修改）。
2. 识别目标是 DSH monorepo / 外部插件源码仓 / 已装插件 / 打包产物。
3. 记录插件来源身份、当前 DSH 版本、请求目标版本、包管理器、可用脚本、插件面、既有命名声明。
4. 缺失输入标 `unknown`。发现期间不装依赖、不跑包脚本、不起容器、不改文件、不查远程注册表。

## 选择工作流

| 工作流 | 结果 | 默认阶段 |
|---|---|---|
| `health-check` | 只读插件与升级风险报告 | 发现、可选 DSH 审计、七触点扫描 |
| `upgrade-target` | 把已装插件升级到明确版本 | 发现、升级、静态检查、回滚记录 |
| `compatibility-migration` | 把插件源码适配到精确 DSH 目标 | 发现、DSH 审计、七触点迁移、静态与运行时测试 |
| `test-only` | 验证现有源码树或产物 | 发现、所选测试层级、报告 |
| `naming-registry` | 校验标识符并可选查/注册云 ID | 发现、离线命名、注册表查询、可选注册 |
| `package-release` | 准备并可选发布 | 发现、必需测试门禁、打包、消费冒烟、可选发布 |
| `full-lifecycle` | 迁移、验证、命名、打包、可选发布 | 按依赖顺序全部适用阶段 |

能力表（用户可选增删；推荐最小集证明其目标）：

| 能力 | 默认 |
|---|---|
| DSH 版本兼容性审计 `dsh-audit` | 兼容迁移开，否则关 |
| 七触点插件扫描 `touchpoint-scan` | 健康检查与迁移开 |
| 类型检查/单测/构建 `static-tests` | 源码变更后、打包前开 |
| 精确版本 Docker 冷启动 `docker-smoke` | 迁移与发布候选开（Docker 可用时） |
| 一条真实功能路径 `functional-probe` | 迁移与发布开 |
| 浏览器验证 `browser-check` | 仅 Web Client/UI 面开 |
| 离线命名声明校验 `naming-local` | 新外部插件开，否则可选 |
| 中央注册表查询 `registry-query` | 关，选中才开；只读 |
| 中央 ID 注册 `registry-register` | 关；需审阅的外部发布 |
| 回滚演练/配方 `rollback` | 每个写工作流配方开；演练可选 |
| 打包并检查产物 `package-artifact` | 打包/发布/全生命周期开 |
| 发布产物或 release `release` | 关，除非外部发布意图明确 |

`registry-query` 不是预留；`registry-register` 不是本地插件使用的前提。本地插件与中央注册表可共享显示名；只有同一运行时面上的具体标识符才可能冲突。

## 建阶段账本

执行前为每个选中或依赖必需的阶段建一行：

| 阶段 | 能力 | Owner | 状态 | 证据或阻塞原因 |
|---|---|---|---|---|
| `P01` | discovery | `plugin-workflow` | `selected` | 目标与来源身份 |

状态只允许：`selected`（已选未完成）/ `completed`（完成且有证据）/ `blocked`（尝试过但无法继续）/ `skipped`（适用但明确不跑）/ `not_applicable`（与检测到的插件面或工作流无关）。

**绝不把不可用或未选中的检查标成 completed**。阶段阻塞时，依赖它的阶段标 `blocked`/`skipped` 并注明依赖原因，只继续独立且已授权的阶段。

## 路由每个阶段到 owner

执行阶段前加载并遵循其 owner skill；owner 不可用时标 `blocked`，不凭记忆重建其实现。

| 阶段 | Owner skill | 边界 |
|---|---|---|
| 已装更新或源码兼容迁移 | `plugin-upgrade` | 先 inspect；配置/依赖/源码变更前确认 |
| 新插件代码或离线命名声明 | `plugin-write` | 遵循精确目标 Harness 契约 |
| 静态/运行时/Docker/功能/浏览器验证 | `plugin-test` | 选最小充分层级并保留证据 |
| 打包/发布门禁/发布/回滚 | `plugin-release` | 发布单独确认 |
| DSH 宿主版本间证据 | `dsh-upgrade-audit` | 生成证据与插件源码变更分开 |

按依赖顺序跑：发现与来源身份 → DSH 审计（选中时）→ 升级或实现变更 → 离线命名与可选注册表查询 → 静态测试 → Docker/功能/浏览器证明 → 发布准备与产物检查 → 外部注册或发布。未选阶段跳过，除非 owner skill 将其设为后续选中阶段的硬门禁（此时加入账本、说明原因、取得确认再跑）。

## 三个确认边界（分别确认）

按边界分组计划动作，**一个边界的批准不能当作另一个的批准**：

1. **仓库写入**：改源码/配置/清单/锁文件前，展示确切文件、改动内容与回滚范围。
2. **依赖与运行时执行**：安装/生命周期脚本/容器/服务/浏览器/凭据/预期产物前，展示包管理器命令与风险（只读 git/文件检查无需确认）。
3. **外部发布**：推提交/tag、开注册表 PR、发 npm 产物、改 hub/collection 前，展示确切目标与载荷，单独确认。

阶段跨多个边界时，每个边界在可执行时分别确认。绝不仅为完成阶段而请求或暴露 secrets。

## 维护与报告证据

每个阶段后更新账本（含失败与显式跳过）。保留精确版本、来源 SHA、命令、退出码、报告路径、未覆盖边界。结束前核验每个选中能力都有终态。

返回一份报告：① 工作流与能力选择；② 来源与目标身份；③ 最终阶段账本；④ 改动与提交；⑤ 测试与注册表证据；⑥ 阻塞/跳过/未验证边界；⑦ 仅限本工作流拥有路径的回滚说明；⑧ 发布状态（明确区分本地验证 / 无已审注册表匹配 / 已审注册 / 已发布产物）。

不把部分冷启动总结为功能兼容、注册表无匹配总结为 ID 预留、已备产物总结为已发布。

## 参考材料

| 文件 | 内容 |
|---|---|
| [references/workflow-selection.schema.json](references/workflow-selection.schema.json) | 规划器输入 JSON Schema |
| [scripts/plan-workflow.mjs](scripts/plan-workflow.mjs) | 只读规划器（菜单/校验冲突/依赖/阶段 ID/确认边界） |
