#!/usr/bin/env node
/**
 * TS 源码尺寸门禁 —— scripts/check-ts-size.mjs
 *
 * 背景（TS 全量迁移引入的门禁漏洞）：插件源码从手写 `lib/*.js` 变为
 * `src/**\/*.ts` 后，eslint.config.js（flat config）里没有任何 `.ts` 块
 * （typescript-eslint 尚不兼容 TS 7 原生编译器），`plugins/*​/src/**` 下
 * 全部 TS 文件逃过尺寸门禁——迁移前刻意压在 400 行上限的文件加了类型注解
 * 后超标（my-memory `view` 400→543、`store` 383→428…）却无人发现。
 *
 * 本脚本用 @babel/parser（纯 JS 实现、自带 TypeScript 语法支持）解析 TS AST，
 * 按 ESLint 内置规则的真实语义重新施加三项门禁：
 *
 *   | 规则                     | 阈值 | 语义（与 ESLint 对齐）                                        |
 *   | ------------------------ | ---- | ------------------------------------------------------------- |
 *   | max-lines                | ≤400 | 文件行数含空行与注释；文件末尾换行产生的空行不计（同 ESLint） |
 *   | max-lines-per-function   | ≤70  | `loc.end.line - loc.start.line + 1`；IIFE 不计（同 ESLint）   |
 *   | complexity               | ≤10  | 基础 1；每个分支/短路算子 +1；嵌套作用域独立算（同 code path）|
 *
 * 复杂度算子（与 eslint/lib/rules/complexity.js 的 visitor 一一对应，classic 变体）：
 *   IfStatement（含 `else if`）、ConditionalExpression（`?:`）、LogicalExpression
 *   （`&&`/`||`/`??`）、ForStatement、ForInStatement、ForOfStatement、WhileStatement、
 *   DoWhileStatement、CatchClause、AssignmentPattern（默认参数/解构默认值）、
 *   SwitchCase（仅有 test 的 case，`default` 不计）、AssignmentExpression（`&&=`/
 *   `||=`/`??=`）、MemberExpression/CallExpression（`optional === true`，即 `?.`）。
 *   嵌套函数、类字段初始化器、静态块各自是独立的 code path，内部的算子不累加到
 *   外层函数（同 ESLint），其自身复杂度一并检查。
 *
 * 冻结债务基线（`scripts/ts-size-baseline.json`）：迁移引入的存量超标项不阻塞
 * 发版，但被冻结——不超过基线记录值即通过（允许变好），基线之外的新增超标、
 * 或超过基线记录值的恶化一律失败。收口后用 `--update-baseline` 刷新。
 *
 * 用法：
 *   node scripts/check-ts-size.mjs                    # 门禁模式（默认）
 *   node scripts/check-ts-size.mjs --json             # 机器可读结果
 *   node scripts/check-ts-size.mjs --update-baseline  # 重新生成冻结债务基线
 *   node scripts/check-ts-size.mjs --root <dir> --baseline <file>   # 指定根/基线（测试用）
 *
 * 退出码：0 通过（可能带"基线可移除"提示）；1 门禁失败（新增超标 / 基线恶化）；
 *         2 工具错误（TS 解析失败、基线缺失或损坏、用法错误）——解析失败绝不静默跳过。
 */
import { parse } from '@babel/parser'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ------------------------------------------------------------------ *
 * 阈值与常量
 * ------------------------------------------------------------------ */

/** 与 eslint.config.js 的 complexity / max-lines / max-lines-per-function 保持一致。 */
export const THRESHOLDS = Object.freeze({ maxLines: 400, maxLinesPerFunction: 70, complexity: 10 })

/** 冻结债务基线的仓库内相对路径。 */
export const DEFAULT_BASELINE_PATH = 'scripts/ts-size-baseline.json'

/** 写进基线的说明（解释字段含义与刷新方式，避免读者误判）。 */
const BASELINE_NOTE =
  '冻结债务基线：只收录当前超标项。lines = 该文件当时行数（>400 表示文件行数超标被冻结；≤400 仅表示该条目承载下方函数债务）；functions.name = 超标函数（lines>70 或 complexity>10）。判定：不得超过记录值（可变小）；不在基线中的超标项一律失败。刷新：node scripts/check-ts-size.mjs --update-baseline'

