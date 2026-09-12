/**
 * 构建「引擎只注入一次」门禁（issue #185 回归）。
 *
 * 背景：lib/client.src.js 模板顶部的 eslint 注释曾写成
 * `/* global __MERMAID_UMD_B64__ *\/` —— 与 src/client/index.ts 的编译产物里
 * `const MERMAID_UMD_B64: string = /*__MERMAID_UMD_B64__*\/ ''` 的占位符**同形**。
 * build.mjs 用 replaceAll 把两处都替换成 4.45 MB base64，产物与 npm 包体积翻倍
 * （lib/client.js 8,934,938 B、npm v0.1.6 dist.unpackedSize 13.5 MB），
 * 而当时"无残留"门禁在两处都替换后恰好为 0 → 自诞生起静默通过。
 *
 * 本文件钉住三条底线（防复发）：
 *  1. 模板（含注释）不含引擎占位符字面量 —— 否则拼接后就变成 2 处；
 *  2. 已提交产物 lib/client.js 里引擎 base64 恰好一份、体积不得翻倍；
 *  3. 抽出计数/替换逻辑后，0 处与 ≥2 处必须显式失败，只有恰好 1 处才写入。
 *
 * 变异验证：把断言对象换成"两份引擎"的产物，本文件的产物用例必须变红。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readAssignedStringLiteral, spliceExactlyOnce } from '../scripts/splice.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE_PATH = join(ROOT, 'lib/client.src.js')
const ARTIFACT_PATH = join(ROOT, 'lib/client.js')
const VENDOR_PATH = join(ROOT, 'vendor/mermaid.min.js')

/** 引擎占位符：src/client/index.ts 编译产物里的常量声明位。 */
const ENGINE_PLACEHOLDER = '__MERMAID_UMD_B64__'
/** 模板里注入 tsc 产物的位置（build.mjs 用同一个严格入口替换）。 */
const BUNDLE_PLACEHOLDER = '/*__CLIENT_BUNDLE__*/'

/**
 * 产物字节上限。单份引擎 base64 = 4,449,016 B（vendor 3,336,760 B），
 * 产物实测 4.49 MB；翻倍缺陷态 8.93 MB。取 6 MB：容纳引擎正常增长，
 * 但任何"注入两遍"立即越界。
 */
const ARTIFACT_MAX_BYTES = 6_000_000

/** 读真实产物/模板（文件名与 build.mjs 一致，避免 fixture 漂移）。 */
const readArtifact = () => readFileSync(ARTIFACT_PATH, 'utf8')
const readTemplate = () => readFileSync(TEMPLATE_PATH, 'utf8')

/** vendor 引擎的 base64（4.45 MB，懒加载缓存：多处断言复用同一次编码）。 */
let cachedB64 = null
function engineB64() {
  cachedB64 ??= Buffer.from(readFileSync(VENDOR_PATH, 'utf8'), 'utf8').toString('base64')
  return cachedB64
}

/** 引擎 base64 指纹：取 vendor 编码结果前 64 字符，不硬编码魔数。 */
function engineFingerprint() {
  return engineB64().slice(0, 64)
}

/** 统计 haystack 中 needle 出现次数（split 计数：不受正则元字符影响）。 */
function countOf(haystack, needle) {
  return haystack.split(needle).length - 1
}

describe('模板单份占位符不变量（#185）', () => {
  it('lib/client.src.js 模板不含引擎占位符字面量（注释里也不行）', () => {
    const hits = countOf(readTemplate(), ENGINE_PLACEHOLDER)
    expect(hits, '模板里出现与占位符同形的字面量 → 拼接后产物有 2 处占位符 → base64 注入两遍（#185）').toBe(0)
  })

  it('模板里 tsc 产物占位符（__CLIENT_BUNDLE__）恰好一处', () => {
    expect(countOf(readTemplate(), BUNDLE_PLACEHOLDER)).toBe(1)
  })
})

describe('已提交产物的单份引擎不变量（#185）', () => {
  it('lib/client.js 里引擎 base64 恰好出现一次（重复注入即失败）', () => {
    const hits = countOf(readArtifact(), engineFingerprint())
    expect(hits, '引擎 base64 出现多次 = 重复注入（#185 缺陷态）').toBe(1)
  })

  it('lib/client.js 体积未翻倍（< 6 MB，单份引擎实测 4.49 MB）', () => {
    const bytes = Buffer.byteLength(readArtifact())
    expect(bytes).toBeLessThan(ARTIFACT_MAX_BYTES)
  })

  it('lib/client.js 里没有残留的引擎占位符', () => {
    expect(countOf(readArtifact(), ENGINE_PLACEHOLDER)).toBe(0)
  })
})

