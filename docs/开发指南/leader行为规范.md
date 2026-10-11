---
title: leader 行为规范
description: 项目侧 leader 落地 — 只写本仓库独有的判据、命令、取值与例外；通用派发 / 并行 / 验收 / 汇报规则一律指向全局 leader-ops skill
---

# leader 行为规范（项目侧落地）

> **通用 leader 规则（派发 / 并行 / 验收 / 汇报）唯一权威 = 全局 `leader-ops` skill**——本仓库不复制、不另立；本文件只写**全局 skill 未覆盖、或本仓取值不同**的落地项。
> **何时阅读**：leader 派发前、验收前、决定是否亲自执行前；子 agent 也读（用于确认本仓判据）。

## 〇、全局 skill 逐节 → 本仓落点

| 全局 `leader-ops` 节 | 本仓额外的，或取值不同的 | 落点 |
| --- | --- | --- |
| §一 派发闸门 / 自执行熔断 | 例外：真实环境验证归用户本人；全量门禁与发版由 leader 单点自做 | 第一 · 五 · 六节 |
| §二 并行与拆分 | 全量门禁单点；巡检周期与负载熔断阈值 | 第一 · 四节 |
| §三 隔离与合并 | 一任务一 fork → 一分支 → PR；基线冻结由 `fork-pool check` 判定 | 第九节 |
| §四 派发七项 | 插件改动的判据必含「必跑清单」；只读任务禁建临时脚本 / 禁跑 `--fix` | 第七 · 八节 |
| §五 验收 | 格式检查 + 整体验证两条固定判据；无关红 / 否定性结论的本仓取法；绕门禁红旗的本仓例外 | 第二 · 三 · 十 · 十二节 |
| §六 偏差处置 | 落库位置三分法 | 第十一节 |
| §七 文档与汇报上限 | 直接采用全局数值（≤30 行 / ≤5 条），本仓只补「汇报四要素」 | [工程效率规范](工程效率规范.md) 第十三节 |
| §八 先实现后测试 | 无额外约定（本仓同样不以 TDD 为驱动） | — |
| §九 机制选型 | 本仓以 subagent 为主 + fork 池隔离；团队用法与降级补偿 | 第九节 |

## 一、全量门禁单点（`npm run verify`）

- 全量门禁（`scripts/verify-local.mjs`，含 build / vitest / cucumber 等重型等价套件）**同一时刻最多 1 路**，**写操作全停后由 leader 单点跑一次**——并行写 + 全量门禁互读中间态 → **假红**（点名的常是另一个 agent 正在改的文件）；判定：`pgrep -fl 'verify-local|test-all.sh'` 命中 ≤ 1。
- 子 agent 只跑改动范围内的定向测试：`cd plugins/<插件名> && npm test` 或 `npx vitest run <file>`——派发 prompt 出现 `npm run verify` 即违规。

## 二、验收判据必含格式检查（`npx prettier --check <改动的文件>`）

- 凡派发**会改动文件**的任务，判据必须固定包含：对**该任务改动过的文件**跑 `npx prettier --check <files>`，并要求子 agent **贴出 exit 0 的输出**——「已格式化」这类自述不算证据（`npm run format:check` 是 CI 阻断项，也是最高频的红；不改文件的任务不适用）。
- **反模式**：判据写「风格一致」而不给命令；只跑全仓 `--check .` 而不限定改动文件（把基线既存问题混进本次范围）。

## 三、判据必含整体运行环境验证（`npm run test:scripts`）

- 凡任务**新增 / 修改测试**，或改动触及并发 / 子进程 / 临时目录 / 端口 / 全局状态，判据必须固定包含**整体**命令 `npm run test:scripts` **整体绿** + 关键输出（含该文件耗时）；判据里必须出现原句：**单文件精跑绿不构成完成证据**。
- **为什么**：负载敏感性只在整体运行时暴露——同一测试单文件精跑 **3.45s 绿**，整体并行 **17.8s 超时红**（`Error: 调用方进程未在 15s 内报告服务 PID`）（[踩坑：异步落盘与时序](../踩坑/异步落盘与时序.md)）。
- **执行归属**：整体套件是独占资源，**由 leader 在写操作全停后单点跑一次**（第一节）；子 agent 贴定向证据并标注「需整体验证」，不得并行跑整体套件。
- **反模式**：只跑单文件就宣布完成；明知负载敏感只调大超时阈值——**调阈值只是把红挪走，不是修**。