/** 退出码约定。 */
export const EXIT = Object.freeze({ ok: 0, fail: 1, error: 2 })

/** 扫描时跳过的目录（构建产物/依赖）。 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.client-build'])

/** babel 节点上不参与子节点遍历的元数据属性。 */
const SKIP_KEYS = new Set([
  'loc',
  'start',
  'end',
  'range',
  'extra',
  'errors',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
])

/* ------------------------------------------------------------------ *
 * AST 遍历
 * ------------------------------------------------------------------ */

const isNode = (value) => value !== null && typeof value === 'object' && typeof value.type === 'string'

/** 取一个节点的子节点（跳过元数据属性）。 */
function childNodes(node) {
  const out = []
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item)
    } else if (isNode(value)) {
      out.push(value)
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 规则语义：阈值判定与复杂度算子
 * ------------------------------------------------------------------ */

/** ESLint complexity 中的逻辑赋值算子（短路行为）。 */
const LOGICAL_ASSIGN_OPS = new Set(['&&=', '||=', '??='])

/** `?.` 相关节点：babel 用 Optional* 类型表达，均按 `optional === true` 计数。 */
const OPTIONAL_CHAIN = (node) => (node.optional === true ? 1 : 0)

/**
 * ESLint complexity（classic 变体）算子表：节点类型 → 复杂度增量。
 * 对照 node_modules/eslint/lib/rules/complexity.js 的 visitor 逐条实现。
 */
const COMPLEXITY_OPS = {
  IfStatement: () => 1, // `else if` 是嵌套 IfStatement，自然再 +1
  ConditionalExpression: () => 1, // 三元 `?:`
  LogicalExpression: () => 1, // `&&` / `||` / `??`
  ForStatement: () => 1,
  ForInStatement: () => 1,
  ForOfStatement: () => 1,
  WhileStatement: () => 1,
  DoWhileStatement: () => 1,
  CatchClause: () => 1,
  AssignmentPattern: () => 1, // 默认参数、解构默认值
  SwitchCase: (node) => (node.test ? 1 : 0), // `default` 不计（同 ESLint）
  AssignmentExpression: (node) => (LOGICAL_ASSIGN_OPS.has(node.operator) ? 1 : 0),
  MemberExpression: OPTIONAL_CHAIN,
  OptionalMemberExpression: OPTIONAL_CHAIN,
  CallExpression: OPTIONAL_CHAIN,
  OptionalCallExpression: OPTIONAL_CHAIN,
}

/** 函数节点（max-lines-per-function 的作用对象，同 ESLint 的 visitor）。 */
const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassMethod',
  'ClassPrivateMethod',
  'ObjectMethod',
])

/** 类字段初始化器（ESLint 中 class field initializer 是独立 code path）。 */
const FIELD_TYPES = new Set(['ClassProperty', 'ClassPrivateProperty', 'ClassAccessorProperty', 'PropertyDefinition'])

const isFunctionNode = (node) => FUNCTION_TYPES.has(node.type)

/** 独立作用域边界：函数、类字段初始化器、静态块（内部算子不累加到外层）。 */
function isScopeBoundary(node) {
  return isFunctionNode(node) || FIELD_TYPES.has(node.type) || node.type === 'StaticBlock'
}

/** 某作用域的圈复杂度：基础 1 + 本作用域算子数（不含嵌套作用域）。 */
function scopeComplexity(boundary) {
  let complexity = 1
  const stack = childNodes(boundary)
  while (stack.length > 0) {
    const node = stack.pop()
    const op = COMPLEXITY_OPS[node.type]
    if (op) complexity += op(node)
    if (isScopeBoundary(node)) continue
    stack.push(...childNodes(node))
  }
  return complexity
}

