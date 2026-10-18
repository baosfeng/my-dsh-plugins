#!/usr/bin/env node
/**
 * 插件「单独安装」门禁 —— scripts/check-standalone-install.mjs（issue #485）
 *
 * 拦的是什么（真实事故）：issue #485 里 4 个插件把内部包 dsh-shared 写在
 * peerDependencies，用户单独安装后**启动即 failed to import（MODULE_NOT_FOUND）**——
 * 包管理器不装 peer，而作者本地根 node_modules 恰好有该包，所以本地/CI 全绿。
 * 修复把 dsh-shared 挪进了 dependencies；但同类病根还有两条既有门禁覆盖不到的路：
 *   ① 运行期 import 了裸包却完全没声明 → 本地根 node_modules 恰好有 → 用户单装即失败；
 *   ② 打包产物单装后入口加载失败（files 漏文件 / 依赖树缺包 / exports 指向不存在文件）。
 *
 * 判据（判定内核在 scripts/lib/standalone-install.mjs，纯函数可单测）：
 *   A server 面依赖完整性（静态）：从 server 入口建相对导入图，图上每个裸包必须 ∈
 *     dependencies，或属宿主白名单（Node 内置 / cordis / react / react-dom / @deepseek-ai/*）。
 *     浏览器端 exports["./client"] 的 bundle 不扫：react 等由宿主 ModuleLoader 注入，
 *     其文件存在性由 check-pack-hygiene 负责。
 *   B 非宿主包写成 peer（静态）：peer 里白名单之外、又不在 dependencies 的包判红
 *     （workspace 包的 peer-only 由 check-dep-resolution 负责，这里不重复）。
 *   C 离线单装冒烟（核心证据，绝不联网）：npm pack → 解压到临时 node_modules/<pkg> →
 *     为 dependencies 建最小依赖树（workspace 包同样 pack；registry 包从仓库根 node_modules
 *     复制实体，缺包 fail-closed）→ 子进程 import 入口，断言退出码 0 且 stderr 无
 *     ERR_MODULE_NOT_FOUND。
 *
 * 边界（只读、不联网、不装）：
 *   · 每个插件用独立 mkdtemp 目录，npm pack 只写 --pack-destination 指定的临时目录，
 *     结束在 finally 里递归清理；**绝不** npm install 到 plugins/<name>/。
 *   · 12 个包**串行**执行（不与 verify-local 的并发池争 CPU）。
 *   · 不执行生命周期脚本（npm pack --ignore-scripts）。
 *
 * 用法：
 *   node scripts/check-standalone-install.mjs                 # 门禁判定（默认，仓库根）
 *   node scripts/check-standalone-install.mjs --json          # 机器可读 { ok, checked, violations }
 *   node scripts/check-standalone-install.mjs --root <dir>    # 指定仓库根（自测用）
 *   node scripts/check-standalone-install.mjs --help
 *
 * 退出码：0 通过；1 发现缺口或执行失败（fail-closed）；2 用法错误。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { auditPlugin, renderReport } from './lib/standalone-install.mjs'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** npm 在 Windows 上是 .cmd 包装（本仓库 CI 为 ubuntu/macOS，保守兜底）。 */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const PACK_TIMEOUT_MS = 120_000
const IMPORT_TIMEOUT_MS = 60_000

/** 取 stderr 第一段（报告里留一行，完整错误交给复现命令）。 */
function firstLine(text) {
  const value = typeof text === 'string' ? text.trim() : ''
  return value === '' ? '(无输出)' : value.split('\n')[0]
}

