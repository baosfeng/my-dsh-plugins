/**
 * directory route 的源码隔离副本：仓库内 link 形态依赖的识别与重建（verify-runtime.mjs 用）。
 *
 * 为什么需要它：verify-runtime 的 directory route 把插件目录 `cpSync` 到一个孤立的临时位置，
 * 而本仓库插件的依赖 `dsh-shared` 是**仓库内 link 形态**（根 node_modules/dsh-shared →
 * ../plugins/dsh-shared，物理源码落在仓库里而非任何 node_modules 内）。复制后的副本向上
 * 找不到任何 node_modules，于是 `ERR_MODULE_NOT_FOUND: Cannot find package 'dsh-shared'`
 * ——这是**工具自身的环境构造缺陷**，不是插件在新宿主下的激活失败。
 *
 * 前置条件（必须随诊断输出一起给出，否则结论会被误读）：本仓库 link 形态依赖的源码
 * 位于仓库内。源码被 `git archive` 之类方式冻结出仓库（例如只把 plugins/ 复制到 /tmp
 * 再 link）时，链目标不在，插件必然 failed to import —— 这是 link 形态的固有性质，
 * 与宿主版本无关（不是某个 DSH 版本引入的）。
 *
 * 因此本模块做两件事：把仓库内依赖**以链接方式**重建进副本；并在仍然失败时把失败判为
 * 「环境构造问题」而不是插件代码问题。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'

/** 随诊断输出给出的前置条件说明（环境构造问题一旦出现，结论必须带上它）。 */
export const REPO_LOCAL_NOTE =
  '本仓库 link 形态依赖（如 dsh-shared）的源码位于仓库内：隔离副本必须通过链接回指仓库内源码才能解析；' +
  '源码被冻结出仓库（git archive / 只复制 plugins/ 到 /tmp 再 link）时必然 failed to import，属 link 形态固有性质，与宿主版本无关。'

/** 参与依赖解析的 manifest 字段。 */
const DEP_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']

/** 模块解析失败的签名（与 verify-runtime.mjs 同判据，此处独立持有以避免循环依赖）。 */
const MODULE_RESOLVE_RE = /ERR_MODULE_NOT_FOUND|esm\/loader|Cannot find module|Cannot find package/i
const MISSING_SPEC_RE = /Cannot find (?:package|module) ['"]([^'"]+)['"]/g

/** 插件 package.json 声明的依赖名（去重排序）。 */
export function declaredDependencyNames(pkgDir) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  } catch {
    return []
  }
  const names = new Set()
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(manifest?.[field] ?? {})) names.add(name)
  }
  return [...names].sort()
}

/** 仓库根：优先 git；git 不可用时回退为「向上找含 .git 的目录」。找不到返回 null。 */
export function gitRepoRoot(dir) {
  try {
    const out = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 15_000 })
    if (out.status === 0 && out.stdout.trim()) return realpathSync(out.stdout.trim())
  } catch {
    /* 无 git：走目录回退 */
  }
  let current
  try {
    current = realpathSync(dir)
  } catch {
    return null
  }
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/** 解析结果是否落在仓库内、且不在任何 node_modules 内 = 仓库内 link 形态依赖。 */
export function isRepoLocalResolution(resolvedPath, repoRoot) {
  if (!resolvedPath || !repoRoot) return false
  let real
  try {
    real = realpathSync(resolvedPath)
  } catch {
    return false
  }
  let root = repoRoot
  try {
    root = realpathSync(repoRoot) // 两侧同基准比较（macOS /var → /private/var 这类别名）
  } catch {
    /* 根不存在时按传入值比较 */
  }
  root = root.endsWith(sep) ? root.slice(0, -1) : root
  if (real !== root && !real.startsWith(root + sep)) return false
  return !real.includes(`${sep}node_modules${sep}`)
}

