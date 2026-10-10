/**
 * 路由**单一真源**门禁（issue #463 收尾）。
 *
 * 合并后 host 半与 client 半各有两条路由：`/md-render/api/config`（配置读写）与
 * `/md-render/assets/<engine>`（mermaid 引擎静态资源）。client 半是 `__ModuleLoader__`
 * 片段、**不能 import host 代码**，所以两侧曾经各写一份字面量——只要有人改一侧就会
 * 静默错配（配置页 404 / 引擎加载失败，都不报错）。
 *
 * 现在路径只有一个真源 `src/routes/paths.ts`：
 *   · host 半 `src/routes/config.ts` / `src/routes/assets.ts` 直接 import 常量；
 *   · client 半由 `scripts/build.mjs` 在构建期把**同一批常量**注入产物作用域。
 *
 * 本文件不靠「两侧字面量恰好相等」下结论，而是钉住三条：
 *   ① 两侧都**真源派生**：host 导出 === paths.ts 导出；client 作用域常量 === 同一导出；
 *   ② 路径字面量在 src/ 下**唯一**：除 paths.ts 外不得再写一份；
 *   ③ host **实际注册**的两条前缀 === 真源常量（走真实 apply，不看源码文本）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../lib/index.js'
import {
  ASSETS_PREFIX,
  CONFIG_API_PREFIX,
  CONFIG_API_URL,
  MERMAID_ENGINE_FILE,
  MERMAID_ENGINE_URL,
} from '../lib/routes/paths.js'
import { CONFIG_API_PREFIX as ROUTE_CONFIG_PREFIX } from '../lib/routes/config.js'
import { ASSETS_PREFIX as ROUTE_ASSETS_PREFIX } from '../lib/routes/assets.js'
import { createPage, createReactStub, installGlobals, loadBundle } from './support/fake-dom.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 递归列出 src/ 下的 .ts 文件（源码，注释里出现路径是允许的）。 */
function srcTsFiles(dir = join(ROOT, 'src')) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...srcTsFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

test('host 半两条路由前缀都直接取自 paths.ts（真源派生）', () => {
  assert.equal(ROUTE_CONFIG_PREFIX, CONFIG_API_PREFIX, 'config 路由前缀 === 真源')
  assert.equal(ROUTE_ASSETS_PREFIX, ASSETS_PREFIX, 'assets 路由前缀 === 真源')
  assert.equal(CONFIG_API_URL, CONFIG_API_PREFIX + '/config', 'config URL 由前缀派生')
  assert.equal(MERMAID_ENGINE_URL, ASSETS_PREFIX + '/' + MERMAID_ENGINE_FILE, '引擎 URL 由前缀 + 文件名派生')
})

test('apply 注册的两条前缀 === 真源常量（真实注册，不看源码文本）', () => {
  const routes = []
  const ctx = {
    logger: { info() {}, warn() {} },
    get() {
      return undefined
    },
    effect(fn) {
      const d = fn()
      return typeof d === 'function' ? d : () => {}
    },
    webServer: {
      register(r) {
        routes.push(r)
        return () => {}
      },
    },
    systemPrompt: { section: () => () => {} },
  }
  apply(ctx, {})
  assert.deepEqual(routes.map((r) => r.path).sort(), [CONFIG_API_PREFIX, ASSETS_PREFIX].sort(), '注册前缀来自真源')
  assert.deepEqual(
    routes.map((r) => r.kind),
    ['prefix', 'prefix'],
    '两条都是前缀路由',
  )
})

test('client 作用域里的两个 URL 常量 === 真源（构建期注入，非客户端自写）', () => {
  const page = installGlobals(createPage())
  const react = createReactStub()
  const loaded = loadBundle({ page, react })
  assert.equal(loaded.exports.CONFIG_API_URL, CONFIG_API_URL, 'client config URL 来自真源')
  assert.equal(loaded.exports.MERMAID_ENGINE_URL, MERMAID_ENGINE_URL, 'client 引擎 URL 来自真源')
})

test('路径**声明**在 src/ 下唯一（只有 routes/paths.ts 可以写常量值）', () => {
  // 判据是「谁**声明**了这个字面量」，不是「谁提到过它」——注释里出现路径是说明文字，
  // 而 host 半 import 后 re-export 同一常量是正常用法（本测试另有断言钉住这条链路）。
  const declarations = []
  for (const file of srcTsFiles()) {
    const text = readFileSync(file, 'utf8')
    for (const literal of [CONFIG_API_PREFIX, ASSETS_PREFIX]) {
      // CodeQL js/incomplete-sanitization：只转义 `/` 与 `-` 会漏掉输入里的**反斜杠**，
      // 反斜杠必须先转义（否则 `\` + 被转义字符会被拼成别的转义序列，正则语义被改）。
      // 本用例的 literal 是仓库常量（不含反斜杠），行为不变；这里只补正确性。
      const re = new RegExp('(?:const|let|var)\\s+\\w+\\s*=\\s*[\'""`]' + literal.replace(/[\\/-]/g, '\\$&'))
      if (re.test(text)) declarations.push(file.replace(ROOT + '/', ''))
    }
  }
  assert.deepEqual([...new Set(declarations)], ['src/routes/paths.ts'], '前缀字面量只能由 paths.ts 声明')
})

test('host 两个路由文件通过 import 复用真源（不是各写一份字面量）', () => {
  const configSrc = readFileSync(join(ROOT, 'src', 'routes', 'config.ts'), 'utf8')
  const assetsSrc = readFileSync(join(ROOT, 'src', 'routes', 'assets.ts'), 'utf8')
  assert.ok(
    /import\s*\{[^}]*CONFIG_API_PREFIX[^}]*\}\s*from\s*'\.\/paths\.js'/.test(configSrc),
    'config 路由从 paths.js import 前缀',
  )
  assert.ok(
    /import\s*\{[^}]*ASSETS_PREFIX[^}]*\}\s*from\s*'\.\/paths\.js'/.test(assetsSrc),
    'assets 路由从 paths.js import 前缀',
  )
})

test('构建脚本把真源常量注入产物（改真源 → 产物随之改变）', () => {
  const build = readFileSync(join(ROOT, 'scripts', 'build.mjs'), 'utf8')
  assert.ok(build.includes('clientRouteDeclarations()'), '构建期调用真源的派生函数')
  assert.ok(build.includes("'/*__ROUTE_PATHS__*/'"), '注入到模板的专用占位符')
  const template = readFileSync(join(ROOT, 'lib', 'client.src.js'), 'utf8')
  assert.equal((template.match(/\/\*__ROUTE_PATHS__\*\//g) ?? []).length, 1, '模板里恰好一个注入点')
})
