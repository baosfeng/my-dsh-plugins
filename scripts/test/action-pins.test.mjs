/**
 * action-pins 门禁回归测试（scripts/lib/action-pins.mjs + scripts/check-action-pins.mjs，issue #435）。
 *
 * 为什么这条门禁必须有测试：它的失败模式是**静默通过**——解析器一旦写错（把注释行也算进去、
 * 把 ` # v4` 当 ref 的一部分、少读一个子路径），门禁看起来在跑、实际什么都没查，
 * 于是「Dependabot 单侧 bump → CodeQL 恒红 → 所有 PR 被假红挡住」会原样复发。
 * 因此每个维度都要有**故意违规**的反例断言它真的报出来：
 *   ① 解析：子路径 / root / 引号 / 行尾版本注释 / 注释行（示例 action）一律不能被误算；
 *   ② 判定：同仓多子路径一致 → 不报；单侧 bump → 必报；不同 Action 各自版本不同 → 不报；
 *   ③ CLI 端到端：真实仓库 exit 0；分叉 fixture exit 1；零 workflow / 零 uses / 目录不存在 fail-closed。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import {
  extractActionUses,
  findPinMismatches,
  parseActionRef,
  renderMismatches,
  stripYamlComment,
} from '../lib/action-pins.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const temps = []

/** 建一个只含 .github/workflows/ 的临时仓库根（用完统一删，避免 tmp 残留）。 */
function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'action-pins-'))
  temps.push(dir)
  const wf = join(dir, '.github', 'workflows')
  mkdirSync(wf, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(wf, name), content)
  return dir
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

const runCli = (...args) =>
  spawnSync(process.execPath, ['scripts/check-action-pins.mjs', ...args], { cwd: root, encoding: 'utf8' })

const SHA_A = 'b96794f015dfd88f77b49b1c93e0fa7110f94c63'
const SHA_B = '1c5b675653bb5c22dbe9b12b556ec555138e09fd'

describe('解析：uses 行的取值（lib/action-pins.mjs）', () => {
  it('剥注释：整行注释归零，行内注释截断，无注释原样', () => {
    expect(stripYamlComment('      #   uses: actions/setup-example@v1')).toBe('')
    expect(stripYamlComment('        uses: github/codeql-action/init@abc # v4')).toBe(
      '        uses: github/codeql-action/init@abc',
    )
    expect(stripYamlComment('        uses: actions/checkout@abc')).toBe('        uses: actions/checkout@abc')
  })

  it('子路径与无子路径都被正确拆开', () => {
    expect(parseActionRef('github/codeql-action/init@' + SHA_A)).toEqual({
      action: 'github/codeql-action',
      subpath: 'init',
      ref: SHA_A,
    })
    expect(parseActionRef('actions/checkout@abc123')).toEqual({
      action: 'actions/checkout',
      subpath: '',
      ref: 'abc123',
    })
    expect(parseActionRef('"owner/repo/sub@v1"')).toEqual({ action: 'owner/repo', subpath: 'sub', ref: 'v1' })
  })

  it('非远程 action 与非法形态一律不参与判定', () => {
    for (const bad of [
      './local-action',
      '../up/dir',
      '/abs/path@v1',
      'docker://alpine:3@sha256:abc',
      'owner-only',
      'owner/repo',
      'owner/repo@',
      'a/b/../c@v1',
    ]) {
      expect(parseActionRef(bad), bad).toBeNull()
    }
    expect(parseActionRef(undefined)).toBeNull()
  })

  it('注释里的示例 action 不算条目；行尾版本注释进 version 字段（不污染 ref）', () => {
    const text = [
      '# ******** NOTE ********',
      '      # - name: Setup runtime (example)',
      '      #   uses: actions/setup-example@v1',
      '',
      '      - uses: github/codeql-action/init@' + SHA_B + ' # v4',
      '        with:',
      '          languages: actions',
    ].join('\n')
    const uses = extractActionUses(text, '.github/workflows/x.yml')
    expect(uses).toHaveLength(1)
    expect(uses[0]).toMatchObject({
      file: '.github/workflows/x.yml',
      line: 5,
      action: 'github/codeql-action',
      subpath: 'init',
      ref: SHA_B,
      version: 'v4',
    })
  })

  it('未给文件名时用 (inline) 占位', () => {
    expect(extractActionUses('        uses: a/b@v1')[0].file).toBe('(inline)')
  })
})

