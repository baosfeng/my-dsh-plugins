/**
 * Build: compile the client TypeScript source (src/client/index.ts) to a
 * CommonJS bundle with tsc, then splice it into the lib/client.src.js template
 * (at the /*__CLIENT_BUNDLE__* / placeholder) and write lib/client.js — the
 * file DSH actually serves at /plugins/dsh-think-zh-expand/client.js.
 *
 * 共享部件（dsh-shared/client-parts）：图标集（issue #54 阶段 0）+ 样式注入
 * 样板（issue #186 P2）。三处注入一律走「恰好一处 + 非注释位置 + 锚点声明恰好
 * 一份」——辅助来自 dsh-shared/scripts/splice.mjs（#185 起的两道防线，#186 P2
 * 从 dsh-mermaid-render 收口为共享实现；原实现是宽松 replaceAll：占位符缺失时
 * 静默跳过、重复时注入两份）。
 *
 * 设置页 part（issue #383）：src/client/settings.ts 的 tsc 产物（lib/.client-build
 * /settings.js）注入 /*__PART_SETTINGS__* / 占位符 —— 它是无 import/export 的片段，
 * 与本 bundle 共享同一 factory 作用域（React API 与 installStyles 由上方解构/注入）。
 *
 *   node scripts/build.mjs
 *
 * lib/client.js is the build artifact and MUST be committed (CI runs
 * node --check + tests against it; it does not run this build).
 *
 * NOTE: spliceExactlyOnce 用 FUNCTION replacer —— 字符串 replacer 会把片段源码
 * 里的 $& / $1 当特殊模式解释。
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isPlaceholderOutsideComments, spliceExactlyOnce } from '../../dsh-shared/scripts/splice.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = join(root, 'lib/.client-build')
const PLACEHOLDER = '/*__CLIENT_BUNDLE__*/'
const ICONS_PLACEHOLDER = '/*__PART_ICONS__*/'
const STYLE_PLACEHOLDER = '/*__PART_STYLE_TAG__*/'
const MARKDOWN_FALLBACK_PLACEHOLDER = '/*__PART_MARKDOWN_FALLBACK__*/'
/** 设置页 part 注入位（src/client/settings.ts 的 tsc 产物，issue #383）。 */
const SETTINGS_PLACEHOLDER = '/*__PART_SETTINGS__*/'
/** 设置页 part 的锚点：注入后必须**恰好一份**（片段丢失/重复注入即失败）。 */
const SETTINGS_ANCHOR = 'function attachSettingsTab('

// 共享 client parts 位于 dsh-shared 包（issue #54 阶段 0；#186 P2 起含样式样板；
// #299 起含三级 Markdown 渲染回退——与 dsh-my-plugin-manager 共用单一来源）
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')

/** 占位符 → [共享片段文件, 注入后必须恰好一份的锚点声明]。 */
const SHARED_PARTS = [
  [MARKDOWN_FALLBACK_PLACEHOLDER, 'markdown-fallback.part.js', 'function installMarkdownViewFallback('],
  [ICONS_PLACEHOLDER, 'icons.part.js', 'const ICON_STROKE = 1.8'],
  [STYLE_PLACEHOLDER, 'style-tag.part.js', 'function installStyles('],
]

// 1. tsc 编译 client TS → lib/.client-build/index.js（CommonJS 单文件）
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

// 2. 读取编译产物与模板
const bundle = readFileSync(join(BUILD_DIR, 'index.js'), 'utf8')
const template = readFileSync(join(root, 'lib/client.src.js'), 'utf8')

// 3. 注入 client bundle（恰好一处）
let out = spliceExactlyOnce(template, PLACEHOLDER, bundle)

// 4. 注入共享部件（恰好一处 + 非注释位置 + 锚点声明恰好一份 —— #185 两道防线）
for (const [placeholder, file, anchor] of SHARED_PARTS) {
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

// 5. 注入设置页 part（src/client/settings.ts 的 tsc 产物，issue #383）
//    同款两道防线（占位符恰好一处 + 不在注释里）；锚点计数保证注入的是真正的
//    函数声明而不是注释文本 —— 设置页「静默消失」是这类注入最典型的故障。
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

// 6. 剔除仅供 src 模板静态 lint 使用的注释
out = out.replaceAll('/* global AssistantStepView, installUiLocalize */\n', '')
out = out.replaceAll('    // eslint-disable-next-line no-unused-vars\n', '')

writeFileSync(join(root, 'lib/client.js'), out)

// 7. 清理临时编译目录
rmSync(BUILD_DIR, { recursive: true, force: true })
console.log(`built lib/client.js (${out.length} chars, ${out.split('\n').length} lines)`)
