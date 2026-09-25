---
name: dsh-github-triage
description: 使用当 需要检查/处理当前项目 GitHub 仓库的健康问题（open issue、依赖/代码扫描/密钥告警、Actions 失败、冲突或 CI 红的 open PR、CICD workflow 维护）并分派子 agent 分析修复时，或需要把模糊想法登记成规范 issue（背景/方案/验收标准）提交到仓库时。典型触发："看看仓库有什么问题""处理一下 CI 失败""跟进依赖告警""看看这些 PR 怎么回事""优化一下 workflow""把这个需求登记成 issue"
---

# GitHub 问题分诊与派发

## 概览

扫描当前项目 GitHub 仓库的 issue / 安全漏洞 / Actions 失败 / open PR / CICD workflow，**按编号从小到大排序**后逐个派发给子 agent 分析处理，最后汇总结果。流程三步：**收集 → 派发（含验收） → 汇总**。子任务隔离用 **fork 池**：为每个修复类子任务准备一个独立 clone（类似 GitHub fork），工作区与分支物理隔离，互不干扰，最终各自通过 PR 合并回主仓库。**主 agent 是 leader，全权负责任务进度与质量**：按序派发、逐项核查验收、汇总决策；**用户全权委托时（"全权委托/你当 leader"等表述）自主决策合并 PR、关闭 issue、补发 release，无需逐项询问**，仅在破坏性/公开 API 变更等重大决策时汇报。**并行子 agent 上限 3 个由 leader 自主决定**（不再事前征询；派发后在进度汇报中告知用户）。

## 何时使用

- 用户想检查仓库有哪些待办问题（open issue、依赖漏洞、CI 失败、open PR 健康）
- 用户想"处理一下"某类问题（Action 失败、安全告警、冲突 PR、workflow 优化）
- 用户提出新功能/体验改进诉求，想把它变成可开发、可验收的规范 issue（见下「需求登记」节）
- 定期巡检仓库健康状态

**不使用：** 开发/修改功能本身（用 `development-lifecycle`）；给官方仓库（deepseek-ai/deepseek-harness）提建议（目标仓库不同，先确认对方仓库的 issue 惯例）。

## 总原则（先读）

**本 skill 不包含任何 GitHub 访问实现：不调用 API、不读取 token/凭据、不碰认证细节。** 所有 GitHub 操作——查询、创建/评论 issue、建 PR、合并 PR、发 release——一律使用 `github-ops` 的统一入口 **`ghops`** 命令完成（首次 `ghops setup` 按提示配置一次，之后凭据由其封装，Agent 不接触）。主 agent 与子 agent 均遵守，不得绕过。

本地 git 操作（clone、branch、commit、pull、rebase、status）用原生 `git` 命令；**推送用 `ghops push`**（凭据封装，`--dir` 指向 fork 目录）。

**为什么用 fork 而不是 worktree/共享工作区：** 子 agent 之间没有默认隔离——它们继承同一工作区 cwd、共享同一文件系统（DSH 运行时行为），并行子任务若共用同一仓库/工作区必然互相污染。git worktree 只隔离工作区但**不改变子 agent 的默认工作目录**，子 agent 仍可能踩回主工作区造成冲突；独立 fork（完整独立 .git 的克隆）是物理目录级隔离，最直观可靠。每个修复类子任务 = 一个独立 fork = 一个分支 = 一个 PR。

> **网络前置（必跑）**：本机到 GitHub 的**唯一可靠通路是「代理 + HTTP/1.1」**（fetch 走 https+代理、push 走 SSH）——**并发派发子代理前必须先跑 `gh-net check` 自检**，否则典型症状是「开 2~3 个子代理后 GitHub 操作全部不可用」。三层配置、四层保障命令、排障对照与并发预算见 [references/network-and-fork-pool.md](references/network-and-fork-pool.md)。

## 第一步：收集问题

