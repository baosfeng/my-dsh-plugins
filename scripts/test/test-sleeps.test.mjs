/**
 * 固定 sleep 门禁回归测试（scripts/lib/test-sleeps.mjs + scripts/check-test-sleeps.mjs，issue #335）。
 *
 * 门禁本身也要有测试：判定错了会同时产生假绿（放过新增裸 sleep → 第 6 次复发）
 * 与假红（把合理的负向观察窗/轮询工具判成违规 → 团队绕过门禁）。覆盖：
 *   ① 分类判据：`setTimeout(fn, 0)` 安全 / `setTimeout(fn, N>0)` 受管 / 标识符延时为 dynamic；
 *   ② 豁免判据：同行注释、上一行注释、`sleepFor('理由', ms)` 的内联理由，理由过短不算；
 *   ③ 基线判据：基线命中的存量放行、基线外的**新增**必须报违规、基线 stale 可识别；
 *   ④ 端到端：对当前仓库跑真实 CLI 必须通过（门禁在 CI 里就是这个命令）。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '@babel/parser'
import { auditWaits, findWaits, fingerprint, fixHint } from '../lib/test-sleeps.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const parseSource = (source) => parse(source, { sourceType: 'module', plugins: ['topLevelAwait'] })

/** 扫描一段源码里的固定等待点。 */
const scan = (source) => findWaits(source, parseSource)

describe('分类判据（issue #335：每一类都要有判据）', () => {
  it('setTimeout(..., 0) 归为 yield（让出事件循环，安全）', () => {
    const waits = scan('await new Promise((resolve) => setTimeout(resolve, 0))\n')
    expect(waits).toHaveLength(1)
    expect(waits[0].category).toBe('yield')
  })

  it('setTimeout(..., 非零字面量) 归为 fixed（受管，必须解释）', () => {
    const waits = scan('setTimeout(() => { done = true }, 250)\n')
    expect(waits[0].category).toBe('fixed')
    expect(waits[0].delay).toBe(250)
  })

  it('settle(80) / sleep(20) 这类包装函数同样受管', () => {
    const waits = scan('await settle(80)\nawait sleep(20)\n')
    expect(waits.map((w) => w.category)).toEqual(['fixed', 'fixed'])
    expect(waits.map((w) => w.callee)).toEqual(['settle', 'sleep'])
  })

  it('标识符/表达式延时归为 dynamic（不阻断，仅提示 review）', () => {
    const waits = scan('await new Promise((resolve) => setTimeout(resolve, intervalMs))\n')
    expect(waits[0].category).toBe('dynamic')
  })

  it('vitest 的 { timeout: N } 不是等待点（框架超时不在扫描面）', () => {
    expect(scan("test('x', async () => {}, { timeout: 5000 })\n")).toHaveLength(0)
  })
})

describe('豁免判据', () => {
  it('同行 // sleep-ok: 理由 即可豁免', () => {
    const waits = scan('setTimeout(() => release(), 300) // sleep-ok: 人为延时构造慢 IO\n')
    expect(waits[0].exempt).toBe(true)
  })

  it('紧邻上一行的 // sleep-ok: 也可豁免（多行调用常见）', () => {
    const waits = scan('// sleep-ok: 负向断言观察窗口，没有正向条件可等\nawait settle(100)\n')
    expect(waits[0].exempt).toBe(true)
  })

  it('sleepFor("理由", ms) 的内联理由即豁免', () => {
    const waits = scan("await sleepFor('观察窗口：断言没有新告警产生', 20)\n")
    expect(waits[0].exempt).toBe(true)
  })

  it('理由过短不算豁免（防止 // sleep-ok: x 敷衍）', () => {
    const waits = scan('setTimeout(fn, 100) // sleep-ok: x\n')
    expect(waits[0].exempt).toBe(false)
  })
})

describe('基线判据', () => {
  const source = 'await settle(80)\n'
  const entries = () => [{ file: 'plugins/x/test/a.mjs', waits: scan(source) }]

  it('基线命中的存量放行（不给存量加噪音）', () => {
    const id = fingerprint('plugins/x/test/a.mjs', 'await settle(80)')
    const result = auditWaits(entries(), [id])
    expect(result.violations).toHaveLength(0)
    expect(result.staleBaseline).toHaveLength(0)
  })

  it('基线外的**新增**固定等待报违规（这正是第 6 次复发的入口）', () => {
    const result = auditWaits(entries(), [])
    expect(result.violations).toHaveLength(1)
    expect(fixHint(result.violations[0])).toContain('waitFor')
  })

  it('基线与代码不一致时：未命中的点报违规，未消费的基线条目报 stale（两个方向都不静默）', () => {
    const result = auditWaits(entries(), ['plugins/x/test/a.mjs::deadbeef'])
    expect(result.violations).toHaveLength(1)
    expect(result.staleBaseline).toEqual(['plugins/x/test/a.mjs::deadbeef'])
  })

  it('指纹与行号无关（只认代码内容），同一行内容多处出现按条数消解', () => {
    expect(fingerprint('f.mjs', '  await settle(80)  ')).toBe(fingerprint('f.mjs', 'await settle(80)'))
    const twice = [{ file: 'f.mjs', waits: [...scan(source), ...scan(source)] }]
    expect(auditWaits(twice, [fingerprint('f.mjs', 'await settle(80)')]).violations).toHaveLength(1)
  })
})

