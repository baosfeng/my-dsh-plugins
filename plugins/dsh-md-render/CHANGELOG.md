# Changelog

本文件记录 dsh-md-render 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 公共 API 承诺面：`MarkdownView`（导出 / props / 输出类名清单见 [README「公共 API 契约」](README.md)）；改类名清单 = 破坏性变更，须同步 README 与本文件。

## [0.1.8] - 2026-09-10

### 变更

- fix(ts): 迁移遗留修复（ambient 声明污染 / 类型契约 / 源码产物同步）
- feat(dsh-my-guard): migrate to TypeScript
- feat: complete TypeScript migration for dsh-md-render
- feat(dsh-md-render): migrate to TypeScript
- fix(dsh-md-render): 代码块主题前景色自洽（深背景黑字不可见）+ 行号贴边
- fix(dsh-md-render): 设置页 tab 首屏注册时序（slots 服务未 active 时静默跳过，strict=false 取服务实例 + 防回归测试）
