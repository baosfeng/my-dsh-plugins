---
name: dsh-github-triage
description: 使用当 需要检查或处理当前项目 GitHub 仓库的健康问题——打开的 issue、安全漏洞告警（Dependabot/Code Scanning/Secret Scanning）、GitHub Actions 失败、未合并/冲突/CI 失败的 open PR、CICD workflow 维护——并把每个问题分派给子 agent 分析/修复时。典型触发："看看仓库有什么问题""处理一下 CI 失败""跟进依赖告警""看看这些 PR 怎么回事""优化一下 workflow"
---

# GitHub 问题分诊与派发

## 概览

扫描当前项目 GitHub 仓库的 issue / 安全漏洞 / Actions 失败 / open PR / CICD workflow，**按编号从小到大排序**后逐个派发给子 agent 分析处理，最后汇总结果。流程三步：**收集 → 派发（含验收） → 汇总**。子任务隔离用 **fork 池**：为每个修复类子任务准备一个独立 clone（类似 GitHub fork），工作区与分支物理隔离，互不干扰，最终各自通过 PR 合并回主仓库。**主 agent 是 leader，全权负责任务进度与质量**：按序派发、逐项核查验收、汇总决策；**用户全权委托时（"全权委托/你当 leader"等表述）自主决策合并 PR、关闭 issue、补发 release，无需逐项询问**，仅在破坏性/公开 API 变更等重大决策时汇报。**并行派发子 agent 前找用户确认数量**（上限 3 个，用户明确要求；执行时确认，不自行决定）。

## 何时使用

- 用户想检查仓库有哪些待办问题（open issue、依赖漏洞、CI 失败、open PR 健康）
- 用户想"处理一下"某类问题（Action 失败、安全告警、冲突 PR、workflow 优化）
- 定期巡检仓库健康状态

**不使用：** 只是把新需求登记为 issue（用 `dsh-issue-request`）；只是开发本地功能（用 `development-lifecycle`）。

## 总原则（先读）

**本 skill 不包含任何 GitHub 访问实现：不调用 API、不读取 token/凭据、不碰认证细节。** 所有 GitHub 操作——查询、创建/评论 issue、建 PR、合并 PR、发 release——一律使用 `github-ops` 的统一入口 **`ghops`** 命令完成（首次 `ghops setup` 按提示配置一次，之后凭据由其封装，Agent 不接触）。主 agent 与子 agent 均遵守，不得绕过。

本地 git 操作（clone、branch、commit、pull、rebase、status）用原生 `git` 命令；**推送用 `ghops push`**（凭据封装，`--dir` 指向 fork 目录）。

**为什么用 fork 而不是 worktree/共享工作区：** 子 agent 之间没有默认隔离——它们继承同一工作区 cwd、共享同一文件系统（DSH 运行时行为），并行子任务若共用同一仓库/工作区必然互相污染。git worktree 只隔离工作区但**不改变子 agent 的默认工作目录**，子 agent 仍可能踩回主工作区造成冲突；独立 fork（完整独立 .git 的克隆）是物理目录级隔离，最直观可靠。每个修复类子任务 = 一个独立 fork = 一个分支 = 一个 PR。

## 第一步：收集问题

按 `github-ops` 用 `ghops` 命令查询以下内容，返回精简清单（编号/标题/链接/摘要）：

- `ghops issue list baosfeng/my-dsh-plugins --state open` — open issues
- `ghops alerts baosfeng/my-dsh-plugins --state open` — 安全告警（依赖/代码扫描/密钥泄露）
- `ghops actions list baosfeng/my-dsh-plugins --limit 20` — 最近运行，筛出失败的（默认分支优先）
- `ghops pr list baosfeng/my-dsh-plugins --state open` — open PR 健康检查（冲突/CI 红/无 review/超时未合并）
- `ghops actions workflows baosfeng/my-dsh-plugins` — workflow 清单（按需：定时任务缺失、废弃语法、失败率高的 workflow 纳入维护）

