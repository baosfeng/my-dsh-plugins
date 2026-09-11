import { test } from 'vitest'
/**
 * Tests for the startup-roster static pre-check (issue #144):
 *   - collectTreeEntries / entryLabels / isDisabledEntry tolerances
 *   - checkStartupRoster against a temp profile node_modules:
 *     unresolvable package, missing peer, duplicate id, non-dsh-* skip
 *   - host integration through apply(): report file written, snapshot
 *     carries the issues, boot is never blocked by the pre-check
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectTreeEntries,
  entryLabels,
  isDisabledEntry,
  checkStartupRoster,
  normalizeRoster,
  runStartupCheck,
} from '../lib/startup-check.js'
import { apply } from '../lib/index.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-my-guardian-startup-'))
process.env.DSH_HOME = dir
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const issuesFile = () => join(dir, 'guardian', 'startup-issues.json')
const readIssuesFile = () => JSON.parse(readFileSync(issuesFile(), 'utf8'))

/** npm-layout helper: write a package (with optional peer deps) into the
 *  profile node_modules. */
function writePkg(name, { version = '1.0.0', peers = {}, peersMeta = {} } = {}) {
  const pkgDir = join(dir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  const pkg = { name, version }
  if (Object.keys(peers).length > 0) pkg.peerDependencies = peers
  if (Object.keys(peersMeta).length > 0) pkg.peerDependenciesMeta = peersMeta
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pkg), 'utf8')
}

test('collectTreeEntries reads real-style trees (entries()) and mock trees (store walk)', () => {
  // Real EntryTree.entries() is a generator that ALREADY recurses into nested
  // subtrees, so collectTreeEntries trusts it and must not recurse again.
  const tree = {
    entries: function* () {
      yield { options: { id: 'a', name: 'dsh-a' } }
      yield { options: { id: 'b', name: 'dsh-b' } }
    },
  }
  const fromEntries = collectTreeEntries(tree)
  assert.deepEqual(
    fromEntries.map((e) => e.options.id),
    ['a', 'b'],
    'entries() used as-is (real trees recurse in their own entries())',
  )

  const store = { x: { id: 'x', options: { id: 'x', name: 'dsh-x' } }, y: { options: {} } }
  const mockTree = { filename: join(dir, 'cordis.yml'), store }
  const fromStore = collectTreeEntries(mockTree)
  assert.equal(fromStore.length, 2, 'store walk used when entries() is absent')
  assert.ok(typeof mockTree.entries !== 'function', 'precondition: mock tree has no entries()')
})

test('collectTreeEntries never throws on broken trees', () => {
  assert.deepEqual(collectTreeEntries(null), [])
  assert.deepEqual(collectTreeEntries(undefined), [])
  assert.deepEqual(collectTreeEntries(42), [])
  const broken = {
    entries: () => {
      throw new Error('boom')
    },
    store: null,
  }
  assert.deepEqual(collectTreeEntries(broken), [], 'throw inside entries() degrades to store walk')
})

test('entryLabels falls back safely', () => {
  assert.deepEqual(entryLabels({ options: { id: 'a', name: 'dsh-a' } }), { id: 'a', name: 'dsh-a' })
  assert.deepEqual(entryLabels({ options: { name: 'dsh-only' } }), { id: '', name: 'dsh-only' })
  assert.deepEqual(entryLabels({ options: { id: 'only-id' } }), { id: 'only-id', name: 'only-id' })
  assert.deepEqual(entryLabels({ options: {} }), { id: '', name: '?' })
  assert.deepEqual(entryLabels(null), { id: '', name: '?' })
  const throwing = {
    options: {},
    get id() {
      throw new Error('getter not ready')
    },
  }
  assert.deepEqual(entryLabels(throwing), { id: '', name: '?' }, 'entry.id getter throw is swallowed')
})

test('isDisabledEntry sees both entry.disabled and options.disabled', () => {
  assert.equal(isDisabledEntry({ disabled: true, options: {} }), true)
  assert.equal(isDisabledEntry({ options: { disabled: true } }), true)
  assert.equal(isDisabledEntry({ options: { id: 'x' } }), false)
  assert.equal(isDisabledEntry(null), false)
})

// ── checkStartupRoster (pure) ────────────────────────────────────────────

test('unresolvable dsh-* roster entry produces an unresolvable issue', () => {
  const { issues } = checkStartupRoster({
    entries: [{ id: 'ghost', name: 'dsh-ghost', disabled: false }],
    profileDir: dir,
  })
  assert.equal(issues.length, 1)
  const issue = issues[0]
  assert.equal(issue.type, 'unresolvable')
  assert.equal(issue.entryId, 'ghost')
  assert.ok(issue.message.includes('dsh-ghost'), 'message names the package')
  assert.equal(issue.fix, 'dsh plugin add dsh-ghost', 'repair command provided')
  assert.ok(issue.remove.length > 0, 'removal hint provided')
})

