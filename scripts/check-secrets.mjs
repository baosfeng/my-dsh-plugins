#!/usr/bin/env node
/**
 * check-secrets.mjs — CI secret 扫描门禁（issue #324 需求 A）的 CLI。
 *
 * 与 scripts/lib/gitleaks-scan.mjs 分工：本文件只做 IO（取二进制 / 起 gitleaks / 打印），
 * 全部判据（平台与校验值、版本核对、报告净化、退出码）在 lib 里，便于单测。
 *
 * 用法：
 *   node scripts/check-secrets.mjs                    # 全历史（默认，覆盖本次 diff）
 *   node scripts/check-secrets.mjs --scope <rev范围>  # 只扫指定范围（git log 语义，如 a..b）
 *   node scripts/check-secrets.mjs --json             # 机器可读结果
 *   node scripts/check-secrets.mjs --bin <路径>       # 用指定 gitleaks（跳过下载）
 *   node scripts/check-secrets.mjs --target <目录>    # 扫描别的仓库（回归测试夹具用；默认本仓库）
 *   node scripts/check-secrets.mjs --download-only    # 只下载+校验，不扫描
 *   node scripts/check-secrets.mjs --allow-missing    # 本地无 gitleaks 时跳过（**CI 绝不传**）
 *   node scripts/check-secrets.mjs --refresh          # 强制重新下载
 *
 * 退出码：0 = 干净（或显式 --allow-missing 且工具不可用）；1 = 有命中 / 工具不可用 / 校验失败。
 *
 * ⚠️ 明文永不落盘、永不进日志（本 issue 的硬要求）：
 *   · gitleaks 报告走 `--report-path -` 直接进内存，不写临时文件；
 *   · gitleaks 子进程的 stderr 只在其**非零退出**时打印尾部（扫描摘要），
 *     stdout（报告本体，含 Match/Secret）从不透传；
 *   · 传给 stdout 的内容一律经 lib 的 normalizeFindings 净化，只含 文件:行:规则。
 *   这条由 scripts/test/secret-scan.test.mjs 用「塞真形态假密钥 → 断言输出里搜不到」钉死。
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decideScanExit,
  dedupeFindings,
  normalizeFindings,
  renderScanSummary,
  scanRecord,
  toolRelease,
  verifyChecksum,
  verifyGitleaksVersion,
} from './lib/gitleaks-scan.mjs'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * 二进制缓存目录。默认在仓库内（.gitleaks-cache/，已 gitignore）。
 * `GITLEAKS_CACHE_DIR` 是**回归测试用的隔离口**：下载用例会往缓存里写「自制产物」，
 * 若共用真缓存会把它污染成"版本不一致"（开发期实测过一次），所以测试指到临时目录。
 */
const CACHE_DIR = process.env.GITLEAKS_CACHE_DIR
  ? resolve(process.env.GITLEAKS_CACHE_DIR)
  : join(REPO_ROOT, '.gitleaks-cache')
const CONFIG_PATH = join(REPO_ROOT, '.gitleaks.toml')
const TOOLS_PATH = join(REPO_ROOT, 'scripts', 'ci-tools.json')
const GITLEAKS_TIMEOUT_MS = 300_000
const DOWNLOAD_TIMEOUT_MS = 120_000
/** 扫描报告里回显「扫描了多少提交/字节」的摘要行——用于确认门禁真的扫了东西（而非空跑假绿）。 */
const COMMITS_SCANNED_RE = /(\d+) commits scanned/

// ── 参数 ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const options = {
  bin: null,
  scope: null,
  target: null,
  json: false,
  allowMissing: false,
  refresh: false,
  downloadOnly: false,
  help: false,
}
for (let i = 0; i < args.length; i += 1) {
  const flag = args[i]
  const value = () => {
    const v = args[++i]
    if (v === undefined) fail(`[secrets] ${flag} 缺少参数值（--help 查看用法）`)
    return v
  }
  if (flag === '--bin') options.bin = value()
  else if (flag === '--scope') options.scope = value()
  else if (flag === '--target') options.target = value()
  else if (flag === '--json') options.json = true
  else if (flag === '--allow-missing') options.allowMissing = true
  else if (flag === '--refresh') options.refresh = true
  else if (flag === '--download-only') options.downloadOnly = true
  else if (flag === '--help' || flag === '-h') options.help = true
  else fail(`[secrets] unknown flag: ${flag}（--help 查看用法）`)
}
if (options.help) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('*/')[0]
      .split('/**')[1]
      .replace(/^ \* ?/gm, ''),
  )
  process.exit(0)
}
/** 参数错误（用法问题）与门禁失败分开：退出码 2 表示用法错误。 */
function fail(message) {
  console.error(message)
  process.exit(2)
}

