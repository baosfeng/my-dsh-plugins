---
title: leader 行为规范
description: 项目侧 leader 落地 — 全量门禁单点、判据必含格式检查与整体验证、巡检命令、用户人工验证、发版 3c 门禁
---

# leader 行为规范（项目侧落地）

> **通用 leader 规则（派发 / 并行 / 验收 / 汇报）唯一权威 = 全局 `leader-ops` skill**——本仓库不复制、不另立；本文件只写本仓库专属落地。
> 通用规则本文件不再复述（职责边界 / 派发闸门 / 自执行熔断 / 验收归属 / 派发七项 / 偏差处置 / 负载纪律均在全局 skill）；**何时阅读**：leader 派发前、验收前、决定是否亲自执行前，子 agent 也读。

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

## 四、leader 巡检命令（超时未报告即主动巡检）

- 巡检命令：`git -c core.quotePath=false status --short` 看是否在推进；关键文件 mtime 用 `stat -f '%Sm %N' <文件>`。
- 判据：单点「mtime 未变 + `git status` 无改动」**不构成卡死证据**；须**连续两个巡检周期无任何写入、且未收到完成/失败通知**才判卡死，**重派前必须再复查一次**推进情况并携带前轮证据——完整判据见全局 `leader-ops` skill §二「巡检判据」。
- **反模式**：等「agent 自己会回来」、把「没有消息」当成「正在正常干活」；判卡死后不复查就重派 → 两个写者同 write scope 并发写。

## 五、真实环境 / 浏览器验证归用户本人

- 隔离实例起停、真实浏览器走查、真实模型调用由**用户本人**手工做：agent 不代跑、不新增自动化 e2e / 浏览器测试，只提供步骤与清单（[verifying-dsh-plugins skill](../../skills/verifying-dsh-plugins/SKILL.md) · [人工自测清单模板](../../verification/README.md)）——这是全局 `leader-ops` skill §一「点名必派」的**例外**。

## 六、发版前必须 3c 人工自测确认

- 发版用 `node scripts/release.mjs <插件名> [--push]`；未带 `--confirm-manual-tested` 即阻断，**不静默跳过**（清单模板 [verification/README.md](../../verification/README.md)）。

## 参考

| 文件 | 内容 |
| --- | --- |
| [AGENTS.md](../../AGENTS.md) · [工程效率规范](工程效率规范.md) | 精简协作原则与强制规则 · 流程化 / 并行 / 汇报与验证纪律 |
| [构建与测试](构建与测试.md) · [踩坑目录](../踩坑/README.md) · [需求分诊与派发](../../skills/dsh-github-triage/SKILL.md) | verify-local 用法 · 每条陷阱的取证与修法 · fork 池与 issue/PR/CI 处理 |
