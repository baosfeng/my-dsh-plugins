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

## 网络前置（必读，2026-09-12 实测）

本机到 GitHub 的**唯一可靠通路是「代理 + HTTP/1.1」**，其它通路都会卡死——**并发派发子代理前必须先跑本节的自检**，否则典型症状是「开 2~3 个子代理后 GitHub 操作全部不可用」（实测数据）：

| 通路                    | 实测结果                                                                   | 判定            |
| ----------------------- | -------------------------------------------------------------------------- | --------------- |
| https 直连              | ~10 KB/s（codeload 拉 217 KB 耗时 20s）                                    | ❌ 不可用       |
| https + 代理 + HTTP/2   | `fatal: Error in the HTTP2 framing layer`                                  | ❌ git 直接失败 |
| https + 代理 + HTTP/1.1 | 单并发 53s / 3 并发 78s（浅克隆）                                          | ✅ 下行主力     |
| SSH `git@github.com`    | 上行 push 正常（秒级），**下行 clone 180s 超时 / `unexpected disconnect`** | ✅ 仅用于 push  |
| 代理带宽                | 273 KB/s（4 路混合并发实测总耗时 4s）                                      | 重负载需节制    |

**分流是本方案的核心**（代理不稳定时仍能干活）：`fetch` 走 https+代理（快），`push` 走 SSH（**完全不经过代理**）。每个仓库设一次：

```bash
git remote set-url origin https://github.com/<owner>/<repo>.git       # fetch：https + 代理
git config remote.origin.pushurl git@github.com:<owner>/<repo>.git    # push：SSH，代理挂了照样能推
```

`ghops push` 内部就是 `git push origin`（SSH 无需 token），对该分流透明。只读操作（fork 派生、log、测试）走 `git clone --local` **零网络**，代理挂掉完全不受影响；`ghops` 的 API 层另有内建降级（探测失败自动直连并提示一次）。

三层配置缺一层就退化为卡死，全部在 `~/.dsh/secrets/github-proxy` 与 git 全局配置里持久化：

```bash
# 1) git：强制 HTTP/1.1 + 走代理（缺这层 → HTTP2 framing 崩溃）
git config --global http.version HTTP/1.1
git config --global http.proxy http://127.0.0.1:7890
git config --global http.lowSpeedLimit 1000 && git config --global http.lowSpeedTime 60

# 2) ghops：代理写文件（缺这层 → API 直连 10 KB/s，多子代理并发即集体卡死）
printf 'http://127.0.0.1:7890' > ~/.dsh/secrets/github-proxy && chmod 600 ~/.dsh/secrets/github-proxy

# 3) 自检（派发前跑，3 秒出结论）
gh-net check                             # 一键自检（见下）；没有该脚本时用后两行
ghops proxy                              # 期望：当前代理 http://127.0.0.1:7890 / 可用性：正常
git ls-remote origin refs/heads/main     # 期望：<10s 返回 SHA
```

**代理不稳定时的四层保障**：本机装有 `~/.local/bin/gh-net`（即上文配置的固化版 + 两条应急通路，`gh-net help` 看全集）：

| 命令                               | 作用                                                                                                                                    | 何时用                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `gh-net check`                     | 3 秒自检：代理端口 / HTTP 探测 / git 配置 / ghops / 本地镜像                                                                            | **派发子代理前必跑**                |
| `gh-net status`                    | 详细状态：代理与直连的**实测下载速率**、git 配置、远端分流、镜像清单                                                                    | 怀疑变慢时                          |
| `gh-net fix`                       | 按探测结果重配；**代理挂掉时自动清空 `http.proxy` 与 ghops 代理文件退回直连**（慢但不会全挂），代理恢复后再跑一次即回到代理通路（幂等） | 报 framing / Empty reply / 无响应时 |
| `gh-net fetch-mirror [owner/repo]` | 建立 / 增量更新**本地裸镜像**（`~/.cache/dsh/git-mirrors/`）                                                                            | 代理不稳、想彻底摆脱网络依赖时      |
| `gh-net rescue <owner/repo> [dir]` | **加速站应急只读拉取**：自动测速选站、不走代理，拉完自动把 remote 修正回 GitHub（fetch 走代理 / push 走 SSH）                           | 代理全挂、急需一份代码时            |

镜像的价值：建立后 `git clone --local ~/.cache/dsh/git-mirrors/<owner>_<repo>.git /tmp/work` 可**零网络、0 秒**派生工作副本（实测 18M 镜像 → 派生 0s；增量更新 2s），fork 池也可以镜像为源而不占用主工作区。`rescue` 实测自动选中 `gh-proxy.com`（149 KB/s）——仅用于公开仓库（内容经第三方转发，git 对象 SHA 校验保证不被篡改）。

