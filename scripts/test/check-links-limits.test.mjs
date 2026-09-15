/**
 * #327 回归：check-links 的门禁读取路径（字节上限 + errno 分类）。
 *
 * 背景：`76f52ac` 为消除 CodeQL `js/file-system-race`，把 `statSync(abs).size > MAX_FILE_BYTES`
 * 的**预先跳过**改成「`readFileSync` 后判 `content.length`」。代价有两层：
 *   ① 本仓存在 6.9MB / 3.3MB 的 min.js 产物——旧代码根本不读，改后每次 check-links 都
 *      把整个文件读进内存再丢弃；
 *   ② `content.length` 是 UTF-16 码元数，中文文档的字节账最多低估 3 倍（常量叫 MAX_FILE_BYTES）。
 *
 * 本文件的断言刻意钉在「`readFileSync` 有没有被这个路径调用过」上：只断言「被跳过」的测试，
 * 对「先读后判」的实现同样成立，等于没测。用 `vi.mock` 包一层真实 fs，只做调用记录，不改变行为。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dirSync } from 'tmp'
import { readFailureReason, runCheck } from '../check-links.mjs'

/**
 * 读取探针：记录 readFileSync 的调用目标。
 *  · 按**路径**调用的进 stringPaths；
 *  · 按 **fd** 调用的（正解形态）用 fstat 取 inode 记进 fdInos —— 这样"某个文件有没有被读入"
 *    依然可精确断言（inode 在 fixture 存活期内唯一），不会因为改用 fd 读取就失去观测能力。
 */
const probe = vi.hoisted(() => ({ stringPaths: [], fdInos: [] }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    readFileSync: (target, ...rest) => {
      if (typeof target === 'string') probe.stringPaths.push(target)
      else if (typeof target === 'number') {
        try {
          probe.fdInos.push(actual.fstatSync(target).ino)
        } catch {
          /* fd 已被关闭：不影响判定 */
        }
      }
      return actual.readFileSync(target, ...rest)
    },
  }
})

const tmpRoots = []
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  probe.stringPaths.length = 0
  probe.fdInos.length = 0
})

/** 最小 fixture 仓库（非 git 目录 → listFiles 走目录遍历分支）。 */
const BASE = {
  'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { verify: 'node scripts/verify.mjs' } }),
  'README.md': '# Fixture\n',
  'docs/guide.md': '# 指南\n\n## 安装\n',
  'scripts/verify.mjs': '// verify\n',
}

function makeRepo(extra = {}) {
  const { name: root } = dirSync({ unsafeCleanup: true, prefix: 'check-links-limits-' })
  tmpRoots.push(root)
  for (const [rel, content] of Object.entries({ ...BASE, ...extra })) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

function check(root) {
  return runCheck({ root, home: join(root, 'home') })
}

const HUGE_REASON = '超大文件（构建/压缩产物，非文档）'

/** 该路径的文件有没有被 readFileSync 读进去过（路径或 fd 任一形态都算）。 */
function wasRead(abs) {
  return probe.stringPaths.includes(abs) || probe.fdInos.includes(statSync(abs).ino)
}

describe('#327 字节上限：超大文件在读之前被跳过', () => {
  it('1.2MB 单行产物的路径从未进入 readFileSync', () => {
    const root = makeRepo({ 'docs/huge.js': `// ${'x'.repeat(1_200_000)}\n` })
    const result = check(root)

    expect(wasRead(join(root, 'docs/huge.js'))).toBe(false)
    expect([...result.skipped.keys()]).toContain(HUGE_REASON)
    expect([...result.unreadable.keys()]).toEqual([])
  })

  it('上限按字节判定：350k 汉字（1.05MB 字节，350k 码元）超限且不被读入', () => {
    const cn = '中'.repeat(350_000)
    expect(Buffer.byteLength(cn, 'utf8')).toBe(1_050_000)
    expect(cn.length).toBe(350_000)

    const root = makeRepo({ 'docs/cn.md': `# 标题\n\n${cn}\n` })
    const result = check(root)

    expect(wasRead(join(root, 'docs/cn.md'))).toBe(false)
    expect([...result.skipped.keys()]).toContain(HUGE_REASON)
  })

  it('普通大小的中文文档仍被读入（防"一律跳过"的假绿）', () => {
    const body = `# 标题\n\n${'中'.repeat(1000)}\n`
    const root = makeRepo({ 'docs/cn-small.md': body })
    check(root)

    expect(wasRead(join(root, 'docs/cn-small.md'))).toBe(true)
  })

  it('普通文档与 package.json 仍被读入（门禁能力不因修复而削弱）', () => {
    const root = makeRepo()
    const result = check(root)

    expect(wasRead(join(root, 'docs/guide.md'))).toBe(true)
    expect(wasRead(join(root, 'package.json'))).toBe(true)
    expect(result.findings).toEqual([])
  })
})

describe('#327 读取失败按 errno 分类', () => {
  it('断链符号链接归入「文件不存在」而不是静默 continue', () => {
    const root = makeRepo()
    symlinkSync(join(root, 'docs/deleted.md'), join(root, 'docs/dangling.md'))

    const result = check(root)
    expect([...result.unreadable.keys()]).toContain('文件不存在')
    expect([...result.skipped.keys()]).not.toContain('文件不存在')
  })

  it.skipIf(process.platform === 'win32')('指向字符设备的链接归入「非普通文件」，且不读它', () => {
    const root = makeRepo()
    symlinkSync('/dev/null', join(root, 'docs/devnull.md'))

    const result = check(root)
    expect([...result.unreadable.keys()]).toContain('非普通文件')
  })

  it.skipIf(process.getuid?.() === 0)('不可读文件归入「权限不足」而不是静默 continue', () => {
    const root = makeRepo({ 'docs/locked.md': '# 锁住\n' })
    chmodSync(join(root, 'docs/locked.md'), 0o000)

    const result = check(root)
    expect([...result.unreadable.keys()]).toContain('权限不足')
  })

  it('readFailureReason 的 errno → 文案映射', () => {
    const err = (code) => Object.assign(new Error(code), { code })
    expect(readFailureReason(err('EISDIR'))).toBe('非普通文件')
    expect(readFailureReason(err('ENOTDIR'))).toBe('非普通文件')
    expect(readFailureReason(err('EACCES'))).toBe('权限不足')
    expect(readFailureReason(err('EPERM'))).toBe('权限不足')
    expect(readFailureReason(err('ENOENT'))).toBe('文件不存在')
    expect(readFailureReason(err('EIO'))).toBe('读取失败')
    expect(readFailureReason(new Error('no code'))).toBe('读取失败')
    expect(readFailureReason(null)).toBe('读取失败')
  })
})
