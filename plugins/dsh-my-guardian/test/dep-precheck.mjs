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
import { EMPTY_HOST_INVENTORY, loadHostInventory, resetHostInventoryCache } from '../lib/host-inventory.js'

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
  assert.deepEqual(result.mismatched, [{ name: 'react', expected: '^18.2.0', found: '19.3.0', source: 'host' }])
  assert.deepEqual(result.suggestions, [], 'host-provided react: a dsh plugin add hint would install a second copy')
  const message = buildDependencyMessage(result)
  assert.ok(!message.includes('缺少依赖'), `mismatch must not reuse the missing wording: ${message}`)
  assert.equal(
    message,
    '依赖版本不满足 react：声明 ^18.2.0，当前 19.3.0（由 DSH 宿主内置，请升级 DSH；装进 profile 只会遮蔽宿主版本）',
  )
})

test('#410: host-provided peer miss gets no install command either', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-pet', { peerDependencies: { '@deepseek-ai/dsh-llm': '^0.1.5-rc.1' } })
  // #503：显式注入「没有宿主清单」，用例不依赖运行机器上是否装了全局 dsh。
  const result = checkPeerDependencies({ profileDir: dir, pluginName: 'dsh-pet', hostInventory: EMPTY_HOST_INVENTORY })
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
  // #503：显式注入空宿主清单——否则机器上装了全局 dsh 时 cordis 会被宿主安装目录命中。
  const result = checkPeerDependencies({ profileDir: dir, pluginName: 'dsh-app', hostInventory: EMPTY_HOST_INVENTORY })
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
  assert.deepEqual(record.mismatchedDeps, [{ name: 'react', expected: '^18.2.0', found: '19.3.0', source: 'host' }])
  assert.equal(record.installHint, null, 'host-provided react must not be handed an install command')
  assert.equal(
    record.lastError,
    '依赖版本不满足 react：声明 ^18.2.0，当前 19.3.0（由 DSH 宿主内置，请升级 DSH；装进 profile 只会遮蔽宿主版本）',
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
// ── #481: 宿主内置包识别（桌面版把宿主依赖归档进 app.asar 后的误报）─────────
test('#481: 宿主清单命中的 @deepseek-ai/* 不再报缺失', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-app', { peerDependencies: { '@deepseek-ai/dsh-tools': '^0.5.0' } })
  const result = checkPeerDependencies({
    profileDir: dir,
    pluginName: 'dsh-app',
    hostInventory: hostInventoryOf({ '@deepseek-ai/dsh-tools': '0.5.0' }),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.suggestions, [], '宿主内置包不产出 dsh plugin add 命令')
})

test('#481: 裸名回退 cordis → @deepseek-ai/cordis（版本取自宿主清单）', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-app', { peerDependencies: { cordis: '^4.0.0' } })
  const result = checkPeerDependencies({
    profileDir: dir,
    pluginName: 'dsh-app',
    hostInventory: hostInventoryOf({ '@deepseek-ai/cordis': '4.0.4' }),
  })
  assert.equal(result.ok, true, '宿主以 @deepseek-ai/cordis 提供裸名 cordis')
})

test('#481: 客户端插件（dsh.client）的前端种子模块视为已满足', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-client-app', {
    dsh: { client: { platform: 'web' } },
    peerDependencies: {
      react: '^18.2.0',
      'react-dom': '^18.2.0',
      '@deepseek-ai/dsh-client-ui-primitives': '^1.0.0',
    },
  })
  const result = checkPeerDependencies({
    profileDir: dir,
    pluginName: 'dsh-client-app',
    hostInventory: EMPTY_HOST_INVENTORY,
  })
  assert.equal(result.ok, true, 'react / react-dom / client UI 包由宿主前端注入')
  assert.deepEqual(result.missing, [])
})

