/**
 * Build: compile server TS (src/*.ts → lib/*.js), compile client TS parts
 * (src/client/parts/*.ts → lib/.client-build/parts/*.js), then splice the
 * compiled parts into the lib/client.src.js template and write lib/client.js
 * — the file DSH actually serves at /plugins/dsh-md-render/client.js.
 *
 *   node scripts/build.mjs
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

/** 占位符 → 片段文件（数组顺序即拼接后的声明顺序）。
 *  opts.shared: true 表示从 dsh-shared 的 client-parts 目录读取（不经过 TS 编译）。 */
const PARTS = [
  ['/*__PART_ICONS__*/', 'icons.part.js', { shared: true }],
  ['/*__PART_CONFIG__*/', 'config.js'],
  ['/*__PART_COPY__*/', 'copy.js'],
  ['/*__PART_HIGHLIGHT__*/', 'highlight.js'],
  ['/*__PART_CODEBLOCK__*/', 'codeblock.js'],
  ['/*__PART_MATH_SYMBOLS__*/', 'math-symbols.js'],
  ['/*__PART_MATH__*/', 'math.js'],
  ['/*__PART_MATH_RENDER__*/', 'math-render.js'],
  ['/*__PART_SYNTAX__*/', 'syntax.js'],
  ['/*__PART_MARKDOWN__*/', 'markdown.js'],
  ['/*__PART_DETECT__*/', 'detect.js'],
  ['/*__PART_INLINE__*/', 'inline.js'],
  ['/*__PART_RENDER__*/', 'render.js'],
  ['/*__PART_CONTEXT_MARKDOWN__*/', 'context-markdown.js'],
  ['/*__PART_DOM_MARKDOWN__*/', 'dom-markdown.js'],
  ['/*__PART_TRAJECTORY_MARKDOWN__*/', 'trajectory-markdown.js'],
  ['/*__PART_SCANNER__*/', 'scanner.js'],
  ['/*__PART_STYLES__*/', 'styles.js'],
  ['/*__PART_SETTINGS__*/', 'settings.js'],
  ['/*__PART_APPLY__*/', 'apply.js'],
]

// 1. Compile client TS → lib/.client-build/parts/*.js
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

// 2. Splice compiled parts into template
let out = readFileSync(join(root, 'lib/client.src.js'), 'utf8')
for (const [placeholder, file, opts = {}] of PARTS) {
  if (!out.includes(placeholder)) {
    throw new Error(`client.src.js is missing the ${placeholder} placeholder`)
  }
  const dir = opts.shared ? sharedPartsDir : partsDir
  const part = readFileSync(join(dir, file), 'utf8')
  // 函数式替换：替换串中的 $& / $1 不会被 replaceAll 特殊解释。
  out = out.replaceAll(placeholder, () => part)
}
const unresolved = PARTS.map(([placeholder]) => placeholder).filter((p) => out.includes(p))
if (unresolved.length > 0) {
  throw new Error(`client.src.js has unresolved placeholders: ${unresolved.join(', ')}`)
}
writeFileSync(join(root, 'lib/client.js'), out)

// 3. Clean up temporary build directory
rmSync(BUILD_DIR, { recursive: true, force: true })
console.log(`built lib/client.js (${out.length} bytes, ${out.split('\n').length} lines)`)
