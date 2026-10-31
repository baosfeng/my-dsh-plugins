/**
 * dsh-my-guardian — 宿主内置包清单（issue #481）。
 *
 * 桌面版 DSH 把整个宿主依赖树归档进 `app.asar`（`<Resources>/app.asar/dsh`），
 * 插件预检只探 profile 磁盘链（`<plugin>/node_modules`、`<profile>/node_modules`、
 * `<profiles>/node_modules`）时，287 个 `@deepseek-ai/*` 宿主包一个都找不到 →
 * 已装插件被整片误报「缺少依赖」，还给出会把宿主自有包再装一份进 profile 的
 * `dsh plugin add` 建议（#407/#410 的同一类事故）。
 *
 * 本模块提供宿主清单的唯一解析入口：读 `desktop-runtime.json` 的
 * `sharedPackages`（name + version，可做版本校验）与 `files`（覆盖第三方包，
 * 只给「存在」，无版本）。读取失败（纯 Node 环境没有 asar）一律降级为空索引，
 * 绝不抛错——预检是 best-effort，不能反过来拖垮启动。
 *
 * 探测顺序（#503 起四条）：
 *  1. 调用方显式传入的 `runtimeJsonPath`（测试 / 脚本；显式传路径时**绝不**兜底）；
 *  2. Electron 主进程的 `process.resourcesPath` → `app.asar/dsh/desktop-runtime.json`；
 *  3. `DSH_APP_RESOURCES`（非标准安装位置，与 scripts/lib/asar-host.mjs 同源约定）；
 *  4. 宿主安装目录（npm 全局 `dsh web`）：`<prefix>/lib/node_modules/@deepseek-ai/dsh`
 *     下的 node_modules——从 `argv[1]` / `execPath` 向上找，或用 `DSH_HOST_ROOT` 直指。
 *
 * 本文件此前假设「纯 dsh web 的宿主包由 profiles 根 node_modules 的链接提供」，但那个
 * profiles 根在 npm 全局安装形态下根本不存在（#503）→ 清单长期为空、服务端宿主包整片
 * 误报。安装目录清单**刻意只认 @deepseek-ai/***：宿主树里还有 yaml / ws / zod 等第三方
 * 包，一并算成「宿主供给」会把「插件真缺 yaml」掩盖成漏报。
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 宿主前端注入的静态模块（packages/client/web/src/seed.ts 的 getStaticModules，9 项）。 */
export const STATIC_MODULES: ReadonlySet<string> = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

export interface HostInventory {
  /** 是否真的读到了宿主清单（false = 降级空索引）。 */
  available: boolean
  /** 清单来源路径（诊断用；降级时为 null）。 */
  source: string | null
  /** sharedPackages：包名 → 版本（无版本信息时为 null）。 */
  shared: Map<string, string | null>
  /** files 清单里出现过的包名（覆盖面更广，无版本）。 */
  files: Set<string>
  /** 该包是否由宿主安装目录提供。 */
  has(name: string): boolean
  /** sharedPackages 里的版本；没有版本信息时返回 null。 */
  versionOf(name: string): string | null
}

/** 降级索引：不是宿主安装目录（纯 Node / 读失败）时的恒定空结果。 */
export const EMPTY_HOST_INVENTORY: HostInventory = Object.freeze({
  available: false,
  source: null,
  shared: new Map<string, string | null>(),
  files: new Set<string>(),
  has: () => false,
  versionOf: () => null,
})

/** asar 目录树节点（只取读取文件需要的字段）。 */
interface AsarNode {
  files?: Record<string, AsarNode>
  size?: number
  offset?: number | string
}

/** 解析 asar 头：前 16 字节里 offset 4 / 8 分别是 header pickle 与 JSON 段长度。 */
function readAsarHeader(buf: Buffer, jsonSize: number): AsarNode | null {
  if (jsonSize <= 0 || jsonSize > buf.length) return null
  const text = buf.subarray(0, jsonSize).toString('utf8')
  try {
    return JSON.parse(text) as AsarNode
  } catch (error) {
    // 头部长度字段可能含尾部对齐填充：按 JSON.parse 报错位置截断后重试。
    const position = /position (\d+)/.exec(error instanceof Error ? error.message : '')
    if (position === null) return null
    try {
      return JSON.parse(text.slice(0, Number(position[1]))) as AsarNode
    } catch {
      return null
    }
  }
}

