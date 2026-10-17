/**
 * host-events.mjs — 宿主事件清单取证（声明通道 + 派发通道）。
 *
 * 为什么需要它：插件用 `ctx.on('<事件名>', ...)` 订阅宿主事件，而 cordis 的事件表
 * **只是类型声明**（`declare module '@deepseek-ai/cordis' { interface Events { ... } }`），
 * 运行时不校验事件名——宿主删掉/改名一个事件后，插件侧监听**静默失效**（不报错、
 * 不告警、不抛异常），诊断能力无声消失。0.1.7-rc.2 删除 `hmr/config-update-failed`
 * 就是这样打穿 dsh-my-guardian 的，而"自己 emit 事件"的测试永远抓不到。
 *
 * 所以本脚本从宿主源码取证事件清单，冻结进 test/fixtures/host-events.json，
 * 由 test/host-event-contract.mjs 判定"插件监听的事件名在目标宿主是否存在"。
 *
 * 取证两个通道（任一为空都不能判定事件不存在）：
 *   ① 声明：`interface Events { 'x'(...): ... }` 块内的字符串键（源码与 .d.ts 同形）
 *   ② 派发：`ctx.<emit|parallel|serial|bail|waterfall>('x', ...)`（含双引号与
 *      `this.ctx` / `this.context` 写法——旧宿主就是用 `ctx.parallel()` 派发
 *      `hmr/config-update-failed` 的，只看 emit 会漏）
 *
 * 取证对象是"参考源（升级目标版本）+ 已安装宿主"两个通道。宿主可以是 npm 全局安装，
 * 也可以是**桌面 App**（宿主树在 app.asar 内，见 lib/asar-host.mjs 与 installedHostDir）。
 *
 * 用法：
 *   node scripts/host-events.mjs            # 打印两宿主清单差异（不写文件）
 *   node scripts/host-events.mjs --update   # 重新取证并覆盖 fixture（参考源必须在场）
 *
 * 降级语义：找不到已安装宿主时**不再报错退出**——只刷新 reference 段、原样保留上一次的
 * installed 段并打印降级说明（与 CI 用冻结 fixture 判定同义）。没有可保留的 installed 段
 * 时仍然报错：不许凭空生成"已装宿主事件清单"。
 *
 * ⚠️ --update 只重取**事件清单**；fallbackEvidence（降级 marker 的 target/legacy 坐标
 * 与退役登记）不自动改，跑完必须人工复核 src/events.ts 的 HOST_EVENT_FALLBACKS。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { appHostCandidates, hostExists, hostIsDir, hostReadFileText, hostReaddir } from './lib/asar-host.mjs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 冻结的两宿主事件清单（ci 无参考源时唯一依据）。 */
const FIXTURE_PATH = join(PLUGIN_ROOT, 'test', 'fixtures', 'host-events.json')