/** 函数是否 IIFE：ESLint max-lines-per-function 默认（IIFEs: false）不检查。 */
function isIIFE(node, parent) {
  const callable = node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression'
  const isCallee =
    parent !== undefined &&
    (parent.type === 'CallExpression' || parent.type === 'OptionalCallExpression') &&
    parent.callee === node
  return callable && isCallee
}

/* ------------------------------------------------------------------ *
 * 命名（基线条目 key：稳定、可读、不随行号漂移）
 * ------------------------------------------------------------------ */

/** 有"头部名字"的节点类型：类方法 / 对象方法 / 类字段 / 静态块。 */
const HEAD_KINDS = {
  ClassMethod: 'class-method',
  ClassPrivateMethod: 'class-method',
  ObjectMethod: 'method',
  ClassProperty: 'field',
  ClassPrivateProperty: 'field',
  ClassAccessorProperty: 'field',
  PropertyDefinition: 'field',
  StaticBlock: 'static',
}

/** 最近的类名（用于 `ClassName.method` 形式的 key）。 */
function className(parents) {
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    const node = parents[i]
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') return node.id?.name ?? '<anonymous class>'
  }
  return null
}

/** 取属性名/方法名（Identifier、PrivateName、字符串/数字字面量）。 */
function keyName(node) {
  const key = node.key
  if (!key) return null
  if (typeof key.name === 'string') return key.name
  if (key.type === 'PrivateName') return key.id?.name ?? null
  if (typeof key.value === 'string' || typeof key.value === 'number') return String(key.value)
  return null
}

/** 赋值左值的可读名（`foo = function () {}` → foo）。 */
function assignTargetName(left) {
  if (!left) return null
  if (left.type === 'Identifier') return left.name
  if (left.type === 'MemberExpression' || left.type === 'OptionalMemberExpression') return keyName(left)
  return null
}

/** 由父节点推断匿名函数/箭头函数的名字。 */
const PARENT_NAME_KINDS = {
  VariableDeclarator: (parent) => parent.id?.name ?? null,
  AssignmentExpression: (parent) => assignTargetName(parent.left),
  ObjectProperty: (parent) => keyName(parent),
}

/** 方法/类字段/静态块等"自身带名字"的节点。 */
function headName(node, parents) {
  if (node.type === 'FunctionDeclaration') return node.id?.name ?? '<anonymous>'
  const kind = HEAD_KINDS[node.type]
  if (kind === 'static') return '<static block>'
  const key = keyName(node) ?? '<computed>'
  if (kind === 'method') return key // 对象方法不带类名前缀
  const owner = className(parents) ?? '<class>'
  if (kind === 'class-method') return `${owner}.${key}`
  if (kind === 'field') return `${owner}.${key} (field)`
  return null
}

/** 作用域边界的显示名（匿名函数以 <anonymous> 表示，同名按出现顺序加 #n）。 */
function describeName(node, parents) {
  const parent = parents.at(-1)
  const fromParent = PARENT_NAME_KINDS[parent?.type]?.(parent)
  return headName(node, parents) ?? node.id?.name ?? fromParent ?? '<anonymous>'
}

/* ------------------------------------------------------------------ *
 * 单文件分析
 * ------------------------------------------------------------------ */

/** 按 ESLint max-lines 语义统计行数（末尾换行不算一行，BOM 不算字符）。 */
export function countLines(text) {
  const lines = text.replace(/^\uFEFF/u, '').split(/\r\n|[\r\n\u2028\u2029]/u)
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return lines.length
}

/** 解析 TS 源码为 babel AST；失败时抛出带文件与位置的明确错误（绝不静默跳过）。 */
function parseSource(code, filePath) {
  try {
    return parse(code, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'decorators-legacy'],
      attachComment: false,
      errorRecovery: false,
    })
  } catch (error) {
    const at = error.loc ? `:${error.loc.line}:${error.loc.column + 1}` : ''
    throw new Error(`TS 解析失败 ${filePath}${at} — ${error.message}`)
  }
}

