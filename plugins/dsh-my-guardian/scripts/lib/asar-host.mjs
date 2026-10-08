/**
 * asar-host.mjs — 读取「桌面 App 内宿主树」的最小 fs 门面。
 *
 * 为什么需要它：纯桌面 App 环境里没有 npm 全局宿主，宿主的依赖树被归档进
 * `DeepSeek Harness.app/Contents/Resources/app.asar`（普通文件，不是目录）。
 * 取证脚本若只用 existsSync/readFileSync，就看**不见**真实的已装宿主。
 *
 * 本模块提供两条能力：
 *   ① appHostCandidates() —— 桌面 App 形态的宿主根候选路径（asar 树 + unpacked 树）
 *   ② hostExists / hostIsDir / hostReaddir / hostReadFile(Text) —— 普通路径走 node:fs，
 *      对 `*.asar/<inner>` 路径直接解析 asar 头并按需读取条目字节（零依赖、无 Electron）。
 *
 * 边界（诚实声明）：只支持读取；asar 内标记 unpacked 的条目由 `app.asar.unpacked/`
 * 承载，不在此模块处理（调用方用 appHostCandidates 的 unpacked 候选）。
 */
import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ASAR_INFIX = '.asar/'
const headerCache = new Map()

/** 把 `/x/app.asar/<inner>` 拆成 { asar, inner }；不是 asar 路径返回 null。 */
function splitAsarPath(path) {
  const index = path.indexOf(ASAR_INFIX)
  if (index === -1) return null
  return { asar: path.slice(0, index + '.asar'.length), inner: path.slice(index + ASAR_INFIX.length) }
}

function parseHeaderJson(buf) {
  const jsonSize = buf.readUInt32LE(8)
  if (jsonSize > 0 && jsonSize <= buf.length) {
    try {
      return JSON.parse(buf.subarray(0, jsonSize).toString('utf8'))
    } catch {
      /* 回落到按 JSON.parse 报错位置截断 */
    }
  }
  const text = buf.toString('utf8')
  try {
    return JSON.parse(text)
  } catch (error) {
    const match = /position (\d+)/.exec(error.message)
    if (!match) throw error
    return JSON.parse(text.slice(0, Number(match[1])))
  }
}

function headerOf(asar) {
  const cached = headerCache.get(asar)
  if (cached !== undefined) return cached
  let value = null
  try {
    const fd = openSync(asar, 'r')
    try {
      const head = Buffer.alloc(16)
      readSync(fd, head, 0, 16, 0)
      const headerSize = head.readUInt32LE(4)
      const jsonSize = head.readUInt32LE(8)
      const size = Math.max(headerSize + 16, jsonSize + 16, 16)
      const buf = Buffer.alloc(size)
      readSync(fd, buf, 0, size, 16)
      value = { header: parseHeaderJson(buf), dataOffset: 8 + headerSize }
    } finally {
      closeSync(fd)
    }
  } catch {
    value = null
  }
  headerCache.set(asar, value)
  return value
}

function entryOf(path) {
  const split = splitAsarPath(path)
  if (split === null) return null
  const meta = headerOf(split.asar)
  if (meta === null) return null
  const parts = split.inner.split('/').filter((part) => part !== '')
  let node = meta.header
  for (const part of parts) {
    if (!node.files || node.files[part] === undefined) return null
    node = node.files[part]
  }
  return { node, meta, asar: split.asar }
}

/** 路径存在（普通路径 → node:fs；asar 内路径 → 解析头）。 */
export function hostExists(path) {
  if (splitAsarPath(path) === null) return existsSync(path)
  return entryOf(path) !== null
}

/** 路径是目录（asar 内的目录条目带 files）。 */
export function hostIsDir(path) {
  if (splitAsarPath(path) === null) {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  }
  const entry = entryOf(path)
  return entry !== null && entry.node.files !== undefined
}

/** 列目录（asar 内目录 → 头里的子项名字）。 */
export function hostReaddir(path) {
  if (splitAsarPath(path) === null) return readdirSync(path)
  const entry = entryOf(path)
  if (entry === null || entry.node.files === undefined) throw new Error('ENOTDIR/ENOENT (asar): ' + path)
  return Object.keys(entry.node.files)
}

/** 读文件为 Buffer（asar 内条目 → 按 offset/size 直读）。 */
function hostReadFile(path) {
  const split = splitAsarPath(path)
  if (split === null) return readFileSync(path)
  const entry = entryOf(path)
  if (entry === null) throw new Error('ENOENT (asar): ' + path)
  const size = entry.node.size ?? 0
  const offset = entry.meta.dataOffset + Number(entry.node.offset ?? 0)
  const fd = openSync(entry.asar, 'r')
  try {
    const buf = Buffer.alloc(size)
    if (size > 0) readSync(fd, buf, 0, size, offset)
    return buf
  } finally {
    closeSync(fd)
  }
}

/** 读文件为 utf8 文本。 */
export function hostReadFileText(path) {
  return hostReadFile(path).toString('utf8')
}

/**
 * 桌面 App 形态的宿主根候选（形如 <root>/node_modules/@deepseek-ai 的父目录）。
 * 覆盖：① asar 归档树（完整宿主）② app.asar.unpacked（只放原生包，通常不完整，
 * 因为没有 @deepseek-ai/dsh 而被 installedHostDir 自然跳过）。
 * 路径可由 DSH_APP_RESOURCES 覆盖（非 macOS 或不装在 /Applications 时用）。
 */
export function appHostCandidates() {
  const resources = process.env.DSH_APP_RESOURCES ?? '/Applications/DeepSeek Harness.app/Contents/Resources'
  return [join(resources, 'app.asar', 'dsh'), join(resources, 'app.asar.unpacked', 'dsh')]
}
