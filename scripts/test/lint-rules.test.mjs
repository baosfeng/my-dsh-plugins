/**
 * lint 规则回归测试（issue #48：存量插件加强 lint）。
 *
 * 用 ESLint Node API（ESLint 类 + lintText）对真实 eslint.config.js 跑
 * 规则断言，证明：
 *  1. import/no-unresolved 开启：require/import 不存在的模块 → 报错
 *     （拦截 #39 类「require 拼错模块名」低级错误）；
 *  2. server 端 no-undef 开启：未定义变量 → 报错；
 *  3. client 端（__ModuleLoader__ 格式）语义正确：react/react-dom 为
 *     DSH 运行时注入模块（ignore 豁免），dsh-* 跨插件模块映射到仓库内
 *     plugins/<name>/ 真实检查（不存在的 dsh-* 包 → 报错）。
 *
 * filePath 只用于匹配 eslint.config.js 的配置块（lintText 不读磁盘），
 * 因此用仓库内真实路径即可，无需创建 fixture 文件。
 */
import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ignore: false —— lintText 不读磁盘，filePath 只用于匹配配置块；而 TS 全量
// 迁移后 plugins/*/lib/*.js 是 tsc 产物、已被 eslint.config.js 的 tscArtifacts()
// 全局忽略，若保留 ignores 过滤这些路径会被判为"已忽略"而拿不到任何规则。
const eslint = new ESLint({ overrideConfigFile: join(repoRoot, 'eslint.config.js'), ignore: false })

/** 对 code 跑 lint（filePath 决定匹配哪个配置块），返回 ruleId 列表。 */
async function lintRules(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.map((m) => m.ruleId)
}

const serverFile = join(repoRoot, 'plugins/dsh-file-activity/lib/index.js')
const clientFile = join(repoRoot, 'plugins/dsh-think-zh-expand/lib/client.src.js')

describe('import/no-unresolved（issue #48）', () => {
  it('server 端：require 不存在的模块 → 报错', async () => {
    const rules = await lintRules("const x = require('totally-nonexistent-module')", serverFile)
    expect(rules).toContain('import/no-unresolved')
  })

  it('server 端：import 不存在的相对路径 → 报错', async () => {
    const rules = await lintRules("import { a } from './no-such-file.js'", serverFile)
    expect(rules).toContain('import/no-unresolved')
  })

  it('server 端：node: 内置模块与存在的相对路径 → 不报错', async () => {
    const rules = await lintRules(
      "import { join } from 'node:path'\nimport { sessionCwdOf } from './cwd.js'\nexport const ok = join('a', 'b')",
      serverFile,
    )
    expect(rules).not.toContain('import/no-unresolved')
  })

  it('client 端：require 不存在的 dsh-* 包 → 报错', async () => {
    const rules = await lintRules(
      'window.__ModuleLoader__.load({ id: "x", factory: (require) => { const c = require("dsh-nonexistent-plugin"); return {} } })',
      clientFile,
    )
    expect(rules).toContain('import/no-unresolved')
  })

  it('client 端：require 仓库内插件（dsh-md-render）→ 不报错', async () => {
    const rules = await lintRules(
      'window.__ModuleLoader__.load({ id: "x", factory: (require) => { const b = require("dsh-md-render"); return {} } })',
      clientFile,
    )
    expect(rules).not.toContain('import/no-unresolved')
  })

  it('client 端：require react / react-dom（DSH 运行时注入）→ 不报错', async () => {
    const rules = await lintRules(
      'window.__ModuleLoader__.load({ id: "x", factory: (require) => { const a = require("react"); const d = require("react-dom/client"); return {} } })',
      clientFile,
    )
    expect(rules).not.toContain('import/no-unresolved')
  })
})

describe('server 端 no-undef（issue #48）', () => {
  it('未定义变量 → 报错', async () => {
    const rules = await lintRules('export function f() { return undefinedVar + 1 }', serverFile)
    expect(rules).toContain('no-undef')
  })

  it('client 端（__ModuleLoader__ 格式）no-undef 保持关闭', async () => {
    const rules = await lintRules(
      'window.__ModuleLoader__.load({ id: "x", factory: (require) => { const a = undefinedVar; return {} } })',
      clientFile,
    )
    expect(rules).not.toContain('no-undef')
  })
})