/** 收集所有作用域边界（按源码顺序）及其祖先链。 */
function collectBoundaries(program) {
  const found = []
  const stack = [{ node: program, parents: [] }]
  while (stack.length > 0) {
    const { node, parents } = stack.pop()
    if (node !== program && isScopeBoundary(node)) found.push({ node, parents })
    const nextParents = node === program ? [] : [...parents, node]
    for (const child of childNodes(node)) stack.push({ node: child, parents: nextParents })
  }
  return found.sort((a, b) => a.node.start - b.node.start)
}

/** 同文件内同名去重：第 2 个同名 → `name#2`。 */
function uniqueName(name, used) {
  const count = (used.get(name) ?? 0) + 1
  used.set(name, count)
  return count === 1 ? name : `${name}#${count}`
}

/** 分析一段 TS 源码：文件行数 + 各作用域（函数/类字段/静态块）的起始行、行数、复杂度。 */
export function analyzeSource(code, filePath = '<inline>') {
  const program = parseSource(code, filePath)
  const used = new Map()
  const functions = collectBoundaries(program).map(({ node, parents }) => {
    const parent = parents.at(-1)
    return {
      name: uniqueName(describeName(node, parents), used),
      kind: isFunctionNode(node) ? 'function' : node.type === 'StaticBlock' ? 'static-block' : 'field-initializer',
      line: node.loc.start.line,
      endLine: node.loc.end.line,
      // 与 ESLint max-lines-per-function 一致：loc 跨度（方法含 static/async 等修饰符）
      lines: node.loc.end.line - node.loc.start.line + 1,
      // IIFE 与类字段/静态块不做行数检查（同 ESLint）
      checkLines: isFunctionNode(node) && !isIIFE(node, parent),
      complexity: scopeComplexity(node),
    }
  })
  return { filePath, lines: countLines(code), functions }
}

/* ------------------------------------------------------------------ *
 * 仓库扫描
 * ------------------------------------------------------------------ */

/** 递归收集 plugins/&lt;name&gt;/src 下的 .ts / .tsx 文件（排序保证输出稳定）。 */
export function findTsFiles(pluginsDir) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name))
      } else if (/\.tsx?$/u.test(entry.name)) {
        out.push(join(dir, entry.name))
      }
    }
  }
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    const srcDir = entry.isDirectory() ? join(pluginsDir, entry.name, 'src') : null
    if (srcDir && existsSync(srcDir)) walk(srcDir)
  }
  return out.sort()
}

/** 扫描整个仓库：返回每个文件的分析结果与解析失败列表。 */
export function analyzeRepo(root) {
  const files = []
  const parseErrors = []
  for (const absolute of findTsFiles(join(root, 'plugins'))) {
    const filePath = relative(root, absolute).split(sep).join('/')
    try {
      files.push(analyzeSource(readFileSync(absolute, 'utf8'), filePath))
    } catch (error) {
      parseErrors.push({ filePath, message: error.message })
    }
  }
  return { root, files, parseErrors }
}

/* ------------------------------------------------------------------ *
 * 冻结债务基线
 * ------------------------------------------------------------------ */

const overFunctionLines = (fn) => fn.checkLines && fn.lines > THRESHOLDS.maxLinesPerFunction
const overComplexity = (fn) => fn.complexity > THRESHOLDS.complexity
const overThreshold = (fn) => overFunctionLines(fn) || overComplexity(fn)

/** 生成基线内容：只收录当前超标的文件与函数（冻结债务快照）。 */
export function buildBaseline(report) {
  const files = {}
  for (const file of [...report.files].sort((a, b) => a.filePath.localeCompare(b.filePath))) {
    const functions = {}
    for (const fn of file.functions) {
      if (overThreshold(fn)) functions[fn.name] = { line: fn.line, lines: fn.lines, complexity: fn.complexity }
    }
    if (file.lines > THRESHOLDS.maxLines || Object.keys(functions).length > 0) {
      files[file.filePath] = { lines: file.lines, functions }
    }
  }
  return { note: BASELINE_NOTE, thresholds: { ...THRESHOLDS }, files }
}

