/**
 * dsh-my-guardian — startup-roster static pre-check (issue #144).
 *
 * DSH boots its plugin roster all-or-nothing: any roster row (cordis.patch.yml /
 * profile / bundles — everything merged into the loader's include tree) that
 * fails to import, throws during apply, or stays pending takes the whole
 * `dsh web` process down, and the guardian (itself a roster row) has no
 * chance to quarantine anything after the fact. This module closes that gap
 * with a STATIC, best-effort pre-flight that runs right after the guardian's
 * own apply.
 *
 * Guardrails (watchdog self-protection, R15): the pre-check itself NEVER
 * fails the boot — every step is wrapped, failures only log; a broken loader
 * tree simply yields no roster and an empty report.
 */
import { join } from 'node:path'
import { findModuleDir, checkPeerDependencies, buildDependencyMessage } from './dep-precheck.js'
import type { PrecheckResult } from './dep-precheck.js'
import { writeStartupIssuesFile } from './state.js'
import type { SharedContext, StartupIssue, StartupIssuesPayload } from './state.js'
import { logEvent } from './events.js'
import type { DshContext, LoaderEntry, LoaderTree } from './types.js'

/** Profile-node_modules root used for roster resolvability checks. */
function profileNodeModules(profileDir: string): string {
  return join(profileDir, 'node_modules')
}

interface NormalizedRosterEntry {
  id: string
  name: string
  disabled: boolean
}

/** Collect every entry of a tree, tolerantly: entries() when present (real
 *  IncludeTree includes nested subtrees), otherwise a plain store walk
 *  (mocked trees in tests). Never throws — a broken tree yields []. */
export function collectTreeEntries(tree: LoaderTree | null | undefined): LoaderEntry[] {
  if (tree === null || typeof tree !== 'object') return []
  if (typeof tree.entries === 'function') {
    try {
      const out: LoaderEntry[] = []
      for (const entry of tree.entries()) {
        if (entry !== null && typeof entry === 'object') out.push(entry)
      }
      return out
    } catch {
      // fall through to the store walk
    }
  }
  const store = tree.store
  if (store === null || typeof store !== 'object') return []
  return Object.values(store).filter((entry): entry is LoaderEntry => entry !== null && typeof entry === 'object')
}

/** Read one string field from an entry's options (tolerant of odd shapes). */
function readOptionString(options: Record<string, unknown> | undefined | null, key: string): string {
  return options !== null && typeof options === 'object' && typeof options[key] === 'string' && options[key] !== ''
    ? (options[key] as string)
    : ''
}

/** Extract { id, name } from an entry, with safe fallbacks (entry.id getter
 *  may throw on partially-constructed entries — never let it break the boot). */
export function entryLabels(entry: LoaderEntry): { id: string; name: string } {
  const options = entry !== null && typeof entry === 'object' ? entry.options ?? null : null
  let id = readOptionString(options as Record<string, unknown> | null, 'id')
  if (id === '') id = entryIdGetterOf(entry)
  const name = readOptionString(options as Record<string, unknown> | null, 'name')
  return { id, name: name !== '' ? name : id !== '' ? id : '?' }
}

/** entry.id getter fallback (wrapped: it may throw on partial entries). */
function entryIdGetterOf(entry: LoaderEntry): string {
  try {
    const entryId = entry?.id
    return typeof entryId === 'string' && entryId !== '' ? entryId : ''
  } catch {
    return ''
  }
}

/** True when an entry is disabled (explicit row or via options) — disabled
 *  rows are exempt from the boot audits and from this pre-check. */
export function isDisabledEntry(entry: LoaderEntry): boolean {
  if (entry === null || typeof entry !== 'object') return false
  if (entry.disabled === true) return true
  const options = entry.options
  return options !== null && typeof options === 'object' && (options as Record<string, unknown>).disabled === true
}

/** Removal hint shared by every issue kind (guardian never rewrites YAML). */
const REMOVE_HINT = '从启动名册（cordis.patch.yml / profile）中删除该条目行，或标记 disabled: true 暂缓加载'

/** Build an unresolvable-package issue (import stage would fail). */
function unresolvedIssue(id: string, name: string): StartupIssue {
  return {
    type: 'unresolvable',
    entryId: id,
    name,
    message: `插件包 ${name} 无法解析（profile node_modules 中不存在），启动 import 将失败`,
    fix: `dsh plugin add ${name}`,
    remove: REMOVE_HINT,
  }
}

/** Build a dependency issue reusing the staged-mount pre-check result. */
function dependencyIssue(
  id: string,
  name: string,
  precheck: PrecheckResult,
): StartupIssue {
  return {
    type: 'dependency',
    entryId: id,
    name,
    message: buildDependencyMessage(precheck),
    missingDeps: [...precheck.missing, ...precheck.mismatched.map((item) => item.name)],
    installHint: precheck.suggestions[0] ?? null,
    fix: precheck.suggestions[0] ?? `dsh plugin add ${name}`,
    remove: REMOVE_HINT,
  }
}

