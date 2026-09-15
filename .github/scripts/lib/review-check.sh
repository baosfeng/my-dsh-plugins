#!/usr/bin/env bash
# 统一检查封装（issue #303）：把「工具原始输出」变成「三段结构 + 唯一定论」。
#
# 用法（在各 job 的 run 段里 source 后使用）：
#   source .github/scripts/lib/review-check.sh
#   review_init  review-report.md "代码质量"
#   run_check    review-report.md "ESLint 静态检查" eslint npx eslint plugins/ --format compact
#   review_finish review-report.md "- 优先修复「不通过」项。"
#
# 结论三态（严禁把「没真正跑」写成通过）：
#   通过      命令 exit 0
#   不通过    命令 exit 1..123（有输出，真实失败）
#   未能判定  超时（124）/ 命令不可用（126/127）/ 被信号杀掉（>128）/ 无输出（无法确认是否真的跑了）
#
# 报告结构（诉求：精炼、一针见血、结论唯一）：
#   ## 结论        ← 唯一总结论（通过 / 不通过 / 未能判定）+ 历史结论摘要
#   ## 关键证据    ← 各检查小节，每条最多 5 条中文摘要，超出提示见 CI 日志
#   ## 建议        ← 可执行的下一步

REVIEW_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REVIEW_MAX_EVIDENCE="${REVIEW_MAX_EVIDENCE:-3}"
REVIEW_CHECK_TIMEOUT="${REVIEW_CHECK_TIMEOUT:-600}"

# review_init <报告文件> <模块名>
review_init() {
  : >"$1"
  REVIEW_MODULE="$2"
}

# _review_reason <exit code>
_review_reason() {
  case "$1" in
    124) printf '超时（超过 %ss 未完成）' "$REVIEW_CHECK_TIMEOUT" ;;
    125) printf '命令以错误用法退出' ;;
    126) printf '命令不可执行（可能是依赖未安装）' ;;
    127) printf '命令不存在（可能是依赖未安装）' ;;
    *) printf '进程异常退出（exit %s）' "$1" ;;
  esac
}

# run_check <报告文件> <检查名> <摘要 kind> <命令...>
run_check() {
  local report="$1" name="$2" kind="$3"
  shift 3
  local tmp status=0
  tmp="$(mktemp)"
  timeout "$REVIEW_CHECK_TIMEOUT" "$@" >"$tmp" 2>&1 || status=$?
  local lines
  lines="$(grep -cvE '^[[:space:]]*$' "$tmp" 2>/dev/null || true)"
  [ -n "$lines" ] || lines=0

  printf '#### %s\n\n' "$name" >>"$report"
  if [ "$status" -eq 0 ]; then
    printf '**结论**：通过\n\n' >>"$report"
  elif [ "$status" -ge 124 ] || [ "$lines" -eq 0 ]; then
    if [ "$lines" -eq 0 ] && [ "$status" -lt 124 ]; then
      printf '**结论**：未能判定（命令无输出，无法确认检查是否真正执行）\n\n' >>"$report"
    else
      printf '**结论**：未能判定（%s）\n\n' "$(_review_reason "$status")" >>"$report"
    fi
  else
    printf '**结论**：不通过\n\n' >>"$report"
    printf '关键证据（最多 %s 条）：\n\n' "$REVIEW_MAX_EVIDENCE" >>"$report"
    node "$REVIEW_SCRIPTS_DIR/summarize-tool-output.cjs" \
      --kind "$kind" --input "$tmp" --max "$REVIEW_MAX_EVIDENCE" >>"$report" 2>/dev/null ||
      printf '%s\n' '- 摘要生成失败，完整输出见 CI 日志' >>"$report"
    printf '\n> 完整结果见本次运行的 CI 日志（job：%s）。\n\n' "${GITHUB_JOB:-review}" >>"$report"
  fi
  rm -f "$tmp"
}

# _review_collect_outcomes <报告文件> → 每行一个结论（通过 / 不通过 / 未能判定）
_review_collect_outcomes() {
  grep -oE '\*\*结论\*\*：(通过|不通过|未能判定)' "$1" 2>/dev/null | sed 's/.*：//' || true
}

