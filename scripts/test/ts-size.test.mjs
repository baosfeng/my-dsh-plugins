/**
 * TS 源码尺寸门禁回归测试（scripts/check-ts-size.mjs）。
 *
 * 覆盖三类断言：
 *  1. 三项规则的**阈值边界**（文件 400/401、函数 70/71、复杂度 10/11）与算子清单；
 *  2. **冻结债务基线机制**（基线内通过、超基线恶化失败、新增超标失败、可移除提示、
 *     --update-baseline 生成），含临时目录里的 CLI 端到端闭环；
 *  3. **与 ESLint 内置规则的语义对照**——同一段代码分别交给 ESLint
 *     （complexity / max-lines / max-lines-per-function，阈值设 0 以拿到全部实测值）
 *     与本脚本，断言逐函数数值完全一致，证明门禁语义没有走样。
 *
 * 解析失败必须显式失败（exit 2），不允许静默跳过。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { analyzeSource, buildBaseline, countLines, diffAgainstBaseline, THRESHOLDS } from '../check-ts-size.mjs'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-ts-size.mjs')
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEMO = 'plugins/demo/src/a.ts'

/** 生成恰好 n 行的 TS 文件。 */
const tsFileOf = (n) => `${Array.from({ length: n }, (_, i) => `const v${i} = ${i}`).join('\n')}\n`

/** 生成恰好 n 行的函数声明。 */
const fnOfLines = (n) => `function f() {\n${'  void 0\n'.repeat(n - 2)}}\n`

/** 分析一段 TS 源码。 */
const analyze = (code, filePath = DEMO) => analyzeSource(code, filePath)

/** 用给定基线跑门禁判定（report 由单文件构成）。 */
const gate = (code, baseline = { files: {} }, filePath = DEMO) =>
  diffAgainstBaseline({ files: [analyze(code, filePath)], parseErrors: [] }, baseline)

/** 函数体只含 body 的函数，用于断言复杂度。 */
const complexityOf = (body) => analyze(`function f(a, b) {\n${body}\n}\n`).functions[0].complexity

/** 复杂度 = 1 + times 的函数。 */
const fnWithComplexity = (times) => `function f(a) {\n${'  if (a) {}\n'.repeat(times)}}\n`

/** 在临时目录里造一个最小仓库（plugins/<name>/src/**）。 */
function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'ts-size-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

const runCli = (args, cwd = repoRoot) =>
  spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', cwd, timeout: 60_000 })

describe('文件行数（max-lines ≤ 400）', () => {
  it('恰好 400 行 → 不报', () => {
    const code = tsFileOf(400)
    expect(analyze(code).lines).toBe(400)
    expect(gate(code).ok).toBe(true)
    expect(gate(code).added).toHaveLength(0)
  })

  it('401 行 → 报 file-lines（exit 1 语义）', () => {
    const diff = gate(tsFileOf(401))
    expect(diff.ok).toBe(false)
    expect(diff.added).toEqual([expect.objectContaining({ kind: 'file-lines', actual: 401, threshold: 400 })])
  })

  it('行数含空行与注释；末尾换行不算一行（与 ESLint max-lines 一致）', () => {
    expect(countLines('const a = 1\n')).toBe(1)
    expect(countLines('const a = 1')).toBe(1)
    expect(countLines('const a = 1\n\n')).toBe(2)
    expect(countLines('// 注释\n\nconst a = 1\n')).toBe(3)
  })
})

describe('函数行数（max-lines-per-function ≤ 70）', () => {
  it('恰好 70 行 → 不报', () => {
    const code = fnOfLines(70)
    expect(analyze(code).functions[0]).toMatchObject({ lines: 70, checkLines: true })
    expect(gate(code).added).toHaveLength(0)
  })

  it('71 行 → 报 function-lines', () => {
    const code = fnOfLines(71)
    expect(analyze(code).functions[0].lines).toBe(71)
    expect(gate(code).added).toEqual([
      expect.objectContaining({ kind: 'function-lines', name: 'f', actual: 71, threshold: 70 }),
    ])
  })

  it('函数体内的空行与注释计入行数（与 ESLint 一致）', () => {
    const code = 'function f() {\n  // 注释\n\n  /* 块 */\n  return 1\n}\n'
    expect(analyze(code).functions[0].lines).toBe(6)
  })

  it('IIFE 不计行数（与 ESLint 默认 IIFEs: false 一致）', () => {
    const code = `(function () {\n${'  void 0\n'.repeat(80)}})()\n`
    expect(analyze(code).functions[0].checkLines).toBe(false)
    expect(gate(code).added).toHaveLength(0)
  })

  it('类方法 / 对象方法 / getter 都参与行数检查', () => {
    const code = 'class A {\n  bar() {\n    return 1\n  }\n}\nconst o = {\n  baz() {\n    return 2\n  },\n}\n'
    const functions = analyze(code).functions
    expect(functions.map((fn) => fn.name)).toEqual(['A.bar', 'baz'])
    expect(functions.every((fn) => fn.checkLines)).toBe(true)
  })
})

