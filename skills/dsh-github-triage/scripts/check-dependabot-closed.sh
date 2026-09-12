#!/usr/bin/env bash
# Dependabot 已关闭告警巡检一键入口（issue #214）。
#
#   bash skills/dsh-github-triage/scripts/check-dependabot-closed.sh [owner/repo] [repo-dir]
#
# 只读：只调用 ghops 的告警查询 + 读本地 lockfile，不改任何东西。
# 退出码：0 = 没有「已关闭但依赖仍受影响」的告警；1 = 有（需人工判读）；2 = 用法/环境错误。
set -uo pipefail

REPO="${1:-baosfeng/my-dsh-plugins}"
REPO_DIR="${2:-$(pwd)}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${PYTHON:-python3}"

command -v ghops >/dev/null 2>&1 || { echo "！找不到 ghops：先按 skills/github-ops 完成 ghops setup（或改用 python3 <github-ops>/scripts/ghops.py）" >&2; exit 2; }
command -v "$PY" >/dev/null 2>&1 || { echo "！找不到 python3" >&2; exit 2; }

TMP_JSON="$(mktemp -t dependabot-closed-XXXXXX).json"
trap 'rm -f "$TMP_JSON"' EXIT

echo "→ ghops alerts ${REPO} --state closed --kind dependabot --json"
if ! ghops alerts "$REPO" --state closed --kind dependabot --json >"$TMP_JSON"; then
  echo "！ghops alerts 执行失败（看上面的报错；网络/凭据问题见 skills/dsh-github-triage 的『网络前置』）" >&2
  exit 2
fi

"$PY" "$HERE/check-dependabot-closed.py" "$TMP_JSON" --repo-dir "$REPO_DIR"
exit $?
