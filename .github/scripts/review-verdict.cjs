'use strict'

/**
 * 审查判定内核（issue #311）—— 「唯一权威结论 + 未能判定显式 + 同一 commit 可复现 + 抖动区分」。
 *
 * 为什么必须抽成模块：#311 的核心诉求是**判定确定性**（同一 commit 多次检查结论一致；
 * 「没能真正跑」绝不写成「通过」），而原实现把这些判据散在 shell 的 if/elif 里
 * （`.github/scripts/lib/review-check.sh`）——分支写错了没人能发现。现在 shell 只负责
 * 「跑命令 + 收输出」，**所有判定都在这里**，由 `review-verdict.test.cjs`（node --test）逐分支覆盖。
 *
 * 三条硬规则：
 *   1) 三态互斥且显式：通过 / 不通过 / **未能判定**；「没跑成」（超时、命令缺失、依赖不可用、
 *      被信号杀掉、命令无输出、统计不出任何结果）一律判「未能判定」，**绝不当作通过**；
 *   2) 判定不依赖网络/时序/随机：除「读取 CI 已产生的运行结果」外没有任何输入，
 *      同一输入必得同一结论（`classifyCiRuns` 只按 run 的 status/conclusion 分类）；
 *   3) 抖动与代码问题分开表述：「疑似抖动」不是结论，而是**历史/提示维度**——
 *      同一 commit 的 CI 既有成功又有失败运行（超时/取消）时，结论仍按成功的那次给出（通过），
 *      同时在提示与历史摘要里标出「疑似环境抖动 ×N」，让「结论看起来变过」这件事本身可解释。
 *
 * CLI（供 workflow 的 shell 调用；判定全部走同一套纯函数）：
 *   node .github/scripts/review-verdict.cjs check  --report R --name N --kind K --status S --output F [--counts --path-filter gate]
 *   node .github/scripts/review-verdict.cjs finish --report R --module M --suggest S [--history H] [--max-lines 30]
 *   node .github/scripts/review-verdict.cjs ci-runs --report R --name N --workflow ci.yml --sha SHA < runs.json
 *   node .github/scripts/review-verdict.cjs notcovered --report R --name N --reason R2
 *   node .github/scripts/review-verdict.cjs unknown    --report R --name N --reason R2
 */

const fs = require('node:fs')
const { spawnSync } = require('node:child_process')

const { OUTCOMES, stripAnsi, fitReport, flakyMarker, countFlaky, FLAKY_RE } = require('./review-comment.cjs')
const { summarizeToolOutput, countIssues, resolvePathFilter } = require('./summarize-tool-output.cjs')

/** 取 commit 短 SHA（7 位；非 SHA 输入原样截断，绝不抛错）。 */
function shortSha(sha) {
  return String(sha || '')
    .trim()
    .slice(0, 7)
}

/** 退出码 → 「未能判定」原因；返回 null = 不是进程层面的失败。 */
function exitReason(status, timeoutSeconds) {
  if (status === 124) return `超时（超过 ${timeoutSeconds}s 未完成）`
  if (status === 125) return '命令以错误用法退出'
  if (status === 126) return '命令不可执行（可能是依赖未安装）'
  if (status === 127) return '命令不存在（可能是依赖未安装）'
  if (status > 128) return `被信号中断（信号 ${status - 128}）`
  return null
}

/**
 * 「工具/环境层面失败」特征 → 判「未能判定」而不是「代码不通过」。
 *
 * 为什么必须分开：`npm audit` 在 registry 不可达时 exit 1（输出 `audit endpoint returned an error`），
 * 原文案会把它写成「不通过（依赖漏洞）」——读者据此去查根本没发生的漏洞（issue #199 实测过这个端点问题）；
 * 反过来 eslint 因模块缺失崩溃也会被读成「代码有错」。这类失败**没有判定所依据的结果**，只能是「未能判定」。
 *
 * 保守取值：只认明确属于环境/工具层面的特征行，宁可不命中——漏判的代价是「不通过」（有人去查），
 * 误判的代价是「未能判定」（有人去看日志），两者都不会伪装成通过。
 */
