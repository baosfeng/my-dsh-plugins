/**
 * Build: compile server TS (src → lib), compile client TS parts
 * (src/client → lib/.client-build), then splice the compiled parts into the
 * lib/client.src.js template and write lib/client.js — the file DSH actually
 * serves at /plugins/dsh-md-render/client.js.
 *
 *   node scripts/build.mjs
 *
 * lib/client.js is the build artifact and MUST be committed (CI runs
 * node --check + tests against it; it does not run this build).
 *
 * NOTE: replaceAll uses a FUNCTION replacer — a string replacer would interpret
 * $& / $1 special patterns inside the fragment source.
 *
 * mermaid 引擎**不内联**进 bundle（issue #185：base64 内联曾让 client.js 达 4.49 MB）：
 * 引擎 / panzoom 以 assets/<name> 发布，由 webServer 静态托管、client 按需 fetch；
 * 这里用冻结的 SHA256 承担「引擎未被无声替换 / 未被 prettier 美化后提交」的断言
 * （issue #296、#322 的教训）。
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = join(root, 'lib/.client-build')
const partsDir = join(BUILD_DIR, 'parts')
// 共享 client parts 位于 dsh-shared 包（issue #54 阶段 0）：图标集单一来源，
// 各插件构建时按文件系统路径拼接（不经过 package exports / require 解析）。
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')

/** 占位符 → 片段文件（数组顺序即拼接后的声明顺序）。
 *  opts.shared: true 表示从 dsh-shared 的 client-parts 目录读取（不经过 TS 编译）。 */
const PARTS = [
  ['/*__PART_CONFIG__*/', 'config.js'],
  ['/*__PART_BLOCK_LANG__*/', 'block-lang.js'],
  ['/*__PART_TABLE_NORMALIZE__*/', 'table-normalize.js'],
  ['/*__PART_RENDER_ASSETS__*/', 'render-assets.js'],
  ['/*__PART_DOM_ROOT__*/', 'dom-root.js'],
  ['/*__PART_OWN_CODE__*/', 'own-code.js'],
  ['/*__PART_OWN_MARKDOWN__*/', 'own-markdown.js'],
  ['/*__PART_IMAGE_LIGHTBOX__*/', 'image-lightbox.js'],
  ['/*__PART_COPY__*/', 'copy.js'],
  ['/*__PART_MARKDOWN_VIEW__*/', 'markdown-view.js'],
  ['/*__PART_CONTEXT_MARKDOWN__*/', 'context-markdown.js'],
  ['/*__PART_LANG_SOURCE__*/', 'lang-source.js'],
  ['/*__PART_BLOCK_RENDER__*/', 'block-render.js'],
  ['/*__PART_THINK__*/', 'think.js'],
  ['/*__PART_MERMAID_ENGINE__*/', 'mermaid-engine.js'],
  ['/*__PART_MERMAID_TOOLBAR__*/', 'mermaid-toolbar.js'],
  ['/*__PART_MERMAID_CARD__*/', 'mermaid-card.js'],
  ['/*__PART_MERMAID_SCAN__*/', 'mermaid-scan.js'],
  ['/*__PART_MERMAID_EXPORT__*/', 'mermaid-export.js'],
  ['/*__PART_ZOOM_MATH__*/', 'zoom-math.js'],
  ['/*__PART_ZOOM_FALLBACK__*/', 'zoom-fallback.js'],
  ['/*__PART_MERMAID_ZOOM__*/', 'mermaid-zoom.js'],
  ['/*__PART_LANG_SWITCH__*/', 'lang-switch.js'],
  ['/*__PART_DOM_SCANNER__*/', 'dom-scanner.part.js', { shared: true }],
  ['/*__PART_SCANNER__*/', 'scanner.js'],
  ['/*__PART_STYLES__*/', 'styles.js'],
  ['/*__PART_STYLE_TAG__*/', 'style-tag.part.js', { shared: true }],
  ['/*__PART_ICONS__*/', 'icons.part.js', { shared: true }],
  ['/*__PART_SETTINGS_STRINGS__*/', '../settings/strings.js'],
  ['/*__PART_SETTINGS_VIEW__*/', '../settings/view.js'],
  ['/*__PART_SETTINGS__*/', '../settings/index.js'],
  ['/*__PART_APPLY__*/', 'apply.js'],
]

