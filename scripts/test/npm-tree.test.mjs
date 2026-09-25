// plugin-upgrade skill 的 scripts/lib/npm-tree.mjs 的回归测试。
//
// 这是**审计可信度判据**：npm 模式审计先枚举两棵已发布安装树的 `@deepseek-ai/*` 包，
// 再据此算 packagesA/packagesB/packagesOnlyInB 并生成 manifest-diff.txt。dsh 闭包把子包
// 装在 `@deepseek-ai/dsh/node_modules/@deepseek-ai/` 下（实测 0.1.5-rc.1 的 242 个包里
// 只有 36 个在顶层），只看顶层 scope 目录的实现会把嵌套子包整批漏掉——包计数与
// 「包增删」结论因此系统性偏低、不可引用。
//
// 下面每个 fixture 都复刻真实 npm 布局的一层嵌套形态，并钉住去重取最浅实例的语义。
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// 权威来源（本仓库内 skill 资产）：skills/plugin-upgrade/scripts/lib/npm-tree.mjs
import { deepseekPackages } from '../../skills/plugin-upgrade/scripts/lib/npm-tree.mjs'

const roots = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** 造一棵安装树：paths 是「相对 node_modules 的包目录」→ 包名。 */
function makeTree(entries) {
  const root = mkdtempSync(join(tmpdir(), 'npm-tree-'))
  roots.push(root)
  for (const [relDir, name] of Object.entries(entries)) {
    const dir = join(root, 'node_modules', relDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
  }
  return root
}

/** 深度优先的朴素实现（原 scopedPkgs：只读本层 node_modules/@deepseek-ai，不深入 scope 包）。 */
function topLevelOnly(root) {
  const names = []
  const scope = join(root, 'node_modules', '@deepseek-ai')
  for (const entry of readdirSync(scope, { withFileTypes: true })) {
    if (entry.isDirectory()) names.push(entry.name)
  }
  return names
}

describe('deepseekPackages', () => {
  it('递归枚举嵌套在 @deepseek-ai/dsh/node_modules/@deepseek-ai/ 下的子包（原实现漏计的那批）', () => {
    const root = makeTree({
      '@deepseek-ai/dsh': '@deepseek-ai/dsh',
      '@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-core': '@deepseek-ai/dsh-core',
      '@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-core/node_modules/@deepseek-ai/deep-only':
        '@deepseek-ai/deep-only',
      '@deepseek-ai/dsh-cli': '@deepseek-ai/dsh-cli',
    })
    const found = deepseekPackages(root)
    expect([...found.keys()].sort()).toEqual([
      '@deepseek-ai/deep-only',
      '@deepseek-ai/dsh',
      '@deepseek-ai/dsh-cli',
      '@deepseek-ai/dsh-core',
    ])
    // 顶层只有 2 个；漏计的实现会在这里红。
    expect(topLevelOnly(root)).toHaveLength(2)
    expect(found.size).toBeGreaterThan(topLevelOnly(root).length)
  })

  it('同名包出现在多层时按最浅实例解析，且只计一次', () => {
    const root = makeTree({
      '@deepseek-ai/dsh': '@deepseek-ai/dsh',
      '@deepseek-ai/dsh-core': '@deepseek-ai/dsh-core',
      '@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-core': '@deepseek-ai/dsh-core',
    })
    const found = deepseekPackages(root)
    expect(found.size).toBe(2)
    expect(found.get('@deepseek-ai/dsh-core')).toBe(join(root, 'node_modules', '@deepseek-ai', 'dsh-core'))
  })

  it('非 scope 包下嵌套的 scope 包同样计入（递归不得只沿 scope 目录走）', () => {
    const root = makeTree({
      '@deepseek-ai/dsh': '@deepseek-ai/dsh',
      'some-host/node_modules/@deepseek-ai/nested-vendor': '@deepseek-ai/nested-vendor',
    })
    expect([...deepseekPackages(root).keys()].sort()).toEqual(['@deepseek-ai/dsh', '@deepseek-ai/nested-vendor'])
  })

  it('把包目录的完整名（@scope/name）当键，而不是 scope 下的短目录名', () => {
    const root = makeTree({ '@deepseek-ai/dsh': '@deepseek-ai/dsh' })
    expect([...deepseekPackages(root).keys()]).toEqual(['@deepseek-ai/dsh'])
  })

  it('忽略符号链接（npm link 形态不是已发布闭包的一部分）', () => {
    const root = makeTree({ '@deepseek-ai/dsh': '@deepseek-ai/dsh' })
    symlinkSync(
      join(root, 'node_modules', '@deepseek-ai', 'dsh'),
      join(root, 'node_modules', '@deepseek-ai', 'linked-alias'),
    )
    expect([...deepseekPackages(root).keys()]).toEqual(['@deepseek-ai/dsh'])
  })
})