**排障对照**：`git clone` 报 `HTTP2 framing layer` → 第 1 层丢失；`ghops` 命令长时间无响应 → 第 2 层丢失；`git ls-remote` 报 `Empty reply from server` → 代理进程没起（`lsof -nP -iTCP:7890 -sTCP:LISTEN` 确认）或跑 `gh-net fix`。

**并发预算**：克隆/推送是唯一重负载。fork 池用 `git clone --local` **本地派生**（零网络，正是为本节问题设计的）——**不要在 fork 内 clone 远程仓库**，也不要把多条 `git fetch` 并发堆在一起。

## 第一步：收集问题

按 `github-ops` 用 `ghops` 命令查询以下内容，返回精简清单（编号/标题/链接/摘要）：

- `ghops issue list baosfeng/my-dsh-plugins --state open` — open issues
- `ghops alerts baosfeng/my-dsh-plugins --state open` — 安全告警（依赖/代码扫描/密钥泄露）；**看到「0 条」时必须读紧跟其后的 ⚠ 提示行**：可能还有已关闭/auto_dismissed 的告警没显示，用 `--state closed` 复查——把「没有」当成「不存在」是安全假阴性的入口（踩坑见 `docs/踩坑/README.md`）
- `ghops actions list baosfeng/my-dsh-plugins --limit 20` — 最近运行，筛出失败的（每行自带 head 分支）；按分支看用 `--branch <分支>`
- 🔴 **判断某个 PR 的 CI 是否绿，只用 `ghops pr checks baosfeng/my-dsh-plugins <PR 编号>`** — 一条命令给出每个 check 的名称/状态/结论 + **失败 job 名** + head 分支/SHA + 合并判定。**绝不要用 `ghops actions list --ref <分支>`**：`--ref` 只对 `run`（触发 workflow）有效，`list` 会**静默忽略**它并返回**全局最新** run（不报错、不提示）→ 读到的是别的分支的 run，**把全绿 PR 判成红**（#347 事故：那个 run id 属于另一个 PR 的 HEAD，日志里各插件测试数量不符其实正是"不是我的 run"的铁证，却被解释成"工作区被污染"）。取任何 run 日志前先亮明归属/必要时加 `--expect-branch <分支> [--expect-sha <sha>]`——不一致 ghops **明确报错拒绝**（退出码 4），不会打印别人的日志。首次贡献者（fork PR）的 run 停在 `action_required` 时用 `ghops actions approve baosfeng/my-dsh-plugins <run-id>` 批准
- `ghops pr list baosfeng/my-dsh-plugins --state open` — open PR 健康检查（冲突/CI 红/无 review/超时未合并）
- `ghops actions workflows baosfeng/my-dsh-plugins` — workflow 清单（按需：定时任务缺失、废弃语法、失败率高的 workflow 纳入维护）
- **🔴 必做（不能只看 open）：`bash skills/dsh-github-triage/scripts/check-dependabot-closed.sh`** — 复查**已关闭**的 Dependabot 告警，见下方「Dependabot 已关闭告警必须单独复查」

具体参数见 `ghops <命令> --help`；命令不存在时用 `python3 <github-ops 技能目录>/scripts/ghops.py` 代替。

### Dependabot 已关闭告警必须单独复查（假阴性防线，issue #214）

**为什么**：GitHub 对 npm **development scope** 的告警（含传递依赖）默认开启 auto-dismiss，公开仓库 on-by-default。被自动关闭的告警**不在 open 视图里**，于是「报了但被自动关闭」与「根本没报」表面上无法区分——2026-09-02 本仓库两条 `qs` 告警（#2/#3）就是这样被静默关闭，10 天后才在人工排查里偶然发现，并已实际造成 #199 写下「Dependabot 未覆盖该链路」的错误结论。**只看 `--state open` 会漏报。**

**怎么查（一条命令，只读）**：

```bash
cd <仓库工作区>
bash skills/dsh-github-triage/scripts/check-dependabot-closed.sh baosfeng/my-dsh-plugins .
```

它做三件事：① 列出**全部已关闭**的 Dependabot 告警（`fixed` / `dismissed` / `auto_dismissed` 都算）；② 逐个核对告警对应依赖是否**仍以受影响版本留在本地 lockfile**（并指出由哪个包引入）；③ 把「已关闭但依赖仍在受影响范围」的单列出来；退出码 1 = 需人工判读，0 = 干净。脚本不可用时的手工等价两步：

