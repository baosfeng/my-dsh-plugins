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

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'lib/.client-build')
const partsDir = join(buildDir, 'parts')
// Shared client parts live in the dsh-shared package (issue #54 阶段 0):
// single source of truth for the icon set, spliced by every plugin's build.
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')

// 1. Compile client TS → lib/.client-build/parts/*.js
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

const src = readFileSync(join(root, 'lib/client.src.js'), 'utf8')

/** (placeholder, part file, opts?) in splice order — const initializers
 *  depend on it. opts.shared: true reads the part from the dsh-shared
 *  client-parts directory instead of the compiled lib/.client-build/parts. */
const pieces = [
  ['__PART_I18N__', 'i18n.js'],
  ['__PART_ICONS__', 'icons.part.js', { shared: true }],
  ['__PART_STYLES__', 'styles.js'],
  ['__PART_API__', 'api.js'],
  ['__PART_VIEW__', 'view.js'],
  ['__PART_DETAIL__', 'detail.js'],
  ['__PART_APPLY__', 'apply.js'],
]

// 2. Splice the compiled parts into the template
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

// 3. Clean up the temporary build directory
rmSync(buildDir, { recursive: true, force: true })

const lines = out.split('\n').length
console.log(`built lib/client.js (${out.length} bytes, ${lines} lines)`)