/** 从插件位置解析一个依赖，返回解析到的文件路径（解析不到返回 null）。 */
export function resolveFromPlugin(pkgDir, name) {
  const require = createRequire(join(resolve(pkgDir), 'package.json')) // createRequire 需要绝对路径
  for (const spec of [`${name}/package.json`, name]) {
    try {
      return require.resolve(spec)
    } catch {
      /* 试下一个 spec 形态 */
    }
  }
  return null
}

/** 从包内文件路径向上找出包目录。 */
function packageDirOf(filePath) {
  let current = dirname(filePath)
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current
    const parent = dirname(current)
    if (parent === current) return dirname(filePath)
    current = parent
  }
}

/** 插件的仓库内 link 形态依赖名（注册表形态依赖不在其列，它们由 profile 安装负责）。 */
export function repoLocalDependencyNames(pkgDir, { repoRoot } = {}) {
  const root = repoRoot === undefined ? gitRepoRoot(pkgDir) : repoRoot
  if (!root) return []
  const names = []
  for (const name of declaredDependencyNames(pkgDir)) {
    const resolved = resolveFromPlugin(pkgDir, name)
    if (resolved && isRepoLocalResolution(resolved, root)) names.push(name)
  }
  return names
}

/** 在副本的 node_modules 下为仓库内依赖建链（副本自带的不覆盖），返回已建链的名。 */
export function linkRepoLocalDependencies(srcDir, copyDir, { repoRoot, names } = {}) {
  const list = names ?? repoLocalDependencyNames(srcDir, { repoRoot })
  const linked = []
  for (const name of list) {
    const resolved = resolveFromPlugin(srcDir, name)
    if (!resolved) continue
    const linkPath = join(copyDir, 'node_modules', ...name.split('/'))
    if (existsSync(linkPath)) continue
    mkdirSync(dirname(linkPath), { recursive: true })
    symlinkSync(packageDirOf(resolved), linkPath, 'dir')
    linked.push(name)
  }
  return linked.sort()
}

/**
 * directory route 的副本准备：复制插件源码 + 重建仓库内 link 依赖。
 * 返回值里的 note 非空时必须随诊断输出一起打印（前置条件）。
 */
export function prepareDirectoryCopy(srcDir, copyDir, { repoRoot } = {}) {
  cpSync(srcDir, copyDir, { recursive: true })
  const root = repoRoot === undefined ? gitRepoRoot(srcDir) : repoRoot
  const repoLocalDeps = linkRepoLocalDependencies(srcDir, copyDir, { repoRoot: root })
  return { repoRoot: root, repoLocalDeps, note: repoLocalDeps.length > 0 ? REPO_LOCAL_NOTE : '' }
}

/** 包名是否以词边界出现在日志里（`dsh-shared` 不得匹配 `dsh-shared-utils`）。 */
function nameAppearsInLog(log, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9._/-])${escaped}([^A-Za-z0-9._/-]|$)`).test(log)
}

/**
 * 判定一次模块解析失败是否由「仓库内 link 依赖在副本里解析不到」造成。
 *
 * 命中即返回环境构造问题（attribution = environment-construction），**绝不**归因
 * plugin-code 或普通的 dependency-resolution——这正是消除结构性假失败的那一步。
 * 非模块解析失败、或缺失的不是仓库内依赖时返回 null（交回既有归因链）。
 */
export function classifyRepoLocalFailure(log, { repoLocalDependencyNames: names = [] } = {}) {
  if (typeof log !== 'string' || names.length === 0 || !MODULE_RESOLVE_RE.test(log)) return null
  const missing = new Set()
  for (const match of log.matchAll(MISSING_SPEC_RE)) {
    const spec = match[1]
    missing.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
  }
  const hit = names.filter((name) => missing.has(name) || nameAppearsInLog(log, name))
  if (hit.length === 0) return null
  return {
    verdict: 'env-repo-local-dependency',
    attribution: 'environment-construction',
    repoLocalDeps: [...hit].sort(),
  }
}
