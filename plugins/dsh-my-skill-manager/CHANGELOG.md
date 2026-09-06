# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2026-09-06

### 变更

- feat(memory,skill-manager): #143 试点——官方组件库替换（Input/Pill/Button + 图标） (#157)

## [0.1.5] - 2026-09-04

### 变更

- fix(skill-manager): 列表可读性——移除状态双编码 chip、排序/过滤控件放大、meta 拆行、未收录徽章
- docs: #106 安装命令统一加 --trust-lockfile (#113)

## [0.1.4] - 2026-09-02

### 变更

- feat(skill-manager): #91 skill 使用统计（次数/最近使用/来源 + 排序过滤 + 持久化） (#102)

## [0.1.3] - 2026-09-01

### 变更

- feat(skill-manager): 设置页极简重设计（issue #69）

## [0.1.2] - 2026-08-28

### 变更

- feat(ui): dsh-my-skill-manager 设置页翻新——开关组件/图标/层级（issue #54）
- refactor(shared): 抽取 dsh-shared 共享工具包，10 个插件迁移消除重复实现（issue #45）
- chore(deps): 升级 react 19 兼容性——13 个插件 peer 声明 ^18.2.0 || ^19.2.0（issue #49）
- style(format): 全仓 prettier 格式化（issue #44）

## [0.1.1] - 2026-08-27

### 变更

- **包名改名**：`dsh-skill-manager` → `dsh-my-skill-manager`（npm 包名被其他开发者同名插件占用，统一 `dsh-my-*` 前缀规避冲突，issue #37）
- feat(skill-manager): 项目视图只显示项目 skill，支持刷新与扫描诊断（issue #29）

## [0.1.0] - 2026-08-26

### Added

- Skill 管理插件（issue #23）：
  - 分「全局 / 项目」查看 skill 列表（名称 / 描述 / 来源 / 状态）；
  - 按项目启用/禁用：全局配置 `$DSH_HOME/skills.enabled.json`，项目配置 `<项目根>/.dsh/skills.enabled.json`（随仓库版本化）；
  - 禁用机制：rank-0 占位 provider 覆盖被禁用 skill（模型不可见、不可加载），按会话 cwd 解析项目配置实现项目覆盖全局；
  - 设置页面板：官方 slots 扩展点（设置 → 插件 → Skill 管理），纯官方依赖；
  - 配置保存后 catalog 自动失效重算，即时生效。