按 `github-ops` 用 `ghops` 命令查询以下内容，返回精简清单（编号/标题/链接/摘要）：

- `ghops issue list baosfeng/my-dsh-plugins --state open` — open issues
- `ghops alerts baosfeng/my-dsh-plugins --state open` — 安全告警（依赖/代码扫描/密钥泄露）；**看到「0 条」时必须读紧跟其后的 ⚠ 提示行**：可能还有已关闭/auto_dismissed 的告警没显示，用 `--state closed` 复查——把「没有」当成「不存在」是安全假阴性的入口（踩坑见 `docs/踩坑/README.md`）
- `ghops actions list baosfeng/my-dsh-plugins --limit 20` — 最近运行，筛出失败的（每行自带 head 分支）；按分支看用 `--branch <分支>`
- 🔴 **判断某个 PR 的 CI 是否绿，只用 `ghops pr checks baosfeng/my-dsh-plugins <PR 编号>`** — 一条命令给出每个 check 的名称/状态/结论 + **失败 job 名** + head 分支/SHA + 合并判定。**绝不要用 `ghops actions list --ref <分支>`**：`--ref` 只对 `run`（触发 workflow）有效，`list` 会**静默忽略**它并返回**全局最新** run（不报错、不提示）→ 读到的是别的分支的 run，**把全绿 PR 判成红**（真实事故：那个 run id 属于另一个 PR 的 HEAD，日志里各插件测试数量不符其实正是"不是我的 run"的铁证，却被解释成"工作区被污染"）。取任何 run 日志前先亮明归属/必要时加 `--expect-branch <分支> [--expect-sha <sha>]`——不一致 ghops **明确报错拒绝**（退出码 4），不会打印别人的日志。首次贡献者（fork PR）的 run 停在 `action_required` 时用 `ghops actions approve baosfeng/my-dsh-plugins <run-id>` 批准
- `ghops pr list baosfeng/my-dsh-plugins --state open` — open PR 健康检查（冲突/CI 红/无 review/超时未合并）
- `ghops actions workflows baosfeng/my-dsh-plugins` — workflow 清单（按需：定时任务缺失、废弃语法、失败率高的 workflow 纳入维护）
- **🔴 必做（不能只看 open）：`bash skills/dsh-github-triage/scripts/check-dependabot-closed.sh`** — 复查**已关闭**的 Dependabot 告警（见下方说明）

具体参数见 `ghops <命令> --help`；命令不存在时用 `python3 <github-ops 技能目录>/scripts/ghops.py` 代替。

> 已关闭 Dependabot 告警**必须单独复查**（GitHub 对 npm dev scope 默认 auto-dismiss，只看 open 会漏报）：跑 `bash skills/dsh-github-triage/scripts/check-dependabot-closed.sh baosfeng/my-dsh-plugins .`（退出码 1 = 需人工判读）；判读规则与派发 prompt 要求见 [references/network-and-fork-pool.md](references/network-and-fork-pool.md)。

**排序：** 合并所有待处理问题后**按编号从小到大排序**（编号小的先处理），作为派发顺序。主 agent 严格按此顺序推进，不得乱序、不得跳过。

## 第二步：派发子 agent（从小到大，主 agent 把控）

按排序后的问题清单逐个派 `subagent`。**并行子 agent 上限 3 个由 leader 自主决定**（fork 物理隔离保证并行安全，但资源与上下文有限），派发后在进度汇报中告知用户。**每个 prompt 必须自包含**（子 agent 看不到当前对话），包含：仓库、问题完整内容、任务、约束、验收、期望输出：