# review_finish <报告文件> <建议文案> <历史结论串（可空）>
review_finish() {
  local report="$1" suggest="$2" history="${3:-}" body overall suffix nclines
  body="$(mktemp)"
  cp "$report" "$body"
  local pass fail unknown notcovered
  pass="$(_review_collect_outcomes "$body" | grep -c '^通过$' || true)"
  fail="$(_review_collect_outcomes "$body" | grep -c '^不通过$' || true)"
  unknown="$(_review_collect_outcomes "$body" | grep -c '^未能判定$' || true)"
  notcovered="$(grep -c '^- \*\*未覆盖检查\*\*：' "$body" || true)"
  if [ "${fail:-0}" -gt 0 ]; then
    overall="不通过"
  elif [ "${unknown:-0}" -gt 0 ]; then
    overall="未能判定"
  elif [ "${pass:-0}" -gt 0 ]; then
    overall="通过"
  elif [ "${notcovered:-0}" -gt 0 ]; then
    # 只有未覆盖项：未覆盖不参与聚合，故结论为通过 + 标注未覆盖（边界说明已在结论下方给出）
    overall="通过"
  else
    overall="未能判定（本次未执行任何检查）"
  fi
  suffix=""
  [ "${notcovered:-0}" -gt 0 ] && suffix="（${notcovered} 项未覆盖）"
  # 未覆盖行单独取出（不参与结论聚合；也不留在证据段里重复出现）
  nclines="$(grep '^- \*\*未覆盖检查\*\*：' "$body" || true)"
  {
    printf '## 结论\n\n%s%s\n\n' "$overall" "$suffix"
    printf '统计：通过 %s 项 / 不通过 %s 项 / 未能判定 %s 项 / 未覆盖 %s 项\n\n' \
      "${pass:-0}" "${fail:-0}" "${unknown:-0}" "${notcovered:-0}"
    printf '边界：未覆盖检查=没接入自动化（不代表通过，也不阻塞合并）；未能判定=已接入但本次没跑成。\n\n'
    if [ -n "$history" ]; then printf '历史：%s\n\n' "$history"; fi
    printf '## 关键证据（模块：%s）\n\n' "${REVIEW_MODULE:-审查}"
    grep -v '^- \*\*未覆盖检查\*\*：' "$body" || true
    if [ "${notcovered:-0}" -gt 0 ]; then
      printf '\n## 未覆盖检查（%s 项）\n\n%s\n\n不代表通过，也不阻塞合并；需接入自动化才能覆盖。\n\n' "$notcovered" "$nclines"
    fi
    printf '## 建议\n\n%s\n' "$suggest"
  } >"$report"
  rm -f "$body"
  node -e '
    const fs = require("fs")
    const { truncateLines } = require(process.argv[1] + "/review-comment.cjs")
    const f = process.argv[2]
    fs.writeFileSync(f, truncateLines(fs.readFileSync(f, "utf8"), Number(process.env.REVIEW_MAX_LINES || 30), "完整结果见本次运行的 artifact 与 CI 日志"))
  ' "$REVIEW_SCRIPTS_DIR" "$report" 2>/dev/null || true
}

# review_not_covered <报告文件> <检查名> <原因>：**根本没接入自动化**（平台托管 / 不重复执行 CI 已跑的测试）。
# 不参与总结论聚合，单列「未覆盖检查」段；不代表通过，也不阻塞合并。
review_not_covered() {
  printf '%s\n' "- **未覆盖检查**：$2 — $3（需接入自动化才能覆盖）" >>"$1"
}

# review_unknown <报告文件> <检查名> <原因>：**已接入但本次没跑成**（超时/命令缺失/无输出/退出码异常），严禁写 ✅。
review_unknown() {
  printf '#### %s\n\n**结论**：未能判定（%s）\n\n' "$2" "$3" >>"$1"
}

# review_check_scope <报告文件> <检查名> <摘要 kind> <门禁 scope 名（白名单，如 gate）> <命令...>
# 用于「门禁口径 vs 全量」不一致的检查（当前仅圈复杂度）：三态只由**门禁口径**决定，
# 全量数字作为「提示（非门禁）」，不参与 outcome。
review_check_scope() {
  local report="$1" name="$2" kind="$3" scope="$4"
  shift 4
  local tmp status=0 counts matched total
  tmp="$(mktemp)"
  timeout "$REVIEW_CHECK_TIMEOUT" "$@" >"$tmp" 2>&1 || status=$?
  counts="$(node "$REVIEW_SCRIPTS_DIR/summarize-tool-output.cjs" --kind "$kind" --input "$tmp" --counts --path-filter "$scope" 2>/dev/null || true)"
  matched="$(printf '%s' "$counts" | awk '{print $1}')"
  total="$(printf '%s' "$counts" | awk '{print $2}')"

  printf '#### %s\n\n' "$name" >>"$report"
  if [ "$status" -ge 124 ]; then
    printf '**结论**：未能判定（%s）\n\n' "$(_review_reason "$status")" >>"$report"
  elif [ -z "$matched" ]; then
    printf '**结论**：未能判定（无法统计检查结果）\n\n' >>"$report"
  elif [ "$matched" -gt 0 ]; then
    printf '**结论**：不通过（门禁口径 %s 处）\n\n' "$matched" >>"$report"
    printf '门禁口径证据（scope=%s，最多 %s 条）：\n\n' "$scope" "$REVIEW_MAX_EVIDENCE" >>"$report"
    node "$REVIEW_SCRIPTS_DIR/summarize-tool-output.cjs" --kind "$kind" --input "$tmp" \
      --max "$REVIEW_MAX_EVIDENCE" --path-filter "$scope" >>"$report" 2>/dev/null || true
    printf '\n' >>"$report"
  else
    printf '**结论**：通过（门禁口径 0 处超标）\n\n' >>"$report"
  fi
  printf '%s\n\n' "- **提示（非门禁）**：全量 ${total:-?} 处（含 test/*.mjs 等非门禁对象），不影响合并门禁。" >>"$report"
  rm -f "$tmp"
}
