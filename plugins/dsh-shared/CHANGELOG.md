# Changelog

本文件记录 dsh-shared 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- feat(dsh-shared): #198 资源护栏统一收口——`atomicWriteJson` 改为**默认安全**（1s 节流 + 1MB 字节上限，拦截不静默：warn + `atomicWriteStats()` 计数 + `onBlocked` 回调；`force` 跳过**节流**用于退出前冲刷/用户显式保存）
- feat(dsh-shared): #198 新增 `boundedMap` / `boundList` 有界容器（LRU/FIFO 上限 + `evicted` 淘汰计数 + `onEvict` 回调；`toJSON()`/`items()` 保持磁盘 JSON 形态，替换既有字段不改变持久化格式）
- feat(dsh-shared): #198 新增 `createWriteScheduler` 写入调度（防抖 + 最小间隔 + 串行链 + `drain()` 确定性就绪信号 + `flush()` 退出前强写 + 被护栏拒绝自动重排）

### 变更

- feat(dsh-my-context): #198 接入资源护栏——bySession 会话数上限（`boundedMap`，LRU，填补会话数无上限的审计缺口）+ 每会话明细数组有界（`boundList`，上限语义不变）+ 写入调度（防抖 500ms / 最小间隔 1s）+ 显式 8MB 字节上限；新增 `store.whenPersisted()` / `store.stats()`
- feat(dsh-my-skill-manager): #198 接入 `createWriteScheduler`（替换插件内 `persistSoon` + `dirtyChain` 样板）+ 新增 `drainUsage()` 就绪信号
- feat(dsh-my-notify): #198 webhook 配置保存路径显式 `force: true`（用户显式保存不被默认 1s 节流窗口吞掉），字节上限沿用默认 1MB
- test(scripts): #198 `scripts/resource-smoke.mjs` 新增场景 5——dsh-my-context 会话数有界 + 写入节流（含新旧写节奏对比数字）

## [0.1.3] - 2026-09-10

### 变更

- chore(ts): 修复仓库级 CI 门禁并补充迁移规范
- feat(dsh-my-notify): migrate server to TypeScript
- feat(dsh-my-remote): migrate to TypeScript
- fix(ci): 修复 quality job 持续失败（prettier 17 文件 + knip 死代码） (#133)

## [0.1.2] - 2026-09-03

### 变更

- feat(shared): 新增 jsonlAppender 增量追加原语 + atomicWriteJson 护栏
- feat(mermaid-render): #85 图表导出 PNG/SVG 下载 + 复制源码 (#100)
- fix(scripts): #72 插件依赖未随安装自动安装（dsh-shared 未发布 npm） (#96)

## [0.1.1] - 2026-09-03

### 变更

- feat(shared): 新增 jsonlAppender 增量追加原语 + atomicWriteJson 护栏
- feat(mermaid-render): #85 图表导出 PNG/SVG 下载 + 复制源码 (#100)
- fix(scripts): #72 插件依赖未随安装自动安装（dsh-shared 未发布 npm） (#96)

## [0.1.0] - 2026-08-28

### 新增

- 首个版本：从各插件 `lib/fence.js` / `lib/http.js` / `lib/config-store.js` 等抽取合并（issue #45）
  - `isTrustedApiRequest` / `header` — Host-header 信任围栏（loopback / trustedHosts / 同源）
  - `readJsonBody` / `writeJson` / `writeError` — HTTP JSON 读写工具
  - `currentProfile` / `profileDirOf` / `patchFileOf` / `extractConfig` / `writePatchConfig` — 配置持久化（cordis.patch.yml YAML 子集读写）
  - `findProjectRoot` — 项目根解析（最近 `.git` 祖先）
  - `withTimeout` / `userMessage` — 超时包装 / user 消息构造
  - `atomicWriteJson` — 原子写 JSON 快照（tmp+rename，自动建目录）
