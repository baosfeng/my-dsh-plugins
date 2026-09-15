/**
 * 客户端产物体积预算门禁回归测试（scripts/check-client-size.mjs，issue #322）。
 *
 * 背景：产物体积直接决定用户下载量与加载时间，而 issue #185 曾把 **4.48 MB** 冗余
 * （3.3 MB mermaid UMD 以 base64 内联）注入 client bundle，纯靠人工发现。这个门禁
 * 就是那次事故的机器判定，所以测试必须把「拦住事故量级」与「fail-closed」钉死：
 *
 *   1. 登记基线的产物超过「基线 + 余量」→ **必须失败**（含 CLI exit code 与四列表格）；
 *   2. **未登记**的大文件 → 默认文件上限拦截（防"新增一个 4 MB 文件"绕过基线）；
 *   3. 每插件发布面**合计**超限 → 失败（防"新增一堆中等文件"绕过逐文件检查）；
 *   4. 扫描不到任何产物 → **fail-closed 失败**（绝不静默变绿——插件改名/`files` 写错
 *      会让门禁空转，那是比超标更危险的形态）；
 *   5. 基线缺失/损坏 → 工具错误 exit 2；无 `files` 字段的插件 → 显式失败；
 *   6. **发布面以 `files` 字段为准**：`assets/` 不在 `files` 里就不检查（本仓库
 *      dsh-my-plugin-manager / dsh-my-guardian 的 assets 确实不发布）；
 *   7. 体积变小 / 基线含陈旧条目 → 通过（只允许变好，不阻塞重构）。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirSync } from 'tmp'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ABS_FLOOR_BYTES,
  auditRepo,
  DEFAULT_FILE_LIMIT_BYTES,
  limitFor,
  REL_MARGIN,
  renderReport,
} from '../check-client-size.mjs'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-client-size.mjs')

const roots = []
afterAll(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const KB = 1024

/**
 * 造一个临时仓库 + 基线文件。
 * @param plugins { [name]: { files: string[], entries: { [relPath]: bytes } } } —— `entries`
 *   的 key 是相对插件目录的路径，值是要写进去的字节数（用 0 填充，内容无关）。
 * @param baseline 基线对象（省略则不写基线文件，用于测 fail-closed）
 */
function makeFixture(plugins, baseline) {
  const { name } = dirSync({ unsafeCleanup: true, prefix: 'client-size-' })
  roots.push(name)
  for (const [plugin, spec] of Object.entries(plugins)) {
    const dir = join(name, 'plugins', plugin)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: plugin, files: spec.files }, null, 2))
    for (const [rel, bytes] of Object.entries(spec.entries)) {
      const file = join(dir, rel)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, Buffer.alloc(bytes, 0x20))
    }
  }
  const baselinePath = join(name, 'baseline.json')
  if (baseline !== undefined) writeFileSync(baselinePath, JSON.stringify(baseline, null, 2))
  return { root: name, baselinePath }
}

