---
name: verifying-dsh-plugins
description: 使用当 需要做 DSH 插件的发版前功能级验证（issue #67 门禁：隔离实例 + 真实浏览器/真实模型调用），或要复现并证明"只在真实网关、真实事件流、真实浏览器下出现"的问题时。覆盖独立 DSH_HOME 起隔离实例、fetch 探针做对照组/实验组取证、client UI 与插件联动验收、verification/<插件>-<版本>.md 清单勾选，以及验证后清理环境（防残留污染）。
---

# 发版前功能级验证（verifying-dsh-plugins）

启动成功 ≠ 功能可用。本 skill 是发版门禁的执行手册：**功能级项必须在隔离实例 + 真实浏览器/真实模型中验证**，勾选 `verification/<插件>-<版本>.md` 才能发版。

## 何时必须做

| 场景                                                    | 要求                                                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 发版（`node scripts/release.mjs <插件名>`，含 dry-run） | release.mjs 3c 强制：自动验证通过后校验功能级清单全勾选，未全勾选**阻断发版**（跳过须 `--skip-real-verify --skip-reason "<理由>"`）                                             |
| 修复"只在真实环境出现"的问题                            | 对照组复现 + 实验组证明修复，两者缺一不可                                                                                                                                       |
| UI / 交互 / 截图变更                                    | 真实浏览器走通 + 重新截图（release.mjs 3b 校验 README 引用的截图存在）。确无用户可见 UI 的插件按 `package.json` 的 `dsh.ui=false` + `dsh.uiReason` 显式豁免，并在发版输出中可见 |
| 插件联动/生命周期相关改动                               | 隔离实例（复用生产配置组合）+ 相邻插件共存验证                                                                                                                                  |

## 门禁机制（release.mjs 3c 实际做什么）

```bash
# 3c 内部执行（bump 后自动跑）：
node scripts/verify-real-profile.mjs --addons plugins/<name> --port <空闲端口> \
  --checklist verification/<name>-<version>.md --plugin <name> --version <version>
# 再执行门禁校验：功能级项必须全部 [x]，否则 exit 1
node scripts/verify-real-profile.mjs --check verification/<name>-<version>.md
```

- **版本约定**：清单文件名里的版本 = bump 后的 next 版本（当前 package.json 版本 +1）。手动预验证时 `--version` 必须与之一致，文件名对不上会被当成新清单重新生成（已勾选状态丢失 → 阻断）。
- 自动项 **4 条**（配置组合唯一性 + **待验插件处于启用态** / 实例就绪 / 日志无 error / 插件 API 冒烟）由脚本勾选；**功能级 5 条由验证者勾选**。API 断言**不在这里**——它需要浏览器会话，见 [references/isolation-instance.md](references/isolation-instance.md) 的 `--api-path` 说明。
- **禁用位不得骗过门禁**：`--addons` 的插件必须在组合配置里**处于启用态**。`disabled: true` 的行虽然出现在 `dump-config` 输出里，插件却被加载而不运行（client bundle 不进 manifest、页签不出现、API 404）——只看"插件行在不在"就是假通过。禁用位来自 `<profile>/cordis.patch.yml`（与 `.dsh-market/state.json` 是**两处独立来源**，脚本只剥离后者）；判失败后按 [references/isolation-instance.md](references/isolation-instance.md)「正确做法」**在隔离副本内去掉 `disabled`，生产配置不动**。判据只针对本次 `--addons` 的插件，dump 里别的插件被故意禁用不受影响。
- **重跑清单是幂等的（放心重跑）**：目标清单已存在时**绝不整文件重写**——头部「验证时间 / 验证环境」保持原值（换端口重跑**零 diff**）、人工追加的 `## 验证记录` 段**逐字节保留**、已勾选状态原样留存；脚本只刷新自己拥有的「自动验证项」。确需把本轮环境写进头部时加 `--refresh-header`。
- **崩溃必须 fail-closed**：实例"就绪"的判据是三条同时满足——端口有 HTTP 响应 **+** 日志出现正向就绪行（`dsh web: http://127.0.0.1:<port>/?token=…`）**+** 进程仍存活；并全程扫描致命启动特征（`plugin tree failed to load` / `failed to apply|import loader entry` / `without inject` / `cannot get property` / `missed the module table` / `duplicate loader entry`）。命中即 `exit 1`，输出**崩溃栈关键行 + 隔离实例日志路径**。
  ⚠️ 为什么这么严：`dsh web` **先监听端口、后加载插件树**——插件 `apply` 崩掉时端口已经能回 HTTP，只看端口就会把「实例整个起不来」误报成「✓ 就绪 / ✓ 日志无 error」（这类误报就是这么潜伏到用户侧的）。**看到 `✓ 就绪` 不再等于实例活着**。