/** 读 asar 归档内的单个文件（零依赖；不解包整树）。 */
function readAsarFile(asarPath: string, inner: string): string | null {
  let fd: number | null = null
  try {
    fd = openSync(asarPath, 'r')
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(4)
    const jsonSize = head.readUInt32LE(8)
    const headerBytes = Buffer.alloc(Math.max(headerSize + 16, jsonSize + 16, 16))
    readSync(fd, headerBytes, 0, headerBytes.length, 16)
    const header = readAsarHeader(headerBytes, jsonSize)
    if (header === null) return null
    let node = header
    for (const part of inner.split('/').filter((segment) => segment !== '')) {
      const next = node.files?.[part]
      if (next === undefined) return null
      node = next
    }
    const size = node.size ?? 0
    const data = Buffer.alloc(size)
    if (size > 0) readSync(fd, data, 0, size, 8 + headerSize + Number(node.offset ?? 0))
    return data.toString('utf8')
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** 读一个「普通路径或 asar 内路径」（`…/app.asar/<inner>`）的文件；失败返回 null。 */
export function readHostText(path: string): string | null {
  if (existsSync(path)) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  }
  const index = path.indexOf('.asar/')
  if (index < 0) return null
  return readAsarFile(path.slice(0, index + '.asar'.length), path.slice(index + '.asar/'.length))
}

/** desktop-runtime.json 的候选路径（顺序即优先级）。 */
function runtimeJsonCandidates(explicit?: string): string[] {
  const candidates: string[] = []
  if (typeof explicit === 'string' && explicit !== '') candidates.push(explicit)
  const resources = (process as unknown as { resourcesPath?: unknown }).resourcesPath
  if (typeof resources === 'string' && resources !== '') {
    candidates.push(join(resources, 'app.asar', 'dsh', 'desktop-runtime.json'))
  }
  const envResources = process.env.DSH_APP_RESOURCES
  if (typeof envResources === 'string' && envResources !== '') {
    candidates.push(join(envResources, 'app.asar', 'dsh', 'desktop-runtime.json'))
  }
  return candidates
}

/** 宿主包名（npm 全局安装与桌面版 asar 内的 DSH 本体）。 */
const HOST_PACKAGE = '@deepseek-ai/dsh'

/** 只有 @deepseek-ai/* 由宿主统一供给：宿主树里的第三方包不算（#503）。 */
const HOST_SCOPE = '@deepseek-ai/'

/** 读目录下 package.json 的 name / version（读失败一律 null：预检是 best-effort）。 */
function readPackageMeta(dir: string): { name: string | null; version: string | null } | null {
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
    return {
      name: typeof meta.name === 'string' ? meta.name : null,
      version: typeof meta.version === 'string' ? meta.version : null,
    }
  } catch {
    return null
  }
}