具体参数见 `ghops <命令> --help`；命令不存在时用 `python3 <github-ops 技能目录>/scripts/ghops.py` 代替。

**排序：** 合并所有待处理问题后**按编号从小到大排序**（编号小的先处理），作为派发顺序。主 agent 严格按此顺序推进，不得乱序、不得跳过。

## 第二步：派发子 agent（从小到大，主 agent 把控）

按排序后的问题清单逐个派 `subagent`。**并行派发前找用户确认数量**（上限 3 个；执行时确认，不自行决定；fork 物理隔离保证并行安全，但资源与上下文有限）。**每个 prompt 必须自包含**（子 agent 看不到当前对话），包含：仓库、问题完整内容、任务、约束、验收、期望输出：

```
- 背景：仓库 baosfeng/my-dsh-plugins；问题类型+编号+链接；问题标题与正文/告警摘要
- 任务：定位根因（可读本地代码）→ 修复；能改就改，不能改给出根因与建议
- 约束：不 push 主分支；**只在分配给你的 fork 工作**（/tmp/gh-fork-<编号>，目录已就位，不要 cd 到其他目录）；在该 fork 内建独立分支 fix/<编号>；一任务只一个分支一个 PR，PR 标题带问题编号；任何 GitHub 操作使用 `github-ops` 的 ghops 命令（首次 ghops setup），不得调用 API/读取凭据
- 验收：修复代码 + 本地测试通过（npm test）+ PR 已创建；见「验收标准」逐项自查
- 输出：根因一句话 + 修复方案/变更文件 + PR 链接（如适用）
```

### fork 池（隔离方案，必须遵守）

主 agent 按派发顺序**逐个**准备 fork（不提前批量派生），子 agent **只在自己被分配的 fork 内工作**：

```
git -C <主工作区> fetch origin                                 # 主 agent 先同步远程引用（不碰工作区文件）
git clone --local <主工作区> /tmp/gh-fork-<编号>               # 本地派生 fork：零网络、秒级（实测 ~1.4s）
git -C /tmp/gh-fork-<编号> remote set-url origin git@github.com:baosfeng/my-dsh-plugins.git   # 重设 GitHub 远程（必须）
git -C /tmp/gh-fork-<编号> checkout -b fix/<编号> origin/main  # 从远程最新 main 建分支（子 agent 直接在其上工作）
```

规则：

- **每个修复类子任务拥有且仅拥有一个 fork**（`/tmp/gh-fork-<编号>`）；主工作区（`/Users/bsfeng/IdeaProjects/my-dsh-plugins`）与任何其他 fork 都不得被该子任务操作
- fork 用 `git clone --local` **本地派生**：不重复走网络、也不调用 REST API（无速率限制），秒级完成；**不是**远程克隆，主工作区未提交改动不会混入 fork（只含已提交内容）
- **本地派生的 origin 默认指向主工作区本地路径，必须 `remote set-url` 重设为 GitHub 远程**，否则 push 会推到本地路径（静默失败/污染）
- 派生前主 agent 先 `git -C <主工作区> fetch origin` 同步远程引用；fork 内 `checkout -b fix/<编号> origin/main` 从最新远程 main 起分支——即使主工作区本地 main 落后远程也不受影响
- 子 agent 工作流：fork 内修改 → `git commit`（fork 是完整独立 .git，工作区/index/HEAD/分支与其他 fork 及主工作区**物理隔离**，互不可见）→ `ghops push --dir /tmp/gh-fork-<编号> --branch fix/<编号>` → `ghops pr create`
- fork 是完整克隆（不共享对象库），隔离比 worktree 更彻底：两个子任务改动同一文件也互不影响；PR 合并阶段的冲突由后合并方 rebase 最新 main 解决
- 多个子任务可并行（fork 物理隔离保证安全），但**派发必须按编号从小到大**，主 agent 按序验收汇总
- 汇总后主 agent 统一清理：`rm -rf /tmp/gh-fork-<编号>`；已 push 的分支保留在远程，PR 合并后自动删除
- fork 数量 = 修复类问题数量，**完成后必须清理**，避免 /tmp 堆积
- **分析类子任务（只读、不改码）无需 fork**，可在本地主工作区只读操作（git log/config 等）
- **信息严重不足的 BUG issue**（无复现步骤/无报错信息）：不派修复类，直接按分析类派发——先评论索要补充信息；调研中确认根因不在本仓库的同样转分析类，不硬修

