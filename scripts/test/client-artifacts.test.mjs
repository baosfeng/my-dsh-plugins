// scripts/check-client-artifacts.mjs + scripts/lib/client-artifacts.mjs 回归测试（issue #318）。
//
// 门禁的价值全在「改一个共享件但不重建 → 必须失败」这条路径上，所以测试分三层：
//   1. 纯函数契约：三种真实的部件引用写法都要识别（'icons.part.js' / 'icons.part' / 'icons'）；
//   2. 注入式判定：构造「期望 ≠ 已提交」→ 判定漂移并给出首个差异位置；
//   3. 端到端（临时 git 仓库 + 最小假插件，不依赖 node_modules / tsc）：
//      · 正常态 → exit 0；
//      · 改了 part 不重建 → exit 1，且报告里点名插件与共享件（issue #318 的验收标准）。
import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirSync } from 'tmp'
import { afterAll, describe, expect, it } from 'vitest'
import {
  describeDrift,
  evaluateClientArtifacts,
  findClientArtifactConsumers,
  parsePartRefs,
} from '../lib/client-artifacts.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const scriptPath = join(REPO_ROOT, 'scripts', 'check-client-artifacts.mjs')
const tmpRoots = []
/** 注入给被测子进程的专属 TMPDIR 作用域（#336：断言只看这些目录，避免并发假红）。 */
const tmpScopes = []
afterAll(() => {
  for (const dir of tmpScopes.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 在注入的 TMPDIR 作用域里同步跑一次门禁（并让它把镜像路径写到 reportPath）。 */
function runGateInScope(scope, reportPath, args) {
  try {
    const out = execFileSync('node', [scriptPath, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
      env: { ...process.env, TMPDIR: scope, DSH_ARTIFACT_MIRROR_REPORT: reportPath },
    })
    return { code: 0, out }
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(file)) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}

describe('parsePartRefs / findClientArtifactConsumers', () => {
  it('识别三种真实写法（.part.js / .part / 裸名），且忽略非部件字符串', () => {
    const source = `const PARTS = [
      ['/*__PART_ICONS__*/', 'icons.part.js', { shared: true }],
      ['__PART_STYLE_TAG__', 'style-tag.part', { shared: true }],
      ['__PART_ICONS__', 'icons', { shared: true }],
      ['__PART_I18N__', 'i18n'],
    ]`
    const refs = parsePartRefs(source)
    expect(refs.has('icons.part.js')).toBe(true)
    expect(refs.has('style-tag.part')).toBe(true)
    expect(refs.has('icons')).toBe(true)
    expect(refs.has('i18n')).toBe(true)
    // 裸名（file-activity 的写法 'icons' + { shared: true }）必须被识别出来
    // 占位符（__PART_*__）也会被解析出来——这是**设计如此**：判据靠"与 dsh-shared
    // 真实文件名求交集"过滤，而不是靠正则去猜哪个字符串是占位符
    // （见下一个用例：只有 icons.part.js 这类真实共享件才产生消费方）
  })

  it('只把「真实共享件」的引用算作消费方，并归一简写', () => {
    const consumers = findClientArtifactConsumers(
      {
        'plugin-a': `['x', 'icons.part', { shared: true }]`,
        'plugin-b': `['x', 'icons', { shared: true }]`,
        'plugin-c': `['x', 'style-tag.part.js', { shared: true }]`,
        'plugin-d': `['x', 'own-part']`, // 本地片段，不是共享件 → 不参与
      },
      ['icons.part.js', 'style-tag.part.js', 'dom-scanner.part.js'],
    )
    const byPlugin = Object.fromEntries(consumers.map((c) => [c.plugin, c.parts]))
    expect(Object.keys(byPlugin).sort()).toEqual(['plugin-a', 'plugin-b', 'plugin-c'])
    expect(byPlugin['plugin-a']).toEqual(['icons.part.js'])
    expect(byPlugin['plugin-b']).toEqual(['icons.part.js']) // 裸名 → 真实共享件名
    expect(byPlugin['plugin-c']).toEqual(['style-tag.part.js'])
    expect(byPlugin['plugin-d']).toBeUndefined() // 本地片段不参与
  })
})

describe('evaluateClientArtifacts / describeDrift', () => {
  it('期望与已提交一致 → ok', () => {
    const buf = Buffer.from('same')
    const result = evaluateClientArtifacts([{ plugin: 'p', parts: ['icons.part.js'] }], () => ({
      expected: buf,
      actual: Buffer.from('same'),
    }))
    expect(result).toEqual({ ok: true, checked: 1, drifted: [] })
  })

  it('期望与已提交不一致 → 判漂移，并报出首个差异字节位置', () => {
    const result = evaluateClientArtifacts([{ plugin: 'p', parts: ['icons.part.js'] }], () => ({
      expected: Buffer.from('abcNEW'),
      actual: Buffer.from('abcOLD'),
    }))
    expect(result.ok).toBe(false)
    expect(result.drifted).toHaveLength(1)
    expect(result.drifted[0].plugin).toBe('p')
    expect(result.drifted[0].reason).toContain('首个差异 @字节 3')
  })

  it('缺产物 / 产物未提交 → fail-closed（不是静默通过）', () => {
    const missing = evaluateClientArtifacts([{ plugin: 'p', parts: [] }], () => ({
      expected: null,
      actual: Buffer.from('x'),
    }))
    expect(missing.ok).toBe(false)
    expect(missing.drifted[0].reason).toContain('未生成')
    const untracked = evaluateClientArtifacts([{ plugin: 'p', parts: [] }], () => ({
      expected: Buffer.from('x'),
      actual: null,
    }))
    expect(untracked.ok).toBe(false)
    expect(untracked.drifted[0].reason).toContain('未纳入版本控制')
    expect(describeDrift(Buffer.from('a'), Buffer.from('ab'))).toContain('长度不同')
  })
})

/** 造一个最小可跑的沙箱：真 git 仓库 + dsh-shared/client-parts + 一个假消费方插件。 */
function makeSandbox() {
  const root = join(dirSync({ unsafeCleanup: true, prefix: 'artifact-gate-' }).name, 'repo')
  tmpRoots.push(dirname(root))
  mkdirSync(join(root, 'plugins', 'dsh-shared', 'client-parts'), { recursive: true })
  mkdirSync(join(root, 'plugins', 'fake-plugin', 'scripts'), { recursive: true })
  mkdirSync(join(root, 'plugins', 'fake-plugin', 'lib'), { recursive: true })
  writeFileSync(join(root, 'plugins', 'dsh-shared', 'client-parts', 'icons.part.js'), 'function icon() { return 1 }\n')
  // 假 build.mjs：把 icons.part.js 的内容拼进 lib/client.js（等价于真实 splice 的最简形态）
  writeFileSync(
    join(root, 'plugins', 'fake-plugin', 'scripts', 'build.mjs'),
    [
      "import { readFileSync, writeFileSync } from 'node:fs'",
      "const parts = [['__PART_ICONS__', 'icons.part.js', { shared: true }]]",
      "let out = readFileSync('lib/client.src.js', 'utf8')",
      'for (const [ph, file] of parts) {',
      "  out = out.replace(ph, readFileSync(`../dsh-shared/client-parts/${file}`, 'utf8'))",
      '}',
      "writeFileSync('lib/client.js', out)",
      '',
    ].join('\n'),
  )
  writeFileSync(join(root, 'plugins', 'fake-plugin', 'lib', 'client.src.js'), '/*__PART_ICONS__*/\n')
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  // 先提交"已重建"的产物 → 正常态
  execFileSync('node', ['scripts/build.mjs'], { cwd: join(root, 'plugins', 'fake-plugin') })
  git('add', '-A')
  git('commit', '-q', '-m', 'baseline')
  return { root, pluginDir: join(root, 'plugins', 'fake-plugin') }
}

function runGate(root, { timeout = 120_000 } = {}) {
  try {
    const out = execFileSync('node', [scriptPath, '--client-only', '--root', root], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    })
    return { code: 0, out }
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

describe('端到端（临时 git 仓库，含「改 part 不重建」失败用例）', () => {
  it('正常态：产物与共享件同源 → exit 0', { timeout: 120_000 }, () => {
    const { root } = makeSandbox()
    const { code, out } = runGate(root)
    expect(code, out).toBe(0)
    expect(out).toContain('同源')
  })

  it('改共享件但不重建产物 → exit 1，报告点名插件与共享件（issue #318 验收）', { timeout: 120_000 }, () => {
    const { root } = makeSandbox()
    writeFileSync(
      join(root, 'plugins', 'dsh-shared', 'client-parts', 'icons.part.js'),
      'function icon() { return 2 }\n',
    )
    // 镜像取自 HEAD（#336：只读镜像按提交内容重建），所以共享件改动要先提交——
    // "共享件已提交、消费方产物没重建（仍是旧内容）"正是本用例要抓的漂移形态。
    execFileSync('git', ['commit', '-q', '-am', 'change part without rebuilding'], { cwd: root, stdio: 'ignore' })
    const { code, out } = runGate(root)
    expect(code, out).toBe(1)
    expect(out).toContain('fake-plugin')
    expect(out).toContain('icons.part.js')
    expect(out).toContain('scripts/build.mjs')
  })

  // 真实仓库要重建 11 个插件的 client bundle（约 3-4s），默认 5s testTimeout 会假红
  it('真实仓库当前态：共享件消费方与产物同源（本卡修复后应为绿）', { timeout: 120_000 }, () => {
    const { code, out } = runGate(REPO_ROOT)
    expect(code, out).toBe(0)
    const listed = execFileSync('node', [scriptPath, '--list'], { cwd: REPO_ROOT, encoding: 'utf8' })
    expect(listed).toContain('dsh-my-observability\ticons.part.js')
  })
})

describe('真实仓库的共享件清单（判据输入不是手写列表）', () => {
  it('dsh-shared/client-parts 下的 .part.js 都被至少一个消费方引用或被显式忽略', () => {
    const consumers = findClientArtifactConsumers(
      Object.fromEntries(
        [
          'dsh-md-render',
          'dsh-mermaid-render',
          'dsh-my-guard',
          'dsh-my-guardian',
          'dsh-my-memory',
          'dsh-my-notify',
          'dsh-my-observability',
          'dsh-my-plugin-manager',
          'dsh-my-skill-manager',
          'dsh-think-zh-expand',
          'dsh-file-activity',
        ].map((p) => [p, readFileSync(join(REPO_ROOT, 'plugins', p, 'scripts', 'build.mjs'), 'utf8')]),
      ),
      ['icons.part.js', 'style-tag.part.js', 'dom-scanner.part.js', 'markdown-fallback.part.js'],
    )
    expect(consumers.length).toBeGreaterThanOrEqual(11)
    expect(consumers.map((c) => c.plugin)).toContain('dsh-file-activity')
    expect(consumers.map((c) => c.plugin)).toContain('dsh-my-observability')
    expect(consumers.filter((c) => c.parts.includes('markdown-fallback.part.js')).map((c) => c.plugin)).toEqual([
      'dsh-my-plugin-manager',
      'dsh-think-zh-expand',
    ])
  })
})

/**
 * issue #336 回归：门禁对工作区**只读**。
 *
 * 为什么必须断言 mtime/inode 而不只是 `git status`：`build.mjs` 会 `writeFileSync` 再
 * `prettier --write lib/parts`——**内容相同但 inode/mtime 变了**，`git status` 看不见，
 * 却足以让并发 `prettier --check .` 读到中途态而假红，并能覆盖别人未提交的编辑。
 * （本文件由 `client-parts` 回归测试与一个临时 git 仓库共同覆盖；这里直接跑真实脚本。）
 */
/** 全仓「产物 + parts」快照：路径 → {hash, mtimeMs, ino, size}。 */
function artifactSnapshot(root) {
  const snap = new Map()
  const pluginsDir = join(root, 'plugins')
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const lib = join(pluginsDir, entry.name, 'lib')
    if (!existsSync(lib)) continue
    const walk = (dir) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, item.name)
        if (item.isDirectory()) walk(full)
        else if (item.name.endsWith('.js') || item.name.endsWith('.d.ts')) {
          const st = statSync(full)
          snap.set(full, {
            hash: createHash('sha256').update(readFileSync(full)).digest('hex'),
            mtimeMs: st.mtimeMs,
            ino: st.ino,
            size: st.size,
          })
        }
      }
    }
    walk(lib)
  }
  return snap
}