/** Build a duplicate-id issue for one id seen more than once. */
function duplicateIssue(id: string, names: string[]): StartupIssue {
  return {
    type: 'duplicate-id',
    entryId: id,
    name: names[0] ?? id,
    message: `名册存在重复条目 id "${id}"（${names.length} 处：${names.join('、')}），加载时将抛 duplicate loader entry id`,
    fix: null,
    remove: '从名册中删除重复的条目行（每个 id 保留一条）',
  }
}

/** Record an entry under its id for the duplicate-id sweep. */
function addSeen(map: Map<string, NormalizedRosterEntry[]>, id: string, item: NormalizedRosterEntry): void {
  const group = map.get(id)
  if (group === undefined) map.set(id, [item])
  else group.push(item)
}

/** Static checks for one roster row: resolvability + peers (dsh-* only). */
function checkPluginItem(
  issues: StartupIssue[],
  item: NormalizedRosterEntry,
  nmRoot: string,
  profileDir: string,
): void {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' ? item.name : ''
  const label = name !== '' ? name : id
  if (label === '' || !label.startsWith('dsh-')) return
  const pluginDir = findModuleDir(nmRoot, label)
  if (pluginDir === null) {
    issues.push(unresolvedIssue(id, label))
    return
  }
  const precheck = checkPeerDependencies({ profileDir, pluginName: label })
  if (!precheck.ok) issues.push(dependencyIssue(id, label, precheck))
}

/** Append one duplicate-id issue per id seen in more than one roster row. */
function collectDuplicateIssues(issues: StartupIssue[], byId: Map<string, NormalizedRosterEntry[]>): void {
  for (const [id, group] of byId) {
    if (group.length < 2) continue
    issues.push(
      duplicateIssue(
        id,
        group.map((item) => item.name ?? item.id ?? '?'),
      ),
    )
  }
}

/**
 * Core static pre-check over one roster's normalized entries.
 * entries: [{ id, name, disabled }] (see normalizeRoster). Checks dsh-*
 * plugins for package resolvability + peer deps, and the whole roster for
 * duplicate ids. Never throws — returns { issues }.
 */
export function checkStartupRoster({
  entries,
  profileDir,
}: {
  entries: NormalizedRosterEntry[]
  profileDir: string
}): { issues: StartupIssue[] } {
  const issues: StartupIssue[] = []
  const roster = Array.isArray(entries) ? entries : []
  const nmRoot = profileNodeModules(profileDir)
  const byId = new Map<string, NormalizedRosterEntry[]>()
  for (const item of roster) {
    if (item === null || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id : ''
    if (id !== '') addSeen(byId, id, item)
    checkPluginItem(issues, item, nmRoot, profileDir)
  }
  collectDuplicateIssues(issues, byId)
  return { issues }
}

/** Normalize raw tree entries into { id, name, disabled } roster rows. */
export function normalizeRoster(entries: LoaderEntry[]): NormalizedRosterEntry[] {
  return entries.map((entry) => {
    const labels = entryLabels(entry)
    return { id: labels.id, name: labels.name, disabled: isDisabledEntry(entry) }
  })
}

/**
 * Full startup pre-flight for one guardian instance: collect the roster from
 * the include tree, statically check it, persist the report and log an event.
 * Never throws — every failure degrades to a warn log (boot must continue).
 */
export async function runStartupCheck(ctx: DshContext, shared: SharedContext): Promise<void> {
  const entries = collectTreeEntries(shared.tree)
  const roster = normalizeRoster(entries).filter((item) => !item.disabled)
  const { issues } = checkStartupRoster({ entries: roster, profileDir: shared.profileDir })
  const checkedAt = Date.now()
  const payload: StartupIssuesPayload = { version: 1, checkedAt, profileDir: shared.profileDir, issues }
  await writeStartupIssuesFile(payload)
  shared.startupIssues = issues
  shared.startupCheckedAt = checkedAt
  if (issues.length > 0) {
    const names = [...new Set(issues.map((issue) => issue.name))].slice(0, 3).join('、')
    logEvent(
      shared,
      'startup-issue',
      `启动名册静态预检发现 ${issues.length} 个问题（${names}…）— 详见 guardian/startup-issues.json`,
    )
    shared.persistSoon()
    ctx.logger?.warn(
      `[dsh-my-guardian] startup roster pre-check: ${issues.length} issue(s) — see $DSH_HOME/guardian/startup-issues.json`,
    )
  }
}
