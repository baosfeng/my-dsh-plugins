'use strict'

/**
 * .github/scripts/summarize-tool-output.cjs 的离线单测（issue #303）。
 * 跑法：`node --test .github/scripts/summarize-tool-output.test.cjs`
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  summarizeEslint,
  summarizePrettier,
  summarizeNpmAudit,
  summarizeTsc,
  summarizeGeneric,
  summarizeToolOutput,
} = require('./summarize-tool-output.cjs')

const ESC = '\u001b'

test('eslint(complexity)：渲染为「文件:行 — 中文规则 — 实测/阈值」且无 ANSI、无英文原文裸贴', () => {
  const raw = [
    `${ESC}[31m/path/plugins/dsh-a/src/index.ts: line 12, col 3, Error - Function 'apply' has a complexity of 17. Maximum allowed is 10. (complexity)${ESC}[39m`,
    '/path/plugins/dsh-b/src/util.ts: line 8, col 1, Warning - Unexpected console statement. (no-console)',
  ].join('\n')
  const out = summarizeToolOutput('eslint', raw)
  assert.ok(out.includes('`/path/plugins/dsh-a/src/index.ts:12`'), out)
  assert.ok(out.includes('圈复杂度超标（complexity）'), out)
  assert.ok(out.includes('实测 17，阈值 10'), out)
  assert.ok(out.includes('不应使用 console（no-console）'), out)
  assert.equal(out.includes(ESC), false)
  assert.equal(out.includes('Maximum allowed'), false)
})

test('eslint：超过 max 条时给出中文截断提示', () => {
  const lines = Array.from(
    { length: 25 },
    (_, i) =>
      `/f${i}.js: line ${i + 1}, col 1, Error - Function 'f' has a complexity of ${11 + i}. Maximum allowed is 10. (complexity)`,
  )
  const out = summarizeToolOutput('eslint', lines.join('\n'), { max: 5 })
  assert.equal(out.split('\n').filter((l) => l.startsWith('- `')).length, 5)
  assert.ok(out.includes('共 25 条；完整输出见 CI 日志'), out)
})

test('eslint：非 compact 输出退化为通用摘要（不会丢信息）', () => {
  const out = summarizeToolOutput('eslint', 'plain text without compact format')
  assert.ok(out.includes('plain text without compact format'), out)
})

test('prettier：列出待格式化文件并给出中文说明，过滤汇总行', () => {
  const raw = [
    'Checking formatting...',
    `${ESC}[33mwarn${ESC}[39m docs-report.md`,
    '[warn] .github/workflows/a.yml',
    '[warn] Code style issues found in the above file. Run Prettier with --write to fix.',
  ].join('\n')
  const out = summarizeToolOutput('prettier', raw)
  assert.ok(out.includes('`docs-report.md` — 需要按 Prettier 规则重新格式化'), out)
  assert.ok(out.includes('`.github/workflows/a.yml`'), out)
  assert.equal(out.includes('Code style issues found'), false)
  assert.equal(out.includes(ESC), false)
})

test('npm-audit：输出中文严重级别与受影响版本', () => {
  const raw = [
    '# npm audit report',
    '',
    'lodash  <4.17.21',
    'Severity: high',
    'Prototype Pollution - https://github.com/advisories/GHSA-xxxx',
    'fix available via `npm audit fix`',
    '',
    '1 high severity vulnerability',
    '',
    'To address all issues, run:',
    '  npm audit fix',
  ].join('\n')
  const out = summarizeToolOutput('npm-audit', raw)
  assert.ok(out.includes('`lodash`'), out)
  assert.ok(out.includes('严重级别 高（high）'), out)
  assert.ok(out.includes('1 high severity vulnerability'), out)
})

test('tsc：结构化文件:行 + 错误码，保留消息原文（类型错误不做机器翻译）', () => {
  const raw = "src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'."
  const out = summarizeToolOutput('tsc', raw)
  assert.ok(out.includes('`src/a.ts:12`'), out)
  assert.ok(out.includes('TS2322'), out)
  assert.ok(out.includes('错误'), out)
})

test('generic：剥色 + 限行 + 截断提示', () => {
  const raw = [`${ESC}[31m第一行${ESC}[0m`, '第二行', '第三行'].join('\n')
  const out = summarizeGeneric(raw, { max: 2 }).join('\n')
  assert.ok(out.includes('- 第一行'))
  assert.ok(out.includes('共 3 条；完整输出见 CI 日志'), out)
  assert.equal(out.includes(ESC), false)
})

test('空输入不炸，返回占位', () => {
  assert.equal(summarizeToolOutput('eslint', ''), '- 无输出')
  assert.equal(summarizeToolOutput('unknown-kind', ''), '- 无输出')
})
