/**
 * Review tests: diff parsing, rule engine hits/misses, POST /review
 * end-to-end on a real repo, and AI-augmentation paths (success / failure
 * / unavailable / unparseable / disabled).
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDiff, isTestFile, isSourceFile } from '../lib/diff.js'
import { reviewRules, LARGE_DIFF_LINES } from '../lib/review.js'
import { bootPlugin, mockRequest, mockResponse, invoke, jsonOf } from './lib/helpers.mjs'

const tmpDirs = []
const disposeAlls = []
afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 40))

function createRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obs-review-'))
  tmpDirs.push(dir)
  mkdirSync(join(dir, 'src'), { recursive: true })
  git(dir, 'init')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test Runner')
  return dir
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function diffText(changes) {
  return [
    'diff --git a/src/a.js b/src/a.js',
    'index 1111111..2222222 100644',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -1,3 +1,4 @@',
    ' const x = 1',
    ' const y = 2',
    `+${changes}`,
  ].join('\n')
}

function boot(config, opts) {
  const handle = bootPlugin(config, opts)
  disposeAlls.push(handle.disposeAll)
  return handle
}

async function postReview(api, body) {
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/observability/api/review', method: 'POST', body: JSON.stringify(body) }), res)
  return { status: res.writeHeadStatus, value: jsonOf(res) }
}

// ── parseDiff ──────────────────────────────────────────────────────────────

test('parseDiff extracts per-file hunks with line numbers', () => {
  const parsed = parseDiff(
    [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -1,2 +10,3 @@',
      ' context',
      '+added line',
      '-removed line',
      '+another',
      '',
      'diff --git a/b.txt b/b.txt',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1 +1 @@',
      '+only',
    ].join('\n'),
  )
  assert.equal(parsed.files.length, 2)
  assert.equal(parsed.files[0].path, 'src/a.js')
  assert.equal(parsed.files[0].insertions, 2)
  assert.equal(parsed.files[0].deletions, 1)
  assert.deepEqual(parsed.files[0].addedLines, [
    { line: 11, text: 'added line' },
    { line: 12, text: 'another' },
  ])
  assert.equal(parsed.files[1].path, 'b.txt')
  assert.equal(parsed.files[1].addedLines[0].line, 1)
  assert.equal(parsed.binary, false)
})

test('parseDiff flags binary files and empty input', () => {
  const parsed = parseDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n')
  assert.equal(parsed.binary, true)
  assert.equal(parsed.files[0].binary, true)
  assert.deepEqual(parseDiff(''), { files: [], binary: false })
})

test('isTestFile / isSourceFile classify paths', () => {
  assert.equal(isTestFile('src/a.test.js'), true)
  assert.equal(isTestFile('test/a.mjs'), true)
  assert.equal(isTestFile('src/a.js'), false)
  assert.equal(isSourceFile('src/a.js'), true)
  assert.equal(isSourceFile('test/a.mjs'), false)
  assert.equal(isSourceFile('README.md'), false)
})

// ── rule engine ────────────────────────────────────────────────────────────

test('rules flag debug statements, secrets, conflicts, todos, trailing space', () => {
  const cases = [
    ['console.log("x")', 'debug-statement'],
    ['debugger', 'debug-statement'],
    ['  print("hi")', 'debug-statement'],
    ['const api_key = "abc12345"', 'secret-leak'],
    ['password: "hunter2secure"', 'secret-leak'],
    ['<<<<<<< HEAD', 'conflict-marker'],
    ['=======', 'conflict-marker'],
    ['>>>>>>> branch', 'conflict-marker'],
    ['// TODO: fix later', 'todo-marker'],
    ['const x = 1   ', 'trailing-space'],
  ]
  for (const [line, rule] of cases) {
    const report = reviewRules(parseDiff(diffText(line)))
    assert.ok(
      report.issues.some((issue) => issue.rule === rule),
      `${line} triggers ${rule}`,
    )
    const issue = report.issues.find((i) => i.rule === rule)
    assert.equal(issue.file, 'src/a.js')
    assert.equal(issue.line, 3, `${rule} carries the line number`)
  }
})

test('clean diff produces zero error/warning issues', () => {
  const report = reviewRules(parseDiff(diffText('const answer = 42')))
  assert.equal(report.summary.errors, 0)
  assert.equal(report.summary.warnings, 0)
  assert.equal(report.summary.insertions, 1)
  assert.equal(report.summary.files, 1)
  assert.ok(
    report.issues.every((i) => i.severity === 'info'),
    'only informational rules may fire (no-test-change)',
  )
})

test('large-diff rule triggers above the threshold', () => {
  const lines = []
  for (let i = 0; i < LARGE_DIFF_LINES + 1; i += 1) lines.push(`+line ${i}`)
  const parsed = parseDiff(
    ['diff --git a/big.js b/big.js', '--- a/big.js', '+++ b/big.js', '@@ -1 +1,100 @@', ...lines].join('\n'),
  )
  const report = reviewRules(parsed)
  const issue = report.issues.find((i) => i.rule === 'large-diff')
  assert.ok(issue, 'large-diff flagged')
  assert.equal(issue.severity, 'warning')
})

test('binary-file rule flags binary diffs', () => {
  const parsed = parseDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n')
  const report = reviewRules(parsed)
  assert.ok(report.issues.some((i) => i.rule === 'binary-file'))
  assert.equal(report.summary.binary, true)
})

test('no-test-change rule fires only when source changes lack tests', () => {
  const parsed = parseDiff(
    ['diff --git a/src/a.js b/src/a.js', '--- a/src/a.js', '+++ b/src/a.js', '@@ -1 +1 @@', '+console.log(1)'].join(
      '\n',
    ),
  )
  assert.ok(reviewRules(parsed).issues.some((i) => i.rule === 'no-test-change'))
  const withTest = parseDiff(
    [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -1 +1 @@',
      '+const x = 1',
      '',
      'diff --git a/test/a.test.js b/test/a.test.js',
      '--- a/test/a.test.js',
      '+++ b/test/a.test.js',
      '@@ -1 +1 @@',
      '+test("x", () => {})',
    ].join('\n'),
  )
  assert.ok(!reviewRules(withTest).issues.some((i) => i.rule === 'no-test-change'), 'test change suppresses')
})

test('issue severities are graded', () => {
  const parsed = parseDiff(
    [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -1 +1 @@',
      '+const password = "supersecret123"',
      '+console.log("x")',
      '+// TODO: clean',
    ].join('\n'),
  )
  const report = reviewRules(parsed)
  assert.equal(report.summary.errors, 1)
  assert.equal(report.summary.warnings, 1)
  assert.equal(report.summary.infos, 2) // todo + no-test-change
})

// ── POST /review end-to-end ────────────────────────────────────────────────

test('POST /review returns a rule report for a real repo', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconsole.log("debug")\n')
  const { api } = boot({})
  await settle()
  const { status, value } = await postReview(api, {
    repoPath: repo,
    staged: false,
    aiReview: false,
  })
  assert.equal(status, 200)
  assert.equal(value.ok, true)
  assert.ok(
    value.value.issues.some((i) => i.rule === 'debug-statement'),
    'debug rule hit',
  )
  assert.equal(value.value.ai.enabled, false, 'ai disabled when requested off')
})

test('POST /review validates repoPath', async () => {
  const { api } = boot({})
  await settle()
  const missing = await postReview(api, {})
  assert.equal(missing.status, 400)
  const notRepo = await postReview(api, { repoPath: '/nonexistent-path-xyz' })
  assert.equal(notRepo.status, 400)
})

// ── AI augmentation ────────────────────────────────────────────────────────

function agentsMock({
  followup = () => {},
  sessionText = '{"verdict":"changes","summary":"有密钥","topIssues":["a"]}',
  sessionMode = 'events', // 'snapshot'（新 API）| 'events'（旧 API）| 'none'（都没有）
  createThrows = false,
  idleThrows = false,
  onCreate = () => {},
} = {}) {
  const events =
    sessionText === ''
      ? []
      : [
          {
            type: 'assistant/message',
            data: { message: { content: [{ type: 'text', text: sessionText }] } },
          },
        ]
  return {
    create: async (opts) => {
      onCreate(opts)
      if (createThrows) throw new Error('create failed')
      return {
        agent: {
          followup,
          whenIdle: async () => {
            if (idleThrows) throw new Error('idle failed')
          },
          session:
            sessionMode === 'snapshot'
              ? { snapshotEvents: () => events, events: [] }
              : sessionMode === 'none'
                ? {}
                : { events },
        },
        dispose: async () => {},
      }
    },
  }
}

test('POST /review with aiReview merges the AI conclusion', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconsole.log("debug")\n')
  let createdSessionId = ''
  const { api } = boot(
    {},
    {
      agents: agentsMock({
        // 回归断言（CodeQL js/insecure-randomness 修复）：sessionId 随机段
        // 由 crypto.randomUUID() 生成，格式 obs-review-<ts>-<6位hex>
        onCreate: (opts) => {
          createdSessionId = opts.sessionId
        },
      }),
    },
  )
  await settle()
  const { status, value } = await postReview(api, { repoPath: repo, aiReview: true })
  assert.equal(status, 200)
  assert.ok(/^obs-review-\d+-[0-9a-f]{6}$/.test(createdSessionId), 'sessionId uses crypto random hex suffix')
  assert.equal(value.value.ai.enabled, true)
  assert.equal(value.value.ai.verdict, 'changes')
  assert.equal(value.value.ai.summary, '有密钥')
  assert.deepEqual(value.value.ai.topIssues, ['a'])
  assert.ok(
    value.value.issues.some((i) => i.rule === 'debug-statement'),
    'rules still applied',
  )
})

test('AI failure degrades without breaking the rule report', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
  const { api } = boot({}, { agents: agentsMock({ createThrows: true }) })
  await settle()
  const { status, value } = await postReview(api, { repoPath: repo })
  assert.equal(status, 200)
  assert.equal(value.value.ai.enabled, true)
  assert.equal(value.value.ai.failed, true, 'failure flagged')
  assert.equal(value.value.summary.errors, 0, 'no rule errors')
  assert.equal(value.value.summary.warnings, 0, 'no rule warnings')
})

// ── issue #165：Session.events 迁移三场景（snapshotEvents 优先 / events 兜底 / 都没有）──
test('AI 审查上下文：snapshotEvents 优先（新 API，issue #165）', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconsole.log("debug")\n')
  const { api } = boot({}, { agents: agentsMock({ sessionMode: 'snapshot' }) })
  await settle()
  const { status, value } = await postReview(api, { repoPath: repo, aiReview: true })
  assert.equal(status, 200)
  assert.equal(value.value.ai.enabled, true)
  assert.equal(value.value.ai.verdict, 'changes', 'snapshotEvents 提供会话快照 → AI 结论解析成功')
})

test('AI 审查上下文：events 兜底（旧 API，issue #165）', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconsole.log("debug")\n')
  const { api } = boot({}, { agents: agentsMock({ sessionMode: 'events' }) })
  await settle()
  const { status, value } = await postReview(api, { repoPath: repo, aiReview: true })
  assert.equal(status, 200)
  assert.equal(value.value.ai.verdict, 'changes', 'events 提供会话快照 → AI 结论解析成功')
})

test('AI 审查上下文：都没有 → 降级不崩溃（issue #165）', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconsole.log("debug")\n')
  const { api } = boot({}, { agents: agentsMock({ sessionMode: 'none' }) })
  await settle()
  const { status, value } = await postReview(api, { repoPath: repo, aiReview: true })
  assert.equal(status, 200)
  assert.equal(value.value.ai.enabled, true)
  assert.equal(value.value.ai.failed, true, '无会话快照 → AI 结论解析失败降级')
  assert.equal(value.value.summary.errors, 0, '规则引擎结果不受影响')
})

test('AI unavailable (no agents service) degrades gracefully', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
  const { api } = boot({})
  await settle()
  const { status, value } = await postReview(api, { repoPath: repo })
  assert.equal(status, 200)
  assert.equal(value.value.ai.failed, true)
  assert.ok(value.value.ai.note.includes('unavailable'), 'note explains unavailability')
})

test('unparseable AI output degrades with a parse note', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
  const { api } = boot({}, { agents: agentsMock({ sessionText: 'not json at all' }) })
  await settle()
  const { value } = await postReview(api, { repoPath: repo })
  assert.equal(value.value.ai.failed, true)
  assert.ok(value.value.ai.note.includes('解析失败'), 'parse failure noted')
})

test('AI conclusion inside a markdown fence is parsed', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
  const { api } = boot(
    {},
    {
      agents: agentsMock({
        sessionText: '```json\n{"verdict":"approve","summary":"ok","topIssues":[]}\n```',
      }),
    },
  )
  await settle()
  const { value } = await postReview(api, { repoPath: repo })
  assert.equal(value.value.ai.verdict, 'approve', 'fenced JSON parsed')
})

test('config aiReview: false disables AI even when agents exist', async () => {
  const repo = createRepo()
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\n')
  git(repo, 'add', 'src/a.js')
  git(repo, 'commit', '-m', 'chore: seed')
  writeFileSync(join(repo, 'src/a.js'), 'const x = 1\nconst y = 2\n')
  const { api } = boot({ aiReview: false }, { agents: agentsMock() })
  await settle()
  const { value } = await postReview(api, { repoPath: repo })
  assert.equal(value.value.ai.enabled, false, 'config gate honored')
})

test('GET /status exposes audit stats and aiReview flag', async () => {
  const { api } = boot({})
  await settle()
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/observability/api/status' }), res)
  const value = jsonOf(res).value
  assert.equal(value.gitEnabled, true)
  assert.equal(value.aiReview, true)
  assert.equal(typeof value.auditCount, 'number')
})
