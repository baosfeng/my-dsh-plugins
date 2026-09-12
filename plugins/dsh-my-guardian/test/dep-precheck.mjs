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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { satisfies } from '../lib/dep-version.js'
import { checkPeerDependencies, buildDependencyMessage, classifyFailure } from '../lib/dep-precheck.js'
import { apply } from '../lib/index.js'

const createdDirs = []
function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-guardian-dep-'))
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

test('precheck: version outside the range fails', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-app', { peerDependencies: { react: '^18.2.0' } })
  writeDep(dir, 'react', '17.0.0')
  const result = checkPeerDependencies({ profileDir: dir, pluginName: 'dsh-app' })
  assert.equal(result.ok, false)
  assert.equal(result.mismatched.length, 1)
  assert.equal(result.mismatched[0].name, 'react')
  assert.equal(result.mismatched[0].expected, '^18.2.0')
  assert.equal(result.mismatched[0].found, '17.0.0')
  assert.deepEqual(result.suggestions, ['dsh plugin add react@^18.2.0'])
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

test('buildDependencyMessage lists every problem dependency', () => {
  assert.equal(buildDependencyMessage({ missing: ['dsh-shared'], mismatched: [] }), '缺少依赖 dsh-shared（请先安装）')
  assert.equal(
    buildDependencyMessage({ missing: ['a', 'b'], mismatched: [{ name: 'c' }] }),
    '缺少依赖 a（请先安装）；缺少依赖 b（请先安装）；缺少依赖 c（请先安装）',
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
  assert.equal(state.staged['dsh-bad'].failureType, 'dependency', 'failures classified as dependency')
  assert.ok(state.staged['dsh-bad'].lastError.includes('缺少依赖 dsh-shared'), 'message names the missing dep')
  assert.equal(state.staged['dsh-bad'].installHint, 'dsh plugin add dsh-shared', 'install suggestion recorded')
  assert.deepEqual(state.staged['dsh-bad'].missingDeps, ['dsh-shared'], 'deps listed')
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
