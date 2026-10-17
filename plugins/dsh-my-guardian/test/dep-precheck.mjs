/**
 * Dependency pre-check tests for dsh-my-guardian (issue #86).
 *
 * Two layers:
 *  1. Pure unit tests for the semver range matcher, the peerDependency
 *     pre-check and the failure classification — no I/O beyond temp package
 *     fixtures, no guardian boot.
 *  2. Integration tests that boot the guardian against a mocked loader tree
 *     and assert the isolation record carries failureType 'dependency' (with
 *     the missing deps + install suggestion) and the mount is skipped.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { satisfies } from '../lib/dep-version.js'
import {
  basePackage,
  checkPeerDependencies,
  buildDependencyMessage,
  classifyFailure,
  dependencyFailureType,
  isHostProvided,
} from '../lib/dep-precheck.js'
import { apply } from '../lib/index.js'

const createdDirs = []
function freshDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-guardian-dep-' }).name
  createdDirs.push(dir)
  return dir
}

// ── unit: version range matching ────────────────────────────────────────────
test('semver satisfies: caret / tilde / comparator / wildcard / OR', () => {
  const cases = [
    ['18.3.1', '^18.2.0', true],
    ['17.0.0', '^18.2.0', false],
    ['4.0.0-rc.9', '^4.0.0-rc.8', true],
    ['3.5.0', '^4.0.0-rc.8', false],
    ['0.17.0', '>=0.14.0 <0.18.0', true],
    ['0.19.0', '>=0.14.0 <0.18.0', false],
    ['0.1.5', '^0.1.0', true],
    ['0.2.0', '^0.1.0', false],
    ['1.0.0', '*', true],
    ['1.0.0', '', true],
    ['1.0.0', '>=1.0.0', true],
    ['0.9.0', '>=1.0.0', false],
    ['18.3.1', '^18.2.0 || ^19.2.0', true],
    ['19.2.0', '^18.2.0 || ^19.2.0', true],
    ['20.0.0', '^18.2.0 || ^19.2.0', false],
    ['1.2.3', '~1.2.0', true],
    ['1.3.0', '~1.2.0', false],
    ['1.2.3', '1.2.x', true],
    ['1.3.0', '1.2.x', false],
  ]
  for (const [version, range, expected] of cases) {
    assert.equal(satisfies(version, range), expected, `${version} satisfies ${range}`)
  }
})

test('semver satisfies: prerelease only matches a prerelease range', () => {
  assert.equal(satisfies('18.3.1-beta.1', '^18.2.0'), false, 'prerelease is opt-in')
  assert.equal(satisfies('4.0.0-rc.9', '^4.0.0-rc.8'), true, 'prerelease range matches prerelease')
})

// ── unit: dependency pre-check ──────────────────────────────────────────────
test('precheck: satisfied dependency is ok', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-app', { peerDependencies: { react: '^18.2.0' } })
  writeDep(dir, 'react', '18.3.1')
  const result = checkPeerDependencies({ profileDir: dir, pluginName: 'dsh-app' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.mismatched, [])
})

test('precheck: missing required dependency fails with an install suggestion', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-app', { peerDependencies: { 'dsh-shared': '^0.1.0' } })
  const result = checkPeerDependencies({ profileDir: dir, pluginName: 'dsh-app' })
  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, ['dsh-shared'])
  assert.deepEqual(result.suggestions, ['dsh plugin add dsh-shared'])
})

test('precheck: version outside the range fails and is not reported as missing (#410)', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-app', { peerDependencies: { 'dsh-shared': '^0.1.8' } })
  writeDep(dir, 'dsh-shared', '0.2.0')
  const result = checkPeerDependencies({ profileDir: dir, pluginName: 'dsh-app' })
  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, [], 'installed-but-wrong-version is a mismatch, never missing')
  assert.equal(result.mismatched.length, 1)
  assert.equal(result.mismatched[0].name, 'dsh-shared')
  assert.equal(result.mismatched[0].expected, '^0.1.8')
  assert.equal(result.mismatched[0].found, '0.2.0')
  assert.deepEqual(result.suggestions, ['dsh plugin add dsh-shared@^0.1.8'])
})

// ── #410: 出口层把 missing / mismatch 分开，宿主提供的包不给安装建议 ────────
test('#410: host-provided peer mismatch gets its own sentence and no install command', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-pet', { peerDependencies: { react: '^18.2.0' } })
  writeDep(dir, 'react', '19.3.0')
  const result = checkPeerDependencies({ profileDir: dir, pluginName: 'dsh-pet' })
  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, [], 'react 19.3.0 is installed — it must not show up as missing')
  assert.deepEqual(result.mismatched, [{ name: 'react', expected: '^18.2.0', found: '19.3.0' }])
  assert.deepEqual(result.suggestions, [], 'host-provided react: a dsh plugin add hint would install a second copy')
  const message = buildDependencyMessage(result)
  assert.ok(!message.includes('缺少依赖'), `mismatch must not reuse the missing wording: ${message}`)
  assert.equal(message, '依赖版本不满足 react：声明 ^18.2.0，当前 19.3.0（宿主提供，无需安装）')
})

test('#410: host-provided peer miss gets no install command either', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-pet', { peerDependencies: { '@deepseek-ai/dsh-llm': '^0.1.5-rc.1' } })
  const result = checkPeerDependencies({ profileDir: dir, pluginName: 'dsh-pet' })
  assert.deepEqual(result.missing, ['@deepseek-ai/dsh-llm'])
  assert.deepEqual(result.mismatched, [])
  assert.deepEqual(result.suggestions, [], 'a @deepseek-ai/* peer must never be installed into the profile (#407)')
  assert.ok(!buildDependencyMessage(result).includes('dsh plugin add'), 'no install wording for host packages')
})

test('#410: a range with spaces or pipes never becomes an unexecutable command', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-mermaid-render', { peerDependencies: { 'dsh-shared': '^0.1.0 || ^0.2.0' } })
  writeDep(dir, 'dsh-shared', '0.3.0')
  const result = checkPeerDependencies({ profileDir: dir, pluginName: 'dsh-mermaid-render' })
  assert.equal(result.mismatched.length, 1)
  assert.deepEqual(result.suggestions, [], "'dsh plugin add x@^0.1.0 || ^0.2.0' cannot be executed — emit nothing")
})

test('isHostProvided covers @deepseek-ai/*, react / react-dom and their subpaths', () => {
  assert.equal(isHostProvided('@deepseek-ai/dsh-llm'), true)
  assert.equal(isHostProvided('@deepseek-ai/dsh-tools/sub'), true)
  assert.equal(isHostProvided('react'), true)
  assert.equal(isHostProvided('react-dom'), true)
  assert.equal(isHostProvided('dsh-shared'), false)
  assert.equal(isHostProvided('dsh-md-render'), false)
})

test('#410: dependencyFailureType splits the mount-failure badge', () => {
  assert.equal(dependencyFailureType({ missing: ['dsh-shared'], mismatched: [] }), 'dependency-missing')
  assert.equal(
    dependencyFailureType({ missing: [], mismatched: [{ name: 'react', expected: '^18.2.0', found: '19.3.0' }] }),
    'dependency-mismatch',
  )
  assert.equal(
    dependencyFailureType({ missing: ['a'], mismatched: [{ name: 'b', expected: '^1.0.0', found: '2.0.0' }] }),
    'dependency-missing',
    'both present → the hard miss wins the single badge',
  )
})

test('precheck: optional missing dependency does not block', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-app', {
    peerDependencies: { cordis: '^4.0.0-rc.8' },
    peerDependenciesMeta: { cordis: { optional: true } },
  })
  const result = checkPeerDependencies({ profileDir: dir, pluginName: 'dsh-app' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.missing, [])
  assert.equal(result.warnings.length, 1)
})

test('precheck: missing plugin package.json is skipped, not blocked', () => {
  const dir = freshDir()
  const result = checkPeerDependencies({ profileDir: dir, pluginName: 'dsh-ghost' })
  assert.equal(result.ok, true)
  assert.equal(result.warnings.length, 1)
})

// ── unit: host-provided packages + subpath specifiers ───────────────────────
test('basePackage reduces subpath specifiers to their package root', () => {
  assert.equal(basePackage('dsh-shared'), 'dsh-shared')
  assert.equal(basePackage('@deepseek-ai/dsh-tools'), '@deepseek-ai/dsh-tools')
  assert.equal(basePackage('dsh-openwrite/bridge'), 'dsh-openwrite')
  assert.equal(basePackage('@deepseek-ai/dsh-tools/sub'), '@deepseek-ai/dsh-tools')
})

test('precheck: a peer installed in the profiles-root node_modules resolves', () => {
  const root = freshDir()
  const profileDir = join(root, 'profiles', 'web')
  writePlugin(profileDir, 'dsh-app', { peerDependencies: { '@deepseek-ai/dsh-tools': '^0.1.5-rc.1' } })
  writeDep(join(root, 'profiles'), '@deepseek-ai/dsh-tools', '0.1.5-rc.3')
  const result = checkPeerDependencies({ profileDir, pluginName: 'dsh-app' })
  assert.equal(result.ok, true, 'the host fallback root counts as installed')
  assert.deepEqual(result.missing, [])
})

test('precheck: a subpath plugin name resolves through its base package', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-openwrite', { peerDependencies: { react: '^18.2.0' } })
  writeDep(dir, 'react', '18.3.1')
  const result = checkPeerDependencies({ profileDir: dir, pluginName: 'dsh-openwrite/bridge' })
  assert.equal(result.ok, true)
})

test('#410: buildDependencyMessage renders missing and mismatch as separate sentences', () => {
  assert.equal(buildDependencyMessage({ missing: ['dsh-shared'], mismatched: [] }), '缺少依赖 dsh-shared（请先安装）')
  assert.equal(
    buildDependencyMessage({
      missing: ['a', 'b'],
      mismatched: [{ name: 'c', expected: '^1.0.0', found: '2.0.0' }],
    }),
    '缺少依赖 a（请先安装）；缺少依赖 b（请先安装）；依赖版本不满足 c：声明 ^1.0.0，当前 2.0.0',
  )
  assert.equal(buildDependencyMessage({ missing: [], mismatched: [] }), '依赖预检失败')
})

test('classifyFailure maps module / conflict / runtime errors', () => {
  assert.equal(classifyFailure(new Error("Cannot find module 'dsh-shared'")), 'dependency')
  assert.equal(classifyFailure(new Error('MODULE_NOT_FOUND')), 'dependency')
  assert.equal(classifyFailure(new Error('loader entry id "x" already exists')), 'other')
  assert.equal(classifyFailure(new Error('apply exploded')), 'code')
  assert.equal(classifyFailure('apply exploded'), 'code')
})

// ── integration: boot the guardian ─────────────────────────────────────────
function makeFake(dir, failMap = {}) {
  const store = {}
  const created = []
  const removed = []
  const root = {
    create: async (options) => {
      const id = options.id
      if (failMap[id]) throw new Error(failMap[id])
      if (store[id]) throw new Error(`duplicate loader entry id: ${id}`)
      store[id] = { id, options }
      created.push(id)
    },
    remove: async (id) => {
      delete store[id]
      removed.push(id)
    },
  }
  const tree = { filename: join(dir, 'cordis.yml'), store, root }
  return { store, created, removed, tree, loader: { entries: () => [{ subtree: tree }] }, apiRoute: undefined }
}

function boot(fake) {
  const effects = []
  const ctx = {
    logger: { warn: () => {} },
    loader: fake.loader,
    timer: { interval: (_callback) => () => {} },
    get: () => undefined,
    on() {},
    effect(callback, label) {
      const disposer = callback()
      effects.push({ label, disposer })
      return disposer
    },
  }
  ctx.fakeEffects = effects
  apply(ctx)
  return ctx
}

async function shutdown(ctx) {
  const teardown = (ctx.fakeEffects ?? []).find((e) => e.label === 'dsh-my-guardian: teardown')
  // #217: disposer 会等本实例启动路径 settle 再 drain 写链，await 它即可——
  // 此前 fire-and-forget + sleep(60) 是在赌写盘跑完。
  await teardown?.disposer()
}

function readState(dir) {
  return JSON.parse(readFileSync(join(dir, 'guardian', 'state.json'), 'utf8'))
}

const readStateOrNull = (dir) => {
  try {
    return readState(dir)
  } catch {
    return undefined
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询等待异步结果**出现**（#217：不再用固定 sleep 赌启动/落盘跑完）。 */
async function waitFor(check, timeoutMs = 10000, intervalMs = 10) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (check()) return
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await sleep(intervalMs)
  }
}

