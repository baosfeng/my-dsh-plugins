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
 * 两处注入都走 spliceExactlyOnce（scripts/splice.mjs）：占位符必须**恰好一处**，
 * 0 处与 ≥2 处都显式失败。历史教训（issue #185）：模板注释里曾出现与引擎占位符
 * 同形的字面量，replaceAll 把两处都注入同一份 4.45 MB base64 → 产物 8.93 MB、
 * npm 包 13.5 MB；旧门禁只查"无残留"，两处都替换后残留恰好为 0，静默通过。
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spliceExactlyOnce } from './splice.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = join(root, 'lib/.client-build')
/** tsc 产物注入位（模板里的注释形占位符）。 */
const BUNDLE_PLACEHOLDER = '/*__CLIENT_BUNDLE__*/'
/** vendored mermaid 引擎 base64 注入位（src/client/index.ts 的常量声明位）。 */
const ENGINE_PLACEHOLDER = '__MERMAID_UMD_B64__'

// 1. tsc 编译 client TS → lib/.client-build/index.js（CommonJS 单文件）
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

// 2. 注入模板（恰好一处，否则抛错）
const bundle = readFileSync(join(BUILD_DIR, 'index.js'), 'utf8')
let out = readFileSync(join(root, 'lib/client.src.js'), 'utf8')
out = spliceExactlyOnce(out, BUNDLE_PLACEHOLDER, bundle)

// 3. 注入 vendored mermaid engine (base64)：产物内必须只出现一份
const umd = readFileSync(join(root, 'vendor/mermaid.min.js'), 'utf8')
if (!umd.includes('window') && !umd.includes('globalThis')) {
  throw new Error('vendor/mermaid.min.js does not look like the UMD build')
}
const b64 = Buffer.from(umd, 'utf8').toString('base64')
out = spliceExactlyOnce(out, ENGINE_PLACEHOLDER, JSON.stringify(b64))

writeFileSync(join(root, 'lib/client.js'), out)

// 4. 清理临时编译目录
rmSync(BUILD_DIR, { recursive: true, force: true })
// 字节数用 Buffer.byteLength（out.length 是 UTF-16 码元数，含中文注释时与文件字节不符）
console.log(
  `built lib/client.js (${Buffer.byteLength(out)} bytes, ${out.split('\n').length} lines, mermaid ${Buffer.byteLength(umd)} bytes embedded as base64)`,
)
