---
name: development-lifecycle
description: 使用当 要把一个需求/想法在本仓库（my-dsh-plugins）真正做出来时——需求登记 → 确认与拆解 → TDD 开发 → 验证 → 提交 → 发版 → 文档 → 收尾的端到端流程编排与门禁把关。触发场景："实现 issue #N""开发/实现这个功能""改一下 <插件>""这个需求怎么落地""下一步该干什么""准备发版"。本 skill 只负责阶段编排、门禁与"该找谁"（owner skill），不重复各阶段细节。
---

# 需求 → 发版全流程（development-lifecycle）

本 skill 是**流程控制器**：判断当前处在哪个阶段、该跑什么命令、过什么门禁、细节找哪个 owner skill。加载它之后按阶段加载对应 skill，**不把别人的规则抄一遍**。

> 适用：本仓库功能开发与插件改动的主线（想法 → release）。跨多个插件/宿主的编排用 `plugin-workflow`（阶段账本 + 确认边界），DSH 宿主版本迁移用 `skills/plugin-upgrade/` + `skills/dsh-upgrade-audit/`。

## 阶段总览

| #   | 阶段       | 关键动作                                           | Owner skill / 依据                                                                                     | 出阶段门禁                                          |
| --- | ---------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 0   | 需求登记   | 口头想法 → 规范 issue（背景/方案/验收）            | `dsh-issue-request`                                                                                    | 有 issue 编号 + 可勾选验收标准                      |
| 1   | 确认与拆解 | 定位模块与需求清单、定验收标准、定影响面、拆子任务 | 本 skill + `dsh-plugin-development`                                                                    | 需求清单有条目；影响面（改哪些插件/文档）清楚       |
| 2   | 开发       | 先写失败测试（RED）→ 最简实现（GREEN）→ 重构       | `.reasonix/skills/testing-standards` · `coding-standards` · `quality-gates` · `dsh-plugin-development` | RED 记录可见 + `cd plugins/<name> && npm test` 全绿 |
| 3   | 验证       | 选测试层级 → 全量校验 → 隔离实例 + 真实浏览器/模型 | `plugin-test` + `verifying-dsh-plugins`                                                                | 需求清单逐条回归 + 功能级验证清单可勾选             |
| 4   | 提交       | 提交信息规范 + 提交前本地校验                      | `.reasonix/skills/commit-standards`                                                                    | `node scripts/verify-local.mjs --fast` 通过         |
| 5   | 发版       | bump + CHANGELOG + 门禁 + tag/Release/npm          | `skills/plugin-release/` + `node scripts/release.mjs`                                                  | #67 功能级清单 `verification/<插件>-<版本>.md` 全勾 |
| 6   | 文档       | README / docs 索引 / 需求清单 / CHANGELOG 同步     | `docs/开发指南/文档规范.md`                                                                            | `node scripts/check-docs.mjs` 退出 0                |
| 7   | 收尾       | 清理验证残留 + 本地实例生效 + 汇报证据             | `verifying-dsh-plugins`（步骤 4）                                                                      | 无残留进程/目录/端口；`job_list` 无 running         |

## 0. 需求登记（dsh-issue-request）

- **先有 issue 再动手**：用 `dsh-issue-request` 把想法整理成 `[需求]` issue 提交到 `baosfeng/my-dsh-plugins`；issue 的「验收」段就是阶段 1 的验收标准来源。已在 issue 列表里的（如"实现 #67"）跳过登记。
- 目标仓库不是本仓库（例如给 `deepseek-ai/deepseek-harness` 提建议）→ 不走本条，先确认对方仓库惯例。

## 1. 确认与拆解

1. **找模块与需求清单**：`docs/<模块>/需求清单.md`（条目编号 R1/R2/…，注明验证方式）。不存在则先建——它是本插件的**开发回归基准**，规则见 `dsh-plugin-development`「需求清单（强制）」。
2. **确认范围**：本次涉及哪些需求条目、可能连带影响哪些**易碎需求**（重启恢复 / 会话隔离 / 持久化不丢 / 数据不串）——易碎项必须有专门测试断言。
3. **定影响面**：改动在 `plugins/<name>/**`（只跑该插件与依赖方）还是 `plugins/dsh-shared/**`、`scripts/**`（安全退化为全量）——裁剪规则见 `docs/开发指南/构建与测试.md`「`--fast` 的范围裁剪规则」。
4. **拆解与派发**：可独立任务（开发/修复/验证/排查/文档）优先派子 agent，并行上限 3；失败用 `send_message` 续接原 agent（`AGENTS.md` 协作原则 4–6）。
5. **只有架构级 / 破坏性 / 公开 API 变更**才事前问用户，且问一次就够；其余自主决策（原则 1）。

## 2. 开发

