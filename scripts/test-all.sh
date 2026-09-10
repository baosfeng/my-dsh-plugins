#!/usr/bin/env bash
# 遍历插件：node --check 语法检查 + npm test（单元测试 + 覆盖率门禁 + Gherkin 验收）
# 与 .github/workflows/ci.yml 的 test job 保持一致（CI 用 matrix 并行，本脚本供本地/取证用）。
#
# 设计说明（为什么不再 fail-fast）：
#   原先 `set -e` + 首个失败即中断，会让**后面的插件根本没跑**，
#   得到的"失败清单"完全失真（实测一次中断导致 2 个插件漏跑）。
#   现在逐个跑完并汇总，任一插件失败则最终 exit 1。
#
# 用法：
#   bash scripts/test-all.sh                  # 全部插件
#   bash scripts/test-all.sh dsh-shared ...   # 只跑指定插件
#
# 陷阱提醒：不要用 `bash scripts/test-all.sh | tee log` 取退出码——那是 tee 的退出码，
# 后台 job 会误报 exit 0；必须用 ${PIPESTATUS[0]}。
# 另一个已知坑：同一插件目录并发跑 vitest --coverage 会因 coverage 目录锁而启动即死
# （见 docs/踩坑/多agent并行测试资源冲突.md），本脚本请勿与其它测试进程并行跑同一插件。
set -o pipefail

if [ "$#" -gt 0 ]; then
  dirs=()
  for name in "$@"; do
    p="plugins/${name%/}/"
    if [ ! -d "$p" ]; then
      echo "✗ 插件目录不存在：$p" >&2
      exit 1
    fi
    dirs+=("$p")
  done
else
  dirs=()
  for d in plugins/*/; do dirs+=("$d"); done
fi

passed=()
failed=()
skipped=()

for d in "${dirs[@]}"; do
  if [ ! -f "$d/package.json" ]; then
    skipped+=("$d")
    continue
  fi
  echo "== $d =="
  rc=0
  for f in lib/index.js lib/client.js; do
    if [ -f "$d$f" ]; then
      node --check "$d$f" || rc=1
    fi
  done
  if [ "$rc" -eq 0 ]; then
    (cd "$d" && npm test) || rc=$?
  fi
  if [ "$rc" -eq 0 ]; then
    passed+=("$d")
  else
    failed+=("$d (exit $rc)")
  fi
done

echo
echo "==== 全量测试汇总 ===="
if [ "${#passed[@]}" -gt 0 ]; then
  echo "通过 ${#passed[@]} 个：${passed[*]}"
else
  echo "通过 0 个"
fi
if [ "${#failed[@]}" -gt 0 ]; then
  echo "失败 ${#failed[@]} 个："
  for f in "${failed[@]}"; do echo "  - $f"; done
fi
if [ "${#skipped[@]}" -gt 0 ]; then
  echo "跳过 ${#skipped[@]} 个（无 package.json）：${skipped[*]}"
fi

if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAILED"
  exit 1
fi
echo "ALL PLUGIN TESTS PASSED"