/** 跑 CLI，返回 { code, stdout, stderr }。 */
function runCli(root, baselinePath) {
  const r = spawnSync('node', [scriptPath, '--root', root, '--baseline', baselinePath], { encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const baselineOf = (perPlugin) => ({ plugins: perPlugin })

describe('limitFor：上限公式（基线 + max(64 KB 绝对底, 15% 相对余量)）', () => {
  it('小体量产物由绝对底主导（改一行不可能触发）', () => {
    // 20 KB 基线的 15% 只有 3 KB，远小于 64 KB 绝对底 → 上限 = 20 KB + 64 KB
    expect(limitFor(20 * KB)).toBe(20 * KB + ABS_FLOOR_BYTES)
  })

  it('大体量产物由相对余量主导（vendored 引擎换版有合理空间）', () => {
    // 1 MB 基线的 15% = 157 KB > 64 KB → 上限 = 1 MB × 1.15
    expect(limitFor(1024 * KB)).toBe(Math.round(1024 * KB * (1 + REL_MARGIN)))
  })

  it('拦住 #185 事故量级：client.js 上限（~152.5 KB 基线）远低于 4.48 MB', () => {
    const limit = limitFor(156144) // dsh-md-render 实测基线（本仓库最大 client.js）
    expect(limit).toBeLessThan(256 * KB)
    expect(limit).toBeLessThan(4480 * KB) // #185 注入量级
  })
})

describe('体积预算门禁：超限必须失败', () => {
  it('登记基线的产物超限 → exit 1，报告含「插件 | 条目 | 当前 KB | 上限 KB | 超出 KB」', () => {
    // 基线 10 KB，实际 100 KB：超限（上限 = 10 KB + 64 KB = 74 KB）
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB } } }),
    )
    writeFileSync(join(root, 'plugins/demo/lib/client.js'), Buffer.alloc(100 * KB, 0x20))
    const { code, stdout } = runCli(root, baselinePath)
    expect(code).toBe(1)
    expect(stdout).toContain('插件')
    expect(stdout).toContain('当前 KB')
    expect(stdout).toContain('上限 KB')
    expect(stdout).toContain('超出 KB')
    expect(stdout).toContain('lib/client.js')
    // 超出量必须算对：100 KB − 74 KB = 26 KB
    expect(stdout).toContain('26.0')
  })

  it('未登记的大文件 → 被默认文件上限拦住（防绕过基线新增 4 MB 文件）', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB } } }),
    )
    // 新增一个未登记的 4 MB 资源（#185 量级）
    mkdirSync(join(root, 'plugins/demo/lib'), { recursive: true })
    writeFileSync(join(root, 'plugins/demo/lib/huge.min.js'), Buffer.alloc(4 * 1024 * KB, 0x20))
    const { code, stdout } = runCli(root, baselinePath)
    expect(code).toBe(1)
    expect(stdout).toContain('lib/huge.min.js')
    expect(stdout).toContain('未登记')
  })

  it('未登记的小文件（截图级）→ 通过，不制造日常摩擦', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib', 'assets'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB } } }),
    )
    mkdirSync(join(root, 'plugins/demo/assets'), { recursive: true })
    writeFileSync(join(root, 'plugins/demo/assets/shot.png'), Buffer.alloc(180 * KB, 0x20))
    expect(runCli(root, baselinePath).code).toBe(0)
  })

  it('未登记文件恰好等于默认上限 → 通过（上限是闭合区间）', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB } } }),
    )
    writeFileSync(join(root, 'plugins/demo/lib/exact.bin'), Buffer.alloc(DEFAULT_FILE_LIMIT_BYTES, 0x20))
    expect(runCli(root, baselinePath).code).toBe(0)
  })

  it('发布面合计超限 → 失败（防"新增一堆中等文件"绕过逐文件检查）', () => {
    const entries = { 'lib/client.js': 10 * KB }
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB }, total: 10 * KB } }),
    )
    // 每个文件都不超默认上限（900 KB < 1 MB），但 4 个加起来超合计上限（10 KB + 64 KB）
    for (let i = 0; i < 4; i += 1) {
      writeFileSync(join(root, `plugins/demo/lib/chunk-${i}.bin`), Buffer.alloc(900 * KB, 0x20))
    }
    const { code, stdout } = runCli(root, baselinePath)
    expect(code).toBe(1)
    expect(stdout).toContain('合计')
  })
})

describe('fail-closed：绝不静默变绿', () => {
  it('扫描不到任何产物 → exit 1（插件改名 / files 写错会让门禁空转）', () => {
    const { root, baselinePath } = makeFixture({}, baselineOf({}))
    const { code, stdout, stderr } = runCli(root, baselinePath)
    expect(code).toBe(1)
    expect(`${stdout}${stderr}`).toContain('产物')
  })

  it('插件 package.json 解析失败 → exit 1（不静默跳过该插件）', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB } } }),
    )
    writeFileSync(join(root, 'plugins/demo/package.json'), '{ not json')
    const { code } = runCli(root, baselinePath)
    expect(code).toBe(1)
  })

  it('插件缺 files 字段 → exit 1（发布面无法确定，不能猜）', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB } } }),
    )
    writeFileSync(join(root, 'plugins/demo/package.json'), JSON.stringify({ name: 'demo' }))
    const { code, stderr } = runCli(root, baselinePath)
    expect(code).toBe(1)
    expect(stderr).toContain('files')
  })

  it('基线文件缺失 → 工具错误 exit 2', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      undefined,
    )
    const { code } = runCli(root, baselinePath)
    expect(code).toBe(2)
  })

  it('基线 JSON 损坏 → 工具错误 exit 2', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB } } }),
    )
    writeFileSync(baselinePath, '{ broken')
    expect(runCli(root, baselinePath).code).toBe(2)
  })
})

