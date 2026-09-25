/**
 * dsh-my-guardian — dependency pre-check for the candidate mount pipeline.
 *
 * Reads a candidate plugin's package.json peerDependencies (from the profile
 * node_modules) and verifies each dependency is installed and version-satisfying
 * BEFORE the plugin is mounted. A failure is reported with its own classification
 * ('dependency-missing' / 'dependency-mismatch', #410) plus the separated
 * missingDeps / mismatchedDeps fields, and the mount is skipped — the plugin never
 * enters the runtime load path with a hole in its dependency graph
 * (issue #72: dsh-shared was not published).
 *
 * 安装建议（suggestions）只给**可执行**的命令：宿主（DSH 安装）自带的包
 * （@deepseek-ai/*、react / react-dom）不给命令——按提示执行会把宿主自有包的
 * 另一份拷贝装进 profile（#407/#410）；声明范围含空格 / 管道 / 比较符时也不给
 * 命令（拼出来无法执行）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { satisfies } from './dep-version.js'

interface PackageJson {
  version?: string
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/** 一个「版本不满足」的 peer：声明范围 vs 实装版本（结构化字段的载荷形状）。 */
export interface MismatchIssue {
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
// Module-private since #423: the startup-roster pre-check used to import it
// directly for its own-package lookup, but every caller now goes through
// resolvePackageDir() — keeping it exported would leave a dead public export
// behind (knip rejects that), and a second copy of the lookup is what #423 set
// out to remove.
function findModuleDir(nmRoot: string, packageName: string): string | null {
  const dir = join(nmRoot, packageName)
  return existsSync(join(dir, 'package.json')) ? dir : null
}

// Base package of a specifier: 'pkg' -> 'pkg', '@scope/pkg' -> '@scope/pkg',
// 'pkg/sub' -> 'pkg', '@scope/pkg/sub' -> '@scope/pkg'. Peer specs are package
// roots today, but resolving the base keeps the lookup correct for any spec.
export function basePackage(spec: string): string {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * Resolve a package directory along the same node_modules sequence Node itself
 * walks from the profile directory: the plugin's own nested node_modules (when
 * pluginDir is known), the profile node_modules (hoisted installs), then the
 * profiles root — `$DSH_HOME/profiles/node_modules`, where the harness links
 * its host-provided @deepseek-ai/* packages. Stopping at the profile dir made
 * every plugin declaring a host package as a peer look "missing" even though
 * Node resolves it by walking up to the profiles root (#412).
 *
 * Single source of truth (#423): the staged-mount peer pre-check, the roster
 * row's own-package check and the roster peer check all resolve through here,
 * so they can never drift into contradicting reports for the same tree. Pass
 * pluginDir = null for the "profile → profiles root" sequence a roster row's
 * own package needs. Returns the package directory, or null when both roots
 * miss it.
 */
export function resolvePackageDir(profileDir: string, pluginDir: string | null, spec: string): string | null {
  const base = basePackage(spec)
  const nested = pluginDir === null ? null : findModuleDir(join(pluginDir, 'node_modules'), base)
  if (nested !== null) return nested
  const inProfile = findModuleDir(join(profileDir, 'node_modules'), base)
  if (inProfile !== null) return inProfile
  return findModuleDir(join(profileDir, '..', 'node_modules'), base)
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
  const depDir = resolvePackageDir(profileDir, pluginDir, dep)
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

/** 宿主（DSH 安装）自带的包：装进 profile 只会多出一份拷贝并可能遮蔽宿主版本（#407）。 */
const HOST_PACKAGE_NAMES = new Set(['react', 'react-dom'])

/**
 * 该依赖是否由宿主（DSH 安装 / 宿主前端）提供，而不是「用户装进 profile 的包」。
 * @deepseek-ai/* 是宿主 runtime 供给的包；react / react-dom 由宿主前端运行时注入。
 * 对这类包给出 `dsh plugin add …` 建议 = 把宿主自有包的另一份拷贝装进 profile（#407/#410）。
 */
export function isHostProvided(spec: string): boolean {
  const base = basePackage(spec)
  return base.startsWith('@deepseek-ai/') || HOST_PACKAGE_NAMES.has(base)
}

/**
 * 声明范围能否直接拼进 `dsh plugin add <name>@<range>`：只接受单一 ^ / ~ / 精确
 * 版本。含空格、管道、比较符或空版本的范围（`^18.2.0 || ^19.3.0`）拼出来的命令
 * 在 shell 里无法执行（#410：畸形 installHint），一律不生成命令。
 */
const INSTALLABLE_RANGE = /^[~^]?\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/

function installableRange(range: unknown): string | null {
  return typeof range === 'string' && INSTALLABLE_RANGE.test(range) ? range : null
}

/**
 * 可执行的修复命令（#410）：宿主提供的包不给命令；版本不满足只在声明范围本身
 * 可安全拼进命令时给出钉住版本的命令，否则不给（宁缺勿畸形）。
 */
function buildSuggestions(missing: string[], mismatched: MismatchIssue[]): string[] {
  const suggestions: string[] = []
  for (const dep of missing) {
    if (isHostProvided(dep)) continue
    suggestions.push(`dsh plugin add ${dep}`)
  }
  for (const item of mismatched) {
    if (isHostProvided(item.name)) continue
    const range = installableRange(item.expected)
    if (range !== null) suggestions.push(`dsh plugin add ${item.name}@${range}`)
  }
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
 *
 * pluginDir: the caller may hand over an already-resolved package directory —
 * the startup-roster pre-check resolves a roster row through resolvePackageDir()
 * (profile → profiles root, #423) and passes it, so a row whose package lives
 * only in the profiles root still gets a REAL peer check instead of the skip.
 * Leaving it null keeps the candidate (staged) path byte-identical: it only
 * ever looks in the profile node_modules, and a miss stays a skip — never a
 * block (#423 expected behaviour 4).
 */
export function checkPeerDependencies({
  profileDir,
  pluginName,
  pluginDir = null,
}: {
  profileDir: string
  pluginName: string
  pluginDir?: string | null
}): PrecheckResult {
  const dir = pluginDir ?? findModuleDir(join(profileDir, 'node_modules'), basePackage(pluginName))
  if (dir === null) return skippedResult(`无法定位插件 ${pluginName}（未在 profile node_modules 找到 package.json）`)
  const pkg = readPackageJson(dir)
  if (pkg === null) return skippedResult(`无法解析 ${pluginName} 的 package.json`)
  const { missing, mismatched, warnings } = classifyPeers(
    objectOrEmpty(pkg.peerDependencies),
    objectOrEmpty(pkg.peerDependenciesMeta),
    dir,
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

/** 缺失一句：宿主提供的包不提示安装（#410：按提示执行会装错）。 */
function missingSentence(dep: string): string {
  return isHostProvided(dep)
    ? `宿主提供的依赖 ${dep} 未在 profile 解析（由宿主运行时供给，无需安装）`
    : `缺少依赖 ${dep}（请先安装）`
}

/** 版本不满足一句：单独成句，绝不复用「缺少依赖（请先安装）」文案（#410）。 */
function mismatchSentence(item: MismatchIssue): string {
  const sentence = `依赖版本不满足 ${item.name}：声明 ${item.expected}，当前 ${item.found}`
  return isHostProvided(item.name) ? `${sentence}（宿主提供，无需安装）` : sentence
}

/**
 * Build the message recorded for a failed pre-check. 缺失与版本不满足是两种结论，
 * 各自成句（#410）：此前二者被合并渲染成「缺少依赖 X（请先安装）」，把「装着但
 * 版本不在声明范围」误诊成缺失，并诱导用户把宿主自有包装进 profile。
 */
export function buildDependencyMessage(result: PrecheckResult): string {
  const missing = Array.isArray(result.missing) ? result.missing : []
  const mismatched = Array.isArray(result.mismatched) ? result.mismatched : []
  const sentences = [...missing.map(missingSentence), ...mismatched.map(mismatchSentence)]
  if (sentences.length === 0) return '依赖预检失败'
  return sentences.join('；')
}

/**
 * 预检失败的分类（#410）：硬缺失与版本不满足在面板/失败分类徽标上必须能区分。
 * 两者同时存在时记硬缺失（单一徽标字段只承载一个值，两类文案都进 message）。
 */
export function dependencyFailureType(result: Pick<PrecheckResult, 'missing' | 'mismatched'>): string {
  const missing = Array.isArray(result.missing) ? result.missing : []
  return missing.length > 0 ? 'dependency-missing' : 'dependency-mismatch'
}

/** Classify a mount failure for the isolation record (issue #86). */
export function classifyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Cannot find module|MODULE_NOT_FOUND|Cannot resolve/i.test(message)) return 'dependency'
  if (/already exists|already in use|conflict/i.test(message)) return 'other'
  return 'code'
}
