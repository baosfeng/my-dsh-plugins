/**
 * dsh-my-memory — two-scope memory storage (TypeScript 源码)。
 *
 *  - global:  $DSH_HOME/memory.json (fallback ~/.dsh/memory.json)
 *  - project: $DSH_HOME/memory/projects/<projectId>.json (centralized under
 *    the DSH home, issue #108), where projectId is a stable id derived from
 *    the project root (sha256 of the normalized root path, first 12 hex
 *    chars). The project root itself is the nearest ancestor with a .git
 *    directory (findProjectRoot), resolved from the session cwd.
 *
 *  Legacy location: <projectRoot>/.dsh/memory.json used to hold project
 *  memories until issue #108. migrateProjectMemory() copies any legacy data
 *  into the new centralized file on first access (and removes the legacy
 *  file), so existing memories are never lost.
 *
 * File shape (one scope per file):
 *   { "items": [ { "id", "desc", "createdAt", "updatedAt",
 *                  "category", "source", "confidence", "relatedIds",
 *                  "history", "status" } ] }
 * The metadata fields are the issue #78 structured index; legacy files
 * without them normalize back to defaults (category=fact, confidence=1,
 * empty source/history — see lib/memory-scoring.js withDefaults) and are
 * preserved verbatim on the next write.
 *
 * Writes are debounced (multiple mutations within the window coalesce into
 * one disk write) and atomic (tmp + rename). Reads are defensive:
 * missing/corrupt files degrade to an empty list. The store keeps an
 * in-memory cache so the system-prompt section and the query tool read
 * without touching disk; load() restores the cache at startup (restart
 * recovery).
 */
import { createHash } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, normalize, resolve } from 'node:path'
import { findProjectRoot } from 'dsh-shared'
import { mergeCandidate, withDefaults } from './memory-scoring.js'
import type {
  MemoryItem,
  CandidateItem,
  MemoryStore,
  CandidateStore,
  StoreInstance,
  CandidateStoreInstance,
} from './memory-types.js'

export type { MemoryItem, CandidateItem, MemoryStore, CandidateStore, StoreInstance, CandidateStoreInstance }

/** The DSH home directory: $DSH_HOME, or ~/.dsh when unset (shared by the
 *  global memory file and the centralized project memory directory). */
function dshHome(): string {
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home !== '') return home
  return join(homedir(), '.dsh')
}

/** Global memory file: $DSH_HOME/memory.json (fallback ~/.dsh/memory.json). */
export function globalMemoryFile(): string {
  return `${dshHome()}/memory.json`
}

/** Project memory directory: $DSH_HOME/memory/projects (issue #108). */
export function projectMemoryDir(): string {
  return join(dshHome(), 'memory', 'projects')
}

/** Learning-candidate file: $DSH_HOME/memory/candidates.json (issue #78).
 *  Pending auto-extracted candidates live separately from confirmed
 *  memories so the memory files only ever hold user-confirmed entries. */
export function candidateMemoryFile(): string {
  return join(dshHome(), 'memory', 'candidates.json')
}

/**
 * Stable project id for a project root (issue #108, scheme A): sha256 of the
 * normalized absolute root path, first 12 hex chars. Deterministic across
 * machines/sessions, unique enough for per-project isolation, and safe as a
 * filename on every platform.
 */
export function projectIdOf(root: string): string {
  const normalized = normalize(resolve(root))
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12)
}

/**
 * Resolve the project memory paths for a cwd (issue #108): the new
 * centralized file under $DSH_HOME/memory/projects, plus the legacy
 * <projectRoot>/.dsh/memory.json (used only for migration), plus the
 * project root itself.
 */
export async function resolveProjectMemory(cwd: string): Promise<{
  root: string
  file: string
  legacyFile: string
}> {
  const root = await findProjectRoot(cwd)
  return {
    root,
    file: join(projectMemoryDir(), `${projectIdOf(root)}.json`),
    legacyFile: join(root, '.dsh', 'memory.json'),
  }
}

/**
 * Project memory file for a cwd (new centralized location, issue #108).
 * Kept as a thin wrapper over resolveProjectMemory for callers that only
 * need the path.
 */
export async function projectMemoryFileOf(cwd: string): Promise<string> {
  return (await resolveProjectMemory(cwd)).file
}

/**
 * Migrate legacy <projectRoot>/.dsh/memory.json into the new centralized
 * file (issue #108). Returns true when a migration actually happened:
 *  - the new file already exists → nothing to do (migrated before or fresh);
 *  - the legacy file is missing or empty → nothing to migrate;
 *  - otherwise copies the legacy items into the new file (atomic write),
 *    then removes the legacy file and the now-empty .dsh directory
 *    (best-effort, so the project directory stays clean).
 * Data is never silently dropped: the legacy items land in the new file
 * before the old file is touched.
 */
