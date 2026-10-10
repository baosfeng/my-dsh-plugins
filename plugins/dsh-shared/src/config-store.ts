/**
 * dsh-shared — 配置持久化（issue #27 配置可视化；由 dsh-my-notify /
 * dsh-task-reliability 的 lib/config-store.js 抽取合并，issue #45）。
 *
 * DSH 插件配置 = cordis loader patch 行的 `config` 字段。用户层 patch
 * 文件为 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（profile 层）与
 * `$DSH_HOME/cordis.patch.yml`（home 层）；DSH 的 watchUserPatches 通过
 * hmr.registerConfig 监听文件变化并热重载（无需重启）。
 *
 * 本模块把设置页保存的配置写入 profile 层 patch 文件：
 *  - 删除该行 id 的旧条目（行首 `- id: <rowId>` 到下一个顶层条目）；
 *  - 追加新条目（`- id: <rowId>` + `config:` 块，YAML 子集序列化）；
 *  - 原子写（tmp+rename），不破坏文件中的其他条目。
 *
 * 读取侧：extractConfig 解析 YAML 子集（布尔/整数/字符串/数组），供
 * 测试模拟「重启后 loader 重新解析 patch 文件」的闭环。
 */
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { ConfigValue, ConfigDict } from './types.js'

/** Profile 名：进程参数 --profile 优先，否则默认 web（与 dsh-my-plugin-manager 同契约）。 */
export function currentProfile(): string {
  const argv = process.argv
  const idx = argv.indexOf('--profile')
  if (idx !== -1 && typeof argv[idx + 1] === 'string' && argv[idx + 1] !== '') return argv[idx + 1]!
  return 'web'
}

/** Profile 目录：$DSH_HOME/profiles/<profile>（fallback ~/.dsh/profiles/…）。 */
export function profileDirOf(profile: string): string {
  const home = process.env.DSH_HOME
  const base = typeof home === 'string' && home !== '' ? `${home}/profiles` : `${homedir()}/.dsh/profiles`
  return join(base, profile)
}

/** 用户层 patch 文件路径（watchUserPatches 监听的 profile 层文件）。 */
export function patchFileOf(profile: string): string {
  return join(profileDirOf(profile), 'cordis.patch.yml')
}

// ── 读取：YAML 子集解析 ────────────────────────────────────────────────────

/** 从 patch 文件文本提取指定行 id 的 config 块；无条目/无 config 返回 undefined。 */
export function extractConfig(text: string, rowId: string): ConfigDict | undefined {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line === `- id: ${rowId}`)
  if (start === -1) return undefined
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!
    if (isTopLevelEntry(line)) break
    if (line === '  config:') return parseConfigBlock(lines, i + 1, 4)
  }
  return undefined
}

/** 子块解析栈帧：某缩进层级的容器对象。 */
interface ConfigFrame {
  indent: number
  target: ConfigDict
}

/**
 * 解析 config 块（`indent` 空格缩进的 `key: value` 行，直到缩进不足 / 顶层条目）。
 *
 * **嵌套支持**（纯增量）：值为空且后续行缩进更深 → 解析为子对象，例如
 *
 *     config:
 *       markdown:
 *         copyButton: true
 *
 * 扁平结构（值直接跟在冒号后）的行为与之前完全一致。两种结构可以混写
 * （合并后的 md-render 就依赖这一点：用户 profile 里的旧扁平键与新命名空间
 * 段共存，读回来都要能拿到）。
 */
/** 一行 config 子键的解析结果：缩进层级 + 键名 + 冒号后原文。 */
interface ConfigLine {
  depth: number
  key: string
  raw: string
}

/** 子键行匹配：缩进 + 键名 + 冒号（冒号后原文可能为空 = 无值键）。 */
const CONFIG_LINE_RE = /^( *)([A-Za-z0-9_]+):(.*)$/

/**
 * 从 `from` 起找**下一个有效行**并解析为子键；遇到块边界返回 null。
 *
 * 有效行 = 非空行、非注释行、非顶层条目、且能匹配子键行；顶层条目（`- ` 开头）
 * 与缩进不足由调用方按返回结果判定（本函数只负责「跳过噪声 + 解析」）。
 */
function nextConfigLine(lines: string[], from: number): ConfigLine | null {
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i]!
    if (line === '' || line.startsWith('#')) continue
    if (isTopLevelEntry(line)) return null
    const match = line.match(CONFIG_LINE_RE)
    if (match === null) continue
    return { depth: match[1]!.length, key: match[2]!, raw: match[3]! }
  }
  return null
}