const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'dist', 'coverage', '.stryker-tmp', 'reports'])
const DECL_RE = /interface Events\s*\{/g
const DECL_KEY_RE = /'([\w/-]+)'\s*[(:]/g
const DISPATCH_RE = /\b(?:ctx|context)\.(?:emit|parallel|serial|bail|waterfall)\(\s*(['"])([^'"]+)\1/g

/** 官方参考源目录（升级目标版本的源码），不存在返回 null。 */
export function referenceDir() {
  const dir = process.env.DSH_HARNESS_REF ?? join(homedir(), 'IdeaProjects', 'deepseek-harness')
  return existsSync(join(dir, 'package.json')) ? dir : null
}

/**
 * 已安装宿主目录，不存在返回 null。两种形态：
 *   ① npm 全局安装：<prefix>/@deepseek-ai/dsh
 *   ② **桌面 App**（纯 App 环境没有 npm 宿主）：<Resources>/app.asar/dsh —— 宿主依赖树在
 *      asar 归档内，普通 existsSync 看不见，必须走 hostExists 解析 asar 头（见 lib/asar-host.mjs）。
 */
export function installedHostDir() {
  const prefixes = [
    join(homedir(), '.npm-global', 'lib', 'node_modules'),
    join(homedir(), '.local', 'lib', 'node_modules'),
    '/usr/local/lib/node_modules',
    '/opt/homebrew/lib/node_modules',
  ]
  if (process.env.DSH_INSTALLED_HOST !== undefined) prefixes.unshift(dirname(process.env.DSH_INSTALLED_HOST))
  for (const prefix of prefixes) {
    const dir = join(prefix, '@deepseek-ai', 'dsh')
    if (hostExists(join(dir, 'package.json'))) return dir
  }
  return null
}

/**
 * 取证专用的宿主目录：在 installedHostDir() 之外额外接受**桌面 App 的 asar 宿主**
 * （宿主依赖树归档在 app.asar 内，普通 existsSync 看不见，见 lib/asar-host.mjs）。
 *
 * 为什么不合并进 installedHostDir()：asar 内的路径**只能按字节读，不能 import()**
 * （Node 的 ESM loader 打不开归档；只有 Electron 能）。installedHostDir() 的消费方
 * 包含"import 真宿主 cordis 起真实 loader"的测试，被喂 asar 路径会 ENOTDIR。因此
 * 「可 import 的宿主」与「可扫描取证的宿主」必须分开。
 */
export function installedHostScanDir() {
  const plain = installedHostDir()
  if (plain !== null) return plain
  for (const candidate of appHostCandidates()) {
    if (hostExists(join(candidate, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) return candidate
  }
  return null
}

/** 读某个宿主目录 package.json 的 version（对不上 fixture 即要求重新取证）。 */
export function versionOf(dir) {
  try {
    return JSON.parse(hostReadFileText(join(dir, 'package.json'))).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 收集源码文件：跳过 node_modules/lib/coverage 等目录与 *.spec.ts/*.test.ts、tests/。 */
function sourceFiles(dir, depth = 0, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || (depth > 0 && name === 'tests')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (depth < 12) sourceFiles(path, depth + 1, out)
    } else if (/\.(ts|mts|cts)$/.test(name) && !/\.(spec|test)\.ts$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** 扫描一段源码，把事件名收进 names（声明块 + 派发调用两个通道）。 */
function scanSource(source, names) {
  DECL_RE.lastIndex = 0
  let match
  while ((match = DECL_RE.exec(source)) !== null) {
    let index = DECL_RE.lastIndex - 1
    let depth = 0
    for (; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1
      else if (source[index] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    const block = source.slice(match.index, index)
    DECL_KEY_RE.lastIndex = 0
    let key
    while ((key = DECL_KEY_RE.exec(block)) !== null) names.add(key[1])
  }
  DISPATCH_RE.lastIndex = 0
  let dispatch
  while ((dispatch = DISPATCH_RE.exec(source)) !== null) names.add(dispatch[2])
}

/** 从参考源树取证事件清单（packages/ + vendor/ 等目录传入）。 */
export function extractFromSourceTree(dirs) {
  const names = new Set()
  for (const dir of dirs) {
    for (const file of sourceFiles(dir)) scanSource(readFileSync(file, 'utf8'), names)
  }
  return [...names].sort()
}

/** 从已安装宿主的 node_modules/@deepseek-ai/<pkg>/lib 取证（编译产物：.d.ts 声明 + .js 派发）。 */
export function extractFromInstalledHost(hostDir) {
  const base = join(hostDir, 'node_modules', '@deepseek-ai')
  const names = new Set()
  if (!hostExists(base)) return []
  for (const pkg of hostReaddir(base)) {
    const lib = join(base, pkg, 'lib')
    if (!hostExists(lib)) continue
    for (const file of listLib(lib)) scanSource(hostReadFileText(file), names)
  }
  return [...names].sort()
}

function listLib(dir, depth = 0, out = []) {
  for (const name of hostReaddir(dir)) {
    const path = join(dir, name)
    if (hostIsDir(path)) {
      if (depth < 4) listLib(path, depth + 1, out)
    } else if (/\.(d\.ts|js|mjs|cjs)$/.test(name)) out.push(path)
  }
  return out
}

/**
 * 在已装宿主的 node_modules/@deepseek-ai/<pkg>/lib 里找含某字面量的文件。
 *
 * 为什么不用固定包路径：宿主会重构实现（0.1.7-rc.2 把 cordis-plugin-hmr 换成了
 * dsh-hmr，旧路径直接消失），绑定包名/路径的取证源升级即失效。这里只绑定宿主公开的
 * 包命名空间 @deepseek-ai/* 的编译产物，包名怎么改都能重新找到 marker。
 * 返回 `@deepseek-ai/<pkg>/lib/<rel>` 坐标；空数组 = 宿主里不存在该字面量。
 */
export function findMarkerInInstalledHost(hostDir, marker) {
  const base = join(hostDir, 'node_modules', '@deepseek-ai')
  const hits = []
  if (!hostExists(base)) return hits
  for (const pkg of hostReaddir(base)) {
    const lib = join(base, pkg, 'lib')
    if (!hostExists(lib)) continue
    for (const file of listLib(lib)) {
      if (hostReadFileText(file).includes(marker)) hits.push(`@deepseek-ai/${pkg}/lib/${relative(lib, file)}`)
    }
  }
  return hits.sort()
}

/** 读冻结 fixture（两宿主事件清单 + 降级信号取证记录）。 */
export function readFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
}

/** 读冻结 fixture；缺失或损坏返回 null（不抛）。 */
function readFixtureOrNull() {
  try {
    return readFixture()
  } catch {
    return null
  }
}

const INSTALLED_SOURCE = '已安装宿主：node_modules/@deepseek-ai/*/lib 的 .d.ts 声明与 .js 派发'

/**
 * 重新取证并覆盖 fixture；返回新 fixture 内容（仅 CLI 使用）。
 *
 * 参考源缺失 = 硬错误（没有升级目标版本的坐标，写出来就是错的）。
 * 已装宿主缺失 = **降级**：保留上一次的 installed 段（宁可标注陈旧，也不伪造）。
 */
export function updateFixture(extra = {}) {
  const reference = referenceDir()
  if (reference === null) {
    throw new Error(`取证需要参考源在场（DSH_HARNESS_REF 或 ~/IdeaProjects/deepseek-harness）：${reference ?? '缺失'}`)
  }
  const installed = installedHostScanDir()
  // 显式传 null = 明确声明"没有历史 installed 段"（测试用）；未传则回落到冻结 fixture
  const previous = extra.previous !== undefined ? extra.previous : readFixtureOrNull()
  const installedBlock =
    installed !== null
      ? {
          version: versionOf(installed),
          source: INSTALLED_SOURCE,
          events: extractFromInstalledHost(installed),
        }
      : previous?.installed
  if (installedBlock === undefined || installedBlock === null || !Array.isArray(installedBlock.events)) {
    throw new Error(
      '没有可用的已安装宿主，也没有可保留的历史 installed 段：拒绝凭空生成"已装宿主事件清单"（会伪造取证结论）。' +
        '请安装宿主，或设置 DSH_INSTALLED_HOST / DSH_APP_RESOURCES 指向宿主树。',
    )
  }
  const fixture = {
    reference: {
      version: versionOf(reference),
      source: 'deepseek-harness 参考源：packages/ + vendor/ 的 interface Events 声明与 ctx.* 派发',
      events: extractFromSourceTree([join(reference, 'packages'), join(reference, 'vendor')]),
    },
    installed: installedBlock,
    fallbackEvidence: extra.fallbackEvidence ?? existingEvidence(),
  }
  writeFileSync(extra.fixturePath ?? FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`)
  return fixture
}

/** 已冻结的降级信号取证记录（fixture 首次生成时为空）。 */
function existingEvidence() {
  try {
    return readFixture().fallbackEvidence ?? {}
  } catch {
    return {}
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--update')) {
    const hadInstalledHost = installedHostScanDir() !== null
    const fixture = updateFixture()
    console.log(`已更新 ${FIXTURE_PATH}`)
    for (const [role, host] of Object.entries(fixture)) {
      if (role === 'fallbackEvidence') continue
      console.log(`  ${role} ${host.version}: ${host.events.length} 个事件`)
    }
    if (!hadInstalledHost) {
      console.log(
        `⚠️ 降级：未找到已安装宿主（npm 全局 / 桌面 App asar 均无）——只刷新了 reference 段，` +
          `installed 段原样保留 ${fixture.installed.version}。装好宿主或设 DSH_APP_RESOURCES 后重跑本命令。`,
      )
    }
    console.log('⚠️ fallbackEvidence 未自动更新：复核 src/events.ts 的 HOST_EVENT_FALLBACKS 是否与在场宿主一致')
  } else {
    const fixture = readFixture()
    for (const [role, host] of Object.entries(fixture)) {
      if (role === 'fallbackEvidence') continue
      console.log(`${role} ${host.version}: ${host.events.length} 个事件`)
    }
    const missing = fixture.installed.events.filter((event) => !fixture.reference.events.includes(event))
    console.log(`\n${fixture.installed.version} 有、${fixture.reference.version} 没有（升级会打穿监听的事件）：`)
    console.log(missing.map((event) => `  ${event}`).join('\n') || '  （无）')
  }
}