test('mount is skipped and quarantine records a dependency failure', async () => {
  const dir = freshDir()
  process.env.DSH_HOME = dir
  writePlugin(dir, 'dsh-bad', { peerDependencies: { 'dsh-shared': '^0.1.0' } })
  writeFileSync(join(dir, 'cordis.staged.json'), JSON.stringify([{ id: 'dsh-bad', name: 'dsh-bad' }], null, 2))
  const fake = makeFake(dir)
  const ctx = boot(fake)
  await waitFor(() => readStateOrNull(dir)?.staged?.['dsh-bad'] !== undefined)

  const state = readState(dir)
  assert.ok(state.staged['dsh-bad'], 'entry kept in staged state')
  assert.equal(state.staged['dsh-bad'].attempts, 1, 'one attempt recorded')
  assert.equal(state.staged['dsh-bad'].failureType, 'dependency-missing', 'hard miss classified as dependency-missing')
  assert.ok(state.staged['dsh-bad'].lastError.includes('缺少依赖 dsh-shared'), 'message names the missing dep')
  assert.equal(state.staged['dsh-bad'].installHint, 'dsh plugin add dsh-shared', 'install suggestion recorded')
  assert.deepEqual(state.staged['dsh-bad'].missingDeps, ['dsh-shared'], 'deps listed')
  assert.deepEqual(state.staged['dsh-bad'].mismatchedDeps, [], 'no mismatches recorded')
  assert.deepEqual(fake.created, [], 'entry NOT mounted')
  await shutdown(ctx)
})