describe('判定：同一 Action 的多子路径必须同 ref', () => {
  it('同一 ref 的两个子路径 → 不报（合法形态：单仓库多 action）', () => {
    const uses = extractActionUses(
      '        uses: github/codeql-action/init@' + SHA_B + '\n        uses: github/codeql-action/analyze@' + SHA_B,
      'w.yml',
    )
    expect(findPinMismatches(uses)).toEqual([])
  })

  it('单侧 bump（#430 的原始形态）→ 必报，且带上两个 ref 与子路径', () => {
    const uses = extractActionUses(
      '        uses: github/codeql-action/init@' +
        SHA_A +
        ' # v4\n        uses: github/codeql-action/analyze@' +
        SHA_B +
        ' # v4',
      'w.yml',
    )
    const mismatches = findPinMismatches(uses)
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0].action).toBe('github/codeql-action')
    expect(mismatches[0].subpathCount).toBe(2)
    // refs 按 ref 字典序排序（'1c5b…' < 'b967…'），断言顺序即渲染顺序
    expect(mismatches[0].refs.map((g) => g.ref)).toEqual([SHA_B, SHA_A])
    expect(mismatches[0].files).toEqual(['w.yml'])
    const report = renderMismatches(mismatches)
    expect(report).toContain('github/codeql-action')
    expect(report).toContain(SHA_A)
    expect(report).toContain(SHA_B)
    expect(report).toContain('subpath=init')
    expect(report).toContain('subpath=analyze')
    expect(report).toContain('修法')
  })

  it('不同 Action 各自版本不同 → 不报（版本差异只对**同一** Action 构成分叉）', () => {
    const uses = extractActionUses(
      '        uses: actions/checkout@' + SHA_A + '\n        uses: actions/setup-node@' + SHA_B,
      'w.yml',
    )
    expect(findPinMismatches(uses)).toEqual([])
  })

  it('三处两个 ref（含无子路径的根 action）→ 报出，且 root 子路径渲染为 (root)', () => {
    const uses = extractActionUses(
      ['        uses: o/r@' + SHA_A, '        uses: o/r/sub@' + SHA_B, '        uses: o/r/sub@' + SHA_B].join('\n'),
      'w.yml',
    )
    const mismatches = findPinMismatches(uses)
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0].refs.find((g) => g.ref === SHA_A).subpaths).toEqual([''])
    expect(mismatches[0].files).toEqual(['w.yml'])
    // 无版本注释的分支也要渲染（不能因为 version 为空而丢掉 ref 行）
    expect(renderMismatches(mismatches)).toContain('ref=' + SHA_A + '\n')
  })
})

describe('端到端：真实仓库 + fixture', () => {
  it('真实仓库（codeql.yml 已对齐）→ exit 0，且扫描到了 github/codeql-action', () => {
    const r = runCli('--json')
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.summary.mismatches).toBe(0)
    expect(parsed.summary.scannedFiles).toBeGreaterThanOrEqual(5)
    expect(parsed.summary.uses).toBeGreaterThanOrEqual(20)
    const human = runCli()
    expect(human.status).toBe(0)
    expect(human.stdout).toContain('action-pins')
  })

  it('分叉 fixture → exit 1，且把两个 ref 与两个子路径都点出来（不许只报「有问题」）', () => {
    const repo = makeRepo({
      'codeql.yml': [
        'jobs:',
        '  analyze:',
        '    steps:',
        '      - uses: github/codeql-action/init@' + SHA_A + ' # v4',
        '      - uses: github/codeql-action/analyze@' + SHA_B + ' # v4',
      ].join('\n'),
    })
    const r = runCli('--root', repo)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(SHA_A)
    expect(r.stderr).toContain(SHA_B)
    expect(r.stderr).toContain('init')
    expect(r.stderr).toContain('analyze')
    expect(r.stderr).toContain('#430')
  })

  it('fail-closed：目录不存在 / 零 workflow / 零 uses 一律 exit 1', () => {
    expect(runCli('--root', join(root, 'no-such-dir-435')).status).toBe(1)
    expect(runCli('--root', makeRepo({})).status).toBe(1)
    const noUses = makeRepo({ 'ci.yml': 'jobs:\n  a:\n    steps:\n      - run: echo hi\n' })
    const r = runCli('--root', noUses)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('fail-closed')
  })

  it('用法错误与帮助：--root 缺值 exit 2，--help exit 0', () => {
    expect(runCli('--root').status).toBe(2)
    const help = runCli('--help')
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('check-action-pins.mjs')
  })
})
