/**
 * Build: compile the client TypeScript sources to CommonJS (src/client/*.ts →
 * lib/.client-build/*.js), then splice the entry bundle and the part fragments into
 * lib/client.src.js and write lib/client.js — the single __ModuleLoader__ bundle DSH
 * actually serves at /plugins/dsh-session-title-gen/client.js.
 *
 * 三类注入（每类都走「恰好一处 + 非注释位置 + 锚点声明恰好一份」三道断言）：
 *  1. client bundle：src/client/index.ts 的 tsc 产物（入口，提供 inject / apply）；
 *  2. 共享样式注入件：dsh-shared/client-parts/style-tag.part.js（issue #186 P2 单一来源）；
 *  3. part 片段：src/client/strings.ts（文案）与 src/client/settings.ts（设置页视图与
 *     页签注册）——无 import/export 的片段，与本 bundle 共享同一 factory 作用域
 *     （React API 与 installStyles 由上方解构/注入）。
 *
 * 三道断言的辅助来自 dsh-shared/scripts/splice.mjs（#185 起的两道防线 + 锚点计数）：
 * 占位符落在注释里会导致注入「成功」但片段永不声明（页签静默消失），锚点计数则保证
 * 注入的是真正的声明而不是注释文本。
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
const STYLE_PLACEHOLDER = '/*__PART_STYLE_TAG__*/'
const STRINGS_PLACEHOLDER = '/*__PART_STRINGS__*/'
const SETTINGS_PLACEHOLDER = '/*__PART_SETTINGS__*/'

/** 共享 client parts 位于 dsh-shared 包（issue #54 阶段 0；#186 P2 起含样式样板）。 */
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')

/**
 * part 片段注入表：占位符 → [片段文件, 注入后必须**恰好一份**的锚点声明, 目录]。
 * 片段目录缺省为本次 tsc 产物目录（lib/.client-build）；共享件传 sharedPartsDir。
 * 顺序固定：strings 提供常量与文案表，settings 与 bundle 引用它们。
 */
const PARTS = [
  [STYLE_PLACEHOLDER, 'style-tag.part.js', 'function installStyles(', sharedPartsDir],
  [STRINGS_PLACEHOLDER, 'strings.js', 'const SESSION_TITLE_SETTINGS_STRINGS =', BUILD_DIR],
  [SETTINGS_PLACEHOLDER, 'settings.js', 'function attachSettingsTab(', BUILD_DIR],
]

// 1. tsc 编译 client TS → lib/.client-build/*.js（CommonJS）
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

// 2. 读取编译产物与模板
const bundle = readFileSync(join(BUILD_DIR, 'index.js'), 'utf8')
const template = readFileSync(join(root, 'lib/client.src.js'), 'utf8')

// 3. 注入 client bundle（恰好一处）
let out = spliceExactlyOnce(template, PLACEHOLDER, bundle)

// 4. 注入共享件与 part 片段（占位符不在注释里 + 锚点声明恰好一份）
for (const [placeholder, file, anchor, dir] of PARTS) {
  if (!isPlaceholderOutsideComments(template, placeholder)) {
    throw new Error(
      `${placeholder} in client.src.js is inside a comment: injection would \`succeed\` but the part would never be declared`,
    )
  }
  out = spliceExactlyOnce(out, placeholder, readFileSync(join(dir, file), 'utf8'))
  const decls = out.split(anchor).length - 1
  if (decls !== 1) {
    throw new Error(`client.js must contain exactly 1 "${anchor}" declaration, found ${decls}`)
  }
}

// 5. 写产物并清理临时编译目录
writeFileSync(join(root, 'lib/client.js'), out)
rmSync(BUILD_DIR, { recursive: true, force: true })
console.log(`built lib/client.js (${out.length} chars, ${out.split('\n').length} lines)`)
