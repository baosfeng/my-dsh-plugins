# Changelog

本文件记录 dsh-my-notify 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.9] - 2026-09-10

### 变更

- fix(ts): 迁移遗留修复（ambient 声明污染 / 类型契约 / 源码产物同步）
- feat(dsh-my-guard): migrate to TypeScript
- feat(dsh-my-notify): migrate server to TypeScript
- fix(dsh-my-notify): 设置页 slots 首屏时序修复（ctx.get strict=false + 防回归测试）
- feat(release): 支持批量发版 + 文档修复
- chore(plugins): #165 清理失效的 dsh.client.inject 声明（13 插件） (#167)
