/**
 * Build: splice the shared style part and the setting-panel parts
 * (lib/parts/*.js) into the lib/client.src.js template, writing lib/client.js —
 * the file DSH actually serves at /plugins/dsh-my-remote/client.js.
 *
 * 与 dsh-my-notify / dsh-my-plugin-manager 同一形态：片段是**手写 JS**（非 TS），
 * 构建期按占位符拼接进 `__ModuleLoader__` factory 作用域 —— 因此片段之间可直接
 * 互相调用，无需 import（client 产物不得有运行时相对 require）。
 *
 * 注入一律走「恰好一处 + 非注释位置 + 锚点声明恰好一份」（辅助来自
 * dsh-shared/scripts/splice.mjs，issue #185 的两道防线）——原实现是宽松
 * replaceAll：占位符缺失时静默跳过、重复时注入两份，设置页会「静默消失」。
 *
 *   node scripts/build.mjs
 *
 * lib/client.js 是构建产物，必须提交（CI 只跑 node --check + 测试，不跑构建）。
 *
 * NOTE: spliceExactlyOnce 用 FUNCTION replacer —— 字符串 replacer 会把片段源码
 * 里的 $& / $1 当特殊模式解释。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPlaceholderOutsideComments, spliceExactlyOnce } from '../../dsh-shared/scripts/splice.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const STYLE_PLACEHOLDER = '/*__PART_STYLE_TAG__*/'
const SETTINGS_PLACEHOLDER = '/*__PART_SETTINGS__*/'
/** 设置页片段的锚点：注入后必须**恰好一份**（片段丢失 / 重复注入即失败）。 */
const SETTINGS_ANCHOR = 'function attachSettingsTab('

/** 共享 client parts 位于 dsh-shared 包（issue #186 P2 的样式注入样板）。 */
const sharedPartsDir = join(root, '..', 'dsh-shared', 'client-parts')

/** 占位符 → [共享片段文件, 注入后必须恰好一份的锚点声明]。 */
const SHARED_PARTS = [[STYLE_PLACEHOLDER, 'style-tag.part.js', 'function installStyles(']]

/** 设置页片段（顺序即依赖顺序：样式常量 → i18n → 模型 → 视图 → 编辑器 → 主视图）。 */
const SETTINGS_PARTS = [
  'settings-styles.js',
  'settings-i18n.js',
  'settings-config.js',
  'settings-views.js',
  'settings-webhooks.js',
  'settings-panel.js',
]

const template = readFileSync(join(root, 'lib/client.src.js'), 'utf8')

// 1. 注入共享样式样板（恰好一处 + 非注释位置 + 锚点恰好一份）
let out = template
for (const [placeholder, file, anchor] of SHARED_PARTS) {
  assertInjectable(template, placeholder, anchor)
  out = spliceExactlyOnce(out, placeholder, readFileSync(join(sharedPartsDir, file), 'utf8'))
  assertAnchorCount(out, anchor)
}

// 2. 注入设置页片段（按依赖顺序拼接为一个块，再整体 splice）
assertInjectable(template, SETTINGS_PLACEHOLDER, SETTINGS_ANCHOR)
const parts = SETTINGS_PARTS.map((file) => readFileSync(join(root, 'lib/parts', file), 'utf8').trimEnd()).join('\n\n')
out = spliceExactlyOnce(out, SETTINGS_PLACEHOLDER, parts)
assertAnchorCount(out, SETTINGS_ANCHOR)

writeFileSync(join(root, 'lib/client.js'), out)
console.log(
  `built lib/client.js (${out.length} chars, ${out.split('\n').length} lines) from ${SETTINGS_PARTS.length} parts`,
)

/** 占位符必须在模板里恰好一处、且**不在注释里**（否则注入「成功」但部件从未声明）。 */
function assertInjectable(template, placeholder, anchor) {
  if (!isPlaceholderOutsideComments(template, placeholder)) {
    throw new Error(
      `${placeholder} in client.src.js is inside a comment: injection would \`succeed\` but ${anchor} would never be declared`,
    )
  }
}

/** 锚点声明必须恰好一份（防「注入的是注释文本」与重复注入）。 */
function assertAnchorCount(out, anchor) {
  const decls = out.split(anchor).length - 1
  if (decls !== 1) throw new Error(`client.js must contain exactly 1 "${anchor}" declaration, found ${decls}`)
}
