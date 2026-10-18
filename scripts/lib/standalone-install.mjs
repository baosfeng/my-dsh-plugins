import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * standalone-install.mjs —— 「插件可单独安装」门禁的判定内核（issue #485 复盘）。
 *
 * ## 它拦的是什么（真实事故，不是假想）
 * issue #485：dsh-my-context / dsh-my-memory / dsh-my-observability / dsh-my-skill-manager
 * 把本仓内部包 dsh-shared 写在 peerDependencies。用户在 DSH 里单装后**启动即
 * failed to import（MODULE_NOT_FOUND）**——包管理器默认不装 peer（pnpm 完全不装），
 * 而作者的本地根 node_modules 恰好有 dsh-shared，所以本地/CI 永远绿。
 * 那次修复把 dsh-shared 挪进 12 个包的 dependencies 并重新发布；但**同类病根还有两条
 * 现有门禁覆盖不到的路**：
 *
 *   ① 运行期 import 了某个裸包（registry 包或 workspace 包），package.json 里**完全没声明**
 *      → 本地根 node_modules 恰好有 → 本地绿；用户单装即 failed to import。
 *      现有 check-dep-resolution 只判「声明过的 workspace 包解析落点」，看不见"根本没声明"。
 *   ② 打包产物单装后入口加载失败（files 漏文件、依赖树缺包、exports 指向不存在文件）
 *      → 现有 check-pack-hygiene 只对仓库内的文件与 npm pack 清单做断言，不做"真装一次再
 *      import"的端到端冒烟。
 *
 * 用户目标原话：「让每个插件都可以单独安装，有依赖的话，就安装的时候自己下载依赖，
 * 全部自动化，而不是没安装好依赖，就启动报错」。本模块就是这条目标的机器判据。
 *
 * ## 判据（三条，冻结）
 * A. server 面依赖完整性（静态）：从 server 入口（exports["."].default 或 main）建**相对
 *    导入图**，图上出现的每个裸包都必须在 dependencies 里，或属于宿主供给白名单：
 *    Node 内置 / cordis / react / react-dom / @deepseek-ai/*
 *    （浏览器端 exports["./client"] 的 bundle 不扫：它由宿主 ModuleLoader 注入 react 等，
 *    属宿主供给面；它的存在性由 check-pack-hygiene 管，这里不重复。）
 * B. 非宿主包写成 peer（静态）：peerDependencies 里出现白名单之外、又不在 dependencies
 *    里的包 → 判红（包管理器不装 peer，用户装完缺包）。workspace 包的 peer-only 判据已由
 *    check-dep-resolution 负责，这里跳过，避免重复门禁。
 * C. 离线单装冒烟（核心证据，绝不联网）：npm pack → 解压到临时 node_modules/<pkg> →
 *    为它的 dependencies 建最小依赖树（workspace 包同样 pack；registry 包从仓库根
 *    node_modules 复制实体）→ 起子进程 import 入口，断言退出码 0 且 stderr 无
 *    ERR_MODULE_NOT_FOUND。根 node_modules 缺包时 fail-closed 判红
 *    （unresolvable-dependency），绝不静默跳过。
 *
 * ## 为什么白名单这样定、为什么只建议「移到 dependencies」
 * 宿主运行期真的会提供 cordis / react / react-dom / @deepseek-ai/*，所以它们写 peer 是
 * 正当的；给 @deepseek-ai/* 这类宿主包也声明 peer，会触发宿主兼容性门禁拒装
 * （issue #485 关联事故），因此缺口信息里只建议「多数情况应移到 dependencies」。
 *
 * ## 边界（绝不越界）
 * 本模块**只读不写**：不删、不装、不联网。npm pack / tar 解压 / 依赖复制 / 子进程 import
 * 全部由调用方以注入对象（io）提供，本模块只做判定与编排；所有产物只落调用方给的临时
 * 目录，由调用方清理。判定纯函数（除 auditOfflineInstall/auditPlugin 的编排外）都可单测。
 */

/** 宿主运行期注入的模块（白名单第 2/3 段；第 1 段是 Node 内置）。 */
export const HOST_PACKAGES = Object.freeze(['cordis', 'react', 'react-dom'])

/** 宿主官方包的 scope 前缀（@deepseek-ai/dsh-client-ui-primitives 等由宿主注入）。 */
export const HOST_SCOPE_PREFIX = '@deepseek-ai/'

