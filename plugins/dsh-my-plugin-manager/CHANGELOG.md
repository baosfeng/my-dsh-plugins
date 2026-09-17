# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- feat(gates): #323 新增包发布卫生门禁（pack 内容 + 字段断言 + README 引用面） (#333)
- chore(artifacts): #318 同步 8 处共享件产物漂移 + 新增产物一致性门禁（fail-closed） (#325)
- feat(dsh-shared): #299 抽出 markdown-fallback 共享部件并接入 my-plugin-manager (#302)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- refactor(plugin-manager): split large functions to meet size limits
- feat(notify): add quiet hours (DND) feature
- chore: 项目全面优化和完善
- chore(release): #198 dsh-shared 0.1.4 + 消费方 peerDeps 同步 + 文档收口 (#254)
- #184 依赖升级：矩阵脚本 + A 档落地 + jscpd 解锁 + dependabot 覆盖插件目录 (#235)
- feat(ts): 第四轮 JS→TS 迁移（5 个插件，server + client 全量）
- fix(dsh-my-plugin-manager): installed API 适配 async list + slots 时序（400 → 200）
- feat(release): 支持批量发版 + 文档修复

## [0.1.5] - 2026-09-06

### 变更

- feat(observability): 插件日志体系补齐——7 插件关键行为/异常结构化日志（基础层）