```bash
ghops alerts baosfeng/my-dsh-plugins --state closed --kind dependabot                   # 先人看：状态/包名/严重级
ghops alerts baosfeng/my-dsh-plugins --state closed --kind dependabot --json > /tmp/db-closed.json
python3 skills/dsh-github-triage/scripts/check-dependabot-closed.py /tmp/db-closed.json --repo-dir .
```

**判读规则**：

| 判据                                                     | 结论                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `auto_dismissed` 且 `dismissed_by`/`dismiss_reason` 为空 | 系统自动关闭（非人工），**必须按事实复核**，不能当成已修复                                                                              |
| 脚本报 `⚠ 仍受影响`                                      | 关闭理由与事实不符 → 升级依赖消除漏洞，按「安全告警」类问题派发                                                                         |
| 脚本报 `✔ 已升到修复版` / `✔ 已不在依赖树`               | 确已修复，无需动作（汇总里记一笔即可）                                                                                                  |
| `state` 是 `fixed` 而查不到 `auto_dismissed_at`          | 依赖升到修复版后 GitHub 会把 auto_dismissed 覆盖成 fixed 并**清空** `auto_dismissed_at`；查不到 ≠ 没发生过，历史只在告警详情页 timeline |

**派发本类问题的 prompt 必带**：巡检脚本原始输出（告警编号/依赖/受影响范围/修复版本）+「先判断是误关还是真已修复」+「修复后复跑同一脚本确认退出码变 0」。

**排序：** 合并所有待处理问题后**按编号从小到大排序**（编号小的先处理），作为派发顺序。主 agent 严格按此顺序推进，不得乱序、不得跳过。

## 第二步：派发子 agent（从小到大，主 agent 把控）

按排序后的问题清单逐个派 `subagent`。**并行派发前找用户确认数量**（上限 3 个；执行时确认，不自行决定；fork 物理隔离保证并行安全，但资源与上下文有限）。**每个 prompt 必须自包含**（子 agent 看不到当前对话），包含：仓库、问题完整内容、任务、约束、验收、期望输出：

```
- 背景：仓库 baosfeng/my-dsh-plugins；问题类型+编号+链接；问题标题与正文/告警摘要
- 任务：定位根因（可读本地代码）→ 修复；能改就改，不能改给出根因与建议
- 约束：不 push 主分支；**只在分配给你的 fork 工作**（/tmp/gh-fork-<编号>，目录已就位，不要 cd 到其他目录）；在该 fork 内建独立分支 fix/<编号>；一任务只一个分支一个 PR，PR 标题带问题编号；任何 GitHub 操作使用 `github-ops` 的 ghops 命令（首次 ghops setup），不得调用 API/读取凭据
- 验收：修复代码 + 本地测试通过（npm test）+ PR 已创建；见「验收标准」逐项自查
- 停止条件：**约 100 步内必须产出 PR**；到点未完成就先交阶段性成果并回报卡点，不要继续跑。同一命令/skill 连续失败 3 次即停并上报，**不得反复重试**（每次重试都会重发全部上下文）。轮询 CI/等异步结果用 `ghops actions watch` 后台等，不要逐步查
- 输出：根因一句话 + 修复方案/变更文件 + PR 链接（如适用）。**只回传结论与证据，不要回传全量 diff / 全量日志**
```

### 派发成本纪律（token 零容忍，leader 必须执行）

**成本公式**：`总消耗 ≈ Σ(每一步的完整上下文)`。不是「步数 × 单次成本」，而是「步数 × **当时累积的上下文**」。实测一次本流程：output（真正生成的内容）只占 **1.2%**，其余全是**重复发送已有上下文**。省钱不靠让模型少说话，靠**别让会话拖长、别让上下文膨胀、别让失败重试**。

