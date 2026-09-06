# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-06

### Added

- 会话标题自动生成（issue #160）：监听会话首条人类消息，LLM 生成结构化标题（`[工作区名] 简要描述`），经核心 `session/title` 事件写入（重启保留）
- 与核心标题机制协作：核心 fallback/provider 非结构化标题触发重新生成；生成失败静默回退；用户手动标题不被覆盖
- 可配置：开关（`enabled`）、格式模板（`template`）、LLM 路由覆盖（`provider`/`model`）、字节/token/超时上限
