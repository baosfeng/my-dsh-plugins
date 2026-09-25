// secret 扫描门禁的**端到端回归测试**（issue #324 需求 A）。
//
// 这里不测纯函数（那些在 gitleaks-scan.test.mjs），而是真的起 gitleaks 扫一个临时夹具仓库，
// 钉死三件在 CI 里必须成立的事：
//   1. 干净仓库 → 通过（门禁能跑通，不是"配了但没生效"）；
//   2. **塞进一条真形态假密钥 → 门禁变红，且 stdout/stderr 里搜不到那串明文**
//      （issue 的硬要求：本 issue 自身的产物绝不回显明文）；
//   3. allowlist 精确豁免（样例值豁免、换一个真值仍红）。
//
// 需要 gitleaks 二进制：默认找仓库缓存的 .gitleaks-cache/<版本>-<平台>/gitleaks
// （可用 GITLEAKS_BIN 覆盖）。二进制不存在时**跳过**这几条用例并打印原因——CI 里由
// ci.yml 的 `npm run secret:scan -- --download-only` 保证它存在（见 docs/开发指南/构建与测试.md）。
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'check-secrets.mjs')
const TOOLS = JSON.parse(
  execFileSync(
    'node',
    ['-e', `process.stdout.write(require('node:fs').readFileSync('${join(ROOT, 'scripts', 'ci-tools.json')}','utf8'))`],
    { encoding: 'utf8' },
  ),
)
const PLATFORM_KEY = `${process.platform}-${process.arch}`

/** gitleaks 二进制位置（与 scripts/check-secrets.mjs 的缓存路径一致）。 */
function resolveGitleaks() {
  if (process.env.GITLEAKS_BIN) return existsSync(process.env.GITLEAKS_BIN) ? process.env.GITLEAKS_BIN : null
  const cached = join(ROOT, '.gitleaks-cache', `${TOOLS.gitleaks.version}-${PLATFORM_KEY}`, 'gitleaks')
  return existsSync(cached) ? cached : null
}

/**
 * 拿不到二进制时**自己先取一次**（CI 的 quality job 里 test-scripts 是聚合步骤的一部分，
 * 没有单独的"下载 gitleaks"前置步骤）。只有连下载都失败（无网/无代理）才跳过端到端用例并打印原因。
 */
function ensureGitleaks() {
  const found = resolveGitleaks()
  if (found) return found
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-secrets.mjs'), '--download-only'], {
    encoding: 'utf8',
    timeout: 300_000,
  })
  if (r.status === 0) return resolveGitleaks()
  console.warn(
    `[secret-scan.test] 自动获取 gitleaks 失败，端到端用例将跳过：${(r.stderr ?? '').trim().split('\n').pop()}`,
  )
  return null
}

const GITLEAKS = ensureGitleaks()
/**
 * 端到端用例需要真实二进制；没有时**跳过并打印原因**（不让纯逻辑用例跟着一起红）。
 * CI 里由 ci.yml 的 `npm run secret:scan -- --download-only` 先把它下载到缓存。
 */
const SKIP_REASON =
  `本机没有 gitleaks（${join('.gitleaks-cache', `${TOOLS.gitleaks.version}-${PLATFORM_KEY}`, 'gitleaks')}）：` +
  '先跑 `npm run secret:scan -- --download-only`（或设 GITLEAKS_BIN 指向已装版本）'

/** 每个用例的夹具仓库（用完即删）。 */
/**
 * 假 token **在运行时派生**，不把字面量写进文件。
 * 理由（issue #324 自身踩到的坑）：本仓库自己也要过 secret 扫描门禁，测试文件里出现的
 * 「像凭据的高熵串」会被 gitleaks 命中（实测：写死在断言里的对照值被判 generic-api-key，
 * 于是本地门禁对**自己的测试**变红）。派生值同样「像真凭据」（足以被检出），但源码里没有。
 */
function probeToken(seed) {
  return createHash('sha256').update(`my-dsh-plugins/secret-scan-probe/${seed}`).digest('base64url').slice(0, 43)
}