/** 加载基线；缺失/损坏/阈值不匹配一律抛出明确错误。 */
export function loadBaseline(baselinePath) {
  if (!existsSync(baselinePath)) {
    throw new Error(
      `基线文件不存在：${baselinePath}（首次使用请先运行 node scripts/check-ts-size.mjs --update-baseline）`,
    )
  }
  let data
  try {
    data = JSON.parse(readFileSync(baselinePath, 'utf8'))
  } catch (error) {
    throw new Error(`基线文件解析失败：${baselinePath} — ${error.message}`)
  }
  if (!data || typeof data !== 'object' || typeof data.files !== 'object' || data.files === null) {
    throw new Error(`基线文件结构非法（缺少 files 字段）：${baselinePath}`)
  }
  if (data.thresholds) {
    const mismatch = Object.entries(THRESHOLDS).filter(([key, value]) => data.thresholds[key] !== value)
    if (mismatch.length > 0) {
      throw new Error(
        `基线阈值与脚本不一致（${mismatch.map(([key, value]) => `${key}: 基线 ${data.thresholds[key]} vs 脚本 ${value}`).join('；')}），请重跑 --update-baseline`,
      )
    }
  }
  return data
}

/** 序列化基线（2 空格缩进 + 末尾换行，与 prettier 输出一致）。 */
export function serializeBaseline(baseline) {
  return `${JSON.stringify(baseline, null, 2)}\n`
}

/* ------------------------------------------------------------------ *
 * 门禁判定
 * ------------------------------------------------------------------ */

function violation(kind, filePath, fn, actual, threshold, baseline) {
  return {
    kind,
    file: filePath,
    line: fn ? fn.line : null,
    name: fn ? fn.name : null,
    actual,
    threshold,
    baseline: baseline ?? null,
  }
}

/** 按"超标才比较基线"的方式判定一项指标：新增 / 恶化。 */
function pushMetric(out, kind, filePath, fn, actual, threshold, baseValue) {
  if (baseValue === undefined) out.added.push(violation(kind, filePath, fn, actual, threshold))
  else if (actual > baseValue) out.worsened.push(violation(kind, filePath, fn, actual, threshold, baseValue))
}

/**
 * 文件级判定。基线只收录超标项，因此 `base.lines > 阈值` ⇔ 该文件行数在基线中被冻结；
 * 文件条目仅承载函数债务（lines ≤ 阈值）时，文件行数本身不参与判定，也就不提示可移除。
 */
function checkFileLines(file, base, out) {
  const frozen = base?.lines !== undefined && base.lines > THRESHOLDS.maxLines
  if (file.lines > THRESHOLDS.maxLines) {
    pushMetric(out, 'file-lines', file.filePath, null, file.lines, THRESHOLDS.maxLines, frozen ? base.lines : undefined)
  } else if (frozen) {
    out.removable.push({
      kind: 'file',
      reason: '已降到阈值内',
      file: file.filePath,
      line: null,
      name: null,
      actual: { lines: file.lines },
      baseline: { lines: base.lines },
    })
  }
}

/** 函数级：函数行数 / 复杂度按基线条目逐项判定。 */
function checkFileFunctions(file, base, out) {
  for (const fn of file.functions) {
    const baseFn = base?.functions?.[fn.name]
    if (overFunctionLines(fn)) {
      pushMetric(out, 'function-lines', file.filePath, fn, fn.lines, THRESHOLDS.maxLinesPerFunction, baseFn?.lines)
    }
    if (overComplexity(fn)) {
      pushMetric(out, 'complexity', file.filePath, fn, fn.complexity, THRESHOLDS.complexity, baseFn?.complexity)
    }
  }
}

/** 单条函数基线的可移除判定（已达标 / 已消失）。 */
function staleFunction(out, filePath, name, baseFn, file) {
  const fn = file.functions.find((item) => item.name === name)
  if (fn && overThreshold(fn)) return
  out.removable.push({
    kind: 'function',
    reason: fn ? '已降到阈值内' : '基线项已不存在（函数已删除或重命名）',
    file: filePath,
    line: fn ? fn.line : baseFn.line,
    name,
    actual: fn ? { lines: fn.lines, complexity: fn.complexity } : null,
    baseline: { lines: baseFn.lines ?? null, complexity: baseFn.complexity ?? null },
  })
}

