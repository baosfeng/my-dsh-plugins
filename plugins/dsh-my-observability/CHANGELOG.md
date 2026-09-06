# Changelog

本文件记录 dsh-my-observability 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.7] - 2026-09-06

### 变更

- fix(task-reliability,observability): #165 Session.events 迁移——snapshotEvents 优先 + 旧 API 兜底 (#166)
- feat(observability,task-reliability): #154 插件关键行为纳入事件审计（干预/ask 决策/救场/verify/恢复）+ 文件体积控制 (#158)
- fix(observability): #142 dispose 落盘链可等待，修复 release 门禁 flaky 测试 (#148)

## [0.1.6] - 2026-09-04

### 变更

- fix(observability): 轨迹回放会话下拉可读标题（首条用户消息）——此前只展示 UUID 清单

## [0.1.5] - 2026-09-04

### 变更

- feat(observability): #127 资源看门狗自动降级——写入速率/文件大小连续 ≥3 次采样超限自动暂停落盘（事件仍入内存，FIFO 有界不丢）+ 日志告警；连续 ≥3 次正常自动恢复（全量快照补齐降级窗口）；API 暴露 degraded 标记（#136）
- 发版前功能级验证清单（issue #67）：verification/dsh-my-observability-0.1.5.md

## [0.1.4] - 2026-09-03

### 变更

- feat(observability): #R17 资源监控看板——写放大/资源超限提前发现

## [0.1.3] - 2026-09-03

### 变更

- fix(observability): 审计持久化改增量追加，根治写放大磁盘风暴
- feat(observability): #89 审计日志搜索/过滤 + JSON/CSV 导出 (#120)
- docs: #106 安装命令统一加 --trust-lockfile (#113)

## [0.1.2] - 2026-09-01

### 变更

- fix(ui): 9 个插件未定义 token danger-primary 改用 error-primary（DSH 主题仅定义 business/error/success/warn）

## [0.1.1] - 2026-08-28

### 变更

- feat(ui): dsh-my-observability 时间轴翻新——类型图标/连线节点/前缀（issue #54）
- fix(security): 修复 CodeQL 告警——正则 ReDoS/随机数/命令注入（issue #5/#6/#7/#9/#10）
- refactor(shared): 抽取 dsh-shared 共享工具包，10 个插件迁移消除重复实现（issue #45）
- chore(deps): 升级 react 19 兼容性——13 个插件 peer 声明 ^18.2.0 || ^19.2.0（issue #49）
- style(format): 全仓 prettier 格式化（issue #44）

## [0.1.0] - 2026-08-28

### 新增

- **事件审计（issue #53）**：监听 `agent/status`（agent_status，含顶层/子代理标记）、`llm/stream`（llm_stream，同步包装流透传全部 chunk，记录开始/结束/错误 + chunk/字符/耗时统计）、`tools/pre-execute`（tool_call，工具名 + 参数键列表 + 文本摘要截断）、`tools/execute`（tool_result，成功/失败 + 耗时）；waterfall 一律透传 `next()`，只读观察不改变流程。
- **审计持久化**：`$DSH_HOME/observability/audit.json`（防抖 500ms + 原子写 tmp+rename + teardown flush），启动异步加载（加载前事件缓冲不丢），重启后完整恢复；按会话隔离；每会话 2000 条 / 全局 20000 条上限防膨胀。
- **轨迹回放面板**：侧边栏页签 `dsh-my-observability:replay`（dsh-better-sidebar 服务），会话选择 + 类型过滤（全部/状态/模型流/工具）+ 时间轴事件列表（徽标 + 时间 + 摘要）；可见时 5s 轮询、隐藏时暂停。
- **结构化 Git 工具**：侧边栏页签 `dsh-my-observability:git`——仓库状态（分支 + 暂存/未暂存计数）、差异查看（工作区/暂存区）、类型化提交（Conventional Commits：type 枚举 feat/fix/docs/style/refactor/test/chore + 可选 scope/body，服务端生成消息 + execFile 执行 git 不经 shell）。
- **增量 diff 审查**：`POST /observability/api/review`——unified diff 解析 + 8 条规则引擎（secret-leak/conflict-marker 为 error，debug-statement/large-diff/binary-file 为 warning，todo-marker/trailing-space/no-test-change 为 info）；可选 AI 审查增强（agents.create，超时/失败/解析失败降级，规则结果不受影响）。
- **查询接口**：`GET /observability/api/events`（会话事件，type 过滤 + limit）、`GET /observability/api/sessions`（会话列表）、`GET /observability/api/status`（审计统计 + 开关）；全部经 loopback 信任围栏。
- **测试**：`test/host-audit.mjs`（事件监听/会话隔离/重启恢复/上限/fence）、`test/host-git.mjs`（真实临时 git 仓库 status/diff/commit）、`test/host-review.mjs`（规则引擎 + AI 各路径）、`test/host-mutation.mjs`（变异补充）、Gherkin 验收（observability/git/review 3 个 feature 16 场景）；覆盖率 行 95% / 分支 85%；变异测试 ≥70%。

**真实环境验证**（独立端口 3081 隔离实例）：

- 侧边栏「轨迹回放」页签出现，时间轴展示真实 agent 行为（状态/模型流/工具调用）；
- 「Git 工具」页签：真实仓库状态/差异/类型化提交/提交前审查全流程可用；
- 重启验证实例后审计事件恢复。
