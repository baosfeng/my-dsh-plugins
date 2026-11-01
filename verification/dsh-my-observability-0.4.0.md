# 发版前人工自测清单 — dsh-my-observability@0.4.0

- 本次发版内容（0.3.8 → 0.4.0）：
  1. **移除轨迹回放面板**（侧边栏页签 `dsh-my-observability:replay`）——与官方默认装载的 `@deepseek-ai/dsh-client-ui-trajectory` 能力重叠：时间轴、会话选择、类型过滤、关键词/时间范围过滤、导出 JSON·CSV、工具失败率统计，及其 `src/client/parts/replay.ts` / `replay-ext.ts` / `src/audit-view.ts`、单测、`assets/replay-panel.png`、i18n 与样式
  2. 侧边栏「轨迹回放」页签 → 「**资源监控**」页签（id `dsh-my-observability:resources`，order 40 不变），只展示审计文件写入速率/大小 + 进程 CPU/内存 + 告警列表
  3. 保留不变：审计落盘与 `sessions` / `events` / `status` / `errors` / `plugin-status` / `resources` 端点、结构化 Git 工具、提交前增量 diff 审查、资源看门狗
- 验证环境：用户本人运行中的 DSH 实例；agent 侧只跑测试与构建
- 确认依据：用户本人在对话中指示「继续发版」（2026-11-01）

## 功能级验证项（逐条勾选）

- [ ] 侧边栏**不再出现**「轨迹回放」页签；「资源监控」页签存在且能打开
- [ ] 资源监控页展示审计写入速率/大小、进程 CPU/内存、告警列表，数值随刷新变化
- [ ] 可视化轨迹回放改用官方 **Trajectory** 页签，两者不冲突、可同时存在
- [ ] 审计查询 API 仍可用：`GET /observability/api/sessions`、`GET /observability/api/events?sessionId=&type=&limit=` 返回 200
- [ ] 结构化 Git 工具、提交前增量 diff 审查（含设置页）与 0.3.8 行为一致
- [ ] 浏览器 DevTools Console 无未捕获异常

## agent 侧已做（非浏览器）

- `cd plugins/dsh-my-observability && npm test` 全绿；`npm run verify` 全量门禁覆盖

## 未验证项（如实记录）

- [ ] 上述浏览器项未由 agent 代跑
- [ ] 未在隔离实例里验证「移除页签后配置里残留的旧页签 id 是否报错」
