'use strict'

/**
 * .github/scripts/review-comment.cjs 的离线单测（issue #303）。
 * 跑法：`node --test .github/scripts/review-comment.test.cjs`
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { stripAnsi, countEscapes, reviewMarker, upsertReviewComment } = require('./review-comment.cjs')

/** 真实 prettier --check 输出片段（带色）：`[33mwarn[39m] docs-report.md` */
const PRETTIER_WARN = '\u001b[33mwarn\u001b[39m docs-report.md'
/** 复合序列：加粗 + 红色 FAIL + 复位。 */
const NPM_FAIL = '\u001b[1m\u001b[31mFAIL\u001b[0m \u001b[32mok\u001b[39m'

test('stripAnsi：剥离 prettier 的 [33m…[39m 颜色转义', () => {
  assert.equal(countEscapes(PRETTIER_WARN), 2)
  const clean = stripAnsi(PRETTIER_WARN)
  assert.equal(clean, 'warn docs-report.md')
  assert.equal(countEscapes(clean), 0)
})

test('stripAnsi：剥离复合/复位序列，保留可见文本', () => {
  assert.equal(stripAnsi(NPM_FAIL), 'FAIL ok')
  assert.equal(countEscapes(stripAnsi(NPM_FAIL)), 0)
})

test('stripAnsi：不破坏正常 Markdown / 中文 / emoji / 代码块', () => {
  const markdown = [
    '## 📚 文档审查报告',
    '',
    '- ✅ 文档一致性检查通过',
    '- ❌ 格式检查失败（3 个文件）',
    '',
    '```txt',
    'const a = 1; // 不要动这里',
    '```',
  ].join('\n')
  assert.equal(stripAnsi(markdown), markdown)
  assert.equal(countEscapes(stripAnsi(markdown)), 0)
})

test('stripAnsi：无转义输入原样返回；null/undefined 归一为空串', () => {
  assert.equal(stripAnsi('plain text'), 'plain text')
  assert.equal(stripAnsi(null), '')
  assert.equal(stripAnsi(undefined), '')
})

test('reviewMarker：不同报告 id 生成不同且可识别的 marker', () => {
  assert.equal(reviewMarker('code-quality'), '<!-- dsh-review:code-quality -->')
  assert.notEqual(reviewMarker('code-quality'), reviewMarker('documentation-review'))
})

/** 构造一个最小的 octokit/github-script 假客户端。 */
function fakeGithub({ comments = [] } = {}) {
  const calls = { created: [], updated: [], listed: 0 }
  const github = {
    paginate: async (_fn, params) => {
      calls.listed += 1
      calls.listParams = params
      return comments
    },
    rest: {
      issues: {
        listComments: {},
        createComment: async (params) => {
          calls.created.push(params)
          return { data: { id: 1001 } }
        },
        updateComment: async (params) => {
          calls.updated.push(params)
          return { data: { id: params.comment_id } }
        },
      },
    },
  }
  return { github, calls }
}

const context = { repo: { owner: 'baosfeng', repo: 'my-dsh-plugins' }, issue: { number: 303 } }

test('upsertReviewComment：首次运行创建评论，body 首行是 marker 且已剥色', async () => {
  const { github, calls } = fakeGithub()
  const res = await upsertReviewComment({
    github,
    context,
    id: 'documentation-review',
    heading: '## 📚 文档审查报告',
    report: `### 格式检查\n${PRETTIER_WARN}`,
  })

  assert.equal(res.action, 'created')
  assert.equal(res.commentId, 1001)
  assert.equal(res.escapeCount, 0)
  assert.equal(calls.created.length, 1)
  assert.equal(calls.updated.length, 0)
  const body = calls.created[0].body
  assert.ok(body.startsWith('<!-- dsh-review:documentation-review -->\n'))
  assert.ok(body.includes('## 📚 文档审查报告'))
  assert.equal(countEscapes(body), 0)
  assert.ok(body.includes('warn docs-report.md'))
})

