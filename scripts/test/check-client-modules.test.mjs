/**
 * 客户端 bundle 模块白名单门禁回归测试（scripts/check-client-modules.mjs，issue #321）。
 *
 * 这是"本仓库最痛一类故障"的门禁（#39 / #290 / #293 三次事故同根因：产物 require 了
 * 用户机器上不存在的模块 → 整条 client factory 抛 missed the module table），所以测试
 * 必须把**三类正/反例**钉死，外加两条易被写错的边界：
 *   1. 产物 require 未声明模块 → **必须失败**（含 CLI exit code）；
 *   2. dsh.client.external 声明了 → 通过（`<pkg>` 与 `<pkg>/client` 两种形态）；
 *   3. 平台 seed 模块 → 通过；
 *   4. **注释里的 require 示例不算违规**（实测 my-plugin-manager / think-zh-expand 的产物
 *      注释里就写着 `require('dsh-shared/client-parts/...')` 的反例说明——用正则扫会假红）；
 *   5. 产物解析失败 → 显式失败（fail-closed，绝不静默变绿）。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirSync } from 'tmp'
import { afterAll, describe, expect, it } from 'vitest'
import { auditRepo, collectRequiredSpecs, isAllowedSpec, SEED_MODULES } from '../check-client-modules.mjs'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-client-modules.mjs')

const roots = []
afterAll(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 造一个临时仓库：plugins/<name>/{package.json, lib/client.js}。 */
function makeRepo(plugins) {
  const { name } = dirSync({ unsafeCleanup: true, prefix: 'client-modules-' })
  roots.push(name)
  for (const [plugin, { pkg, bundle }] of Object.entries(plugins)) {
    const dir = join(name, 'plugins', plugin)
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
    writeFileSync(join(dir, 'lib', 'client.js'), bundle)
  }
  return name
}

/** 最小可解析的 client bundle：包一层 factory，内部按需 require。 */
const bundleWith = (requires, extra = '') =>
  `window.__ModuleLoader__.load({\n  id: 'demo',\n  factory: (require) => {\n${requires
    .map((spec) => `    require('${spec}')\n`)
    .join('')}${extra}    return {}\n  },\n})\n`

const runCli = (args) => spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' })

describe('collectRequiredSpecs：只取字面量 require，注释/字符串示例不计', () => {
  it('提取普通与 /client 形态的 spec', () => {
    const specs = collectRequiredSpecs(bundleWith(['react', 'dsh-md-render/client']))
    expect(specs).toEqual(['react', 'dsh-md-render/client'])
  })

  it('注释里的 require 示例不算（实测产物的反例注释）', () => {
    const code = `// 消费方不能改成 \`require('dsh-shared/client-parts/...')\`（发布出去的包里没有它）\n${bundleWith(['react'])}`
    expect(collectRequiredSpecs(code)).toEqual(['react'])
  })

  it('字符串里的 require 文本不算', () => {
    const code = `${bundleWith(['react'])}const doc = "require('ghost-pkg')"\n`
    expect(collectRequiredSpecs(code)).toEqual(['react'])
  })

  it('动态 require（变量）不产生 spec；解析失败显式抛错（fail-closed）', () => {
    expect(collectRequiredSpecs(`${bundleWith([])}const x = require(name)\n`)).toEqual([])
    expect(() => collectRequiredSpecs('factory: (require) => { const = broken')).toThrow(/解析失败/)
  })
})

describe('isAllowedSpec：seed / external / 自身包名', () => {
  const allow = { name: 'dsh-demo', external: ['dsh-md-render'] }

  it('seed 表全部放行', () => {
    for (const seed of SEED_MODULES) expect(isAllowedSpec(seed, allow), seed).toBe(true)
  })

  it('external 的 <pkg> 与 <pkg>/client 都放行', () => {
    expect(isAllowedSpec('dsh-md-render', allow)).toBe(true)
    expect(isAllowedSpec('dsh-md-render/client', allow)).toBe(true)
  })

  it('自身包名放行；未声明的第三方不放行', () => {
    expect(isAllowedSpec('dsh-demo', allow)).toBe(true)
    expect(isAllowedSpec('dsh-demo/client', allow)).toBe(true)
    expect(isAllowedSpec('dsh-shared/client-parts/...', allow)).toBe(false)
    expect(isAllowedSpec('lodash', allow)).toBe(false)
  })
})

describe('auditRepo + CLI：三类正/反例端到端', () => {
  it('① 产物 require 未声明模块 → 违规（CLI exit 1 + 输出原因与修法）', () => {
    const root = makeRepo({
      demo: { pkg: { name: 'dsh-demo' }, bundle: bundleWith(['react', 'ghost-pkg']) },
    })
    const results = auditRepo(root)
    expect(results).toHaveLength(1)
    expect(results[0].violations).toEqual(['ghost-pkg'])

    const cli = runCli(['--root', root])
    expect(cli.status).toBe(1)
    expect(cli.stdout).toContain('ghost-pkg')
    expect(cli.stdout).toContain('miss the module table')
    expect(cli.stdout).toContain('修法')
  })

  it('② dsh.client.external 声明 → 通过（exit 0）', () => {
    const root = makeRepo({
      demo: {
        pkg: { name: 'dsh-demo', dsh: { client: { external: ['dsh-md-render'] } } },
        bundle: bundleWith(['react', 'dsh-md-render/client']),
      },
    })
    expect(auditRepo(root)[0].violations).toEqual([])
    expect(runCli(['--root', root]).status).toBe(0)
  })

  it('③ seed 模块 → 通过（exit 0）', () => {
    const root = makeRepo({
      demo: { pkg: { name: 'dsh-demo' }, bundle: bundleWith(['react', 'react-dom/client']) },
    })
    expect(runCli(['--root', root]).status).toBe(0)
  })

  it('④ 注释里的 require 示例不产生违规（否则真实产物假红）', () => {
    const root = makeRepo({
      demo: {
        pkg: { name: 'dsh-demo' },
        bundle: bundleWith(['react'], `    // 不能写成 require('dsh-shared/client-parts/...')\n`),
      },
    })
    expect(auditRepo(root)[0].violations).toEqual([])
  })

  it('⑤ 产物解析失败 → 显式失败，绝不静默变绿（fail-closed）', () => {
    const root = makeRepo({ demo: { pkg: { name: 'dsh-demo' }, bundle: 'factory: (require) => { const = {\n' } })
    const cli = runCli(['--root', root])
    expect(cli.status).toBe(1)
    expect(cli.stderr).toContain('脚本错误')
  })

  it('--json 输出机器可读结果；无 client 产物的插件被跳过', () => {
    const root = makeRepo({ demo: { pkg: { name: 'dsh-demo' }, bundle: bundleWith(['react']) } })
    mkdirSync(join(root, 'plugins', 'no-client'), { recursive: true })
    writeFileSync(join(root, 'plugins', 'no-client', 'package.json'), JSON.stringify({ name: 'dsh-no-client' }))
    const cli = runCli(['--root', root, '--json'])
    expect(cli.status).toBe(0)
    const parsed = JSON.parse(cli.stdout)
    expect(parsed.ok).toBe(true)
    expect(parsed.scanned).toBe(1)
  })
})

describe('真实仓库产物（回归：当前 main 应 0 违规）', () => {
  it('14 个含 lib/client.js 的插件全部通过', () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const results = auditRepo(repoRoot)
    expect(results.length).toBeGreaterThanOrEqual(10)
    const offenders = results.filter((r) => r.violations.length > 0)
    expect(offenders.map((o) => `${o.plugin}: ${o.violations.join(',')}`)).toEqual([])
  })
})