test('missing peer dependency produces a dependency issue with install hint', () => {
  writePkg('dsh-needy', { peers: { 'dsh-shared': '^0.1.0' } })
  const { issues } = checkStartupRoster({
    entries: [{ id: 'needy', name: 'dsh-needy', disabled: false }],
    profileDir: dir,
  })
  assert.equal(issues.length, 1)
  const issue = issues[0]
  assert.equal(issue.type, 'dependency')
  assert.ok(issue.message.includes('缺少依赖 dsh-shared'), 'message mentions the missing dep')
  assert.equal(issue.fix, 'dsh plugin add dsh-shared', 'install hint as fix command')
  assert.deepEqual(issue.missingDeps, ['dsh-shared'])
})

test('healthy dsh-* entry and non-dsh-* entries produce no issues', () => {
  writePkg('dsh-healthy', { version: '0.1.0' })
  writePkg('dsh-cordis-dep', { version: '0.1.0', peers: { cordis: '^4.0.0' } })
  writePkg('cordis', { version: '4.0.1' })
  const { issues } = checkStartupRoster({
    entries: [
      { id: 'h', name: 'dsh-healthy', disabled: false },
      { id: 'c', name: 'dsh-cordis-dep', disabled: false },
      { id: 'plain', name: 'some-lib', disabled: false },
      { id: 'scoped', name: '@deepseek-ai/dsh-bundles', disabled: false },
    ],
    profileDir: dir,
  })
  assert.deepEqual(issues, [], 'no issues for resolvable dsh-* with satisfied peers, nor non-dsh-* entries')
})

test('duplicate entry ids produce one duplicate-id issue per id', () => {
  const { issues } = checkStartupRoster({
    entries: [
      { id: 'dup', name: 'dsh-first', disabled: false },
      { id: 'dup', name: 'dsh-second', disabled: false },
      { id: 'single', name: 'dsh-one', disabled: false },
    ],
    profileDir: dir,
  })
  const dup = issues.filter((issue) => issue.type === 'duplicate-id')
  assert.equal(dup.length, 1, 'one duplicate-id issue for the repeated id')
  assert.equal(dup[0].entryId, 'dup')
  assert.ok(dup[0].message.includes('2 处'), 'message counts occurrences')
  assert.ok(dup[0].message.includes('dsh-first') && dup[0].message.includes('dsh-second'), 'names both rows')
})

test('normalizeRoster carries disabled flags through', () => {
  const roster = normalizeRoster([
    { options: { id: 'a', name: 'dsh-a' } },
    { disabled: true, options: { id: 'b', name: 'dsh-b' } },
  ])
  assert.deepEqual(roster, [
    { id: 'a', name: 'dsh-a', disabled: false },
    { id: 'b', name: 'dsh-b', disabled: true },
  ])
})

// ── host integration (through apply) ─────────────────────────────────────

/** Fake loader tree: root group with a mutable failure map (smoke-style). */
function makeLoaderAndTree() {
  const store = {}
  const failMap = {}
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
  return {
    store,
    failMap,
    created,
    removed,
    tree,
    loader: { entries: () => [{ subtree: tree }] },
    apiRoute: undefined,
  }
}

function makeCtx(fake) {
  const services = {
    webServer: {
      register: (route) => {
        if (route.kind === 'prefix' && route.path === '/guardian/api') fake.apiRoute = route
        return () => {}
      },
    },
    webRuntime: { trustedHosts: [] },
  }
  const effects = []
  const ctx = {
    logger: { warn: () => {} },
    loader: fake.loader,
    timer: {
      interval: () => () => {},
    },
    get(name) {
      return services[name]
    },
    on() {},
    effect(callback, label) {
      const disposer = callback()
      effects.push({ label, disposer })
      return disposer
    },
  }
  ctx.fakeEffects = effects
  return ctx
}

/** Reset persisted guardian state so one host test cannot leak events into
 *  the next (all tests share one DSH_HOME). */
function resetState() {
  mkdirSync(join(dir, 'guardian'), { recursive: true })
  writeFileSync(
    join(dir, 'guardian', 'state.json'),
    JSON.stringify({ version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }),
    'utf8',
  )
}

/** Minimal HTTP response mock (writeJson uses writeHead + end). */
function makeResponse() {
  return {
    _status: 0,
    _body: '',
    writeHead(status) {
      this._status = status
    },
    end(body) {
      this._body = body ?? ''
    },
  }
}