test('upsertReviewComment：已有同 marker 的 bot 评论时原地更新（不追加）', async () => {
  const { github, calls } = fakeGithub({
    comments: [
      { id: 7, user: { type: 'User', login: 'baosfeng' }, body: '人工评论，不含 marker' },
      {
        id: 42,
        user: { type: 'Bot', login: 'github-actions[bot]' },
        body: '<!-- dsh-review:code-quality -->\n## 🔍 代码质量审查报告\n\n旧内容',
      },
    ],
  })
  const res = await upsertReviewComment({
    github,
    context,
    id: 'code-quality',
    heading: '## 🔍 代码质量审查报告',
    report: NPM_FAIL,
  })

  assert.equal(res.action, 'updated')
  assert.equal(res.commentId, 42)
  assert.equal(calls.created.length, 0)
  assert.equal(calls.updated.length, 1)
  assert.equal(calls.updated[0].comment_id, 42)
  assert.equal(countEscapes(calls.updated[0].body), 0)
  assert.equal(calls.listParams.issue_number, 303)
})

test('upsertReviewComment：不会误更新其它报告或人类评论的 marker', async () => {
  const { github, calls } = fakeGithub({
    comments: [
      { id: 8, user: { type: 'Bot', login: 'github-actions[bot]' }, body: '<!-- dsh-review:security-review -->\n安全' },
      { id: 9, user: { type: 'User', login: 'someone' }, body: '<!-- dsh-review:code-quality --> 人类引用' },
    ],
  })
  const res = await upsertReviewComment({
    github,
    context,
    id: 'code-quality',
    heading: '## 🔍 代码质量审查报告',
    report: '正文',
  })

  assert.equal(res.action, 'created')
  assert.equal(calls.updated.length, 0)
  assert.equal(calls.created.length, 1)
})

test('buildConsolidated：结论唯一、任一项不通过则总结论不通过、≤30 行', () => {
  const { buildConsolidated } = require('./review-comment.cjs')
  const pass = '## 结论\n\n通过\n\n统计：通过 2 项 / 不通过 0 项 / 未能判定 0 项\n'
  const fail = '## 结论\n\n不通过\n\n## 关键证据\n\n- `src/a.ts:12` — 圈复杂度超标（complexity）：实测 17，阈值 10\n'
  const unknown = '## 结论\n\n未能判定\n'
  const out = buildConsolidated([
    { name: '代码质量', md: fail },
    { name: '安全', md: pass },
    { name: 'API 设计', md: unknown },
  ])
  assert.ok(out.startsWith('## 结论\n\n不通过'), out)
  assert.ok(out.includes('通过 1 项 / 不通过 1 项 / 未能判定 1 项'), out)
  assert.ok(out.includes('**代码质量**：不通过 — `src/a.ts:12`'), out)
  assert.ok(out.includes('## 建议'), out)
  assert.ok(out.split('\n').length <= 30, `行数 ${out.split('\n').length}`)
  assert.equal(out.includes('\u001b'), false)
})

test('buildConsolidated：无不通过但存在未能判定时，总结论为未能判定（不得伪装通过）', () => {
  const { buildConsolidated } = require('./review-comment.cjs')
  const out = buildConsolidated([
    { name: '测试', md: '## 结论\n\n未能判定（本 job 不执行测试）\n' },
    { name: '文档', md: '## 结论\n\n通过\n' },
  ])
  assert.ok(out.startsWith('## 结论\n\n未能判定'), out)
})

test('truncateLines：超限即截断并给指向说明', () => {
  const { truncateLines } = require('./review-comment.cjs')
  const long = Array.from({ length: 50 }, (_, i) => `行${i + 1}`).join('\n')
  const out = truncateLines(long, 30)
  assert.equal(out.split('\n').length, 30)
  assert.ok(out.includes('内容超长已截断'), out)
  assert.equal(truncateLines('短文本', 30), '短文本')
})

test('mergeHistory：累计历史结论（保留最近 N 次）并渲染中文摘要', () => {
  const { mergeHistory, renderHistory } = require('./review-comment.cjs')
  const body = '<!-- dsh-review-history: 通过,不通过 -->\n\n## 结论\n\n不通过\n'
  const r = mergeHistory(body, '通过')
  assert.deepEqual(r.outcomes, ['通过', '不通过', '通过'])
  assert.equal(r.historyLine, '最近 3 次检查：通过 ×2、不通过 ×1')
  assert.ok(r.historyComment.includes('<!-- dsh-review-history: 通过,不通过,通过 -->'))
  assert.equal(mergeHistory('', '通过').historyLine, '最近 1 次检查：通过 ×1')
  assert.equal(renderHistory([]), '')
})
