# Changelog

本文件记录 dsh-my-observability 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。


## [0.3.8] - 2026-10-29

### 变更

- chore(release): 批量发版 2 个插件
- fix(dsh-my-context,dsh-my-observability): 未设 DSH_HOME 时数据不再落到用户根目录 (#500)
- refactor(md-render): 拆出 CodeHead/CodeBody 守住函数尺寸门禁

## [0.3.7] - 2026-10-29

### 变更

- fix(dsh-my-context,dsh-my-observability): 未设 DSH_HOME 时数据不再落到用户根目录 (#500)
- refactor(md-render): 拆出 CodeHead/CodeBody 守住函数尺寸门禁

## [0.3.6] - 2026-10-17

### 变更

- fix(i18n): 插件文案优先跟随宿主 html lang
- fix(compat): 适配 DSH 0.2.1 移除 webRuntime 服务

## [0.3.5] - 2026-10-17

### 变更

- fix(deps): dsh-shared 从 peerDependencies 移到 dependencies
- chore(docs): 撤销误提交混入的并行改动，保留 guardian 踩坑引用恢复
- docs(踩坑): 恢复 guardian 的参考实现引用（asar 取证 / 收尾窗口 / boot 就绪）
- feat(dsh-md-render): 卡片工具条收纳式改版 + 修竖向长图缩放偏位
- fix(dsh-shared,ci)!: 修复无值键解析回归并新增依赖解析门禁
- Merge origin/main into main（同步上游 17 提交）
- feat(md-render,my-memory)!: 合并渲染插件并新增全局提示词 (#463 #465)
- fix(compat): 插件适配 DSH 0.2.0-rc.2 宿主（peer 声明 + 取证通道 + fixture）
- chore(deps)(deps-dev): bump the plugin-devdeps-minor-patch group across 3 directories with 1 update (#453)
- chore(deps)(deps-dev): bump the plugin-devdeps-minor-patch group across 3 directories with 1 update (#448)
- refactor(observability): 移除与官方 ui-trajectory 重叠的轨迹面板，保留 Git 工具与安全审查 (#433)
- fix(verify): #402 门禁假红根因——等待预算与真实墙钟解耦（用例鲁棒化 + flaky 复测分类缺口） (#417)
- chore(deps)(deps-dev): bump the plugin-devdeps-minor-patch group across 3 directories with 1 update (#405)
- chore(deps)(deps-dev): bump the plugin-devdeps-minor-patch group across 3 directories with 1 update (#398)
- fix(test): 修掉 observability 持久化用例的时序 flaky（CI 红、本地绿）

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