const created = []
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})
/** 跨用例复用的夹具（只在整组结束时删；afterEach 会把它误删，实测踩过）。 */
const persistent = []
const cleanupPersistent = () => {
  for (const dir of persistent.splice(0)) rmSync(dir, { recursive: true, force: true })
}

/** 造一个最小 git 夹具仓库（含 .gitleaks.toml，使 allowlist 用例可复现）。 */
function fixtureRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'secrets-fixture-'))
  created.push(dir)
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['init', '-q', '-b', 'main', '.'])
  git(['config', 'user.email', 'test@example.invalid'])
  git(['config', 'user.name', 'test'])
  cpSync(join(ROOT, '.gitleaks.toml'), join(dir, '.gitleaks.toml'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'chore(fixture): 夹具初始提交'])
  return dir
}

/** 跑 check-secrets.mjs（返回 { code, stdout, stderr }，三者都要参与断言）。 */
function runScan(target, extra = []) {
  const r = spawnSync(process.execPath, [SCRIPT, '--bin', GITLEAKS, '--target', target, ...extra], {
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1' },
  })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * 端到端用例每条要跑 1-3 次真实 gitleaks 扫描 + 若干夹具 git 操作：本机独立跑约 0.7-1.5s，
 * 但在 `npm run verify` 的并发负载下会超过 vitest 默认的 5s（实测被顶穿）。显式给足超时
 * ——**放宽超时不是放宽判据**。
 */
const E2E_TIMEOUT = { timeout: 60_000 }

describe.skipIf(GITLEAKS === null)(`check-secrets.mjs 端到端（${GITLEAKS ?? SKIP_REASON}）`, () => {
  it('干净仓库：通过，并回显扫描了提交数与耗时（证明门禁真的执行了）', E2E_TIMEOUT, () => {
    const repo = fixtureRepo({ 'src/index.js': 'export const answer = 42\n' })
    const r = runScan(repo)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('✅ 通过')
    expect(r.stdout).toContain('1 个提交')
    expect(r.stdout).toContain(`gitleaks ${TOOLS.gitleaks.version}`)
  })

  it('反例：塞一条真形态假密钥 → 门禁变红，且输出里搜不到明文', E2E_TIMEOUT, () => {
    // 43 字符 base64url（形态与真实 access token 相同）——刻意不用任何真实凭据。
    // ⚠️ 夹具必须写成 `token="值"`（关键字与分隔符**紧邻**）：实测 gitleaks 的
    // generic-api-key 不认 `token = "值"`（deny-list 词后接 `\s*[:=]` 才对得上），
    // 写成带空格的形式会让这条反例「构造失败」——用例仍然绿，但根本没在测泄漏检测。
    const fake = probeToken('reverse-case-1')
    const repo = fixtureRepo({ 'src/config.js': `const token="${fake}"\n` })
    const r = runScan(repo)
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('❌ 失败')
    // 定位信息必须有（文件:行:规则），明文必须没有
    expect(r.stdout).toMatch(/src\/config\.js:1:/)
    expect(r.stdout).not.toContain(fake)
    expect(r.stderr).not.toContain(fake)
    expect(r.stdout).not.toContain('REDACTED') // 连脱敏占位串也不出现在报告正文里（我们只给定位）
  })

  it('allowlist 只豁免样例值：把样例换成另一个值，门禁仍然变红', E2E_TIMEOUT, () => {
    // 夹具内使用 .gitleaks.toml 里已豁免的**同一个字面量形态**（token=abc123DEF456ghi）→ 通过
    const allowed = "const READY_LINE = 'http://127.0.0.1:3095/?token=abc123DEF456ghi'\n"

    const repoAllowed = fixtureRepo({ 'src/config.js': allowed })
    expect(runScan(repoAllowed).code).toBe(0)

    // 同一文件、同一位置、只换掉被豁免的**值** → 必须变红（证明豁免的是值而不是路径/规则）
    const other = probeToken('reverse-case-2')
    const repoOther = fixtureRepo({ 'src/config.js': `const READY_LINE = 'http://127.0.0.1:3095/?token=${other}'\n` })
    const r = runScan(repoOther)
    expect(r.code).toBe(1)
    expect(r.stdout).not.toContain(other)
  })

  it('--scope 限定范围：只扫本次提交区间（覆盖 PR diff 场景）', E2E_TIMEOUT, () => {
    const fake = probeToken('scope-1')
    const repo = fixtureRepo({ 'src/index.js': 'export const a = 1\n' })
    writeFileSync(join(repo, 'src/leak.js'), `const token="${fake}"\n`)
    execFileSync('git', ['add', '-A'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'feat(fixture): 引入泄漏'], { cwd: repo })
    const r = runScan(repo, ['--scope', 'HEAD~1..HEAD'])
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('src/leak.js:1:')
    expect(r.stdout).toContain('1 个提交') // 范围裁剪生效：只扫了区间内的 1 个提交
    expect(r.stdout).not.toContain(fake)
  })

  it('扫描 0 个提交 → 判失败（"没扫成"不得与"扫过且干净"混为一谈）', E2E_TIMEOUT, () => {
    const repo = fixtureRepo({ 'a.js': 'export const a = 1\n' })
    const r = runScan(repo, ['--scope', 'HEAD..HEAD'])
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('扫描了 0 个提交')
  })

  it('版本与 ci-tools.json 不一致 → 拒绝执行（本地结论不可与 CI 互相印证）', E2E_TIMEOUT, () => {
    const repo = fixtureRepo({ 'a.js': 'export const a = 1\n' })
    // 用一个假 gitleaks（version 输出对不上）模拟"本机装了别的版本"
    const fakeBin = join(repo, 'fake-gitleaks.sh')
    writeFileSync(fakeBin, '#!/bin/sh\necho "gitleaks version 0.0.1"\n')
    execFileSync('chmod', ['+x', fakeBin])
    const r = spawnSync(process.execPath, [SCRIPT, '--bin', fakeBin, '--target', repo], {
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('不一致')
  })
})

describe('check-secrets.mjs 参数与失败路径（不需要 gitleaks）', () => {
  it('--help 打印用法且退出 0', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('--allow-missing')
  })

  it('未知参数 → 退出码 2（用法错误与门禁失败分开）', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('unknown flag')
  })

  it('拿不到二进制时默认判失败（fail-closed），--allow-missing 才跳过', () => {
    const env = { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1' }
    const args = [SCRIPT, '--bin', '/nonexistent/gitleaks', '--target', ROOT, '--download-only']
    const hard = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60_000, env })
    expect(hard.status).toBe(1)
    expect(hard.stderr).toContain('不存在')
    const soft = spawnSync(process.execPath, [...args, '--allow-missing'], { encoding: 'utf8', timeout: 60_000, env })
    expect(soft.status).toBe(0)
    expect(soft.stderr).toContain('跳过')
  })

  /**
   * issue #108（CodeQL js/file-access-to-http）：出站请求的目标不再由 scripts/ci-tools.json
   * 决定——主机/协议来自代码内常量 TRUSTED_RELEASE_ORIGIN，配置文件只提供路径。
   * 测试专用覆盖变量仍然存在，但**协议被收窄到 http/https**，避免它变成"读任意 URL"的开关。
   */
  it('GITLEAKS_RELEASE_URL 拒绝非 http/https 协议（覆盖口不得变成任意协议读取）', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--target', ROOT, '--download-only', '--refresh'], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, GITLEAKS_RELEASE_URL: 'file:///etc/hosts' },
    })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('只支持 http/https')
  })
})