const INFRA_PATTERNS = [
  { re: /Cannot find module ['"]/, zh: '依赖缺失（找不到模块）' },
  { re: /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/, zh: '依赖缺失（找不到模块）' },
  { re: /npm error code E[A-Z]+|npm ERR! code E/, zh: '包管理器错误（依赖不可用）' },
  { re: /audit endpoint returned an error/i, zh: '审计服务不可用（registry 不支持 audit 端点）' },
  { re: /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|getaddrinfo/i, zh: '网络不可用' },
  { re: /command not found|not recognized as an internal or external command/i, zh: '命令不可用' },
  { re: /(ESLint|Prettier|tsc)[^\n]{0,40}(couldn't find|cannot find)[^\n]{0,40}config/i, zh: '检查工具配置缺失' },
]

/** 在输出里识别「环境/工具层面失败」；命中即返回中文原因，否则 null。 */
function detectInfrastructureFailure(output) {
  const text = stripAnsi(String(output ?? ''))
  for (const { re, zh } of INFRA_PATTERNS) {
    if (re.test(text)) return zh
  }
  return null
}

/**
 * 单条本地检查的判定（`run_check` / `review_check_scope` 共用）。
 *
 * @param {object} input
 * @param {number} input.status         命令退出码（0 = 成功）
 * @param {number} [input.lineCount]    非空输出行数（0 = 命令什么都没输出）
 * @param {number} [input.matched]      门禁口径命中的问题数（仅 scope 模式提供）
 * @param {number} [input.total]        全量问题数（仅 scope 模式提供）
 * @param {string} [input.output]       命令原始输出（识别环境失败用）
 * @param {number} [input.timeoutSeconds] 超时阈值（构成原因文案）
 * @returns {{outcome: string, reason: string}}
 */
function classifyCheck(input = {}) {
  const status = Number(input.status ?? 0)
  const { lineCount = 0, output = '', timeoutSeconds = 600 } = input
  const hasCounts = Number.isInteger(input.matched) && Number.isInteger(input.total)

  if (status === 0) {
    // 门禁口径已经数出问题却 exit 0（工具自相矛盾）→ 以问题为准，不能算通过
    if (hasCounts && input.matched > 0) return { outcome: OUTCOMES.FAIL, reason: `门禁口径 ${input.matched} 处问题` }
    return { outcome: OUTCOMES.PASS, reason: '' }
  }

  const exit = exitReason(status, timeoutSeconds)
  if (exit) return { outcome: OUTCOMES.UNKNOWN, reason: exit }

  if (status >= 1 && status <= 123) {
    if (hasCounts) {
      if (input.matched > 0) return { outcome: OUTCOMES.FAIL, reason: `门禁口径 ${input.matched} 处问题` }
      // 全量有问题但门禁口径 0 处：这是「门禁口径 vs 全量」的既定语义（见 quality-gates），不是漏跑
      if (input.total > 0) {
        return { outcome: OUTCOMES.PASS, reason: `门禁口径 0 处超标（全量 ${input.total} 处不计入门禁）` }
      }
      return { outcome: OUTCOMES.UNKNOWN, reason: '命令异常退出且未能统计出任何问题（无法确认检查是否真正执行）' }
    }
    const infra = detectInfrastructureFailure(output)
    if (infra) return { outcome: OUTCOMES.UNKNOWN, reason: `检查工具/环境不可用：${infra}` }
    if (lineCount === 0) return { outcome: OUTCOMES.UNKNOWN, reason: '命令无输出，无法确认检查是否真正执行' }
    return { outcome: OUTCOMES.FAIL, reason: '' }
  }

  return { outcome: OUTCOMES.UNKNOWN, reason: `进程异常退出（exit ${status}）` }
}

/**
 * 三态聚合：不通过 > 未能判定 > 通过；空集 = 未能判定（**没跑任何检查绝不是通过**）。
 * 抖动（OUTCOMES.FLAKY）不参与结论聚合——它只影响历史/提示（见 historyOutcome）。
 */
function aggregateOutcomes(outcomes = []) {
  const list = outcomes.filter(Boolean)
  if (list.some((o) => o === OUTCOMES.FAIL)) return OUTCOMES.FAIL
  if (list.some((o) => o === OUTCOMES.UNKNOWN)) return OUTCOMES.UNKNOWN
  if (list.some((o) => o === OUTCOMES.PASS)) return OUTCOMES.PASS
  return OUTCOMES.UNKNOWN
}

/** 历史条目里的结论口径：判定通过但同一 commit 观测到抖动 → 记为「疑似抖动」。 */
function historyOutcome(outcome, flakyCount = 0) {
  if (outcome === OUTCOMES.PASS && Number(flakyCount) > 0) return OUTCOMES.FLAKY
  return outcome
}

/**
 * CI 运行结果 → 测试类检查的权威结论（**不重复跑测试**，只读 CI 已产生的 run）。
 *
 * 分类规则（纯函数，同一 JSON 必得同一结论）：
 *   - 没有任何 run                      → 未能判定（CI 尚未在该 commit 上运行）
 *   - 有 run 但都未 completed            → 未能判定（CI 仍在运行，等它跑完）
 *   - 全部 completed 且全部 success      → 通过
 *   - 有 success 也有失败/中断           → 通过 + 抖动标注（同一 commit 的成功运行即权威证据，
 *                                          失败那次按「疑似环境抖动」记录，**不翻转结论**）
 *   - 全部 failure                      → 不通过（同一 commit 的每一次运行都失败，与代码相关）
 *   - 无 success、且存在中断/取消/超时    → 未能判定（环境/超时导致没有有效结果，不能读成代码问题）
 *   - 只有 skipped                      → 未能判定（检查根本没执行）
 *
 * @param {Array<{status?:string, conclusion?:string, databaseId?:number, attempt?:number}>} runs
 * @param {{workflow?:string, sha?:string}} [meta]
 */
function classifyCiRuns(runs, meta = {}) {
  const list = Array.isArray(runs) ? runs.filter((r) => r && typeof r === 'object') : []
  const short = shortSha(meta.sha)
  const label = meta.workflow ? `CI（${meta.workflow}）` : 'CI'
  if (list.length === 0) {
    return { outcome: OUTCOMES.UNKNOWN, reason: `${label} 尚未在 commit ${short || '?'} 上产生运行结果`, flaky: 0 }
  }
  const completed = list.filter((r) => r.status === 'completed')
  if (completed.length === 0) {
    return { outcome: OUTCOMES.UNKNOWN, reason: `${label} 仍在运行（${list[0].status}），暂不判定`, flaky: 0 }
  }
  const by = (c) => completed.filter((r) => r.conclusion === c)
  const success = by('success')
  const failure = by('failure')
  const interrupted = completed.filter((r) =>
    ['timed_out', 'cancelled', 'startup_failure', 'stale', 'action_required'].includes(r.conclusion),
  )
  const skipped = by('skipped')
  const flaky = success.length > 0 ? failure.length + interrupted.length : 0

  if (success.length > 0) {
    const reason =
      flaky > 0 ? `通过（同一 commit 另有 ${flaky} 次失败/中断运行，已标注为疑似环境抖动）` : `${label} 全部通过`
    return { outcome: OUTCOMES.PASS, reason, flaky }
  }
  if (failure.length > 0 && interrupted.length === 0 && skipped.length === 0) {
    return { outcome: OUTCOMES.FAIL, reason: `${label} 的 ${failure.length} 次运行全部失败`, flaky: 0 }
  }
  if (interrupted.length > 0) {
    return {
      outcome: OUTCOMES.UNKNOWN,
      reason: `${label} 存在 ${interrupted.length} 次中断/取消/超时且无成功运行，无法判定（疑似环境抖动）`,
      flaky: interrupted.length,
    }
  }
  if (failure.length > 0) {
    return { outcome: OUTCOMES.UNKNOWN, reason: `${label} 结果混合（失败 + 跳过），无法给出唯一结论`, flaky: 0 }
  }
  return { outcome: OUTCOMES.UNKNOWN, reason: `${label} 的 ${completed.length} 次运行均被跳过，检查未执行`, flaky: 0 }
}

/** 同步 sleep（不引第三方依赖；等待只影响「有没有结果」，不影响判定本身）。 */
function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms))
}

/**
 * 等 CI 在该 commit 上给出结果（**有界**等待；等不到就是「未能判定」，绝不猜、绝不自己再跑一遍）。
 *
 * 依赖注入（fetch/classify/sleep/now）让本函数可离线单测：真实路径用 `gh run list`，
 * 测试路径用假 fetch，断言「有界等待 + 运行中→未能判定 + 抖动只标注」。
 */
function waitForCiResult({
  fetchRuns,
  sha,
  workflow,
  waitSeconds = 600,
  pollSeconds = 30,
  sleep = defaultSleep,
  now = Date.now,
  classify = (runs) => classifyCiRuns(runs, { workflow, sha }),
} = {}) {
  const deadline = now() + Math.max(0, waitSeconds) * 1000
  for (;;) {
    const fetched = fetchRuns({ workflow, sha }) || {}
    if (fetched.status !== 0 || !Array.isArray(fetched.runs)) {
      return {
        outcome: OUTCOMES.UNKNOWN,
        reason: `无法读取 CI 权威结果（gh 退出码 ${fetched.status ?? '?'}：权限或网络问题）`,
        flaky: 0,
      }
    }
    const verdict = classify(fetched.runs)
    const pending = fetched.runs.length === 0 || fetched.runs.some((r) => r && r.status !== 'completed')
    if (!pending || now() >= deadline) return verdict
    sleep(Math.min(pollSeconds, Math.max(1, Math.ceil((deadline - now()) / 1000))) * 1000)
  }
}

/* ─────────────────────────── 历史结论摘要（一致性可追溯） ─────────────────────────── */
const HISTORY_RE = /<!--\s*dsh-review-history:([^>]*?)-->/
const VALID_OUTCOMES = [OUTCOMES.PASS, OUTCOMES.FAIL, OUTCOMES.UNKNOWN, OUTCOMES.FLAKY]

/**
 * 解析历史条目：新格式 `sha7:结论`，旧格式（#303 的裸结论）也认（sha 记为空串）。
 * @returns {Array<{sha: string, outcome: string}>}
 */
function parseHistory(previousBody, { keep = 8 } = {}) {
  const m = HISTORY_RE.exec(String(previousBody || ''))
  if (!m) return []
  return m[1]
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((token) => {
      const i = token.indexOf(':')
      if (i < 0) return { sha: '', outcome: token }
      return { sha: token.slice(0, i).trim(), outcome: token.slice(i + 1).trim() }
    })
    .filter((e) => VALID_OUTCOMES.includes(e.outcome))
    .slice(-keep)
}

/** 历史条目 → 一行中文摘要（让「结论变了」本身可解释）。 */
function renderHistoryLine(entries = []) {
  const list = entries.filter((e) => e && VALID_OUTCOMES.includes(e.outcome))
  if (list.length === 0) return ''
  const parts = []
  for (const name of VALID_OUTCOMES) {
    const n = list.filter((e) => e.outcome === name).length
    if (n > 0) parts.push(`${name} ×${n}`)
  }
  return `检查 ${list.length} 次：${parts.join('、')}`
}

/** 追加本次结论，返回历史行与要写回评论的隐藏注释。 */
function mergeHistoryEntry(previousBody, { sha = '', outcome } = {}, { keep = 8 } = {}) {
  const entries = [...parseHistory(previousBody, { keep: keep - 1 }), { sha: shortSha(sha), outcome }].slice(-keep)
  return {
    entries,
    historyLine: renderHistoryLine(entries),
    historyComment: `<!-- dsh-review-history: ${entries.map((e) => `${e.sha}:${e.outcome}`).join(',')} -->`,
  }
}

/** 找同一 commit **上一次**的历史条目（用于「同一 commit 结论是否翻转」的解释）。 */
function findSameShaEntry(entries = [], sha = '') {
  const short = shortSha(sha)
  if (!short) return null
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i] && entries[i].sha === short) return entries[i]
  }
  return null
}

