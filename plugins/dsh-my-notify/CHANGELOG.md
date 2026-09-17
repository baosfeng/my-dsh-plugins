# Changelog

本文件记录 dsh-my-notify 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