describe('下载 + SHA256 校验（离线：本地 http 服务 + 测试专用覆盖变量）', () => {
  let cacheDir = null
  let tarballPath = null
  let server = null
  let baseUrl = null

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'secrets-dl-'))
    persistent.push(dir)
    // 下载用例会往缓存目录写「自制产物」→ 必须隔离，否则会污染真缓存（.gitleaks-cache/）
    cacheDir = join(dir, 'cache')
    // 造一个「结构合法但不是 gitleaks」的 tar.gz（只含一个假可执行文件，版本输出对不上）
    const tree = join(dir, 'tree')
    mkdirSync(tree, { recursive: true })
    writeFileSync(join(tree, 'gitleaks'), '#!/bin/sh\necho "gitleaks version 0.0.1"\n')
    tarballPath = join(dir, 'gitleaks_fake.tar.gz')
    execFileSync('tar', ['czf', tarballPath, '-C', tree, 'gitleaks'])
    /**
     * ⚠️ 本地 http 服务必须跑在**独立进程**里：父进程一旦 spawnSync 等子进程，事件循环就
     * 被阻塞，同进程内的 http server 收不到请求 → 双方互等到超时（开发期实测：本组用例
     * 126s 后 ETIMEDOUT，服务端零命中）。所以用 scripts/test/ci-tools-server.mjs。
     */
    server = spawn(process.execPath, [join(ROOT, 'scripts', 'test', 'ci-tools-server.mjs'), tarballPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    /**
     * 兜底回收：afterAll 并非在所有路径都会执行（hook 抛错、用例提前结束、进程提前退出都跳过它）。
     * 强杀形态（SIGKILL）连 exit 钩子也不跑 —— 那一形态由 ci-tools-server.mjs 自身的
     * 父进程死亡看门狗保证回收；这里补的是「JS 还能跑但 afterAll 没轮到」的窗口。
     */
    process.once('exit', () => {
      if (server && server.exitCode === null && server.signalCode === null) server.kill('SIGKILL')
    })
    baseUrl = await new Promise((resolve, reject) => {
      let buf = ''
      const timer = setTimeout(() => reject(new Error('本地下载服务未在 10s 内就绪')), 10_000)
      server.stderr.on('data', (chunk) => {
        buf += chunk
        const port = /PORT=(\d+)/.exec(buf)
        if (port) {
          clearTimeout(timer)
          resolve(`http://127.0.0.1:${port[1]}/gitleaks.tar.gz`)
        }
      })
      server.on('error', reject)
    })
  })

  afterAll(async () => {
    // 只在确实还活着时 kill 并等待 close —— 已退出时 'close' 不会再触发，
    // 无条件 await 会把 afterAll 挂到 hookTimeout（60s 假红）。
    if (server && server.exitCode === null && server.signalCode === null) {
      server.kill('SIGKILL')
      await new Promise((r) => server.on('close', r))
    }
    cleanupPersistent()
  })

  /** 用本地下载源跑一次 --download-only；返回不透明句柄（供逐项断言）。 */
  function runWithLocalSource(sha256) {
    return spawnSync(process.execPath, [SCRIPT, '--target', ROOT, '--download-only', '--refresh'], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, GITLEAKS_RELEASE_URL: baseUrl, GITLEAKS_SHA256: sha256, GITLEAKS_CACHE_DIR: cacheDir },
    })
  }

  it('校验值不符 → 拒绝执行并打印期望/实际（供应链 fail-closed）', () => {
    const r = runWithLocalSource('0'.repeat(64))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('SHA256 不符，拒绝执行')
    expect(r.stderr).toContain('0'.repeat(64))
    expect(tarballPath).not.toBeNull()
  })

  it('校验值相符但产物不是 gitleaks → 版本核对拦下，且**不写进缓存**', () => {
    const digest = createHash('sha256').update(readFileSync(tarballPath)).digest('hex')
    const r = runWithLocalSource(digest)
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toContain('版本')
    // 关键：落缓存前就拦下 —— 否则假二进制会一直顶掉真二进制（开发期实测踩到过）
    expect(existsSync(join(cacheDir, `${TOOLS.gitleaks.version}-${PLATFORM_KEY}`, 'gitleaks'))).toBe(false)
  })
})