- **真实模型调用开箱可用，凭据不落盘**：脚本启动前从 `dump-config` 提取每个 provider route 的 `apiKeyEnv` 引用名，逐个确认来源（启动环境变量 > 生产 `<DSH_HOME>/.credentials.yaml` 的 `refs:`）；**缺字段即 fail-closed**，点名字段 / route / entry 与补法，不再等到调用阶段抛 `MISSING_CREDENTIAL`（那是**验证环境**问题，绝不是插件缺陷）。有来源的凭据只经**子进程环境变量**注入（宿主里 inherited environment 优先级最高），不落盘、不进日志、隔离 `DSH_HOME` 里不写 `.credentials.yaml`；`settings.yaml` 只继承 `llm-*` 与 `agent-default-model` 段，出现明文密钥即拒绝（细节见 [references/isolation-instance.md](references/isolation-instance.md)）。要一次真实调用加 `--probe-llm "<task>"`（同一 `DSH_HOME` + 同一注入环境，断言输出非空）。
- 非 bundle 插件（agent preset 等）按自身安装方式验证，手写同格式清单并注明验证方式。

## 五个步骤（细节见 references/）

| 步骤 | 做什么                                                                                                                                                                                  | 细节                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1    | **起隔离实例**：独立 `DSH_HOME` + 独立端口；**预置工作区**（没有工作区 = 合成器禁用，点选工作区会弹 macOS 原生对话框把 agent 卡死）；web 实例（浏览器验证）或 headless 实例（真实模型） | [references/isolation-instance.md](references/isolation-instance.md) |
| 2    | **真实模型调用**：`NODE_OPTIONS=--import` fetch 探针，**对照组（无插件）+ 实验组（有插件）** 都要跑并留 JSONL 证据                                                                      | [references/verification-steps.md](references/verification-steps.md) |
| 3    | **浏览器验证**：独立端口 + 真实浏览器走通核心功能（不是"页面能打开"），截图留档                                                                                                         | 同上                                                                 |
| 4    | **收尾清理（强制）**：停实例 / 删隔离目录 / 复查无残留进程、无遗留的原生对话框进程；**只动自己起的端口与目录**                                                                          | 同上                                                                 |
| 5    | **报告留档**：功能级项打勾 + 在 `## 验证记录` 写证据（命令输出、探针 JSONL、未验证项与环境限制）                                                                                        | 同上                                                                 |

**三条最容易踩的**：① 绝不碰主实例（3080），验证全在隔离实例里做；② 先确认 `realpath` 指向的是待验工作区而非主工作区旧版（否则假通过/假失败）；③ 涉及 GUI 时不要把「需要人点原生对话框」的步骤留给无人值守的 agent。

## 参考

| 文件                                                                 | 内容                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [references/isolation-instance.md](references/isolation-instance.md) | 步骤 1 全文：端口/两处禁用来源与副本内去 disabled/工作区预置/realpath 前置检查/web 与 headless |
| [references/verification-steps.md](references/verification-steps.md) | 步骤 2–5 全文：探针、浏览器验收表、清理复查、报告结构                   |
| [scripts/fetch-probe.mjs](scripts/fetch-probe.mjs)                   | `NODE_OPTIONS=--import` fetch 探针（JSONL 记录会话头/鉴权头）           |
| `scripts/verify-real-profile.mjs`                                    | 隔离实例 + 配置组合检查 + 凭据自检/注入 + 真实调用探针 + 清单生成/校验（release.mjs 3c 调用） |
| `docs/开发指南/构建与测试.md`                                        | 功能级验证门禁说明与清单版本约定                                        |
| `skills/plugin-test/SKILL.md`                                        | 测试层级选择（本 skill 负责真实环境那一层）                             |
