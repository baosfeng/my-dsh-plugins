# Changelog

本文件记录 dsh-mermaid-render 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.8] - 2026-09-16

### 变更

- test: 存量固定 sleep 收敛（whenReady / drained / 渲染态可观测）
- docs(清理): 文档瘦身 23765 → 8309 行并固化精简规范
- feat(gates): 新增客户端产物体积预算门禁（覆盖完整发布面）
- chore(cleanup): 清理 unused-local-variable/useless-expression（含共享件假阳性判定）
- fix(security): 修复代码扫描 error/warning 告警（5 类规则）
- fix(dsh-mermaid-render): inject 补 webServer（apply 即崩 cannot get property "webServer" without inject）
- fix(dsh-mermaid-render): 修复重试被迟到的旧失败覆盖 + 引擎资产被格式化提交 + 覆盖率门禁
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix: 移除未使用的stat导入，修复文件系统竞争条件
- fix: rebuild client.js for mermaid-render and md-render
- fix: update tests and rebuild client.js for new icons
- chore(deps)(deps-dev): bump the plugin-devdeps-minor-patch group across 1 directory with 2 updates
- chore: 项目全面优化和完善
