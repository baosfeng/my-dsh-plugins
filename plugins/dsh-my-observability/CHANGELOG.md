# Changelog

本文件记录 dsh-my-observability 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.4] - 2026-09-18

### 变更

- fix(my-observability): 去掉仅内部使用的 4 个导出（knip 死代码门禁）
- docs(guard,observability,mermaid-render): 设置页面板真实截图 + README 效果图
- fix(my-observability): 拆分设置视图至尺寸门禁内
- feat(my-observability): 设置页配置面板（aiReview / aiTimeoutMs 可视化编辑）

## [0.3.3] - 2026-09-18

### 变更

- fix(my-observability): 去掉仅内部使用的 4 个导出（knip 死代码门禁）
- docs(guard,observability,mermaid-render): 设置页面板真实截图 + README 效果图
- fix(my-observability): 拆分设置视图至尺寸门禁内
- feat(my-observability): 设置页配置面板（aiReview / aiTimeoutMs 可视化编辑）

## [0.3.2] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- chore(artifacts): #318 同步 8 处共享件产物漂移 + 新增产物一致性门禁（fail-closed） (#325)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- chore: 项目全面优化和完善

## [0.3.1] - 2026-09-10

### 变更

- feat(ts): 第四轮 JS→TS 迁移（5 个插件，server + client 全量）