/** 注入后必须**恰好一份**的锚点（片段丢失 / 重复注入即失败）。 */
const ANCHORS = [
  ['function installStyles(', 'style-tag.part.js'],
  ['function installDomScanner(', 'dom-scanner.part.js'],
  ['const ICON_STROKE = 1.8', 'icons.part.js'],
  ['function attachSettingsTab(', 'settings/index.ts'],
  ['function applyThinkExpand(', 'think.ts'],
  ['function FullscreenButton(', 'mermaid-toolbar.ts'],
  ['function considerMermaidBlock(', 'mermaid-scan.ts'],
  ['function makeExportHandlers(', 'mermaid-export.ts'],
  ['function createFallbackZoomer(', 'zoom-fallback.ts'],
  ['function zoomFitScale(', 'zoom-math.ts'],
  ['function resolveBlockLang(', 'block-lang.ts'],
  ['function resolveFenceLang(', 'block-lang.ts'],
  ['function fenceContentHash(', 'block-lang.ts'],
  ['function fenceLangOf(', 'lang-source.ts'],
  ['function scanLangSwitches(', 'lang-switch.ts'],
  ['function applyLangForce(', 'lang-switch.ts'],
  ['function bindZoom(', 'mermaid-zoom.ts'],
  ['function toggleCardOverlay(', 'mermaid-zoom.ts'],
  ['function refreshFenceLangIndex(', 'lang-source.ts'],
  ['function ensureRenderAsset(', 'render-assets.ts'],
  ['function renderMarkdownInto(', 'dom-root.ts'],
  ['function CodeBlockView(', 'own-code.ts'],
  ['function markdownNodes(', 'own-markdown.ts'],
  ['function applyFenceBlock(', 'block-render.ts'],
  ['function fenceKindOf(', 'block-render.ts'],
]

// 1. Compile client TS → lib/.client-build/**
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

// 1b. 路由路径单一真源（host 半 src/routes/paths.ts → client 片段作用域）。
//     动态 import：paths.js 由上一步的 tsc 生成，静态 import 会在全新检出（lib/ 无产物）时先于 tsc 求值而失败。
const {
  clientRouteDeclarations,
  CONFIG_API_URL,
  MERMAID_ENGINE_URL,
  MERMAID_ENGINE_FILE,
  PANZOOM_SCRIPT_URL,
  PANZOOM_FILE,
  MARKED_URL,
  MARKED_FILE,
  HIGHLIGHTJS_URL,
  HIGHLIGHTJS_FILE,
  LANGS_API_URL,
  LANGS_HASH_PARAM,
} = await import('../lib/routes/paths.js')
const ROUTE_PATHS = [['/*__ROUTE_PATHS__*/', clientRouteDeclarations()]]
// 锚点用**实际常量值**参与匹配：单一真源改了值，产物里就必须出现新值（不是只出现变量名）。
// 尾随换行参与匹配：`exports.CONFIG_API_URL = CONFIG_API_URL;` 这类**使用点**不命中，
// 只有注入的那一行声明命中（同一变量在产物里被多处引用是正常的）。
ANCHORS.push(
  ['const CONFIG_API_URL = ' + JSON.stringify(CONFIG_API_URL) + '\n', 'src/routes/paths.ts (single source)'],
  ['const MERMAID_ENGINE_URL = ' + JSON.stringify(MERMAID_ENGINE_URL) + '\n', 'src/routes/paths.ts (single source)'],
  ['const LANGS_API_URL = ' + JSON.stringify(LANGS_API_URL) + '\n', 'src/routes/paths.ts (single source)'],
  ['const LANGS_HASH_PARAM = ' + JSON.stringify(LANGS_HASH_PARAM) + '\n', 'src/routes/paths.ts (single source)'],
  ['const PANZOOM_SCRIPT_URL = ' + JSON.stringify(PANZOOM_SCRIPT_URL) + '\n', 'src/routes/paths.ts (single source)'],
  ['const MARKED_URL = ' + JSON.stringify(MARKED_URL) + '\n', 'src/routes/paths.ts (single source)'],
  ['const HIGHLIGHTJS_URL = ' + JSON.stringify(HIGHLIGHTJS_URL) + '\n', 'src/routes/paths.ts (single source)'],
)

// 2. Splice compiled parts into template
let out = readFileSync(join(root, 'lib/client.src.js'), 'utf8')
for (const [placeholder, text] of ROUTE_PATHS) {
  if (!out.includes(placeholder)) {
    throw new Error(`client.src.js is missing the ${placeholder} placeholder`)
  }
  out = out.replaceAll(placeholder, () => text)
}
for (const [placeholder, file, opts = {}] of PARTS) {
  if (!out.includes(placeholder)) {
    throw new Error(`client.src.js is missing the ${placeholder} placeholder`)
  }
  const dir = opts.shared ? sharedPartsDir : partsDir
  const part = readFileSync(join(dir, file), 'utf8')
  // 函数式替换：替换串中的 $& / $1 不会被 replaceAll 特殊解释。
  out = out.replaceAll(placeholder, () => part)
}
const unresolved = [...PARTS, ...ROUTE_PATHS].map(([placeholder]) => placeholder).filter((p) => out.includes(p))
if (unresolved.length > 0) {
  throw new Error(`client.src.js has unresolved placeholders: ${unresolved.join(', ')}`)
}