test('#410: a mismatched candidate records dependency-mismatch and no install hint for host packages', async () => {
  const dir = freshDir()
  process.env.DSH_HOME = dir
  writePlugin(dir, 'dsh-mismatch', { peerDependencies: { react: '^18.2.0' } })
  writeDep(dir, 'react', '19.3.0')
  writeFileSync(
    join(dir, 'cordis.staged.json'),
    JSON.stringify([{ id: 'dsh-mismatch', name: 'dsh-mismatch' }], null, 2),
  )
  const fake = makeFake(dir)
  const ctx = boot(fake)
  await waitFor(() => readStateOrNull(dir)?.staged?.['dsh-mismatch'] !== undefined)

  const record = readState(dir).staged['dsh-mismatch']
  assert.equal(record.failureType, 'dependency-mismatch', 'version mismatch has its own failure class')
  assert.deepEqual(record.missingDeps, [], 'an installed-but-wrong version is never listed as missing')
  assert.deepEqual(record.mismatchedDeps, [{ name: 'react', expected: '^18.2.0', found: '19.3.0' }])
  assert.equal(record.installHint, null, 'host-provided react must not be handed an install command')
  assert.equal(
    record.lastError,
    '依赖版本不满足 react：声明 ^18.2.0，当前 19.3.0（宿主提供，无需安装）',
    'the record keeps the mismatch wording, not the missing wording',
  )
  assert.deepEqual(fake.created, [], 'entry NOT mounted')
  await shutdown(ctx)
})

