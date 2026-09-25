/**
 * host-session-events.mjs — 宿主「会话事件表」取证（本插件唯一订阅的宿主事件域）。
 *
 * 为什么需要它：cordis 的 `interface Events` **只是类型声明**，`ctx.on('<事件名>')`
 * 运行时不校验——宿主删掉/改名一个事件后，插件侧监听**静默失效**（不报错、不告警、
 * 不抛异常），计数永远是 0。所以事件名不能靠"自己 emit 一下"来验证，必须与宿主源码
 * 里的真实事件表比对。本脚本从官方参考源取证会话事件清单，冻结进
 * test/fixtures/host-session-events.json，由 test/host-event-contract.mjs 判定。
 *
 * 取证两个通道（任一通道命中即算事件存在）：
 *   ① 声明：`interface Events { 'x'(...): ... }` 内的字符串键
 *   ② 派发：`ctx.<emit|parallel|serial|bail|waterfall>('x', ...)` / 宿主内部的
 *      `collectSessionCallbacks(..., ['...', 'x', ...])` 之类字面量使用点
 *
 * 用法（更新 fixture 需要官方参考源在场）：
 *   node scripts/host-session-events.mjs            # 打印清单（不写文件）
 *   node scripts/host-session-events.mjs --update   # 重新取证并覆盖 fixture
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 冻结的会话事件清单（CI 无参考源时的唯一依据）。 */
const FIXTURE_PATH = join(PLUGIN_ROOT, 'test', 'fixtures', 'host-session-events.json')

/** 宿主会话事件域所在目录（相对参考源根）。 */
const SESSION_SOURCE_DIR = 'packages/core/session/src'

const DECL_RE = /interface Events\s*\{/g
const DECL_KEY_RE = /'([\w/-]+)'\s*[(:]/g
const DISPATCH_RE = /\b(?:ctx|context)\.(?:emit|parallel|serial|bail|waterfall)\(\s*(['"])([^'"]+)\1/g

/** 官方参考源目录（升级目标版本的源码），不存在返回 null。 */
export function referenceDir() {
  const dir = process.env.DSH_HARNESS_REF ?? join(homedir(), 'IdeaProjects', 'deepseek-harness')
  return existsSync(join(dir, 'package.json')) ? dir : null
}

/** 参考源 package.json 的 version（对不上 fixture 即要求重新取证）。 */
export function versionOf(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function sourceFiles(dir, depth = 0, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || (depth > 0 && name === 'tests')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (depth < 4) sourceFiles(path, depth + 1, out)
    } else if (/\.ts$/.test(name) && !/\.(spec|test)\.ts$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** 收事件名：声明块键 + 派发调用实参（两个通道）。 */
function scan(source, names) {
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

/** 从参考源取证会话事件清单；参考源缺该目录时返回 null（不能据此判定"不存在"）。 */
export function extractSessionEvents(reference) {
  const dir = join(reference, SESSION_SOURCE_DIR)
  if (!existsSync(dir)) return null
  const names = new Set()
  for (const file of sourceFiles(dir)) scan(readFileSync(file, 'utf8'), names)
  return [...names].sort()
}

/**
 * 事件在宿主源码里的**发出点**（声明行之外的逐字出现位置）。
 * 空数组 = 宿主只声明不派发（或根本不存在）→ 监听必然静默失效。
 */
export function dispatchSites(reference, event) {
  const dir = join(reference, SESSION_SOURCE_DIR)
  const sites = []
  if (!existsSync(dir)) return sites
  for (const file of sourceFiles(dir)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (!line.includes(`'${event}'`) && !line.includes(`"${event}"`)) return
        if (/^\s*'[\w/-]+'\s*\(/.test(line)) return // interface Events 声明行
        sites.push({ file: `${SESSION_SOURCE_DIR}/${file.slice(dir.length + 1)}`, line: index + 1, text: line.trim() })
      })
  }
  return sites
}

/** 读冻结 fixture。 */
export function readFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--update')) {
    const reference = referenceDir()
    if (reference === null)
      throw new Error('取证需要官方参考源在场（DSH_HARNESS_REF 或 ~/IdeaProjects/deepseek-harness）')
    const events = extractSessionEvents(reference)
    if (events === null) throw new Error(`参考源缺少 ${SESSION_SOURCE_DIR}：宿主会话事件域已迁移，需重新定位取证目录`)
    const fixture = {
      reference: {
        version: versionOf(reference),
        source: `${SESSION_SOURCE_DIR} 的 interface Events 声明与事件名派发字面量`,
        events,
      },
    }
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true })
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`)
    console.log(`已更新 ${FIXTURE_PATH}（${fixture.reference.version}：${events.length} 个事件）`)
  } else {
    const fixture = readFixture()
    console.log(
      `${fixture.reference.version} 会话事件表：\n${fixture.reference.events.map((e) => `  ${e}`).join('\n')}`,
    )
  }
}