```
- 背景：仓库 baosfeng/my-dsh-plugins；问题类型+编号+链接；问题标题与正文/告警摘要
- 任务：定位根因（可读本地代码）→ 修复；能改就改，不能改给出根因与建议
- 约束：不 push 主分支；**只在分配给你的 fork 工作**（/tmp/gh-fork-<编号>，目录已就位，不要 cd 到其他目录）；在该 fork 内建独立分支 fix/<编号>；一任务只一个分支一个 PR，PR 标题带问题编号；任何 GitHub 操作使用 `github-ops` 的 ghops 命令（首次 ghops setup），不得调用 API/读取凭据
- 验收：修复代码 + 本地测试通过（npm test）+ PR 已创建；逐项自查见 references/dispatch-playbook.md 的「验收标准」
- 停止条件：**约 100 步内必须产出 PR**；到点未完成就先交阶段性成果并回报卡点，不要继续跑。同一命令/skill 连续失败 3 次即停并上报，**不得反复重试**（每次重试都会重发全部上下文）。轮询 CI/等异步结果用 `ghops actions watch` 后台等，不要逐步查
- 输出：根因一句话 + 修复方案/变更文件 + PR 链接（如适用）。**只回传结论与证据，不要回传全量 diff / 全量日志**
```

> **派发成本纪律、硬预算与熔断、各问题类型的验收标准**：见 [references/dispatch-playbook.md](references/dispatch-playbook.md)（成本公式、步数/上下文档位、工具调用预算、可靠性类插件严格验收）——派发前必读，缺一不许派。

### fork 池（隔离方案，必须遵守）

> 每个修复类子任务拥有且仅拥有一个 fork（`/tmp/gh-fork-<编号>`）；主路径 `node scripts/fork-pool.mjs create <编号>` → `check` → `clean <编号> --yes`。完整规则（基线 SHA 坑、hooks 未生效、依赖软链误暂存、`git cherry` 假阴性、并发测试冲突）与手工 5 步兜底见 [references/network-and-fork-pool.md](references/network-and-fork-pool.md)。

### 主 agent：leader 全权负责（进度 + 质量）

主 agent 是 **leader，全权负责**（用户全权委托时自主决策，无需逐项询问），全程维护进度清单并逐项核查验收（子 agent 自报完成不算数）：

1. **进度把控**：用 `todo` 工具维护进度清单（编号/标题/状态：待处理 → 处理中 → 已验收/未达标），按编号从小到大逐项推进；派发前检查 fork 已就位、当前子任务完成并验收后才派发下一个；**并行子 agent 上限 3 个由 leader 自主决定，并在进度汇报中告知**
2. **验收核查**：每个子任务完成后，对照 references/dispatch-playbook.md 的「验收标准」表**独立核查**，不只信子 agent 自报：
   - 变更范围：检查 PR 变更文件（`ghops pr view`）是否只覆盖本问题、无顺手重构
   - 本地测试：抽查子 agent 报告的关键测试输出，**只抽检最关键 1~2 条断言**；要完整重跑 / 多轮取证时**派发**（例外须当轮声明，见 `docs/开发指南/leader行为规范.md` 第四节）
   - CI 状态：`ghops pr checks baosfeng/my-dsh-plugins <PR 编号>` 一条命令看该 PR 的 CI 结论与失败 job 名（**不要**用 `actions list --ref` 判分支，见「第一步：收集问题」）；要追某个 run 才用 `ghops actions logs ... --expect-branch <该 PR 的 head 分支>`
   - **执行性验证派独立验证 agent**：真实环境验证（隔离实例 + 浏览器走查、复现、截图确认）等**执行性**验证工作，派独立验证 agent 执行（可续接有验证经验的原子 agent，如盲测验证 agent），**leader 不亲自执行**——亲自验证会污染 leader 上下文（大量可丢弃的中间过程），验证 agent 只回报结论与证据（截图/日志/复现步骤）。leader 只做**决策性核查**：看证据是否充分、结论是否可信、验收标准是否逐项满足
