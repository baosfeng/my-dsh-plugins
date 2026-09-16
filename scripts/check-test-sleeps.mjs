#!/usr/bin/env node
/**
 * 固定 sleep 门禁 —— scripts/check-test-sleeps.mjs（issue #335）
 *
 * 背景：`plugins/<name>/test/` 里用固定 sleep 赌异步完成，让 CI 上**同一个根因复发 5 次**
 * （#310 host-smoke / #313 host-mutation·host-emit·host-edge / #317 / #335 dsh-my-context
 * host-mutation.mjs:345）。前 4 次都是「发现一处、修一处」，没有一条机制阻止第 5 处被写出来。
 *
 * 本门禁把默认反转：**新增的固定时长等待必须自己解释为什么不能用条件轮询**
 * （写 `// sleep-ok: <理由>`，理由 ≥8 字符），否则 CI 红；存量点冻结在基线里
 * （scripts/test-sleep-baseline.json），只允许变少、不允许新增。
 *
 * 判据与分类见 scripts/lib/test-sleeps.mjs 文件头（yield 安全 / fixed 受管 / dynamic 提示）。
 *
 * 用法：
 *   node scripts/check-test-sleeps.mjs                  # 门禁（遍历 plugins/* /test/）
 *   node scripts/check-test-sleeps.mjs --report         # 分类报告（不判定，用于 issue/PR 留痕）
 *   node scripts/check-test-sleeps.mjs --json           # 机器可读
 *   node scripts/check-test-sleeps.mjs --update-baseline# 收口后收缩基线（只允许变小）
 *   node scripts/check-test-sleeps.mjs --root <dir>     # 指定仓库根（测试用）
 *
 * 退出码：0 通过；1 有违规或 IO/解析失败（fail-closed）；2 用法错误。
 */
import { closeSync, constants, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import { auditWaits, findWaits, fixHint, fingerprint } from './lib/test-sleeps.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag, fallback) => {
  const idx = argv.indexOf(flag)
  return idx === -1 ? fallback : argv[idx + 1]
}

if (has('--help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
  process.exit(0)
}

const root = resolve(valueOf('--root', join(here, '..')))
const baselineFile = join(root, 'scripts', 'test-sleep-baseline.json')

/** 递归收集目录下的 .mjs/.js 文件。 */
function collectFiles(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(full, out)
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 扫描面：所有插件的 test/ 目录（含 features/steps 与 test/lib）。 */
function scanTargets() {
  const pluginsDir = join(root, 'plugins')
  const files = []
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const testDir = join(pluginsDir, entry.name, 'test')
    try {
      if (statSync(testDir).isDirectory()) files.push(...collectFiles(testDir))
    } catch {
      // 没有 test/ 的插件跳过
    }
  }
  return files.sort()
}

const parseSource = (source) =>
  parse(source, { sourceType: 'module', plugins: ['topLevelAwait', 'jsx'], errorRecovery: true })

const files = scanTargets()
const entries = []
const failures = []
for (const file of files) {
  const rel = relative(root, file)
  try {
    entries.push({ file: rel, waits: findWaits(readFileSync(file, 'utf8'), parseSource) })
  } catch (error) {
    failures.push(`${rel}: 解析失败（fail-closed）—— ${error.message}`)
  }
}

/** 读取基线（缺文件 → 空基线：所有固定等待都必须带豁免）。 */
function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(baselineFile, 'utf8'))
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

const baseline = readBaseline()
const result = auditWaits(entries, baseline)
const managed = entries.flatMap((e) =>
  e.waits.filter((w) => w.category === 'fixed').map((w) => ({ file: e.file, ...w })),
)

/**
 * 尝试**独占创建**文件（O_CREAT|O_EXCL，权限 0o600）。
 *
 * 用途：判断「基线文件是否已存在」——`--update-baseline` 的「首建允许、此后只允许收缩」
 * 判据要区分两者。原来的写法是 `existsSync(baselineFile)` 再 `writeFileSync`，两行之间
 * 文件状态可变（issue #107，CodeQL js/file-system-race：The file may have changed since
 * it was checked；规则建议「use file descriptors instead of file names」）。
 *
 * 现在由**内核**给出这个答案：open(O_CREAT|O_EXCL) 要么成功（此前不存在，我们刚建了它，
 * 记得删掉以免留下垃圾），要么以 EEXIST 失败（此前已存在）。检查与使用是同一次系统调用，
 * 不存在可被插入的时间窗。含 O_CREAT 的调用一律显式给权限位（0o600），不留 umask 默认宽权限。
 */
