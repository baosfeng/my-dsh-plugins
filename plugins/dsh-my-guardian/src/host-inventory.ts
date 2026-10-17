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
 * 探测顺序（只在宿主真的以桌面 App 形态安装时命中）：
 *  1. 调用方显式传入的 `runtimeJsonPath`（测试 / 脚本）；
 *  2. Electron 主进程的 `process.resourcesPath` → `app.asar/dsh/desktop-runtime.json`；
 *  3. `DSH_APP_RESOURCES`（非标准安装位置，与 scripts/lib/asar-host.mjs 同源约定）。
 *
 * 纯 `dsh web`（npm 全局）环境没有 `process.resourcesPath`，宿主包由 profiles
 * 根 node_modules 的链接提供，走原有磁盘解析即可——这里保持空索引。
 */
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'

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

/** 缓存：按显式路径分键（显式路径用于测试/脚本，不进全局缓存语义）。 */
const inventoryCache = new Map<string, HostInventory>()

/** 清空缓存（测试用：避免用例之间互相污染）。 */
export function resetHostInventoryCache(): void {
  inventoryCache.clear()
}

/**
 * 读取宿主内置包清单。任何失败都降级为 `EMPTY_HOST_INVENTORY`（不抛错）。
 * 结果按路径缓存——宿主安装目录在一次进程生命周期内不会变。
 */
export function loadHostInventory(options: { runtimeJsonPath?: string } = {}): HostInventory {
  const key = options.runtimeJsonPath ?? ''
  const cached = inventoryCache.get(key)
  if (cached !== undefined) return cached
  let inventory: HostInventory = EMPTY_HOST_INVENTORY
  for (const candidate of runtimeJsonCandidates(options.runtimeJsonPath)) {
    const text = readHostText(candidate)
    if (text === null) continue
    try {
      inventory = buildHostInventory(JSON.parse(text), candidate)
      break
    } catch {
      // 损坏的清单位于候选链中：继续试下一个，全部失败则保持降级。
    }
  }
  inventoryCache.set(key, inventory)
  return inventory
}