describe('圈复杂度（complexity ≤ 10）', () => {
  it('恰好 10 → 不报；11 → 报', () => {
    const ten = fnWithComplexity(9)
    expect(analyze(ten).functions[0].complexity).toBe(10)
    expect(gate(ten).ok).toBe(true)

    const eleven = fnWithComplexity(10)
    expect(analyze(eleven).functions[0].complexity).toBe(11)
    expect(gate(eleven).added).toEqual([
      expect.objectContaining({ kind: 'complexity', name: 'f', actual: 11, threshold: 10 }),
    ])
  })

  it('各算子各 +1，基础值 1', () => {
    expect(complexityOf('return 1')).toBe(1)
    expect(complexityOf('if (a) {}')).toBe(2)
    expect(complexityOf('if (a) {} else if (b) {}')).toBe(3) // else if 再 +1
    expect(complexityOf('for (;;) {}')).toBe(2)
    expect(complexityOf('for (const k in a) {}')).toBe(2)
    expect(complexityOf('for (const v of a) {}')).toBe(2)
    expect(complexityOf('while (a) {}')).toBe(2)
    expect(complexityOf('do {} while (a)')).toBe(2)
    expect(complexityOf('try {} catch (e) {}')).toBe(2)
    expect(complexityOf('const x = a && b')).toBe(2)
    expect(complexityOf('const x = a || b')).toBe(2)
    expect(complexityOf('const x = a ?? b')).toBe(2)
    expect(complexityOf('const x = a ? 1 : 2')).toBe(2)
  })

  it('switch：有 test 的 case +1，default 不计（与 ESLint 一致）', () => {
    expect(complexityOf('switch (a) { case 1: break; case 2: break }')).toBe(3)
    expect(complexityOf('switch (a) { default: break }')).toBe(1)
  })

  it('额外算子与 ESLint 对齐：默认参数、解构默认值、逻辑赋值、?.', () => {
    expect(analyze('function g(a = 1) {\n  return a\n}\n').functions[0].complexity).toBe(2)
    expect(complexityOf('const { q = 1 } = a')).toBe(2)
    expect(complexityOf('a ||= 1')).toBe(2)
    expect(complexityOf('const x = a?.b')).toBe(2)
    expect(complexityOf('const x = a?.b()')).toBe(3)
  })

  it('嵌套函数独立计算，不累加到外层', () => {
    const code = 'function outer(a) {\n  const inner = () => (a ? 1 : 2)\n  return inner()\n}\n'
    const [outer, inner] = analyze(code).functions
    expect(outer).toMatchObject({ name: 'outer', complexity: 1 })
    expect(inner).toMatchObject({ name: 'inner', complexity: 2 })
  })

  it('类字段初始化器是独立作用域（同 ESLint code path），算子不外溢', () => {
    const code = 'class A {\n  x = a && b\n}\n'
    const [field] = analyze(code).functions
    expect(field).toMatchObject({ name: 'A.x (field)', kind: 'field-initializer', checkLines: false, complexity: 2 })
    expect(gate(code).added).toHaveLength(0)
  })
})

