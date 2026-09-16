/**
 * dsh-my-guard — poison scan engine（安装前投毒扫描）。
 *
 * 纯函数扫描引擎 + 包目标解析：
 *  - scanPackage(dir)      — 扫描本地包目录：package.json scripts 可疑命令、
 *    恶意依赖名、文件内容密钥模式、可疑文件扩展名；
 *  - scanTarball(path)     — 解压 tarball 到临时目录（tar 命令，不执行任何
 *    包内代码）后扫描；解包前先用 `inspectTarStream` 逐个 entry 校验（穿越 / 绝对路径 /
 *    软硬链接逃逸 / 解压炸弹），命中即拒（CodeQL #105 加固）；
 *  - scanPackageTarget(pkg, onAlert) — 从包名/路径触发扫描（guard.js 联动）：
 *    link:/本地路径直接扫目录；包名经 npm registry 取 tarball 下载后扫描；
 *    发现可疑内容逐条回调告警。
 *
 * 扫描只读包内容，绝不执行包内脚本/代码。
 */
import { constants, open, readdir, rm } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { join, basename, extname } from 'node:path'
import { execFile } from 'node:child_process'
import tmp from 'tmp'
import {
  SUSPICIOUS_SCRIPT_PATTERNS,
  SECRET_PATTERNS,
  SUSPICIOUS_FILES,
  MALICIOUS_DEPENDENCIES,
  SCAN_IGNORE,
  MAX_SCAN_FILE_BYTES,
  MAX_SCAN_FILES,
} from './constants.js'
import type { Finding, ScanResult, Alert, Severity } from './types.js'
import { fetchTarball } from './tarball.js'
import type { TarballFetchOptions } from './tarball.js'
import { inspectTarStream } from './tar-safety.js'

/** 扫描句柄（内部状态）。 */
interface ScanHandle {
  findings: Finding[]
  files: number
  bytes: number
  /** 按类别统计被跳过的文件（诊断用；#327 起不再静默吞掉 errno）。 */
  skipped: Record<string, number>
}

