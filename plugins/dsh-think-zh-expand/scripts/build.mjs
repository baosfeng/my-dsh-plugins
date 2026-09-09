/**
 * Build: compile the client TypeScript source (src/client/index.ts) to a
 * CommonJS bundle with tsc, then splice it into the lib/client.src.js template
 * (at the /*__CLIENT_BUNDLE__* / placeholder) and write lib/client.js — the
 * file DSH actually serves at /plugins/dsh-think-zh-expand/client.js.
 *
 * Also splice shared icons from dsh-shared (icons.part.js) into the template.
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
const ICONS_PLACEHOLDER = '/*__PART_ICONS__*/'

// 共享 client parts 位于 dsh-shared 包（issue #54 阶段 0）
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')

// 1. tsc 编译 client TS → lib/.client-build/index.js（CommonJS 单文件）
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

// 2. 读取编译产物
const bundle = readFileSync(join(BUILD_DIR, 'index.js'), 'utf8')

// 3. 注入模板
let out = readFileSync(join(root, 'lib/client.src.js'), 'utf8')

// 注入 client bundle
if (!out.includes(PLACEHOLDER)) {
  throw new Error(`client.src.js is missing the ${PLACEHOLDER} placeholder`)
}
out = out.replaceAll(PLACEHOLDER, () => bundle)
if (out.includes(PLACEHOLDER)) {
  throw new Error('client.src.js has unresolved placeholders')
}

// 注入共享图标（icons.part.js from dsh-shared）
if (out.includes(ICONS_PLACEHOLDER)) {
  const iconsPart = readFileSync(join(sharedPartsDir, 'icons.part.js'), 'utf8')
  out = out.replaceAll(ICONS_PLACEHOLDER, () => iconsPart)
}

// 剔除仅供 src 模板静态 lint 使用的注释
out = out.replaceAll('/* global AssistantStepView, installUiLocalize */\n', '')
out = out.replaceAll('    // eslint-disable-next-line no-unused-vars\n', '')

writeFileSync(join(root, 'lib/client.js'), out)

// 4. 清理临时编译目录
rmSync(BUILD_DIR, { recursive: true, force: true })
console.log(`built lib/client.js (${out.length} bytes, ${out.split('\n').length} lines)`)
