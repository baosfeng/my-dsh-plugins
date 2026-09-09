/**
 * Build: compile TypeScript sources and splice the `lib/parts/*.part.js`
 * pieces into the __PART_*__ placeholders of lib/client.src.js and write
 * lib/client.js — the single __ModuleLoader__ bundle DSH actually serves.
 *
 *   node scripts/build.mjs
 *
 * Build flow:
 * 1. Compile server TypeScript: `npx tsc -p tsconfig.json`
 * 2. Compile client parts TypeScript: `npx tsc -p tsconfig.client.json`
 * 3. Splice compiled parts into client.src.js template
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

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = join(root, 'lib/.client-build')
const partsDir = join(root, 'lib/parts')
// Shared client parts live in the dsh-shared package (issue #54 阶段 0):
// single source of truth for the icon set, spliced by every plugin's build.
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')
const src = readFileSync(join(root, 'lib/client.src.js'), 'utf8')

/** (placeholder, part file, opts?) in splice order — const initializers
 *  depend on it. opts.shared: true reads the part from the dsh-shared
 *  client-parts directory instead of this plugin's lib/parts. */
const pieces = [
  ['__PART_I18N__', 'i18n.part.js'],
  ['__PART_STYLES__', 'styles.part.js'],
  ['__PART_API__', 'api.part.js'],
  ['__PART_ICONS__', 'icons.part.js', { shared: true }],
  ['__PART_UTILS__', 'utils.part.js'],
  ['__PART_VIEW_ROWS__', 'view-rows.part.js'],
  ['__PART_CANDIDATES__', 'candidates.part.js'],
  ['__PART_VIEW__', 'view.part.js'],
  ['__PART_APPLY__', 'apply.part.js'],
]

// 1. Compile server TypeScript
console.log('Compiling server TypeScript...')
execSync('npx tsc -p tsconfig.json', { cwd: root, stdio: 'inherit' })

// 2. Compile client parts TypeScript
console.log('Compiling client parts TypeScript...')
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

// 3. Splice compiled parts into client.src.js template
console.log('Splicing client parts...')
let out = src
for (const [placeholder, file, opts = {}] of pieces) {
  if (!out.includes(placeholder)) {
    throw new Error(`client.src.js is missing the ${placeholder} placeholder`)
  }
  const dir = opts.shared ? sharedPartsDir : partsDir
  const part = readFileSync(join(dir, file), 'utf8')
  // Function-style replacement: the part text may contain `$&` / `$1` style
  // sequences that a string replacement would interpret specially.
  out = out.replaceAll(placeholder, () => part)
}

if (out.includes('__PART_')) {
  throw new Error('build left an unresolved __PART_*__ placeholder in client.js')
}

writeFileSync(join(root, 'lib/client.js'), out)
const lines = out.split('\n').length
console.log(`built lib/client.js (${out.length} bytes, ${lines} lines)`)

// 4. Clean up temporary build directory
rmSync(BUILD_DIR, { recursive: true, force: true })
console.log('Build completed successfully!')