describe('spliceExactlyOnce 占位符门禁（#185）', () => {
  it('0 处占位符：显式失败（拼写漂移不再静默产出坏产物）', () => {
    expect(() => spliceExactlyOnce('var x = 1\n', ENGINE_PLACEHOLDER, '"AAA"')).toThrow(
      /expected exactly 1 .* placeholder, found 0/,
    )
  })

  it('2 处占位符：显式失败 —— #185 回归用例（静默 replaceAll 会把 base64 注入两遍）', () => {
    const dup = `a ${ENGINE_PLACEHOLDER} b ${ENGINE_PLACEHOLDER} c`
    expect(() => spliceExactlyOnce(dup, ENGINE_PLACEHOLDER, '"AAA"')).toThrow(/found 2/)
  })

  it('恰好 1 处：只替换一次，前后文原样保留、无残留', () => {
    const src = `head\n ${ENGINE_PLACEHOLDER} \ntail`
    const out = spliceExactlyOnce(src, ENGINE_PLACEHOLDER, '"PAYLOAD"')
    expect(out).toBe('head\n "PAYLOAD" \ntail')
    expect(countOf(out, ENGINE_PLACEHOLDER)).toBe(0)
  })

  it('替换值里的 $& / $1 不被解释（函数式 replacer 语义，base64 之外的载荷也安全）', () => {
    const out = spliceExactlyOnce(`x ${ENGINE_PLACEHOLDER} y`, ENGINE_PLACEHOLDER, "cost: $& $1 $'")
    expect(out).toBe("x cost: $& $1 $' y")
  })

  it('真实模板 + 编译产物常量声明行：拼接后恰好 1 处，注入后产物只含一份引擎', () => {
    const engineB64 = Buffer.from(readFileSync(VENDOR_PATH, 'utf8'), 'utf8').toString('base64')
    // 复刻 tsc -p tsconfig.client.json 产出的常量声明行（src/client/index.ts:65）
    const compiled = `const MERMAID_UMD_B64: string = /*${ENGINE_PLACEHOLDER}*/ ''`
    const spliced = readTemplate().replace(BUNDLE_PLACEHOLDER, () => compiled)
    expect(countOf(spliced, ENGINE_PLACEHOLDER)).toBe(1)

    const out = spliceExactlyOnce(spliced, ENGINE_PLACEHOLDER, JSON.stringify(engineB64))
    expect(countOf(out, engineB64), '注入后只剩一份引擎 base64').toBe(1)
    expect(countOf(out, ENGINE_PLACEHOLDER)).toBe(0)
    expect(Buffer.byteLength(out)).toBeLessThan(ARTIFACT_MAX_BYTES)
  })
})
describe('产物内引擎常量必须是可用的字符串字面量（#185 扩展）', () => {
  // 背景：占位符曾写成注释形（`= /*__MERMAID_UMD_B64__*/ ''`），替换后 base64 仍留在
  // 块注释里，常量恒为空串 → 内联引擎永远加载不了（浏览器报 mermaid engine missing
  // after injection）。"占位符已替换"不等于"引擎可用"，所以这里直接断言取值。
  it('MERMAID_UMD_B64 是字符串字面量且取值 === vendor 引擎 base64（非空）', () => {
    const literal = readAssignedStringLiteral(readArtifact(), 'MERMAID_UMD_B64')
    expect(literal, '产物里该常量不是字符串字面量（base64 落在注释里 → 引擎常量恒为空串、引擎加载失败）').not.toBeNull()
    expect(literal.length).toBe(engineB64().length)
    expect(literal).toBe(engineB64())
  })

  it('产物内引擎 base64 解码后与 vendor/mermaid.min.js 逐字节一致', () => {
    const literal = readAssignedStringLiteral(readArtifact(), 'MERMAID_UMD_B64')
    expect(literal).not.toBeNull()
    expect(Buffer.from(literal, 'base64').toString('utf8')).toBe(readFileSync(VENDOR_PATH, 'utf8'))
  })
})
describe('readAssignedStringLiteral：按取值校验，而不是「占位符没了」（#185 扩展）', () => {
  it('读取字符串字面量赋值的取值', () => {
    expect(readAssignedStringLiteral("const X = 'abc'", 'X')).toBe('abc')
  })

  it('注释形占位符 → null（本次缺陷形态：替换成功但取值不是字面量）', () => {
    expect(readAssignedStringLiteral("const X = /*'abc'*/ ''", 'X')).toBe(null)
  })

  it('非字符串赋值 → null', () => {
    expect(readAssignedStringLiteral('const X = 42', 'X')).toBe(null)
  })

  it('跳过同名引用，定位到真正的赋值处', () => {
    expect(readAssignedStringLiteral("const X = 'v'\nconst Y = fn(X)", 'X')).toBe('v')
  })

  it('不把更长标识符的后缀当成常量名', () => {
    expect(readAssignedStringLiteral("const MyX = 'v'", 'X')).toBe(null)
  })
})
