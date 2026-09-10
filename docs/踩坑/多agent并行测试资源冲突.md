---
title: 多 agent 并行跑同一插件测试互相踩踏
description: Vitest coverage 目录被另一进程占用导致 npm test 退出 1，易被误判为真实回归
created: 2026-09-10
updated: 2026-09-10
---

# 多 agent 并行跑同一插件测试互相踩踏

## 现象

两个进程同时对**同一个插件**跑 `npm test`（Vitest 带 `--coverage`）时，其中一个会失败。最坑的地方是：**失败在启动阶段，一个测试都没执行**（日志里没有 `Tests` 行，只有 `Unhandled Error`），极易被误读成"该插件真实失败"：

```
⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯
Error: The coverage report directory "/Users/.../plugins/dsh-task-reliability/coverage" is already in use
by another Vitest process (pid 68786). Running coverage for multiple Vitest processes in the same directory
at the same time is not supported, because they would delete each other's reports.
Give each run its own "coverage.reportsDirectory" (e.g. --coverage.reportsDirectory=coverage-69002)
or run them sequentially.
 ❯ ReportsDirectoryLock.inUseError ../../node_modules/vitest/dist/chunks/index.B89dZ0-N.js:15430:26
 ❯ ReportsDirectoryLock.acquire ...:15399:54
 ❯ V8CoverageProvider.clean ...:14984:3
```

若此时恰好有代码正在被改造，失败还会进一步伪装成**真实回归**（用例数从 288 变 294、失败数 5 → 3 等实时变动），排查成本很高。

## 触发条件

- 至少两个进程同时跑同一插件的 Vitest（典型：一个 agent 在改该插件并跑测试，另一个 agent 在跑 `scripts/test-all.sh` 全量遍历）。锁是**插件目录级**的；来源不限——两个 agent、agent 与 CI、人工与 agent 都算。
- 两个「不同的」插件并发跑测试**不会**冲突（各自 coverage 目录独立）。

## 规避

- 派发并行任务时**按插件划分**（一个插件同一时刻只允许一个进程跑测试）。
- 看到 `already in use by another Vitest process` 就**隔 1-2 分钟重试**，不要改代码、不要据此判定回归；或临时用 `--coverage.reportsDirectory=coverage-$$` 给每次运行独立目录。
- 取验收基线要选**无人改动代码的时间窗**：本次迁移中 08:51 那轮全量（18 插件全绿、vitest 1375 + cucumber 267 scenarios）是干净基线，08:55 之后的失败全部作废。
- **全量遍历不要在并发开发期间跑**。`scripts/test-all.sh` 现已从 `set -e` fail-fast 改为"逐个跑完 + 汇总"（失败的插件不再中断后续插件，末行给出通过/失败/跳过清单），但仍应避开并发窗口：撞上正在改造的插件时，该插件的失败没有参考价值。

## 附带的脚本陷阱

- **管道退出码**：`bash scripts/test-all.sh 2>&1 | tee log` 的退出码是 `tee` 的，后台 job 会误报 exit 0。必须用 `${PIPESTATUS[0]}` 取真实退出码。
- 同理，前台执行 `cmd | tail` 后再 `echo $?` 拿到的也是 `tail` 的退出码。

## 相关

- `scripts/test-all.sh`（CI test matrix 的等价遍历，已改为汇总式）
- `vitest.config.mjs` 的 coverage 输出目录配置
- issue #67 发版功能级验证门禁（发版前的测试必须串行、干净）
