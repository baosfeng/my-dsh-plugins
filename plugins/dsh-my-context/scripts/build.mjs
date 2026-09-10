/**
 * Build: compile the client TypeScript parts (src/client/parts/*.ts →
 * lib/.client-build/parts/*.js), publish them as the committed
 * lib/parts/<name>.js artifacts, then splice those pieces into the
 * PART placeholders of lib/client.src.js and write lib/client.js — the single
 * __ModuleLoader__ bundle DSH actually serves.
 *
 *   node scripts/build.mjs
 *
 * Why splicing: the DSH browser ModuleLoader does not support relative-path
 * require inside a factory (`require('./x.js')` misses the module table), so
 * lib/parts/*.js stay import/export-free function declaration texts sharing
 * the factory scope and are spliced in as ONE bundle — the runtime shape is
 * unchanged from the hand-written era.
 *
 * lib/parts/*.js are published (not a temp dir like dsh-my-memory) because
 * they are the committed splice inputs the build contract test
 * (test/client-contract.mjs) reads back to lock "lib/client.js ==
 * lib/client.src.js + parts"; they keep their historical names and are
 * formatted with the repo prettier config (.prettierignore re-includes
 * plugins/.../lib/parts/**) — the SAME formatted text is spliced into
 * lib/client.js.
 *
 * Placeholder replacement must use a FUNCTIONAL replacer
 * (src.replaceAll(ph, () => part)): a string replacer would treat $&/$1 in the
 * fragment as replacement patterns and corrupt the source.
 *
 * lib/client.js is a build artifact and MUST be committed (CI only runs
 * node --check + tests against it; it does not run this build).
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'lib/.client-build')
const buildPartsDir = join(buildDir, 'parts')
const outPartsDir = join(root, 'lib/parts')

// 1. 编译 client 端 TS 片段 → lib/.client-build/parts/*.js
execSync('npx tsc -p tsconfig.client.json', { cwd: root, stdio: 'inherit' })

/** (占位符, 片段文件名) —— 数组顺序即拼接顺序，const 初始化有依赖：
 *  i18n 先于 panel（strings 由 panel/overflow 顶层函数体引用），styles 最后
 *  （STYLES 仅被 injectStyles 调用时读取）。颠倒会让 `const strings` 落在
 *  使用它的片段之后 → TDZ 报错（见 lib/client.src.js 注释）。 */
const pieces = [
  ['/*__PART_I18N__*/', 'i18n'],
  ['/*__PART_PANEL__*/', 'panel'],
  ['/*__PART_OVERFLOW__*/', 'overflow'],
  ['/*__PART_STYLES__*/', 'styles'],
]

// 2. 发布编译后的片段为提交进仓库的 lib/parts/<name>.js
for (const [, name] of pieces) {
  writeFileSync(join(outPartsDir, `${name}.js`), readFileSync(join(buildPartsDir, `${name}.js`), 'utf8'))
}
execSync('npx prettier --write lib/parts', { cwd: root, stdio: 'inherit' })

// 3. 把片段拼接进 lib/client.src.js 模板
let out = readFileSync(join(root, 'lib/client.src.js'), 'utf8')
for (const [placeholder, name] of pieces) {
  if (!out.includes(placeholder)) {
    throw new Error(`client.src.js is missing the ${placeholder} placeholder`)
  }
  const part = readFileSync(join(outPartsDir, `${name}.js`), 'utf8')
  // 函数式替换：片段内容作为字面文本返回，$&/$1 不会被特殊解释。
  out = out.replaceAll(placeholder, () => part)
}

// 未解析占位符检查：只查本次拼接的真实占位符（模板注释里出现的
// `__PART_*__` 说明文字不算未解析）。
const unresolved = pieces.map(([placeholder]) => placeholder).filter((placeholder) => out.includes(placeholder))
if (unresolved.length > 0) {
  throw new Error(`client.src.js has unresolved placeholders: ${unresolved.join(', ')}`)
}

writeFileSync(join(root, 'lib/client.js'), out)

// 4. 清理临时编译目录（.gitignore 已忽略，残留会让 depcruise ENOENT）
rmSync(buildDir, { recursive: true, force: true })

const lines = out.split('\n').length
console.log(`built lib/client.js (${out.length} bytes, ${lines} lines, ${pieces.length} fragments)`)
