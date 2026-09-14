/**
 * Build: compile the client TypeScript source (src/client/index.ts) to a
 * CommonJS bundle with tsc, then splice it into the lib/client.src.js template
 * and write lib/client.js — the file DSH actually serves at
 * /plugins/dsh-mermaid-render/client.js.
 *
 *   node scripts/build.mjs
 *
 * lib/client.js is the build artifact and MUST be committed (CI runs
 * node --check + tests against it; it does not run this build).
 *
 * Two injections (template + shared parts) use spliceExactlyOnce
 * (dsh-shared/scripts/splice.mjs): placeholder must appear exactly once.
 *
 * mermaid engine is no longer inlined into client.js (old approach embedded
 * 3.3MB UMD as base64, inflating client.js to 4.5MB).
 * New approach: copy vendor/mermaid.min.js to assets/mermaid-10.9.3.min.js,
 * served by DSH webServer, loaded on-demand by client fetch.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isPlaceholderOutsideComments, spliceExactlyOnce } from '../../dsh-shared/scripts/splice.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = join(root, 'lib/.client-build')
/**
 * 共享 client parts（issue #186 P1）：图标单一来源位于 dsh-shared 包，
 * 构建期按文件系统路径拼接（不经过 package exports / require 解析），
 * 与 dsh-md-render / dsh-think-zh-expand 等 10 个插件走同一条路径。
 */
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')
/** tsc 产物注入位（模板里的注释形占位符）。 */
const BUNDLE_PLACEHOLDER = '/*__CLIENT_BUNDLE__*/'
/** 共享图标注入位（模板 factory 体内，图标声明处）。 */
const ICONS_PLACEHOLDER = '/*__PART_ICONS__*/'
/** 共享样式注入样板位（issue #186 P2）。 */
const STYLE_PLACEHOLDER = '/*__PART_STYLE_TAG__*/'
/** 共享 DOM 扫描骨架位（issue #186 P2）。 */
const SCANNER_PLACEHOLDER = '/*__PART_DOM_SCANNER__*/'
/** 图标实现的锚点声明：注入后必须**恰好一份**（内联副本复活即失败）。 */
const ICONS_ANCHOR = 'const ICON_STROKE = 1.8'

// 1. tsc 编译 client TS → lib/.client-build/index.js（CommonJS 单文件）
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

// 2. 注入模板（恰好一处，否则抛错）
const bundle = readFileSync(join(BUILD_DIR, 'index.js'), 'utf8')
const template = readFileSync(join(root, 'lib/client.src.js'), 'utf8')
let out = spliceExactlyOnce(template, BUNDLE_PLACEHOLDER, bundle)

// 2b. 注入共享图标（dsh-shared/client-parts/icons.part.js，issue #186 P1）
//     与 #185 同款两道防线：占位符「恰好一处」+ 「不能落在注释里」。
//     函数片段没有"字符串字面量取值"可断言，故取值断言落在锚点声明计数上：
//     注入后产物里 ICON_STROKE 的声明必须恰好一份（内联副本复活 → 显式失败）。
const iconsPart = readFileSync(join(sharedPartsDir, 'icons.part.js'), 'utf8')
if (!isPlaceholderOutsideComments(template, ICONS_PLACEHOLDER)) {
  throw new Error(
    `${ICONS_PLACEHOLDER} in client.src.js is inside a comment: injection would \`succeed\` but the icons would never be declared`,
  )
}
out = spliceExactlyOnce(out, ICONS_PLACEHOLDER, iconsPart)
const iconDecls = out.split(ICONS_ANCHOR).length - 1
if (iconDecls !== 1) {
  throw new Error(`client.js must contain exactly 1 "${ICONS_ANCHOR}" declaration, found ${iconDecls}`)
}

// 2c. 注入共享样式样板 / DOM 扫描骨架（dsh-shared/client-parts，issue #186 P2）
//     同款两道防线；锚点断言保证注入的是**函数声明**而不是注释里的文本。
for (const [placeholder, file, anchor] of [
  [STYLE_PLACEHOLDER, 'style-tag.part.js', 'function installStyles('],
  [SCANNER_PLACEHOLDER, 'dom-scanner.part.js', 'function installDomScanner('],
]) {
  if (!isPlaceholderOutsideComments(template, placeholder)) {
    throw new Error(
      `${placeholder} in client.src.js is inside a comment: injection would \`succeed\` but the shared part would never be declared`,
    )
  }
  out = spliceExactlyOnce(out, placeholder, readFileSync(join(sharedPartsDir, file), 'utf8'))
  const decls = out.split(anchor).length - 1
  if (decls !== 1) {
    throw new Error(`client.js must contain exactly 1 "${anchor}" declaration, found ${decls}`)
  }
}

// 3. Copy vendored mermaid engine to assets/ (served by DSH webServer at runtime)
//    Instead of base64-inlining into client.js, the engine is loaded on-demand via fetch.
const assetsDir = join(root, 'assets')
mkdirSync(assetsDir, { recursive: true })
const mermaidSrc = join(root, 'vendor/mermaid.min.js')
const mermaidDest = join(assetsDir, 'mermaid-10.9.3.min.js')
const umd = readFileSync(mermaidSrc, 'utf8')
if (!umd.includes('window') && !umd.includes('globalThis')) {
  throw new Error('vendor/mermaid.min.js does not look like the UMD build')
}
copyFileSync(mermaidSrc, mermaidDest)

writeFileSync(join(root, 'lib/client.js'), out)

// 4. 清理临时编译目录
rmSync(BUILD_DIR, { recursive: true, force: true })
// 字节数用 Buffer.byteLength（out.length 是 UTF-16 码元数，含中文注释时与文件字节不符）
const engineSize = Buffer.byteLength(umd)
console.log(
  `built lib/client.js (${Buffer.byteLength(out)} bytes, ${out.split('\n').length} lines, mermaid engine copied to assets/mermaid-10.9.3.min.js (${engineSize} bytes, loaded on-demand via fetch), icons from ${join(sharedPartsDir, 'icons.part.js')})`,
)
