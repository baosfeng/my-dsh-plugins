/**
 * Build: compile the client TS parts (src/client/parts/*.ts →
 * lib/.client-build/parts/*.js), publish them as the committed
 * lib/parts/<name>.part.js artifacts, then splice those pieces into the PART
 * placeholders of lib/client.src.js and write lib/client.js — the single
 * __ModuleLoader__ bundle DSH actually serves.
 *
 *   node scripts/build.mjs
 *
 * Why splicing: the DSH browser ModuleLoader does not support relative-path
 * require inside a factory (`require('./x.js')` misses the module table), so
 * the client half must ship as ONE bundle; the parts are plain function
 * declaration texts sharing the factory scope (no import/export).
 *
 * The published lib/parts/*.part.js are formatted with the repo prettier
 * config (they are checked by `prettier --check`; test/tab-active-styles.mjs
 * reads lib/parts/styles.part.js), and the SAME formatted text is spliced into
 * lib/client.js so the bundle stays byte-identical to the hand-written
 * originals modulo tsc's 'use strict' prefix.
 *
 * lib/client.js and lib/parts/*.part.js are build artifacts and MUST be
 * committed (CI runs node --check + tests against them; it does not run this
 * build).
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'lib/.client-build')
const buildPartsDir = join(buildDir, 'parts')
const outPartsDir = join(root, 'lib/parts')
// Shared client parts live in the dsh-shared package (issue #54 阶段 0):
// single source of truth for the icon set, spliced by every plugin's build.
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')

// 1. Compile client TS → lib/.client-build/parts/*.js
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

/** (placeholder, part basename, opts?) in splice order — const initializers
 *  depend on it. opts.shared: true reads `<name>.part.js` from the dsh-shared
 *  client-parts directory instead of this plugin's compiled parts. */
const pieces = [
  ['__PART_I18N__', 'i18n'],
  ['__PART_FORMAT__', 'format'],
  ['__PART_TREE__', 'tree'],
  ['__PART_STORE__', 'store'],
  ['__PART_API__', 'api'],
  ['__PART_INTERCEPTOR__', 'interceptor'],
  ['__PART_AUTO_OPEN__', 'auto-open'],
  ['__PART_ICONS__', 'icons', { shared: true }],
  ['__PART_STYLES__', 'styles'],
  ['__PART_ROWS__', 'rows'],
  ['__PART_VIEW__', 'view'],
  ['__PART_PREVIEW__', 'preview'],
  ['__PART_APPLY__', 'apply'],
]

// 2. Publish the compiled parts as the committed lib/parts/<name>.part.js
for (const [, name, opts = {}] of pieces) {
  if (opts.shared) continue
  writeFileSync(join(outPartsDir, `${name}.part.js`), readFileSync(join(buildPartsDir, `${name}.js`), 'utf8'))
}
execSync('npx prettier --write lib/parts', { cwd: root, stdio: 'inherit' })

// 3. Splice the formatted parts into the template
const src = readFileSync(join(root, 'lib/client.src.js'), 'utf8')
let out = src
for (const [placeholder, name, opts = {}] of pieces) {
  if (!out.includes(placeholder)) {
    throw new Error(`client.src.js is missing the ${placeholder} placeholder`)
  }
  const dir = opts.shared ? sharedPartsDir : outPartsDir
  const part = readFileSync(join(dir, `${name}.part.js`), 'utf8')
  // Function-style replacement: the part text may contain `$&` / `$1` style
  // sequences that a string replacement would interpret specially.
  out = out.replaceAll(placeholder, () => part)
}

if (out.includes('__PART_')) {
  throw new Error('build left an unresolved __PART_*__ placeholder in client.js')
}

writeFileSync(join(root, 'lib/client.js'), out)

// 4. Clean up the temporary build directory
rmSync(buildDir, { recursive: true, force: true })

const lines = out.split('\n').length
console.log(`built lib/client.js (${out.length} bytes, ${lines} lines)`)