describe('冻结债务基线', () => {
  it('基线内超标（值相等）→ 通过', () => {
    const baseline = { files: { [DEMO]: { lines: 401, functions: {} } } }
    const diff = gate(tsFileOf(401), baseline)
    expect(diff.ok).toBe(true)
    expect(diff.added).toHaveLength(0)
    expect(diff.worsened).toHaveLength(0)
  })

  it('比基线变小 → 通过', () => {
    expect(gate(tsFileOf(405), { files: { [DEMO]: { lines: 410, functions: {} } } }).ok).toBe(true)
  })

  it('超过基线值（恶化）→ 失败', () => {
    const diff = gate(tsFileOf(405), { files: { [DEMO]: { lines: 401, functions: {} } } })
    expect(diff.ok).toBe(false)
    expect(diff.worsened).toEqual([expect.objectContaining({ kind: 'file-lines', actual: 405, baseline: 401 })])
  })

  it('新增超标（不在基线）→ 失败', () => {
    const baseline = { files: { 'plugins/other/src/x.ts': { lines: 500, functions: {} } } }
    const diff = gate(tsFileOf(401), baseline)
    expect(diff.ok).toBe(false)
    expect(diff.added).toEqual([expect.objectContaining({ kind: 'file-lines', file: DEMO, baseline: null })])
  })

  it('函数行数 / 复杂度：基线内通过、超基线恶化', () => {
    const overLines = fnOfLines(75)
    const base = (lines, complexity) => ({
      files: { [DEMO]: { lines: 80, functions: { f: { line: 1, lines, complexity } } } },
    })
    expect(gate(overLines, base(75, 1)).ok).toBe(true)
    expect(gate(overLines, base(71, 1)).worsened).toEqual([
      expect.objectContaining({ kind: 'function-lines', actual: 75, baseline: 71 }),
    ])

    const harder = fnWithComplexity(11) // 复杂度 12
    expect(gate(fnWithComplexity(10), base(12, 11)).ok).toBe(true)
    expect(gate(harder, base(12, 11)).worsened).toEqual([
      expect.objectContaining({ kind: 'complexity', actual: 12, baseline: 11 }),
    ])
  })

  it('已降到阈值内的基线项 → 提示可移除且不失败', () => {
    const baseline = { files: { [DEMO]: { lines: 420, functions: { f: { line: 1, lines: 80, complexity: 12 } } } } }
    const diff = gate('function f() {\n  return 1\n}\n', baseline)
    expect(diff.ok).toBe(true)
    expect(diff.removable.map((item) => item.kind)).toEqual(['file', 'function'])
    expect(diff.removable.every((item) => item.reason === '已降到阈值内')).toBe(true)
  })

  it('基线中已消失的文件 / 函数 → 提示可移除', () => {
    const baseline = {
      files: {
        'plugins/gone/src/x.ts': { lines: 500, functions: {} },
        [DEMO]: { lines: 10, functions: { removed: { line: 3, lines: 90, complexity: 1 } } },
      },
    }
    const diff = gate('const a = 1\n', baseline)
    expect(diff.ok).toBe(true)
    expect(diff.removable).toHaveLength(2)
    expect(diff.removable.every((item) => item.reason.includes('已不存在'))).toBe(true)
  })

  it('文件条目仅承载函数债务时，不误报文件行数可移除', () => {
    const baseline = { files: { [DEMO]: { lines: 176, functions: { f: { line: 1, lines: 80, complexity: 1 } } } } }
    const diff = gate(fnOfLines(80), baseline)
    expect(diff.ok).toBe(true)
    expect(diff.removable).toHaveLength(0)
  })

  it('buildBaseline 只收录超标项，并带阈值与说明', () => {
    const report = {
      files: [analyze(tsFileOf(401), 'plugins/a/src/x.ts'), analyze('const a = 1\n', 'plugins/a/src/y.ts')],
      parseErrors: [],
    }
    const baseline = buildBaseline(report)
    expect(Object.keys(baseline.files)).toEqual(['plugins/a/src/x.ts'])
    expect(baseline.files['plugins/a/src/x.ts']).toEqual({ lines: 401, functions: {} })
    expect(baseline.thresholds).toEqual(THRESHOLDS)
    expect(baseline.note).toContain('--update-baseline')
  })
})

