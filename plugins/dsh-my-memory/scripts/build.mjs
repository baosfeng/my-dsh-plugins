/**
 * Build: compile server TypeScript (src/*.ts → lib/*.js), compile client
 * parts TypeScript (src/client/parts/*.ts → lib/.client-build/parts/*.js),
 * then splice the compiled parts into the lib/client.src.js template and
 * write lib/client.js — the single __ModuleLoader__ bundle DSH serves.
 *
 *   node scripts/build.mjs
 *
 * Why splicing: the DSH browser ModuleLoader does not support relative-path
 * require inside a factory (`require('./x.js')` misses the module table), so
 * the client half must ship as ONE bundle; the parts are plain function
 * declaration texts sharing the factory scope (no import/export).
 *
 * lib/client.js is the build artifact and MUST be committed (CI runs
 * node --check + tests against it; it does not run this build).
 *
 * NOTE: replaceAll uses a FUNCTION replacer — a string replacer would
 * interpret $& / $1 special patterns inside the fragment source.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = join(root, 'lib/.client-build')
const partsDir = join(BUILD_DIR, 'parts')
// 共享 client parts 位于 dsh-shared 包（issue #54 阶段 0）：图标集单一来源，
// 各插件构建时按文件系统路径拼接（不经过 package exports / require 解析）。
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')

/** 占位符 → 片段文件（数组顺序即拼接后的声明顺序，const 初始化依赖它）。
 *  opts.shared: true 表示从 dsh-shared 的 client-parts 目录读取（不经过 TS 编译）。 */
const pieces = [
  ['__PART_I18N__', 'i18n.js'],
  ['__PART_STYLES__', 'styles.js'],
  ['__PART_API__', 'api.js'],
  ['__PART_ICONS__', 'icons.part.js', { shared: true }],
  ['__PART_UTILS__', 'utils.js'],
  ['__PART_CONFIRM_UI__', 'confirm-ui.js'],
  ['__PART_VIEW_ROWS__', 'view-rows.js'],
  ['__PART_CANDIDATES__', 'candidates.js'],
  ['__PART_VIEW__', 'view.js'],
  ['__PART_APPLY__', 'apply.js'],
]

// 1. Compile server TypeScript (src/*.ts → lib/*.js)
console.log('Compiling server TypeScript...')
execSync('npx tsc -p tsconfig.json', { cwd: root, stdio: 'inherit' })

// 2. Compile client parts TypeScript (src/client/parts/*.ts → lib/.client-build/parts/*.js)
console.log('Compiling client parts TypeScript...')
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

// 3. Splice compiled parts into the client.src.js template
console.log('Splicing client parts...')
let out = readFileSync(join(root, 'lib/client.src.js'), 'utf8')
for (const [placeholder, file, opts = {}] of pieces) {
  if (!out.includes(placeholder)) {
    throw new Error(`client.src.js is missing the ${placeholder} placeholder`)
  }
  const dir = opts.shared ? sharedPartsDir : partsDir
  const part = readFileSync(join(dir, file), 'utf8')
  // 函数式替换：替换串中的 $& / $1 不会被 replaceAll 特殊解释。
  out = out.replaceAll(placeholder, () => part)
}

const unresolved = pieces.map(([placeholder]) => placeholder).filter((p) => out.includes(p))
if (unresolved.length > 0) {
  throw new Error(`client.src.js has unresolved placeholders: ${unresolved.join(', ')}`)
}

writeFileSync(join(root, 'lib/client.js'), out)
const lines = out.split('\n').length
console.log(`built lib/client.js (${out.length} bytes, ${lines} lines)`)

// 4. Clean up temporary build directory
rmSync(BUILD_DIR, { recursive: true, force: true })
console.log('Build completed successfully!')
