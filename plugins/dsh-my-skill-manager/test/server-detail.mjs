/**
 * dsh-my-skill-manager — SKILL.md 只读详情单测。
 *
 * 覆盖：目录形式与单 .md 形式、项目根解析、非法 name、路径穿越、符号链接
 * 逃逸白名单根（forbidden）、找不到（not-found）、>256KB 截断。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { MAX_DETAIL_BYTES, DetailError, readSkillDetail } from '../lib/server/detail.js'

const home = dirSync({ unsafeCleanup: true, prefix: 'dsm-detail-' }).name
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

const userRoot = join(home, 'skills')
mkdirSync(userRoot, { recursive: true })

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

/** 断言抛出指定错误码的 DetailError。 */
async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DetailError, `expected DetailError, got ${error}`)
    assert.equal(error.code, code)
    return true
  })
}

test('reads SKILL.md from a skill directory', async () => {
  mkdirSync(join(userRoot, 'alpha'), { recursive: true })
  writeFileSync(join(userRoot, 'alpha', 'SKILL.md'), '# alpha\n', 'utf8')
  const detail = await readSkillDetail({ name: 'alpha' })
  assert.equal(detail.name, 'alpha')
  assert.equal(detail.content, '# alpha\n')
  assert.equal(detail.truncated, false)
  assert.ok(detail.path.endsWith(join('alpha', 'SKILL.md')))
})

test('reads a flat <name>.md skill and project roots via cwd', async () => {
  writeFileSync(join(userRoot, 'flat.md'), '# flat\n', 'utf8')
  assert.equal((await readSkillDetail({ name: 'flat' })).content, '# flat\n')

  const repo = join(home, 'repo')
  mkdirSync(join(repo, '.git'), { recursive: true })
  const projectSkill = join(repo, '.dsh', 'skills', 'beta')
  mkdirSync(projectSkill, { recursive: true })
  writeFileSync(join(projectSkill, 'SKILL.md'), '# beta\n', 'utf8')
  const detail = await readSkillDetail({ name: 'beta', cwd: join(repo, 'sub') })
  assert.equal(detail.content, '# beta\n')
  // 无项目上下文时项目根不参与白名单
  await expectCode(readSkillDetail({ name: 'beta' }), 'not-found')
})

test('rejects invalid names and path traversal', async () => {
  await expectCode(readSkillDetail({ name: '' }), 'invalid-name')
  await expectCode(readSkillDetail({ name: 'Bad Name' }), 'invalid-name')
  await expectCode(readSkillDetail({ name: '../secrets' }), 'invalid-name')
  await expectCode(readSkillDetail({ name: 'a/b' }), 'invalid-name')
})

test('refuses symlinks that escape the whitelisted root', async () => {
  const outside = join(home, 'outside')
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'SKILL.md'), '# leaked\n', 'utf8')
  symlinkSync(outside, join(userRoot, 'escape'))
  await expectCode(readSkillDetail({ name: 'escape' }), 'forbidden')
})

test('truncates content above 256KB and flags it', async () => {
  const big = join(userRoot, 'big')
  mkdirSync(big, { recursive: true })
  writeFileSync(join(big, 'SKILL.md'), 'a'.repeat(MAX_DETAIL_BYTES + 1024), 'utf8')
  const detail = await readSkillDetail({ name: 'big' })
  assert.equal(detail.truncated, true)
  assert.equal(detail.content.length, MAX_DETAIL_BYTES)
})

test('reports not-found for unknown skills', async () => {
  await expectCode(readSkillDetail({ name: 'nope' }), 'not-found')
})