### 主 agent：leader 全权负责（进度 + 质量）

主 agent 是 **leader，全权负责**（用户全权委托时自主决策，无需逐项询问），全程维护进度清单并逐项核查验收（子 agent 自报完成不算数）：

1. **进度把控**：用 `todo` 工具维护进度清单（编号/标题/状态：待处理 → 处理中 → 已验收/未达标），按编号从小到大逐项推进；派发前检查 fork 已就位、当前子任务完成并验收后才派发下一个；**并行子 agent 数量派发前找用户确认（上限 3 个）**
2. **验收核查**：每个子任务完成后，对照下方「验收标准」表**独立核查**，不只信子 agent 自报：
   - 变更范围：检查 PR 变更文件（`ghops pr view`）是否只覆盖本问题、无顺手重构
   - 本地测试：抽查子 agent 报告的关键测试输出（必要时主 agent 在 fork 内重跑 `npm test`）
   - CI 状态：`ghops actions watch baosfeng/my-dsh-plugins <run-id>` 或 `ghops actions logs` 查 PR 对应 CI 结果
   - **执行性验证派独立验证 agent**：真实环境验证（隔离实例 + 浏览器走查、复现、截图确认）等**执行性**验证工作，派独立验证 agent 执行（可续接有验证经验的原子 agent，如盲测验证 agent），**leader 不亲自执行**——亲自验证会污染 leader 上下文（大量可丢弃的中间过程），验证 agent 只回报结论与证据（截图/日志/复现步骤）。leader 只做**决策性核查**：看证据是否充分、结论是否可信、验收标准是否逐项满足
3. **不达标/失败处理**：子 agent 失败/上下文耗尽/卡住后，**优先用 `send_message` 续接原子 agent 继续干活**（它保留上下文与进度，处于可续接状态）——**不自己动手、不派新 agent**；仅当原子 agent 彻底失效（无法续接）时才重派新 agent；**绝不带着未达标结果推进下一个**
4. **自主决策（全权委托时）**：验收通过后自主合并 PR（squash + 删分支）、关闭已解决 issue（评论附 PR 链接）、补发 release（删 tag 重推等）；仅在破坏性/公开 API 变更、或用户未全权委托时，才汇总询问用户决策
5. 验收通过后：记录状态、清理该 fork（`rm -rf`）、按序进入下一个问题

### 子任务独立提交

- 每个子 agent **验收达标后立即单独提交**（无需等其他子任务）：在分配的 fork 修改 + `git commit` → `ghops push --dir <fork> --branch` → `ghops pr create`（标题/正文按下方规范）
- 各子任务分支互不依赖；**一个子任务 = 一个分支 = 一个 PR**，绝不合流到其他人提交
- 无法修复的子任务：把根因与建议作为 `ghops issue comment` 发表到对应 issue（PR 问题则 `ghops pr comment`），不建空 PR
- 创建 PR 即算"独立提交"完成；**是否合并由汇总阶段统一决策**，子 agent 不自行合并

## 验收标准

### 按问题类型判定"已完成"

