/**
 * dsh-my-guardian — the mount pipeline: find the profile include tree, mount
 * staged/promoted entries through its root group (no tree write-back, no
 * cordis.yml touch), fold outcomes into the persisted state.
 *
 * All functions take the shared runtime context (see src/index.ts): state,
 * attempted/mounted sets, tree and staged file paths.
 */
import { dirname } from 'node:path'
import { FREEZE_LIMIT, errorSnip, loadState, readStagedFile, writeStagedFile } from './state.js'
import type { SharedContext, EntryRecord } from './state.js'
import { logEvent } from './events.js'
import { checkPeerDependencies, buildDependencyMessage, classifyFailure } from './dep-precheck.js'
import type { PrecheckResult } from './dep-precheck.js'
import type { LoaderTree, LoaderService } from './types.js'

interface RootTree {
  tree: LoaderTree
  profileDir: string
}

interface StagedEntry {
  id?: string
  name?: string
  config?: unknown
}

/**
 * Find the root Include tree of the profile. The loader tree's entries carry
 * nested subtrees; the profile root include is the one whose config file is
 * named cordis.yml (fallback: the first include-like tree found).
 * Returns { tree, profileDir } or null when nothing usable exists.
 */
export function findRootTree(loader: LoaderService): RootTree | null {
  try {
    for (const entry of loader.entries()) {
      const tree = entry.subtree
      if (tree === undefined || typeof tree.filename !== 'string') continue
      const base = tree.filename.split(/[\\/]/).pop() ?? ''
      if (base === 'cordis.yml') return { tree, profileDir: dirname(tree.filename) }
    }
    for (const entry of loader.entries()) {
      const tree = entry.subtree
      if (tree === undefined || typeof tree.filename !== 'string') continue
      return { tree, profileDir: dirname(tree.filename) }
    }
  } catch {
    // broken loader tree: degrade
  }
  return null
}

/** Bind the mount operations to one guardian instance's shared state. */
export function createMountOps(
  shared: SharedContext,
): Pick<
  SharedContext,
  | 'conflictOf'
  | 'mount'
  | 'unmount'
  | 'mountWithState'
  | 'processStagedEntry'
  | 'mountPromoted'
  | 'scanStaged'
  | 'retryEntry'
  | 'removeEntry'
> {
  return {
    conflictOf: (id: string) => conflictOf(shared, id),
    mount: (id: string, options: { name: string; config?: unknown }) => mount(shared, id, options),
    unmount: (id: string) => unmount(shared, id),
    mountWithState: (kind: 'staged' | 'promoted', id: string, entry: { name: string; config?: unknown }) =>
      mountWithState(shared, kind, id, entry),
    processStagedEntry: (id: string, entry: unknown) => processStagedEntry(shared, id, entry),
    mountPromoted: () => mountPromoted(shared),
    scanStaged: () => scanStaged(shared),
    retryEntry: (id: string) => retryEntry(shared, id),
    removeEntry: (id: string) => removeEntry(shared, id),
  }
}

/** Reject an entry whose id clashes with an existing loader row (R11). */
function conflictOf(shared: SharedContext, id: string): string | null {
  if (typeof id !== 'string' || id === '') return 'id is required'
  const store = shared.tree.store
  if (store !== undefined && store[id] !== undefined) return `loader entry id "${id}" already exists`
  return null
}

/**
 * Mount one entry through the include tree's root group. This uses the
 * EntryGroup API (no tree write-back), so a failure leaves no residue and
 * never touches cordis.yml.
 */
async function mount(shared: SharedContext, id: string, options: { name: string; config?: unknown }): Promise<void> {
  const conflict = conflictOf(shared, id)
  if (conflict !== null) throw new Error(conflict)
  const entryOptions: { id: string; name: string; config?: unknown } = { id, name: options.name }
  if (options.config !== undefined && options.config !== null) entryOptions.config = options.config
  await shared.tree.root.create(entryOptions)
  shared.mounted.add(id)
}

/** Unmount a mounted entry (teardown path; best effort). */
async function unmount(shared: SharedContext, id: string): Promise<void> {
  try {
    await shared.tree.root.remove(id)
  } catch {
    // best effort — the tree may already be gone
  }
  shared.mounted.delete(id)
}

