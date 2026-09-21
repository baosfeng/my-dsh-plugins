# Changelog

本文件记录 dsh-md-render 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 公共 API 承诺面：`MarkdownView`（导出 / props / 输出类名清单见 [README「公共 API 契约」](README.md)）；改类名清单 = 破坏性变更，须同步 README 与本文件。

## [0.2.0] - 2026-09-21

### 变更

- docs(dsh-md-render): #393 补 text 围栏块渲染效果图与 README 引用
- feat(dsh-md-render): #393 text/plaintext/txt 围栏块按 markdown 渲染（含查看原文切换） (#395)

## [0.1.9] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- fix: rebuild client.js for mermaid-render and md-render
- chore: 项目全面优化和完善

## [0.1.8] - 2026-09-10

### 变更

- fix(ts): 迁移遗留修复（ambient 声明污染 / 类型契约 / 源码产物同步）
- feat(dsh-my-guard): migrate to TypeScript
- feat: complete TypeScript migration for dsh-md-render
- feat(dsh-md-render): migrate to TypeScript
- fix(dsh-md-render): 代码块主题前景色自洽（深背景黑字不可见）+ 行号贴边
- fix(dsh-md-render): 设置页 tab 首屏注册时序（slots 服务未 active 时静默跳过，strict=false 取服务实例 + 防回归测试）