/** 被扫描的仓库根：默认本仓库；--target 指向别处（回归测试用夹具仓库，见 scripts/test/secret-scan.test.mjs）。 */
const targetRoot = options.target ? resolve(options.target) : REPO_ROOT

const tools = JSON.parse(readFileSync(TOOLS_PATH, 'utf8'))
const release = toolRelease(tools, 'gitleaks')
if (!release.ok) fail(`[secrets] ${release.reason}（请在 scripts/ci-tools.json 补该平台的 SHA256 后再启用本门禁）`)

/**
 * 下载源覆盖（**仅供回归测试**，见 scripts/test/secret-scan.test.mjs）。
 * 存在的理由：SHA256 校验是供应链防线，必须有一条**离线、确定**的用例证明"校验值不符时
 * 真的会拒绝执行"，否则这条防线只能靠线上偶发验证。测试把 URL 指向本地 http 服务并给错校验值，
 * 生产环境（CI / 本地）不设这两个变量，行为完全不变。
 */
if (process.env.GITLEAKS_RELEASE_URL) release.url = process.env.GITLEAKS_RELEASE_URL
if (process.env.GITLEAKS_SHA256) release.sha256 = process.env.GITLEAKS_SHA256

// ── 取二进制（缓存命中 → 直接用；否则下载 + 校验 SHA256）────────────────────
/** 版本化缓存路径：换版本不会复用旧二进制（配合 ci-tools.json 的固定版本）。 */
function cachedPath() {
  return join(CACHE_DIR, `${release.version}-${release.key}`, 'gitleaks')
}

/** PATH 里找 gitleaks（本机已装时优先用，但仍会核对版本）。 */
function whichGitleaks() {
  const probe = spawnSync('sh', ['-c', 'command -v gitleaks'], { encoding: 'utf8', timeout: 10_000 })
  const p = (probe.stdout ?? '').trim()
  return probe.status === 0 && p ? p : null
}

/** gitleaks 版本（用于与 ci-tools.json 的固定版本核对）。 */
function gitleaksVersion(bin) {
  const r = spawnSync(bin, ['version'], { encoding: 'utf8', timeout: 30_000 })
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
}

/**
 * 解压 tar.gz（系统 tar，避免为一个 gzip 引入依赖）。解压到临时目录后校验再落缓存，
 * 保证缓存里只可能出现「已校验通过」的二进制。
 */
function extractBinary(tarball, workDir) {
  const r = spawnSync('tar', ['xzf', tarball, '-C', workDir, 'gitleaks'], { encoding: 'utf8', timeout: 60_000 })
  if (r.status !== 0) throw new Error(`解压失败：${(r.stderr ?? '').trim().slice(0, 200)}`)
  const extracted = join(workDir, 'gitleaks')
  if (!existsSync(extracted)) throw new Error('解压后没有找到 gitleaks 可执行文件')
  return extracted
}

