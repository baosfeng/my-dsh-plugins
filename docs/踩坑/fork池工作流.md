---
title: fork 池工作流
description: clone 派生的 fork 钩子、工具链、基线三处失效；squash 合并又让 git cherry 假阴性
---

# fork 池工作流

## 症状关键词（可 grep）

- `git commit` 几十毫秒完成、无 lint-staged 输出；`git push` 秒回、无 `[pre-push]` 输出（钩子没挂）
- `core.hooksPath` 查询为空（期望 `.husky/_`）
- `npx canceled due to missing packages and no YES option`、`Cannot find package '@vitest/coverage-v8'`（漏了 `.bin`）
- `Unused devDependencies`（hook 里的命令被简写成变量，knip 提取不到）
- `git cherry -v` 输出全是 `+`（squash 合并的必然假阴性）
- 新 fork 首个提交 SHA ≠ `git ls-remote origin refs/heads/main`（基线过期）

## 根因

fork 由 `git clone --local` 派生：`.git/config`（hooksPath）与被 gitignore 的 `.husky/_` 都不随 clone 传递，钩子从未挂载；用 shell 的 node_modules 通配循环建软链又会漏掉 `.bin` 等点号开头的隐藏条目。另外 clone 的 `origin/main` 指向主工作区**本地** main（fetch 不移动本地分支）故可能落后；`git cherry` 靠 patch-id 判定，对 squash 合并必然误报「未应用」。

## 修法

- 一律用 `node scripts/fork-pool.mjs create <编号>` 建 fork（含装 hooks 与完整 node_modules），推送前 `node scripts/fork-pool.mjs check <编号>` 自检 hooks／工具链／基线 SHA／误暂存四项。
- 基线判据：fork 起分支前的 HEAD 必须等于 `git ls-remote origin refs/heads/main`，不等就先 fetch 主工作区并 ff-only 合并。
- 判断工作是否已落地：先按 PR 号搜提交，再用 `git diff <base>...<branch> | git patch-id --stable` 与 `git show <squash-commit> | git patch-id --stable` 比对第一列，相同即已合并。
- hook 里 fallback 的 `npx --no-install lint-staged` 必须保持为真实执行的命令，不能简写成变量（knip 会因此报未使用依赖）。

## 活引用

- `scripts/fork-pool.mjs`、`scripts/lib/fork-pool.mjs`、`scripts/test/fork-pool.test.mjs`
- `skills/dsh-github-triage/SKILL.md`
- `.husky/pre-commit`、`.husky/pre-push`
- `scripts/verify-local.mjs`