/** 相对导入图的安全上限：超过说明解析逻辑或仓库形态异常，宁可 fail-closed 也不静默截断。 */
export const MAX_GRAPH_FILES = 1000

/**
 * 剥掉 JS 源码里的注释（保留字符串原文），避免注释里的 import/require 造成假红。
 * 只处理注释与字符串/模板三种状态的切换，不做完整语法分析——门禁只需要"别把注释当代码"。
 */
export function stripComments(source) {
  let out = ''
  let state = 'code'
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line'
        i += 1
      } else if (ch === '/' && next === '*') {
        state = 'block'
        i += 1
      } else {
        if (ch === "'" || ch === '"' || ch === '`') state = ch
        out += ch
      }
      continue
    }
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code'
        out += ch
      }
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code'
        out += ' '
        i += 1
      } else if (ch === '\n') {
        out += ch
      }
      continue
    }
    // 字符串 / 模板态：原样保留（含转义），让后面的正则仍能匹配 import 'x'
    out += ch
    if (ch === '\\') {
      out += next ?? ''
      i += 1
    } else if (ch === state) {
      state = 'code'
    }
  }
  return out
}

/** 提取 import / require / export-from 的模块说明符（静态正则，够用且不误判注释）。 */
export function extractImportSpecifiers(source) {
  const out = []
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g
  for (const match of stripComments(source).matchAll(re)) out.push(match[2])
  return out
}

/** 把说明符分类：relative（相对/绝对路径）、builtin（Node 内置）、bare（要按包解析）。 */
export function classifySpecifier(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return { kind: 'relative', name: specifier }
  if (specifier.startsWith('node:') || builtinModules.includes(specifier)) {
    return { kind: 'builtin', name: specifier }
  }
  const parts = specifier.split('/')
  // @scope/x/sub → @scope/x；x/sub → x
  return { kind: 'bare', name: specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] }
}

/** 是否由宿主 / Node 运行期提供（这类裸包不需要写在 dependencies）。 */
export function isHostProvided(name) {
  if (name.startsWith('node:') || builtinModules.includes(name)) return true
  if (HOST_PACKAGES.includes(name)) return true
  return name.startsWith(HOST_SCOPE_PREFIX)
}

/** 取 server 入口的相对路径（exports["."].default 优先，其次 main）；没有则 null。 */
export function serverEntryOf(pkg) {
  const dot = pkg?.exports?.['.']
  const candidate = typeof dot === 'string' ? dot : dot?.default
  const main = typeof pkg?.main === 'string' ? pkg.main : null
  const raw = typeof candidate === 'string' && candidate !== '' ? candidate : main
  if (raw === null || raw === '') return null
  return raw.replace(/^\.\//, '')
}

/**
 * 解析相对导入：先按原路径，再按无扩展名补 .js/.mjs/.cjs 与目录 index.js。
 * exists 由调用方注入（判定内核不直接碰 fs）。
 */
export function resolveRelativeFile(fromFile, specifier, exists) {
  const base = resolve(dirname(fromFile), specifier)
  if (/\.[cm]?js$/.test(base)) return exists(base) ? base : null
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, join(base, 'index.js')]
  return candidates.find((candidate) => exists(candidate)) ?? null
}

/**
 * 从 server 入口出发建立相对导入图（BFS）。
 * 返回 { entry, files, bare, unresolved }：
 *   files      —— 图上真实读到的文件
 *   bare       —— 裸包引用 [{ name, specifier, from }]（含 Node 内置与宿主包，由判据过滤）
 *   unresolved —— 相对导入指向不存在的文件（提示用；真正的"装完加载失败"由判据 C 抓）
 */
export function collectServerGraph({ entry, readFile, exists }) {
  const files = []
  const bare = []
  const unresolved = []
  const seen = new Set()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()
    if (seen.has(file)) continue
    if (seen.size >= MAX_GRAPH_FILES) {
      throw new Error(`server 相对导入图超过 ${MAX_GRAPH_FILES} 个文件（${entry}），拒绝静默截断`)
    }
    seen.add(file)
    const source = readFile(file)
    if (source === null) {
      unresolved.push({ from: null, specifier: file })
      continue
    }
    files.push(file)
    for (const specifier of extractImportSpecifiers(source)) {
      const kind = classifySpecifier(specifier)
      if (kind.kind === 'builtin') continue
      if (kind.kind === 'bare') {
        bare.push({ name: kind.name, specifier, from: file })
        continue
      }
      const target = resolveRelativeFile(file, specifier, exists)
      if (target === null) unresolved.push({ from: file, specifier })
      else queue.push(target)
    }
  }
  return { entry, files, bare, unresolved }
}