3. **不达标/失败处理**：子 agent 失败/上下文耗尽/卡住后，**优先用 `send_message` 续接原子 agent 继续干活**（它保留上下文与进度，处于可续接状态）——**不自己动手、不派新 agent**；仅当原子 agent 彻底失效（无法续接）时才重派新 agent；**绝不带着未达标结果推进下一个**
4. **自主决策（全权委托时）**：验收通过后自主合并 PR（squash + 删分支）、关闭已解决 issue（评论附 PR 链接）、补发 release（删 tag 重推等）——**拍板归 leader，执行（合并 / 发布）一律派发**（见「注意事项」与 leader 行为规范第四节）；仅在破坏性/公开 API 变更、或用户未全权委托时，才汇总询问用户决策
5. **成本监控**：续接/验收时看一眼该会话上下文规模，**越过 20 万即判定失控**——立即让它压缩或先交阶段性成果收尾；子 agent 反馈「一直在重试」时**先叫停再排查**，不要放任重试烧上下文
6. 验收通过后：记录状态、清理该 fork（`rm -rf`）、按序进入下一个问题

### 子任务独立提交

- 每个子 agent **验收达标后立即单独提交**（无需等其他子任务）：在分配的 fork 修改 + `git commit` → `ghops push --dir <fork> --branch` → `ghops pr create`（标题/正文按下方规范）
- 各子任务分支互不依赖；**一个子任务 = 一个分支 = 一个 PR**，绝不合流到其他人提交
- 无法修复的子任务：把根因与建议作为 `ghops issue comment` 发表到对应 issue（PR 问题则 `ghops pr comment`），不建空 PR
- 创建 PR 即算"独立提交"完成；**是否合并由汇总阶段统一决策**，子 agent 不自行合并

## 注意事项

- **[需求]/feature 类 issue 不派子 agent 修复**：改为转 `development-lifecycle` 按需求流程走（确认→开发→验证→发版），本 skill 只处理 BUG / 安全告警 / CI 失败 / PR 健康 / workflow 维护
- 动手前确保 fork 基于最新 main（clone 后先 `git -C /tmp/gh-fork-<编号> pull` 或 clone 最新），避免旧分支起手；长时间搁置的子任务派发前重拉最新 main
- 依赖升级先查上游 CHANGELOG、breaking changes，避免大版本跳跃引发连锁失败
- PR 合并阶段的冲突（两个 PR 改动同一文件）：主 agent 汇总时协调——后合并者 rebase 最新 main 解冲突再合并，或人工解决
- **不主动关闭 issue**：修复完成后在 issue 评论附 PR 链接；**用户全权委托时主 agent 自主关闭**（验收通过后），未委托时汇总询问用户
- 子 agent 只做自己的提交，**不得合并任何 PR、不得发布 release**——合并 / 发布属单向外发动作，由 leader 决策（全权委托时自主，否则按用户决策）并**派发执行**，leader 只审定计划与最终确认（`docs/开发指南/leader行为规范.md` 第四节）
- fork 用完即清（汇总后 `rm -rf /tmp/gh-fork-<编号>`），不得堆积；发现子 agent 跑到 fork/主工作区之外操作立即纠正
- **主 agent 不得让多个子任务同时操作主工作区**：主工作区只做只读分析或主 agent 自己的操作；修复类一律走 fork

## 第三步：汇总

收集所有子 agent 结果，给用户一张汇总表（含验收结论）：

| 问题           | 验收                 | 状态          | 链接        |
| -------------- | -------------------- | ------------- | ----------- |
| issue #12 xxx  | 通过                 | 已提交 PR #18 | https://... |
| dependabot xxx | 未通过（无修复版本） | 已评论建议    | —           |

汇总后**必须给出一张处置表**并逐条反馈，而不是只列「待用户决策」：

| 对象               | 决策               | 理由                                    | 链接        |
| ------------------ | ------------------ | --------------------------------------- | ----------- |
| PR #18 / issue #12 | 合并 + 关闭 issue  | 本地测试 + CI 绿 + 隔离实例验证通过     | https://... |
| PR #20             | **不合并（暂缓）** | 缺真实环境验证；解锁条件=补隔离实例证据 | https://... |