export async function migrateProjectMemory({
  file,
  legacyFile,
}: {
  file: string
  legacyFile: string
}): Promise<boolean> {
  try {
    await stat(file)
    return false
  } catch {
    // new file missing → a legacy file may need migrating
  }
  const legacy = await readMemoryFile(legacyFile)
  if (legacy.items.length === 0) return false
  await mkdir(dirname(file), { recursive: true })
  await writeMemoryFile(file, legacy)
  try {
    await rm(legacyFile, { force: true })
    await rm(dirname(legacyFile), { force: true })
  } catch {
    // removal is best-effort; the migration itself already succeeded
  }
  return true
}

/** Read one file through a normalizer (missing/corrupt → empty items). */
async function readNormalizedFile<T>(
  file: string,
  normalize: (raw: unknown) => { items: T[] },
): Promise<{ items: T[] }> {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') return normalize(parsed)
  } catch {
    // first run or unreadable file: empty document
  }
  return { items: [] }
}

/** Read one memory file (missing/corrupt → empty document). */
export async function readMemoryFile(
  file: string,
  normalizeFn: (memory: unknown) => MemoryStore = normalizeMemory,
): Promise<MemoryStore> {
  return readNormalizedFile(file, normalizeFn)
}

/** Keep only well-formed items; anything else is ignored defensively.
 *  Legacy items (no category/source/confidence) get the issue #78 metadata
 *  defaults via withDefaults — old data is never dropped, just upgraded. */
export function normalizeMemory(memory: unknown): MemoryStore {
  const items = Array.isArray((memory as Record<string, unknown>)?.items)
    ? (memory as Record<string, unknown[]>).items
    : []
  return {
    items: items.filter((item) => isMemoryItem(item)).map((item) => withDefaults(item)),
  }
}

/** One well-formed memory item (id + desc required, timestamps numeric;
 *  issue #78 metadata fields are optional — legacy data upgrades later). */
function isMemoryItem(item: unknown): item is MemoryItem {
  return (
    item !== null &&
    typeof item === 'object' &&
    typeof (item as Record<string, unknown>).id === 'string' &&
    (item as Record<string, string>).id !== '' &&
    typeof (item as Record<string, unknown>).desc === 'string' &&
    (item as Record<string, string>).desc !== '' &&
    typeof (item as Record<string, unknown>).createdAt === 'number' &&
    typeof (item as Record<string, unknown>).updatedAt === 'number'
  )
}

/** One well-formed learning candidate (issue #78 auto-extraction):
 *  id/category/desc/scope/source/createdAt required; scope ∈ {global|project};
 *  cwd optional (required for project-scope candidates). */
function isCandidateItem(item: unknown): item is CandidateItem {
  return (
    hasCandidateFields(item) &&
    typeof (item as Record<string, unknown>).category === 'string' &&
    ((item as Record<string, unknown>).scope === 'global' || (item as Record<string, unknown>).scope === 'project') &&
    (item as Record<string, unknown>).source !== null &&
    typeof (item as Record<string, unknown>).source === 'object'
  )
}

/** 候选基础字段（id/desc/createdAt 与语言无关的数值/字符串完整性）。 */
function hasCandidateFields(item: unknown): boolean {
  return (
    item !== null &&
    typeof item === 'object' &&
    typeof (item as Record<string, unknown>).id === 'string' &&
    (item as Record<string, string>).id !== '' &&
    typeof (item as Record<string, unknown>).desc === 'string' &&
    (item as Record<string, string>).desc !== '' &&
    typeof (item as Record<string, unknown>).createdAt === 'number'
  )
}

/** Normalize one learning candidate file; malformed entries are dropped. */
function normalizeCandidates(memory: unknown): CandidateStore {
  const items = Array.isArray((memory as Record<string, unknown>)?.items)
    ? (memory as Record<string, unknown[]>).items
    : []
  return {
    items: items.filter((item) => isCandidateItem(item)),
  }
}

/** Atomic write: write to tmp file, then rename (crash-safe); the parent
 *  directory is created on demand (first write into $DSH_HOME/memory). */
async function atomicWrite(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, file)
}

/** Item timestamp for sorting: updatedAt, falling back to createdAt. */
function tsOf(item: { updatedAt?: unknown; createdAt?: unknown }): number {
  if (Number.isFinite(item?.updatedAt)) return item.updatedAt as number
  return Number.isFinite(item?.createdAt) ? (item.createdAt as number) : 0
}

/** Shared debounced-store core (pre-migration createGenericStore): in-memory
 *  cache + idempotent startup restore + debounced atomic writes, reused by the
 *  memory store and the candidate store so both share one code path. */