async function downloadAndVerify() {
  const tarball = await download(release.url)
  const actual = createHash('sha256').update(tarball).digest('hex')
  console.log(`[secrets] 已下载 gitleaks ${release.version}（${release.key}，${(tarball.length / 1e6).toFixed(1)} MB）`)
  if (!verifyChecksum(release.sha256, actual)) {
    console.error(`[secrets] ✖ SHA256 不符，拒绝执行：`)
    console.error(`[secrets]   期望 ${release.sha256}`)
    console.error(`[secrets]   实际 ${actual}`)
    console.error(`[secrets]   来源 ${release.url}`)
    console.error('[secrets]   这可能意味着发布产物被替换/中间人篡改，或 scripts/ci-tools.json 该更新了。')
    process.exit(1)
  }
  console.log(`[secrets] ✔ SHA256 校验通过（${actual}）`)
  const workDir = mkdtempSync(join(tmpdir(), 'gitleaks-'))
  try {
    const extracted = extractBinaryFrom(tarball, workDir)
    chmodSync(extracted, 0o755)
    /**
     * 落缓存**之前**必须验证它真的是钉死版本 —— 否则一个「SHA256 与自己一致但根本不是
     * gitleaks」的产物会污染缓存，之后每次解析都命中这个假二进制。
     * 开发期实测：回归测试把自制 tarball 写进缓存后，`verify-local --only secret-scan`
     * 一直报「版本不一致」而真实二进制就在旁边（缓存里的假文件把真文件顶掉了）。
     */
    const check = verifyGitleaksVersion(gitleaksVersion(extracted), release.version)
    if (!check.ok) throw new Error(`下载到的产物不是 gitleaks ${release.version}：${check.reason}`)
    const target = cachedPath()
    mkdirSync(dirname(target), { recursive: true })
    renameSync(extracted, target)
    return target
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

/** 落盘 tarball 再解压（tar 需要文件参数；临时目录随用随删）。 */
function extractBinaryFrom(tarball, workDir) {
  const file = join(workDir, 'gitleaks.tar.gz')
  writeFileSync(file, tarball)
  return extractBinary(file, workDir)
}

/**
 * 解析二进制来源，顺序：--bin → PATH → 缓存 → 下载（+SHA256 校验）。
 *
 * 「找得到」不等于「能用」：每个来源都要过**版本核对**才行。实测教训——回归测试把假产物
 * 写进缓存后，缓存里的非 gitleaks 文件会一直被当成可用二进制（假绿）。版本不符即跳过该来源、
 * 继续往下找；PATH 上版本不对时提示一句，避免使用者以为自己装的那份生效了。
 */
async function resolveBinary() {
  const usable = (bin, source) => ({ available: true, bin, source })
  if (options.bin) {
    if (!existsSync(options.bin))
      return { available: false, bin: null, error: `--bin 指定的文件不存在：${options.bin}` }
    return usable(options.bin, '--bin')
  }
  const onPath = options.refresh ? null : whichGitleaks()
  if (onPath) {
    const check = verifyGitleaksVersion(gitleaksVersion(onPath), release.version)
    if (check.ok) return usable(onPath, 'PATH')
    console.log(`[secrets] PATH 上的 gitleaks 不可用（${check.reason}），改用固定版本的缓存/下载`)
  }
  const cache = cachedPath()
  if (existsSync(cache) && !options.refresh) {
    const check = verifyGitleaksVersion(gitleaksVersion(cache), release.version)
    if (check.ok) return usable(cache, 'cache')
    console.log(`[secrets] 缓存里的 gitleaks 不可用（${check.reason}），重新下载固定版本`)
  }
  try {
    return usable(await downloadAndVerify(), 'download')
  } catch (error) {
    return { available: false, bin: null, error: `无法获取 gitleaks：${error?.message ?? error}` }
  }
}

// ── 下载（含 https/socks 代理；本地镜像/网络受限时不静默失败）───────────────
/**
 * 代理隧道：只用 node 内置模块（本仓库不依赖 undici，实测 createRequire 解析不到
 * 顶层 `undici`）。HTTPS_PROXY 指向 http 代理时，用 HTTP CONNECT 建隧道再把 socket
 * 交给 https 请求 —— 这是本地（走 127.0.0.1:7890）能连通 GitHub 的唯一路径。
 */
function tunnelSocket(proxyUrl, targetHost, targetPort) {
  const proxy = new URL(proxyUrl)
  const req = httpGet({
    host: proxy.hostname,
    port: proxy.port || 80,
    method: 'CONNECT',
    path: `${targetHost}:${targetPort}`,
    headers: { host: `${targetHost}:${targetPort}` },
    timeout: 20_000,
  })
  return new Promise((resolve, reject) => {
    req.on('connect', (res, socket) =>
      res.statusCode === 200 ? resolve(socket) : reject(new Error(`代理 CONNECT 失败：HTTP ${res.statusCode}`)),
    )
    req.on('timeout', () => req.destroy(new Error('代理 CONNECT 超时')))
    req.on('error', reject)
    req.end()
  })
}

/** 跟随重定向拉取 URL（最多 6 跳，GitHub Release 会 302 到 objects.githubusercontent.com）。 */
async function download(url, redirects = 0) {
  if (redirects > 6) throw new Error('重定向次数过多')
  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null
  const target = new URL(url)
  const reqOptions = { headers: { 'user-agent': 'my-dsh-plugins-check-secrets' }, timeout: DOWNLOAD_TIMEOUT_MS }
  if (proxyUrl && target.protocol === 'https:')
    reqOptions.socket = await tunnelSocket(proxyUrl, target.hostname, target.port || 443)
  // http:// 也支持：回归测试把下载源指到本地 http 服务（见文件头「下载源覆盖」），
  // 生产路径永远是 https 的 GitHub Release。
  const getter = target.protocol === 'http:' ? httpGet : httpsGet
  return new Promise((resolve, reject) => {
    const req = getter(url, reqOptions, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        download(new URL(res.headers.location, url).href, redirects + 1).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`下载失败：HTTP ${res.statusCode}`))
        return
      }
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('下载超时')))
    req.on('error', reject)
  })
}

// ── 扫描 ────────────────────────────────────────────────────────────────────
/**
 * 调 gitleaks 拿**脱敏报告**（所有输出经 lib 净化后才出本进程）。返回
 * { ok, exitCode, report(JSON文本), stderr }。`--report-path -` 让报告走 stdout，
 * 因此密钥明文不落盘；stderr 只含扫描摘要（不含内容）。
 */
