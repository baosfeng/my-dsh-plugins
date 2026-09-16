'use strict'

/**
 * .github/scripts/review-verdict.cjs 的离线单测（issue #311）。
 * 跑法：`node --test .github/scripts/`
 *
 * 覆盖「通过 / 不通过 / 未能判定」三分支与全部「没能真正跑」的形态
 * （超时、命令缺失、被信号中断、无输出、统计不出、工具/依赖不可用、一条检查都没执行），
 * 以及「同一 commit 结论一致性 + 抖动只标注不翻转」。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const verdict = require('./review-verdict.cjs')
const { OUTCOMES, parseReport, buildConsolidated } = require('./review-comment.cjs')

const {
  classifyCheck,
  aggregateOutcomes,
  historyOutcome,
  classifyCiRuns,
  waitForCiResult,
  parseHistory,
  renderHistoryLine,
  mergeHistoryEntry,
  findSameShaEntry,
  explainConsistency,
  renderCheckSection,
  parseCheckSections,
  normalizeOutcome,
  finishReport,
  shortSha,
  flakyMarker,
} = verdict

const CLI = path.join(__dirname, 'review-verdict.cjs')

/** 在临时目录里跑 CLI，返回 stdout/stderr/退出码。 */
function runCli(args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-verdict-'))
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout: out }
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

test('classifyCheck：exit 0 = 通过（无论有无输出）', () => {
  assert.deepEqual(classifyCheck({ status: 0, lineCount: 0 }), { outcome: OUTCOMES.PASS, reason: '' })
  assert.equal(classifyCheck({ status: 0, lineCount: 12 }).outcome, OUTCOMES.PASS)
})

test('classifyCheck：exit 1 且有输出 = 不通过（真实代码问题）', () => {
  const v = classifyCheck({ status: 1, lineCount: 3, output: 'plugins/a/src/x.ts:12 complexity 17' })
  assert.equal(v.outcome, OUTCOMES.FAIL)
})

test('classifyCheck：未能判定 —— 超时 / 命令不可用 / 被信号中断', () => {
  const timeout = classifyCheck({ status: 124, lineCount: 5, timeoutSeconds: 600 })
  assert.equal(timeout.outcome, OUTCOMES.UNKNOWN)
  assert.match(timeout.reason, /超时（超过 600s 未完成）/)

  assert.equal(classifyCheck({ status: 127, lineCount: 1 }).outcome, OUTCOMES.UNKNOWN)
  assert.match(classifyCheck({ status: 126, lineCount: 1 }).reason, /依赖未安装/)
  assert.match(classifyCheck({ status: 137, lineCount: 1 }).reason, /信号 9/)
})

test('classifyCheck：未能判定 —— 命令无输出（无法确认是否真的跑了）', () => {
  const v = classifyCheck({ status: 1, lineCount: 0, output: '' })
  assert.equal(v.outcome, OUTCOMES.UNKNOWN)
  assert.match(v.reason, /无输出/)
})

test('classifyCheck：未能判定 —— 依赖/网络不可用不等于「代码不通过」', () => {
  const audit = classifyCheck({
    status: 1,
    lineCount: 2,
    output: 'npm error audit endpoint returned an error',
  })
  assert.equal(audit.outcome, OUTCOMES.UNKNOWN)
  assert.match(audit.reason, /审计服务不可用/)

  const missing = classifyCheck({ status: 1, lineCount: 4, output: "Error: Cannot find module 'eslint'" })
  assert.equal(missing.outcome, OUTCOMES.UNKNOWN)
  assert.match(missing.reason, /依赖缺失/)

  const net = classifyCheck({
    status: 1,
    lineCount: 2,
    output: 'request failed: getaddrinfo ENOTFOUND registry.npmjs.org',
  })
  assert.equal(net.outcome, OUTCOMES.UNKNOWN)
  assert.match(net.reason, /网络不可用/)
})

