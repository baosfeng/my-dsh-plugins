/**
 * dsh-my-guard — poison scan engine（安装前投毒扫描）。
 *
 * 纯函数扫描引擎 + 包目标解析：
 *  - scanPackage(dir)      — 扫描本地包目录：package.json scripts 可疑命令、
 *    恶意依赖名、文件内容密钥模式、可疑文件扩展名；
 *  - scanTarball(path)     — 解压 tarball 到临时目录（tar 命令，不执行任何
 *    包内代码）后扫描；
 *  - scanPackageTarget(pkg, onAlert) — 从包名/路径触发扫描（guard.js 联动）：
 *    link:/本地路径直接扫目录；包名经 npm registry 取 tarball 下载后扫描；
 *    发现可疑内容逐条回调告警。
 *
 * 扫描只读包内容，绝不执行包内脚本/代码。
 */
import { readFile, readdir, stat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename, extname } from 'node:path'
import { execFile } from 'node:child_process'
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

/** 扫描句柄（内部状态）。 */
interface ScanHandle {
  findings: Finding[]
  files: number
  bytes: number
}

/** 扫描本地包目录；返回 { ok, findings, scannedFiles, scannedBytes }。 */
export async function scanPackage(dir: string): Promise<ScanResult> {
  const handle: ScanHandle = { findings: [], files: 0, bytes: 0 }
  try {
    await scanDir(dir, dir, handle)
    return {
      ok: true,
      findings: handle.findings,
      scannedFiles: handle.files,
      scannedBytes: handle.bytes,
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

/** 解压 tarball 到临时目录后扫描（不执行包内代码）；返回扫描结果。 */
export async function scanTarball(tarballPath: string): Promise<ScanResult> {
  const tmp = await mkdtemp(join(tmpdir(), 'dsh-guard-scan-'))
  try {
    await execFileAsync('tar', ['-xzf', tarballPath, '-C', tmp])
    return await scanPackage(tmp)
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/**
 * 从包名/路径触发扫描（guard.js 联动；fire-and-forget 调用方负责 void）。
 * 发现可疑内容时逐条回调 onAlert({ type:'poison', severity, message, detail })。
 */
export async function scanPackageTarget(pkg: string, onAlert: (alert: Alert) => void): Promise<void> {
  const result = await resolveAndScan(pkg)
  if (!result.ok) return
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
export async function resolveAndScan(pkg: string): Promise<ScanResult> {
  const local = localPathOf(pkg)
  if (local !== '') return scanPackage(local)
  const tarball = await fetchTarball(pkg)
  if (tarball === '') return { ok: false, error: 'unable to resolve package tarball' }
  return scanTarball(tarball)
}

/** 本地路径解析：link: 前缀或已存在的路径 → 路径；否则空串。 */
export function localPathOf(pkg: string): string {
  const candidate = pkg.startsWith('link:') ? pkg.slice(5) : pkg
  if (candidate === '') return ''
  if (candidate.startsWith('/') || candidate.startsWith('.')) return candidate
  return ''
}

/** 从 npm registry 获取并下载 tarball 到临时文件；失败返回空串。 */
async function fetchTarball(pkg: string): Promise<string> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return ''
    const meta = (await response.json()) as Record<string, unknown>
    const dist = meta?.dist as Record<string, unknown> | undefined
    const tarballUrl = dist?.tarball
    if (typeof tarballUrl !== 'string' || tarballUrl === '') return ''
    const tarballResponse = await fetch(tarballUrl)
    if (!tarballResponse.ok) return ''
    const buffer = Buffer.from(await tarballResponse.arrayBuffer())
    const file = join(tmpdir(), `dsh-guard-${Date.now()}-${Math.random().toString(36).slice(2)}.tgz`)
    await writeFile(file, buffer)
    return file
  } catch {
    return ''
  }
}

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

/** 读取文件文本（大小上限内；不可读/超限返回 null）。 */
async function readText(full: string, handle: ScanHandle): Promise<string | null> {
  const info = await stat(full)
  if (!info.isFile() || info.size > MAX_SCAN_FILE_BYTES) return null
  handle.bytes += info.size
  try {
    return await readFile(full, 'utf8')
  } catch {
    return null
  }
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

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => (error === null ? resolve() : reject(error)))
  })
}