- **压缩阈值：先验证再调，不要照搬直觉**（⚠️ 已用实测数据修正）：直觉是「`thresholdRatio` 默认 `0.8` 在 100 万窗口下几乎等于不压缩（涨到 80 万才动）→ 应压到 `0.15~0.25`」。但会话落盘数据给出**相反**结论：**账面消耗的 99% 发生在「缓存命中读取」上**（某轮 1.38 亿 token 中，全新 input 仅 **0.77M**），而**压缩会改写前缀 → 缓存失效 → 此后每次请求都变成全价新 input**，换来的只是每步上下文从 16 万降到 10 万，**总成本很可能上升**。故：**降本主力是砍步数**（见下一条），压缩阈值保持保守默认；确需调整必须先做「同任务 / 同 prompt / 开-关压缩」的对照实测。**另注**：`~/.dsh/profiles/<profile>/cordis.patch.yml` 是**自动生成**的（文件头即写 `Auto-generated`），**手工追加的条目会在重新生成时被覆盖**——实测手改 `compaction-basic` 后该条目随即消失，故这条建议在本环境无法靠手改 profile 落地。
- **子 agent 步数设上限（~100 步）**：交付型任务应在 100 步内产出 PR。实测 249 步的子 agent 因平均上下文 16 万，**单会话烧掉 4,000 万**——步数多 × 上下文大是乘法关系。到点先交阶段性成果，再用 `send_message` 续接，而不是一路跑到底。
- **失败重试必须熔断**：同一 step 重试会把**当时的全部上下文**原样重发。实测一次 `TRANSPORT` 失败在同一 step 连撞 4 次，每次都重发 47 万 token。连续失败 3 次即停并上报，不靠重试硬撞。
- **重活下沉到脚本，不要逐步问模型**：跑测试、轮询 CI 用后台任务 + 脚本判定（`ghops actions watch`），禁止让模型每步问一次「跑完了吗」——每次交互都等于重发一次全部上下文。
- **子 agent 只回传结论，不回传过程**：交付物是「根因一句话 + 变更文件 + PR 链接 + 验收证据」，**不要把全量 diff、全量日志带回 leader**。leader 上下文涨一分，它后续每一步都贵一分（实测 leader 自身 696 万，而 6 个子 agent 合计 1.18 亿，是 17 倍）。
- **上下文预算：leader 与子 agent 不同档，不要一刀切**：**leader 会话不受限制，可用到 contextWindow 的 60%**（约 60 万）—— 它承担拆解/验收/汇总，上下文天然偏大，**不要用"收尾"去卡它**；**子 agent 上限 30%**（约 30 万），到点先固化成果再收尾。注意上下文是**安全边界**，不是成本目标 —— 成本主力始终是**步数**，因为「步数 × 上下文」才是乘法。
- **观测口径**：会话落盘 `~/.dsh/sessions/<cwd-转义>/<session-id>/session.v3.jsonl.zstd`，`zstd -d -c` 解压后读 `assistant/message` 事件的 `usage`（`inputTokens`/`cacheReadTokens`/`outputTokens`）。**子 agent 是独立会话文件，统计成本必须递归 `subagent/catalog` 的 `childId`**，否则严重低估。**已封装为一条命令**：`node scripts/agent-cost.mjs`（扫同目录下全部会话文件，无需手工递归；退出码 1 = 有超限会话）。

### 硬预算与熔断（把 token 变成派发的**第一约束**）

**为什么**：实测一轮 issue triage 烧掉 **1.36 亿 token / 1121 步**，其中多个子 agent 跑到 190~249 步。**一个「简单 issue」花掉几千万，永远是范围没切小或 prompt 没给边界，不是模型慢。** 因此预算必须在派发**前**定，而不是事后复盘。

| 档位 | 典型形态                             | 步数上限 | 上下文上限（子 agent） |
| ---- | ------------------------------------ | -------- | ---------------------- |
| 简单 | 单文件小改 / 加一条检测 / 改一处配置 | ≤ 40     | ≤ 10%                  |
| 中等 | 多文件 + 配套测试                    | ≤ 70     | ≤ 20%                  |
| 复杂 | 跨模块 / 跨仓库 / 大量测试           | ≤ 100    | ≤ 30%（硬顶）          |