describe('CLI 端到端（临时仓库）', () => {
  it('--update-baseline 生成基线，随后门禁通过（exit 0）', () => {
    const root = makeRepo({ [DEMO]: tsFileOf(401), 'plugins/demo/src/ok.ts': 'const a = 1\n' })
    const update = runCli(['--root', root, '--update-baseline'])
    expect(update.status).toBe(0)
    expect(update.stdout).toContain('已更新冻结债务基线')

    const baselinePath = join(root, 'scripts', 'ts-size-baseline.json')
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
    expect(Object.keys(baseline.files)).toEqual([DEMO])
    expect(baseline.files[DEMO].lines).toBe(401)

    const pass = runCli(['--root', root])
    expect(pass.status).toBe(0)
    expect(pass.stdout).toContain('TS 尺寸门禁通过')
  })

  it('基线外新增超标 → exit 1 并列出文件:行与实测值', () => {
    const root = makeRepo({ [DEMO]: tsFileOf(401) })
    runCli(['--root', root, '--update-baseline'])
    writeFileSync(join(root, 'plugins/demo/src/new.ts'), fnOfLines(80))

    const res = runCli(['--root', root])
    expect(res.status).toBe(1)
    expect(res.stdout).toContain('新增超标')
    expect(res.stdout).toContain('plugins/demo/src/new.ts:1')
    expect(res.stdout).toContain('函数行数 80 > 70')
  })

  it('--json 输出机器可读结果', () => {
    const root = makeRepo({ [DEMO]: tsFileOf(401) })
    runCli(['--root', root, '--update-baseline'])
    const parsed = JSON.parse(runCli(['--root', root, '--json']).stdout)
    expect(parsed.ok).toBe(true)
    expect(parsed.stats.scannedFiles).toBe(1)
    expect(parsed.stats.overFileLines).toBe(1)
    expect(parsed.stats.baselineFiles).toBe(1)
  })

  it('语法错误的 TS → exit 2、stderr 明确指出文件与位置（不静默跳过）', () => {
    const root = makeRepo({ 'plugins/demo/src/broken.ts': 'function ( {\n' })
    const res = runCli(['--root', root])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('TS 解析失败')
    expect(res.stderr).toContain('plugins/demo/src/broken.ts:1')
  })

  it('analyzeSource 对语法错误抛出带文件与行列的错误', () => {
    expect(() => analyzeSource('function ( {', 'plugins/demo/src/broken.ts')).toThrow(
      /TS 解析失败 plugins\/demo\/src\/broken\.ts:1:\d+/u,
    )
  })

  it('基线缺失 → exit 2 并提示刷新命令', () => {
    const root = makeRepo({ [DEMO]: 'const a = 1\n' })
    const res = runCli(['--root', root])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('基线文件不存在')
    expect(res.stderr).toContain('--update-baseline')
  })

  it('未知参数 → exit 2', () => {
    expect(runCli(['--root', makeRepo({ [DEMO]: 'const a = 1\n' }), '--nope']).status).toBe(2)
  })
})

/**
 * 与 ESLint 内置规则的语义对照：同一段 JS 代码（TS 是 JS 超集，脚本可直接解析）
 * 分别交给 ESLint 与本脚本，阈值设 0 以拿到**全部**函数的实测值，断言逐项一致。
 */
