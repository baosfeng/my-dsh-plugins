# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 变更

- fix(guardian): 依赖预检解析 profiles 根 node_modules 的宿主包与子路径导出，消除「缺少依赖」误报

## [0.4.2] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- feat(gates): #323 新增包发布卫生门禁（pack 内容 + 字段断言 + README 引用面） (#333)
- chore(cleanup): #315 清理 unused-local-variable/useless-expression（含共享件假阳性判定） (#319)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- fix: 移除未使用的stat导入，修复文件系统竞争条件
- fix: update tests and rebuild client.js for new icons
- chore: 项目全面优化和完善

## [0.4.1] - 2026-09-10

### 变更

- chore(quality): 补 TS 源码尺寸门禁 + dsh-my-guardian 契约测试
- feat(ts): 补齐 dsh-my-context / dsh-my-guardian 的 client 端迁移
- feat(dsh-my-guard): migrate to TypeScript
- fix(dsh-my-guardian): 设置页 slots 首屏时序修复（ctx.get strict=false + 防回归测试）