describe('发布面以 package.json 的 files 字段为准', () => {
  it('assets 不在 files 里 → 不检查该目录（本仓库有插件的 assets 确实不发布）', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB } } }),
    )
    // 目录里放一个 5 MB 的资源，但 files 未声明 assets → 不属于发布面，不该失败
    mkdirSync(join(root, 'plugins/demo/assets'), { recursive: true })
    writeFileSync(join(root, 'plugins/demo/assets/huge.png'), Buffer.alloc(5 * 1024 * KB, 0x20))
    expect(runCli(root, baselinePath).code).toBe(0)
  })

  it('files 里的目录被递归展开，嵌套大文件同样受检', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB } } }),
    )
    mkdirSync(join(root, 'plugins/demo/lib/deep/deeper'), { recursive: true })
    writeFileSync(join(root, 'plugins/demo/lib/deep/deeper/big.min.js'), Buffer.alloc(4 * 1024 * KB, 0x20))
    const { code, stdout } = runCli(root, baselinePath)
    expect(code).toBe(1)
    expect(stdout).toContain('lib/deep/deeper/big.min.js')
  })

  it('files 含 glob 形态 → exit 1（不支持的形态必须显式失败，不得静默漏扫）', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib/*.js'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB } } }),
    )
    const { code, stderr } = runCli(root, baselinePath)
    expect(code).toBe(1)
    expect(stderr).toContain('glob')
  })
})

describe('只允许变好：变小 / 陈旧基线条目不阻塞', () => {
  it('产物变小 → 通过', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 100 * KB } } }),
    )
    expect(runCli(root, baselinePath).code).toBe(0)
  })

  it('基线含磁盘上已不存在的陈旧条目 → 通过（重构/改文件名不该被旧基线挡住）', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB, 'lib/gone.js': 500 * KB } } }),
    )
    const { code, stdout } = runCli(root, baselinePath)
    expect(code).toBe(0)
    expect(stdout).toContain('陈旧')
  })

  it('基线里记录的插件在仓库中不存在 → 通过（插件退役后基线可滞后清理）', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({
        demo: { files: { 'lib/client.js': 10 * KB } },
        retired: { files: { 'lib/client.js': 999 * KB } },
      }),
    )
    expect(runCli(root, baselinePath).code).toBe(0)
  })
})

describe('auditRepo：结构化结果', () => {
  it('返回逐插件条目、超限项与合计', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB } } }),
    )
    writeFileSync(join(root, 'plugins/demo/lib/client.js'), Buffer.alloc(100 * KB, 0x20))
    const result = auditRepo({ root, baselinePath })
    expect(result.plugins.length).toBe(1)
    expect(result.problems.length).toBeGreaterThan(0)
    expect(result.problems[0].plugin).toBe('demo')
    expect(result.problems[0].path).toBe('lib/client.js')
    expect(result.problems[0].over).toBe(100 * KB - limitFor(10 * KB))
  })

  it('renderReport 对通过结果给出一句话结论（含发布面规模）', () => {
    const { root, baselinePath } = makeFixture(
      { demo: { files: ['lib'], entries: { 'lib/client.js': 10 * KB } } },
      baselineOf({ demo: { files: { 'lib/client.js': 10 * KB } } }),
    )
    const report = renderReport(auditRepo({ root, baselinePath }))
    expect(report).toContain('✅')
    expect(report).toContain('1 个插件')
  })
})