**合并与不合并都必须反馈**（用户明确要求）：全权委托下 leader 仍**自主拍板、先做**，但每轮汇报都要逐条说清「哪个 issue/PR 合并了、哪个没合并、为什么、什么条件下再推进」，并在对应 PR/issue 上公开留痕（`ghops pr comment` / `ghops issue comment`）——**不得静默合并、不得静默丢弃**（规范见 docs/开发指南/工程效率规范.md 第十二节）。**验收未通过/卡住的子任务单列并说明原因与下一步**。**用户全权委托时**：主 agent 自主执行合并/关闭/补发（验收通过即执行，汇总表记录结果）；**未委托时**：用户确认后由主 agent 统一执行（`ghops pr merge` / `ghops issue close`）。

## 需求登记（把模糊想法变成规范 issue）

**何时用**：用户提出新功能/体验改进诉求（"图标多彩一点""想支持 xxx""加个开关"），要正式登记为可追溯、可指派、可验收的需求 issue。**不使用**：动手开发功能本身（走 `development-lifecycle`）；给官方仓库提建议（目标仓库不同，先确认对方仓库惯例）。把口头想法变成仓库 issue 的完整流程（澄清 → 防重复 → 现状调研 → 方案设计 → 起草 → 提交 → 联动）：

1. **澄清（默认不追问）**：**用户已授权直接执行**，表述缺信息时优先靠第 3 步现状调研 + 上下文合理推断补齐；只有需求方向确实无法推断（会写错 issue）时才 `ask_user_question` 问一次。补齐要点：期望**形态**（换样式/颜色/交互/加配置）、**范围**（哪个插件、哪些页面/列表）、优先级（未说明就不写）。
2. **防重复（必做）**：用多组关键词（用户原词 + 同义词 + 英文，如 `图标`/`icon`/`颜色`/`多彩`）搜已有 issue：`ghops search issues "repo:baosfeng/my-dsh-plugins <关键词>"`。命中判定：open 且需求相同 → 不重复开，贴链接建议跟帖；closed 且已实现 → 告知用户，不重复开；closed 但未实现（旧需求废弃）→ 直接开新 issue，正文注明"关联旧 issue #N"；未命中 → 正常开。
3. **现状调研**：`plugins/<name>/`——**先 `ls` 确认结构再读**：server 端是 `lib/index.js`；client 端 `lib/client.js` **可能是构建产物**（由 `scripts/build.mjs` 拼接），源码在 `client.src.js` 或 `lib/parts/*.part.js`，**不要改/引用构建产物当源码**。把现状事实（如"图标目前全部同色、不区分类型"）写进 issue 背景，不凭印象。
4. **方案设计（UI/交互类必做）**：找可参考方案（vscode-icons、devicon、file-icons、lucide file-type 等图标集/配色，或主流 IDE 惯例），或自设计一套并给出颜色/图标对应表；给 **≥2 个方案 + 推荐理由**（含风格统一性、体积、依赖取舍）。
5. **起草**：标题统一 `[需求]` 前缀（仓库既有惯例 `[需求]` / `[建议]` / `[BUG]`），格式 `动词 + 对象 + 期望效果`（如 `[需求] 文件活动图标按文件类型多彩着色`），不用"优化一下"这类空泛词；正文按 [templates/issue-template.md](templates/issue-template.md)（背景 / 期望行为 / 建议方案 / 备选方案 / 可勾选验收标准 / 附件）。
6. **提交**：`ghops issue create baosfeng/my-dsh-plugins --title "..." --body "..."`（参数见 `ghops issue create --help`）；成功→把链接贴给用户。**提交前自查**（不再征询用户意见）：标题规范、模板字段齐全、验收标准可勾选、防重复已做、现状已核实、UI 类满足第 4 步。**例外**：需求对象不明 / 与现状冲突 / 含删除等破坏性语义时，先问一次再提交——拿不准宁可先问，不提交将就的草稿。
7. **联动**：用户要开发该需求 → 交给 `development-lifecycle`（它在开发启动时把验收标准写进该 issue；`[需求]` issue 也不派修复类子 agent，见「注意事项」）。