/**
 * Try to mount one staged/promoted entry and fold the outcome into the
 * state. Returns 'mounted' | 'failed' (or 'skipped' when frozen).
 */
async function mountWithState(
  shared: SharedContext,
  kind: 'staged' | 'promoted',
  id: string,
  entry: { name?: string; config?: unknown },
): Promise<'mounted' | 'failed' | 'skipped'> {
  const recordKey = kind === 'staged' ? 'staged' : 'promoted'
  const record = (shared.state[recordKey][id] ?? {}) as Partial<EntryRecord>
  if (record.frozen) return 'skipped'
  const name = typeof entry?.name === 'string' ? entry.name : id
  // Dependency pre-check (issue #86)
  const precheck = precheckEntry(shared, name)
  if (precheck !== null) {
    recordFailure(shared, recordKey, id, name, entry, record, {
      failureType: 'dependency',
      message: buildDependencyMessage(precheck),
      missingDeps: [...precheck.missing, ...precheck.mismatched.map((item) => item.name)],
      installHint: precheck.suggestions[0] ?? null,
    })
    return 'failed'
  }
  try {
    await mount(shared, id, { name, config: entry.config })
    await promote(shared, recordKey, id, name, entry, record)
    return 'mounted'
  } catch (error) {
    recordFailure(shared, recordKey, id, name, entry, record, {
      failureType: classifyFailure(error),
      message: error instanceof Error ? error.message : String(error),
    })
    return 'failed'
  }
}

/** Run the dependency pre-check; null means it passed (or was skipped). */
function precheckEntry(shared: SharedContext, name: string): PrecheckResult | null {
  if (typeof name !== 'string' || name === '') return null
  const result = checkPeerDependencies({ profileDir: shared.profileDir, pluginName: name })
  return result.ok ? null : result
}

/** Success path: staged moves into the persisted promoted list (R2). */
async function promote(
  shared: SharedContext,
  recordKey: 'staged' | 'promoted',
  id: string,
  name: string,
  entry: { config?: unknown },
  record: Partial<EntryRecord>,
): Promise<void> {
  if (recordKey === 'staged') {
    shared.state.promoted[id] = {
      name,
      config: entry.config ?? undefined,
      attempts: 0,
      lastError: null,
      lastFailedAt: null,
      frozen: false,
      failureType: null,
      missingDeps: [],
      installHint: null,
      promotedAt: Date.now(),
    }
    delete shared.state.staged[id]
    // the entry is now a promoted plugin: drop it from the candidate file
    const entries = await readStagedFile(shared.stagedFile)
    const next = entries.filter((item) => (item as StagedEntry)?.id !== id)
    if (next.length !== entries.length) await writeStagedFile(shared.stagedFile, next)
  } else {
    shared.state.promoted[id] = {
      ...record,
      name,
      attempts: 0,
      lastError: null,
      lastFailedAt: null,
      frozen: false,
      failureType: null,
      missingDeps: [],
      installHint: null,
    } as EntryRecord
  }
  logEvent(shared, 'promote', `mounted ${name} (${id})`)
  shared.persistSoon()
}

/** Failure path: attempts counter + error recorded; freeze at the limit. */
function recordFailure(
  shared: SharedContext,
  recordKey: 'staged' | 'promoted',
  id: string,
  name: string,
  entry: { config?: unknown },
  record: Partial<EntryRecord>,
  info: { failureType?: string; message: string; missingDeps?: string[]; installHint?: string | null },
): void {
  const attempts = (record.attempts ?? 0) + 1
  const frozen = attempts >= FREEZE_LIMIT
  const message = typeof info.message === 'string' ? info.message : String(info.message ?? info)
  shared.state[recordKey][id] = {
    name,
    config: entry.config ?? undefined,
    attempts,
    lastError: errorSnip(message),
    lastFailedAt: Date.now(),
    frozen,
    failureType: info.failureType ?? 'code',
    missingDeps: info.missingDeps ?? [],
    installHint: info.installHint ?? null,
    ...(recordKey === 'promoted' ? { promotedAt: record.promotedAt } : {}),
  } as EntryRecord
  logEvent(shared, frozen ? 'freeze' : 'quarantine', `${name} (${id}) failed ${attempts}x: ${message}`)
  shared.persistSoon()
}

