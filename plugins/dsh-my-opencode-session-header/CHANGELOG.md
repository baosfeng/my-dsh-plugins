# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-10

### Added

- 修复 OpenCode Go 网关 `400 MissingSessionID`：为走 `opencode` / `opencode-go` 路由的推理请求注入
  `x-opencode-session`（该会话的稳定 id）
- 拦截链：同步 `llm/stream` waterfall handler 包装流 + `AsyncLocalStorage` 会话上下文（每次
  `next()`/`return()` 均在上下文中执行，适配 pi-ai 惰性发请求）+ 单层 `globalThis.fetch` 补丁
- 路由判定（AND）：provider 白名单（默认 `opencode` / `opencode-go`）× 主机命中（默认 `opencode.ai` 及子域），
  任一不满足即原样调用原 fetch（零副作用）
- 会话头值确定性：同会话跨轮次 / 压缩 / 重试 / 重启稳定，不同会话不同值；`valueMode` 支持 `uuid`（提取裸 UUID，
  无则回退原串）与 `raw`
- 幂等与优先级：已有同名头（`Headers` / 数组 / 普通对象三形态，大小写不敏感）默认不覆盖，`override: true` 才覆盖
- 退化安全：无会话上下文或会话 id 为空时不注入（首次 warn 一次）；插件内部异常一律吞掉并降级为原行为
- 卸载还原：disposer 仅当当前 `globalThis.fetch` 仍是本插件安装的那个时才还原，不误还原他人 patch
- 配置项（含校验与明确报错）：`enabled` / `providers` / `hosts` / `headerName` / `valueMode` / `override`