describe('端到端（CI 里跑的就是这条命令）', () => {
  it('当前仓库通过门禁，且报告出三类计数', () => {
    // env 隔离：不把测试进程的 NODE_OPTIONS 等注入子进程（否则子进程可能往 stderr 打警告）
    const env = { ...process.env, NODE_OPTIONS: '' }
    const result = spawnSync('node', ['scripts/check-test-sleeps.mjs'], { cwd: root, encoding: 'utf8', env })
    // 断言的是门禁的**语义结果**（退出码 + 无违规），不是"stderr 字节级为空"：
    // 后者会被任何无关的 Node 警告搞成假红（实测：并发跑时 stderr 非空）。
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    expect(result.stderr).not.toMatch(/固定 sleep 门禁失败|解析失败/)
    expect(result.stdout).toMatch(/固定 sleep 门禁通过/)

    const json = spawnSync('node', ['scripts/check-test-sleeps.mjs', '--json'], { cwd: root, encoding: 'utf8', env })
    const parsed = JSON.parse(json.stdout)
    expect(parsed.violations).toBe(0)
    expect(parsed.fixed).toBeGreaterThan(0)
    expect(parsed.yield).toBeGreaterThan(0)
  })

  it('基线文件存在且与当前扫描一致（防止有人手工清空基线放水）', () => {
    const baseline = JSON.parse(readFileSync(join(root, 'scripts', 'test-sleep-baseline.json'), 'utf8'))
    expect(Array.isArray(baseline.entries)).toBe(true)
    // 基线只允许变少：收缩后 --update-baseline 会写回，此处只校验「不为空且已排序」
    expect(baseline.entries.length).toBeGreaterThan(0)
    expect([...baseline.entries].sort()).toEqual(baseline.entries)
  })

  /**
   * issue #107（CodeQL js/file-system-race）回归：`--update-baseline` 的「首建允许、此后只允许
   * 收缩」判据原先写成 `existsSync(baselineFile)` 再 `writeFileSync`，两行之间文件状态可变。
   * 现在由 `open(O_CREAT|O_EXCL)` 的 **EEXIST** 给出「此前是否存在」的答案（检查与使用同一次
   * 系统调用）。这里把两种情形都钉住：文件**不存在** → 允许建基线；文件**已存在** → 走收缩判据。
   */
  it('--update-baseline：首次（文件不存在）建基线，已存在时按只收缩判定（issue #107）', () => {
    const fake = mkdtempSync(join(tmpdir(), 'test-sleeps-baseline-'))
    try {
      mkdirSync(join(fake, 'plugins', 'fake', 'test'), { recursive: true })
      mkdirSync(join(fake, 'scripts', 'test'), { recursive: true })
      writeFileSync(join(fake, 'plugins', 'fake', 'test', 'waits.mjs'), 'await settle(50)\n')
      const baselinePath = join(fake, 'scripts', 'test-sleep-baseline.json')
      const run = () =>
        spawnSync('node', ['scripts/check-test-sleeps.mjs', '--root', fake, '--update-baseline'], {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, NODE_OPTIONS: '' },
        })
      // ① 文件不存在 → 建基线（写入扫描到的 1 条），退出 0
      const first = run()
      expect(first.status, `stderr: ${first.stderr}`).toBe(0)
      expect(JSON.parse(readFileSync(baselinePath, 'utf8')).entries).toHaveLength(1)
      // ② 文件已存在、新条目数未超现有 → 放行（走的是 open(O_EXCL) 的 EEXIST 分支，非 existsSync）
      const second = run()
      expect(second.status, `stderr: ${second.stderr}`).toBe(0)
      expect(JSON.parse(readFileSync(baselinePath, 'utf8')).entries).toHaveLength(1)
      // ③ 文件已存在且现有更少 → 仍按「只允许收缩」拒绝，证明判据语义没被改坏
      writeFileSync(baselinePath, JSON.stringify({ note: 'x', entries: [] }, null, 2) + '\n')
      const third = run()
      expect(third.status).toBe(1)
      expect(third.stderr).toContain('只允许收缩')
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })
})
