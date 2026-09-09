/**
 * Build: compile the client TypeScript source (src/client/index.ts) to a
 * CommonJS bundle with tsc, then splice it into the lib/client.src.js template
 * (at the /*__CLIENT_BUNDLE__* / placeholder) and write lib/client.js — the
 * file DSH actually serves at /plugins/dsh-mermaid-render/client.js.
 *
 *   node scripts/build.mjs
 *
 * lib/client.js is the build artifact and MUST be committed (CI runs
 * node --check + tests against it; it does not run this build).
 *
 * NOTE: replaceAll uses a FUNCTION replacer — a string replacer would
 * interpret $& / $1 special patterns inside the bundle source.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = join(root, 'lib/.client-build')
const PLACEHOLDER = '/*__CLIENT_BUNDLE__*/'

// 1. tsc 编译 client TS → lib/.client-build/index.js（CommonJS 单文件）
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

// 2. 注入模板
const bundle = readFileSync(join(BUILD_DIR, 'index.js'), 'utf8')
let out = readFileSync(join(root, 'lib/client.src.js'), 'utf8')
if (!out.includes(PLACEHOLDER)) {
  throw new Error(`client.src.js is missing the ${PLACEHOLDER} placeholder`)
}
out = out.replaceAll(PLACEHOLDER, () => bundle)
if (out.includes(PLACEHOLDER)) {
  throw new Error('client.src.js has unresolved placeholders')
}

// 3. 注入 vendored mermaid engine (base64)
if (!out.includes('__MERMAID_UMD_B64__')) {
  throw new Error('client.js is missing the __MERMAID_UMD_B64__ placeholder')
}
const umd = readFileSync(join(root, 'vendor/mermaid.min.js'), 'utf8')
if (!umd.includes('window') && !umd.includes('globalThis')) {
  throw new Error('vendor/mermaid.min.js does not look like the UMD build')
}
const b64 = Buffer.from(umd, 'utf8').toString('base64')
out = out.replaceAll('__MERMAID_UMD_B64__', () => JSON.stringify(b64))

if (out.includes('__MERMAID_UMD_B64__')) {
  throw new Error('build left an unresolved __MERMAID_UMD_B64__ placeholder in client.js')
}

writeFileSync(join(root, 'lib/client.js'), out)

// 4. 清理临时编译目录
rmSync(BUILD_DIR, { recursive: true, force: true })
console.log(
  `built lib/client.js (${out.length} bytes, ${out.split('\n').length} lines, mermaid ${umd.length} bytes embedded as base64)`,
)
