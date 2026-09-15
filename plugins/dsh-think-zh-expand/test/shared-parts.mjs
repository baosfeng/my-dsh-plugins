/**
 * 共享 client-parts 调用点门禁（issue #186 P2 / issue #299）——dsh-think-zh-expand
 *
 * 归一范围：`src/client/index.ts` 的样式注入样板 → 共享 `installStyles`；
 * `lib/client.src.js` 的三级渲染回退样板（#293）→ 共享 `installMarkdownViewFallback`
 * （#299，与 dsh-my-plugin-manager 单一来源，ADR-0002）。
 * 本插件自己的 MutationObserver（界面中文化）不在归一范围，必须保留。
 *
 * 变异验证：把 apply 里的样式样板改回内联 → 样式组变红；把客户端三级链改回内联 →
 * markdown 回退组变红。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED_DIR = join(ROOT, '..', 'dsh-shared', 'client-parts')
const STYLE_PART = readFileSync(join(SHARED_DIR, 'style-tag.part.js'), 'utf8').trim()
const FALLBACK_PART = readFileSync(join(SHARED_DIR, 'markdown-fallback.part.js'), 'utf8').trim()

/** 统计 haystack 中 needle 出现次数（split 计数：不受正则元字符影响）。 */
const countOf = (haystack, needle) => haystack.split(needle).length - 1
const styleTagCount = (text) => countOf(text, "createElement('style')") + countOf(text, 'createElement("style")')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

describe('样式注入走共享实现（#186 P2）', () => {
  it('src/client/index.ts 不再内联样式注入样板', () => {
    expect(styleTagCount(read('src/client/index.ts'))).toBe(0)
    expect(countOf(read('src/client/index.ts'), 'style.setAttribute')).toBe(0)
  })

  it('产物逐字节包含 dsh-shared/client-parts/style-tag.part.js', () => {
    expect(read('lib/client.js').includes(STYLE_PART)).toBe(true)
  })

  it('产物调用共享 installStyles', () => {
    expect(read('lib/client.js').includes('installStyles(ctx,')).toBe(true)
  })

  it('产物里 <style> 注入恰好一处（共享实现，不重复注入）', () => {
    expect(styleTagCount(read('lib/client.js'))).toBe(1)
  })

  it('中文化用的自有 MutationObserver 保留', () => {
    expect(countOf(read('lib/client.js'), 'new MutationObserver')).toBeGreaterThanOrEqual(1)
  })
})

describe('三级渲染回退走共享实现（#299）', () => {
  it('client.src.js 不再内联三级解析 / 组件可用性判定', () => {
    const template = read('lib/client.src.js')
    expect(countOf(template, 'function resolveMarkdownView(')).toBe(0)
    expect(countOf(template, 'isRenderableComponent')).toBe(0)
    expect(countOf(template, 'isComponentLike')).toBe(0)
    // 模块名以参数形式交给共享件（默认值在共享件里），模板不再自行 require
    expect(countOf(template, "require('dsh-md-render')")).toBe(0)
    expect(countOf(template, "require('@deepseek-ai/dsh-client-ui-primitives')")).toBe(0)
  })

  it('产物逐字节包含 dsh-shared/client-parts/markdown-fallback.part.js', () => {
    expect(read('lib/client.js').includes(FALLBACK_PART)).toBe(true)
  })

  it('产物调用共享 installMarkdownViewFallback 恰好一处', () => {
    expect(countOf(read('lib/client.js'), 'installMarkdownViewFallback({')).toBe(1)
  })

  it('产物里锚点声明恰好一份（片段真的被声明，且没被注入两次）', () => {
    expect(countOf(read('lib/client.js'), 'function installMarkdownViewFallback(')).toBe(1)
  })

  it('消费方注入本插件的文案与兜底标记（共享件不含硬编码中文）', () => {
    const artifact = read('lib/client.js')
    expect(countOf(FALLBACK_PART, '复制')).toBe(0)
    expect(countOf(FALLBACK_PART, '脚注')).toBe(0)
    expect(artifact.includes("copyLabel: '复制'")).toBe(true)
    expect(artifact.includes("fallbackAttribute: 'data-dsh-think-zh-expand-fallback'")).toBe(true)
    // 兜底 <pre> 不带 class（与 #295 已合并实现逐字节等价）
    expect(artifact.includes('dsh-think-zh-expand-readme-plain')).toBe(false)
  })
})