/**
 * 「同一 commit 结论变了」的解释文案（不是翻转结论，而是解释差异）。
 * 不同 commit 之间结论不同 = 正常（代码变了）；同一 commit 之间不同 = 必须说明原因。
 */
function explainConsistency(entries, sha, outcome) {
  const prev = findSameShaEntry(entries, sha)
  const short = shortSha(sha)
  if (!prev || prev.outcome === outcome) return ''
  return (
    `同一 commit \`${short}\` 的上一次结论为「${prev.outcome}」，本次为「${outcome}」。` +
    '同一 commit 的判定差异只可能来自环境抖动/CI 运行结果不同（见证据段），已单独标注，不作为代码问题的反复结论。'
  )
}

/* ─────────────────────────── 报告渲染（固定三段结构） ─────────────────────────── */

/** 渲染单条检查小节（`#### 名称` + 唯一结论 + ≤max 条证据 + 可选提示）。 */
function renderCheckSection({ name, verdict, evidence = [], hint = '' }) {
  const reason = verdict.reason ? `（${verdict.reason}）` : ''
  const lines = [`#### ${name}`, '', `**结论**：${verdict.outcome}${reason}`, '']
  if (verdict.outcome === OUTCOMES.FAIL && evidence.length > 0) {
    lines.push('关键证据：', '', ...evidence, '')
  }
  if (hint) lines.push(`- **提示（非门禁）**：${hint}`, '')
  return lines.join('\n')
}

