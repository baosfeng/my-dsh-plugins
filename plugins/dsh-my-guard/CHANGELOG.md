# Changelog

本文件记录 dsh-my-guard 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.6] - 2026-09-16

### 变更

- fix(my-guard): 消除 tar 解包链路的 CodeQL 告警
- docs(清理): 文档瘦身 23765 → 8309 行并固化精简规范
- fix(my-guard,scripts): 读取改 open + fd stat，恢复类型闸门与字节账
- chore(cleanup): 清理 unused-local-variable/useless-expression（含共享件假阳性判定）
- fix(security): 修复代码扫描 error/warning 告警（5 类规则）
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(guard): restore stat import in poison.js
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- fix: 移除未使用的stat导入，修复文件系统竞争条件
- fix: 修复 GitHub Code Scanning 安全漏洞 (43 个)
- fix(security): fix file system race conditions and missing regex anchor
- fix(security): use tmp library for secure temporary file creation
- fix: update tests and rebuild client.js for new icons
- chore: 项目全面优化和完善
