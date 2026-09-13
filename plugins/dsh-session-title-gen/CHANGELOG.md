# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- 恢复 `[工作区]` 前缀（issue #232）：适配 DSH 0.1.5-rc.1 的宿主契约变化——`session/event` 改注册到 root（profile 插件的 `ctx.events` 与 root 的 events 服务是不同实例，注册在插件自身 ctx 上收不到任何宿主会话事件，插件因此静默失效、标题退回核心机制）、会话事件改经 `snapshotEvents()` 读取（`Session.events` 已变 private）、LLM 服务在 apply 期捕获（监听器执行时插件 ctx 已 inactive，动态取服务抛错）
- 取不到工作区名时不再静默：仍生成标题，但写 `warn` 日志说明标题不带 `[工作区]` 前缀，让静默降级可被发现

## [0.1.0] - 2026-09-06

### Added

- 会话标题自动生成（issue #160）：监听会话首条人类消息，LLM 生成结构化标题（`[工作区名] 简要描述`），经核心 `session/title` 事件写入（重启保留）
- 与核心标题机制协作：核心 fallback/provider 非结构化标题触发重新生成；生成失败静默回退；用户手动标题不被覆盖
- 可配置：开关（`enabled`）、格式模板（`template`）、LLM 路由覆盖（`provider`/`model`）、字节/token/超时上限
