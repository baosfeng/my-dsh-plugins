---
title: release.mjs dry-run 会 bump 版本
description: dry-run 已写入新版本号，--push 再次 bump 会跳版本导致验证清单版本不匹配
created: 2026-09-01
updated: 2026-09-01
---

# release.mjs dry-run 会 bump 版本

## 现象

`node scripts/release.mjs <插件> --bump patch`（不带 `--push`）的 dry-run **已经执行 bump**：写入 package.json 新版本 + 生成 CHANGELOG 段（未 commit）。此时再跑 `--bump patch --push` 会**再次 bump**（如 0.3.4 → dry-run 0.3.5 → --push 0.3.6），导致：

- verify-real-profile 生成 `verification/<插件>-0.3.6.md`（新版本清单），而手头勾选的是 `-0.3.5.md` → 3c 门禁校验不匹配 → **发版阻断**
- CHANGELOG 出现两个重复版本段（0.3.5 + 0.3.6）

**案例**：dsh-my-notify 0.3.4 发版（2026-09-01）：先 dry-run（bump 到 0.3.5 未提交），再 --push（bump 到 0.3.6）→ 阻断。

## 解决

- **不要先 dry-run 再 --push**：直接 `--bump patch --push` 一次完成（校验 + bump + commit + tag + push）。
- 若已 dry-run：`git checkout plugins/<插件>/package.json plugins/<插件>/CHANGELOG.md README.md AGENTS.md` 恢复，删除误生成的 `verification/<插件>-<错误版本>.md`，再直接 --push。
- 注意：`--bump` 需要自上次 tag 以来有 `plugins/<插件>/` 路径的提交（git log 提取 CHANGELOG 信息）；若本地 tag 刚重打过（指向 HEAD），git log 为空会报错——删除本地 tag 让 release.mjs 找上一个 tag。

## 相关

- `scripts/release.mjs` 的 `--bump` 逻辑（line 79-135）：bump 写入 package.json + CHANGELOG，dry-run 不回滚
- 验证清单版本必须用 bump 后的版本（issue #67 门禁）
