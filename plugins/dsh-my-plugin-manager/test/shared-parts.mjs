/**
 * 共享 client-parts 调用点门禁（issue #299 / #428）——dsh-my-plugin-manager
 *
 * 归一范围：README 预览的渲染回退样板 → 共享 installMarkdownViewFallback。
 * 三道防线（docs/UI规范.md「接入既有共享部件」）：占位符非注释位置 + 恰好一处 +
 * 产物锚点声明恰好一份；这里再补产物级断言（片段逐字节出现在产物里 / 调用点唯一）
 * 与合规断言（外部内核级被旁路，不再跨插件取值）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED_DIR = join(ROOT, '..', 'dsh-shared', 'client-parts')
const FALLBACK_PART = readFileSync(join(SHARED_DIR, 'markdown-fallback.part.js'), 'utf8').trim()
const ICONS_PART = readFileSync(join(SHARED_DIR, 'icons.part.js'), 'utf8').trim()

/** 统计 haystack 中 needle 出现次数（split 计数：不受正则元字符影响）。 */
const countOf = (haystack, needle) => haystack.split(needle).length - 1
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

describe('README 渲染回退走共享实现（#299）', () => {
  it('client.src.js 不再内联 md-render require / null 兜底', () => {
    const template = read('lib/client.src.js')
    expect(countOf(template, "require('dsh-md-render')")).toBe(0)
    expect(countOf(template, 'MarkdownView = null')).toBe(0)
  })

  it('detail.ts 不再有 null 分支与本地 <pre> 兜底（行为由共享件决定）', () => {
    const detail = read('src/client/parts/detail.ts')
    expect(countOf(detail, 'if (MarkdownView)')).toBe(0)
    expect(countOf(detail, "createElement('pre'")).toBe(0)
  })

  it('产物逐字节包含 dsh-shared/client-parts/markdown-fallback.part.js', () => {
    expect(read('lib/client.js').includes(FALLBACK_PART)).toBe(true)
  })

  it('产物逐字节包含共享 icons.part.js（既有注入未被破坏）', () => {
    expect(read('lib/client.js').includes(ICONS_PART)).toBe(true)
  })

  it('产物调用共享 installMarkdownViewFallback 恰好一处', () => {
    expect(countOf(read('lib/client.js'), 'installMarkdownViewFallback({')).toBe(1)
  })

  it('产物里锚点声明恰好一份（片段真的被声明，且没被注入两次）', () => {
    expect(countOf(read('lib/client.js'), 'function installMarkdownViewFallback(')).toBe(1)
  })

  it('产物带本插件自己的兜底标记前缀与既有 class 契约', () => {
    const artifact = read('lib/client.js')
    expect(artifact.includes('data-dsh-my-plugin-manager-fallback')).toBe(true)
    expect(artifact.includes('dsh-my-plugin-manager-readme-plain')).toBe(true)
  })

  it('注入的 labels 文案由消费方提供（共享件不硬编码中文）', () => {
    expect(countOf(FALLBACK_PART, '复制')).toBe(0)
    expect(countOf(FALLBACK_PART, '脚注')).toBe(0)
    expect(read('lib/client.js').includes("copyLabel: '复制'")).toBe(true)
  })

  // #428：共享件的外部内核级（默认 dsh-md-render）必须被显式旁路——官方禁止
  // 特性插件 runtime-import 彼此的值，也禁止用 dsh.client.external 获取。
  it('共享件的外部内核级被旁路（external 指向平台模块 + 不存在的导出名）', () => {
    const template = read('lib/client.src.js')
    expect(template.includes('external: PLATFORM_PRIMITIVES')).toBe(true)
    expect(template.includes("externalExport: 'externalRendererDisabled'")).toBe(true)
    expect(template.includes("const PLATFORM_PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives'")).toBe(true)
  })
})
