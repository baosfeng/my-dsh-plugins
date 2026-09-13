/**
 * 共享 client-parts 调用点门禁（issue #186 P2）——dsh-think-zh-expand
 *
 * 归一范围：`src/client/index.ts` 的样式注入样板 → 共享 `installStyles`。
 * 本插件自己的 MutationObserver（界面中文化）不在归一范围，必须保留。
 *
 * 变异验证：把 apply 里的样式样板改回内联 → 第一组变红。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STYLE_PART = readFileSync(join(ROOT, '..', 'dsh-shared', 'client-parts', 'style-tag.part.js'), 'utf8').trim()

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
