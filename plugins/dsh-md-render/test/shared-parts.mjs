/**
 * 共享 client-parts 调用点门禁 ——dsh-md-render
 *
 * 归一范围：parts/apply.ts 的样式注入样板 → 共享 installStyles；
 * parts/scanner.ts 的 MutationObserver 骨架 → 共享 installDomScanner。
 * 不得削掉的行为（精简后仍成立）：上下文注入块接管、text 围栏块接管、
 * 流式内容门控、幂等签名、宿主契约不匹配时的静默降级、data-streaming 兜底重扫。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED_DIR = join(ROOT, '..', 'dsh-shared', 'client-parts')
const STYLE_PART = readFileSync(join(SHARED_DIR, 'style-tag.part.js'), 'utf8').trim()
const SCANNER_PART = readFileSync(join(SHARED_DIR, 'dom-scanner.part.js'), 'utf8').trim()

/** 统计 haystack 中 needle 出现次数（split 计数：不受正则元字符影响）。 */
const countOf = (haystack, needle) => haystack.split(needle).length - 1
const styleTagCount = (text) => countOf(text, "createElement('style')") + countOf(text, 'createElement("style")')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

describe('样式注入走共享实现', () => {
  it('parts/apply.ts 不再内联样式注入样板', () => {
    expect(styleTagCount(read('src/client/parts/apply.ts'))).toBe(0)
    expect(countOf(read('src/client/parts/apply.ts'), 'style.setAttribute')).toBe(0)
  })

  it('产物逐字节包含 dsh-shared/client-parts/style-tag.part.js', () => {
    expect(read('lib/client.js').includes(STYLE_PART)).toBe(true)
  })

  it('产物调用共享 installStyles（设置页自有样式表仍保留）', () => {
    const artifact = read('lib/client.js')
    expect(artifact.includes('installStyles(ctx,')).toBe(true)
    expect(styleTagCount(artifact)).toBe(2)
  })
})

describe('DOM 扫描器走共享骨架', () => {
  it('parts/scanner.ts 不再自己 new MutationObserver', () => {
    expect(countOf(read('src/client/parts/scanner.ts'), 'new MutationObserver')).toBe(0)
  })

  it('产物逐字节包含 dsh-shared/client-parts/dom-scanner.part.js', () => {
    expect(read('lib/client.js').includes(SCANNER_PART)).toBe(true)
  })

  it('产物里 MutationObserver 创建恰好一处（只在共享骨架内）', () => {
    expect(countOf(read('lib/client.js'), 'new MutationObserver')).toBe(1)
  })

  it('两个注入点仍在：上下文块接管 / text 围栏块接管 / 兜底重扫', () => {
    const scanner = read('src/client/parts/scanner.ts')
    for (const marker of [
      'scanContextBlocks',
      'applyContextMarkdown',
      'scanTextBlocks',
      'installDomScanner',
      '[data-conversation-scroll]',
    ]) {
      expect(scanner.includes(marker), `${marker} 必须保留`).toBe(true)
    }
  })

  it('流式门控与幂等签名仍在下游模块里（不得回退）', () => {
    const text = read('src/client/parts/text-markdown.ts')
    for (const marker of ['[data-streaming]', 'TEXT_SIG_ATTR', 'MAX_TEXT_FENCE_CHARS', 'renderMarkdownInto']) {
      expect(text.includes(marker), `${marker} 必须保留`).toBe(true)
    }
    const context = read('src/client/parts/context-markdown.ts')
    for (const marker of ['data-signature', 'MAX_CONTEXT_CHARS', 'renderMarkdownInto', 'data-context-text="true"']) {
      expect(context.includes(marker), `${marker} 必须保留`).toBe(true)
    }
  })
})

describe('不再自实现 markdown 渲染（精简的判据）', () => {
  it('产物里没有自实现的渲染器/数学/高亮/表格渲染模块', () => {
    const artifact = read('lib/client.js')
    for (const gone of [
      'parseMath',
      'tokenizeCode',
      'parseTable',
      'renderTable',
      'renderDomMarkdown',
      'applyTrajectoryMarkdown',
      'dsh-md-render-table',
    ]) {
      expect(artifact.includes(gone), `${gone} 应随自实现渲染一并下线`).toBe(false)
    }
  })

  it('产物只通过平台组件渲染（require 官方 MarkdownText）', () => {
    expect(read('lib/client.js').includes("require('@deepseek-ai/dsh-client-ui-primitives')")).toBe(true)
  })
})
