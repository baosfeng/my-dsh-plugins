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

/** 内存条目接口。 */
export interface MemoryItem {
  id: string
  desc: string
  createdAt: number
  updatedAt: number
  category?: string
  source?: string
  confidence?: number
  relatedIds?: string[]
  history?: Array<{
    desc: string
    updatedAt: number
    category?: string
  }>
  status?: 'active' | 'archived' | 'pending'
}

/** 候选记忆条目接口。 */
export interface CandidateItem {
  id: string
  desc: string
  category: string
  scope: 'global' | 'project'
  source: Record<string, unknown>
  createdAt: number
  cwd?: string
}

/** 记忆存储结构。 */
export interface MemoryStore {
  items: MemoryItem[]
}

/** 候选存储结构。 */
export interface CandidateStore {
  items: CandidateItem[]
}

/** 存储实例接口。 */
export interface StoreInstance {
  state: MemoryStore | null
  load(): Promise<void>
  flush(): Promise<void>
  list(): MemoryItem[]
  add(item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryItem>
  addRaw(item: unknown): Promise<unknown>
  mergeAdd(candidate: unknown, now?: number): Promise<{ item: unknown; outcome: string }>
  update(id: string, changes: Partial<MemoryItem>): Promise<MemoryItem | null>
  remove(id: string): Promise<boolean>
}

/** 候选存储实例接口。 */
export interface CandidateStoreInstance {
  state: CandidateStore | null
  load(): Promise<void>
  flush(): Promise<void>
  list(): CandidateItem[]
  addRaw(item: Omit<CandidateItem, 'id' | 'createdAt'>): Promise<CandidateItem>
  confirm(id: string): Promise<MemoryItem | null>
  dismiss(id: string): Promise<boolean>
}

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
  await writeMemoryFile(file, legacy)
  try {
    await rm(legacyFile, { force: true })
    await rm(dirname(legacyFile), { force: true })
  } catch {
    // removal is best-effort; the migration itself already succeeded
  }
  return true
}

/** Empty memory document. */
function emptyMemory(): MemoryStore {
  return { items: [] }
}

/** Read one memory file (missing/corrupt → empty document). */
export async function readMemoryFile(
  file: string,
  normalizeFn: (memory: unknown) => MemoryStore = normalizeMemory,
): Promise<MemoryStore> {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') return normalizeFn(parsed)
  } catch {
    // first run or unreadable file: empty memory
  }
  return emptyMemory()
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

/** Empty candidate document. */
function emptyCandidates(): CandidateStore {
  return { items: [] }
}

/** Read one candidate file (missing/corrupt → empty document). */
export async function readCandidateFile(file: string): Promise<CandidateStore> {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') return normalizeCandidates(parsed)
  } catch {
    // first run or unreadable file: empty candidates
  }
  return emptyCandidates()
}

/** Atomic write: write to tmp file, then rename (crash-safe). */
async function atomicWrite(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, file)
}

/**
 * Create a debounced, atomic file-backed store for one memory scope.
 * @param options.file The JSON file path.
 * @param options.debounceMs Write coalescing window (default 300ms).
 */
export function createStore(options: { file: string; debounceMs?: number }): StoreInstance {
  const { file, debounceMs = 300 } = options
  let state: MemoryStore | null = null
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null

  async function load(): Promise<void> {
    state = await readMemoryFile(file)
    dirty = false
  }

  async function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (dirty && state !== null) {
      await atomicWrite(file, state)
      dirty = false
    }
  }

  function scheduleWrite(): void {
    dirty = true
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (dirty && state !== null) {
        atomicWrite(file, state).catch(() => {})
        dirty = false
      }
    }, debounceMs)
  }

  function list(): MemoryItem[] {
    return state?.items ?? []
  }

  async function add(
    item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MemoryItem> {
    if (state === null) await load()
    const now = Date.now()
    const newItem: MemoryItem = {
      ...item,
      id: `mem_${now}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    }
    state!.items.push(newItem)
    scheduleWrite()
    return newItem
  }

  async function update(
    id: string,
    changes: Partial<MemoryItem>,
  ): Promise<MemoryItem | null> {
    if (state === null) await load()
    const index = state!.items.findIndex((item) => item.id === id)
    if (index === -1) return null
    const updated = { ...state!.items[index], ...changes, updatedAt: Date.now() }
    state!.items[index] = updated
    scheduleWrite()
    return updated
  }

  async function remove(id: string): Promise<boolean> {
    if (state === null) await load()
    const index = state!.items.findIndex((item) => item.id === id)
    if (index === -1) return false
    state!.items.splice(index, 1)
    scheduleWrite()
    return true
  }

  return {
    get state() {
      return state
    },
    load,
    flush,
    list,
    add,
    update,
    remove,
  }
}

/**
 * Create a debounced, atomic file-backed store for learning candidates.
 * @param options.file The JSON file path.
 * @param options.debounceMs Write coalescing window (default 300ms).
 */
export function createCandidatesStore(options: {
  file: string
  debounceMs?: number
}): CandidateStoreInstance {
  const { file, debounceMs = 300 } = options
  let state: CandidateStore | null = null
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null

  async function load(): Promise<void> {
    state = await readCandidateFile(file)
    dirty = false
  }

  async function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (dirty && state !== null) {
      await atomicWrite(file, state)
      dirty = false
    }
  }

  function scheduleWrite(): void {
    dirty = true
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (dirty && state !== null) {
        atomicWrite(file, state).catch(() => {})
        dirty = false
      }
    }, debounceMs)
  }

  function list(): CandidateItem[] {
    return state?.items ?? []
  }

  async function addRaw(
    item: Omit<CandidateItem, 'id' | 'createdAt'>,
  ): Promise<CandidateItem> {
    if (state === null) await load()
    const now = Date.now()
    const newItem: CandidateItem = {
      ...item,
      id: `cand_${now}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
    }
    state!.items.push(newItem)
    scheduleWrite()
    return newItem
  }

  async function confirm(id: string): Promise<MemoryItem | null> {
    if (state === null) await load()
    const index = state!.items.findIndex((item) => item.id === id)
    if (index === -1) return null
    const candidate = state!.items[index]
    state!.items.splice(index, 1)
    scheduleWrite()
    return {
      id: candidate.id,
      desc: candidate.desc,
      category: candidate.category,
      source: typeof candidate.source === 'string' ? candidate.source : 'auto-extract',
      createdAt: candidate.createdAt,
      updatedAt: Date.now(),
    }
  }

  async function dismiss(id: string): Promise<boolean> {
    if (state === null) await load()
    const index = state!.items.findIndex((item) => item.id === id)
    if (index === -1) return false
    state!.items.splice(index, 1)
    scheduleWrite()
    return true
  }

  return {
    get state() {
      return state
    },
    load,
    flush,
    list,
    addRaw,
    confirm,
    dismiss,
  }
}

/**
 * Write one memory file (atomic).
 */
export async function writeMemoryFile(file: string, data: MemoryStore): Promise<void> {
  await atomicWrite(file, data)
}

/**
 * Write one candidate file (atomic).
 */
export async function writeCandidateFile(file: string, data: CandidateStore): Promise<void> {
  await atomicWrite(file, data)
}