| 问题类型           | 达标条件                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| issue（BUG/需求）  | 根因确认 + 修复代码 + 本地测试通过 + 已建 PR；一个 PR 只覆盖这一个 issue                                                                                 |
| 安全告警           | 依赖/代码已修复，升级前查 CHANGELOG/breaking changes 确认兼容；测试通过；已建 PR；无修复版本时给出原因与建议并评论到 issue                               |
| Actions 失败       | 先 `ghops actions logs baosfeng/my-dsh-plugins <run-id>` 取日志 → 定位失败步骤与根因 → 修复 + 已建 PR；CI 重跑通过（重跑仍失败则继续排查，不得标记完成） |
| PR 健康检查        | 确认问题（冲突/CI 红/无 review/超时）→ rebase 最新 main 解冲突或修复 CI → CI 重跑绿 → 更新 PR 描述/评论说明；无法处理给建议评论到 PR                     |
| CICD workflow 维护 | 修改目标明确（新增/优化/修复 workflow 文件）→ 本地语法校验（YAML 解析）→ 改动 + 已建 PR → 触发相关 action 重跑通过                                       |
| 分析类（不改代码） | 给出明确结论（无需修复 / 等上游 / 建议方案）并发布到对应 issue/PR                                                                                        |

### 通用要求（所有子任务）

- PR 描述含：**根因、修复内容、验证结果**（测试命令 + 关键输出）；标题遵循仓库提交规范（Conventional Commits，见 .reasonix/skills/commit-standards），格式 `fix(scope): #<编号> 简述`
- 改动聚焦本问题，**不顺手重构无关代码**；遵循仓库质量门禁（.reasonix/skills/quality-gates、coding-standards；测试用 `npm test`，插件改动同步 `docs/<模块>/需求清单.md`）
- **PR 创建后确认 CI 已跑绿**：`ghops actions watch baosfeng/my-dsh-plugins <run-id>` 或 `ghops actions logs` 查结果；红则继续修，不得宣称完成
- 验收未达标的子任务**不得提交 PR**——继续修或转为分析类输出，绝不带着失败提交

### 可靠性类插件严格验收（dsh-task-reliability 等）

对「保障可靠性」类插件（典型：dsh-task-reliability——用户多次指出其反而引入不可靠问题）的问题修复，在通用要求基础上**额外强制**：

- **防回归测试**：必须先写失败单元测试精确复现原 bug（含边界时序），再修复转绿（quality-gates 门禁），不允许只修症状
- **真实环境验证**：按 verifying-dsh-plugins 在隔离 DSH 实例 + 真实 GUI 走通关键路径——依赖真实进程/时序/GUI 的行为（如 ask 缓冲竞速、回答透传/不丢失、重启恢复）必须真实验证，纯单元测试不足
- **全量回归**：跑插件全部测试 + 对照 `docs/<模块>/需求清单.md` 逐项回归，不得削弱既有功能
- **无验证证据不得宣称完成**：无法验证（无法复现/环境限制）时不得标记完成，转为分析类输出并说明验证缺口

## 注意事项

- **[需求]/feature 类 issue 不派子 agent 修复**：改为转 `development-lifecycle` 按需求流程走（确认→开发→验证→发版），本 skill 只处理 BUG / 安全告警 / CI 失败 / PR 健康 / workflow 维护
- 动手前确保 fork 基于最新 main（clone 后先 `git -C /tmp/gh-fork-<编号> pull` 或 clone 最新），避免旧分支起手；长时间搁置的子任务派发前重拉最新 main
- 依赖升级先查上游 CHANGELOG、breaking changes，避免大版本跳跃引发连锁失败
- PR 合并阶段的冲突（两个 PR 改动同一文件）：主 agent 汇总时协调——后合并者 rebase 最新 main 解冲突再合并，或人工解决
- **不主动关闭 issue**：修复完成后在 issue 评论附 PR 链接；**用户全权委托时主 agent 自主关闭**（验收通过后），未委托时汇总询问用户
- 子 agent 只做自己的提交，**不得合并任何 PR、不得发布 release**——这些由主 agent 执行（全权委托时自主，否则按用户决策）
- fork 用完即清（汇总后 `rm -rf /tmp/gh-fork-<编号>`），不得堆积；发现子 agent 跑到 fork/主工作区之外操作立即纠正
- **主 agent 不得让多个子任务同时操作主工作区**：主工作区只做只读分析或主 agent 自己的操作；修复类一律走 fork

## 第三步：汇总

收集所有子 agent 结果，给用户一张汇总表（含验收结论）：

