# 派发与成本观测落地（dsh-github-triage references）

> 承接 [../SKILL.md](../SKILL.md) 的「第二步：派发子 agent」。
> **通用 leader 规则（派发 / 并行 / 验收 / 汇报）唯一权威 = 全局 `leader-ops` skill**——本仓库不复制、不另立；本文件只写本仓库专属落地。
> 通用规范看全局 `leader-ops`：**§四** = 派发 prompt 必含七项（身份 / 范围 / 已确认事实 / 验收标准 / 预算 / 停止条件 / 回报格式）与步数-上下文预算；**§五** = 验收（标准先冻结、结论归 leader、抽检 1~2 条、取证可派发、外发动作归原 owner）。本文件只留两件本仓库专属的事：**成本观测口径**、**按问题类型的达标条件**。

## 一、成本观测口径（本仓库实测）

- **落盘位置**：`~/.dsh/sessions/<cwd 转义>/<session-id>/session.v3.jsonl.zstd`；用 `zstd -d -c` 解压后读 `assistant/message` 事件的 `usage`（`inputTokens` / `cacheReadTokens` / `outputTokens`）。
- **必须递归子会话**：子 agent 是**独立会话文件**，成本要从 `subagent/catalog` 的 `childId` 递归统计，否则严重低估（实测 leader 自身与全部子 agent 相差 17 倍）。
- **一条命令**：`node scripts/agent-cost.mjs`——扫同目录下全部会话文件并自动递归子会话，无需手工翻目录；**退出码 1 = 有超限会话**。
- **每完成一个子 agent 就重测一次**：并行时成本会在无观测状态下翻倍；看到退出码 1 立刻 `send_message` 要它固化成果（commit + push + PR）并如实回报卡点。
- 超限档位（leader 与子 agent 不同档）与收尾口径以全局 `leader-ops` §四「预算」为准。

## 二、按问题类型判定「已完成」

| 问题类型           | 达标条件                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| issue（BUG）       | 根因确认 + 修复代码 + `cd plugins/<name> && npm test` 通过 + 已建 PR；一个 PR 只覆盖这一个 issue                                                                                                                                                                                                                                                            |
| 安全告警           | 依赖 / 代码已修复，升级前查上游 CHANGELOG / breaking changes 确认兼容；测试通过；已建 PR；无修复版本时给出原因与建议并评论到对应告警 issue。**Dependabot 类必须附已关闭告警复查证据**：`check-dependabot-closed.sh` 输出 + 退出码由 1 变 0                                                                                                                   |
| Actions 失败       | 先 `ghops pr checks baosfeng/my-dsh-plugins <PR 编号>` 确认红在哪个 job（**不要**用 `actions list --ref` 判分支，见 SKILL.md 第一步）→ `ghops actions logs baosfeng/my-dsh-plugins <run-id> --expect-branch <该 PR 的 head 分支> --jobs` 取全量 job 清单 → `--job "<失败 job 名>"` 精确取正文 → 定位失败步骤与根因 → 修复 + 已建 PR；重跑通过才算完成 |
| PR 健康检查        | 确认问题（冲突 / CI 红 / 无 review / 超时）→ `ghops pr checks` 判定 CI 是否真红 → rebase 最新 main 解冲突或修 CI → 重跑绿（再跑一次 `pr checks` 复核）→ 更新 PR 描述 / 评论；无法处理则给建议评论到 PR                                                                                                                                                       |
| CICD workflow 维护 | 修改目标明确（新增 / 优化 / 修复 workflow 文件）→ 本地 YAML 语法校验 → 改动 + 已建 PR → 触发相关 action 重跑通过                                                                                                                                                                                                                                              |
| 分析类（不改代码） | 给出明确结论（无需修复 / 等上游 / 建议方案）并发布到对应 issue / PR                                                                                                                                                                                                                                                                                          |

> PR 描述格式、CI 确认方式、改动聚焦不顺手重构、不带着失败提交等**通用**要求见全局 `leader-ops` §四 / §五，本文件不重复。