- **派发前（缺一不许派）**：prompt 必须写明 ①「预算：≤ N 步 / 上下文 ≤ X%」；②「到点先交**阶段性成果**并回报卡点，不要继续跑」；③「只回传**结论与证据**，不回传 diff / 日志 / 全量输出」。任务范围要能落进上表某一档，落不进就先拆。
- **派发后（必做）**：跑 `node scripts/agent-cost.mjs` 看活跃会话；**超限立即 `send_message` 收尾**（要它把手上的成果 commit + push + 建 PR，未完成项如实报告），**不要等它自己跑完**。
- **每完成一个子 agent 就重测一次**：并行时成本会在无观测状态下翻倍；`agent-cost` 退出码 1 即代表该收尾了。
- **一轮只做一个大活**：不要在同一轮里既修 bug、又写文档、又补机制；prompt 里的「顺手做」一律砍掉。
- **禁止**：无预算派发、无观测连发、把「继续跑」当默认、为等异步结果逐步轮询。
- **成本判定优先于完成度**：会话若已越过上限而任务只完成一半，**先固化已有成果**（commit/PR），剩余部分由 leader 决定是否用新会话续接——不要让一个会话无限跑到终点。
- 🔴 **真正的成本来源是「工具调用次数」，不是模型慢（实测定位）**：6 个子 agent 的 **bash 调用占步数 60~77%**（150/249、146/190、150/220、69/106），每次平均 7~10 秒 → 单会话**活跃 18~37 分钟**，这正是"半小时做一个简单 issue"的来源。**一次工具调用 = 一个 step = 一次完整上下文重发**。因此派发 prompt 必须强制四条：
  1. **给「已确认事实」清单 + 禁止验证**：fork 目录/分支/node_modules/hooks/内部包指向等由 leader 保证的事实写死在 prompt 里，并明写「**直接开始改代码，不要 `pwd`/`ls`/`git status`/`git log` 去确认这些**」—— 实测子 agent 的第一个工具调用常是纯验证（`pwd && ls -la <fork>`）。
  2. **要求合并命令 + 探索预算**：「**探索阶段 ≤ 8 次工具调用**；一次 bash 用 `&&` 串联多件事，**不要一条命令占一个 step**」。
  3. **禁止重复**：「同一命令不得原样重跑（实测同一 `npx vitest run` 跑 3 次、同一文件 `read` 8 次）；改文件用 `edit`/`write`，**不要用 `python3 - <<PY` 写脚本改**；同一测试只跑一次，要复跑必须说明上次为什么无效」。
  4. **工具调用预算与步数同量级**（近似 1:1）：简单 ≤ 40 次、中等 ≤ 70 次、复杂 ≤ 100 次。**到点即收尾**，不要"再确认一下"。

### fork 池（隔离方案，必须遵守）

主 agent 按派发顺序**逐个**准备 fork（不提前批量派生），子 agent **只在自己被分配的 fork 内工作**。

**主路径（一条命令，issue #240）**：

```bash
node scripts/fork-pool.mjs create <编号>            # 等价于下面手工 5 步 + node_modules 就位 + 装 hooks，实测 3.3s
cd /tmp/gh-fork-<编号>                              # 子 agent 从这里开始工作
node scripts/fork-pool.mjs check                    # 推送前自检：hooks / 工具链 / 基线 SHA / 误暂存，四项 yes/no
node scripts/fork-pool.mjs clean <编号> --yes       # 收尾清理（只允许删 /tmp/gh-fork-*）
```

它比手工多做三件事（都是踩过坑才补的）：**基线 SHA 校验**、**node_modules 逐包软链且不漏隐藏的 `.bin`**、
**默认装 hooks**（不装则 commit/push 完全不跑本地门禁，见
[踩坑：fork 池钩子与工具链未就绪](../../docs/踩坑/README.md)）。
可用 `--no-hooks` 关闭装钩子、`--node-modules symlink|copy|none` 换就位策略、`--branch` 换分支名。

**兜底（脚本不可用时的手工 5 步，与脚本等价）**：

```
git -C <主工作区> fetch origin && git -C <主工作区> merge --ff-only origin/main   # ① 先同步主工作区本地 main（fetch 只更新 origin/main 引用、不移动本地 main）
git clone --local <主工作区> /tmp/gh-fork-<编号>               # ② 本地派生 fork：零网络、秒级（实测 ~1.4s）
git -C /tmp/gh-fork-<编号> remote set-url origin https://github.com/baosfeng/my-dsh-plugins.git      # ③ fetch 走 https+代理
git -C /tmp/gh-fork-<编号> config remote.origin.pushurl git@github.com:baosfeng/my-dsh-plugins.git   #    push 走 SSH（不经代理，代理挂了也能推）
git -C /tmp/gh-fork-<编号> fetch origin main                   # ④ 显式从 GitHub 拉一次 main（clone --local 带进来的是主工作区本地 main）
git -C /tmp/gh-fork-<编号> checkout -b fix/<编号> origin/main  # ⑤ 从远程最新 main 建分支（子 agent 直接在其上工作）
```

> ⚠️ **用 `ghops clone` 直接克隆（不走本节 ②③ 流程）时，第 ③ 步不能省**：`ghops clone` 只配 https 的 fetch/push URL，而 https 推送无凭据（实测报 `Invalid username or token. Password authentication is not supported`）。补一条即可（实测 #198c）：
>
> ```bash
> git -C /tmp/gh-fork-<编号> remote set-url --push origin git@github.com:baosfeng/my-dsh-plugins.git
> ```
>
> 判据：`git -C /tmp/gh-fork-<编号> remote -v` 的 push 行是 `git@github.com:...`（与主工作区一致）。