## 参考材料

| 文件                                                                       | 内容                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [references/dispatch-playbook.md](references/dispatch-playbook.md)         | 派发成本纪律、硬预算与熔断、各问题类型验收标准                            |
| [references/network-and-fork-pool.md](references/network-and-fork-pool.md) | 网络前置实测与三层配置、已关闭 Dependabot 告警复查、fork 池隔离与手工兜底 |
| [templates/issue-template.md](templates/issue-template.md)                 | 需求 issue 正文模板（背景/期望/方案/验收/附件）                           |
| [scripts/check-dependabot-closed.sh](scripts/check-dependabot-closed.sh)   | 已关闭 Dependabot 告警复查（假阴性防线）                                  |

## 常见错误

| 错误                                                          | 解法                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 子 agent prompt 信息不全                                      | 必须自包含：仓库+问题全文+任务+约束+验收+输出格式                                                                                                                                                                                                                                                                                                                      |
| 一个子 agent 处理所有问题                                     | 每次只处理一个问题，并行派多个，但派发顺序严格按编号从小到大                                                                                                                                                                                                                                                                                                           |
| 多个子 agent 共用同一 git 仓库                                | 各用独立 fork `/tmp/gh-fork-<编号>`；共享工作区/仓库会互相污染                                                                                                                                                                                                                                                                                                         |
| fork 不清理                                                   | 汇总后 `rm -rf /tmp/gh-fork-<编号>`；数量=问题数，用完即清                                                                                                                                                                                                                                                                                                             |
| 子 agent 在主工作区/他人 fork 操作                            | 只允许操作自己被分配的 fork 目录；修复类子任务严禁碰主工作区                                                                                                                                                                                                                                                                                                           |
| 乱序派发（未按编号从小到大）                                  | 清单按编号升序，主 agent 按序推进、按序验收                                                                                                                                                                                                                                                                                                                            |
| 子 agent 自报完成即推进                                       | 主 agent 必须按验收标准独立核查（变更范围/本地测试/CI），未达标退回修或重派                                                                                                                                                                                                                                                                                            |
| 子 agent 失败后自己动手/派新 agent                            | 用 `send_message` 续接原子 agent（保留上下文与进度，可续接状态）；仅彻底失效才重派新 agent                                                                                                                                                                                                                                                                             |
| 把 [需求] issue 当 BUG 派子 agent 修                          | 需求转 development-lifecycle，本 skill 只处理 BUG/告警/CI/PR/workflow                                                                                                                                                                                                                                                                                                  |
| 等所有子任务完成才统一提交                                    | 验收达标即独立提交（分支+PR），各自独立                                                                                                                                                                                                                                                                                                                                |
| 一个 PR 混多个问题                                            | 一子任务一分支一 PR，标题带编号                                                                                                                                                                                                                                                                                                                                        |
| 验收不达标就提交                                              | 按验收标准逐项自查：根因/修复/测试/PR 缺一不可                                                                                                                                                                                                                                                                                                                         |
| PR 后不管 CI 结果                                             | `ghops pr checks` 确认绿（追 run 时用 `actions logs --expect-branch` 先核对归属），红了继续修                                                                                                                                                                                                                                                                          |
| 子 agent 自行合并 PR / 发布 release                           | 禁止；合并与发布只在汇总阶段按用户决策执行；**每一次合并/不合并都要逐条反馈用户并公开留痕**（见第三步「汇总」）                                                                                                                                                                                                                                                        |
| 自己写 curl/gh/API 访问 GitHub                                | 一律用 github-ops 的 ghops 命令                                                                                                                                                                                                                                                                                                                                        |
| 读取/打印 token 或 secrets                                    | 禁止；凭据由 ghops setup 封装，本 skill 不接触                                                                                                                                                                                                                                                                                                                         |
| 只看 issue 漏掉告警/CI/PR                                     | 四类查询一次跑全（issue/alerts/actions/pr）                                                                                                                                                                                                                                                                                                                            |
| 子 agent push 主分支                                          | 约束建分支+PR                                                                                                                                                                                                                                                                                                                                                          |
| 重复处理已交付的工作                                          | 接手前先盘点：`ghops pr list --state all` + main 历史核对每个 issue 是否已合并（closed PR ≠ 未合并，看 merged_at；**不要用 `git cherry` 判**——squash 合并必然假阴性，见 [踩坑](../docs/踩坑/README.md)）；已合并的只关 issue，不再派工                                                                                                                                 |
| 遇到其他代理留下的半成品                                      | 先验证（`git status`/`git diff` + `npm test`）再决定接手：代码完整则 rebase 最新 main → push → PR；不完整才重派子 agent                                                                                                                                                                                                                                                |
| `ghops pr create` 报 nil is not a string                      | 需显式加 `--base main`（base 缺省解析失败）                                                                                                                                                                                                                                                                                                                            |
| `ghops push` 偶发超时                                         | 先 `git ls-remote origin refs/heads/<分支>` 确认是否已推；未推则后台重试，勿重复推                                                                                                                                                                                                                                                                                     |
| fork 基线过期（基于合并前的 main 开发）                       | `clone --local` 的 `origin/main` = 主工作区本地 main；派生前 `merge --ff-only origin/main`、fork 内 `fetch origin main` 后再 `checkout -b`，并核对 `git ls-remote origin refs/heads/main` 与 fork HEAD 一致（见 [踩坑](../docs/踩坑/README.md)）                                                                                                                       |
| 用 `git cherry` 判定工作是否已合并                            | squash 合并下必然假阴性（全部标 `+`）；查 main 的 squash 提交/PR 号 + 比对 `git patch-id --stable` 第一列（见 [踩坑](../docs/踩坑/README.md)）                                                                                                                                                                                                                         |
| 只看 `ghops alerts --state open` 就断言「没有依赖漏洞」       | 默认视图**只列 open**，被 auto-dismiss 的告警与「没报过」表面无法区分（曾造成一次误判）；每次收集都必须跑 `check-dependabot-closed.sh`，见「Dependabot 已关闭告警必须单独复查」与 [踩坑](../docs/踩坑/README.md)                                                                                                                                                       |
| 把 `auto_dismissed` 当成「已修复」或反过来当作「GitHub 说的」 | auto-dismiss 是 GitHub 的**启发式**（npm dev scope 传递依赖，公开仓库默认开），会误关真实漏洞；必须拿 lockfile 里的实际版本与 `security_vulnerability.vulnerable_version_range` 对一遍（脚本已内置）                                                                                                                                                                   |
| 关闭 PR 时让用户去网页操作                                    | `ghops pr` 没有 close 子命令（只有 create/list/view/comment/merge）；**PR 在 GitHub 上即 issue，用 `ghops issue close <repo> <PR 号>` 即可关闭**（实测有效）                                                                                                                                                                                                           |
| 用双引号传含反引号的评论正文                                  | `ghops <x> comment … --body "… `code` …"` 里的**反引号会被 shell 当命令替换执行**：正文残缺、还可能真的跑起命令（实测误触发了 `npm audit`，并打出 `command not found`）。**正文含反引号 / `$` / `!` 时必须用 heredoc**：`BODY=$(cat <<'EOF' … EOF)` 再 `--body "$BODY"`（`'EOF'` 加引号才禁止展开）；发完**回读一次**确认正文完整（`ghops issue view <n> --comments`） |
