# Changelog

本文件记录 dsh-shared 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