| 事项                                                         | 找谁 / 命令                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 插件形态、目录结构、client bundle 格式、命名规范             | `dsh-plugin-development`（仓库内插件）· `plugin-write`（外部插件/命名注册表）            |
| TDD：先写失败测试，亲眼看到 RED 再写实现                     | `.reasonix/skills/testing-standards/SKILL.md`                                            |
| 交付质量门禁（覆盖率/复杂度/大小/依赖/变异/防复发/真实环境） | `quality-gates` skill + `.reasonix/skills/quality-gates/SKILL.md`（阈值以该 skill 为准） |
| 编码、注释、异常处理                                         | `.reasonix/skills/coding-standards/SKILL.md`                                             |
| 工程原则、错误日志规范、发布检查清单                         | `.reasonix/skills/engineering-standards/SKILL.md`                                        |
| 持久化 / 事件监听 / 轮询 / 后台任务                          | `skills/resource-budget-review/`（五维资源预算未评估不得声称完成）                       |
| 单点测试                                                     | `cd plugins/<name> && npm test`                                                          |

- **没有失败测试，就不写一行生产代码**；新增功能必须在需求清单补条目 + 补测试（禁止只改代码不补测试）。
- 命令一律设超时：快速命令 ≤15s，长任务后台跑（`AGENTS.md` 强制规则）。

## 3. 验证

```bash
cd plugins/<name> && npm test                  # 单插件冒烟（CI 同款）
node scripts/verify-local.mjs --fast           # 提交/push 前快速通道（pre-push 同款，按变更裁剪）
npm run verify                                 # CI 等价全量（= --full，默认 11 项检查）
node scripts/verify-real-profile.mjs --addons plugins/<name> [--api-path /<插件>/api/xxx]
node scripts/verify-real-profile.mjs --skip    # 只做配置组合检查（不启动实例，快）
```

- **选最小充分层级**：`plugin-test` skill（单测 / 覆盖率 / 真实 API e2e / 快照 / Web / 真实组合 / 打包产物冒烟）。
- **真实环境（issue #39）**：`verify-real-profile.mjs` 复刻生产配置组合 + 独立端口启动 + API 冒烟 + 自动清理；`duplicate loader entry id` 这类炸弹只在这一层暴露，全新实例测不出。
- **功能级（issue #67）**：发版前必须在隔离实例 + 真实浏览器（或真实模型调用）里把核心功能完整走通一次 → `verifying-dsh-plugins`（起实例、fetch 探针对照组/实验组、client UI 验收、清理）。
- **需求回归（强制）**：对照 `docs/<模块>/需求清单.md` 逐条验证（跑测试 + 手动验证受影响条目），确认无回归才能提交。

## 4. 提交

- 信息格式 `<type>(<scope>): <描述>`、type 分类、一次提交一个功能 → `.reasonix/skills/commit-standards/SKILL.md`。
- 提交前：`node scripts/verify-local.mjs --fast`（要 CI 等价用 `npm run verify`）；`pre-commit` 由 lint-staged 增量跑 `eslint --fix` + `prettier --write`。
- 提交/推送由 leader 自主决策（`AGENTS.md` 强制规则）；**流程执行者不擅自 commit/push**，除非被明确要求。

## 5. 发版

```bash
node scripts/release.mjs <插件名> --bump patch --push    # bump + CHANGELOG + 同步文档 + tag + push
node scripts/release.mjs <插件名> --bump patch           # dry-run（不带 --push 只校验不提交）
node scripts/release.mjs a b --bump patch --push         # 批量（统一 bump，独立校验、一次提交、顺序打 tag）
node scripts/verify-real-profile.mjs --check verification/<插件>-<版本>.md   # 单独校验功能级清单
```

`release.mjs` 门禁（任一失败即阻断）：

| 门禁            | 内容                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| 测试            | 逐插件 `npm test`                                                                                              |
| 依赖            | `peerDependencies.cordis` 已声明；跨插件依赖已声明 + 已发布 + 已打 tag（**依赖先发版、依赖方后发版**）         |
| 截图            | README 引用的效果图真实存在（UI 变更必须重新截图）                                                             |
| CHANGELOG       | 有当前版本段                                                                                                   |
| 真实环境（#39） | 自动跑 `verify-real-profile.mjs --addons`，失败阻断                                                            |
| 功能级（#67）   | 校验 `verification/<插件>-<版本>.md` 的核心功能 / 易碎场景 / client UI / 插件联动 / 环境清理全部勾选，缺一阻断 |

- ⚠️ **清单文件名版本 = bump 后的 next 版本**（当前 `package.json` 版本 +1）；手动预验证时 `--version` 必须对齐，否则已勾选项读不到。
- 跳过真实环境验证必须写理由：`--skip-real-verify --skip-reason "<理由>"`（无理由 exit 1）。
- semver 语义、发布通道、踩坑 → `docs/开发指南/发版流程.md`；发布轨选择、打包、语义门禁、回滚 → `skills/plugin-release/SKILL.md`。
- 新功能 / 新插件推荐加**盲测子 agent**（不了解实现的独立上下文）以真实用户视角验收。

## 6. 文档

