# Changelog

本文件记录 dsh-my-context 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。


## [0.1.9] - 2026-10-29

### 变更

- chore(release): 批量发版 2 个插件
- fix(dsh-my-context,dsh-my-observability): 未设 DSH_HOME 时数据不再落到用户根目录 (#500)

## [0.1.8] - 2026-10-29

### 变更

- fix(dsh-my-context,dsh-my-observability): 未设 DSH_HOME 时数据不再落到用户根目录 (#500)

## [0.1.7] - 2026-10-17

### 变更

- fix(i18n): 插件文案优先跟随宿主 html lang
- fix(compat): 适配 DSH 0.2.1 移除 webRuntime 服务

## [0.1.6] - 2026-10-17

### 变更

- fix(deps): dsh-shared 从 peerDependencies 移到 dependencies
- chore(docs): 撤销误提交混入的并行改动，保留 guardian 踩坑引用恢复
- docs(踩坑): 恢复 guardian 的参考实现引用（asar 取证 / 收尾窗口 / boot 就绪）
- fix(compat): 插件适配 DSH 0.2.0-rc.2 宿主（peer 声明 + 取证通道 + fixture）
- fix: 适配宿主 0.1.7-rc.2 的事件名与席位契约，修正失效文档断言

## [0.1.5] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- fix(test): #353 绝对耗时断言 → 行为/比值判据 + 端到端用例显式超时 (#354)
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- fix(my-context,shared,gates): #335 补加载就绪信号 + 统一等待工具 + 固定 sleep 防复发门禁 (#342)
- chore(cleanup): #315 清理 unused-local-variable/useless-expression（含共享件假阳性判定） (#319)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- chore: 项目全面优化和完善

## [0.1.4] - 2026-09-10

### 变更

- feat(ts): 补齐 dsh-my-context / dsh-my-guardian 的 client 端迁移
- feat(dsh-my-guard): migrate to TypeScript
- chore(plugins): 清理失效的 dsh.client.inject 声明（13 插件）