> ⚠️ **fork 内 pre-commit / commit-msg / pre-push 钩子默认不生效**（clone 不会跑 `npm install` → `npm prepare` → `husky` 未执行 → `core.hooksPath` 未设置、husky v9 的钩子目录未生成）。后果：lint-staged 不会自动 prettier/eslint 你的改动，门禁要到 CI `quality` job 才暴露——**每个子 agent 都会踩，白烧一轮 CI**（实测 #198c：`test/persist-race.mjs` 未格式化 → CI format 红）。一行启用（实测有效：探针提交被 lint-staged 正常拦截）：
>
> ```bash
> git -C /tmp/gh-fork-<编号> config core.hooksPath '<husky 钩子目录绝对路径>'
> ```
>
> 其中 `<husky 钩子目录绝对路径>` = 主工作区 `git config core.hooksPath` 的输出（husky v9 生成，位于主工作区仓库根的钩子目录下）。判据：`git -C /tmp/gh-fork-<编号> config core.hooksPath` 有输出；不想配 hook 的兜底是提交前手动跑 `npx prettier --check . && npx eslint plugins/`。
>
> **更好的一行**（等价且自洽，推荐）：`cd /tmp/gh-fork-<编号> && ./node_modules/.bin/husky` —— 它会生成 `.husky/_` 并写好 `core.hooksPath`。有脚本时直接 `node scripts/fork-pool.mjs check` 即可一眼看出装没装。

规则：

- **每个修复类子任务拥有且仅拥有一个 fork**（`/tmp/gh-fork-<编号>`）；主工作区（`/Users/bsfeng/IdeaProjects/my-dsh-plugins`）与任何其他 fork 都不得被该子任务操作
- fork 用 `git clone --local` **本地派生**：不重复走网络、也不调用 REST API（无速率限制），秒级完成；**不是**远程克隆，主工作区未提交改动不会混入 fork（只含已提交内容）
- **本地派生的 origin 默认指向主工作区本地路径，必须重设为 GitHub 远程**（`set-url` 设 https 给 fetch + `config remote.origin.pushurl` 设 SSH 给 push，理由见上方「网络前置」），否则 push 会推到本地路径（静默失败/污染）
- **基线坑（必读）**：`git clone --local <主工作区>` 的 `origin/main` 取的是**主工作区本地 main**——clone 只把源的 `refs/heads/*` 映射为目标 `refs/remotes/origin/*`，**不复制** remote-tracking refs；而主工作区 `git fetch` 只更新 `origin/main` 引用、**不移动本地 main**。因此 ① 的 `merge --ff-only` 与 ④ 的 fork 内 `git fetch origin main` 缺一不可。**判据**：`git -C /tmp/gh-fork-<编号> log --oneline -1` 与 `git ls-remote origin refs/heads/main` 的 SHA 一致（详见 [踩坑](../docs/踩坑/README.md)）
- **`git cherry` 判不了 squash 合并**：squash 后 patch-id 必然不同，`git cherry -v <main> <branch>` 会对已合并的提交全部标 `+`（假阴性），据此判定「遗留工作未落地」是错的。正确判法：先查 main 历史里的 squash 提交/PR 号（`git log --oneline --grep="#<PR>"`），再比对 `git diff <base>...<branch> | git patch-id --stable` 与 `git show <squash-commit> | git patch-id --stable` 的**第一列**（详见 [踩坑](../docs/踩坑/README.md)）
- **不要让多个子 agent 同时跑全插件测试**：`node scripts/verify-local.mjs --fast` 并发时会 `EXIT=124`（资源竞争，实测两个 agent 同轮都超时），不是代码问题——同一插件同一时刻只允许一个测试进程，以 CI 结果为准或在无竞争时段重跑（见 [多 agent 并行测试资源冲突](../docs/踩坑/README.md)）
- **fork 里跑工具链的依赖软链不要 `git add -A`**：`ln -s <主工作区>/node_modules /tmp/gh-fork-<编号>/node_modules` 之后，`.gitignore` 的 `node_modules/` 规则**不匹配符号链接**，`git add -A` 会把它当新文件暂存（误提交/体积事故）——只 add 自己改动的文件，或先把 `node_modules` 写进 `.git/info/exclude`（本地生效、不进仓库）
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
   - CI 状态：`ghops pr checks baosfeng/my-dsh-plugins <PR 编号>` 一条命令看该 PR 的 CI 结论与失败 job 名（**不要**用 `actions list --ref` 判分支，见「第一步：收集问题」）；要追某个 run 才用 `ghops actions logs ... --expect-branch <该 PR 的 head 分支>`
   - **执行性验证派独立验证 agent**：真实环境验证（隔离实例 + 浏览器走查、复现、截图确认）等**执行性**验证工作，派独立验证 agent 执行（可续接有验证经验的原子 agent，如盲测验证 agent），**leader 不亲自执行**——亲自验证会污染 leader 上下文（大量可丢弃的中间过程），验证 agent 只回报结论与证据（截图/日志/复现步骤）。leader 只做**决策性核查**：看证据是否充分、结论是否可信、验收标准是否逐项满足