const NOT_COVERED_PREFIX = '- **未覆盖检查**：'
const isNotCoveredLine = (line) => String(line).startsWith(NOT_COVERED_PREFIX)

/**
 * 从报告正文里解析每条检查的小节（`#### 名称` + `**结论**：…`）并拆出各组成部分。
 * 拆分的意义：收尾时**每条检查的结论必须全部可见**（唯一权威判定），
 * 只有「证据正文」允许被行数预算压缩（见 finishReport 的组装顺序）。
 */
function parseCheckSections(md) {
  const text = stripAnsi(String(md || ''))
  const sections = []
  let current = null
  for (const line of text.split('\n')) {
    const head = /^####\s+(.+?)\s*$/.exec(line)
    if (head) {
      current = {
        name: head[1],
        outcome: OUTCOMES.UNKNOWN,
        detail: '',
        verdictLine: '',
        hintLines: [],
        evidenceLines: [],
      }
      sections.push(current)
      continue
    }
    if (!current) continue
    const verdict = /^\*\*结论\*\*：(.+?)\s*$/.exec(line)
    if (verdict) {
      current.detail = verdict[1].trim()
      current.outcome = normalizeOutcome(current.detail)
      current.verdictLine = line.trim()
      continue
    }
    if (/^- \*\*提示（非门禁）\*\*：/.test(line.trim())) {
      current.hintLines.push(line.trim())
      continue
    }
    if (/^-\s+\S/.test(line.trim()) && !line.includes('完整结果见')) current.evidenceLines.push(line.trim())
  }
  return sections
}