// 2d. 等价瘦身：各片段共享同一个 factory 函数作用域，`"use strict"` 指令只需保留一份
//     （tsc 每个片段各带一份；指令只对函数体首个声明生效，重复的是纯文本）。
let strictKept = false
out = out.replace(/^"use strict";\n/gm, () => {
  if (strictKept) return ''
  strictKept = true
  return '"use strict";\n'
})

// 2c. 等价瘦身：把每个片段尾部的 `exports.X = X;` 连续段合并成一次 Object.assign
//     （同一 factory 作用域、同名同值、声明顺序不变）——纯样板压缩，产物减 ~3 KB，
//     行为零变化；不匹配就原样保留。
out = out.replace(/^(?:exports\.([A-Za-z_$][\w$]*) = \1;\n)+/gm, (block) => {
  const names = block
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice('exports.'.length, line.indexOf(' =')))
  return 'Object.assign(exports,{' + names.join(',') + '});\n'
})

// 2b. 锚点计数：注入的是**真正的函数/常量声明**，不是注释里的文本
//     （片段「静默丢失」是这类构建最典型的故障模式）。
for (const [anchor, source] of ANCHORS) {
  const count = out.split(anchor).length - 1
  if (count !== 1) {
    throw new Error(`client.js must contain exactly 1 "${anchor}" declaration (from ${source}), found ${count}`)
  }
}

// 3. 校验发布用的 vendored 资源（assets/，运行时由 webServer 静态托管、client 按需 fetch）。
//    SHA256 冻结承担「资源未被无声替换 / 未被 prettier 美化后提交」的断言（issue #296、#322）。
/** 冻结的资产哈希（shasum -a 256 实测）；内容变了必须显式更新这里的值。 */
const ASSET_SHA256 = {
  [MERMAID_ENGINE_FILE]: '5a8ec91820bd55afef049068489369910e5d6ce70c8103952f27e29d3e76e8bc',
  [PANZOOM_FILE]: '3ce354ef7b493efb62a4d4acaaf86fa2d6027eb629857a4e144041de1a112c1e',
  // 自研 markdown 渲染器的解析层（marked 18.1.0 UMD，MIT）。
  [MARKED_FILE]: 'f424dcb508fdf93e0137a970cfce8f3207ea2e3f37eca5f7556a52875683632a',
  // 自研代码块渲染器的高亮层（highlight.js 11.12.0 common 构建，BSD-3-Clause）。
  [HIGHLIGHTJS_FILE]: '8ab71eb09c51f501e5e25157d9cff100e46cc29bcbfc744d0b746d451fca7f53',
}
const assetBytes = {}
for (const [file, wantSha] of Object.entries(ASSET_SHA256)) {
  const dest = join(root, 'assets', file)
  if (!existsSync(dest)) {
    throw new Error(`assets/${file} is missing — it is the single source of truth for this asset`)
  }
  const bytes = readFileSync(dest)
  const text = bytes.toString('utf8')
  // UMD 形态：注入 <script> 后必须能落到 window（引擎与 panzoom 同款契约）。
  if (!text.includes('window') && !text.includes('globalThis')) {
    throw new Error(`assets/${file} does not look like the UMD build`)
  }
  const got = createHash('sha256').update(bytes).digest('hex')
  if (got !== wantSha) {
    throw new Error(
      `assets/${file} SHA256 mismatch\n  want ${wantSha}\n  got  ${got}\n` +
        '  资源内容变了就必须显式更新 ASSET_SHA256（防无声替换 / 被 prettier 美化后提交）',
    )
  }
  assetBytes[file] = bytes
}
const engineBytes = assetBytes[MERMAID_ENGINE_FILE]

writeFileSync(join(root, 'lib/client.js'), out)

// 4. Clean up temporary build directory
rmSync(BUILD_DIR, { recursive: true, force: true })
// 字节数用 Buffer.byteLength（out.length 是 UTF-16 码元数，含中文注释时与文件字节不符）
console.log(
  `built lib/client.js (${Buffer.byteLength(out)} bytes, ${out.split('\n').length} lines, ` +
    `assets verified (${MERMAID_ENGINE_FILE} ${engineBytes.byteLength} bytes + ${PANZOOM_FILE}, sha256 ok, on-demand fetch))`,
)
