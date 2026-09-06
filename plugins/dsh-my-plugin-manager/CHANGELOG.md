# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-09-06

### 变更

- feat(observability): #155 插件日志体系补齐——7 插件关键行为/异常结构化日志（基础层） (#159)

## [0.1.4] - 2026-09-04

### 变更

- chore(release): dsh-my-plugin-manager v0.1.4（#90 详情页 + 验证清单）
- feat(plugin-manager): #90 插件详情页（README/版本历史/依赖） (#125)
- docs: #106 安装命令统一加 --trust-lockfile (#113)

## [0.1.3] - 2026-09-01

### 变更

- fix(ui): 9 个插件未定义 token danger-primary 改用 error-primary（DSH 主题仅定义 business/error/success/warn）

## [0.1.2] - 2026-08-28

### 变更

- feat(ui): dsh-my-plugin-manager 设置页翻新——图标/徽章/状态/交互（issue #54）
- refactor(shared): 抽取 dsh-shared 共享工具包，10 个插件迁移消除重复实现（issue #45）
- chore(deps): 升级 react 19 兼容性——13 个插件 peer 声明 ^18.2.0 || ^19.2.0（issue #49）
- style(format): 全仓 prettier 格式化（issue #44）
- refactor(plugins): dsh-guardian/dsh-notify 改名 dsh-my-guardian/dsh-my-notify（npm 包名统一 dsh-my-* 系列，避免与 npm 同名包混淆）+ 新增 check-release.mjs 发布状态检查脚本

## [0.1.1] - 2026-08-27

### 变更

- **包名改名**：`dsh-plugin-manager` → `dsh-my-plugin-manager`（npm 包名被其他开发者同名插件占用，统一 `dsh-my-*` 前缀规避冲突，issue #37）
- feat(plugin-manager): 「已安装」列表只显示用户安装的插件，过滤官方插件（issue #28）

## [0.1.0] - 2026-08-26

### Added

- 公共插件管理面板（issue #2）：
  - 已安装插件清单（官方 pluginInventory + 版本解析，支持 scoped 包）与逐行卸载；
  - 更新检查（`pnpm outdated --json` 解析，展示 `当前 → 最新`）；
  - 市场搜索（npm registry search API）与一键安装（`dsh plugin --profile <p> add`）；
  - 设置页面板：官方 slots 扩展点（设置 → 插件 → 插件管理），纯官方依赖；
  - API 信任围栏（loopback/可信 host）与参数校验。