/** 结论文案 → 三态（无法识别一律「未能判定」，**绝不默认通过**）。 */
function normalizeOutcome(detail) {
  const text = stripAnsi(String(detail || '')).trim()
  if (text.includes(OUTCOMES.UNKNOWN)) return OUTCOMES.UNKNOWN
  if (text.startsWith(OUTCOMES.FAIL)) return OUTCOMES.FAIL
  if (text.startsWith(OUTCOMES.PASS)) return OUTCOMES.PASS
  return OUTCOMES.UNKNOWN
}

/**
 * 收尾：把各检查小节合成固定三段结构（## 结论 → ## 关键证据 → ## 建议），并限长。
 *
 * 「未能判定」的两个来源都要显式：① 有检查没跑成；② **一条检查都没执行**（只声明了未覆盖项）。
 * 后者是典型的「静默当通过」（原实现给「通过（N 项未覆盖）」），#311 起必须是「未能判定」。
 */
function finishReport({ md, moduleName = '审查', suggest = '', history = '', maxLines = 30 } = {}) {
  const text = stripAnsi(String(md || ''))
  const sections = parseCheckSections(text)
  const notCovered = text.split('\n').filter(isNotCoveredLine)
  const counts = {
    pass: sections.filter((s) => s.outcome === OUTCOMES.PASS).length,
    fail: sections.filter((s) => s.outcome === OUTCOMES.FAIL).length,
    unknown: sections.filter((s) => s.outcome === OUTCOMES.UNKNOWN).length,
  }
  const flaky = countFlaky(text)
  const overall = aggregateOutcomes(sections.map((s) => s.outcome))

  /**
   * 结论文案（唯一权威判定）。
   *
   * 这里有一处必须区分清楚的边界（真机验证后确定，issue #311）：
   *   - 「**已接入的检查本次没跑成**」（超时/跳过/依赖不可用/统计不出）→ 未能判定，且参与总结论；
   *   - 「**这个 job 结构上就没有自动化检查**」（只声明了未覆盖项，如 API 设计）→ **不是**未能判定：
   *     它是覆盖缺口（未覆盖），报告已显式写明「不代表通过」，换成「未能判定」会让 PR 级结论
   *     永远停在「未能判定」，读者反而无法一眼看出「这个 PR 到底行不行」——那等于用另一种方式
   *     把结论变得不可用（PR #357 首次真机运行的实测结论：outcome=未能判定）。
   *   - 真正危险的「什么都没产出」（job 崩在收尾之前、报告为空）→ 仍判未能判定（见上面的 aggregate）。
   */
  let headline = overall
  if (sections.length === 0 && notCovered.length > 0) {
    headline = `通过（${notCovered.length} 项未覆盖，不参与判定）`
  } else if (overall === OUTCOMES.UNKNOWN) {
    const firstUnknown = sections.find((s) => s.outcome === OUTCOMES.UNKNOWN)
    headline = `未能判定（${
      firstUnknown && firstUnknown.detail
        ? firstUnknown.detail.replace(/^未能判定（?/, '').replace(/）$/, '')
        : '本次未产出任何检查结果（job 可能未跑完，见日志）'
    }）`
  } else if (overall === OUTCOMES.PASS && notCovered.length > 0) {
    headline = `通过（${notCovered.length} 项未覆盖，不参与判定）`
  }

  // 组装顺序 = 重要性顺序：**每条检查的结论**（唯一权威判定，必须全部可见）
  // → 未覆盖说明 → 「不通过」项的证据（预算不够时优先牺牲它，并显式说明已截断）
  const verdicts = sections.map((s) => [
    `#### ${s.name}`,
    '',
    s.verdictLine || `**结论**：${OUTCOMES.UNKNOWN}`,
    ...s.hintLines,
  ])
  const optional = []
  if (notCovered.length > 0) {
    optional.push([
      `## 未覆盖检查（${notCovered.length} 项）`,
      '',
      sections.length === 0
        ? '- ⚠️ 本 job **未执行任何自动化检查**（以下为覆盖缺口）：不代表通过，也不阻塞合并；需接入自动化才能覆盖。'
        : '- 以下检查没接入自动化：不代表通过，也不阻塞合并。',
      ...notCovered.slice(0, 5),
      ...(notCovered.length > 5 ? [`- _（另有 ${notCovered.length - 5} 项，完整见 artifact）_`] : []),
    ])
  }
  for (const s of sections.filter((x) => x.evidenceLines.length > 0)) {
    optional.push([`#### ${s.name}`, '', '关键证据：', '', ...s.evidenceLines])
  }

  const head = [
    '## 结论',
    '',
    headline,
    '',
    `统计：通过 ${counts.pass} 项 / 不通过 ${counts.fail} 项 / 未能判定 ${counts.unknown} 项 / 未覆盖 ${notCovered.length} 项`,
    '',
    '边界：未覆盖=没接入自动化（不代表通过，也不阻塞合并）；未能判定=已接入但本次没跑成（**不等于通过**）。',
  ]
  if (flaky > 0) head.push('', `提示：同一 commit 观测到疑似环境抖动 ×${flaky}（已与代码问题分开表述）。`)
  if (sections.length === 0 && notCovered.length > 0) {
    head.push('', `提示：本 job 未执行任何自动化检查（${notCovered.length} 项未覆盖）——不代表通过，也不阻塞合并。`)
  }
  if (history) head.push('', `历史：${history}`)
  head.push('', `## 关键证据（模块：${moduleName}）`)
  const tail = [
    '## 建议',
    '',
    suggest || '- 先处理「不通过」与「未能判定」项；完整明细见本次运行 artifact 与 CI 日志。',
  ]
  const essential = verdicts.length > 0 ? verdicts.flat() : ['_（本 job 未执行自动化检查，详见下方「未覆盖检查」）_']
  return fitReport(head, essential, optional, tail, maxLines, '完整结果见本次运行的 artifact 与 CI 日志')
}

