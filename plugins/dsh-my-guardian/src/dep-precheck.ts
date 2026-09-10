/**
 * dsh-my-guardian — dependency pre-check for the candidate mount pipeline.
 *
 * Reads a candidate plugin's package.json peerDependencies (from the profile
 * node_modules) and verifies each dependency is installed and version-satisfying
 * BEFORE the plugin is mounted. A hard-missing dependency is reported as a
 * pre-check failure (failureType 'dependency') with an install suggestion, and
 * the mount is skipped — the plugin never enters the runtime load path with a
 * hole in its dependency graph (issue #72: dsh-shared was not published).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { satisfies } from './dep-version.js'

interface PackageJson {
  version?: string
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

interface MismatchIssue {
  name: string
  expected: string
  found: string
}

export interface PrecheckResult {
  ok: boolean
  missing: string[]
  mismatched: MismatchIssue[]
  suggestions: string[]
  warnings: string[]
}

interface ExamineOk {
  kind: 'ok'
}

interface ExamineMissing {
  kind: 'missing'
  name: string
}

interface ExamineMismatch {
  kind: 'mismatch'
  issue: MismatchIssue
}

interface ExamineWarn {
  kind: 'warn'
  message: string
}

type ExamineResult = ExamineOk | ExamineMissing | ExamineMismatch | ExamineWarn

// Locate a package directory below a node_modules root, following symlinks
// (pnpm store / npm link both expose package.json through the mirrored dir).
// Exported for the startup-roster pre-check (issue #144): resolvability of a
// roster plugin's own package is verified before peer dependencies.
export function findModuleDir(nmRoot: string, packageName: string): string | null {
  const dir = join(nmRoot, packageName)
  return existsSync(join(dir, 'package.json')) ? dir : null
}

// Resolve a dependency from the plugin's nested node_modules or the profile
// node_modules (hoisted installs). Returns the dir or null when absent.
function resolveDependencyDir(profileDir: string, pluginDir: string | null, dep: string): string | null {
  const nested = pluginDir === null ? null : findModuleDir(join(pluginDir, 'node_modules'), dep)
  if (nested !== null) return nested
  return findModuleDir(join(profileDir, 'node_modules'), dep)
}

function readPackageJson(dir: string | null): PackageJson | null {
  if (dir === null) return null
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

function installedVersion(dir: string | null): string | null {
  const pkg = readPackageJson(dir)
  return pkg !== null && typeof pkg.version === 'string' ? pkg.version : null
}

// Inspect a single peer dependency and classify the outcome.
function examinePeer(
  dep: string,
  range: string,
  optional: boolean,
  pluginDir: string | null,
  profileDir: string,
): ExamineResult {
  const depDir = resolveDependencyDir(profileDir, pluginDir, dep)
  if (depDir === null) {
    if (optional) return { kind: 'warn', message: `可选依赖 ${dep} 缺失（未安装）` }
    return { kind: 'missing', name: dep }
  }
  const version = installedVersion(depDir)
  if (version !== null && typeof range === 'string' && range.trim() !== '' && !satisfies(version, range)) {
    const issue: MismatchIssue = { name: dep, expected: range, found: version }
    if (optional) return { kind: 'warn', message: `可选依赖 ${dep} 版本不满足：${range}（当前 ${version}）` }
    return { kind: 'mismatch', issue }
  }
  return { kind: 'ok' }
}

function buildSuggestions(missing: string[], mismatched: MismatchIssue[]): string[] {
  const suggestions = missing.map((dep) => `dsh plugin add ${dep}`)
  for (const item of mismatched) suggestions.push(`dsh plugin add ${item.name}@${item.expected}`)
  return suggestions
}

function objectOrEmpty<T>(value: T | undefined | null): T {
  return (value ?? {}) as T
}

// Group every peer into missing / mismatched / warning buckets.
function classifyPeers(
  peers: Record<string, string>,
  meta: Record<string, { optional?: boolean }>,
  pluginDir: string | null,
  profileDir: string,
): { missing: string[]; mismatched: MismatchIssue[]; warnings: string[] } {
  const missing: string[] = []
  const mismatched: MismatchIssue[] = []
  const warnings: string[] = []
  for (const [dep, range] of Object.entries(peers)) {
    const result = examinePeer(dep, range, meta[dep]?.optional === true, pluginDir, profileDir)
    if (result.kind === 'missing') missing.push(result.name)
    else if (result.kind === 'mismatch') mismatched.push(result.issue)
    else if (result.kind === 'warn') warnings.push(result.message)
  }
  return { missing, mismatched, warnings }
}

function skippedResult(reason: string): PrecheckResult {
  return { ok: true, missing: [], mismatched: [], suggestions: [], warnings: [`跳过依赖预检：${reason}`] }
}

/**
 * Pre-check the peer dependencies of a candidate plugin. Returns:
 *   { ok, missing, mismatched, suggestions, warnings }
 *  - missing: deps required (not optional) but absent from node_modules
 *  - mismatched: deps present at a version outside the declared range
 *  - suggestions: `dsh plugin add ...` repair commands
 *  - warnings: non-blocking notes (plugin unreadable / optional peers missing)
 * When the plugin or its package.json cannot be located the check is skipped
 * (ok: true) so an unusual install layout is never a false block.
 */
export function checkPeerDependencies({
  profileDir,
  pluginName,
}: {
  profileDir: string
  pluginName: string
}): PrecheckResult {
  const pluginDir = findModuleDir(join(profileDir, 'node_modules'), pluginName)
  if (pluginDir === null)
    return skippedResult(`无法定位插件 ${pluginName}（未在 profile node_modules 找到 package.json）`)
  const pkg = readPackageJson(pluginDir)
  if (pkg === null) return skippedResult(`无法解析 ${pluginName} 的 package.json`)
  const { missing, mismatched, warnings } = classifyPeers(
    objectOrEmpty(pkg.peerDependencies),
    objectOrEmpty(pkg.peerDependenciesMeta),
    pluginDir,
    profileDir,
  )
  return {
    ok: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched,
    suggestions: buildSuggestions(missing, mismatched),
    warnings,
  }
}

/** Build the "缺少依赖 X（请先安装）" message recorded for a failed pre-check. */
export function buildDependencyMessage(result: PrecheckResult): string {
  const names = [...result.missing, ...result.mismatched.map((item) => item.name)]
  if (names.length === 0) return '依赖预检失败'
  return names.map((name) => `缺少依赖 ${name}（请先安装）`).join('；')
}

/** Classify a mount failure for the isolation record (issue #86). */
export function classifyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Cannot find module|MODULE_NOT_FOUND|Cannot resolve/i.test(message)) return 'dependency'
  if (/already exists|already in use|conflict/i.test(message)) return 'other'
  return 'code'
}