/** 判据 A：server 面的每个裸包都必须 ∈ dependencies，或属宿主白名单。同名多文件合并一条。 */
export function findMissingDeclarations({ pkg, graph }) {
  const deps = pkg?.dependencies ?? {}
  const byName = new Map()
  for (const item of graph.bare) {
    if (isHostProvided(item.name)) continue
    if (Object.prototype.hasOwnProperty.call(deps, item.name)) continue
    const prev = byName.get(item.name)
    if (prev === undefined) {
      byName.set(item.name, {
        code: 'missing-declaration',
        name: item.name,
        specifier: item.specifier,
        from: [item.from],
      })
    } else if (!prev.from.includes(item.from)) {
      prev.from.push(item.from)
    }
  }
  return [...byName.values()]
}

/**
 * 判据 B：非宿主包只写在 peerDependencies（不在 dependencies）→ 判红。
 * workspace 包跳过：那条判据由 check-dep-resolution 负责，这里不重复报。
 */
export function findPeerOnlyRuntimeDeps({ pkg, workspaceNames }) {
  const deps = pkg?.dependencies ?? {}
  const peer = pkg?.peerDependencies ?? {}
  const out = []
  for (const name of Object.keys(peer)) {
    if (isHostProvided(name)) continue
    if (Object.prototype.hasOwnProperty.call(deps, name)) continue
    if (workspaceNames.has(name)) continue
    out.push({ code: 'peer-only-runtime', name })
  }
  return out
}

/** 从依赖包的 package.json 文本里取 dependencies 名（容错：读不到就返回空数组）。 */
export function dependencyNamesOf(pkgJsonText) {
  if (typeof pkgJsonText !== 'string') return []
  try {
    const parsed = JSON.parse(pkgJsonText)
    const deps = parsed?.dependencies
    return deps !== null && typeof deps === 'object' ? Object.keys(deps) : []
  } catch {
    return []
  }
}

/** 从 stderr 里挑出最有诊断价值的一行（优先真实错误行，其次 Error，最后首行）。 */
export function firstErrorLine(stderr) {
  const lines = (typeof stderr === 'string' ? stderr : '')
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return (
    lines.find((line) => line.includes('Cannot find package')) ??
    lines.find((line) => line.startsWith('Error [')) ??
    lines.find((line) => line.includes('ERR_MODULE_NOT_FOUND')) ??
    lines.find((line) => /error/i.test(line)) ??
    lines[0] ??
    ''
  )
}

/** 按安装失败原因映射成缺口（fail-closed：拿不到实体包不静默跳过）。 */
function mapInstallFailure(name, result) {
  if (result.reason === 'missing') {
    return {
      code: 'unresolvable-dependency',
      name,
      message: `根 devDependencies 缺少 ${name}，离线冒烟无法验证（用户单装时它会被 npm 下载；本机需要一份实体包才能冒烟）`,
      hint: `把 ${name} 加进根 devDependencies（仅用于离线冒烟），或改用 workspace 包提供该依赖`,
    }
  }
  return {
    code: result.reason === 'pack-failed' ? 'pack-failed' : 'copy-failed',
    name,
    message: result.error ?? `安装 ${name} 到临时依赖树失败`,
    hint: '检查 npm / tar 是否可用、文件权限与 package.json 是否完整（本门禁不联网，也不会自动补救）',
  }
}

/**
 * 判据 C：离线单装冒烟（编排注入的 io；不联网）。
 * io 需提供：
 *   installWorkspacePackage({ dir, target, packsDir }) → { ok, error? }   源码包 → npm pack + 解压
 *   installRegistryPackage({ name, rootModulesDir, target }) → { ok, reason?, error? }  根 node_modules 实体复制
 *   runImport({ entryFile, cwd }) → { status, stderr?, stdout? }
 *   readFile(absPath) → string|null
 * 返回 { violations, installed, selfPacked }。
 */