/* ─────────────────────────── CLI（shell 的唯一判定入口） ─────────────────────────── */

/** 解析 `--key value` 形式的参数。 */
function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      opts[key] = true
    } else {
      opts[key] = next
      i += 1
    }
  }
  return opts
}

function readInput(file) {
  try {
    return file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

/**
 * 读取 CI（默认 ci.yml）在该 commit 上的运行结果。
 * 用 `gh run list --commit <sha>` 精确取该 commit 的 run——`gh` 由 runner 预装，凭据走 GITHUB_TOKEN。
 */
function fetchCiRuns({ workflow = 'ci.yml', sha } = {}) {
  const res = spawnSync(
    'gh',
    [
      'run',
      'list',
      '--workflow',
      workflow,
      '--commit',
      sha,
      '--limit',
      '50',
      '--json',
      'status,conclusion,event,headSha,attempt,databaseId',
    ],
    { encoding: 'utf8', timeout: 60_000 },
  )
  if (res.error || res.status !== 0) return { status: res.status ?? 1, runs: [] }
  try {
    const runs = JSON.parse(res.stdout)
    return { status: 0, runs: Array.isArray(runs) ? runs : [] }
  } catch {
    return { status: 1, runs: [] }
  }
}

function appendTo(file, text) {
  const prev = (() => {
    try {
      return fs.readFileSync(file, 'utf8')
    } catch {
      return ''
    }
  })()
  fs.writeFileSync(file, `${prev}${text}`)
}

function runCli(argv) {
  const [command, ...rest] = argv
  const opts = parseArgs(rest)
  const report = opts.report
  if (!report) throw new Error('缺少 --report')

  if (command === 'check' || command === 'scope') {
    const raw = readInput(opts.output)
    const lineCount =
      opts.lines !== undefined ? Number(opts.lines) : raw.split('\n').filter((l) => l.trim() !== '').length
    const timeoutSeconds = Number(opts.timeout || 600)
    let matched
    let total
    const hasExplicitCounts = opts.matched !== undefined || opts.total !== undefined
    if (hasExplicitCounts) {
      // 门禁口径计数由 summarize-tool-output 算好后传入；空串 = 统计失败（不是「0 处」）
      matched = opts.matched === '' || opts.matched === true ? undefined : Number(opts.matched)
      total = opts.total === '' || opts.total === true ? undefined : Number(opts.total)
    } else if (command === 'scope' || opts.counts) {
      const pathFilter = resolvePathFilter(opts['path-filter'] || 'all')
      const counts = countIssues(opts.kind || 'generic', raw, pathFilter)
      matched = counts.matched
      total = counts.total
    }
    const verdict =
      command === 'scope' && matched === undefined
        ? { outcome: OUTCOMES.UNKNOWN, reason: '无法统计检查结果（摘要工具未给出计数）' }
        : classifyCheck({
            status: Number(opts.status || 0),
            lineCount,
            matched,
            total,
            output: raw,
            timeoutSeconds,
          })
    const evidence =
      verdict.outcome === OUTCOMES.FAIL
        ? summarizeToolOutput(opts.kind || 'generic', raw, { max: Number(opts.max || 3) }).split('\n')
        : []
    const hint = opts['hint'] || ''
    return appendTo(report, `${renderCheckSection({ name: opts.name || '未命名检查', verdict, evidence, hint })}\n`)
  }

  if (command === 'ci-runs') {
    const fetchStatus = Number(opts['fetch-status'] || 0)
    let result
    if (fetchStatus !== 0) {
      result = {
        outcome: OUTCOMES.UNKNOWN,
        reason: `无法读取 CI 权威结果（gh 退出码 ${fetchStatus}：权限或网络问题）`,
        flaky: 0,
      }
    } else if (typeof opts.wait === 'string') {
      // 真实路径：等 CI 在该 commit 上给出结果（有界等待），而不是自己再跑一遍测试
      result = waitForCiResult({
        fetchRuns: ({ workflow, sha }) => fetchCiRuns({ workflow, sha }),
        workflow: opts.workflow,
        sha: opts.sha,
        waitSeconds: Number(opts.wait),
        pollSeconds: Number(opts.poll || 30),
      })
    } else {
      let runs = []
      try {
        const parsed = JSON.parse(readInput(opts.runs))
        runs = Array.isArray(parsed) ? parsed : []
      } catch {
        runs = []
      }
      result = classifyCiRuns(runs, { workflow: opts.workflow, sha: opts.sha })
    }
    const verdict = { outcome: result.outcome, reason: result.reason }
    const hint =
      result.flaky > 0
        ? `疑似环境抖动 ×${result.flaky}：同一 commit 的 CI 另有失败/中断运行，按环境抖动标注，不作为代码问题。`
        : ''
    return appendTo(
      report,
      `${renderCheckSection({ name: opts.name || 'CI 权威结果', verdict, hint })}${
        result.flaky > 0 ? `${flakyMarker(result.flaky)}\n` : ''
      }\n`,
    )
  }

  if (command === 'notcovered') {
    return appendTo(report, `${NOT_COVERED_PREFIX}${opts.name} — ${opts.reason}（需接入自动化才能覆盖）\n`)
  }

  if (command === 'unknown') {
    return appendTo(
      report,
      `${renderCheckSection({
        name: opts.name || '未命名检查',
        verdict: { outcome: OUTCOMES.UNKNOWN, reason: opts.reason || '未执行' },
      })}\n`,
    )
  }

  if (command === 'finish') {
    const out = finishReport({
      md: readInput(report),
      moduleName: opts.module,
      suggest: typeof opts.suggest === 'string' ? opts.suggest : '',
      history: typeof opts.history === 'string' ? opts.history : '',
      maxLines: Number(opts['max-lines'] || process.env.REVIEW_MAX_LINES || 30),
    })
    fs.writeFileSync(report, out)
    return undefined
  }

  throw new Error(`未知子命令：${command}`)
}

module.exports = {
  flakyMarker,
  FLAKY_RE,
  shortSha,
  exitReason,
  INFRA_PATTERNS,
  detectInfrastructureFailure,
  classifyCheck,
  aggregateOutcomes,
  historyOutcome,
  classifyCiRuns,
  waitForCiResult,
  fetchCiRuns,
  parseHistory,
  renderHistoryLine,
  mergeHistoryEntry,
  findSameShaEntry,
  explainConsistency,
  renderCheckSection,
  parseCheckSections,
  normalizeOutcome,
  finishReport,
  NOT_COVERED_PREFIX,
}

/* istanbul ignore next -- CLI 入口，逻辑已由上面的纯函数与单测覆盖 */
if (require.main === module) {
  try {
    runCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`review-verdict: ${error.message}\n`)
    process.exit(2)
  }
}