3. **不达标/失败处理**：子 agent 失败/上下文耗尽/卡住后，**优先用 `send_message` 续接原子 agent 继续干活**（它保留上下文与进度，处于可续接状态）——**不自己动手、不派新 agent**；仅当原子 agent 彻底失效（无法续接）时才重派新 agent；**绝不带着未达标结果推进下一个**
4. **自主决策（全权委托时）**：验收通过后自主合并 PR（squash + 删分支）、关闭已解决 issue（评论附 PR 链接）、补发 release（删 tag 重推等）；仅在破坏性/公开 API 变更、或用户未全权委托时，才汇总询问用户决策
5. **成本监控**：续接/验收时看一眼该会话上下文规模，**越过 20 万即判定失控**——立即让它压缩或先交阶段性成果收尾；子 agent 反馈「一直在重试」时**先叫停再排查**，不要放任重试烧上下文
6. 验收通过后：记录状态、清理该 fork（`rm -rf`）、按序进入下一个问题

### 子任务独立提交

- 每个子 agent **验收达标后立即单独提交**（无需等其他子任务）：在分配的 fork 修改 + `git commit` → `ghops push --dir <fork> --branch` → `ghops pr create`（标题/正文按下方规范）
- 各子任务分支互不依赖；**一个子任务 = 一个分支 = 一个 PR**，绝不合流到其他人提交
- 无法修复的子任务：把根因与建议作为 `ghops issue comment` 发表到对应 issue（PR 问题则 `ghops pr comment`），不建空 PR
- 创建 PR 即算"独立提交"完成；**是否合并由汇总阶段统一决策**，子 agent 不自行合并

## 验收标准

### 按问题类型判定"已完成"

| 问题类型           | 达标条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| issue（BUG/需求）  | 根因确认 + 修复代码 + 本地测试通过 + 已建 PR；一个 PR 只覆盖这一个 issue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 安全告警           | 依赖/代码已修复，升级前查 CHANGELOG/breaking changes 确认兼容；测试通过；已建 PR；无修复版本时给出原因与建议并评论到 issue。**Dependabot 类必须附已关闭告警复查证据**：`check-dependabot-closed.sh` 的输出 + 退出码由 1 变 0                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Actions 失败       | 先 `ghops pr checks baosfeng/my-dsh-plugins <PR 编号>` 确认**这个 PR 到底红没红、红在哪个 job**（#347：`actions list --ref` 会静默返回别的分支的 run，别用它判 CI）→ `ghops actions logs baosfeng/my-dsh-plugins <run-id> --expect-branch <该 PR 的 head 分支> --jobs` 拿**全量 job 清单**（归属不一致会明确报错拒绝，不会把别人的日志给你；不要从日志内容反推有哪些 job——旧版就是这么漏掉失败 job 的，见 `docs/踩坑/README.md`）→ `--job "<失败 job 名>"` 精确取正文，stderr 的「日志已获取 M/N」会如实报告缺口；单个 job 取不到时按提示走替代路径（网页 job URL）→ 定位失败步骤与根因 → 修复 + 已建 PR；CI 重跑通过（重跑仍失败则继续排查，不得标记完成） |
| PR 健康检查        | 确认问题（冲突/CI 红/无 review/超时）→ 用 `ghops pr checks baosfeng/my-dsh-plugins <编号>` 判定 CI 是否真红 → rebase 最新 main 解冲突或修复 CI → CI 重跑绿（再跑一次 `pr checks` 复核）→ 更新 PR 描述/评论说明；无法处理给建议评论到 PR                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CICD workflow 维护 | 修改目标明确（新增/优化/修复 workflow 文件）→ 本地语法校验（YAML 解析）→ 改动 + 已建 PR → 触发相关 action 重跑通过                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 分析类（不改代码） | 给出明确结论（无需修复 / 等上游 / 建议方案）并发布到对应 issue/PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### 通用要求（所有子任务）

