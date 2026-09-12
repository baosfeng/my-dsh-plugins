/**
 * scripts/lib/impact-scope.mjs 回归测试（issue #188）。
 *
 * 重点覆盖 pre-push 裁剪规则的边界，尤其是 issue #188 修掉的「纯删除提交」假绿：
 * changedFiles 补 D 之前，删除 plugins/foo/lib/x.js 的提交根本不出现在变更列表里 →
 * 该插件的测试跑 0 个却退出 0，而 CI matrix 仍会跑。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  computeImpactScope,
  diffPackageJsonRuntimeFields,
  listChangedFiles,
  parseNameStatus,
} from '../lib/impact-scope.mjs'

// ── parseNameStatus ────────────────────────────────────────────────────────
test('parseNameStatus：解析 A/M/D 三种状态（制表符分隔）', () => {
  assert.deepEqual(parseNameStatus('A\tnew.js\nM\tmod.js\nD\tgone.js\n'), [
    { status: 'A', path: 'new.js' },
    { status: 'M', path: 'mod.js' },
    { status: 'D', path: 'gone.js' },
  ])
})

test('parseNameStatus：空输入/空行/缺分隔符的畸形行被忽略（不产生幽灵文件）', () => {
  assert.deepEqual(parseNameStatus(''), [])
  assert.deepEqual(parseNameStatus('\n\n'), [])
  assert.deepEqual(parseNameStatus('M\n\t\nD\t\n'), [])
  assert.deepEqual(parseNameStatus(undefined), [])
})

// ── listChangedFiles：真实 git 仓库（issue #188 的核心回归）────────────────
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'impact-scope-test-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'impact-scope-test')
  git('config', 'commit.gpgsign', 'false')
  const runGit = (args) => {
    try {
      return { ok: true, out: execFileSync('git', args, { cwd: dir, encoding: 'utf8' }) }
    } catch {
      return { ok: false, out: '' }
    }
  }
  return { dir, git, runGit }
}

test('listChangedFiles：纯删除提交必须出现在变更列表（--diff-filter 含 D）', () => {
  const { dir, git, runGit } = makeRepo()
  try {
    mkdirSync(join(dir, 'plugins', 'foo', 'lib'), { recursive: true })
    writeFileSync(join(dir, 'plugins', 'foo', 'lib', 'index.js'), 'export const a = 1\n')
    git('add', '-A')
    git('commit', '-qm', 'init')
    const base = git('rev-parse', 'HEAD').trim()

    rmSync(join(dir, 'plugins', 'foo', 'lib', 'index.js'))
    git('add', '-A')
    git('commit', '-qm', 'delete plugin entry')

    assert.deepEqual(listChangedFiles(base, runGit), [{ status: 'D', path: 'plugins/foo/lib/index.js' }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listChangedFiles：重命名拆成 D + A（--no-renames，语义更保守）', () => {
  const { dir, git, runGit } = makeRepo()
  try {
    writeFileSync(join(dir, 'before.js'), 'export const a = 1\n')
    git('add', '-A')
    git('commit', '-qm', 'init')
    const base = git('rev-parse', 'HEAD').trim()

    git('mv', 'before.js', 'after.js')
    git('commit', '-qm', 'rename')

    const changed = listChangedFiles(base, runGit)
    // git 按路径排序输出：after.js 在前、before.js 在后
    assert.deepEqual(changed, [
      { status: 'A', path: 'after.js' },
      { status: 'D', path: 'before.js' },
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listChangedFiles：git 失败（基准不存在）返回 null → 调用方安全退化', () => {
  const { dir, runGit } = makeRepo()
  try {
    assert.equal(listChangedFiles('no-such-ref-188', runGit), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── computeImpactScope ─────────────────────────────────────────────────────
const PLUGINS = ['dsh-alpha', 'dsh-beta', 'dsh-gamma', 'dsh-delta', 'dsh-epsilon', 'dsh-zeta', 'dsh-shared']
const dependents = (map) => (name) => new Set(map[name] ?? [])
const scope = (changed, extra = {}) =>
  computeImpactScope(changed, { plugins: PLUGINS, dependentsOf: dependents({}), ...extra })

test('删除插件内的文件：该插件仍被纳入测试（issue #188 假绿修复）', () => {
  const r = scope([{ status: 'D', path: 'plugins/dsh-alpha/lib/index.js' }])
  assert.equal(r.escalated, false)
  assert.deepEqual([...r.plugins], ['dsh-alpha'])
})

test('删除整个插件目录（该插件当前已不存在）：退化全量（当前工作区无法推断旧依赖方）', () => {
  const r = scope([{ status: 'D', path: 'plugins/dsh-removed/lib/index.js' }])
  assert.equal(r.escalated, true)
  assert.deepEqual([...r.plugins].sort(), [...PLUGINS].sort())
  assert.match(r.reasons.join('\n'), /删除 plugins\/dsh-removed/)
})

test('非插件目录下的 plugins/ 杂项文件（未改动状态）不纳入任何插件', () => {
  const r = scope([{ status: 'A', path: 'plugins/README.txt' }])
  assert.equal(r.escalated, false)
  assert.equal(r.plugins.size, 0)
})

test('依赖闭包超过上限（> 一半插件）：退化全量', () => {
  const r = computeImpactScope([{ status: 'M', path: 'plugins/dsh-shared/lib/x.js' }], {
    plugins: PLUGINS,
    dependentsOf: dependents({ 'dsh-shared': ['dsh-alpha', 'dsh-beta', 'dsh-gamma', 'dsh-delta', 'dsh-epsilon'] }),
  })
  assert.equal(r.escalated, true)
  assert.match(r.reasons.join('\n'), /受影响闭包有 6 个插件/)
})

test('依赖闭包在上限内：纳入闭包（不退化）——dsh-md-render 的实际形态', () => {
  const r = computeImpactScope([{ status: 'M', path: 'plugins/dsh-shared/lib/x.js' }], {
    plugins: PLUGINS,
    dependentsOf: dependents({ 'dsh-shared': ['dsh-alpha', 'dsh-beta', 'dsh-gamma'] }),
  })
  assert.equal(r.escalated, false)
  assert.deepEqual([...r.plugins].sort(), ['dsh-alpha', 'dsh-beta', 'dsh-gamma', 'dsh-shared'])
})

test('依赖闭包含传递依赖：依赖方的依赖方也要纳入', () => {
  const r = computeImpactScope([{ status: 'M', path: 'plugins/dsh-alpha/lib/x.js' }], {
    plugins: PLUGINS,
    dependentsOf: dependents({ 'dsh-alpha': ['dsh-beta'], 'dsh-beta': ['dsh-gamma'] }),
  })
  assert.equal(r.escalated, false)
  assert.deepEqual([...r.plugins].sort(), ['dsh-alpha', 'dsh-beta', 'dsh-gamma'])
  assert.match(r.reasons.join('\n'), /额外纳入依赖闭包：dsh-beta、dsh-gamma/)
})

test('插件变更 + 单个依赖方：依赖方一并纳入（不退化）', () => {
  const r = computeImpactScope([{ status: 'M', path: 'plugins/dsh-alpha/lib/x.js' }], {
    plugins: PLUGINS,
    dependentsOf: dependents({ 'dsh-alpha': ['dsh-beta'] }),
  })
  assert.equal(r.escalated, false)
  assert.deepEqual([...r.plugins].sort(), ['dsh-alpha', 'dsh-beta'])
})

test('纯文档变更：docsOnly 短路（0 个插件测试）', () => {
  const r = scope([
    { status: 'M', path: 'docs/索引.md' },
    { status: 'A', path: 'skills/foo/SKILL.md' },
  ])
  assert.equal(r.escalated, false)
  assert.equal(r.docsOnly, true)
  assert.equal(r.plugins.size, 0)
})

test('CI 流水线 YAML 变更：不退化（与插件测试结果无关）', () => {
  const r = scope([{ status: 'M', path: '.github/workflows/ci.yml' }])
  assert.equal(r.escalated, false)
  assert.equal(r.plugins.size, 0)
})

test('package-lock.json 变更：不触发全量（issue #188 收窄）', () => {
  const r = scope([{ status: 'M', path: 'package-lock.json' }])
  assert.equal(r.escalated, false)
  assert.equal(r.plugins.size, 0)
  assert.match(r.reasons.join('\n'), /package-lock\.json 与插件测试结果无关/)
})

test('scripts/check-docs.mjs 变更：不触发全量（issue #188 收窄）', () => {
  const r = scope([{ status: 'M', path: 'scripts/check-docs.mjs' }])
  assert.equal(r.escalated, false)
  assert.equal(r.plugins.size, 0)
})

test('删除 scripts/check-docs.mjs：仍退化全量（门禁消失不能被静默放过）', () => {
  const r = scope([{ status: 'D', path: 'scripts/check-docs.mjs' }])
  assert.equal(r.escalated, true)
  assert.match(r.reasons.join('\n'), /check-docs\.mjs/)
})

test('其它 scripts 脚本（如 test-all.sh）变更：仍然退化全量', () => {
  assert.equal(scope([{ status: 'M', path: 'scripts/test-all.sh' }]).escalated, true)
  assert.equal(scope([{ status: 'M', path: 'scripts/lib/impact-scope.mjs' }]).escalated, true)
})

test('根工具链文件（tsconfig/vitest.config/eslint.config）变更：退化全量', () => {
  for (const p of ['tsconfig.json', 'vitest.config.mjs', 'eslint.config.js', 'knip.json']) {
    assert.equal(scope([{ status: 'M', path: p }]).escalated, true, p)
  }
})

test('package.json 仅元数据变化：不退化（issue #188 字段级判定）', () => {
  const r = scope([{ status: 'M', path: 'package.json' }], { packageJsonRuntimeFields: [] })
  assert.equal(r.escalated, false)
  assert.equal(r.plugins.size, 0)
  assert.match(r.reasons.join('\n'), /仅元数据字段变化/)
})

test('package.json 运行时字段（scripts/dependencies）变化：退化全量', () => {
  const r = scope([{ status: 'M', path: 'package.json' }], { packageJsonRuntimeFields: ['scripts'] })
  assert.equal(r.escalated, true)
  assert.match(r.reasons.join('\n'), /package\.json/)
})

test('package.json 无法判定（字段信息为 null）：按退化处理', () => {
  assert.equal(scope([{ status: 'M', path: 'package.json' }], { packageJsonRuntimeFields: null }).escalated, true)
})

test('仓库根其它文件（README/AGENTS）变更：退化全量', () => {
  assert.equal(scope([{ status: 'M', path: 'package.json.bak' }]).escalated, true)
})

test('changed 为 null（git diff 失败）：退化全量', () => {
  const r = computeImpactScope(null, { plugins: PLUGINS, dependentsOf: dependents({}) })
  assert.equal(r.escalated, true)
  assert.match(r.reasons.join('\n'), /无法获取变更文件列表/)
})

test('空变更集：不退化、不误判为纯文档（changed=[] 走「无变更证据」之外的安全路径）', () => {
  const r = scope([])
  assert.equal(r.escalated, false)
  assert.equal(r.docsOnly, false)
  assert.equal(r.plugins.size, 0)
})

// ── diffPackageJsonRuntimeFields ───────────────────────────────────────────
test('diffPackageJsonRuntimeFields：元数据字段变化不计入运行时字段', () => {
  const before = JSON.stringify({ name: 'x', description: 'a', keywords: ['a'], scripts: { test: 'a' } })
  const after = JSON.stringify({ name: 'x', description: 'b', keywords: ['a', 'b'], scripts: { test: 'a' } })
  assert.deepEqual(diffPackageJsonRuntimeFields(before, after), [])
})

test('diffPackageJsonRuntimeFields：dependencies/scripts/engines 变化逐项列出', () => {
  const before = JSON.stringify({ scripts: { test: 'a' }, engines: { node: '>=20' } })
  const after = JSON.stringify({ scripts: { test: 'b' }, engines: { node: '>=22' }, dependencies: { x: '1' } })
  assert.deepEqual(diffPackageJsonRuntimeFields(before, after), ['dependencies', 'engines', 'scripts'])
})

test('diffPackageJsonRuntimeFields：JSON 非法/非对象返回 null（调用方按退化处理）', () => {
  assert.equal(diffPackageJsonRuntimeFields('{oops', '{}'), null)
  assert.equal(diffPackageJsonRuntimeFields('null', '{}'), null)
  assert.equal(diffPackageJsonRuntimeFields('[1]', '{}'), null)
  assert.equal(diffPackageJsonRuntimeFields('{}', '[1]'), null)
})