## 四、巡检与卡死判定

- 巡检命令：`git -c core.quotePath=false status --short`；关键文件 mtime：`stat -f '%Sm %N' <文件>`。
- **巡检周期 = 2 分钟**（相邻两次巡检的间隔）；判据与「重派前必须再复查一次」见全局 `leader-ops` skill §二「巡检判据」。
- **负载熔断**：启动多路并行前先 `uptime`，1 分钟均值 > `sysctl -n hw.ncpu` × 1.5 则不启动——本仓 `verify-local` 检查项并发 4、插件测试并发 6，CPU 余量比通用场景更小。
- **inactive ≠ 完成 ≠ 成功**：只认回报里的命令 + 输出，不认「已完成」自述；等不到回报按上一行判据处理。
- **反模式**：等「agent 自己会回来」、把「没有消息」当成「正在正常干活」；判卡死后不复查就重派 → 两个写者同 write scope 并发写。

## 五、真实环境 / 浏览器验证归用户本人

- 隔离实例起停、真实浏览器走查、真实模型调用由**用户本人**手工做：agent 不代跑、不新增自动化 e2e / 浏览器测试，只提供步骤与清单（[verifying-dsh-plugins skill](../../skills/verifying-dsh-plugins/SKILL.md) · [人工自测清单模板](../../verification/README.md)）——这是全局 `leader-ops` skill §一「点名必派」的**例外**。

## 六、发版：3c 门禁与执行归属

- 命令 `node scripts/release.mjs <插件名> [--push]`；未带 `--confirm-manual-tested` 即阻断，**不静默跳过**（清单模板 [verification/README.md](../../verification/README.md)）。
- **归属例外**：本仓发版是单点独占的单向外发动作（`release.mjs` 直推 `main` 并打 tag、不建 PR；tag 已存在即拒绝覆盖），由 leader 本人执行——全局 §一「发版属点名必派」在本仓的例外；**发版前的取证**（打包产物 / 体积 / 依赖基线 / CI 绿）仍须派发。

## 七、插件任务的判据必含「必跑清单」

- 凡派发**改动插件**的任务，判据除定向测试外必须逐条写入 [构建与测试](构建与测试.md) 的「派发插件任务的必跑清单」：`npx eslint plugins/<name>/` · `npm run lint:size` · `node scripts/check-test-sleeps.mjs` · `npx knip` · 客户端产物三查。
- **为什么**：这些是 CI 阻断项，但插件自测查不到（实测：插件四条命令全绿，仍被 pre-commit / verify 拦下）。
- **反模式**：判据只写 `cd plugins/<插件名> && npm test`。

## 八、只读任务的禁令（本仓钩子会改文件）

- 本仓 pre-commit / pre-push 钩子本身就会 `prettier --write` / `eslint --fix`（fork 池创建时也会装 hooks）——这是全局 §四「只读任务禁令」在本仓最容易踩的形态，误触会把越界改动变成既成事实。
- 因此每次派发只读任务后必须核主工作区 `git status --short`：越界写入当场回滚并登记。

## 九、并行写、隔离与收尾（本仓取值）

