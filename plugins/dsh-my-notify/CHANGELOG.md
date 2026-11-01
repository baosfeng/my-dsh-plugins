# Changelog

本文件记录 dsh-my-notify 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- feat(notify/server): 统一模板变量引擎（`{{namespace.var}}` 新语法 + `{var}` 旧语法单次扫描渲染，未识别占位符原样保留），命名空间 session / event / ask / tool / approval / tokens / notify 共 32 个变量，`GET /notify/api/variables` 返回变量目录
- feat(notify/server): 五类事件文案模板（`messages.end/ask/approval/subagentEnd/remote`），在 SSE 广播前渲染 title / note；空模板回退默认文案，远程触发显式 title / body 优先
- feat(notify/server): 飞书 interactive 卡片（schema 2.0 / 1.0，按事件配色、字段区、@ open_id / user_id、open_url 按钮、19.6KB UTF-8 截断 + 续行提示、元素上限 200）
- feat(notify/server): `POST /notify/api/preview` 返回 `{ card, text, vars }`，支持 kind / channel / sample / card 覆盖，供文案工作台五形态实时预览
- feat(notify/config): 配置模型扩展 `sound` / `toast` / `system` / `messages` 与 webhook `titleTemplate` / `bodyTemplate` / `msgType: interactive` / `card` / `retry`，全部 fail-open（坏字段回退默认值，旧配置继续生效）
- feat(notify/client): 设置页 v2 五分区（呈现 / 触发与时机 / 文案与变量 / 渠道推送 / 高级与安全），文案工作台支持 5 事件独立标题正文 + 变量库点击插入 + 五形态实时预览，渠道抽屉含卡片设计器与 JSON 双态

### 变更

- feat(notify/webhook): 正文改由 `bodyTemplate` 承载、标题由 `titleTemplate` 承载，旧 `template` 仍作正文兜底，未配置时保持默认富格式正文
- feat(notify/webhook): `msgType` 按渠道白名单放行（企微 / 钉钉 text·markdown，飞书 text·post·interactive），飞书 `interactive` 不再被改写成 `text`
- feat(notify/config): 事件订阅白名单补 `subagentEnd`，与 `messages` 文案键、设置页勾选保持一致

### 修复

- fix(notify/webhook): 加签 timestamp 改为秒级（此前 pusher 直接把 `Date.now()` 毫秒传给 sign，与三家官方校验不符，线上加签必然失败）；新增毫秒→秒换算的回归用例
- fix(notify/webhook): 重试次数与退避基数改由每条 webhook 的 `retry` 配置控制（默认仍为 3 次 / 1s 指数退避）
- fix(notify/card): `card.template` 空串保留为「未指定配色」（不再写成 `default`），按事件自动配色（end 绿 / ask 蓝 / approval 橙 / subagentEnd 紫 / remote 灰）在保存前后一致；`sessionUrl` 补齐到 ask / approval / 远程触发（卡片「查看会话」按钮不再缺失）；`sound.preset` 默认值与白名单统一为 chime|drop|deep
- fix(notify/config): webhook 配置保存不再丢弃 `titleTemplate` / `bodyTemplate` / `card` / `retry`，坏字段逐项 fail-open 回退默认值

### 文档

- docs(notify): README 补齐 v2 配置表（含 webhook / card / retry 子字段）、32 变量分组表、飞书卡片约束、variables / preview 接口形状与 localStorage 开关说明
- docs(notify): 模块概述更新到 v2 架构（模块职责 / 配置落点 / 路由 / 渠道能力矩阵），文档索引登记面板 v2 原型

## [0.4.3] - 2026-10-17

### 变更

- fix(i18n): 插件文案优先跟随宿主 html lang
- fix(compat): 适配 DSH 0.2.1 移除 webRuntime 服务

## [0.4.2] - 2026-10-17

### 变更

- feat(dsh-md-render): 卡片工具条收纳式改版 + 修竖向长图缩放偏位
- fix(dsh-shared,ci)!: 修复无值键解析回归并新增依赖解析门禁
- feat(md-render,my-memory)!: 合并渲染插件并新增全局提示词 (#463 #465)
- fix(compat): 插件适配 DSH 0.2.0-rc.2 宿主（peer 声明 + 取证通道 + fixture）

## [0.4.1] - 2026-10-08

### 修复

- fix(my-notify): 删除过时的 `@deepseek-ai/dsh-session-title` peer 声明（`^0.1.5-rc.2` 不满足 0.2.0-rc.2 宿主的 peer 版本门禁 → 装载 skip）。代码不 import 该包，可选 `sessionTitle` 服务经 `ctx.get('sessionTitle')` 读取（缺失已降级）

## [0.4.0] - 2026-09-17

### 变更

- fix(my-notify): 场景7 失败记录等待改为条件判据，去掉墙钟 deadline
- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- chore(cleanup): #315 清理 unused-local-variable/useless-expression（含共享件假阳性判定） (#319)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- feat(notify): add quiet hours (DND) feature
- chore: 项目全面优化和完善

## [0.3.9] - 2026-09-10

### 变更

- fix(ts): 迁移遗留修复（ambient 声明污染 / 类型契约 / 源码产物同步）
- feat(dsh-my-guard): migrate to TypeScript
- feat(dsh-my-notify): migrate server to TypeScript
- fix(dsh-my-notify): 设置页 slots 首屏时序修复（ctx.get strict=false + 防回归测试）
- feat(release): 支持批量发版 + 文档修复
- chore(plugins): 清理失效的 dsh.client.inject 声明（13 插件）