test('#488: 非客户端插件声明宿主前端注入模块也视为已满足（不再刷缺失）', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-server-app', { peerDependencies: { react: '^18.2.0' } })
  const result = checkPeerDependencies({
    profileDir: dir,
    pluginName: 'dsh-server-app',
    hostInventory: EMPTY_HOST_INVENTORY,
  })
  assert.equal(result.ok, true, '前端注入模块与 dsh.client 标记无关：磁盘/asar 都没有实体，判缺失只会刷屏')
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.suggestions, [], '不产出 dsh plugin add（装进 profile 只会遮蔽宿主版本）')
})

test('#488: 前端静态模块裸名回退 dsh-client-ui-primitives → @deepseek-ai/…', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-panel-app', {
    peerDependencies: {
      'dsh-client-ui-primitives': '^1.0.0',
      'dsh-client-ui-slots': '^1.0.0',
      'dsh-client-store': '^1.0.0',
    },
  })
  const result = checkPeerDependencies({
    profileDir: dir,
    pluginName: 'dsh-panel-app',
    hostInventory: EMPTY_HOST_INVENTORY,
  })
  assert.equal(result.ok, true, '社区插件把前端种子模块写成裸名，应回退 @deepseek-ai/<name> 判定')
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.suggestions, [], '裸名静态模块不得产出 dsh plugin add')
})

test('#481: 宿主内置包版本不满足只记警告（不阻塞、不刷 dependency 告警）', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-app', { peerDependencies: { cordis: '^5.0.0' } })
  const result = checkPeerDependencies({
    profileDir: dir,
    pluginName: 'dsh-app',
    hostInventory: hostInventoryOf({ '@deepseek-ai/cordis': '4.0.4' }),
  })
  assert.equal(result.ok, true, '宿主版本由 DSH 统一决定：装不了第二份，不能算依赖图有洞')
  assert.deepEqual(result.mismatched, [])
  assert.deepEqual(result.suggestions, [], '宿主内置包版本不满足时不给 dsh plugin add')
  assert.ok(
    result.warnings.some((warning) => warning.includes('宿主内置') && warning.includes('请升级 DSH')),
    '提示落在 warning 里（可见但不阻塞）',
  )
})

test('#481: files 清单覆盖的第三方包（无版本）视为已满足', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-app', { peerDependencies: { 'left-pad': '^1.0.0' } })
  const result = checkPeerDependencies({
    profileDir: dir,
    pluginName: 'dsh-app',
    hostInventory: hostInventoryOf({}, ['node_modules/left-pad/index.js']),
  })
  assert.equal(result.ok, true)
})

// ── #503: npm 全局 dsh web 形态（宿主安装目录供给，profiles 根没有 node_modules）─────
/** issue #503 复现里的 10 个服务端宿主 peer（dsh-better-sidebar@0.28.2）。 */
const HOST_PEERS_503 = {
  '@deepseek-ai/dsh-agent': '^0.2.1-rc.1',
  '@deepseek-ai/dsh-client-locale': '^0.2.1-rc.1',
  '@deepseek-ai/dsh-client-ui-conversation': '^0.2.1-rc.1',
  '@deepseek-ai/dsh-client-ui-settings': '^0.2.1-rc.1',
  '@deepseek-ai/dsh-host-webserver': '^0.2.1-rc.1',
  '@deepseek-ai/dsh-llm': '^0.2.1-rc.1',
  '@deepseek-ai/dsh-session': '^0.2.1-rc.1',
  '@deepseek-ai/dsh-settings': '^0.2.1-rc.1',
  '@deepseek-ai/dsh-subagent': '^0.2.1-rc.1',
  '@deepseek-ai/dsh-tools': '^0.2.1-rc.1',
}

/** #503 夹具：模拟 npm 全局安装 <prefix>/lib/node_modules/@deepseek-ai/dsh 的宿主树。 */
function writeHostInstall(packages) {
  const hostRoot = join(freshDir(), 'lib', 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(hostRoot, { recursive: true })
  writeFileSync(
    join(hostRoot, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.3' }),
    'utf8',
  )
  for (const [name, version] of Object.entries(packages)) {
    const dir = join(hostRoot, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }), 'utf8')
  }
  return hostRoot
}