- **write scope 粒度 = `plugins/<插件名>/`**：插件自包含，同一插件目录同一时刻只允许一个写者；跨插件改动视为跨 scope，串行或分派多路。
- **共享热点只许一路写**：`scripts/verify-local.mjs` 的检查表、根 `package.json`（依赖与 scripts）、`AGENTS.md` 与 `docs/` 入口、`.github/workflows/**`。
- **写任务一律进 fork 池**：`node scripts/fork-pool.mjs create <issue 编号>`；唯一允许操作的目录是该 fork，推送前 `check <编号>` 自检，合并走 PR——细节见 [需求分诊与派发](../../skills/dsh-github-triage/SKILL.md)。
- **基线冻结**：子 agent 不得自行 rebase 上移基线；`fork-pool check` 报「基线已过期」即回报 leader，由 leader 决定 rebase 并重新冻结。
- **机制选型**：本仓以 **subagent** 为主（一次性调研 / 验收取证 / 换人复审 / 盲测）；需要多轮往返、多个写者长期并行、或任务间有先后依赖时才用 Agent Teams teammate，并在任务板上落 owner 与 write scope。**降级补偿**（无团队路径时）：更严的验收冻结 + 写死 write scope + fork 池隔离。
- **收尾核验**：`node scripts/fork-pool.mjs list`（本仓对应全局的 `git worktree list`）+ 主工作区 `git status --short` 回到派发前状态；清理用 `clean <编号> --yes`。

## 十、验收纪律（本仓取值）

- **标准先冻结**：验收命令在派发**之前**发布；派发后改标准 = 重新派发。**冻结前 leader 自己先跑通一次**——本仓高频形式错是把 `npm run verify` 写进子 agent 的判据（第一节已禁）。
- **无关红自证**：在**未含本次改动**的基线上复现同一命令，基线取另一个 fork 的 `origin/main`；**禁止用 `git stash` 把别人正在写的改动藏起来**。判「偶发」须三证（上一提交全绿 + 本次 diff 不触碰 + 本地重复稳定）。
- **否定性结论交检索**：本仓符号查询走知识图谱，**0 结果 ≠ 不存在**——必须附 `npm run index:self --status` + 检索命令 + 检索范围 + 输出。
- 其余（抽检时机、结论归 leader、取证例外仅四项、前提不成立、复审独立性、外发动作归原 owner）：按全局 `leader-ops` skill §五执行，本仓无额外约定。

## 十一、偏差处置的落库位置（本仓三分法）

发现「本该早发现而没发现」的问题（门禁盲区 / 规则被架空 / 重复复发 / leader 失职）→ 当场登记 + 当场行动，落点按下表：

| 性质 | 落点 |
| --- | --- |
| 通用（换个任务仍成立） | 全局 `leader-ops` skill——本仓库不得在本文件新立通用规则 |
| 本仓专属判据 / 命令 / 取值 | 本文件 |
| 本仓踩坑的取证与修法 | [踩坑目录](../踩坑/README.md)（症状 → 解法速查） |

## 十二、`--no-verify` 特许路径（「绕门禁 = 红旗」的本仓例外）

| 特许路径 | 补偿门禁（必须真跑并贴输出） | 依据 |
| --- | --- | --- |
| 纯 `.md` 改动推送 | 三条文档门禁不可豁免：`npm run check:links` · `node scripts/check-docs.mjs` · `node scripts/check-doc-api-drift.mjs`，加两条秒级 grep 自检（悬空引用 / 残缺链接） | [文档规范](文档规范.md) 第六节 |
| `node scripts/ship.mjs --push` | 跳过 pre-push 钩子，但自己必跑 `verify-local`（默认 **`--full`**；`SHIP_VERIFY_MODE=fast` 才降级）——门禁从「推送前阻塞」改成「推送后并行」，未削弱 | [工程效率规范](工程效率规范.md) 第五节 |

- 除此之外**不得出现第三条无补偿的 `--no-verify` / `HUSKY=0`**；验收遇绕过时，先核补偿门禁是否真跑，再判过。

## 参考

| 文件 | 内容 |
| --- | --- |
| [AGENTS.md](../../AGENTS.md) · [工程效率规范](工程效率规范.md) | 精简协作原则与强制规则 · 流程化 / 并行 / 汇报与验证纪律 |
| [构建与测试](构建与测试.md) · [踩坑目录](../踩坑/README.md) · [需求分诊与派发](../../skills/dsh-github-triage/SKILL.md) | 必跑清单与 verify-local 用法 · 每条陷阱的取证与修法 · fork 池与 issue/PR/CI 处理 |