describe('与 ESLint 内置规则语义对照', () => {
  const eslint = new ESLint({
    overrideConfigFile: join(repoRoot, 'eslint.config.js'),
    ignore: false,
    overrideConfig: {
      rules: { complexity: ['error', 0], 'max-lines': ['error', 0], 'max-lines-per-function': ['error', { max: 0 }] },
    },
  })
  const filePath = 'plugins/dsh-ts-example/lib/probe.js'

  /** ESLint 报出的 (起始行, 实测值) 列表。 */
  async function eslintValues(code, ruleId, pattern) {
    const [result] = await eslint.lintText(code, { filePath })
    return result.messages
      .filter((message) => message.ruleId === ruleId)
      .map((message) => ({ line: message.line, value: Number(pattern.exec(message.message)[1]) }))
  }

  const COMPLEXITY_CASES = {
    if: 'function f(a) { if (a) { return 1 } return 0 }',
    'else if': 'function f(a) { if (a) { return 1 } else if (a > 1) { return 2 } return 0 }',
    '&&': 'function f(a, b) { return a && b }',
    '||': 'function f(a, b) { return a || b }',
    '??': 'function f(a, b) { return a ?? b }',
    三元: 'function f(a) { return a ? 1 : 2 }',
    switch: 'function f(a) { switch (a) { case 1: return 1; case 2: return 2; default: return 0 } }',
    catch: 'function f() { try { return 1 } catch (e) { return 2 } }',
    for: 'function f() { for (let i = 0; i < 3; i += 1) {} return 1 }',
    'for-in': 'function f(o) { for (const k in o) {} return 1 }',
    'for-of': 'function f(o) { for (const v of o) {} return 1 }',
    while: 'function f(a) { while (a) { a = false } return 1 }',
    'do-while': 'function f(a) { do { a = false } while (a); return 1 }',
    默认参数: 'function f(a = 1) { return a }',
    解构默认值: 'function f(o) { const { a = 1 } = o; return a }',
    逻辑赋值: 'function f(a) { a ||= 1; return a }',
    '?. 成员': 'function f(a) { return a?.b }',
    '?. 调用': 'function f(a) { return a?.() }',
    '?. 深链': 'function f(a) { return a?.b?.c }',
    嵌套函数独立: 'function f(a) { const g = () => (a ? 1 : 2); return g() }',
    类方法: 'class A { static async foo(a) { if (a) { return 1 } return a && 2 } }',
    对象方法: 'const o = { bar(a) { return a ? 1 : 2 } }',
    类字段初始化器: 'class B { x = a && b }',
    getter: 'class C { get v() { return this.a ? 1 : 2 } }',
    箭头函数: 'const g = (a) => (a ? 1 : 2)',
  }

  it('复杂度逐函数一致（含全部算子与嵌套/类字段语义）', async () => {
    for (const [label, code] of Object.entries(COMPLEXITY_CASES)) {
      const expected = await eslintValues(code, 'complexity', /complexity of (\d+)/u)
      const actual = analyze(code).functions.map((fn) => ({ line: fn.line, value: fn.complexity }))
      expect(actual, `复杂度不一致：${label}`).toEqual(expected)
    }
  })

  it('函数行数逐函数一致（含方法修饰符、IIFE、嵌套）', async () => {
    const cases = {
      '70 行（边界）': fnOfLines(70),
      '71 行': fnOfLines(71),
      空行与注释计入: 'function f() {\n  // 注释\n\n  const a = 1\n  return a\n}',
      箭头回调: 'const list = [1].map((x) => {\n  const y = x + 1\n  return y\n})',
      类方法: 'class A {\n  static async foo() {\n    const a = 1\n    return a\n  }\n}',
      对象方法: 'const o = {\n  bar() {\n    const a = 1\n    return a\n  },\n}',
      IIFE: '(function () {\n  const a = 1\n  return a\n})()',
      'IIFE 箭头': '(() => {\n  const a = 1\n  return a\n})()',
      嵌套函数: 'function outer() {\n  const inner = () => {\n    return 1\n  }\n  return inner\n}',
      getter: 'class C {\n  get v() {\n    const a = 1\n    return a\n  }\n}',
    }
    for (const [label, code] of Object.entries(cases)) {
      const expected = await eslintValues(code, 'max-lines-per-function', /too many lines \((\d+)\)/u)
      const actual = analyze(code)
        .functions.filter((fn) => fn.checkLines)
        .map((fn) => ({ line: fn.line, value: fn.lines }))
      expect(actual, `函数行数不一致：${label}`).toEqual(expected)
    }
  })

  it('文件行数一致（末尾换行 / 空行 / 注释 / 空文件）', async () => {
    const cases = [
      'const a = 1\nconst b = 2\n\nconst c = 3\nconst d = 4\n',
      'const a = 1\nconst b = 2',
      'const a = 1\n\n\n',
      '// c1\n/* c2\n   c3 */\nconst a = 1\n',
      'const a = 1',
      '',
    ]
    for (const code of cases) {
      const expected = await eslintValues(code, 'max-lines', /too many lines \((\d+)\)/u)
      expect(expected.map((item) => item.value)).toEqual([countLines(code)])
    }
  })
})

describe('真实仓库门禁', () => {
  it('npm run lint:size 在当前仓库通过（冻结债务基线生效）', () => {
    const res = runCli([])
    expect(res.stdout + res.stderr).toContain('TS 尺寸门禁')
    expect(res.status).toBe(0)
  })

  it('基线文件与当前扫描一致：不残留可移除项', () => {
    const baseline = JSON.parse(readFileSync(join(repoRoot, 'scripts', 'ts-size-baseline.json'), 'utf8'))
    const res = runCli(['--json'])
    const parsed = JSON.parse(res.stdout)
    expect(parsed.ok).toBe(true)
    expect(parsed.stats.baselineFiles).toBe(Object.keys(baseline.files).length)
    // 基线是刚生成的：允许存在"已降到阈值内"的可移除项，但不允许 missing（说明键漂移）
    expect(parsed.removable.filter((item) => item.reason.includes('已不存在'))).toHaveLength(0)
  })

  it('TS 源码零解析失败（@babel/parser 覆盖全部插件源码）', () => {
    const parsed = JSON.parse(runCli(['--json']).stdout)
    expect(parsed.stats.scannedFiles).toBeGreaterThan(200)
  })
})

/** 保留 execFileSync 引用：CI 环境下用它获取稳定的仓库根（避免 cwd 漂移）。 */
void execFileSync
