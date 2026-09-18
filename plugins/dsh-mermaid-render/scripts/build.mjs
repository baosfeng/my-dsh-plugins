/**
 * Build: compile the client TypeScript sources (src/client/index.ts plus the
 * part fragments such as src/client/settings.ts) to CommonJS with tsc, then
 * splice them into the lib/client.src.js template and write lib/client.js —
 * the file DSH actually serves at /plugins/dsh-mermaid-render/client.js.
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
 * The engine ships as assets/mermaid-<version>.min.js (served by the DSH
 * webServer, loaded on-demand by client fetch) and is verified here against a
 * frozen SHA256 — it is the single source of truth since issue #322 removed the
 * redundant vendor/mermaid.min.js copy (identical bytes, both tracked in git).
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
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
/** 设置页 part 注入位（src/client/settings.ts 的 tsc 产物，issue #383）。 */
const SETTINGS_PLACEHOLDER = '/*__PART_SETTINGS__*/'
/** 设置页 part 的锚点：注入后必须**恰好一份**（片段丢失/重复注入即失败）。 */
const SETTINGS_ANCHOR = 'function attachSettingsTab('
/** 图标实现的锚点声明：注入后必须**恰好一份**（内联副本复活即失败）。 */
const ICONS_ANCHOR = 'const ICON_STROKE = 1.8'

// 1. tsc 编译 client TS → lib/.client-build/（index.js 主产物 + part 片段如 settings.js）
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

// 2d. 注入设置页 part（src/client/settings.ts 的 tsc 产物，issue #383）
//     同款两道防线（占位符恰好一处 + 不在注释里）；锚点计数保证注入的是真正
//     的函数声明而不是注释文本 —— 设置页「静默消失」是这类注入最典型的故障。
if (!isPlaceholderOutsideComments(template, SETTINGS_PLACEHOLDER)) {
  throw new Error(
    `${SETTINGS_PLACEHOLDER} in client.src.js is inside a comment: injection would \`succeed\` but the settings tab would never be registered`,
  )
}
out = spliceExactlyOnce(out, SETTINGS_PLACEHOLDER, readFileSync(join(BUILD_DIR, 'settings.js'), 'utf8'))
const settingsDecls = out.split(SETTINGS_ANCHOR).length - 1
if (settingsDecls !== 1) {
  throw new Error(`client.js must contain exactly 1 "${SETTINGS_ANCHOR}" declaration, found ${settingsDecls}`)
}

// 3. 校验发布用的 mermaid 引擎（assets/，由 DSH webServer 在运行时按需 fetch，而非 base64 内联）。
//
//    issue #322：引擎此前在仓库里存了两份（vendor/mermaid.min.js 与 assets/ 的构建产物副本，
//    md5 完全相同）。删除冗余的 vendor/ 后，assets/mermaid-<版本>.min.js 成为**唯一真源**，
//    这里用冻结的 SHA256 承担原先「asset 必须与 vendor 逐字节一致」那条断言（issue #296：
//    线上资产曾被 prettier 美化后提交成 6.9MB / 177k 行版本）。SHA256 比原断言更强——
//    原先两份同时被改仍会通过，现在任何字节变化都必须显式更新下面的常量。
//    换引擎版本：把上游 mermaid@<版本> 的 dist/mermaid.min.js 放到 assets/mermaid-<版本>.min.js，
//    同步改 MERMAID_VERSION / MERMAID_SHA256 与 src/client/index.ts 里的版本引用。
const MERMAID_VERSION = '10.9.3'
/** assets/mermaid-10.9.3.min.js 的 SHA256（`shasum -a 256` 实测冻结）。 */
const MERMAID_SHA256 = '5a8ec91820bd55afef049068489369910e5d6ce70c8103952f27e29d3e76e8bc'
const mermaidDest = join(root, 'assets', `mermaid-${MERMAID_VERSION}.min.js`)
if (!existsSync(mermaidDest)) {
  throw new Error(
    `assets/mermaid-${MERMAID_VERSION}.min.js is missing — it is the single source of truth for the engine`,
  )
}
const engineBytes = readFileSync(mermaidDest)
const umd = engineBytes.toString('utf8')
if (!umd.includes('window') && !umd.includes('globalThis')) {
  throw new Error(`assets/mermaid-${MERMAID_VERSION}.min.js does not look like the UMD build`)
}
const engineSha = createHash('sha256').update(engineBytes).digest('hex')
if (engineSha !== MERMAID_SHA256) {
  throw new Error(
    `assets/mermaid-${MERMAID_VERSION}.min.js SHA256 mismatch\n` +
      `  want ${MERMAID_SHA256}\n` +
      `  got  ${engineSha}\n` +
      `  引擎内容变了就必须显式更新 MERMAID_SHA256（防无声替换 / 被 prettier 美化后提交）`,
  )
}

writeFileSync(join(root, 'lib/client.js'), out)

// 4. 清理临时编译目录
rmSync(BUILD_DIR, { recursive: true, force: true })
// 字节数用 Buffer.byteLength（out.length 是 UTF-16 码元数，含中文注释时与文件字节不符）
const engineSize = engineBytes.byteLength
console.log(
  `built lib/client.js (${Buffer.byteLength(out)} bytes, ${out.split('\n').length} lines, mermaid engine verified at assets/mermaid-${MERMAID_VERSION}.min.js (${engineSize} bytes, sha256 ok, loaded on-demand via fetch), icons from ${join(sharedPartsDir, 'icons.part.js')})`,
)
