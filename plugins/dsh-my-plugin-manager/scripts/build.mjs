/**
 * Build: compile the client TS parts (src/client/parts/*.ts →
 * lib/.client-build/parts/*.js), then splice those compiled pieces into the
 * __PART_*__ placeholders of lib/client.src.js and write lib/client.js — the
 * single __ModuleLoader__ bundle DSH actually serves.
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
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isPlaceholderOutsideComments, spliceExactlyOnce } from '../../dsh-shared/scripts/splice.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'lib/.client-build')
const partsDir = join(buildDir, 'parts')
// Shared client parts live in the dsh-shared package (issue #54 阶段 0):
// single source of truth for the icon set + markdown render fallback, spliced
// by every plugin's build.
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')

// 1. Compile client TS → lib/.client-build/parts/*.js
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

const src = readFileSync(join(root, 'lib/client.src.js'), 'utf8')

/** (placeholder, part file, opts?) in splice order — const initializers
 *  depend on it. opts.shared: true reads the part from the dsh-shared
 *  client-parts directory instead of the compiled lib/.client-build/parts.
 *  opts.anchor: 注入后必须**恰好出现一次**的锚点声明（共享部件「注入真的生效」
 *  这条防线，issue #185/#186）。 */
const pieces = [
  ['__PART_I18N__', 'i18n.js'],
  [
    '__PART_MARKDOWN_FALLBACK__',
    'markdown-fallback.part.js',
    { shared: true, anchor: 'function installMarkdownViewFallback(' },
  ],
  ['__PART_ICONS__', 'icons.part.js', { shared: true, anchor: 'const ICON_STROKE = 1.8' }],
  ['__PART_STYLES__', 'styles.js'],
  ['__PART_API__', 'api.js'],
  ['__PART_VIEW__', 'view.js'],
  ['__PART_DETAIL__', 'detail.js'],
  ['__PART_APPLY__', 'apply.js'],
]

// 2. Splice the compiled parts into the template —— 三道防线（issue #185/#186，
//    与 plugins/dsh-think-zh-expand 的构建一致）：
//    ① 占位符必须**出现在代码位置**（不是注释里，否则注入内容整段落进注释）；
//    ② 占位符**恰好一处**（spliceExactlyOnce；≥2 处会把同一份片段注入多次）；
//    ③ 共享部件注入后其锚点声明**恰好一份**（片段真的被声明、且没被注入两次）。
let out = src
for (const [placeholder, file, opts = {}] of pieces) {
  if (!isPlaceholderOutsideComments(src, placeholder)) {
    throw new Error(
      `${placeholder} in client.src.js is inside a comment: injection would \`succeed\` but the part would never be declared`,
    )
  }
  const dir = opts.shared ? sharedPartsDir : partsDir
  out = spliceExactlyOnce(out, placeholder, readFileSync(join(dir, file), 'utf8'), placeholder)
  if (opts.anchor) {
    const decls = out.split(opts.anchor).length - 1
    if (decls !== 1) {
      throw new Error(`lib/client.js must contain exactly 1 "${opts.anchor}" declaration, found ${decls}`)
    }
  }
}

if (out.includes('__PART_')) {
  throw new Error('build left an unresolved __PART_*__ placeholder in client.js')
}

writeFileSync(join(root, 'lib/client.js'), out)

// 3. Clean up the temporary build directory
rmSync(buildDir, { recursive: true, force: true })

const lines = out.split('\n').length
console.log(`built lib/client.js (${out.length} bytes, ${lines} lines)`)
