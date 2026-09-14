/**
 * dsh-my-skill-manager — diagnose module unit tests.
 *
 * 覆盖：viewRootsOf 全局/项目视图根目录、scanSkillRoots 正常条目进 skills、
 * 异常条目进 issues（broken-symlink / missing-skills-md / missing-frontmatter /
 * missing-name-description / invalid-name）、非 skill 条目不报、.system 跳过、
 * 引号值解析、DSH_HOME 回退。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { scanSkillRoots, viewRootsOf } from '../lib/diagnose.js'

const dir = dirSync({ unsafeCleanup: true, prefix: 'dsm-diagnose-test-' }).name
process.env.DSH_HOME = dir
process.env.DSH_AGENTS_HOME = join(dir, 'agents')

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('viewRootsOf(undefined) returns the global roots only', async () => {
  const roots = await viewRootsOf(undefined)
  assert.deepEqual(
    roots.map((r) => r.source),
    ['user-dsh', 'user-agents'],
  )
  assert.equal(roots[0].path, join(dir, 'skills'))
  assert.equal(roots[1].path, join(dir, 'agents', 'skills'))
})

test('viewRootsOf(cwd) adds the project roots', async () => {
  mkdirSync(join(dir, 'repo', '.git'), { recursive: true })
  const roots = await viewRootsOf(join(dir, 'repo', 'sub'))
  assert.deepEqual(
    roots.map((r) => r.source),
    ['user-dsh', 'user-agents', 'project-dsh', 'project-agents'],
  )
  assert.equal(roots[2].path, join(dir, 'repo', '.dsh', 'skills'))
  assert.equal(roots[3].path, join(dir, 'repo', '.agents', 'skills'))
})

test('scanSkillRoots returns valid skills and classifies every issue reason', async () => {
  const skillsDir = join(dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  symlinkSync(join(skillsDir, 'nowhere'), join(skillsDir, 'broken-link'))
  writeFileSync(join(skillsDir, 'no-frontmatter.md'), 'hello')
  mkdirSync(join(skillsDir, 'empty-dir'))
  mkdirSync(join(skillsDir, 'good-skill'))
  writeFileSync(join(skillsDir, 'good-skill', 'SKILL.md'), '---\nname: good-skill\ndescription: 好\n---\nbody')
  writeFileSync(join(skillsDir, 'no-name.md'), '---\ndescription: 缺名字\n---\nbody')
  writeFileSync(join(skillsDir, 'Bad_Name.md'), '---\nname: Bad_Name\ndescription: 非法\n---\nbody')
  writeFileSync(join(skillsDir, 'quoted.md'), '---\nname: "quoted"\ndescription: \'引号描述\'\n---\nbody')

  const { skills, issues } = await scanSkillRoots([{ path: skillsDir, source: 'user-dsh' }])
  const skillNames = skills.map((s) => s.name)
  assert.ok(skillNames.includes('good-skill'), 'valid directory skill scanned')
  assert.equal(skills.find((s) => s.name === 'good-skill').description, '好')
  assert.equal(skills.find((s) => s.name === 'good-skill').source, 'user-dsh')
  assert.ok(skillNames.includes('quoted'), 'quoted frontmatter values parse')
  const byName = Object.fromEntries(issues.map((m) => [m.name, m]))
  assert.equal(byName['broken-link'].reason, 'broken-symlink')
  assert.equal(byName['no-frontmatter'].reason, 'missing-frontmatter')
  assert.equal(byName['empty-dir'].reason, 'missing-skills-md')
  assert.equal(byName['no-name'].reason, 'missing-name-description')
  assert.equal(byName['Bad_Name'].reason, 'invalid-name')
})

test('scanSkillRoots skips non-skill, .system and absent entries', async () => {
  const skillsDir = join(dir, 'skills2')
  mkdirSync(skillsDir, { recursive: true })
  mkdirSync(join(skillsDir, 'known'))
  writeFileSync(join(skillsDir, 'known', 'SKILL.md'), '---\nname: known\ndescription: 已知\n---\nbody')
  writeFileSync(join(skillsDir, 'notes.txt'), 'not a skill')
  mkdirSync(join(skillsDir, '.system'))
  writeFileSync(join(skillsDir, '.system', 'SKILL.md'), '---\nname: system-x\ndescription: 系统\n---\nbody')

  const { skills, issues } = await scanSkillRoots([{ path: skillsDir, source: 'user-dsh' }])
  assert.deepEqual(
    skills.map((s) => s.name),
    ['known'],
    'non-skill and .system entries are not scanned',
  )
  assert.deepEqual(issues, [], 'no issues for clean entries')

  const absent = await scanSkillRoots([{ path: join(dir, 'no-such-dir'), source: 'user-dsh' }])
  assert.deepEqual(absent.skills, [], 'absent root directory yields no skills')
  assert.deepEqual(absent.issues, [], 'absent root directory yields no issues')
})

test('frontmatter with a name but no description is an issue', async () => {
  const skillsDir = join(dir, 'skills3')
  mkdirSync(skillsDir, { recursive: true })
  writeFileSync(join(skillsDir, 'name-only.md'), '---\nname: name-only\n---\nbody')

  const { skills, issues } = await scanSkillRoots([{ path: skillsDir, source: 'user-dsh' }])
  assert.deepEqual(skills, [], 'name-only entry is not a skill')
  assert.equal(issues.length, 1)
  assert.equal(issues[0].name, 'name-only')
  assert.equal(issues[0].reason, 'missing-name-description')
})

test('scanSkillRoots follows symlinks to valid skill directories', async () => {
  const skillsDir = join(dir, 'skills4')
  const targetDir = join(dir, 'real-skill')
  mkdirSync(targetDir, { recursive: true })
  writeFileSync(join(targetDir, 'SKILL.md'), '---\nname: linked-skill\ndescription: 链接\n---\nbody')
  mkdirSync(skillsDir, { recursive: true })
  symlinkSync(targetDir, join(skillsDir, 'linked-skill'))

  const { skills, issues } = await scanSkillRoots([{ path: skillsDir, source: 'user-dsh' }])
  assert.deepEqual(issues, [], 'valid symlink is not an issue')
  assert.equal(skills.length, 1, 'symlinked skill directory is scanned')
  assert.equal(skills[0].name, 'linked-skill')
  assert.equal(skills[0].source, 'user-dsh')
})

test('viewRootsOf falls back to the home dirs when env vars are unset', async () => {
  const savedHome = process.env.DSH_HOME
  const savedAgents = process.env.DSH_AGENTS_HOME
  delete process.env.DSH_HOME
  delete process.env.DSH_AGENTS_HOME
  try {
    const roots = await viewRootsOf(undefined)
    assert.equal(roots[0].path, join(process.env.HOME ?? '', '.dsh', 'skills'))
    assert.equal(roots[1].path, join(process.env.HOME ?? '', '.agents', 'skills'))
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    if (savedAgents === undefined) delete process.env.DSH_AGENTS_HOME
    else process.env.DSH_AGENTS_HOME = savedAgents
  }
})