/**
 * 无值键**只有**在「后面确实跟着更深缩进的子键」时才是嵌套段（命名空间）；
 * 否则按 YAML 它是空值（null）—— 本解析器一贯的既有语义是**跳过空值**
 * （见 parseYamlScalar 与 dsh-my-notify / dsh-task-reliability 的用例）。
 *
 * ⚠️ 防复发：3b3502d 曾在此**无条件**建空对象并入栈，破坏了「扁平行为不变」，
 * 让无值键变成空对象；本地又因 node_modules 里的陈旧 registry 副本遮蔽而看不见，
 * 直到 CI 才判红。判据与边界由 test/shared.mjs 的两个用例钉死。
 */
function hasChildBlock(lines: string[], from: number, depth: number, indent: number): boolean {
  const next = nextConfigLine(lines, from)
  if (next === null || next.depth < indent) return false
  return next.depth > depth
}

function parseConfigBlock(lines: string[], from: number, indent: number): ConfigDict {
  const root: ConfigDict = {}
  const stack: ConfigFrame[] = [{ indent: indent - 2, target: root }]
  for (let i = from; i < lines.length; i += 1) {
    const parsed = nextConfigLine(lines, i)
    if (parsed === null) break
    const { depth, key, raw } = parsed
    if (depth < indent) break
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= depth) stack.pop()
    const frame = stack[stack.length - 1]!
    if (raw.trim() === '') {
      if (!hasChildBlock(lines, i + 1, depth, indent)) continue
      const child: ConfigDict = {}
      frame.target[key] = child
      stack.push({ indent: depth, target: child })
      continue
    }
    const value = parseYamlScalar(raw)
    if (value !== undefined) frame.target[key] = value
  }
  return root
}

/** 解析 YAML 标量子集：布尔 / 整数 / 数组（flow）/ 引号字符串 / 裸字符串。 */
function parseYamlScalar(raw: string): ConfigValue | undefined {
  const value = raw.trim()
  if (value === '') return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (isNumeric(value)) return Number(value)
  if (isFlowArray(value)) return parseFlowArray(value)
  return parseStringScalar(value)
}

function isNumeric(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value)
}

function isFlowArray(value: string): boolean {
  return value.startsWith('[') && value.endsWith(']')
}

function parseFlowArray(value: string): ConfigValue[] {
  return value
    .slice(1, -1)
    .split(',')
    .map((item) => parseYamlScalar(item))
    .filter((item): item is ConfigValue => item !== undefined)
}

function parseStringScalar(value: string): string {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1)
  return value
}

// ── 写入：删除旧条目 + 追加新条目（原子写） ───────────────────────────────

/** 把 config 写入 patch 文件：删除同 id 旧条目，追加新条目，原子写。 */
export async function writePatchConfig(file: string, rowId: string, config: ConfigDict): Promise<void> {
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch {
    // first write: file does not exist yet
  }
  const lines = text.split('\n')
  const kept: string[] = []
  let i = 0
  while (i < lines.length) {
    if (isEntryStart(lines[i]!, rowId)) {
      // 跳过该条目：起始行 + 到下一个顶层条目之间的内容行
      i += 1
      while (i < lines.length && !isTopLevelEntry(lines[i]!)) i += 1
      continue
    }
    kept.push(lines[i]!)
    i += 1
  }
  const body = kept.join('\n').trimEnd()
  const entry = renderEntry(rowId, config)
  const next = body === '' ? entry : `${body}\n${entry}`
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await writeFile(tmp, next, 'utf8')
  await rename(tmp, file)
}

/** 该行是否为指定行 id 的顶层条目起始行。 */
function isEntryStart(line: string, rowId: string): boolean {
  return line === `- id: ${rowId}`
}

/** 顶层条目判断：行首 `- `（无缩进；嵌套 `- item` 有缩进，不算）。 */
function isTopLevelEntry(line: string): boolean {
  return line.startsWith('- ')
}

/** 渲染 `- id: <rowId>` + `config:` 块（YAML 子集序列化，支持嵌套对象）。 */
function renderEntry(rowId: string, config: ConfigDict): string {
  const lines = [`- id: ${rowId}`, '  config:']
  renderConfigLines(config, 4, lines)
  return lines.join('\n')
}

/** 递归渲染 config 行（嵌套对象 → 缩进子块；标量 → `key: value`）。 */
function renderConfigLines(config: ConfigDict, indent: number, lines: string[]): void {
  const pad = ' '.repeat(indent)
  for (const [key, value] of Object.entries(config)) {
    if (isPlainObject(value)) {
      lines.push(`${pad}${key}:`)
      renderConfigLines(value, indent + 2, lines)
      continue
    }
    lines.push(`${pad}${key}: ${yamlValue(value)}`)
  }
}

/** 是否为可递归渲染的普通对象（排除数组 / null）。 */
function isPlainObject(value: ConfigValue): value is ConfigDict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** YAML 标量序列化：字符串单引号（`'` → `''`），数组 flow 风格。 */
function yamlValue(value: ConfigValue): string {
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(yamlValue).join(', ')}]`
  return 'null'
}