test('#503: npm 全局 dsh web 的 10 个服务端宿主 peer 不再误报缺失', () => {
  const versions = Object.fromEntries(Object.keys(HOST_PEERS_503).map((name) => [name, '0.2.1-rc.3']))
  const hostRoot = writeHostInstall(versions)
  const profileDir = join(freshDir(), 'profiles', 'web')
  writePlugin(profileDir, 'dsh-better-sidebar', { peerDependencies: HOST_PEERS_503 })
  // 复现里的 profile：只有 cosmokit / schemastery，profiles 根根本没有 node_modules。
  writeDep(profileDir, '@deepseek-ai/cosmokit', '0.5.0')
  writeDep(profileDir, '@deepseek-ai/schemastery', '2.0.0')
  resetHostInventoryCache()
  const result = checkPeerDependencies({
    profileDir,
    pluginName: 'dsh-better-sidebar',
    hostInventory: loadHostInventory({ hostRoot }),
  })
  assert.equal(result.ok, true, '宿主安装目录里的服务器宿主包版本满足 → 预检通过')
  assert.deepEqual(result.missing, [], 'issues: [] —— 不再刷 dependency-missing')
  assert.deepEqual(result.missingHostNamespace, [])
  assert.deepEqual(result.mismatched, [])
  assert.deepEqual(result.suggestions, [])
  assert.deepEqual(result.warnings, [])
})

test('#503: 宿主安装目录里的包版本不满足只记警告（用户装不了第二份）', () => {
  const hostRoot = writeHostInstall({ '@deepseek-ai/dsh-agent': '0.2.1-rc.3' })
  const dir = freshDir()
  writePlugin(dir, 'dsh-pet', { peerDependencies: { '@deepseek-ai/dsh-agent': '^0.2.1-rc.5' } })
  resetHostInventoryCache()
  const result = checkPeerDependencies({
    profileDir: dir,
    pluginName: 'dsh-pet',
    hostInventory: loadHostInventory({ hostRoot }),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.mismatched, [], '宿主内置包的版本不满足延续 #481 的 warning 语义')
  assert.deepEqual(result.suggestions, [])
  assert.ok(
    result.warnings.some((warning) => warning.includes('宿主内置') && warning.includes('0.2.1-rc.3')),
    result.warnings.join('；'),
  )
})

test('#503: 宿主命名空间的包没有任何证据命中时，文案与判定同源（不再说「无需安装」）', () => {
  const dir = freshDir()
  writePlugin(dir, 'dsh-needy', { peerDependencies: { '@deepseek-ai/dsh-ghost': '^0.2.1' } })
  const result = checkPeerDependencies({
    profileDir: dir,
    pluginName: 'dsh-needy',
    hostInventory: EMPTY_HOST_INVENTORY,
  })
  assert.deepEqual(result.missing, ['@deepseek-ai/dsh-ghost'])
  assert.deepEqual(
    result.missingHostNamespace,
    ['@deepseek-ai/dsh-ghost'],
    '缺失项带上「宿主命名空间」标注，文案据此成句（不再从包名前缀反推）',
  )
  assert.deepEqual(result.suggestions, [], '宿主命名空间的包不给安装命令')
  const message = buildDependencyMessage(result)
  assert.ok(message.includes('缺少依赖 @deepseek-ai/dsh-ghost'), message)
  assert.ok(!message.includes('无需安装'), `判定是缺失，文案不得反过来说「无需安装」：${message}`)
  assert.ok(!message.includes('dsh plugin add'), message)
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

// #481: 宿主清单夹具（临时 desktop-runtime.json → HostInventory）。
function hostInventoryOf(shared = {}, files = []) {
  const dir = freshDir()
  const path = join(dir, 'desktop-runtime.json')
  const sharedPackages = Object.entries(shared).map(([name, version]) => ({ name, version }))
  writeFileSync(path, JSON.stringify({ sharedPackages, files: files.map((entry) => ({ path: entry })) }), 'utf8')
  resetHostInventoryCache()
  return loadHostInventory({ runtimeJsonPath: path })
}
