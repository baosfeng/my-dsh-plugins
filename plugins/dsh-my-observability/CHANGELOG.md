# Changelog

本文件记录 dsh-my-observability 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 移除

- **轨迹回放面板**（侧边栏页签 `dsh-my-observability:replay`）：时间轴、会话选择、类型过滤、关键词/时间范围过滤、导出 JSON·CSV、工具失败率统计，以及面板专属的 `src/client/parts/replay.ts` / `replay-ext.ts`、`src/audit-view.ts`（`lib/audit-view.js`）与其单测、`assets/replay-panel.png`、i18n 文案与样式。理由：与官方默认装载的 `@deepseek-ai/dsh-client-ui-trajectory`（按轮次事件记录表 + 时间概览 + 检查器）能力重叠。
- 随面板一并删除的重叠逻辑还包括：面板内的资源轮询（改由资源页签独立承担）。

### 变更（迁移）

- 侧边栏「轨迹回放」页签 → 「**资源监控**」页签（id `dsh-my-observability:resources`，order 40 不变），只展示审计文件写入速率/大小 + 进程 CPU/内存 + 告警列表；可视化轨迹回放改用官方 **Trajectory** 页签。
- 面板内搜索/导出/统计无界面替代：改用审计查询 API（`GET /observability/api/sessions`、`GET /observability/api/events?sessionId=&type=&limit=`，跨会话 `sessionId=*`）。
- 保留不变：审计落盘（`$DSH_HOME/observability/audit.jsonl`）与 `sessions` / `events` / `status` / `errors` / `plugin-status` / `resources` 端点、结构化 Git 工具、提交前增量 diff 审查（含 AI 增强与设置页）、资源看门狗降级/恢复。
- 客户端共享助手 `apiJson` 拆到 `src/client/parts/api.ts`（原先放在回放面板片段里）。

## [0.3.4] - 2026-09-18

### 变更

- fix(my-observability): 去掉仅内部使用的 4 个导出（knip 死代码门禁）
- docs(guard,observability,mermaid-render): 设置页面板真实截图 + README 效果图
- fix(my-observability): 拆分设置视图至尺寸门禁内
- feat(my-observability): 设置页配置面板（aiReview / aiTimeoutMs 可视化编辑）

## [0.3.3] - 2026-09-18

### 变更

- fix(my-observability): 去掉仅内部使用的 4 个导出（knip 死代码门禁）
- docs(guard,observability,mermaid-render): 设置页面板真实截图 + README 效果图
- fix(my-observability): 拆分设置视图至尺寸门禁内
- feat(my-observability): 设置页配置面板（aiReview / aiTimeoutMs 可视化编辑）

## [0.3.2] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- chore(artifacts): #318 同步 8 处共享件产物漂移 + 新增产物一致性门禁（fail-closed） (#325)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- chore: 项目全面优化和完善

## [0.3.1] - 2026-09-10

### 变更

- feat(ts): 第四轮 JS→TS 迁移（5 个插件，server + client 全量）