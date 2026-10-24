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
 *
 * #481：桌面版宿主的 287 个 @deepseek-ai/* 包实体在 `app.asar/dsh/node_modules`
 * 归档内，profile 磁盘链一个都探不到 → 全量误报「缺少依赖」。解析顺序补上
 * 宿主清单（host-inventory.ts）：sharedPackages 提供版本、files 覆盖第三方包；
 * 裸名（cordis / schemastery）回退 `@deepseek-ai/<name>`；客户端插件（有
 * `dsh.client`）把宿主前端注入的 9 个静态模块视为已满足。
 *
 * #488：前端静态模块的判定不再要求 `dsh.client`，且裸名同样回退
 * `@deepseek-ai/<name>`——社区插件普遍把 `dsh-client-ui-primitives` 这类裸名写进
 * peer，磁盘与 asar 里都没有实体，判缺失只会刷屏并诱导装出双实例。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { satisfies } from './dep-version.js'
import { STATIC_MODULES, loadHostInventory } from './host-inventory.js'
import type { HostInventory } from './host-inventory.js'

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
  /** 版本来源：host = 宿主内置（只能靠升级 DSH 解决）；profile = 已装进 profile（#481）。 */
  source: 'host' | 'profile'
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

/** 一次预检的宿主侧上下文（#481 / #488）。 */
interface PeerContext {
  inventory: HostInventory
}

/**
 * 宿主安装目录是否提供该包（#481）。裸名回退：插件声明 `cordis` / `schemastery`
 * 时宿主实际以 `@deepseek-ai/cordis` / `@deepseek-ai/schemastery` 提供。
 */
function hostVersionOf(spec: string, inventory: HostInventory): { provided: boolean; version: string | null } {
  if (!inventory.available) return { provided: false, version: null }
  const base = basePackage(spec)
  const candidates = [spec, base]
  if (!base.startsWith('@')) candidates.push(`@deepseek-ai/${base}`)
  for (const name of candidates) {
    if (inventory.has(name)) return { provided: true, version: inventory.versionOf(name) }
  }
  return { provided: false, version: null }
}

/**
 * 宿主前端注入的静态模块（种子模块 9 项，磁盘与 asar 里都没有实体，#481/#488）。
 * 判定不依赖 `dsh.client`：社区插件常把 `dsh-client-ui-primitives` 这类裸名写进
 * peer，而这些模块只能由宿主前端提供——判缺失既修不好，也会诱导用户把另一份
 * 拷贝装进 profile（#407/#410 的同一类事故）。裸名按宿主命名回退
 * `@deepseek-ai/<name>`（与 hostVersionOf 同一约定）。
 */
function isHostSeedModule(spec: string): boolean {
  const base = basePackage(spec)
  if (STATIC_MODULES.has(spec) || STATIC_MODULES.has(base)) return true
  // cordis 例外：它在 server 侧由宿主清单 / profiles 根 node_modules 提供，前端注入
  // 不构成「server 侧可用」的证据——纯 Node 环境下它缺失是真问题（可选依赖走 warning）。
  if (base.startsWith('@') || base === 'cordis') return false
  return STATIC_MODULES.has(`@deepseek-ai/${base}`)
}

/** 声明范围是否不满足实装版本（空范围 / 未知版本视为满足）。 */
function isStaleVersion(version: string | null, range: string): boolean {
  return version !== null && typeof range === 'string' && range.trim() !== '' && !satisfies(version, range)
}

/** 版本不满足的结构化记录：host 表示宿主内置（只能靠升级 DSH 解决）。 */
function versionIssue(dep: string, range: string, version: string, source: 'host' | 'profile'): MismatchIssue {
  return { name: dep, expected: range, found: version, source }
}

/** 磁盘解析不到时的宿主侧判定；未命中返回 null（交给调用方判缺失）。 */
function examineHosted(dep: string, range: string, host: PeerContext): ExamineResult | null {
  // 宿主清单有版本 → 按版本判（版本不满足只 warn，用户装不了第二份）。
  const hosted = hostVersionOf(dep, host.inventory)
  if (hosted.provided) {
    if (!isStaleVersion(hosted.version, range)) return { kind: 'ok' }
    // 宿主内置包版本不满足 → warning（#481）：用户装不了第二份，也不该装；记成 dependency
    // 会让真实名册在每次 DSH 升级后刷屏一片「版本不满足」。
    return {
      kind: 'warn',
      message: `依赖 ${dep} 由 DSH 宿主内置（${hosted.version}），不在声明范围 ${range} 内：请升级 DSH 或调整插件声明`,
    }
  }
  // 前端种子模块由宿主注入（#481 / #488：react / react-dom 磁盘上永远「缺」）。
  if (isHostSeedModule(dep)) return { kind: 'ok' }
  return null
}

/** 磁盘解析到包之后的版本判定。 */
function examineInstalled(
  dep: string,
  range: string,
  optional: boolean,
  depDir: string,
  host: PeerContext,
): ExamineResult {
  const version = installedVersion(depDir)
  if (!isStaleVersion(version, range)) return { kind: 'ok' }
  const hosted = isHostProvided(dep) || hostVersionOf(dep, host.inventory).provided
  const issue = versionIssue(dep, range, version as string, hosted ? 'host' : 'profile')
  if (optional) return { kind: 'warn', message: `可选依赖 ${dep} 版本不满足：${range}（当前 ${version}）` }
  return { kind: 'mismatch', issue }
}

// Inspect a single peer dependency and classify the outcome.
function examinePeer(
  dep: string,
  range: string,
  optional: boolean,
  pluginDir: string | null,
  profileDir: string,
  host: PeerContext,
): ExamineResult {
  const depDir = resolvePackageDir(profileDir, pluginDir, dep)
  if (depDir === null) {
    const hosted = examineHosted(dep, range, host)
    if (hosted !== null) return hosted
    if (optional) return { kind: 'warn', message: `可选依赖 ${dep} 缺失（未安装）` }
    return { kind: 'missing', name: dep }
  }
  return examineInstalled(dep, range, optional, depDir, host)
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
    if (item.source === 'host') continue
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
  host: PeerContext,
): { missing: string[]; mismatched: MismatchIssue[]; warnings: string[] } {
  const missing: string[] = []
  const mismatched: MismatchIssue[] = []
  const warnings: string[] = []
  for (const [dep, range] of Object.entries(peers)) {
    const result = examinePeer(dep, range, meta[dep]?.optional === true, pluginDir, profileDir, host)
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
  hostInventory = loadHostInventory(),
}: {
  profileDir: string
  pluginName: string
  pluginDir?: string | null
  /** 宿主内置包清单（#481）：默认按宿主安装位置探测，测试/脚本可显式注入。 */
  hostInventory?: HostInventory
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
    { inventory: hostInventory },
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
    ? `宿主提供的依赖 ${dep} 未在 profile 解析（由宿主运行时供给，无需安装；宿主版本过旧请升级 DSH）`
    : `缺少依赖 ${dep}（请先安装）`
}

/** 版本不满足一句：单独成句，绝不复用「缺少依赖（请先安装）」文案（#410）。 */
function mismatchSentence(item: MismatchIssue): string {
  const sentence = `依赖版本不满足 ${item.name}：声明 ${item.expected}，当前 ${item.found}`
  if (item.source === 'host') return `${sentence}（由 DSH 宿主内置，请升级 DSH；装进 profile 只会遮蔽宿主版本）`
  return sentence
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
