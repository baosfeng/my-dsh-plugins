#!/usr/bin/env bash
# typecheck-all.sh — 兼容入口（issue #330）。
#
# 真正的实现在 `scripts/typecheck-all.mjs`：并发（默认 min(4, CPU)）+ 直调 node_modules/.bin/tsc。
# 原实现是一个串行 for 循环、每插件一次 `npx tsc`：29 个任务串行 ≈12.6s，其中约 5s 是 npx 自身的
# 解析开销（每次约 170ms）。优化后本机 ≈2.6s，**门禁语义完全不变**（同样的 tsconfig、同样的插件
# 集合、同样的 --noEmit；"一个 tsconfig 都没找到"仍然判失败，防"什么都没查却绿"）。
#
# 为什么保留这个 .sh：文档与历史命令都在引用 `bash scripts/typecheck-all.sh`（check-links 门禁会
# 校验文档里的 shell 调用真实存在），package.json 的 `typecheck:plugins` 也指向它。
set -euo pipefail
exec node "$(cd "$(dirname "$0")" && pwd)/typecheck-all.mjs" "$@"
