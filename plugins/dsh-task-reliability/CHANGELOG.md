# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.9] - 2026-09-25

### 变更

- fix: 适配宿主 0.1.7-rc.2 的事件名与席位契约，修正失效文档断言
- chore(deps)(deps-dev): bump the plugin-devdeps-minor-patch group across 3 directories with 1 update (#405)
- chore(deps)(deps-dev): bump the plugin-devdeps-minor-patch group across 3 directories with 1 update (#398)

## [0.4.8] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- fix(test): #353 绝对耗时断言 → 行为/比值判据 + 端到端用例显式超时 (#354)
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- chore(artifacts): #318 同步 8 处共享件产物漂移 + 新增产物一致性门禁（fail-closed） (#325)
- test(dsh-task-reliability): #313 收敛重启后固定等待（同源 flaky） (#317)
- fix(dsh-task-reliability): #310 幂等用例去掉固定等待（CI flaky） (#312)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- chore: 项目全面优化和完善
- fix(dsh-task-reliability): #253 cucumber 步骤补齐落盘就绪判据，消除 'checking' !== 'done' 偶发红 (#262)
- fix(dsh-task-reliability, dsh-ts-example): #242 路由注册改挂常驻 root，修复静默失效 (#260)
- chore(release): #198 dsh-shared 0.1.4 + 消费方 peerDeps 同步 + 文档收口 (#254)
- refactor(sidebar): 6 个轻量插件迁移到宿主原生侧边栏扩展点（issue #187 批 1） (#244)
- fix(dsh-task-reliability): #233 后续 消除写路径异步化引入的落盘时序 flaky (#239)
- #184 依赖升级：矩阵脚本 + A 档落地 + jscpd 解锁 + dependabot 覆盖插件目录 (#235)
- feat(dsh-shared): #198 抽出 createResourceGuard 原语 + observability 改为消费方 (#233)
- feat(ts): 第四轮 JS→TS 迁移（5 个插件，server + client 全量）
- fix(dsh-task-reliability): /task 改为 ctx.inject 等待注册 + slots 时序修复

## [0.4.7] - 2026-09-07

### 变更

- feat(observability): 插件状态查询聚合——统一 status-query 事件 + /plugin-status API
- chore(plugins): 清理失效的 dsh.client.inject 声明（13 插件）
