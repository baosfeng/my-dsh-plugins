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

// 共享 client parts 位于 dsh-shared 包（issue #54 阶段 0；#186 P2 起含样式样板）
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')

/** 占位符 → [共享片段文件, 注入后必须恰好一份的锚点声明]。 */
const SHARED_PARTS = [
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

// 5. 剔除仅供 src 模板静态 lint 使用的注释
out = out.replaceAll('/* global AssistantStepView, installUiLocalize */\n', '')
out = out.replaceAll('    // eslint-disable-next-line no-unused-vars\n', '')

writeFileSync(join(root, 'lib/client.js'), out)

// 6. 清理临时编译目录
rmSync(BUILD_DIR, { recursive: true, force: true })
console.log(`built lib/client.js (${out.length} chars, ${out.split('\n').length} lines)`)
