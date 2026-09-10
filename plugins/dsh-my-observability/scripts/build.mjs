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
 * 片段来源两类：
 *  - 本地片段：lib/.client-build/parts/*.js（本脚本先 tsc 编译 src/client/parts/*.ts）；
 *  - 共享/复用片段：icons 来自 dsh-shared/client-parts（不编译）；audit-view 来自
 *    server 端 tsc 产物 lib/audit-view.js（server/client 共用模块，逐行剥离
 *    `export ` 前缀后作为片段拼入）。
 *
 * 占位符替换必须用函数式 replacer（src.replaceAll(ph, () => part)）：
 * 字符串 replacer 会把片段中的 $& / $1 等当作替换模式特殊解释而损坏源码。
 *
 * lib/client.js 是构建产物且必须提交（CI 只对产物执行 node --check +
 * 测试，不运行本 build）。
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'lib/.client-build')
const partsDir = join(buildDir, 'parts')
// 共享 client parts 位于 dsh-shared 包（issue #54 阶段 0）：图标集单一来源，
// 各插件构建时经 shared: true 标记从此目录拼接。
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')

// 1. 编译 client TS 片段 → lib/.client-build/parts/*.js
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

/** (placeholder, part file, opts?) — 拼接顺序固定（const 初始化器依赖）。
 *  file 相对 partsDir（本地编译产物）、sharedPartsDir（shared: true）或
 *  opts.root 覆盖的目录（如 'lib'，用于 server 端产物）。opts.stripExport
 *  逐行剥离行首 `export ` 前缀（把可单测的 ESM 模块作为片段拼进 client
 *  作用域）。 */
const PARTS = [
  ['/*__PART_I18N__*/', 'i18n.js'],
  ['/*__PART_ICONS__*/', 'icons.part.js', { shared: true }],
  ['/*__PART_AUDIT_VIEW__*/', 'audit-view.js', { root: 'lib', stripExport: true }],
  ['/*__PART_REPLAY__*/', 'replay.js'],
  ['/*__PART_RESOURCE__*/', 'resource.js'],
  ['/*__PART_REPLAY_EXT__*/', 'replay-ext.js'],
  ['/*__PART_GIT__*/', 'git.js'],
  ['/*__PART_STYLES__*/', 'styles.js'],
]

let src = readFileSync(join(root, 'lib/client.src.js'), 'utf8')
for (const [placeholder, file, opts = {}] of PARTS) {
  if (!src.includes(placeholder)) {
    throw new Error(`client.src.js is missing the ${placeholder} placeholder`)
  }
  const dir = opts.shared ? sharedPartsDir : opts.root ? join(root, opts.root) : partsDir
  let part = readFileSync(join(dir, file), 'utf8')
  if (opts.stripExport) part = part.replace(/^export /gm, '')
  // 函数式替换：片段内容作为字面文本返回，$&/$1 不会被特殊解释。
  src = src.replaceAll(placeholder, () => part)
}

if (src.includes('/*__PART_')) {
  throw new Error('build left an unresolved /*__PART_*__/ placeholder in client.js')
}

writeFileSync(join(root, 'lib/client.js'), src)

// 2. 清理编译中间目录（client 产物只有 lib/client.js）
rmSync(buildDir, { recursive: true, force: true })

console.log(`built lib/client.js (${src.length} bytes, from client.src.js + ${PARTS.length} fragments)`)