function runGitleaks(bin) {
  const scope = options.scope ?? '--all'
  const r = spawnSync(
    bin,
    [
      'git',
      targetRoot,
      '--no-banner',
      '--redact',
      '--config',
      CONFIG_PATH,
      '--report-format',
      'json',
      '--report-path',
      '-',
      '--log-opts',
      scope,
    ],
    { encoding: 'utf8', timeout: GITLEAKS_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  )
  if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM') {
    return {
      ok: false,
      exitCode: -1,
      report: '',
      stderr: `gitleaks 超过 ${GITLEAKS_TIMEOUT_MS / 1000}s 未返回，已终止`,
    }
  }
  if (r.error) return { ok: false, exitCode: -1, report: '', stderr: `无法启动 gitleaks：${r.error.message}` }
  // 退出码 0 = 干净，1 = 有命中，其他 = 执行异常（配置错、范围非法……）
  const known = r.status === 0 || r.status === 1
  return { ok: known, exitCode: r.status, report: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function parseReport(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return []
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return null // 解析失败 → 调用方按 fail-closed 处理
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
const startedAt = Date.now()
const resolved = options.downloadOnly
  ? options.bin
    ? { available: existsSync(options.bin), bin: options.bin, error: `--bin 指定的文件不存在：${options.bin}` }
    : await resolveBinary()
  : await resolveBinary()
if (!resolved.available) {
  const verdict = decideScanExit({
    available: false,
    findings: [],
    allowMissing: options.allowMissing,
    error: resolved.error,
  })
  console.error(`[secrets] ${verdict.ok ? '⏭ 跳过' : '❌ 失败'}：${verdict.reason}`)
  if (!verdict.ok) {
    console.error('[secrets]   修复：设 HTTPS_PROXY 后重试，或手动安装 gitleaks 并用 --bin 指定；')
    console.error('[secrets]        仅本机临时跳过用 --allow-missing（CI 永远不传该开关，因此门禁不会被放宽）。')
  }
  process.exit(verdict.code)
}

const bin = resolved.bin
if (options.downloadOnly) {
  // 拿到了不等于能用：仍要核对版本，否则「下载成功但产物不对」会被当成就绪
  // （回归测试 scripts/test/secret-scan.test.mjs 用本地假产物钉死这条）。
  const check = verifyGitleaksVersion(gitleaksVersion(bin), release.version)
  if (!check.ok) {
    console.error(`[secrets] ❌ 下载/缓存的产物不是可用的 gitleaks：${check.reason}`)
    process.exit(1)
  }
  console.log(`[secrets] ✅ gitleaks ${check.version} 就绪：${bin}（未扫描）`)
  process.exit(0)
}

const versionCheck = verifyGitleaksVersion(gitleaksVersion(bin), release.version)
if (!versionCheck.ok) {
  console.error(`[secrets] ❌ ${versionCheck.reason}`)
  console.error('[secrets]   为让本地结论与 CI 可互相印证，版本必须一致；加 --refresh 重新下载固定版本。')
  process.exit(1)
}

const run = runGitleaks(bin)
const scopeLabel = options.scope ?? '--all（全历史，覆盖本次 diff）'
if (!run.ok) {
  console.error(
    `[secrets] ❌ gitleaks 执行异常（exit ${run.exitCode}）：${run.stderr.trim().split('\n').slice(-6).join('\n')}`,
  )
  process.exit(1)
}
const raw = parseReport(run.report)
if (raw === null) {
  console.error('[secrets] ❌ 无法解析 gitleaks 的 JSON 报告（fail-closed：解析不了就判失败，绝不当作"干净"）')
  process.exit(1)
}
const findings = dedupeFindings(normalizeFindings(raw))
const scanned = COMMITS_SCANNED_RE.exec(run.stderr)
const commitsScanned = scanned ? Number.parseInt(scanned[1], 10) : 0
/**
 * 「扫了 0 个提交」判失败：与 npm audit 那条教训同源（docs/踩坑/npm-audit在镜像源下静默失效.md）
 * ——「没扫成」和「扫过且干净」必须区分开，否则门禁会静默假绿（例如 shallow clone 或范围写错）。
 */
const nothingScanned = commitsScanned === 0
const verdict = nothingScanned
  ? {
      code: 1,
      ok: false,
      skipped: false,
      reason: `gitleaks 报告扫描了 0 个提交（范围 ${scopeLabel} 无效或仓库是浅克隆）——判失败而非"干净"`,
    }
  : decideScanExit({ available: true, findings })

const ms = Date.now() - startedAt
const summary = renderScanSummary({
  ok: verdict.ok,
  bin,
  version: versionCheck.version,
  scope: scopeLabel,
  commitsScanned,
  findings,
  ms,
  reason: verdict.reason,
})
if (options.json) {
  console.log(
    JSON.stringify(
      scanRecord({
        ok: verdict.ok,
        version: versionCheck.version,
        scope: scopeLabel,
        commitsScanned,
        findings,
        ms,
        reason: verdict.reason,
      }),
      null,
      2,
    ),
  )
} else {
  console.log(summary)
}
process.exit(verdict.code)
