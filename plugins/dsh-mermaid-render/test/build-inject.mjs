/**
 * 构建产物门禁（issue #185 回归 + 引擎外部化验证）。
 *
 * 背景：原方案将 mermaid UMD base64 内联到 client.js（4.5MB），后改为
 * 独立文件 assets/mermaid-10.9.3.min.js 按需加载。
 *
 * 本文件钉住三条底线（防复发）：
 *  1. 模板（含注释）不含引擎占位符字面量 —— 否则拼接后就变成 2 处；
 *  2. 已提交产物 lib/client.js 体积大幅缩小（< 200KB，不含引擎）；
 *  3. assets/mermaid-10.9.3.min.js 存在且与 vendor/mermaid.min.js 一致。
 *
 * 变异验证：把断言对象换成"两份引擎"的产物，本文件的产物用例必须变红。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spliceExactlyOnce } from '../../dsh-shared/scripts/splice.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE_PATH = join(ROOT, 'lib/client.src.js')
const ARTIFACT_PATH = join(ROOT, 'lib/client.js')
const VENDOR_PATH = join(ROOT, 'vendor/mermaid.min.js')
const ASSET_PATH = join(ROOT, 'assets/mermaid-10.9.3.min.js')

/** 引擎占位符：src/client/index.ts 编译产物里的常量声明位。 */
const ENGINE_PLACEHOLDER = '__MERMAID_UMD_B64__'
/** 模板里注入 tsc 产物的位置（build.mjs 用同一个严格入口替换）。 */
const BUNDLE_PLACEHOLDER = '/*__CLIENT_BUNDLE__*/'
/** 模板里注入共享图标（dsh-shared/client-parts/icons.part.js）的位置（#186 P1）。 */
// const ICONS_PLACEHOLDER = '/*__PART_ICONS__*/' // 暂时未使用

/**
 * 产物字节上限（引擎已外部化，client.js 应 < 200KB）。
 */
const ARTIFACT_MAX_BYTES = 200_000

/** 读真实产物/模板（文件名与 build.mjs 一致，避免 fixture 漂移）。 */
const readArtifact = () => readFileSync(ARTIFACT_PATH, 'utf8')
const readTemplate = () => readFileSync(TEMPLATE_PATH, 'utf8')

/** 统计 haystack 中 needle 出现次数（split 计数：不受正则元字符影响）。 */
function countOf(haystack, needle) {
  return haystack.split(needle).length - 1
}

describe('模板单份占位符不变量（#185）', () => {
  it('lib/client.src.js 模板不含引擎占位符字面量（注释里也不行）', () => {
    const hits = countOf(readTemplate(), ENGINE_PLACEHOLDER)
    expect(hits, '模板里出现与占位符同形的字面量 → 拼接后产物有 2 处占位符').toBe(0)
  })

  it('模板里 tsc 产物占位符（__CLIENT_BUNDLE__）恰好一处', () => {
    expect(countOf(readTemplate(), BUNDLE_PLACEHOLDER)).toBe(1)
  })
})

describe('引擎外部化（按需加载替代 base64 内联）', () => {
  it('lib/client.js 体积大幅缩小（< 200KB，引擎不再内联）', () => {
    const bytes = Buffer.byteLength(readArtifact())
    expect(bytes).toBeLessThan(ARTIFACT_MAX_BYTES)
  })

  it('lib/client.js 里没有残留的引擎占位符', () => {
    expect(countOf(readArtifact(), ENGINE_PLACEHOLDER)).toBe(0)
  })

  it('lib/client.js 里没有 base64 内联的引擎', () => {
    // 旧方案：MERMAID_UMD_B64 被替换为 ~4.4MB base64 字符串
    // 新方案：client.js 仅包含应用代码（~50KB），引擎在 assets/ 按需加载
    expect(readArtifact()).not.toContain('MERMAID_UMD_B64')
  })

  it('assets/mermaid-10.9.3.min.js 存在且大小合理（> 1MB）', () => {
    expect(existsSync(ASSET_PATH)).toBe(true)
    const size = statSync(ASSET_PATH).size
    expect(size).toBeGreaterThan(1_000_000)
  })

  /**
   * issue #296 回归：asset 必须是 vendor 的**逐字节**副本（build.mjs 用 copyFileSync）。
   *
   * 线上资产曾被格式化提交（6.9MB / 177k 行的 `;(function (JM, _g) {` 美化版，与
   * minified 源只差空白与 `;` 前缀），让本 job 长期红。
   *
   * 断言方式（为什么不写 `expect(assetText).toBe(vendorText)`）：失败时 vitest 会把
   * 两个 3.3MB 字符串**整篇打进日志**，真正的失败原因被淹没（#296 取证时 CI job 日志
   * 就是被这个巨型 diff 灌满的）。这里改为字节比较 + 自建短消息：失败只打印
   * 「字节数 / 首 48 字节」—— 既钉住「必须逐字节一致」这条语义，又不再制造日志洪水。
   */
  it('asset 与 vendor 完全一致（逐字节；失败时只报字节数与文件头，不灌日志）', () => {
    const asset = readFileSync(ASSET_PATH)
    const vendor = readFileSync(VENDOR_PATH)
    const head = (buf) => JSON.stringify(buf.subarray(0, 48).toString('utf8'))
    // 不是「放宽」：这正是原来 toBe 的语义（逐字节相同），只是换了失败时的信息量。
    expect(
      asset.equals(vendor),
      `asset 必须与 vendor 逐字节一致（build.mjs 用 copyFileSync 复制）\n` +
        `  asset  bytes=${asset.byteLength} head=${head(asset)}\n` +
        `  vendor bytes=${vendor.byteLength} head=${head(vendor)}`,
    ).toBe(true)
  })

  it('asset 保持 minified（< 4MB、单行 UMD 开头；被 prettier --write 美化会立即超标）', () => {
    expect(statSync(ASSET_PATH).size).toBeLessThan(4_000_000)
    const head = readFileSync(ASSET_PATH, 'utf8').slice(0, 32)
    expect(head.startsWith('(function(')).toBe(true)
  })

  it('client.js 引用 MERMAID_ENGINE_URL 路径（fetch 加载）', () => {
    expect(readArtifact()).toContain('/mermaid-render/assets/mermaid-10.9.3.min.js')
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
})
