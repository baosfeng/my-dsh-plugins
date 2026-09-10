/**
 * Build: compile the server TS (src/*.ts → lib/*.js), compile the client TS
 * parts (src/client/parts/*.ts → lib/.client-build/parts/*.js), then splice
 * those pieces into the PART placeholders of lib/client.src.js and write
 * lib/client.js — the single __ModuleLoader__ bundle DSH actually serves.
 *
 *   node scripts/build.mjs
 *
 * Why splicing: the DSH browser ModuleLoader does not support relative-path
 * require inside a factory (`require('./x.js')` misses the module table), so
 * the client half must ship as ONE bundle; the parts are plain
 * function/variable declaration texts sharing the factory scope (no
 * import/export).
 *
 * lib/client.js is a build artifact and MUST be committed (CI runs
 * node --check + tests against it; it does not run this build). lib/client.src.js
 * is the hand-written template and stays in the tree.
 *
 * NOTE: replaceAll uses a FUNCTION replacer — a string replacer would
 * interpret $& / $1 special patterns inside the fragment source.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'lib/.client-build')
const buildPartsDir = join(buildDir, 'parts')

/** (placeholder, part basename) in splice order — the const initializers
 *  (strings / STYLES / SETTINGS_SECTIONS) are consumed by later parts, so a
 *  shuffle here would break the bundle at runtime. */
const pieces = [
  ['__PART_I18N__', 'i18n'],
  ['__PART_API__', 'api'],
  ['__PART_STYLES__', 'styles'],
  ['__PART_ROWS__', 'rows'],
  ['__PART_VIEW__', 'view'],
  ['__PART_SETTINGS__', 'settings'],
  ['__PART_APPLY__', 'apply'],
]

// 1. Compile the server half (src/*.ts → lib/*.js)
execSync('npx tsc -p tsconfig.json', { cwd: root, stdio: 'inherit' })

// 2. Compile the client parts (src/client/parts/*.ts → lib/.client-build/parts/*.js)
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

// 3. Splice the compiled parts into the template
const src = readFileSync(join(root, 'lib/client.src.js'), 'utf8')
let out = src
for (const [placeholder, name] of pieces) {
  if (!out.includes(placeholder)) {
    throw new Error(`client.src.js is missing the ${placeholder} placeholder`)
  }
  const part = readFileSync(join(buildPartsDir, `${name}.js`), 'utf8')
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
