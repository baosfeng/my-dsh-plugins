---
title: fork 池基线与 squash 判定两个坑
description: git clone --local 派生的 fork 里 origin/main 取的是主工作区本地 main（可能落后 GitHub）；git cherry 靠 patch-id 判定，对 squash 合并必然假阴性 → 误判「遗留工作未落地」；正确判法是查 main 里的 squash 提交/PR 号 + 比对整体 diff 的 git patch-id --stable
created: 2026-09-12
updated: 2026-09-12
---

# fork 池基线与 squash 判定两个坑

## 坑 1：`git clone --local <主工作区>` 取的是**主工作区本地 main**，不是 origin/main

### 现象

leader 合并了一个 PR 之后再派生 fork，新 fork 的基线仍是**合并前**的提交（实测：main 已到 `9682d16`，新 fork 的 `origin/main` 却是 `2cce091`）。2026-09-12 制作本 PR 时再次复现：主工作区本地 `main` = `a332b32`，而 `git ls-remote origin refs/heads/main` = `6e52973`（本地落后 2 个提交）。

### 机制

`git clone` 会把源的 `refs/heads/*` 映射到目标的 `refs/remotes/origin/*`，**不会**复制源的 remote-tracking refs。所以 fork 里的 `origin/main` = 主工作区**本地** `main` 分支——而主工作区 `git fetch` 只更新 `origin/main` 引用、**不移动本地 main**；主工作区没 `git pull` / `merge --ff-only` 时，它就是落后的。

### 修法（两侧都做最稳）

```bash
# leader 侧：派生前先同步主工作区本地 main（fetch 只动 origin/main 引用，必须再 ff-only 合并）
git -C <主工作区> fetch origin && git -C <主工作区> merge --ff-only origin/main

# fork 侧：set-url 指向 GitHub 之后、建分支之前，显式拉一次 main
git -C /tmp/gh-fork-<编号> remote set-url origin https://github.com/baosfeng/my-dsh-plugins.git
git -C /tmp/gh-fork-<编号> fetch origin main
git -C /tmp/gh-fork-<编号> checkout -b fix/<编号> origin/main
```

### 判据（怎么确认基线正确）

`git -C /tmp/gh-fork-<编号> log --oneline -1` 的 SHA 必须与 `git ls-remote origin refs/heads/main` 一致；不一致就是拿到了过期基线，先 fetch 再起分支。

## 坑 2：`git cherry` 不能用来判断「工作是否已合并到 main」（squash 必然假阴性）

### 现象

fork 里 2 个提交，`git cherry -v origin/main HEAD` 全部标 `+`（= 未应用），据此判定「这是搁置 4 天的遗留工作，需要抢救」——**结论是错的**：那份工作其实早已通过 **squash 合并**进了 main（PR #182）。

### 机制

squash 会把 N 个提交压成 1 个新提交，**patch-id 必然不同**；`git cherry` 正是靠 patch-id 判断「是否已应用」，于是对 squash 合并的提交**必然误报未应用**（假阴性）。本地最小复现（2026-09-12）：

```bash
# 造一个 squash 合并：feature 两个提交 → main 上一个 squash 提交
git merge --squash feature && git commit -m "squash feature (#182)"
git cherry -v main feature                        # → 两个提交都标 +（误报「未应用」）
git diff main...feature | git patch-id --stable   # → 2f21a427… 0000000…
git show <squash-commit> | git patch-id --stable  # → 2f21a427… 8dc1041…  ← 第一列相同 ⇒ 已落地
```

### 正确判法

1. **先查 main 历史里的 squash 提交与 PR 号**：`git log --oneline --grep="#<PR>"`（squash 提交标题通常带 PR 号）；
2. **再用整体 diff 的 patch-id 交叉验证**：

```bash
git diff <base>...<branch> | git patch-id --stable    # fork 侧：该分支相对 base 的整体改动
git show <squash-commit> | git patch-id --stable      # main 侧：疑似对应的 squash 提交
```

两行输出的**第一列（patch-id）**相同 ⇒ 已落地。第二列是 commit id：`git diff` 管道没有 commit 头时为全 0，不参与比对。

**教训**：判断「某工作是否已在 main」时**不要只信 `git cherry`**——它只适合「逐个提交原样应用（cherry-pick / rebase）」的场景；squash 合并必须走上面的 patch-id 判法。

## 附带发现：多个 agent 并行跑全插件测试会超时（EXIT=124）

同一轮实测：两个 agent 各跑一次 `node scripts/verify-local.mjs --fast` 都超时（`EXIT=124`）。这不是代码问题，而是**资源竞争**——与 [多 agent 并行测试资源冲突](多agent并行测试资源冲突.md) 同源。派发时应避免让多个 agent 同时跑全插件测试（同一插件同一时刻只允许一个测试进程）；该轮 `--fast` 的失败**不能**当作代码问题，以 CI 结果为准，或在无竞争时段重跑。

## 相关

- `skills/dsh-github-triage/SKILL.md`（fork 池隔离方案 —— 已补「fork 基线与 squash 判定」两条与常见错误行）
- [多 agent 并行测试资源冲突](多agent并行测试资源冲突.md)（并行跑测试的资源竞争，本文附带发现的上游记录）
- `skills/verifying-dsh-plugins/SKILL.md`（派生前置与验证流程）