test('classifyCheck（门禁口径）：0 处超标才是通过；全量有问题不算通过也不算不通过', () => {
  const scopedPass = classifyCheck({ status: 1, lineCount: 9, matched: 0, total: 4 })
  assert.equal(scopedPass.outcome, OUTCOMES.PASS)
  assert.match(scopedPass.reason, /门禁口径 0 处超标/)

  const scopedFail = classifyCheck({ status: 1, lineCount: 9, matched: 2, total: 4 })
  assert.equal(scopedFail.outcome, OUTCOMES.FAIL)

  // 反例：命令异常退出、统计不出任何问题 —— 绝不能因为「过滤后是 0」就写成通过
  const silent = classifyCheck({ status: 1, lineCount: 9, matched: 0, total: 0 })
  assert.equal(silent.outcome, OUTCOMES.UNKNOWN)
  assert.match(silent.reason, /未能统计出任何问题/)
})

test('aggregateOutcomes：不通过 > 未能判定 > 通过；空集 = 未能判定（没跑绝不当通过）', () => {
  assert.equal(aggregateOutcomes([OUTCOMES.PASS, OUTCOMES.PASS]), OUTCOMES.PASS)
  assert.equal(aggregateOutcomes([OUTCOMES.PASS, OUTCOMES.UNKNOWN]), OUTCOMES.UNKNOWN)
  assert.equal(aggregateOutcomes([OUTCOMES.UNKNOWN, OUTCOMES.FAIL, OUTCOMES.PASS]), OUTCOMES.FAIL)
  assert.equal(aggregateOutcomes([]), OUTCOMES.UNKNOWN)
})

test('normalizeOutcome：认三态；无法识别一律未能判定（绝不默认通过）', () => {
  assert.equal(normalizeOutcome('通过（1 项未覆盖，不参与判定）'), OUTCOMES.PASS)
  assert.equal(normalizeOutcome('不通过'), OUTCOMES.FAIL)
  assert.equal(normalizeOutcome('未能判定（超时）'), OUTCOMES.UNKNOWN)
  assert.equal(normalizeOutcome('一切正常'), OUTCOMES.UNKNOWN)
  assert.equal(normalizeOutcome(''), OUTCOMES.UNKNOWN)
})

test('classifyCiRuns：全部成功 = 通过；全部失败 = 不通过', () => {
  const pass = classifyCiRuns([{ status: 'completed', conclusion: 'success' }], {
    workflow: 'ci.yml',
    sha: 'abc1234def',
  })
  assert.equal(pass.outcome, OUTCOMES.PASS)
  assert.equal(pass.flaky, 0)

  const fail = classifyCiRuns(
    [
      { status: 'completed', conclusion: 'failure' },
      { status: 'completed', conclusion: 'failure', attempt: 2 },
    ],
    { workflow: 'ci.yml', sha: 'abc1234def' },
  )
  assert.equal(fail.outcome, OUTCOMES.FAIL)
})

test('classifyCiRuns：同一 commit 既有成功又有超时 → 通过 + 疑似抖动（不翻转结论）', () => {
  const runs = [
    { status: 'completed', conclusion: 'timed_out', attempt: 1 },
    { status: 'completed', conclusion: 'success', attempt: 2 },
  ]
  const v = classifyCiRuns(runs, { workflow: 'ci.yml', sha: 'abc1234def' })
  assert.equal(v.outcome, OUTCOMES.PASS)
  assert.equal(v.flaky, 1)
  assert.match(v.reason, /疑似环境抖动/)
})

test('classifyCiRuns：没有成功运行且只有中断/取消 → 未能判定（不是不通过，更不是通过）', () => {
  const timedOut = classifyCiRuns([{ status: 'completed', conclusion: 'timed_out' }], { sha: 'abc1234' })
  assert.equal(timedOut.outcome, OUTCOMES.UNKNOWN)
  assert.match(timedOut.reason, /无法判定/)

  const cancelled = classifyCiRuns([{ status: 'completed', conclusion: 'cancelled' }], { sha: 'abc1234' })
  assert.equal(cancelled.outcome, OUTCOMES.UNKNOWN)
})

