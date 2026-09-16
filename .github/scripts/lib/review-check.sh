#!/usr/bin/env bash
# 统一检查封装（issue #303 结构 + issue #311 判定内核）。
#
# 分工：**本文件只负责「跑命令 + 收输出」**；所有判定（通过 / 不通过 / 未能判定、
# 抖动标注、历史摘要、三段结构渲染）都在 `.github/scripts/review-verdict.cjs` 里，
# 由 `review-verdict.test.cjs` 逐分支覆盖。判定分支不再散落在 shell 的 if/elif 中。
#
# 用法（在各 job 的 run 段里 source 后使用）：
#   source .github/scripts/lib/review-check.sh
#   review_init  review-report.md "代码质量"
#   run_check    review-report.md "ESLint 静态检查" eslint npx eslint plugins/ --format json
#   review_ci_authoritative test-report.md "测试与覆盖率" "$HEAD_SHA" ci.yml
#   review_finish review-report.md "- 优先修复「不通过」项。"
#
# 结论三态（严禁把「没真正跑」写成通过）：
#   通过      命令 exit 0
#   不通过    命令 exit 1..123 且确实产出了问题证据（可统计到问题 / 有输出）
#   未能判定  超时（124）/ 命令不可用（125/126/127）/ 被信号杀掉（>128）/
#             无输出 / 统计不出问题 / 工具或依赖不可用（网络、模块缺失）/ 一条检查都没执行
#
# 报告结构（诉求：精炼、一针见血、结论唯一）：
#   ## 结论        ← 唯一总结论（通过 / 不通过 / 未能判定）+ 统计
#   ## 关键证据    ← 各检查小节，中文摘要，超出即指向 CI 日志 / artifact
#   ## 建议        ← 可执行的下一步

REVIEW_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REVIEW_MAX_EVIDENCE="${REVIEW_MAX_EVIDENCE:-3}"
REVIEW_CHECK_TIMEOUT="${REVIEW_CHECK_TIMEOUT:-600}"

# _review_verdict <子命令参数...>：把所有判定交给同一个 node 内核（shell 不做判定）
_review_verdict() {
  node "$REVIEW_SCRIPTS_DIR/review-verdict.cjs" "$@"
}

# review_init <报告文件> <模块名>
review_init() {
  : >"$1"
  REVIEW_MODULE="$2"
}

# run_check <报告文件> <检查名> <摘要 kind> <命令...>
run_check() {
  local report="$1" name="$2" kind="$3"
  shift 3
  local tmp status=0 lines
  tmp="$(mktemp)"
  timeout "$REVIEW_CHECK_TIMEOUT" "$@" >"$tmp" 2>&1 || status=$?
  lines="$(grep -cvE '^[[:space:]]*$' "$tmp" 2>/dev/null || true)"
  [ -n "$lines" ] || lines=0

  _review_verdict check \
    --report "$report" --name "$name" --kind "$kind" \
    --status "$status" --lines "$lines" --output "$tmp" \
    --max "$REVIEW_MAX_EVIDENCE" --timeout "$REVIEW_CHECK_TIMEOUT" ||
    printf '#### %s\n\n**结论**：未能判定（判定内核执行失败，无法给出结论）\n\n' "$name" >>"$report"
  rm -f "$tmp"
}