/** realpath，失败退回原路径（软链断掉也不抛）。 */
function resolveReal(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * 默认探测种子（#503）：当前进程能暴露的宿主入口——npm bin 软链落点（`argv[1]`，
 * `dsh web` 时就是 `<prefix>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`）、node
 * 可执行文件（`execPath`），以及由 execPath 推出的 npm 全局前缀（`<prefix>/bin/dsh`
 * 与包本体分离的经典布局）。
 */
function defaultSeeds(): string[] {
  const seeds: string[] = []
  const script = process.argv[1]
  if (typeof script === 'string' && script !== '') seeds.push(script)
  const execPath = process.execPath
  if (typeof execPath === 'string' && execPath !== '') {
    seeds.push(execPath)
    seeds.push(join(dirname(execPath), '..', 'lib', 'node_modules', HOST_PACKAGE, 'package.json'))
    seeds.push(join(dirname(execPath), '..', 'node_modules', HOST_PACKAGE, 'package.json'))
  }
  return seeds
}

/** 一个种子（文件或目录）向上 12 层找 name === @deepseek-ai/dsh 的 package.json。 */
function hostRootFromSeed(seed: string): string | null {
  let dir = resolveReal(seed)
  if (!isDirectory(dir)) dir = dirname(dir)
  for (let depth = 0; depth < 12; depth += 1) {
    if (readPackageMeta(dir)?.name === HOST_PACKAGE) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * 宿主安装根目录（#503）：npm 全局安装时是 `<prefix>/lib/node_modules/@deepseek-ai/dsh`；
 * 桌面版仍是 `app.asar/dsh`（那条链由 desktop-runtime.json 先行命中，这里只兜底）。
 * seeds 可注入——测试不依赖真实安装位置；hostRoot 直指宿主根（等价 DSH_HOST_ROOT）。
 */
export function hostInstallRoot(options: { hostRoot?: string | null; seeds?: string[] } = {}): string | null {
  const override = options.hostRoot
  if (typeof override === 'string' && override !== '' && readPackageMeta(override)?.name === HOST_PACKAGE) {
    return resolveReal(override)
  }
  for (const seed of options.seeds ?? defaultSeeds()) {
    const root = hostRootFromSeed(seed)
    if (root !== null) return root
  }
  return null
}

/** 宿主 node_modules 候选：自身树 + 全局根里的兄弟包（npm 提升 / pnpm 符号链接两种布局）。 */
function installNodeModulesRoots(hostRoot: string): string[] {
  const roots = [join(hostRoot, 'node_modules')]
  const index = hostRoot.lastIndexOf('node_modules/')
  if (index >= 0) {
    const globalRoot = hostRoot.slice(0, index + 'node_modules'.length)
    if (!roots.includes(globalRoot)) roots.push(globalRoot)
  }
  return roots
}

/** 在候选根里读已装版本（没有 package.json / 没有 version 都是 null）。 */
function readInstalledVersion(roots: string[], name: string): string | null {
  for (const root of roots) {
    const meta = readPackageMeta(join(root, name))
    if (meta !== null) return meta.version
  }
  return null
}

/**
 * 宿主安装目录清单（#503）：npm 全局 dsh 的 node_modules 树，按需读 package.json 版本
 * （一次进程内缓存，不做整树枚举）。只认 @deepseek-ai/*（见文件头）。
 */
export function buildInstallDirInventory(hostRoot: string): HostInventory {
  const roots = installNodeModulesRoots(hostRoot)
  const versions = new Map<string, string | null>()
  const versionOf = (name: string): string | null => {
    if (!versions.has(name)) versions.set(name, readInstalledVersion(roots, name))
    return versions.get(name) ?? null
  }
  const has = (name: string): boolean =>
    name.startsWith(HOST_SCOPE) && (versionOf(name) !== null || roots.some((root) => existsSync(join(root, name))))
  return {
    available: true,
    source: roots[0] ?? hostRoot,
    shared: new Map(),
    files: new Set(),
    has,
    versionOf: (name) => (name.startsWith(HOST_SCOPE) ? versionOf(name) : null),
  }
}

/** 从 `node_modules/<pkg>/…` 形式的清单路径里取出包名（含 scoped）。 */
export function packageNameFromFile(filePath: string): string | null {
  const marker = 'node_modules/'
  const index = filePath.lastIndexOf(marker)
  if (index < 0) return null
  const parts = filePath
    .slice(index + marker.length)
    .split('/')
    .filter((part) => part !== '')
  if (parts.length === 0) return null
  if (parts[0].startsWith('@')) return parts.length >= 2 ? parts[0] + '/' + parts[1] : null
  return parts[0]
}

function isPackageName(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** sharedPackages → 包名到版本的映射（异常条目跳过）。 */
function collectShared(packages: unknown): Map<string, string | null> {
  const shared = new Map<string, string | null>()
  if (!Array.isArray(packages)) return shared
  for (const item of packages) {
    const entry = (item ?? {}) as { name?: unknown; version?: unknown }
    if (isPackageName(entry.name)) shared.set(entry.name, typeof entry.version === 'string' ? entry.version : null)
  }
  return shared
}

/** files 清单 → 出现过的包名集合（只给「存在」，无版本）。 */
function collectFiles(files: unknown): Set<string> {
  const names = new Set<string>()
  if (!Array.isArray(files)) return names
  for (const item of files) {
    const entry = (item ?? {}) as { path?: unknown }
    const name = typeof entry.path === 'string' ? packageNameFromFile(entry.path) : null
    if (name !== null) names.add(name)
  }
  return names
}

/** 把 desktop-runtime.json 解析成索引（结构异常时按空清单处理，不抛错）。 */
export function buildHostInventory(json: unknown, source: string): HostInventory {
  const data = (json !== null && typeof json === 'object' ? json : {}) as {
    sharedPackages?: unknown
    files?: unknown
  }
  const shared = collectShared(data.sharedPackages)
  const files = collectFiles(data.files)
  return {
    available: true,
    source,
    shared,
    files,
    has: (name) => shared.has(name) || files.has(name),
    versionOf: (name) => shared.get(name) ?? null,
  }
}

/** loadHostInventory 的参数（全部可注入：测试/脚本不依赖真实安装位置）。 */
export interface HostInventoryOptions {
  runtimeJsonPath?: string
  /** 宿主安装根（等价 DSH_HOST_ROOT；测试/脚本注入）。 */
  hostRoot?: string
  /** 宿主根探测种子（测试/脚本注入；默认见 defaultSeeds）。 */
  hostSeeds?: string[]
}

/** DSH_HOST_ROOT：非常规安装位置（与 scripts/lib/asar-host.mjs 同源约定）。 */
function hostRootFromEnv(): string | undefined {
  const value = process.env.DSH_HOST_ROOT
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** 缓存：按显式路径 / 宿主根 / 探测种子分键（显式参数用于测试/脚本，不进全局缓存语义）。 */
const inventoryCache = new Map<string, HostInventory>()

/** 清空缓存（测试用：避免用例之间互相污染）。 */
export function resetHostInventoryCache(): void {
  inventoryCache.clear()
}

/** 探测清单；任何失败都降级为 `EMPTY_HOST_INVENTORY`（预检是 best-effort，绝不抛错）。 */
function readInventory(options: HostInventoryOptions): HostInventory {
  for (const candidate of runtimeJsonCandidates(options.runtimeJsonPath)) {
    const text = readHostText(candidate)
    if (text === null) continue
    try {
      return buildHostInventory(JSON.parse(text), candidate)
    } catch {
      // 损坏的清单位于候选链中：继续试下一个，全部失败则继续兜底。
    }
  }
  // 显式传路径时不兜底：「指定文件不存在」必须保持失败（测试/脚本语义）。
  if (typeof options.runtimeJsonPath === 'string' && options.runtimeJsonPath !== '') return EMPTY_HOST_INVENTORY
  // #503：asar 清单落空（纯 npm 全局 dsh web）→ 兜底宿主安装目录。
  const root = hostInstallRoot({ hostRoot: options.hostRoot ?? hostRootFromEnv(), seeds: options.hostSeeds })
  if (root === null) return EMPTY_HOST_INVENTORY
  return existsSync(join(root, 'node_modules')) ? buildInstallDirInventory(root) : EMPTY_HOST_INVENTORY
}

/**
 * 读取宿主内置包清单（#503：唯一入口）。任何失败都降级为 `EMPTY_HOST_INVENTORY`（不抛错）。
 * 结果按参数分键缓存——宿主安装在一次进程生命周期内不会变。
 */
export function loadHostInventory(options: HostInventoryOptions = {}): HostInventory {
  const key = [options.runtimeJsonPath ?? '', options.hostRoot ?? '', (options.hostSeeds ?? []).join('\n')].join(
    '\u0000',
  )
  const cached = inventoryCache.get(key)
  if (cached !== undefined) return cached
  const inventory = readInventory(options)
  inventoryCache.set(key, inventory)
  return inventory
}