/** 扫描本地包目录；返回 { ok, findings, scannedFiles, scannedBytes, skipped }。 */
export async function scanPackage(dir: string): Promise<ScanResult> {
  const handle: ScanHandle = { findings: [], files: 0, bytes: 0, skipped: {} }
  try {
    await scanDir(dir, dir, handle)
    return {
      ok: true,
      findings: handle.findings,
      scannedFiles: handle.files,
      scannedBytes: handle.bytes,
      skipped: handle.skipped,
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

/** 解包输入：本地 tarball 路径，或内存字节（远端下载的 tarball 走这条，不再落盘）。 */
type TarballInput = { readonly file: string } | { readonly buffer: Buffer }

/** tarball 扫描参数。 */
export interface TarballScanOptions {
  /** 声明解包体积上限（字节）；默认 256 MiB（tar-safety 内定义）。 */
  maxUnpackedBytes?: number
}

/**
 * 解压 tarball 到临时目录后扫描（不执行包内代码）；返回扫描结果。
 *
 * 解包**之前**先流式校验每个 entry：路径穿越 / 绝对路径 / 软硬链接逃逸 / 解压炸弹一律 fail-closed
 * 拒绝（#105）——安全判定不外包给系统 tar 的版本行为（CheckPoint：bsdtar 3.5 对绝对路径只剥掉
 * `/` 前缀后照常落盘）。校验与解包读同一份字节，因此不存在 check-then-use 的 TOCTOU。
 */
export async function scanTarball(tarballPath: string, options: TarballScanOptions = {}): Promise<ScanResult> {
  return scanTarballSource({ file: tarballPath }, options)
}

/** 解包 + 扫描的公共实现：来源可以是路径或内存字节。 */
async function scanTarballSource(input: TarballInput, options: TarballScanOptions): Promise<ScanResult> {
  const tmpDir = tmp.dirSync({ prefix: 'dsh-guard-scan-', unsafeCleanup: true }).name
  try {
    const safety = await inspectTarStream(sourceStream(input), options.maxUnpackedBytes)
    if (!safety.ok) return { ok: false, error: `拒绝解包：${safety.reason}` }
    await extractTarball(tmpDir, input)
    return await scanPackage(tmpDir)
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

/** 校验用的字节流：路径形式读文件，内存形式直接包成可读流。 */
function sourceStream(input: TarballInput): Readable {
  return 'file' in input ? createReadStream(input.file) : Readable.from([input.buffer])
}

/**
 * 交给系统 tar 解包：路径形式直接给文件，内存形式经 **stdin** 喂入（`-f -`）。
 *
 * 走 stdin 而不是先写临时文件：远端字节不再由本进程写进文件系统，且省掉「落盘 → tar 再读」
 * 的窗口与一次额外磁盘写。
 */
function extractTarball(tmpDir: string, input: TarballInput): Promise<void> {
  const args = 'file' in input ? ['-xzf', input.file, '-C', tmpDir] : ['-xz', '-f', '-', '-C', tmpDir]
  return new Promise((resolve, reject) => {
    const child = execFile('tar', args, (error) => (error === null ? resolve() : reject(error)))
    // 子进程提前退出（结构非法）时 stdin 写入会 EPIPE：真正的原因由 execFile 回调统一报出，
    // 这里必须吞掉流错误，否则会变成 unhandled 'error' 把进程带崩。
    child.stdin?.on('error', () => undefined)
    if (!('file' in input)) child.stdin?.end(input.buffer)
  })
}

/**
 * 从包名/路径触发扫描（guard.js 联动；fire-and-forget 调用方负责 void）。
 * 发现可疑内容时逐条回调 onAlert({ type:'poison', severity, message, detail })。
 */
export async function scanPackageTarget(pkg: string, onAlert: (alert: Alert) => void): Promise<void> {
  const result = await resolveAndScan(pkg)
  if (!result.ok) {
    // 无法解析目标时产出告警（fail-loud 原则）
    onAlert({
      type: 'poison',
      severity: 'low',
      message: `无法解析投毒扫描目标: ${result.error ?? '未知错误'}`,
      detail: { target: pkg, error: result.error },
    })
    return
  }
  for (const finding of result.findings ?? []) {
    onAlert({
      type: 'poison',
      severity: finding.severity,
      message: finding.message,
      detail: { file: finding.file, pattern: finding.pattern, target: pkg },
    })
  }
}

/** 解析目标（本地路径/包名）并扫描；返回扫描结果。 */
export async function resolveAndScan(
  pkg: string,
  options: TarballFetchOptions & TarballScanOptions = {},
): Promise<ScanResult> {
  const local = localPathOf(pkg)
  if (local !== '') return scanPackage(local)
  const fetched = await fetchTarball(pkg, options)
  // 失败原因原样透传（#327：不再压成一句 unable to resolve package tarball）
  if (!fetched.ok) return { ok: false, error: fetched.error }
  // 已过摘要校验的字节直接进内存解包链路（#105：不再写临时 tarball 文件）
  return scanTarballSource({ buffer: fetched.body }, options)
}

/** 本地路径解析：link: 前缀或已存在的路径 → 路径；否则空串。 */
export function localPathOf(pkg: string): string {
  const candidate = pkg.startsWith('link:') ? pkg.slice(5) : pkg
  if (candidate === '') return ''
  if (candidate.startsWith('/') || candidate.startsWith('.')) return candidate
  return ''
}

// tarball 获取与摘要校验已拆到独立文件（tsc 尺寸门禁：文件 ≤400 行 / 函数 ≤70 行 /
// 圈复杂度 ≤10）；这里 re-export 保持 lib/poison.js 的既有导出面不变。
export { classifyFetchFailure, fetchTarball, verifyTarballIntegrity } from './tarball.js'
export type { TarballFailure, TarballFetch, TarballFetchOptions } from './tarball.js'

/** 递归扫描目录（跳过 SCAN_IGNORE；文件数/大小上限）。 */
async function scanDir(root: string, dir: string, handle: ScanHandle): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (handle.files >= MAX_SCAN_FILES) return
    if (SCAN_IGNORE.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await scanDir(root, full, handle)
    } else if (entry.isFile()) {
      await scanFile(root, full, handle)
    }
  }
}

/** 扫描单个文件：package.json 特殊检查 + 文件名/内容模式。 */
async function scanFile(root: string, full: string, handle: ScanHandle): Promise<void> {
  handle.files += 1
  const name = basename(full)
  const rel = full.slice(root.length + 1)
  checkSuspiciousFileNames(name, rel, handle)
  const text = await readText(full, handle)
  if (text === null) return
  if (name === 'package.json') {
    for (const finding of inspectPackageJson(text, rel)) handle.findings.push(finding)
    return
  }
  checkSecrets(text, rel, handle)
  checkShellScripts(name, text, rel, handle)
}

/** 文件名可疑扩展名检测。 */
function checkSuspiciousFileNames(name: string, rel: string, handle: ScanHandle): void {
  for (const pattern of SUSPICIOUS_FILES) {
    if (pattern.re.test(name)) {
      handle.findings.push({
        id: 'suspicious-file',
        severity: 'low',
        message: pattern.message,
        file: rel,
        pattern: pattern.id,
      })
    }
  }
}

/** 文件内容密钥模式检测。 */
function checkSecrets(text: string, rel: string, handle: ScanHandle): void {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(text)) {
      handle.findings.push({
        id: 'secret',
        severity: 'high',
        message: pattern.message,
        file: rel,
        pattern: pattern.id,
      })
    }
  }
}

/** shell 脚本内容可疑命令检测。 */
function checkShellScripts(name: string, text: string, rel: string, handle: ScanHandle): void {
  if (!isShellFile(name)) return
  for (const pattern of SUSPICIOUS_SCRIPT_PATTERNS) {
    if (pattern.re.test(text)) {
      handle.findings.push({
        id: 'suspicious-script',
        severity: 'medium',
        message: pattern.message,
        file: rel,
        pattern: pattern.id,
      })
    }
  }
}

/** 读取失败类别（供诊断与回归测试断言；不用裸 catch 吞掉 errno 语义）。 */
export type ReadFailure = 'not-a-file' | 'permission-denied' | 'not-found' | 'too-large' | 'io-error'

/**
 * errno → 失败类别：`EISDIR`/`ENOTDIR` 非普通文件；`EACCES`/`EPERM` 权限拒绝；
 * `ENOENT` 不存在；其余归 I/O 错误。类别用于诊断与测试断言，不改变读取结果（仍是 null）。
 */
export function classifyReadFailure(error: unknown): ReadFailure {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code
  if (code === 'EISDIR' || code === 'ENOTDIR') return 'not-a-file'
  if (code === 'EACCES' || code === 'EPERM') return 'permission-denied'
  if (code === 'ENOENT') return 'not-found'
  return 'io-error'
}

/** 读取文件文本（大小上限内；不可读/超限返回 null 并记入 skipped 类别）。导出供 #327 回归测试直调。 */
export async function readText(full: string, handle: ScanHandle): Promise<string | null> {
  let fh: FileHandle
  try {
    // O_NONBLOCK：FIFO 在没有写端时 open 会一直等下去（普通文件/目录不受该标志影响），
    // 非阻塞后立刻拿到 fd，类型判定交给 fd 上的 stat。
    fh = await open(full, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch (error) {
    skipFile(handle, classifyReadFailure(error))
    return null
  }
  try {
    // stat 与 read 作用在**同一个 fd** 上：fstat 与随后的 fd 读取同源，既没有 TOCTOU
    // （js/file-system-race 走的是路径形式的 check-then-use），又保住了下面两道闸门。
    const info = await fh.stat()
    if (!info.isFile()) {
      // 读之前拒掉目录/FIFO/设备：否则 FIFO 可永久阻塞、/dev/zero 可把内存吃光
      skipFile(handle, 'not-a-file')
      return null
    }
    if (info.size > MAX_SCAN_FILE_BYTES) {
      // 读之前按**字节**拒掉超限文件：超大文件不会先被读进内存
      skipFile(handle, 'too-large')
      return null
    }
    handle.bytes += info.size
    return await fh.readFile('utf8')
  } catch (error) {
    skipFile(handle, classifyReadFailure(error))
    return null
  } finally {
    await fh.close()
  }
}

/** 记一次跳过（按类别计数；#327：errno 不再被裸 catch 吞掉）。 */
function skipFile(handle: ScanHandle, reason: ReadFailure): void {
  handle.skipped[reason] = (handle.skipped[reason] ?? 0) + 1
}

/** 是否为 shell 脚本文件（.sh/.bash）。 */
export function isShellFile(name: string): boolean {
  const ext = extname(name).toLowerCase()
  return ext === '.sh' || ext === '.bash'
}

/** 解析 package.json：scripts 可疑命令 + 恶意依赖名。 */
export function inspectPackageJson(text: string, file: string): Finding[] {
  const findings: Finding[] = []
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(text) as Record<string, unknown>
  } catch {
    return findings
  }
  if (pkg !== null && typeof pkg === 'object') {
    inspectScripts(pkg.scripts, file, findings)
    inspectDependencies(pkg.dependencies, file, findings)
    inspectDependencies(pkg.devDependencies, file, findings)
    inspectDependencies(pkg.peerDependencies, file, findings)
    inspectDependencies(pkg.optionalDependencies, file, findings)
  }
  return findings
}

/** scripts 字段可疑命令检测。 */
function inspectScripts(scripts: unknown, file: string, findings: Finding[]): void {
  if (scripts === null || typeof scripts !== 'object') return
  for (const [name, script] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof script !== 'string') continue
    for (const pattern of SUSPICIOUS_SCRIPT_PATTERNS) {
      if (pattern.re.test(script)) {
        findings.push({
          id: 'suspicious-script',
          severity: 'medium' as Severity,
          message: pattern.message,
          file,
          pattern: pattern.id,
          script: name,
        })
      }
    }
  }
}

/** 依赖名恶意包检测。 */
function inspectDependencies(deps: unknown, file: string, findings: Finding[]): void {
  if (deps === null || typeof deps !== 'object') return
  for (const name of Object.keys(deps as Record<string, unknown>)) {
    if (MALICIOUS_DEPENDENCIES.includes(name)) {
      findings.push({
        id: 'malicious-dependency',
        severity: 'high' as Severity,
        message: `已知被投毒/恶意依赖：${name}`,
        file,
        pattern: 'malicious-dependency',
      })
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