/** 基线中已达标或已消失的条目 → 提示可移除（不失败）。 */
function collectStale(report, baseline, out) {
  const byPath = new Map(report.files.map((file) => [file.filePath, file]))
  for (const [filePath, base] of Object.entries(baseline.files)) {
    const file = byPath.get(filePath)
    if (!file) {
      out.removable.push({
        kind: 'file',
        reason: '基线项已不存在（文件已删除或重命名）',
        file: filePath,
        line: null,
        name: null,
        actual: null,
        baseline: { lines: base.lines },
      })
      continue
    }
    for (const [name, baseFn] of Object.entries(base.functions ?? {})) staleFunction(out, filePath, name, baseFn, file)
  }
}

/** 与基线比对：返回 { added, worsened, removable, ok }。 */
export function diffAgainstBaseline(report, baseline) {
  const out = { added: [], worsened: [], removable: [] }
  const { files = {} } = baseline
  for (const file of report.files) {
    const base = files[file.filePath]
    checkFileLines(file, base, out)
    checkFileFunctions(file, base, out)
  }
  collectStale(report, baseline, out)
  return { ...out, ok: out.added.length === 0 && out.worsened.length === 0 }
}

/** 汇总计数：当前超标文件数 / 函数行数超标数 / 复杂度超标数 / 基线条目数。 */
export function summarize(report, baseline) {
  const files = report.files.filter((file) => file.lines > THRESHOLDS.maxLines).length
  const functions = report.files.flatMap((file) => file.functions)
  const baselineFiles = baseline ? Object.keys(baseline.files).length : 0
  const baselineFunctions = baseline
    ? Object.values(baseline.files).reduce((sum, file) => sum + Object.keys(file.functions ?? {}).length, 0)
    : 0
  return {
    scannedFiles: report.files.length,
    overFileLines: files,
    overFunctionLines: functions.filter(overFunctionLines).length,
    overComplexity: functions.filter(overComplexity).length,
    baselineFiles,
    baselineFunctions,
  }
}

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */

const METRIC_LABEL = {
  'file-lines': '文件行数',
  'function-lines': '函数行数',
  complexity: '圈复杂度',
}

function formatViolation(item) {
  const where = `${item.file}${item.line ? `:${item.line}` : ''}`
  const who = item.name ? ` 函数 ${item.name}` : ''
  const base = item.baseline === null ? '' : `（基线 ${item.baseline}）`
  return `  ${where}${who}：${METRIC_LABEL[item.kind]} ${item.actual} > ${item.threshold}${base}`
}

function formatRemovable(item) {
  const where = `${item.file}${item.line ? `:${item.line}` : ''}`
  const who = item.name ? ` 函数 ${item.name}` : ''
  const base = Object.entries(item.baseline)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
  return `  ${where}${who}：${item.reason}（基线 ${base}）`
}

