/**
 * Build: compile the client TypeScript parts (src/client/parts/*.ts →
 * lib/.client-build/parts/*.js), publish them as the committed
 * lib/parts/<name>.js artifacts, then splice those pieces into the PART
 * placeholders of lib/client.src.js and write lib/client.js — the single
 * __ModuleLoader__ bundle DSH actually serves.
 *
 *   node scripts/build.mjs
 *
 * The server half (src/*.ts → lib/*.js) is compiled by `npm run build`
 * (`npx tsc -p tsconfig.json && node scripts/build.mjs`).
 *
 * Why splicing: the DSH browser ModuleLoader does not support relative-path
 * require inside a factory (`require('./x.js')` misses the module table), so
 * the client half must ship as ONE bundle; the parts are plain function /
 * variable declaration texts sharing the factory scope (no import/export).
 *
 * lib/parts/*.js are committed artifacts too: the TS migration made
 * src/client/parts/*.ts the single source of truth, and the published pieces
 * are what test/client-contract.mjs reads to prove that the committed
 * lib/client.js equals template + pieces (source and artifact must stay in
 * sync — CI runs node --check + tests, never this build). They are formatted
 * with the repo prettier config (`.prettierignore` re-includes
 * plugins/.../lib/parts/**) and the SAME formatted text is spliced into
 * lib/client.js.
 *
 * NOTE: the placeholder replacement uses a FUNCTION replacer — a string
 * replacer would interpret $& / $1 special patterns inside the piece source.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'lib/.client-build')
const buildPartsDir = join(buildDir, 'parts')
const outPartsDir = join(root, 'lib/parts')
// 共享 client parts 位于 dsh-shared 包（issue #54 阶段 0）：图标集单一来源，
// 各插件构建时按文件系统路径拼接（不经过 package exports / require 解析）。
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')

// 1. 编译 client 端 TS 片段 → lib/.client-build/parts/*.js
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

/** (占位符, 片段文件名, opts?) —— 数组顺序即拼接顺序，const 初始化有依赖：
 *  styles 提供 STYLES（apply 消费），util 提供 strings/api/…（row/view 消费），
 *  row 先于 view（view 渲染 EntryRow），view 先于 apply（apply 注册
 *  GuardianView）。颠倒顺序会在运行时 TDZ（const 提升期未初始化）。
 *  opts.shared: true 从 dsh-shared/client-parts 读取（不经本插件 TS 编译）。 */
const pieces = [
  ['__PART_STYLES__', 'styles'],
  ['__PART_UTIL__', 'util'],
  ['__PART_ICONS__', 'icons.part', { shared: true }],
  ['__PART_ROW__', 'row'],
  ['__PART_VIEW__', 'view'],
  ['__PART_APPLY__', 'apply'],
]

// 2. 发布编译后的片段为提交进仓库的 lib/parts/<name>.js
for (const [, name, opts = {}] of pieces) {
  if (opts.shared) continue
  writeFileSync(join(outPartsDir, `${name}.js`), readFileSync(join(buildPartsDir, `${name}.js`), 'utf8'))
}
execSync('npx prettier --write lib/parts', { cwd: root, stdio: 'inherit' })

// 3. 把片段拼接进 lib/client.src.js 模板
let out = readFileSync(join(root, 'lib/client.src.js'), 'utf8')
for (const [placeholder, name, opts = {}] of pieces) {
  if (!out.includes(placeholder)) {
    throw new Error(`client.src.js is missing the ${placeholder} placeholder`)
  }
  const dir = opts.shared ? sharedPartsDir : outPartsDir
  const part = readFileSync(join(dir, `${name}.js`), 'utf8')
  out = out.replaceAll(placeholder, () => part)
}

// 未解析占位符检查：只查本次拼接的真实占位符（模板注释里出现的 `__PART_*__`
// 说明文字不算未解析）。
const unresolved = pieces.map(([placeholder]) => placeholder).filter((placeholder) => out.includes(placeholder))
if (unresolved.length > 0) {
  throw new Error(`client.src.js has unresolved placeholders: ${unresolved.join(', ')}`)
}

writeFileSync(join(root, 'lib/client.js'), out)

// 4. 清理临时编译目录（.gitignore 已忽略，残留会让 depcruise ENOENT）
rmSync(buildDir, { recursive: true, force: true })

const lines = out.split('\n').length
console.log(`built lib/client.js (${out.length} bytes, ${lines} lines, ${pieces.length} fragments)`)