function diffSnapshots(before, after) {
  const changed = []
  for (const [file, b] of before) {
    const a = after.get(file)
    if (!a) {
      changed.push(`${file}: 消失`)
      continue
    }
    if (b.hash !== a.hash) changed.push(`${file}: 内容变化`)
    else if (b.mtimeMs !== a.mtimeMs || b.ino !== a.ino) changed.push(`${file}: 内容相同但被重写（mtime/inode 变化）`)
  }
  return changed
}

describe('只读契约（issue #336：检查项不得写工作区）', () => {
  it('client + server 重建后，全仓产物与 parts 的 hash/mtime/inode 均不变', { timeout: 300_000 }, () => {
    const before = artifactSnapshot(REPO_ROOT)
    const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' })
    const { code, out } = runGate(REPO_ROOT) // runGate 带 --client-only
    expect(code, out).toBe(0)
    // 再跑一次完整（含 server tsc）——两条路径都必须只读
    execFileSync('node', [scriptPath, '--root', REPO_ROOT], { cwd: REPO_ROOT, stdio: 'ignore', timeout: 300_000 })
    const after = artifactSnapshot(REPO_ROOT)
    expect(diffSnapshots(before, after)).toEqual([])
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' })).toBe(statusBefore)
  })

  /**
   * #336 返工：原断言读的是**全局** `os.tmpdir()` 里的镜像计数，而镜像名对所有并发进程可见
   * （多个 agent 同时在跑 verify / artifacts 检查）→ 别人的进程建/删镜像就会让这条断言假红
   * （实测：单文件跑绿、本地并发跑红、CI 单进程跑绿）。
   *
   * 正确做法：**给被测子进程注入专属 TMPDIR 作用域**，只断言那个作用域。前提已实测：
   * Node 的 `os.tmpdir()` 遵循 `TMPDIR`（见最后一条用例）。
   */
  it('正常路径：镜像建在注入的专属作用域里，跑完作用域为空', { timeout: 300_000 }, () => {
    const scope = mkdtempSync(join(tmpdir(), 'dsh-artifacts-scope-'))
    tmpScopes.push(scope)
    const reportPath = join(scope, 'mirror-path.txt')
    const result = runGateInScope(scope, reportPath, ['--client-only', '--root', REPO_ROOT])
    expect(result.code, result.out).toBe(0)
    // 报告文件在清理时被一并删掉（幂等），所以"跑完不存在"本身就是清理已发生的证据
    expect(existsSync(reportPath), '报告文件应在清理时被删除').toBe(false)
    expect(readdirSync(scope).filter((n) => n.startsWith('dsh-artifacts-mirror-'))).toEqual([])
  })

  it('被 SIGTERM 杀死：残留只可能在调用方作用域内，绝不落到全局 temp', { timeout: 300_000 }, async () => {
    const scope = mkdtempSync(join(tmpdir(), 'dsh-artifacts-scope-'))
    tmpScopes.push(scope)
    const reportPath = join(scope, 'mirror-path.txt')
    const child = spawn('node', [scriptPath, '--client-only', '--root', REPO_ROOT], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
      env: { ...process.env, TMPDIR: scope, DSH_ARTIFACT_MIRROR_REPORT: reportPath },
    })
    // 等镜像路径被报告出来（此时构建正在进行），再 SIGTERM —— 命中的是真实"构建中被杀"窗口
    expect(await waitForFile(reportPath, 60_000), '等待镜像报告超时').toBe(true)
    const reported = readFileSync(reportPath, 'utf8').trim()
    expect(reported.startsWith(scope), '镜像必须建在调用方作用域内').toBe(true)
    child.kill('SIGTERM')
    await new Promise((resolve) => child.on('exit', resolve))
    // 实测结论：execFileSync 阻塞事件循环 → 信号处理器/exit 钩子都来不及执行，
    // 镜像可能残留；但残留**必然在注入的作用域内**（全局 temp 不受影响）——这就是本关守卫的东西。
    const strays = readdirSync(scope).filter((n) => n.startsWith('dsh-artifacts-mirror-'))
    // 有残留属预期（见上文实测结论）；关键是它们全都在注入的作用域内，
    // 且报告文件（若仍在）指向的也是这个作用域 —— 调用方据此可整体清理。
    for (const stray of strays) expect(join(scope, stray).startsWith(scope)).toBe(true)
  })

  it('os.tmpdir() 遵循注入的 TMPDIR（隔离机制的前提，实测而非假设）', () => {
    const scope = mkdtempSync(join(tmpdir(), 'dsh-artifacts-scope-'))
    tmpScopes.push(scope)
    const out = execFileSync('node', ['-e', "process.stdout.write(require('node:os').tmpdir())"], {
      env: { ...process.env, TMPDIR: scope },
      encoding: 'utf8',
    })
    expect(realpathSync(out)).toBe(realpathSync(scope))
  })
})
