# Changelog

本文件记录 dsh-shared 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.6] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷

## [0.1.5] - 2026-09-16

### 变更

- test: 存量固定 sleep 收敛（whenReady / drained / 渲染态可观测）
- fix(test): 绝对耗时断言 → 行为/比值判据 + 端到端用例显式超时
- docs(清理): 文档瘦身 23765 → 8309 行并固化精简规范
- fix(my-context,shared,gates): 补加载就绪信号 + 统一等待工具 + 固定 sleep 防复发门禁
- chore(artifacts): 同步 8 处共享件产物漂移 + 新增产物一致性门禁（fail-closed）
- feat(dsh-shared): 抽出 markdown-fallback 共享部件并接入 my-plugin-manager
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- fix: 移除未使用的stat导入，修复文件系统竞争条件
- feat(notify): add quiet hours (DND) feature