/** Handle one staged entry (idempotent per instance run). */
async function processStagedEntry(shared: SharedContext, id: string, entry: unknown): Promise<void> {
  if (typeof id !== 'string' || id === '' || entry === null || typeof entry !== 'object') return
  const e = entry as StagedEntry
  if (typeof e.name !== 'string' || e.name === '') return
  if (shared.attempted.has(id)) return
  shared.attempted.add(id)
  if (shared.state.safeMode) {
    logEvent(shared, 'safe', `staged entry skipped (${id}) — safe mode`)
    shared.persistSoon()
    return
  }
  await mountWithState(shared, 'staged', id, { name: e.name, config: e.config })
}

/** Mount every promoted entry (restart path). */
async function mountPromoted(shared: SharedContext): Promise<void> {
  for (const id of Object.keys(shared.state.promoted)) {
    if (shared.attempted.has(`promoted:${id}`)) continue
    shared.attempted.add(`promoted:${id}`)
    const record = shared.state.promoted[id]
    if (record === undefined || record.frozen) continue
    if (shared.mounted.has(id)) continue
    if (shared.state.safeMode) {
      logEvent(shared, 'skip', `promoted entry skipped (${id}) — safe mode`)
      shared.persistSoon()
      continue
    }
    await mountWithState(shared, 'promoted', id, { name: record.name, config: record.config })
  }
}

/** Sync the staged file into the guardian (new entries → staged/mount). */
async function scanStaged(shared: SharedContext): Promise<void> {
  const entries = await readStagedFile(shared.stagedFile)
  for (const item of entries) {
    if (item === null || typeof item !== 'object') continue
    const id = typeof (item as StagedEntry).id === 'string' ? (item as StagedEntry).id! : ''
    if (id === '') continue
    await processStagedEntry(shared, id, item)
  }
}

/** Retry a staged or promoted entry (manual unfreeze). */
async function retryEntry(shared: SharedContext, id: string): Promise<string | null> {
  const staged = shared.state.staged[id]
  if (staged !== undefined) {
    delete shared.state.staged[id]
    shared.persistSoon()
    shared.attempted.delete(id)
    const entries = await readStagedFile(shared.stagedFile)
    const item = entries.find((entry) => (entry as StagedEntry)?.id === id)
    if (item === undefined) return 'missing'
    await processStagedEntry(shared, id, item)
    return shared.state.promoted[id] !== undefined ? 'mounted' : 'failed'
  }
  const promoted = shared.state.promoted[id]
  if (promoted !== undefined) {
    shared.state.promoted[id] = {
      ...promoted,
      attempts: 0,
      lastError: null,
      lastFailedAt: null,
      frozen: false,
      failureType: null,
      missingDeps: [],
      installHint: null,
    }
    shared.persistSoon()
    if (shared.state.safeMode) return 'safe'
    shared.attempted.delete(`promoted:${id}`)
    await mountPromoted(shared)
    return shared.mounted.has(id) ? 'mounted' : 'failed'
  }
  return null
}

/** Remove an entry everywhere (staged file + state + mounted). */
async function removeEntry(shared: SharedContext, id: string): Promise<void> {
  if (shared.mounted.has(id)) await unmount(shared, id)
  delete shared.state.staged[id]
  delete shared.state.promoted[id]
  shared.attempted.delete(id)
  shared.attempted.delete(`promoted:${id}`)
  const entries = await readStagedFile(shared.stagedFile)
  const next = entries.filter((item) => (item as StagedEntry)?.id !== id)
  if (next.length !== entries.length) await writeStagedFile(shared.stagedFile, next)
  shared.persistSoon()
}

/** Full startup pass: load state, normalize, then staged + promoted. */
export async function initialScan(shared: SharedContext): Promise<void> {
  shared.state = await loadState()
  // normalize fields a hand-edited or older state file may lack
  if (!Array.isArray(shared.state.events)) shared.state.events = []
  if (shared.state.staged === null || typeof shared.state.staged !== 'object') shared.state.staged = {}
  if (shared.state.promoted === null || typeof shared.state.promoted !== 'object') shared.state.promoted = {}
  if (typeof shared.state.safeMode !== 'boolean') shared.state.safeMode = false
  shared.ready = true
  await shared.scanStaged()
  await shared.mountPromoted()
  shared.ensureApi()
}