function createDebouncedStore<T extends { id: string; createdAt?: number; updatedAt?: number }>(
  file: string,
  debounceMs: number,
  normalize: (raw: unknown) => { items: T[] },
): {
  state: { items: T[] }
  load(): Promise<void>
  flush(): Promise<void>
  list(): T[]
  dispose(): void
  push(item: T): void
  scheduleWrite(): void
  removeById(id: string): Promise<boolean>
} {
  const state = {
    items: [] as T[],
    timer: null as ReturnType<typeof setTimeout> | null,
    writing: Promise.resolve(),
    ready: Promise.resolve(),
  }
  state.ready = readNormalizedFile(file, normalize).then((document) => {
    state.items = document.items
  })

  /** Restore the cache from disk exactly once (idempotent): every caller reuses
   *  the same promise, so a late load() can never overwrite in-memory mutations
   *  that have not been flushed yet (pre-migration ready semantics). */
  function load(): Promise<void> {
    return state.ready
  }

  function scheduleWrite(): void {
    if (state.timer !== null) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = null
      state.writing = writeMemoryFile(file, { items: state.items }).catch(() => {})
    }, debounceMs)
  }

  async function flush(): Promise<void> {
    if (state.timer !== null) {
      clearTimeout(state.timer)
      state.timer = null
    }
    await state.ready
    await writeMemoryFile(file, { items: state.items })
    await state.writing
  }

  function list(): T[] {
    return state.items.slice().sort((a, b) => tsOf(b) - tsOf(a))
  }

  function dispose(): void {
    if (state.timer !== null) {
      clearTimeout(state.timer)
      state.timer = null
    }
  }

  function push(item: T): void {
    state.items.push(item)
    scheduleWrite()
  }

  async function removeById(id: string): Promise<boolean> {
    await state.ready
    const index = state.items.findIndex((item) => item.id === id)
    if (index === -1) return false
    state.items.splice(index, 1)
    scheduleWrite()
    return true
  }

  return { state, load, flush, list, dispose, push, scheduleWrite, removeById }
}

/**
 * Create a debounced, atomic file-backed store for one memory scope.
 * @param options.file The JSON file path.
 * @param options.debounceMs Write coalescing window (default 300ms).
 */
export function createStore(options: { file: string; debounceMs?: number }): StoreInstance {
  const { file, debounceMs = 300 } = options
  const core = createDebouncedStore<MemoryItem>(file, debounceMs, normalizeMemory)

  async function add(
    item: string | Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>,
    now: number = Date.now(),
  ): Promise<MemoryItem> {
    await core.load()
    const baseItem = typeof item === 'string' ? { desc: item } : item
    const newItem: MemoryItem = {
      ...withDefaults(baseItem, now),
      id: `mem-${now}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    }
    core.push(newItem)
    return newItem
  }

  async function update(
    id: string,
    changes: string | Partial<MemoryItem>,
    now: number = Date.now(),
  ): Promise<MemoryItem | null> {
    await core.load()
    const index = core.state.items.findIndex((item) => item.id === id)
    if (index === -1) return null
    const changesObj = typeof changes === 'string' ? { desc: changes } : changes
    const updated = { ...core.state.items[index], ...changesObj, updatedAt: now }
    core.state.items[index] = updated
    core.scheduleWrite()
    return updated
  }

  async function mergeAdd(candidate: unknown, now: number = Date.now()): Promise<{ item: unknown; outcome: string }> {
    await core.load()
    const { items, outcome } = mergeCandidate(core.state.items, candidate as Partial<MemoryItem>, now)
    core.state.items = items
    core.scheduleWrite()
    return { item: items[items.length - 1], outcome }
  }

  return {
    state: core.state,
    load: core.load,
    flush: core.flush,
    dispose: core.dispose,
    list: core.list,
    add,
    mergeAdd,
    update,
    remove: core.removeById,
  }
}

/**
 * Create a debounced, atomic file-backed store for learning candidates.
 * @param options.file The JSON file path.
 * @param options.debounceMs Write coalescing window (default 300ms).
 */
export function createCandidatesStore(options: { file: string; debounceMs?: number }): CandidateStoreInstance {
  const { file, debounceMs = 300 } = options
  const core = createDebouncedStore<CandidateItem>(file, debounceMs, normalizeCandidates)

  /** Append an already-shaped candidate: the passed id/createdAt are preserved
   *  (the extractor owns candidate ids), malformed shapes are dropped
   *  defensively (undefined) — pre-migration addRawItem semantics. */
  async function addRaw(item: unknown): Promise<CandidateItem | undefined> {
    await core.load()
    if (!isCandidateItem(item)) return undefined
    core.push(item)
    return { ...item }
  }

  return {
    state: core.state,
    load: core.load,
    flush: core.flush,
    dispose: core.dispose,
    list: core.list,
    addRaw,
    remove: core.removeById,
  }
}

/**
 * Write one memory file (atomic).
 */
async function writeMemoryFile(file: string, data: { items: unknown[] }): Promise<void> {
  await atomicWrite(file, data)
}