async function shutdown(ctx) {
  const teardown = (ctx.fakeEffects ?? []).find((e) => e.label === 'dsh-my-guardian: teardown')
  // await disposer（卸载 + 写链 drain）而不是 sleep 赌写盘跑完：赌输时旧实例的
  // 延迟快照会覆盖下一个用例块写入的 state.json（CI flaky 根因）。
  await teardown?.disposer()
}

test('host: startup pre-check writes the report and never blocks staged mounts', async () => {
  // roster row "needy" (dsh-my-guardian-style row in the tree store) + a
  // healthy staged candidate; the pre-check must flag the roster problem
  // while staged loading still proceeds normally.
  resetState()
  const fake = makeLoaderAndTree()
  fake.store['needy'] = { options: { id: 'needy', name: 'dsh-needy' } }
  writePkg('dsh-needy', { peers: { 'dsh-shared': '^0.1.0' } })
  writeFileSync(join(dir, 'cordis.staged.json'), JSON.stringify([{ id: 'ok', name: 'dsh-ok' }], null, 2), 'utf8')
  writePkg('dsh-ok', { version: '0.1.0' })
  const ctx = makeCtx(fake)
  apply(ctx)
  await sleep(250)

  // staged candidate still mounted: the pre-check must not block the boot
  assert.deepEqual(fake.created, ['ok'], 'staged entry mounted despite roster issue')

  const report = readIssuesFile()
  assert.equal(report.version, 1)
  assert.equal(report.profileDir, dir)
  assert.equal(report.issues.length, 1, 'report carries the dependency issue')
  assert.equal(report.issues[0].type, 'dependency')
  assert.equal(report.issues[0].fix, 'dsh plugin add dsh-shared')

  const state = JSON.parse(readFileSync(join(dir, 'guardian', 'state.json'), 'utf8'))
  assert.ok(
    state.events.some((e) => e.type === 'startup-issue'),
    'startup-issue event logged',
  )

  const route = fake.apiRoute
  const res = makeResponse()
  await route.handler(
    {
      method: 'GET',
      url: '/guardian/api/state',
      headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3080' },
      [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true }) }),
    },
    res,
  )
  const snapshot = JSON.parse(res._body).value
  assert.equal(snapshot.startupIssues.length, 1, 'snapshot carries startupIssues')
  assert.equal(snapshot.startupIssues[0].type, 'dependency')
  assert.ok(typeof snapshot.startupCheckedAt === 'number', 'snapshot carries startupCheckedAt')
  await shutdown(ctx)
})

test('host: healthy roster writes an empty report and logs nothing', async () => {
  resetState()
  writePkg('dsh-happy', { version: '0.1.0' })
  const fake = makeLoaderAndTree()
  fake.store['happy'] = { options: { id: 'happy', name: 'dsh-happy' } }
  writeFileSync(join(dir, 'cordis.staged.json'), '[]\n', 'utf8')
  const ctx = makeCtx(fake)
  apply(ctx)
  await sleep(250)

  const report = readIssuesFile()
  assert.deepEqual(report.issues, [], 'healthy roster → empty issues')
  const state = JSON.parse(readFileSync(join(dir, 'guardian', 'state.json'), 'utf8'))
  assert.ok(!state.events.some((e) => e.type === 'startup-issue'), 'no startup-issue event when healthy')
  await shutdown(ctx)
})

test('runStartupCheck itself never throws (broken tree / bad profile dir)', async () => {
  const fake = makeLoaderAndTree()
  const ctx = makeCtx(fake)
  const shared = {
    tree: {
      entries: () => {
        throw new Error('broken loader tree')
      },
      store: null,
    },
    profileDir: dir,
    startupIssues: [],
    startupCheckedAt: null,
    persistSoon: () => {},
  }
  await runStartupCheck(ctx, shared)
  assert.deepEqual(shared.startupIssues, [], 'broken tree degrades to an empty report')
  // a profile dir that cannot be resolved must not throw either
  await runStartupCheck(ctx, { ...shared, profileDir: join(dir, 'no-such-profile') })
})

test('apply survives a broken loader tree plus a staged candidate (pre-check cannot block boot)', async () => {
  const fake = makeLoaderAndTree()
  fake.loader.entries = () => {
    throw new Error('broken loader tree')
  }
  writeFileSync(join(dir, 'cordis.staged.json'), '[]\n', 'utf8')
  const ctx = makeCtx(fake)
  let threw = false
  try {
    apply(ctx)
  } catch {
    threw = true
  }
  assert.equal(threw, false, 'apply must not throw on a broken loader tree')
  await sleep(150)
  await shutdown(ctx)
})

console.log('ALL GUARDIAN STARTUP-CHECK TESTS PASSED')
