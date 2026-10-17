import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

/**
 * dep-resolution.mjs —— 「依赖解析一致性」门禁的判定内核（假绿根因复盘）。
 *
 * ## 它拦的是什么（真实事故，不是假想）
 * 2026-10-10 的两次 push：**本地 26 项全绿、CI 红 2 个 job**（dsh-my-notify /
 * dsh-task-reliability 的 test/config-store.mjs:220 断言 apiToken 为空对象）。
 * 根因不是测试、也不是 flake，而是**两侧解析到了不同实现**：
 *
 *   - 本地：plugins/dsh-my-notify/node_modules/dsh-shared 是 **registry 陈旧副本
 *     0.1.4**（Sep 14 安装、被 .gitignore 忽略、不在 lockfile 里），Node 解析时
 *     **优先命中它** → 用的是旧实现 → 测试绿。
 *   - CI：.github/workflows/ci.yml 只跑根 npm ci，plugins/<name>/ 没有自己的
 *     node_modules → 解析到 **workspace 真源码 0.1.6** → 新实现 → 测试红。
 *
 * 也就是说：各插件的 package.json 写 "dsh-shared": "^0.1.4"（registry 语义），本地被
 * 「旧的 registry 副本」满足、CI 被「workspace link」满足 —— 同一个断言在两侧判的是
 * **两份不同的代码**。这类假绿既掩盖真实回归（parseConfigBlock 把无值键建成空对象），
 * 又让「本地绿 ⇒ CI 绿」这条规范第七节彻底失效。
 *
 * ## 判据（本模块只做判定，不做修复）
 * 对每个 plugins/<name>，取它 package.json 里**声明的**依赖中那些名字属于本仓
 * workspace 包的（各插件 package.json 的 name，如 dsh-shared），逐个解析：
 *
 *   OK      ：解析结果 realpath 落在 <repo>/plugins/<pkg>/（npm workspace link 形态，
 *             根 node_modules/dsh-shared -> ../plugins/dsh-shared）
 *   SHADOWED：解析结果落在某个 node_modules/ 实体目录里 —— 典型就是 registry 陈旧副本。
 *             报告**遮蔽路径 + 副本版本 + 版本漂移**（副本版本 vs workspace 版本）。
 *   UNRESOLVED：声明了却解析不到（依赖没装 / 树损坏）—— 也判红，因为它意味着
 *             「本地压根没在测真源码」。
 *
 * ## 为什么按 realpath 判、而不是按「是不是符号链接」
 * 旧副本可以正好是**同版本**的实体目录（仍遮蔽源码），符号链接也可能指向 node_modules
 * 内部。只有「最终落在哪里」才是解析语义本身，其余都是启发式。
 *
 * ## 边界（绝不越界）
 * 本模块**只读不写**：不删、不装、不修，只报告路径与版本，把处置权留给人（写操作
 * fail-closed，见 AGENTS.md 强制规则）。也不检查第三方 registry 依赖（它们本来就该在
 * node_modules 里）。
 */

/** 行内代码标记：用运行时常量拼，避免注释里出现裸反引号（本文件在生成期位于模板字符串内）。 */
const BT = String.fromCharCode(96)
const NL = String.fromCharCode(10)

/** 读一个 JSON 文件；不存在 / 解析失败返回 null（判定要能容忍损坏的树，而不是抛异常）。 */
export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 收集本仓的 workspace 包：plugins 下每个 package.json 的 name → 源码目录。
 * 只认真实存在 package.json 且带 name 的目录，避免把空目录/临时目录算进来。
 */
export function workspacePackages(repoRoot) {
  const pluginsDir = join(repoRoot, 'plugins')
  const out = new Map()
  if (!existsSync(pluginsDir)) return out
  // 排序：让返回顺序稳定（测试与报告都按字典序，不受文件系统返回顺序影响）。
  const entries = readdirSync(pluginsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(pluginsDir, entry.name)
    const pkg = readJson(join(dir, 'package.json'))
    if (pkg === null || typeof pkg.name !== 'string' || pkg.name === '') continue
    out.set(pkg.name, { dir, version: typeof pkg.version === 'string' ? pkg.version : '(unknown)' })
  }
  return out
}

/** 某个插件的 package.json 里声明的依赖名（dependencies + devDependencies + peerDependencies）。 */
export function declaredDependencyNames(pluginDir) {
  const pkg = readJson(join(pluginDir, 'package.json'))
  if (pkg === null) return []
  const names = new Set()
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[field]
    if (deps === null || typeof deps !== 'object') continue
    for (const name of Object.keys(deps)) names.add(name)
  }
  return [...names]
}

/**
 * 解析一个裸依赖名；解析不到返回 null。
 * 用 createRequire(pluginDir/package.json) —— 与 Node 在插件目录里 import 时的解析起点
 * **完全一致**（不用 import.meta.resolve：那会从本脚本所在位置开始找，起点就错了）。
 */
export function resolveFrom(pluginDir, name) {
  try {
    return createRequire(join(pluginDir, 'package.json')).resolve(name)
  } catch {
    return null
  }
}

