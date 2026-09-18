# Changelog

本文件记录 dsh-file-activity 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.5.12] - 2026-09-18

### 变更

- feat(file-activity): 右侧边栏默认宽度配置（默认 20%）

## [0.5.11] - 2026-09-18

### 变更

- feat(file-activity): 右侧边栏默认宽度配置（默认 20%）

## [0.5.10] - 2026-09-16

### 变更

- test: 存量固定 sleep 收敛（whenReady / drained / 渲染态可观测）
- docs(清理): 文档瘦身 23765 → 8309 行并固化精简规范
- chore(artifacts): 同步 8 处共享件产物漂移 + 新增产物一致性门禁（fail-closed）
- chore(cleanup): 清理 unused-local-variable/useless-expression（含共享件假阳性判定）
- fix(security): 修复代码扫描 error/warning 告警（5 类规则）
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- fix: 移除未使用的导入，修复告警
- fix: 修复日志注入，修复告警
- fix: 移除未使用的stat导入，修复文件系统竞争条件
- fix: 修复 GitHub Code Scanning 安全漏洞 (43 个)
- fix(security): fix file system race conditions and missing regex anchor
- fix(security): use tmp library for secure temporary file creation
