# Changelog

本文件记录 dsh-my-remote 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.4] - 2026-09-19

### 变更

- feat(my-remote): 新增设置页面板 + 测试隔离 fail-closed 防线（#385）

## [Unreleased]

### 新增

- 设置页（设置 → 插件 → 远程控制）：可视化编辑 `apiToken`（密码型，留空则不修改）/ `askTimeoutMs` / `approvalTimeoutMs` / `webhooks[]`（列表增删改），保存写回 profile 层 `cordis.patch.yml` 并立即生效（#385）。

### 变更

- 路由注册改由常驻 root 承载（`ctx.root.inject(['webServer'], …)`）+ 重复 apply 去重：修「插件 fiber 被回收 / webServer 晚就绪导致 `/remote/api` 恒 404」。
- 新增 client 半（`exports["./client"]` + `dsh.client`），仅承载设置页签。

### 修复（测试基础设施）

- 测试曾整文件覆盖真实 `~/.dsh/profiles/web/cordis.patch.yml`：`writePatchFile` 无路径防护 + `DSH_HOME` 隔离只存在于 `boot()` 内。现改为三层防线——cucumber `Before` / vitest `setupFiles` 提前隔离 `DSH_HOME`；写入前 fail-closed 断言（拒绝 `~/.dsh` 与临时目录之外的路径）；`test/host-home-isolation.mjs` 防回归（含真实配置内容 / mtime 零变化断言）。

## [0.1.3] - 2026-09-17

### 变更

- docs: skill 合并 12→10 并拆分超限文件，修 observability 聚合端点缺陷
- docs(清理): #341 文档瘦身 23765 → 8309 行并固化精简规范 (#348)
- fix(test): cucumber-js --import glob 改用双引号，兼容 Windows
- fix(security): 批量修复 'Insecure temporary file' 安全漏洞
- fix: 移除不必要的防御性代码，修复#52, #51告警
- chore: 项目全面优化和完善

## [0.1.2] - 2026-09-10

### 变更

- fix(ts): 迁移遗留修复（ambient 声明污染 / 类型契约 / 源码产物同步）
- feat(dsh-my-guard): migrate to TypeScript
- feat(dsh-my-remote): migrate to TypeScript