/** 路径是否位于某个 node_modules 目录内部（判定「实体副本遮蔽」的关键）。 */
export function isInsideNodeModules(absPath) {
  return absPath.split(sep).includes('node_modules')
}

/** 路径是否位于 dir 之内（用 relative 判，避免 /a/bc 被 /a/b 误判为子路径）。 */
export function isInsideDir(dir, absPath) {
  const rel = relative(dir, absPath)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** 取解析结果的 realpath（跟随符号链接）；失败则退回原路径。 */
export function realPathOf(p) {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/**
 * 判定单个「插件 → workspace 包」的解析一致性。
 * 返回 { status: 'ok' | 'shadowed' | 'unresolved', ... }。
 */
export function classifyResolution(pluginDir, name, pkg, repoRoot) {
  const resolved = resolveFrom(pluginDir, name)
  if (resolved === null) return { status: 'unresolved', name }
  const real = realPathOf(resolved)
  // ⚠️ 比较前必须把两边都过一遍 realpath：macOS 上 os.tmpdir() 返回 /var/...，而 realpath 会
  // 变成 /private/var/...；只归一化一侧就会把「同一条路径」误判成遮蔽（自测抓到过这个假红）。
  if (isInsideDir(realPathOf(pkg.dir), real)) return { status: 'ok', name, resolved: real }
  if (isInsideNodeModules(real)) {
    // ⚠️ createRequire().resolve() 返回的是**包的入口文件**（如 .../dsh-shared/index.js），
    // 不是包目录 —— 版本必须从入口文件所在目录读（直接 join(real,'package.json') 会得到
    // 不存在的 index.js/package.json → 版本永远是 unknown）。
    const version = readJson(join(dirname(real), 'package.json'))?.version ?? '(unknown)'
    return { status: 'shadowed', name, resolved: real, version, expected: pkg.version, repoRoot }
  }
  // 既不在 workspace 源码里、也不在 node_modules 里（第三方路径 / 全局链接）：一样是
  // 「本地测的不是真源码」，同样判红（归到 shadowed：解析目标不是仓库源码）。
  return { status: 'shadowed', name, resolved: real, version: '(non-repo path)', expected: pkg.version, repoRoot }
}

/**
 * 全仓扫描：每个插件 × 它声明的每个 workspace 内依赖。
 * 返回 { checked, violations, plugins }（violations 为空 = 解析一致）。
 */
export function checkDependencyResolution(repoRoot) {
  const packages = workspacePackages(repoRoot)
  // 统一成 realpath：报告里显示的相对路径与 classifyResolution 的比较必须用同一个基准。
  const realRoot = realPathOf(repoRoot)
  const pluginsDir = join(realRoot, 'plugins')
  const violations = []
  let checked = 0
  const plugins = []
  if (!existsSync(pluginsDir)) return { checked, violations, plugins }
  const entries = readdirSync(pluginsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const pluginDir = join(pluginsDir, entry.name)
    if (!existsSync(join(pluginDir, 'package.json'))) continue
    plugins.push(entry.name)
    for (const name of declaredDependencyNames(pluginDir)) {
      const pkg = packages.get(name)
      if (pkg === undefined) continue // 第三方依赖：不在本门禁范围内
      if (pkg.dir === pluginDir) continue // 包自己（dsh-shared 自身）
      checked += 1
      const result = classifyResolution(pluginDir, name, pkg, realRoot)
      if (result.status !== 'ok') violations.push({ plugin: entry.name, ...result })
    }
  }
  return { checked, violations, plugins }
}

/** 把 violations 渲染成人能直接照着修的文本（含遮蔽路径与版本漂移）。 */
export function renderViolations(violations, repoRoot) {
  const lines = [
    '检测到「依赖解析不一致」：插件解析到的不是仓库工作区源码，而是 node_modules 里的副本。',
    '这会让**本地测试与 CI 测到两份不同的代码**（CI 只跑根 npm ci，plugins/*/ 没有自己的 node_modules）。',
    '',
  ]
  for (const v of violations) {
    if (v.status === 'unresolved') {
      lines.push('  x plugins/' + v.plugin + ': 声明了 ' + v.name + ' 但解析失败（依赖未安装 / 树损坏）')
      continue
    }
    const shown = isInsideDir(repoRoot, v.resolved) ? relative(repoRoot, v.resolved) : v.resolved
    const drift =
      v.version === v.expected
        ? '版本相同（' + v.version + '）但仍遮蔽源码'
        : '副本 ' + v.version + ' != workspace ' + v.expected
    lines.push('  x plugins/' + v.plugin + ': ' + v.name + ' -> ' + shown + '  [' + drift + ']')
  }
  lines.push(
    '',
    '处置（本门禁只报告，不自动删）：删除上面这些 node_modules 内的副本，让解析回落到 workspace 源码。',
    '例如： rm -rf plugins/' + BT + '<插件>' + BT + '/node_modules/' + BT + '<包名>' + BT,
    '删除后请重跑该插件的 npm test —— 它从此测的是 CI 会测的那份代码。',
  )
  return lines.join(NL)
}