test('classifyCiRuns：没有运行结果 / 仍在运行 / 全部跳过 → 未能判定', () => {
  assert.equal(classifyCiRuns([], { sha: 'abc1234' }).outcome, OUTCOMES.UNKNOWN)
  assert.match(
    classifyCiRuns([], { workflow: 'ci.yml', sha: 'abc1234' }).reason,
    /尚未在 commit abc1234 上产生运行结果/,
  )
  const running = classifyCiRuns([{ status: 'in_progress' }], { sha: 'abc1234' })
  assert.equal(running.outcome, OUTCOMES.UNKNOWN)
  assert.match(running.reason, /仍在运行/)
  const skipped = classifyCiRuns([{ status: 'completed', conclusion: 'skipped' }], { sha: 'abc1234' })
  assert.equal(skipped.outcome, OUTCOMES.UNKNOWN)
  assert.match(skipped.reason, /均被跳过/)
})

test('classifyCiRuns：纯函数 —— 同一 commit 的同一输入永远同一结论（可复现）', () => {
  const runs = [
    { status: 'completed', conclusion: 'success' },
    { status: 'completed', conclusion: 'timed_out' },
  ]
  const a = classifyCiRuns(runs, { workflow: 'ci.yml', sha: 'deadbeefcafe' })
  const b = classifyCiRuns(structuredClone(runs), { workflow: 'ci.yml', sha: 'deadbeefcafe' })
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

test('waitForCiResult：有界等待 CI 结果；等到了就按权威结果判定（不自己再跑一遍测试）', () => {
  let calls = 0
  const sleeps = []
  const fetchRuns = () => {
    calls += 1
    // 第一次：CI 还在跑；第二次：成功
    return calls === 1
      ? { status: 0, runs: [{ status: 'in_progress' }] }
      : { status: 0, runs: [{ status: 'completed', conclusion: 'success' }] }
  }
  const v = waitForCiResult({
    fetchRuns,
    sha: 'abc1234',
    workflow: 'ci.yml',
    waitSeconds: 60,
    pollSeconds: 5,
    sleep: (ms) => sleeps.push(ms),
    now: () => 0,
  })
  assert.equal(v.outcome, OUTCOMES.PASS)
  assert.equal(calls, 2)
  assert.deepEqual(sleeps, [5000])
})

test('waitForCiResult：CI 一直没结果 → 等满预算后「未能判定」（绝不猜成通过）', () => {
  let clock = 0
  const fetchRuns = () => ({ status: 0, runs: [] })
  const v = waitForCiResult({
    fetchRuns,
    sha: 'abc1234',
    workflow: 'ci.yml',
    waitSeconds: 60,
    pollSeconds: 30,
    sleep: (ms) => {
      clock += ms
    },
    now: () => clock,
  })
  assert.equal(v.outcome, OUTCOMES.UNKNOWN)
  assert.match(v.reason, /尚未在 commit abc1234 上产生运行结果/)
  assert.equal(clock >= 60_000, true, `等待应受预算约束（实际 ${clock}ms）`)
})

test('waitForCiResult：gh 读取失败 → 未能判定（不伪造结果）', () => {
  const v = waitForCiResult({ fetchRuns: () => ({ status: 1, runs: [] }), sha: 'abc1234', waitSeconds: 0 })
  assert.equal(v.outcome, OUTCOMES.UNKNOWN)
  assert.match(v.reason, /无法读取 CI 权威结果/)
})

test('历史摘要：sha 可追溯、中文计数、抖动单列（#311 示例格式）', () => {
  assert.equal(renderHistoryLine([]), '')
  assert.equal(
    renderHistoryLine([
      { sha: 'aaa1111', outcome: OUTCOMES.PASS },
      { sha: 'aaa1111', outcome: OUTCOMES.FLAKY },
      { sha: 'bbb2222', outcome: OUTCOMES.PASS },
    ]),
    '检查 3 次：通过 ×2、疑似抖动 ×1',
  )
  // 旧格式（#303 的裸结论）仍能解析，避免升级后历史断档
  assert.deepEqual(parseHistory('<!-- dsh-review-history: 通过,不通过 -->'), [
    { sha: '', outcome: OUTCOMES.PASS },
    { sha: '', outcome: OUTCOMES.FAIL },
  ])
})

test('mergeHistoryEntry：本轮结论追加到历史并写回隐藏注释', () => {
  const first = mergeHistoryEntry('', { sha: 'abc1234deadbeef', outcome: OUTCOMES.PASS })
  assert.equal(first.historyLine, '检查 1 次：通过 ×1')
  assert.equal(first.historyComment, '<!-- dsh-review-history: abc1234:通过 -->')

  const second = mergeHistoryEntry(first.historyComment, { sha: 'abc1234deadbeef', outcome: OUTCOMES.FLAKY })
  assert.equal(second.historyLine, '检查 2 次：通过 ×1、疑似抖动 ×1')
  assert.deepEqual(parseHistory(second.historyComment), [
    { sha: 'abc1234', outcome: OUTCOMES.PASS },
    { sha: 'abc1234', outcome: OUTCOMES.FLAKY },
  ])
})

test('historyOutcome：判定通过但观测到抖动 → 历史记「疑似抖动」（结论仍是三态之一）', () => {
  assert.equal(historyOutcome(OUTCOMES.PASS, 1), OUTCOMES.FLAKY)
  assert.equal(historyOutcome(OUTCOMES.PASS, 0), OUTCOMES.PASS)
  assert.equal(historyOutcome(OUTCOMES.FAIL, 3), OUTCOMES.FAIL)
  assert.equal(historyOutcome(OUTCOMES.UNKNOWN, 2), OUTCOMES.UNKNOWN)
})

test('explainConsistency：同一 commit 结论变了要解释原因；不同 commit 不解释', () => {
  const entries = [{ sha: 'aaa1111', outcome: OUTCOMES.PASS }]
  const note = explainConsistency(entries, 'aaa1111deadbeef', OUTCOMES.UNKNOWN)
  assert.match(note, /同一 commit `aaa1111` 的上一次结论为「通过」，本次为「未能判定」/)
  assert.equal(explainConsistency(entries, 'aaa1111deadbeef', OUTCOMES.PASS), '')
  assert.equal(explainConsistency(entries, 'bbb2222', OUTCOMES.UNKNOWN), '')
  assert.equal(explainConsistency([], 'aaa1111', OUTCOMES.UNKNOWN), '')
  assert.deepEqual(findSameShaEntry(entries, 'aaa1111ffff'), { sha: 'aaa1111', outcome: OUTCOMES.PASS })
})

test('renderCheckSection：固定结构，未判定/通过不贴证据，不通过才给证据', () => {
  const unknown = renderCheckSection({
    name: 'ESLint 静态检查',
    verdict: { outcome: OUTCOMES.UNKNOWN, reason: '超时（超过 600s 未完成）' },
    evidence: ['- 不应出现'],
  })
  assert.match(unknown, /^#### ESLint 静态检查\n\n\*\*结论\*\*：未能判定（超时（超过 600s 未完成））/)
  assert.equal(unknown.includes('不应出现'), false)

  const fail = renderCheckSection({
    name: 'ESLint 静态检查',
    verdict: { outcome: OUTCOMES.FAIL, reason: '' },
    evidence: ['- `plugins/a/src/x.ts:12` — 圈复杂度超标（complexity）：实测 17，阈值 10'],
  })
  assert.match(fail, /\*\*结论\*\*：不通过\n/)
  assert.match(fail, /关键证据：\n\n- `plugins\/a\/src\/x\.ts:12`/)
})

test('finishReport：三段结构、唯一定论、全中文、≤30 行、无 ANSI', () => {
  const md = [
    '#### ESLint 静态检查',
    '',
    '**结论**：通过',
    '',
    '#### 类型检查',
    '',
    '**结论**：不通过',
    '',
    '关键证据：',
    '',
    '- `plugins/a/src/x.ts:3` — 类型错误（TS2322）',
    '',
  ].join('\n')
  const out = finishReport({ md, moduleName: '代码质量', suggest: '- 修类型错误。' })
  assert.ok(out.startsWith('## 结论\n\n不通过\n'), out)
  assert.match(out, /统计：通过 1 项 \/ 不通过 1 项 \/ 未能判定 0 项 \/ 未覆盖 0 项/)
  assert.match(out, /## 关键证据（模块：代码质量）/)
  assert.match(out, /## 建议\n\n- 修类型错误。/)
  assert.equal(out.includes('\u001b'), false)
  assert.ok(out.split('\n').length <= 30, `行数 ${out.split('\n').length}`)
})

test('finishReport：结构化覆盖缺口（只有未覆盖项、无自动化检查）→ 通过但必须显式标注', () => {
  // 边界（真机验证后确定，PR #357 首次运行 outcome=未能判定）：把「这个 job 本来就没有自动化」
  // 判成「未能判定」会让 PR 级结论永远停在未能判定，读者反而看不出 PR 到底行不行；
  // 它是**覆盖缺口**（报告里显式写明不代表通过），不是「已接入但没跑成」。
  const md = '- **未覆盖检查**：公开 API 兼容性 — 尚未接入自动化检查（需接入自动化才能覆盖）\n'
  const out = finishReport({ md, moduleName: 'API 设计', suggest: '- 人工确认。' })
  assert.ok(out.startsWith('## 结论\n\n通过（1 项未覆盖，不参与判定）'), out)
  assert.match(out, /提示：本 job 未执行任何自动化检查（1 项未覆盖）——不代表通过，也不阻塞合并。/)
  assert.match(out, /## 未覆盖检查（1 项）/)
  assert.match(out, /不代表通过，也不阻塞合并/)
})

test('finishReport：报告里什么都没有（job 崩在收尾前）→ 未能判定，绝不写成通过', () => {
  const out = finishReport({ md: '', moduleName: '代码质量' })
  assert.ok(out.startsWith('## 结论\n\n未能判定'), out)
  assert.match(out, /本次未产出任何检查结果/)
  assert.equal(out.includes('## 结论\n\n通过'), false)
})

test('finishReport：有通过也有未覆盖 → 通过 + 明确标注未覆盖不参与判定', () => {
  const md = ['#### 文档一致性', '', '**结论**：通过', '', '- **未覆盖检查**：公开 API 兼容性 — 无自动化', ''].join(
    '\n',
  )
  const out = finishReport({ md, moduleName: '文档' })
  assert.ok(out.startsWith('## 结论\n\n通过（1 项未覆盖，不参与判定）'), out)
  assert.match(out, /## 未覆盖检查（1 项）/)
})

test('finishReport：超时/中断混在一起时总结论为未能判定；抖动只进提示不改结论', () => {
  const md = [
    '#### 测试与覆盖率（CI 权威结果）',
    '',
    '**结论**：通过（同一 commit 另有 1 次失败/中断运行，已标注为疑似环境抖动）',
    '',
    '- **提示（非门禁）**：疑似环境抖动 ×1：同一 commit 的 CI 另有失败/中断运行，按环境抖动标注。',
    '',
    flakyMarker(1),
    '',
    '#### 文档一致性',
    '',
    '**结论**：未能判定（网络不可用）',
    '',
  ].join('\n')
  const out = finishReport({ md, moduleName: '测试' })
  assert.ok(out.startsWith('## 结论\n\n未能判定'), out)
  assert.match(out, /提示：同一 commit 观测到疑似环境抖动 ×1/)
})

test('CLI：注入超时（exit 124）→ 报告写「未能判定（超时）」，且不出现「通过」', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-cli-'))
  const report = path.join(dir, 'report.md')
  const output = path.join(dir, 'tool.txt')
  fs.writeFileSync(output, '部分输出后就超时了\n')
  const res = runCli([
    'check',
    '--report',
    report,
    '--name',
    '注入超时',
    '--kind',
    'generic',
    '--status',
    '124',
    '--output',
    output,
    '--timeout',
    '1',
  ])
  assert.equal(res.status, 0, res.stderr)
  const section = fs.readFileSync(report, 'utf8')
  assert.match(section, /\*\*结论\*\*：未能判定（超时（超过 1s 未完成））/)
  assert.equal(section.includes('**结论**：通过'), false)
})

test('CLI + finish（端到端）：未能判定贯穿到总结论，且仍保持三段结构', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-cli-e2e-'))
  const report = path.join(dir, 'report.md')
  const output = path.join(dir, 'tool.txt')
  fs.writeFileSync(output, 'Error: Cannot find module "eslint"\n')
  runCli([
    'check',
    '--report',
    report,
    '--name',
    'ESLint 静态检查',
    '--kind',
    'generic',
    '--status',
    '1',
    '--output',
    output,
  ])
  const res = runCli(['finish', '--report', report, '--module', '代码质量', '--suggest', '- 先修依赖安装。'])
  assert.equal(res.status, 0, res.stderr)
  const final = fs.readFileSync(report, 'utf8')
  assert.ok(final.startsWith('## 结论\n\n未能判定'), final)
  assert.match(final, /依赖缺失/)
  assert.match(final, /## 关键证据（模块：代码质量）/)
  assert.match(final, /## 建议\n\n- 先修依赖安装。/)
})

test('CLI：ci-runs 读不到 CI 结果（gh 失败）→ 未能判定', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-cli-ci-'))
  const report = path.join(dir, 'report.md')
  const res = runCli([
    'ci-runs',
    '--report',
    report,
    '--name',
    '测试与覆盖率',
    '--workflow',
    'ci.yml',
    '--sha',
    'abc1234def',
    '--fetch-status',
    '1',
    '--runs',
    '/dev/null',
  ])
  assert.equal(res.status, 0, res.stderr)
  assert.match(fs.readFileSync(report, 'utf8'), /\*\*结论\*\*：未能判定（无法读取 CI 权威结果/)
})

test('验收场景：同一 commit 两次检查结论一致；人为注入一次超时 → 只标注不翻转', () => {
  const sha = 'cafebabe1234567890'
  const clean = [{ status: 'completed', conclusion: 'success' }]
  const injected = [...clean, { status: 'completed', conclusion: 'timed_out' }]

  const first = classifyCiRuns(clean, { workflow: 'ci.yml', sha })
  const second = classifyCiRuns(injected, { workflow: 'ci.yml', sha })
  assert.equal(first.outcome, second.outcome, '注入抖动不得改变结论')
  assert.equal(second.outcome, OUTCOMES.PASS)
  assert.equal(second.flaky, 1)

  const history1 = mergeHistoryEntry('', { sha, outcome: historyOutcome(first.outcome, first.flaky) })
  const history2 = mergeHistoryEntry(history1.historyComment, {
    sha,
    outcome: historyOutcome(second.outcome, second.flaky),
  })
  assert.equal(history2.historyLine, '检查 2 次：通过 ×1、疑似抖动 ×1')
  // 结论没变（通过 → 通过），但历史把抖动记了下来：差异可解释，不是「这次说没问题、下次说不行」
  assert.equal(historyOutcome(first.outcome, first.flaky), OUTCOMES.PASS)
  assert.equal(historyOutcome(second.outcome, second.flaky), OUTCOMES.FLAKY)
})

test('汇总评论：sha 可追溯 + 抖动提示 + 同一 commit 翻转解释（不改写结论）', () => {
  const sections = [
    { name: '代码质量', md: '## 结论\n\n通过\n' },
    { name: '测试', md: '## 结论\n\n通过\n\n- **提示（非门禁）**：疑似环境抖动 ×1\n\n' + flakyMarker(1) },
  ]
  const draft = buildConsolidated(sections, { maxLines: 30 })
  assert.ok(draft.startsWith('## 结论\n\n通过'), draft)
  assert.equal(parseReport(draft).conclusion, OUTCOMES.PASS)
  assert.equal(parseReport(draft).flaky, 1)

  const withMeta = buildConsolidated(sections, {
    maxLines: 30,
    historyLine: '检查 2 次：通过 ×1、疑似抖动 ×1',
    sha: shortSha('deadbeefcafe'),
    notes: ['同一 commit `deadbee` 的上一次结论为「未能判定」，本次为「通过」。'],
  })
  assert.match(withMeta, /历史：检查 2 次：通过 ×1、疑似抖动 ×1（本次判定对象 commit deadbee）/)
  assert.match(withMeta, /⚠️ 提示：同一 commit 观测到疑似环境抖动 ×1/)
  assert.match(withMeta, /⚠️ 同一 commit `deadbee` 的上一次结论/)
  assert.ok(withMeta.split('\n').length <= 30, `行数 ${withMeta.split('\n').length}`)
  assert.equal(withMeta.includes('\u001b'), false)
})

test('parseCheckSections：从报告里还原每条检查的结论', () => {
  const md = [
    '#### A',
    '',
    '**结论**：通过',
    '',
    '#### B',
    '',
    '**结论**：未能判定（超时（超过 600s 未完成））',
    '',
  ].join('\n')
  assert.deepEqual(
    parseCheckSections(md).map((s) => [s.name, s.outcome]),
    [
      ['A', OUTCOMES.PASS],
      ['B', OUTCOMES.UNKNOWN],
    ],
  )
})

test('finishReport：正文超长被截断时，三段结构仍然齐全（## 建议 不得被吃掉）', () => {
  // 反例来源：本地实测 —— 原先「先拼好再整体截断」，一份 4 条检查的报告把 ## 建议 整段截掉
  const md = []
  for (let i = 0; i < 12; i += 1) {
    md.push(`#### 检查 ${i}`, '', '**结论**：不通过', '', '关键证据：', '', `- \`plugins/a/src/f${i}.ts:1\` — 问题`, '')
  }
  const out = finishReport({ md: md.join('\n'), moduleName: '代码质量', suggest: '- 先修这些。', maxLines: 30 })
  assert.ok(out.split('\n').length <= 30, `行数 ${out.split('\n').length}`)
  assert.match(out, /## 结论\n\n不通过/)
  assert.match(out, /## 关键证据（模块：代码质量）/)
  assert.match(out, /## 建议\n\n- 先修这些。/)
  assert.match(out, /内容超长已截断/)
})

test('buildConsolidated：超长时建议段与历史标记必须存活（不能截掉下一轮要读的历史）', () => {
  const longEvidence = (n) =>
    `## 结论\n\n不通过\n\n## 关键证据\n\n${Array.from({ length: n }, (_, i) => `- \`f${i}.ts:1\` — 问题`).join('\n')}\n`
  const sections = Array.from({ length: 7 }, (_, i) => ({ name: `检查${i}`, md: longEvidence(4) }))
  const historyComment = '<!-- dsh-review-history: abc1234:不通过 -->'
  const out = buildConsolidated(sections, {
    maxLines: 30,
    historyLine: '检查 1 次：不通过 ×1',
    historyComment,
    sha: 'abc1234',
  })
  assert.ok(out.split('\n').length <= 30, `行数 ${out.split('\n').length}`)
  assert.ok(out.startsWith(`${historyComment}\n## 结论\n\n不通过`), out.slice(0, 80))
  assert.match(out, /## 建议\n\n- 先处理「不通过」与「未能判定」项/)
})