test('plugin whose peer deps are satisfied mounts normally', async () => {
  const dir = freshDir()
  process.env.DSH_HOME = dir
  writePlugin(dir, 'dsh-good', { peerDependencies: { react: '^18.2.0' } })
  writeDep(dir, 'react', '18.3.1')
  writeFileSync(join(dir, 'cordis.staged.json'), JSON.stringify([{ id: 'dsh-good', name: 'dsh-good' }], null, 2))
  const fake = makeFake(dir)
  const ctx = boot(fake)
  await waitFor(() => readStateOrNull(dir)?.promoted?.['dsh-good'] !== undefined)

  assert.deepEqual(fake.created, ['dsh-good'], 'entry mounted')
  const state = readState(dir)
  assert.ok(state.promoted['dsh-good'], 'entry promoted')
  await shutdown(ctx)
})

test('a mount-time code error is classified as code (precheck passed)', async () => {
  const dir = freshDir()
  process.env.DSH_HOME = dir
  writePlugin(dir, 'dsh-code', { peerDependencies: { react: '^18.2.0' } })
  writeDep(dir, 'react', '18.3.1')
  writeFileSync(join(dir, 'cordis.staged.json'), JSON.stringify([{ id: 'dsh-code', name: 'dsh-code' }], null, 2))
  const fake = makeFake(dir, { 'dsh-code': 'apply exploded' })
  const ctx = boot(fake)
  await waitFor(() => readStateOrNull(dir)?.staged?.['dsh-code'] !== undefined)

  const state = readState(dir)
  assert.equal(state.staged['dsh-code'].failureType, 'code', 'mount error classified as code')
  assert.ok(state.staged['dsh-code'].lastError.includes('apply exploded'), 'error recorded')
  assert.deepEqual(fake.created, [], 'code-failing entry not mounted')
  await shutdown(ctx)
})

afterAll(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true })
})

// fixture helpers: write a plugin or a dependency package.json below a dir
function writePlugin(dir, name, json) {
  const pkg = { name, ...json }
  mkdirSync(join(dir, 'node_modules', name), { recursive: true })
  writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify(pkg), 'utf8')
}

function writeDep(dir, name, version) {
  mkdirSync(join(dir, 'node_modules', name), { recursive: true })
  writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }), 'utf8')
}