export async function auditOfflineInstall({ pkg, dir, workspaceDirs, sandbox, io, entryRel }) {
  const violations = []
  const installed = []
  const failed = new Set()
  const queue = Object.keys(pkg?.dependencies ?? {}).sort()
  while (queue.length > 0) {
    const name = queue.shift()
    if (installed.includes(name) || failed.has(name)) continue
    const target = join(sandbox.modulesDir, name)
    const workspaceDir = workspaceDirs.get(name)
    const result =
      workspaceDir === undefined
        ? await io.installRegistryPackage({ name, rootModulesDir: sandbox.repoModulesDir, target })
        : await io.installWorkspacePackage({ dir: workspaceDir, target, packsDir: sandbox.packsDir })
    if (!result.ok) {
      failed.add(name)
      violations.push(mapInstallFailure(name, result))
      continue
    }
    installed.push(name)
    const childText = io.readFile(join(target, 'package.json'))
    for (const child of dependencyNamesOf(childText)) {
      if (!installed.includes(child) && !failed.has(child)) queue.push(child)
    }
  }
  const selfTarget = join(sandbox.modulesDir, pkg.name)
  const self = await io.installWorkspacePackage({ dir, target: selfTarget, packsDir: sandbox.packsDir })
  if (!self.ok) {
    violations.push({
      code: 'pack-failed',
      name: pkg.name,
      message: self.error ?? 'npm pack / 解压插件自身失败',
      hint: '确认插件目录完整、npm 可用；本门禁不联网也不执行生命周期脚本',
    })
    return { violations, installed, selfPacked: false }
  }
  if (entryRel === null) {
    violations.push({
      code: 'import-failed',
      name: pkg.name,
      message: 'package.json 没有可用的 server 入口（exports["."].default / main），单装后宿主无从加载',
      hint: '补 exports["."].default 或 main，指向随包发布的入口文件（并由 files 白名单带上）',
    })
    return { violations, installed, selfPacked: true }
  }
  const run = await io.runImport({ entryFile: join(selfTarget, entryRel), cwd: sandbox.dir })
  const stderr = typeof run.stderr === 'string' ? run.stderr : ''
  const ok = run.status === 0 && !stderr.includes('ERR_MODULE_NOT_FOUND')
  if (!ok) {
    violations.push({
      code: 'import-failed',
      name: pkg.name,
      message: `离线单装后入口加载失败（exit ${run.status ?? '?'}）`,
      stderr: firstErrorLine(stderr),
      hint:
        '先看 stderr：files 漏文件 → 补 files 白名单；缺包 → 把依赖写进 dependencies；' +
        'exports 指向不存在文件 → 修正路径。若这是宿主运行期注入的模块，确认它是否该进白名单（cordis / react / react-dom / @deepseek-ai/*）',
    })
  }
  return { violations, installed, selfPacked: true }
}

/** 单插件全量判定（A 静态声明 + B peer 形态 + C 离线冒烟）；返回可直接渲染的结果。 */
export async function auditPlugin({ plugin, dir, pkg, workspaceDirs, sandbox, io }) {
  const entryRel = serverEntryOf(pkg)
  const graph =
    entryRel === null
      ? { entry: null, files: [], bare: [], unresolved: [] }
      : collectServerGraph({ entry: join(dir, entryRel), readFile: io.readFile, exists: io.exists })
  const toRelative = (files) => files.map((file) => relative(dir, file))
  // 每条缺口都带上插件目录名：报告与 --json 消费方都要能直接定位到 plugins/<name>。
  const violations = [
    ...findMissingDeclarations({ pkg, graph }).map((item) => ({ ...item, from: toRelative(item.from) })),
    ...findPeerOnlyRuntimeDeps({ pkg, workspaceNames: new Set(workspaceDirs.keys()) }),
  ].map((item) => ({ plugin, ...item }))
  const offline = await auditOfflineInstall({ pkg, dir, workspaceDirs, sandbox, io, entryRel })
  violations.push(...offline.violations.map((item) => ({ plugin, ...item })))
  const bareImports = []
  for (const item of graph.bare) {
    if (classifySpecifier(item.name).kind === 'builtin' || isHostProvided(item.name)) continue
    if (!bareImports.includes(item.name)) bareImports.push(item.name)
  }
  return {
    plugin,
    dir,
    name: typeof pkg?.name === 'string' ? pkg.name : plugin,
    version: typeof pkg?.version === 'string' ? pkg.version : '(unknown)',
    entry: entryRel,
    serverFiles: graph.files.length,
    bareImports,
    graphUnresolved: graph.unresolved.map((item) => ({
      specifier: item.specifier,
      from: item.from === null ? '(入口文件)' : relative(dir, item.from),
    })),
    installedDependencies: offline.installed,
    violations,
  }
}