| 对象          | 要求                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 位置与语言    | 统一放 `docs/` 下，目录与文件名、内容全中文（`docs/开发指南/文档规范.md`）                                               |
| 一致性强校验  | `node scripts/check-docs.mjs`：根 README 插件表版本 = `package.json`；`docs/索引.md` 有条目；插件 README 有 npm 安装章节 |
| 需求清单      | 新需求补条目（含验证方式），易碎需求标注专门断言                                                                         |
| CHANGELOG     | `--bump` 自动生成，可事后补详情                                                                                          |
| README / 截图 | 功能或 UI 变化必须同步截图，与代码一起提交、一起发版                                                                     |
| AGENTS.md     | 只放入口与强制规则且 ≤50 行，细节写 skill/docs（文档规范「AGENTS.md 规范」）                                             |
| 踩坑          | 新踩的坑写 `docs/踩坑/`；踩坑记录若当前无测试覆盖 = 回归风险，应补复现测试                                               |

## 7. 收尾

- **清理验证残留（强制）**：停隔离实例 → 删 `/tmp/dsh-verify-*` → 复查目录/进程/端口 → 关验证浏览器；四步命令见 `verifying-dsh-plugins`「步骤 4：收尾清理」。多 agent 并行时残留会互相干扰。
- **发版 ≠ 交付完成**：重启本机 `dsh web` 让新版本生效，并亲自冒烟（配置组合无重复 / HTTP 200 / 启动日志无 error / 变更插件 API 200 / GUI 入口可见）——见 `docs/开发指南/构建与测试.md`「发布后本地更新与验证」。
- **汇报留证据**：命令与退出码、验证清单路径、未验证项与环境限制（没跑过的不要写成通过）。

## 情形速查

| 情形                                  | 去处                                                   |
| ------------------------------------- | ------------------------------------------------------ |
| 只是登记想法/需求                     | `dsh-issue-request`                                    |
| 修 BUG / 安全告警 / CI 失败 / PR 健康 | `dsh-github-triage`（`[需求]` 类 issue 不走它）        |
| 新建插件（形态 / 命名 / 骨架）        | `dsh-plugin-development` + `plugin-write`              |
| 不知道该跑哪个测试层级                | `plugin-test`                                          |
| 要真实浏览器 / 真实模型证明           | `verifying-dsh-plugins`                                |
| 多插件串起来跑（含升级 / 回滚）       | `plugin-workflow`                                      |
| 发版 / 打包 / 发布轨                  | `skills/plugin-release/` + `docs/开发指南/发版流程.md` |
| 升级 DSH 宿主版本                     | `skills/plugin-upgrade/` + `skills/dsh-upgrade-audit/` |

## 反模式

| 反模式                                   | 后果 / 正确做法                                        |
| ---------------------------------------- | ------------------------------------------------------ |
| 没 issue、没需求清单就开写               | 无法验收、无回归基准 → 先走阶段 0/1                    |
| 只跑单测就说"功能可用"                   | 真实环境门禁不过 → 隔离实例 + 浏览器/真实模型验证      |
| 覆盖率达标就以为测住了                   | 变异分数不过 = 测试无效 → 两项都要过                   |
| 功能级清单留空、或用错版本号文件名就发版 | `release.mjs` 3c 阻断 → 按 bump 后版本对齐文件名并勾选 |
| 发版后不重启 `dsh web` 就汇报"已交付"    | `link:` 安装不重启不生效                               |
| 验证残留不清理                           | 干扰并行开发与其他 agent 的验证                        |
| 在本 skill 里重抄 owner skill 的细节     | 双份规则必然漂移 → 只写"门禁 + 找谁"                   |

## 参考

| 文件 / skill                                                                                     | 内容                                     |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `AGENTS.md`                                                                                      | 协作与项目管理原则、强制规则、入口       |
| `skills/dsh-issue-request/SKILL.md`                                                              | 需求登记（issue 模板、防重复、验收标准） |
| `skills/dsh-plugin-development/SKILL.md`                                                         | 插件形态/目录结构/需求清单/开发流程      |
| `skills/plugin-test/SKILL.md`                                                                    | 测试层级选择                             |
| `skills/verifying-dsh-plugins/SKILL.md`                                                          | #67 功能级验证与收尾清理                 |
| `skills/plugin-release/SKILL.md`                                                                 | 发布轨、打包、语义门禁、回滚             |
| `skills/plugin-workflow/SKILL.md`                                                                | 多阶段编排与阶段账本                     |
| `.reasonix/skills/quality-gates/SKILL.md`                                                        | 交付质量门禁（强制）                     |
| `.reasonix/skills/testing-standards/SKILL.md`                                                    | TDD Red→Green→Refactor                   |
| `.reasonix/skills/commit-standards/SKILL.md`                                                     | 提交信息格式与确认流程                   |
| `.reasonix/skills/coding-standards/SKILL.md` · `.reasonix/skills/engineering-standards/SKILL.md` | 代码规范 · 工程规范                      |
| `docs/开发指南/构建与测试.md`                                                                    | verify-local、真实环境验证、需求回归     |
| `docs/开发指南/发版流程.md`                                                                      | semver、发布通道、踩坑                   |
| `docs/开发指南/文档规范.md`                                                                      | 文档与 AGENTS.md 规范                    |
| `docs/踩坑/README.md`                                                                            | 已知踩坑（防复发输入）                   |