/** 读一个 JSON 文件；缺失 / 损坏返回 null（判定要能容忍损坏的树，而不是抛异常）。 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** npm pack 到一个临时目录，返回 tarball 绝对路径（fail-closed）。 */
function npmPack({ cwd, packDir }) {
  mkdirSync(packDir, { recursive: true })
  const result = spawnSync(NPM, ['pack', '--pack-destination', packDir, '--ignore-scripts', '--json'], {
    cwd,
    encoding: 'utf8',
    timeout: PACK_TIMEOUT_MS,
  })
  if (result.status !== 0) {
    return {
      ok: false,
      reason: 'pack-failed',
      error: `npm pack 失败（exit ${result.status ?? '?'}）：${firstLine(result.stderr)}`,
    }
  }
  try {
    const parsed = JSON.parse(result.stdout)
    const entry = Array.isArray(parsed) ? parsed[0] : parsed
    if (typeof entry?.filename !== 'string' || entry.filename === '') {
      throw new Error('npm pack --json 输出缺少 filename 字段（npm 版本行为变化？）')
    }
    return { ok: true, tarball: join(packDir, entry.filename) }
  } catch (error) {
    return {
      ok: false,
      reason: 'pack-failed',
      error: `npm pack --json 解析失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** 源码目录（插件自身或 workspace 依赖）→ npm pack + tar 解压到 target。 */
function installWorkspacePackage({ dir, target, packsDir }) {
  const packed = npmPack({ cwd: dir, packDir: packsDir })
  if (!packed.ok) return packed
  mkdirSync(target, { recursive: true })
  const result = spawnSync('tar', ['-xzf', packed.tarball, '-C', target, '--strip-components=1'], {
    encoding: 'utf8',
    timeout: PACK_TIMEOUT_MS,
  })
  if (result.status !== 0) {
    return {
      ok: false,
      reason: 'pack-failed',
      error: `tar 解压 ${packed.tarball} 失败（exit ${result.status ?? '?'}）：${firstLine(result.stderr)}`,
    }
  }
  return { ok: true }
}

/** registry 包：从仓库根 node_modules 递归复制实体（跟随符号链接），缺失即 fail-closed。 */
function installRegistryPackage({ name, rootModulesDir, target }) {
  const source = join(rootModulesDir, name)
  if (!existsSync(source)) return { ok: false, reason: 'missing' }
  try {
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true, dereference: true, force: true })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      reason: 'copy-failed',
      error: `复制 ${source} → ${target} 失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** 子进程加载入口（cwd = 临时目录，与用户安装后的解析起点一致）。 */
function runImport({ entryFile, cwd }) {
  const url = pathToFileURL(entryFile).href
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(url)})`], {
    cwd,
    encoding: 'utf8',
    timeout: IMPORT_TIMEOUT_MS,
  })
  if (result.error !== undefined && result.error !== null) {
    return { status: null, stderr: String(result.error.message ?? result.error), stdout: '' }
  }
  return { status: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? '' }
}

const io = {
  readFile: (file) => {
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return null
    }
  },
  exists: (file) => existsSync(file),
  installWorkspacePackage,
  installRegistryPackage,
  runImport,
}

/** 列出 plugins/ 下有 package.json 的目录（字典序，报告稳定）。 */
function listPlugins(root) {
  const pluginsDir = join(root, 'plugins')
  if (!existsSync(pluginsDir)) return []
  return readdirSync(pluginsDir)
    .filter((name) => {
      try {
        return statSync(join(pluginsDir, name)).isDirectory()
      } catch {
        return false
      }
    })
    .filter((name) => existsSync(join(pluginsDir, name, 'package.json')))
    .sort()
}

/**
 * 全仓判定：12 个插件**串行**跑判据 A/B/C，每个插件一个独立临时目录（并发安全）。
 * 返回 { root, results, violations, checked, stats }。
 */
async function checkRepo(root) {
  const names = listPlugins(root)
  const workspaceDirs = new Map()
  for (const plugin of names) {
    const pkg = readJson(join(root, 'plugins', plugin, 'package.json'))
    if (typeof pkg?.name === 'string' && pkg.name !== '') workspaceDirs.set(pkg.name, join(root, 'plugins', plugin))
  }
  const results = []
  for (const plugin of names) {
    const dir = join(root, 'plugins', plugin)
    const pkg = readJson(join(dir, 'package.json'))
    // 每个插件独立 mkdtemp：与 verify-local 其它门禁并行时不共享任何路径。
    const sandboxRoot = mkdtempSync(join(tmpdir(), `standalone-install-${plugin}-`))
    try {
      const sandbox = {
        dir: sandboxRoot,
        modulesDir: join(sandboxRoot, 'node_modules'),
        packsDir: join(sandboxRoot, '.packs'),
        repoModulesDir: join(root, 'node_modules'),
      }
      mkdirSync(sandbox.modulesDir, { recursive: true })
      results.push(await auditPlugin({ plugin, dir, pkg, workspaceDirs, sandbox, io }))
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true })
    }
  }
  const violations = results.flatMap((result) => result.violations)
  const stats = {
    pluginCount: results.length,
    bareImports: results.reduce((sum, result) => sum + result.bareImports.length, 0),
    offlineSmokes: results.filter((result) => result.entry !== null).length,
    installedDependencies: results.reduce((sum, result) => sum + result.installedDependencies.length, 0),
  }
  // checked = 本门禁实际执行的判定点：每个插件一条（入口 + 声明形态）+ 每条 server 裸包 import
  // + 每个离线单装冒烟 + 冒烟里安装的每个依赖。
  const checked = stats.pluginCount + stats.bareImports + stats.offlineSmokes + stats.installedDependencies
  return { root, results, violations, checked, stats }
}

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)

if (argv.includes('--help')) {
  console.log('用法：node scripts/check-standalone-install.mjs [--json] [--root <dir>]')
  process.exit(0)
}

/** 取 --root <dir>；缺值即用法错误（静默用错根会得出错误结论）。 */
function rootArg() {
  const idx = argv.indexOf('--root')
  if (idx === -1) return DEFAULT_ROOT
  const value = argv[idx + 1]
  if (typeof value !== 'string' || value === '' || value.startsWith('--')) {
    console.error('x --root 需要一个目录参数')
    process.exit(2)
  }
  return resolve(value)
}

const asJson = argv.includes('--json')
const root = rootArg()
const startedAt = Date.now()
let report
try {
  report = await checkRepo(root)
} catch (error) {
  // IO / 环境失败绝不静默变绿（找不到目录、pack 炸掉都要有人知道）。
  console.error(`x standalone-install 门禁：脚本错误 — ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
const wallMs = Date.now() - startedAt
const failed = report.violations.length > 0

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok: !failed,
        root,
        checked: report.checked,
        plugins: report.stats.pluginCount,
        violations: report.violations,
        stats: { ...report.stats, wallMs },
        details: report.results.map((result) => ({
          plugin: result.plugin,
          name: result.name,
          version: result.version,
          entry: result.entry,
          serverFiles: result.serverFiles,
          bareImports: result.bareImports,
          installedDependencies: result.installedDependencies,
          graphUnresolved: result.graphUnresolved,
          violationCount: result.violations.length,
        })),
      },
      null,
      2,
    ),
  )
  process.exit(failed ? 1 : 0)
}

const text = renderReport({ ...report, wallMs })
if (failed) {
  // 报告最后一行固定是复现命令：排查者不用往上翻找。
  console.error(text)
  process.exit(1)
}
console.log(text)
console.log(`耗时：${wallMs}ms（${report.stats.pluginCount} 个插件串行，每个独立临时目录）`)