# review_check_scope <报告文件> <检查名> <摘要 kind> <门禁 scope 名（白名单，如 gate）> <命令...>
# 用于「门禁口径 vs 全量」不一致的检查（当前仅圈复杂度）：三态只由**门禁口径**决定，
# 全量数字作为「提示（非门禁）」，不参与 outcome。门禁口径 0 处而命令又异常退出时判「未能判定」，
# 绝不因为"过滤后是 0"就写成通过（#311 静默当通过的一种形态）。
review_check_scope() {
  local report="$1" name="$2" kind="$3" scope="$4"
  shift 4
  local tmp status=0 counts matched total
  tmp="$(mktemp)"
  timeout "$REVIEW_CHECK_TIMEOUT" "$@" >"$tmp" 2>&1 || status=$?
  counts="$(node "$REVIEW_SCRIPTS_DIR/summarize-tool-output.cjs" --kind "$kind" --input "$tmp" --counts --path-filter "$scope" 2>/dev/null || true)"
  matched="$(printf '%s' "$counts" | awk '{print $1}')"
  total="$(printf '%s' "$counts" | awk '{print $2}')"
  [ -n "$matched" ] || matched=""
  [ -n "$total" ] || total=""

  local hint="全量 ${total:-?} 处（含 test/*.mjs 等非门禁对象），不影响合并门禁。"
  _review_verdict scope \
    --report "$report" --name "$name" --kind "$kind" --scope "$scope" \
    --status "$status" --output "$tmp" --max "$REVIEW_MAX_EVIDENCE" \
    --timeout "$REVIEW_CHECK_TIMEOUT" --hint "$hint" \
    --matched "${matched:-}" --total "${total:-}" ||
    printf '#### %s\n\n**结论**：未能判定（判定内核执行失败，无法给出结论）\n\n' "$name" >>"$report"
  rm -f "$tmp"
}

# review_ci_authoritative <报告文件> <检查名> <head sha> [workflow 文件名（默认 ci.yml）]
# **测试类检查的权威结果来自 CI**：不重复跑测试（避免把仓库 flaky 当代码问题，也避免两套口径），
# 只读取该 commit 上 CI 已产生的 run 结果（`gh run list --commit <sha>`，有界等待 REVIEW_CI_WAIT 秒）：
#   - 有成功运行                     → 通过（权威结果）
#   - 同一 commit 另有失败/超时运行   → 仍判通过 + 标注「疑似环境抖动」（不翻转结论）
#   - 全部失败                       → 不通过
#   - 只有超时/取消、没有成功运行     → 未能判定
#   - 没有运行 / 等不到 / 读不到      → 未能判定（显式说明原因，绝不当通过）
review_ci_authoritative() {
  local report="$1" name="$2" sha="$3" workflow="${4:-ci.yml}"
  if ! command -v gh >/dev/null 2>&1; then
    _review_verdict ci-runs --report "$report" --name "$name" --workflow "$workflow" --sha "$sha" --fetch-status 127
    return
  fi
  _review_verdict ci-runs \
    --report "$report" --name "$name" --workflow "$workflow" --sha "$sha" \
    --wait "${REVIEW_CI_WAIT:-600}" --poll "${REVIEW_CI_POLL:-30}" ||
    printf '#### %s\n\n**结论**：未能判定（无法读取 CI 结果）\n\n' "$name" >>"$report"
}

# review_finish <报告文件> <建议文案> <历史结论串（可空）>
review_finish() {
  local report="$1" suggest="$2" history="${3:-}"
  _review_verdict finish \
    --report "$report" --module "${REVIEW_MODULE:-审查}" --suggest "$suggest" --history "$history" \
    --max-lines "${REVIEW_MAX_LINES:-30}" ||
    printf '## 结论\n\n未能判定（报告汇总失败，请直接查看本 job 日志）\n' >"$report"
  # 报告同时打进 job 日志：评论发不出去时（如 fork PR 无写权限）结论仍然可见，也便于事后取证
  printf '\n===== 审查报告（%s）=====\n' "${REVIEW_MODULE:-审查}"
  cat "$report"
  printf '\n===== 报告结束 =====\n'
}

# review_not_covered <报告文件> <检查名> <原因>：**根本没接入自动化**（平台托管 / 不重复执行 CI 已跑的测试）。
# 不参与总结论聚合，单列「未覆盖检查」段；不代表通过，也不阻塞合并。
review_not_covered() {
  _review_verdict notcovered --report "$1" --name "$2" --reason "$3" ||
    printf '%s\n' "- **未覆盖检查**：$2 — $3（需接入自动化才能覆盖）" >>"$1"
}

# review_unknown <报告文件> <检查名> <原因>：**已接入但本次没跑成**（超时/命令缺失/无输出/退出码异常），严禁写 ✅。
review_unknown() {
  _review_verdict unknown --report "$1" --name "$2" --reason "$3" ||
    printf '#### %s\n\n**结论**：未能判定（%s）\n\n' "$2" "$3" >>"$1"
}
