/**
 * State model + persistence for file activity.
 *
 * State (recent history + per-file counts) is kept per session and persisted
 * to $DSH_HOME/file-activity.json (atomic tmp+rename, debounced). Loading is
 * defensive: missing / corrupt / wrong-version files degrade to fresh state.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { ActivityState, Counters, LoadedState, RecentEntry, SessionState } from './types.js'

/** How many recent entries to keep per session (LRU: one entry per path). */
const RECENT_LIMIT = 5

/** State file: $DSH_HOME/file-activity.json (fallback: ~/.dsh/file-activity.json). */
export function stateFile(): string {
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home !== '') return `${home}/file-activity.json`
  return `${homedir()}/.dsh/file-activity.json`
}

/** Empty state document. */
export function createState(): ActivityState {
  return { version: 1, sessions: {} }
}

/** Load persisted state (missing/corrupt file → fresh state). */
export async function loadState(file: string): Promise<LoadedState> {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown } | null
    if (parsed !== null && typeof parsed === 'object' && parsed.version === 1) return parsed as LoadedState
  } catch {
    // first run or unreadable file: start fresh
  }
  return createState()
}

/** Map a raw operation kind (tool name or client op) to 'read' | 'write' | 'edit' | 'delete'. */
export function mapOp(op: string): string {
  switch (op) {
    case 'write':
      return 'write'
    case 'edit':
    case 'str_replace_editor':
      return 'edit'
    case 'delete':
      return 'delete'
    case 'read':
    case 'read_image':
    default:
      return 'read'
  }
}

/**
 * Fold one observed operation into the state.
 * 'write' is classified create vs modify through the per-session known-file
 * registry (first contact = create, later writes = modify); edits are always
 * modifies. 'delete' removes the file from stats entirely (disk state is the
 * truth: the file no longer exists) and records a single delete history entry.
 * Each file's counters also track firstSeen (first contact time, i.e.
 * creation time) and lastSeen (most recent activity time).
 * Returns true when a record was produced.
 */
export function applyRecord(state: ActivityState, sessionId: string, path: string, op: string, time?: number): boolean {
  if (!isValidRecordTarget(sessionId, path)) return false
  const session = state.sessions[sessionId] ?? (state.sessions[sessionId] = { known: {}, counts: {}, recent: [] })
  const timestamp = typeof time === 'number' ? time : Date.now()
  if (op === 'delete') return applyDelete(session, path, timestamp)
  const firstSeen = typeof session.known[path] === 'number' ? session.known[path] : timestamp
  const finalOp = classifyOp(op, session.known[path])
  session.known[path] = firstSeen
  const counts = session.counts[path] ?? (session.counts[path] = { read: 0, create: 0, modify: 0 })
  bumpCount(counts, finalOp, firstSeen, timestamp)
  pushRecent(session.recent, path, finalOp, timestamp)
  return true
}

/** 'delete': the file no longer exists on disk — drop it from stats and the
 *  known-file registry, and record a single delete history entry. */
function applyDelete(session: SessionState, path: string, timestamp: number): boolean {
  delete session.counts[path]
  delete session.known[path]
  pushRecent(session.recent, path, 'delete', timestamp)
  return true
}

/** Newest-first LRU history: one entry per path, cap at RECENT_LIMIT. */
function pushRecent(recent: RecentEntry[], path: string, op: string, time: number): void {
  const existing = recent.findIndex((entry) => entry.path === path)
  if (existing !== -1) recent.splice(existing, 1)
  recent.unshift({ path, op, time })
  if (recent.length > RECENT_LIMIT) recent.length = RECENT_LIMIT
}

/** A record target is valid when both ids are non-empty strings (no NUL). */
function isValidRecordTarget(sessionId: unknown, path: unknown): boolean {
  return (
    typeof sessionId === 'string' && sessionId !== '' && typeof path === 'string' && path !== '' && !path.includes('\0')
  )
}

/** 'write' → create/modify by the known-file registry; 'edit' → modify; else read. */
function classifyOp(op: string, knownTime: number | undefined): string {
  if (op === 'write') return knownTime ? 'modify' : 'create'
  if (op === 'edit') return 'modify'
  return 'read'
}

/** Increment the matching counter and refresh firstSeen/lastSeen. */
function bumpCount(counts: Counters, finalOp: string, firstSeen: number, timestamp: number): void {
  if (finalOp === 'create') counts.create += 1
  else if (finalOp === 'modify') counts.modify += 1
  else counts.read += 1
  counts.firstSeen = firstSeen
  counts.lastSeen = timestamp
}

/**
 * Normalize + trim a loaded state document in place: null/absent sessions are
 * reset to {}, pre-existing history is deduped by path and capped at
 * RECENT_LIMIT (LRU semantics: one entry per path, newest occurrence wins —
 * the array is newest-first, so the first occurrence of each path is kept).
 * Returns { state, trimmed } where trimmed reports whether anything changed.
 */
export function trimLoadedState(loaded: LoadedState): { state: ActivityState; trimmed: boolean } {
  if (loaded.sessions === undefined || loaded.sessions === null || typeof loaded.sessions !== 'object')
    loaded.sessions = {}
  let trimmed = false
  for (const session of Object.values(loaded.sessions)) {
    if (Array.isArray(session.recent)) {
      const seen = new Set<string>()
      const deduped = session.recent.filter((entry) => {
        if (typeof entry?.path !== 'string' || entry.path === '') return false
        if (seen.has(entry.path)) return false
        seen.add(entry.path)
        return true
      })
      if (deduped.length !== session.recent.length) trimmed = true
      session.recent = deduped
      if (session.recent.length > RECENT_LIMIT) {
        session.recent.length = RECENT_LIMIT
        trimmed = true
      }
    }
  }
  return { state: loaded as ActivityState, trimmed }
}

/**
 * Whether `path` appears in this session's recorded file activity (counts or
 * recent). The media route authorizes EXACTLY these paths — the record itself
 * is the permission: the agent actually touched the file, so previewing it is
 * expected, while arbitrary unrecorded paths stay refused.
 */
export function isRecordedPath(state: ActivityState, sessionId: string, path: string): boolean {
  const session = state.sessions[sessionId]
  if (session === undefined) return false
  if (session.counts !== undefined && typeof session.counts[path] === 'object' && session.counts[path] !== null)
    return true
  // Deleted files no longer exist on disk — a delete history entry must not
  // authorize media preview for them.
  if (Array.isArray(session.recent)) return session.recent.some((entry) => entry.path === path && entry.op !== 'delete')
  return false
}