| 问题           | 验收                 | 状态          | 链接        |
| -------------- | -------------------- | ------------- | ----------- |
| issue #12 xxx  | 通过                 | 已提交 PR #18 | https://... |
| dependabot xxx | 未通过（无修复版本） | 已评论建议    | —           |

汇总后需要用户决策的单独列出：**是否合并各 PR、是否关闭对应 issue、是否有破坏性/公开 API 变更**；**验收未通过/卡住的子任务单列并说明原因与下一步**。**用户全权委托时**：主 agent 自主执行合并/关闭/补发（验收通过即执行，汇总表记录结果），仅在破坏性/公开 API 变更时汇报；**未委托时**：用户确认后由主 agent 统一执行（`ghops pr merge` / `ghops issue close`）。

## 常见错误

| 错误                                     | 解法                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 子 agent prompt 信息不全                 | 必须自包含：仓库+问题全文+任务+约束+验收+输出格式                                                                                                |
| 一个子 agent 处理所有问题                | 每次只处理一个问题，并行派多个，但派发顺序严格按编号从小到大                                                                                     |
| 多个子 agent 共用同一 git 仓库           | 各用独立 fork `/tmp/gh-fork-<编号>`；共享工作区/仓库会互相污染                                                                                   |
| fork 不清理                              | 汇总后 `rm -rf /tmp/gh-fork-<编号>`；数量=问题数，用完即清                                                                                       |
| 子 agent 在主工作区/他人 fork 操作       | 只允许操作自己被分配的 fork 目录；修复类子任务严禁碰主工作区                                                                                     |
| 乱序派发（未按编号从小到大）             | 清单按编号升序，主 agent 按序推进、按序验收                                                                                                      |
| 子 agent 自报完成即推进                  | 主 agent 必须按验收标准独立核查（变更范围/本地测试/CI），未达标退回修或重派                                                                      |
| 子 agent 失败后自己动手/派新 agent       | 用 `send_message` 续接原子 agent（保留上下文与进度，可续接状态）；仅彻底失效才重派新 agent                                                       |
| 把 [需求] issue 当 BUG 派子 agent 修     | 需求转 development-lifecycle，本 skill 只处理 BUG/告警/CI/PR/workflow                                                                            |
| 等所有子任务完成才统一提交               | 验收达标即独立提交（分支+PR），各自独立                                                                                                          |
| 一个 PR 混多个问题                       | 一子任务一分支一 PR，标题带编号                                                                                                                  |
| 验收不达标就提交                         | 按验收标准逐项自查：根因/修复/测试/PR 缺一不可                                                                                                   |
| PR 后不管 CI 结果                        | `ghops actions watch/logs` 确认绿，红了继续修                                                                                                    |
| 子 agent 自行合并 PR / 发布 release      | 禁止；合并与发布只在汇总阶段按用户决策执行                                                                                                       |
| 自己写 curl/gh/API 访问 GitHub           | 一律用 github-ops 的 ghops 命令                                                                                                                  |
| 读取/打印 token 或 secrets               | 禁止；凭据由 ghops setup 封装，本 skill 不接触                                                                                                   |
| 只看 issue 漏掉告警/CI/PR                | 四类查询一次跑全（issue/alerts/actions/pr）                                                                                                      |
| 子 agent push 主分支                     | 约束建分支+PR                                                                                                                                    |
| 重复处理已交付的工作                     | 接手前先盘点：`ghops pr list --state all` + main 历史核对每个 issue 是否已合并（closed PR ≠ 未合并，看 merged_at）；已合并的只关 issue，不再派工 |
| 遇到其他代理留下的半成品                 | 先验证（`git status`/`git diff` + `npm test`）再决定接手：代码完整则 rebase 最新 main → push → PR；不完整才重派子 agent                          |
| `ghops pr create` 报 nil is not a string | 需显式加 `--base main`（base 缺省解析失败）                                                                                                      |
| `ghops push` 偶发超时                    | 先 `git ls-remote origin refs/heads/<分支>` 确认是否已推；未推则后台重试，勿重复推                                                               |