/** 每种缺口的「为什么 + 建议」（正向表述：推荐/多数情况应…）。 */
const ADVICE = Object.freeze({
  'missing-declaration': {
    why: 'server 入口运行期 import 了它，但 package.json 没有声明；本地根 node_modules 恰好有 → 本地绿，用户单装即 failed to import',
    fix: '多数情况应把它加到 dependencies（安装时会自动下载）；只有宿主运行期注入的包才留在 peerDependencies',
  },
  'peer-only-runtime': {
    why: '只写在 peerDependencies：包管理器默认不装 peer（pnpm 完全不装）→ 用户装完启动即 failed to import',
    fix: '多数情况应把它从 peerDependencies 移到 dependencies，让安装时自动下载',
  },
  'unresolvable-dependency': {
    why: '离线冒烟需要一份实体包才能验证依赖树，仓库根 node_modules 里没有它',
    fix: '把该包加进根 devDependencies（仅供离线冒烟），或改用 workspace 包提供',
  },
  'import-failed': {
    why: '打包产物在临时目录单装后，入口 import 失败——这正是用户机器上看到的形态',
    fix: '按 stderr 定位：files 漏文件 → 补 files；缺包 → 写进 dependencies；exports 路径错 → 修路径',
  },
  'pack-failed': {
    why: 'npm pack / 解压失败，本门禁无法拿到可安装的产物（fail-closed）',
    fix: '确认 npm、tar 可用且插件目录完整，然后重跑本门禁',
  },
  'copy-failed': {
    why: '把根 node_modules 里的实体包复制进临时依赖树失败（fail-closed）',
    fix: '确认该包在根 node_modules 里是实体目录、权限正常，然后重跑本门禁',
  },
})

/** 渲染单个缺口。 */
function renderViolation(violation) {
  const advice = ADVICE[violation.code] ?? { why: '', fix: '' }
  const lines = [`  x plugins/${violation.plugin}: [${violation.code}] ${violation.name ?? violation.message}`]
  if (violation.message !== undefined && violation.name !== undefined) lines.push(`      现象：${violation.message}`)
  if (Array.isArray(violation.from) && violation.from.length > 0) {
    lines.push(`      位置：${violation.from.slice(0, 3).join('、')}${violation.from.length > 3 ? ' …' : ''}`)
  }
  if (typeof violation.stderr === 'string' && violation.stderr !== '') {
    lines.push(`      stderr：${violation.stderr.split('\n')[0]}`)
  }
  if (advice.why !== '') lines.push(`      为什么：${advice.why}`)
  if (violation.hint !== undefined) lines.push(`      建议：${violation.hint}`)
  else if (advice.fix !== '') lines.push(`      建议：${advice.fix}`)
  return lines
}

/**
 * 渲染完整报告（通过 / 失败都走这里）。
 * result: { root, results, violations, checked }
 */
export function renderReport(result) {
  const { root, results, violations } = result
  const pluginCount = results.length
  const bareCount = results.reduce((sum, item) => sum + item.bareImports.length, 0)
  const offlineCount = results.filter((item) => item.entry !== null).length
  if (violations.length === 0) {
    return [
      `standalone-install 通过：${pluginCount} 个插件，server 面 ${bareCount} 条裸包 import 全部有声明；` +
        `${offlineCount} 个包离线单装 + 入口加载全部成功`,
    ].join('\n')
  }
  const lines = ['检测到「单独安装后不可用」的缺口（判据 A 静态声明 / B peer 形态 / C 离线单装冒烟）：', '']
  for (const violation of violations) lines.push(...renderViolation(violation), '')
  const unresolved = results.flatMap((item) => item.graphUnresolved.map((entry) => ({ plugin: item.plugin, ...entry })))
  if (unresolved.length > 0) {
    lines.push('附注：server 源码里有相对导入指向不存在的文件（判据 C 会以加载失败的形式暴露）：')
    for (const item of unresolved.slice(0, 10)) {
      lines.push(`  - plugins/${item.plugin}: ${item.from} → ${item.specifier}`)
    }
    lines.push('')
  }
  const elapsed = typeof result.wallMs === 'number' ? `，耗时 ${result.wallMs}ms` : ''
  lines.push(
    `合计 ${violations.length} 处缺口（${pluginCount} 个插件 / ${bareCount} 条 server 裸包 import / ` +
      `${offlineCount} 个离线单装冒烟）${elapsed}`,
    '',
    `复现：node scripts/check-standalone-install.mjs` + (root === undefined ? '' : ` --root ${root}`),
  )
  return lines.join('\n')
}