- PR 描述含：**根因、修复内容、验证结果**（测试命令 + 关键输出）；标题遵循仓库提交规范（Conventional Commits，见 .reasonix/skills/commit-standards），格式 `fix(scope): #<编号> 简述`
- 改动聚焦本问题，**不顺手重构无关代码**；遵循仓库质量门禁（.reasonix/skills/quality-gates、coding-standards；测试用 `npm test`，插件改动同步对应 issue 验收标准与 CHANGELOG）
- **PR 创建后确认 CI 已跑绿**：`ghops pr checks baosfeng/my-dsh-plugins <PR 编号>` 看结论（`✅ 全绿` 才算过；`⚠ 没有任何 check` 说明 CI 根本没触发，**不等于绿**）；红则继续修，不得宣称完成
- 验收未达标的子任务**不得提交 PR**——继续修或转为分析类输出，绝不带着失败提交

### 可靠性类插件严格验收（dsh-task-reliability 等）

对「保障可靠性」类插件（典型：dsh-task-reliability——用户多次指出其反而引入不可靠问题）的问题修复，在通用要求基础上**额外强制**：

- **防回归测试**：必须先写失败单元测试精确复现原 bug（含边界时序），再修复转绿（quality-gates 门禁），不允许只修症状
- **真实环境验证**：按 verifying-dsh-plugins 在隔离 DSH 实例 + 真实 GUI 走通关键路径——依赖真实进程/时序/GUI 的行为（如 ask 缓冲竞速、回答透传/不丢失、重启恢复）必须真实验证，纯单元测试不足
- **全量回归**：跑插件全部测试 + 对照 issue 验收标准逐项回归，不得削弱既有功能
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

汇总后**必须给出一张处置表**并逐条反馈，而不是只列「待用户决策」：

| 对象               | 决策               | 理由                                    | 链接        |
| ------------------ | ------------------ | --------------------------------------- | ----------- |
| PR #18 / issue #12 | 合并 + 关闭 issue  | 本地测试 + CI 绿 + 隔离实例验证通过     | https://... |
| PR #20             | **不合并（暂缓）** | 缺真实环境验证；解锁条件=补隔离实例证据 | https://... |

**合并与不合并都必须反馈**（用户明确要求）：全权委托下 leader 仍**自主拍板、先做**，但每轮汇报都要逐条说清「哪个 issue/PR 合并了、哪个没合并、为什么、什么条件下再推进」，并在对应 PR/issue 上公开留痕（`ghops pr comment` / `ghops issue comment`）——**不得静默合并、不得静默丢弃**（规范见 docs/开发指南/工程效率规范.md 第十二节）。**验收未通过/卡住的子任务单列并说明原因与下一步**。**用户全权委托时**：主 agent 自主执行合并/关闭/补发（验收通过即执行，汇总表记录结果）；**未委托时**：用户确认后由主 agent 统一执行（`ghops pr merge` / `ghops issue close`）。

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
| 只看 `ghops alerts --state open` 就断言「没有依赖漏洞」       | 默认视图**只列 open**，被 auto-dismiss 的告警与「没报过」表面无法区分（#214 已造成一次误判）；每次收集都必须跑 `check-dependabot-closed.sh`，见「Dependabot 已关闭告警必须单独复查」与 [踩坑](../docs/踩坑/README.md)                                                                                                                                                  |
| 把 `auto_dismissed` 当成「已修复」或反过来当作「GitHub 说的」 | auto-dismiss 是 GitHub 的**启发式**（npm dev scope 传递依赖，公开仓库默认开），会误关真实漏洞；必须拿 lockfile 里的实际版本与 `security_vulnerability.vulnerable_version_range` 对一遍（脚本已内置）                                                                                                                                                                   |
| 关闭 PR 时让用户去网页操作                                    | `ghops pr` 没有 close 子命令（只有 create/list/view/comment/merge）；**PR 在 GitHub 上即 issue，用 `ghops issue close <repo> <PR 号>` 即可关闭**（2026-09-15 实测有效，#292）                                                                                                                                                                                          |
| 用双引号传含反引号的评论正文                                  | `ghops <x> comment … --body "… `code` …"` 里的**反引号会被 shell 当命令替换执行**：正文残缺、还可能真的跑起命令（实测误触发了 `npm audit`，并打出 `command not found`）。**正文含反引号 / `$` / `!` 时必须用 heredoc**：`BODY=$(cat <<'EOF' … EOF)` 再 `--body "$BODY"`（`'EOF'` 加引号才禁止展开）；发完**回读一次**确认正文完整（`ghops issue view <n> --comments`） |
