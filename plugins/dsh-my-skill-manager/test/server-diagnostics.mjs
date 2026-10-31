/**
 * dsh-my-skill-manager — 目录扫描 + 诊断单测。
 *
 * 覆盖：frontmatter 解析（缺失 / 无收尾 / 引号）、正常条目收录、
 * 坏符号链接 / 缺 SKILL.md / 缺 frontmatter / 名称非法 / 解析失败五种诊断、
 * .md 单文件形式、.system 跳过、不存在的根目录静默跳过。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import {
  DIAGNOSTIC_REASONS,
  SKILL_NAME_RE,
  classifySkillEntry,
  parseFrontmatter,
  scanSkillRoots,
} from '../lib/server/diagnostics.js'

const home = dirSync({ unsafeCleanup: true, prefix: 'dsm-diagnostics-' }).name
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

test('reason codes are the stable documented enum', () => {
  assert.deepEqual(DIAGNOSTIC_REASONS, [
    'broken-symlink',
    'missing-skill-md',
    'missing-frontmatter',
    'invalid-name',
    'parse-failed',
  ])
  assert.equal(SKILL_NAME_RE.test('codebase-memory'), true)
  assert.equal(SKILL_NAME_RE.test('BadName'), false)
})

test('parseFrontmatter distinguishes missing / malformed / ok', () => {
  assert.deepEqual(parseFrontmatter('no frontmatter'), { kind: 'missing' })
  assert.deepEqual(parseFrontmatter('---\nname: x\n'), { kind: 'malformed' })
  assert.deepEqual(parseFrontmatter('---\nname: "quoted"\ndescription: \'single\'\n---\nbody'), {
    kind: 'ok',
    fields: { name: 'quoted', description: 'single' },
  })
})

test('classifySkillEntry maps contents to skill or diagnostic reason', () => {
  assert.deepEqual(classifySkillEntry({ entryName: 'a', raw: '---\nname: a\ndescription: d\n---\n' }), {
    kind: 'skill',
    name: 'a',
    description: 'd',
  })
  assert.deepEqual(classifySkillEntry({ entryName: 'a', raw: 'no frontmatter' }), {
    kind: 'issue',
    reason: 'missing-frontmatter',
  })
  assert.deepEqual(classifySkillEntry({ entryName: 'a', raw: '---\nname: a\n' }), {
    kind: 'issue',
    reason: 'parse-failed',
  })
  assert.deepEqual(classifySkillEntry({ entryName: 'a', raw: '---\nname: a\n---\n' }), {
    kind: 'issue',
    reason: 'parse-failed',
  })
  assert.deepEqual(classifySkillEntry({ entryName: 'a', raw: '---\nname: Bad_Name\ndescription: d\n---\n' }), {
    kind: 'issue',
    reason: 'invalid-name',
  })
})

test('scanSkillRoots collects skills and classifies every anomaly', async () => {
  const root = join(home, 'skills')
  const write = (name, content) => {
    mkdirSync(join(root, name), { recursive: true })
    writeFileSync(join(root, name, 'SKILL.md'), content, 'utf8')
  }
  write('good-skill', '---\nname: good-skill\ndescription: hello\n---\nbody')
  write('bad-name', '---\nname: Bad_Name\ndescription: x\n---\n')
  write('no-frontmatter', '# just markdown')
  write('unterminated', '---\nname: unterminated\ndescription: x')
  mkdirSync(join(root, 'no-skill-md'), { recursive: true })
  mkdirSync(join(root, '.system'), { recursive: true })
  writeFileSync(join(root, 'flat-skill.md'), '---\nname: flat-skill\ndescription: flat\n---\n', 'utf8')
  symlinkSync(join(home, 'does-not-exist'), join(root, 'broken-link'))

  const result = await scanSkillRoots([
    { path: root, source: 'user-dsh' },
    { path: join(home, 'missing-root'), source: 'user-agents' },
  ])

  assert.deepEqual(result.skills.map((skill) => skill.name).sort(), ['flat-skill', 'good-skill'])
  const reasons = result.issues.map((issue) => `${issue.name}:${issue.reason}`).sort()
  assert.deepEqual(reasons, [
    'bad-name:invalid-name',
    'broken-link:broken-symlink',
    'no-frontmatter:missing-frontmatter',
    'no-skill-md:missing-skill-md',
    'unterminated:parse-failed',
  ])
  const good = result.skills.find((skill) => skill.name === 'good-skill')
  assert.equal(good.source, 'user-dsh')
  assert.equal(good.path, join(root, 'good-skill'))
})
