/**
 * dsh-my-guardian — state management: constants, persisted state (state.json)
 * and the candidate file (cordis.staged.json) helpers.
 *
 * All file writes are atomic (tmp + rename) and never throw to callers — the
 * guardian must never take the process down over a persistence failure.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
/** Consecutive failures before an entry freezes (manual retry required). */
export const FREEZE_LIMIT = 3;
/** Keep at most this many diagnostic events in the state. */
export const EVENT_LIMIT = 20;
/** How many characters of an error message to keep in state. */
export const ERROR_SNIP = 300;
/** Unique suffix for temp files (same-process instances must not collide). */
let tmpSeq = 0;
function uniqueSuffix() {
    tmpSeq += 1;
    return `${process.pid}-${Date.now().toString(36)}-${tmpSeq}`;
}
/** Guardian state dir: $DSH_HOME/guardian (fallback: ~/.dsh/guardian). */
function guardianDir() {
    const home = process.env.DSH_HOME;
    if (typeof home === 'string' && home !== '')
        return join(home, 'guardian');
    return join(homedir(), '.dsh', 'guardian');
}
/**
 * Persist the startup-roster pre-check report (issue #144) atomically at
 * $DSH_HOME/guardian/startup-issues.json. The report is written even when
 * the roster is healthy (empty issues + checkedAt) so the file doubles as a
 * "last checked" marker; missing/corrupt file only means "never written".
 * Never throws to callers — the guardian must not take the process down.
 */
export async function writeStartupIssuesFile(payload) {
    const dir = guardianDir();
    const file = join(dir, 'startup-issues.json');
    const tmp = `${file}.tmp-${uniqueSuffix()}`;
    try {
        await mkdir(dir, { recursive: true });
        await writeFile(tmp, JSON.stringify(payload), 'utf8');
        await rename(tmp, file);
    }
    catch {
        // the report is diagnostic-only: a write failure must not break boot
    }
}
/** Empty state document. */
export function createState() {
    return { version: 1, safeMode: false, staged: {}, promoted: {}, events: [] };
}
/** Load persisted state (missing/corrupt file → fresh state). */
export async function loadState() {
    try {
        const raw = await readFile(join(guardianDir(), 'state.json'), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object' && parsed.version === 1)
            return parsed;
    }
    catch {
        // first run or unreadable file: start fresh
    }
    return createState();
}
/** Persist state atomically (tmp + rename). Never throws to callers. */
async function persistState(state) {
    const dir = guardianDir();
    const file = join(dir, 'state.json');
    const tmp = `${file}.tmp-${uniqueSuffix()}`;
    try {
        await mkdir(dir, { recursive: true });
        await writeFile(tmp, JSON.stringify(state), 'utf8');
        await rename(tmp, file);
    }
    catch {
        // persistence must never take the guardian down
    }
}
/** Serialize state writes on a promise chain (drain in order). */
export function createPersister(shared) {
    const persistSoon = () => {
        shared.writeChain = shared.writeChain.then(() => persistState(shared.state));
    };
    /** 确定性 drain 信号：resolve 时链上所有快照（含本 tick 排队的）都已落盘。 */
    const flush = () => shared.writeChain;
    return { persistSoon, flush };
}
/** Read the candidate file; missing/corrupt → []. */
export async function readStagedFile(file) {
    try {
        const raw = await readFile(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
            return parsed;
    }
    catch {
        // missing or malformed: treat as empty
    }
    return [];
}
/** Write the candidate file atomically. Returns an error object or null. */
export async function writeStagedFile(file, entries) {
    const tmp = `${file}.tmp-${uniqueSuffix()}`;
    try {
        await writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
        await rename(tmp, file);
        return null;
    }
    catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
}
/** Shorten an error for the state record. */
export function errorSnip(error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    return message.length > ERROR_SNIP ? `${message.slice(0, ERROR_SNIP)}…` : message;
}
