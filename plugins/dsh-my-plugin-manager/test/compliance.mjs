/**
 * 合规与防复发门禁（issue #439）——dsh-my-plugin-manager
 *
 * 三条断言，对应本轮修掉的三处违规：
 *  1. package.json 不含官方禁止 / 非官方的 client 字段：`dsh.client.external` 是官方禁止的
 *     跨特性插件取值机制（packages/client/AGENTS.md:37），`dsh.client.externalDegraded` 是
 *     本仓自造、宿主不认的字段（宿主只读 platform/inject/external/immediately）；
 *  2. `dsh.client.inject` 里声明的包名必须在官方存在（本轮删掉的
 *     `@deepseek-ai/dsh-client-runtime` 就是一处全仓/宿主零出现的幽灵包名）；
 *  3. client 源码不出现跨插件 require：产物里除 `react` 与官方 `@deepseek-ai/*`
 *     baseline 模块外，不得请求任何包（尤其是另一个特性插件）。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(ROOT, '..', '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** 收集「官方 client 包名」集合：宿主参考源 packages/client/* + 已安装的 @deepseek-ai/*。 */
function officialClientPackages() {
  const names = new Set()
  const ref = process.env.DSH_HARNESS_REF ?? '/Users/bsfeng/IdeaProjects/deepseek-harness'
  const clientDir = join(ref, 'packages', 'client')
  if (existsSync(clientDir)) {
    for (const entry of readdirSync(clientDir)) {
      const manifest = join(clientDir, entry, 'package.json')
      if (!existsSync(manifest)) continue
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
      if (typeof parsed.name === 'string') names.add(parsed.name)
    }
  }
  const installed = join(REPO, 'node_modules', '@deepseek-ai')
  if (existsSync(installed)) {
    for (const entry of readdirSync(installed)) names.add(`@deepseek-ai/${entry}`)
  }
  return names
}

/** 剥离块注释与行注释：注释里出现的 require(...) 只是说明文字，不是真实请求。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 从源码文本里提取所有 `require('X')` / `require("X")` 字面量（忽略注释）。 */
function requireSpecifiers(source) {
  const specs = []
  const pattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g
  const stripped = stripComments(source)
  let match = pattern.exec(stripped)
  while (match !== null) {
    specs.push(match[1])
    match = pattern.exec(stripped)
  }
  return specs
}

describe('package.json：官方字段合规（#439）', () => {
  it('不含 dsh.client.external（官方禁止特性插件跨插件取值）', () => {
    expect(pkg.dsh?.client?.external).toBeUndefined()
  })

  it('不含 dsh.client.externalDegraded（非官方字段，宿主不读）', () => {
    expect(pkg.dsh?.client?.externalDegraded).toBeUndefined()
    expect(JSON.stringify(pkg)).not.toContain('externalDegraded')
  })

  it('dsh.client 只保留官方字段 platform', () => {
    expect(pkg.dsh?.client).toEqual({ platform: 'web' })
  })

  it('不再把 dsh-md-render 声明为依赖（渲染走官方 baseline 组件）', () => {
    expect(pkg.peerDependencies?.['dsh-md-render']).toBeUndefined()
    expect(pkg.dependencies?.['dsh-md-render']).toBeUndefined()
  })
})

describe('dsh.client.inject 的包名必须在官方存在（#439）', () => {
  const inject = pkg.dsh?.client?.inject ?? []

  it('不声明幽灵包名 @deepseek-ai/dsh-client-runtime', () => {
    expect(inject).not.toContain('@deepseek-ai/dsh-client-runtime')
  })

  it('每个声明的包名都能在官方 client 包集合里找到（fail-closed）', () => {
    if (inject.length === 0) {
      expect(inject).toEqual([])
      return
    }
    const official = officialClientPackages()
    expect(official.size).toBeGreaterThan(0, { message: '无法判定官方包集合时不允许声明 inject' })
    for (const name of inject) expect(official.has(name)).toBe(true)
  })
})

describe('client 源码不出现跨插件 require（#439）', () => {
  const sources = [
    ['lib/client.src.js', read('lib/client.src.js')],
    ['lib/client.js', read('lib/client.js')],
    ...readdirSync(join(ROOT, 'src', 'client', 'parts'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => [`src/client/parts/${f}`, read(`src/client/parts/${f}`)]),
    ['src/client/globals.d.ts', read('src/client/globals.d.ts')],
  ]

  /** 允许的模块请求：宿主基线 react 与官方 @deepseek-ai/* 平台模块。 */
  const allowed = (spec) => spec === 'react' || spec.startsWith('@deepseek-ai/')

  for (const [label, source] of sources) {
    it(`${label}: 只请求基线 / 官方平台模块`, () => {
      const specs = requireSpecifiers(source).filter((spec) => !allowed(spec))
      expect(specs).toEqual([])
    })
  }

  it('产物里的 require 字面量只剩宿主基线 react', () => {
    const specs = requireSpecifiers(read('lib/client.js'))
    expect(specs).toEqual(['react'])
    expect(specs.filter((spec) => /^dsh-/u.test(spec))).toEqual([])
    expect(read('lib/client.js')).not.toContain("require('dsh-md-render')")
  })

  it('平台渲染内核通过变量请求（字面量声明在模板里，且是官方包名）', () => {
    const artifact = read('lib/client.js')
    expect(artifact).toContain("const PLATFORM_PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives'")
    // 共享件内部用 options.require 的别名 req（不自行 require），平台级走 req(platformModule)
    expect(artifact).toContain('req(platformModule)')
  })
})