function existsBeforeWrite(file) {
  let fd
  try {
    fd = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  } catch (error) {
    if (error.code === 'EEXIST') return true
    // 首次运行时父目录可能尚不存在（假仓库夹具/新 clone）——原 existsSync 写法同样会返回
    // false 并让后续 writeFileSync 去报 ENOENT，这里保持"不存在"的语义，交给写入者报错。
    if (error.code === 'ENOENT') return false
    throw error
  }
  closeSync(fd)
  rmSync(file, { force: true })
  return false
}

if (has('--update-baseline')) {
  const next = managed
    .filter((w) => !w.exempt)
    .map((w) => fingerprint(w.file, w.text))
    .sort()
  // 首次初始化允许建基线（issue #335 落地时一次性冻结存量）；此后只允许收缩。
  // 判据来自 existsBeforeWrite（内核原子判定，非 existsSync + 后续写入的 TOCTOU 组合）。
  if (existsBeforeWrite(baselineFile) && next.length > baseline.length) {
    console.error(
      `拒绝：新基线 ${next.length} 条 > 现有 ${baseline.length} 条（基线只允许收缩，新增点请写 // sleep-ok: 理由）`,
    )
    process.exit(1)
  }
  writeFileSync(
    baselineFile,
    JSON.stringify(
      { note: '存量固定等待冻结基线（issue #335）：只允许变少；新增点必须写 // sleep-ok: <理由>', entries: next },
      null,
      2,
    ) + '\n',
  )
  console.log(`基线已更新：${baseline.length} → ${next.length} 条`)
  process.exit(0)
}

const counts = result.counts
const summary = {
  files: files.length,
  total: counts.yield + counts.fixed + counts.dynamic,
  yield: counts.yield,
  fixed: counts.fixed,
  dynamic: counts.dynamic,
  baselined: counts.fixed - result.violations.length - result.exempted.length,
  exempted: result.exempted.length,
  violations: result.violations.length,
}

if (has('--json')) {
  console.log(JSON.stringify({ ...summary, violationList: result.violations, dynamicList: result.dynamic }, null, 2))
  process.exit(result.violations.length > 0 || failures.length > 0 ? 1 : 0)
}

if (has('--report')) {
  console.log(`扫描面：plugins/*/test/**（${summary.files} 个文件）`)
  console.log(`固定等待点共 ${summary.total} 处：`)
  console.log(`  · yield   让出事件循环（setTimeout(...,0)，安全）        ${summary.yield}`)
  console.log(`  · fixed   固定时长等异步（受管，需理由或基线）           ${summary.fixed}`)
  console.log(`      - 基线冻结（存量）                                  ${summary.baselined}`)
  console.log(`      - 已带 sleep-ok 理由                                ${summary.exempted}`)
  console.log(`      - 违规（新增且无理由）                              ${summary.violations}`)
  console.log(`  · dynamic 动态延时（轮询 interval 等，仅提示 review）    ${summary.dynamic}`)
  process.exit(0)
}

for (const failure of failures) console.error(`✗ ${failure}`)
for (const violation of result.violations) console.error(`✗ ${fixHint(violation)}`)

if (result.staleBaseline.length > 0) {
  console.log(`提示：基线里有 ${result.staleBaseline.length} 条已不存在于代码（可用 --update-baseline 收缩）`)
}
if (failures.length > 0 || result.violations.length > 0) {
  console.error(
    `\n固定 sleep 门禁失败：${failures.length} 个解析失败 / ${result.violations.length} 处新增固定等待无理由（issue #335）`,
  )
  process.exit(1)
}
console.log(
  `固定 sleep 门禁通过：${summary.files} 个测试文件，${summary.fixed} 处固定等待（基线 ${summary.baselined} + 有理由 ${summary.exempted}），` +
    `${summary.yield} 处让出事件循环，${summary.dynamic} 处动态延时`,
)
