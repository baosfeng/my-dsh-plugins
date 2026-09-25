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
import {
  resolvePackageDir,
  checkPeerDependencies,
  buildDependencyMessage,
  dependencyFailureType,
  basePackage,
  isHostProvided,
} from './dep-precheck.js'
import type { PrecheckResult } from './dep-precheck.js'
import { writeStartupIssuesFile } from './state.js'
import type { SharedContext, StartupIssue, StartupIssuesPayload } from './state.js'
import { logEvent } from './events.js'
import type { DshContext, LoaderEntry, LoaderTree } from './types.js'

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
  const options = entry !== null && typeof entry === 'object' ? (entry.options ?? null) : null
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

/** Build an unresolvable-package issue (import stage would fail). `installTarget`
 * is the base package: a roster row may name a subpath export, and
 * `dsh plugin add pkg/sub` would install the wrong thing. */
function unresolvedIssue(id: string, name: string, installTarget: string): StartupIssue {
  return {
    type: 'unresolvable',
    entryId: id,
    name,
    message: `插件包 ${name} 无法解析（profile 与 profiles 根 node_modules 中均不存在），启动 import 将失败`,
    fix: `dsh plugin add ${installTarget}`,
    remove: REMOVE_HINT,
  }
}

/**
 * Build a dependency issue reusing the staged-mount pre-check result. #410：硬缺失
 * 与版本不满足分成两个 issue 类型，结构化字段各自独立；没有可安全执行的修复命令
 * 时 fix 为 null——宿主提供的包（@deepseek-ai/*、react/react-dom）给 `dsh plugin
 * add …` 只会把宿主自有包的另一份拷贝装进 profile（#407），不如不给。
 */
function dependencyIssue(id: string, name: string, precheck: PrecheckResult): StartupIssue {
  const hint = precheck.suggestions[0] ?? null
  return {
    type: dependencyFailureType(precheck),
    entryId: id,
    name,
    message: buildDependencyMessage(precheck),
    missingDeps: precheck.missing,
    mismatchedDeps: precheck.mismatched,
    installHint: hint,
    fix: hint,
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

/** 一次名册预检的统计（#424 A′）：被跳过的宿主供给行必须可见，不得静默消失。 */
interface RosterStats {
  skippedHostRows: number
}

/**
 * Static checks for one roster row (#144, reshaped by #423 / #424 A′):
 *  - resolvability: EVERY row with a non-empty label is checked (scoped and
 *    subpath rows included), through the same resolvePackageDir() sequence as
 *    #423 (profile node_modules → profiles root). Only a miss on both roots is
 *    'unresolvable';
 *  - host-provided rows (@deepseek-ai/*, react / react-dom) are SKIPPED and
 *    counted: their real root is the harness install directory, which neither
 *    of the two roots reaches, so checking them could only produce false
 *    "unresolvable" reports (#424 A′). The count is surfaced in the report;
 *  - peers: still non-scoped rows only (#424 A′ does not widen the peer scope).
 */
function checkPluginItem(
  issues: StartupIssue[],
  item: NormalizedRosterEntry,
  profileDir: string,
  stats: RosterStats,
): void {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' ? item.name : ''
  const label = name !== '' ? name : id
  if (label === '') return
  if (isHostProvided(label)) {
    stats.skippedHostRows += 1
    return
  }
  // A row may name a subpath export ('dsh-openwrite/bridge'), which is not a
  // directory under node_modules; the installable package is the base and the
  // export map resolves the subpath at import time. Treating the whole name
  // as a directory produced a false "unresolvable" for every subpath row.
  const base = basePackage(label)
  // #423: the row's own package resolves through the SAME sequence as its
  // peers — a hit must not mask the peer check below (it used to return early).
  const pluginDir = resolvePackageDir(profileDir, null, label)
  if (pluginDir === null) {
    issues.push(unresolvedIssue(id, label, base))
    return
  }
  // 非 scoped 行才做 peer 检查：#424 A′ 保持 peer 判定范围不变（宿主 scoped 行的
  // peer 由宿主运行时供给，纳入判定只会制造 #407/#410 式的噪声）。
  if (label.startsWith('@')) return
  const precheck = checkPeerDependencies({ profileDir, pluginName: base, pluginDir })
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
 * 报告里显式写出被跳过的宿主供给行（#424 A′）：跳过是为了不误报，但绝不能让这些行
 * 在报告里无声消失——「0 条问题」必须能区分「都查过且没问题」与「有几行没查」。
 */
export function hostSkipNotes(count: number): string[] {
  if (!(typeof count === 'number' && count > 0)) return []
  return [
    `已跳过 ${count} 个宿主供给行（@deepseek-ai/* / react / react-dom，由宿主安装目录提供，不在 profile 两段根内）`,
  ]
}

/**
 * Core static pre-check over one roster's normalized entries.
 * entries: [{ id, name, disabled }] (see normalizeRoster). Checks every row
 * for package resolvability, non-scoped rows for peer deps, and the whole
 * roster for duplicate ids. Never throws — returns { issues, skippedHostRows }.
 */
export function checkStartupRoster({ entries, profileDir }: { entries: NormalizedRosterEntry[]; profileDir: string }): {
  issues: StartupIssue[]
  skippedHostRows: number
} {
  const issues: StartupIssue[] = []
  const roster = Array.isArray(entries) ? entries : []
  const stats: RosterStats = { skippedHostRows: 0 }
  const byId = new Map<string, NormalizedRosterEntry[]>()
  for (const item of roster) {
    if (item === null || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id : ''
    if (id !== '') addSeen(byId, id, item)
    checkPluginItem(issues, item, profileDir, stats)
  }
  collectDuplicateIssues(issues, byId)
  return { issues, skippedHostRows: stats.skippedHostRows }
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
  const { issues, skippedHostRows } = checkStartupRoster({ entries: roster, profileDir: shared.profileDir })
  const checkedAt = Date.now()
  const notes = hostSkipNotes(skippedHostRows)
  const payload: StartupIssuesPayload = {
    version: 1,
    checkedAt,
    profileDir: shared.profileDir,
    issues,
    skippedHostRows,
    notes,
  }
  await writeStartupIssuesFile(payload)
  shared.startupIssues = issues
  shared.startupCheckedAt = checkedAt
  shared.startupSkippedHostRows = skippedHostRows
  shared.startupNotes = notes
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
