---
title: CI 门禁与巡检假阴性
description: 工具没跑起来、宿主环境差异、平台自动关闭告警都会让门禁与巡检假绿或漏报；先看工具有没有产出清单
---

# CI 门禁与巡检假阴性

## 症状关键词（可 grep）

- `GLIBC_2.33' not found`
- `Must have admin rights to Repository.`（取 job 日志 403）
- `路径不存在（文件目录、祖先目录、仓库根均未命中）`
- `❌ 重复代码 jscpd`（只有标题行、没有任何 clone 清单）
- `Dependabot 0 条`
- `auto_dismissed` / `auto_dismissed_at`（升级成 `fixed` 后被清空）

## 根因

共同点是「把工具或平台的输出当成权威事实」。CI 日志工具拿 run 归档当 job 清单（归档按需生成、可残缺），单 job 日志不带凭据即 403、不跟随重定向只能拿到空响应 → 静默缺项。路径判定交给宿主 FS（macOS 大小写不敏感、本机全局目录兜底假命中）→ 本地绿而 CI 红。告警默认视图只列 open，npm dev 传递依赖告警会被平台自动关闭，升级后 `auto_dismissed` 又被 `fixed` 覆盖、时间戳清空 → 「0 条」被当成「不存在」。预编译二进制门禁工具（jscpd 5.x 的 Rust 产物要求 GLIBC ≥ 2.33）在旧 glibc 上 loader 阶段即失败，与代码无关。

## 修法

- 门禁红先分类：有没有产出本该产出的清单／报告？只有 loader、ENOENT、权限类报错 = 工具没跑起来，此时改代码或重排流水线都是无效功。
- 二进制门禁工具先核它要求的 glibc 与 runner 实际基线，再决定锁哪个版本（`.jscpd.json` 与 `package.json` 里是当前锁定版本）。
- CI 取证先取 job 清单再取正文，不要从归档内容反推 job 清单；单 job 日志必须带凭据并跟随重定向。
- 本地与 CI 同语义：跑 `npm run verify`（CI 等价全量，`--fast` 会打印未跑项）；路径判定改成枚举真实目录项而不是只看存在性，并把环境差异（空 home、大小写敏感、无全局目录）固化成自检用例。
- 巡检必查已关闭告警：`bash skills/dsh-github-triage/scripts/check-dependabot-closed.sh <owner/repo> .`（退出码 1 = 已关闭但仍受影响）。

## 活引用

- `scripts/verify-local.mjs`
- `scripts/check-links.mjs`、`scripts/test/check-links.test.mjs`
- `skills/dsh-github-triage/SKILL.md`、`skills/dsh-github-triage/scripts/check-dependabot-closed.sh`