function formatText(report, baseline, diff) {
  const stats = summarize(report, baseline)
  const lines = [
    'TS 尺寸门禁（scripts/check-ts-size.mjs）',
    `阈值：文件 ≤ ${THRESHOLDS.maxLines} 行 / 函数 ≤ ${THRESHOLDS.maxLinesPerFunction} 行 / 圈复杂度 ≤ ${THRESHOLDS.complexity}`,
    `扫描：${stats.scannedFiles} 个 TS 文件（plugins/*/src/**/*.ts）`,
    '',
  ]
  if (diff.added.length > 0) {
    lines.push(`❌ 新增超标（不在基线）：${diff.added.length} 项`, ...diff.added.map(formatViolation), '')
  }
  if (diff.worsened.length > 0) {
    lines.push(`❌ 基线恶化（超过冻结值）：${diff.worsened.length} 项`, ...diff.worsened.map(formatViolation), '')
  }
  if (diff.removable.length > 0) {
    lines.push(`ℹ️  基线可移除：${diff.removable.length} 项（不影响门禁）`, ...diff.removable.map(formatRemovable), '')
  }
  lines.push(
    `当前超标：文件行数 ${stats.overFileLines} · 函数行数 ${stats.overFunctionLines} · 圈复杂度 ${stats.overComplexity}`,
    `冻结债务基线：${stats.baselineFiles} 个文件 / ${stats.baselineFunctions} 个函数（scripts/ts-size-baseline.json）`,
  )
  lines.push(
    diff.ok
      ? `✅ TS 尺寸门禁通过：无新增超标、无基线恶化`
      : `❌ TS 尺寸门禁失败：新增 ${diff.added.length} 项 / 恶化 ${diff.worsened.length} 项（拆小文件或在有意为之的情况下重跑 --update-baseline）`,
  )
  return lines.join('\n')
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const USAGE = `用法：node scripts/check-ts-size.mjs [选项]

  （无参数）          门禁模式：新增超标 / 基线恶化 → exit 1
  --update-baseline   重新生成 scripts/ts-size-baseline.json（收口后刷新）
  --json              输出机器可读 JSON
  --root <dir>        仓库根目录（默认当前工作目录）
  --baseline <file>   基线文件路径（默认 <root>/scripts/ts-size-baseline.json）
  -h, --help          显示本帮助`

/** 解析命令行参数；未知参数抛错（exit 2）。 */
export function parseArgs(argv) {
  const opts = { updateBaseline: false, json: false, help: false, root: process.cwd(), baseline: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--update-baseline') opts.updateBaseline = true
    else if (arg === '--json') opts.json = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--root') opts.root = resolve(argv[(i += 1)] ?? '.')
    else if (arg === '--baseline') opts.baseline = resolve(argv[(i += 1)] ?? '')
    else throw new Error(`未知参数：${arg}\n\n${USAGE}`)
  }
  return opts
}

/** 解析失败：显式报错（不静默跳过），返回工具错误退出码。 */
function reportParseErrors(report) {
  console.error('❌ TS 尺寸门禁无法完成：以下文件解析失败（不静默跳过）')
  for (const item of report.parseErrors) console.error(`  ${item.message}`)
  return EXIT.error
}

/** --update-baseline：重新生成冻结债务基线。 */
function writeBaseline(opts, baselinePath, report) {
  const baseline = buildBaseline(report)
  mkdirSync(dirname(baselinePath), { recursive: true })
  writeFileSync(baselinePath, serializeBaseline(baseline))
  const files = Object.keys(baseline.files).length
  const functions = Object.values(baseline.files).reduce((sum, file) => sum + Object.keys(file.functions).length, 0)
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          updated: baselinePath,
          scannedFiles: report.files.length,
          baselineFiles: files,
          baselineFunctions: functions,
        },
        null,
        2,
      ),
    )
  } else {
    console.log(
      `✅ 已更新冻结债务基线：${baselinePath}\n   扫描 ${report.files.length} 个文件；收录 ${files} 个超标文件 / ${functions} 个超标函数`,
    )
  }
  return EXIT.ok
}

/** --json 的机器可读结果。 */
function jsonReport(report, baseline, diff) {
  return JSON.stringify({ ok: diff.ok, thresholds: THRESHOLDS, stats: summarize(report, baseline), ...diff }, null, 2)
}

/** 门禁主流程；返回退出码。 */
export function run(argv) {
  const opts = parseArgs(argv)
  if (opts.help) {
    console.log(USAGE)
    return EXIT.ok
  }
  const baselinePath = opts.baseline ?? join(opts.root, DEFAULT_BASELINE_PATH)
  const report = analyzeRepo(opts.root)
  if (report.parseErrors.length > 0) return reportParseErrors(report)
  if (opts.updateBaseline) return writeBaseline(opts, baselinePath, report)

  const baseline = loadBaseline(baselinePath)
  const diff = diffAgainstBaseline(report, baseline)
  console.log(opts.json ? jsonReport(report, baseline, diff) : formatText(report, baseline, diff))
  return diff.ok ? EXIT.ok : EXIT.fail
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  try {
    process.exitCode = run(process.argv.slice(2))
  } catch (error) {
    console.error(`❌ TS 尺寸门禁执行失败：${error.message}`)
    process.exitCode = EXIT.error
  }
}
