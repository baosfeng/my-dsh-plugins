/**
 * 共享 client-parts 调用点门禁 ——dsh-md-render（重构 v2）
 *
 * 归一范围：parts/apply.ts 的样式注入样板 → 共享 installStyles；
 * parts/scanner.ts 的 MutationObserver 骨架 → 共享 installDomScanner。
 * 图标集：mermaid 卡片 / 代码卡 / 设置页消费共享 icons.part.js（锚点保证恰好一份）。
 * 不得削掉的行为：上下文注入块接管、围栏块接管、流式门控、幂等签名、
 * 宿主契约不匹配时的静默降级、data-streaming 兜底重扫。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED_DIR = join(ROOT, '..', 'dsh-shared', 'client-parts')
const STYLE_PART = readFileSync(join(SHARED_DIR, 'style-tag.part.js'), 'utf8').trim()
const SCANNER_PART = readFileSync(join(SHARED_DIR, 'dom-scanner.part.js'), 'utf8').trim()
const ICONS_PART = readFileSync(join(SHARED_DIR, 'icons.part.js'), 'utf8').trim()

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

  it('产物只注入一份样式表（5 个 part 聚合后统一注入）', () => {
    const artifact = read('lib/client.js')
    expect(countOf(artifact, "installStyles(ctx, 'data-dsh-md-render'")).toBe(1)
    expect(styleTagCount(artifact)).toBe(1)
    for (const part of ['STYLES_BASE', 'STYLES_MARKDOWN', 'STYLES_CODE', 'STYLES_MERMAID', 'STYLES_SETTINGS']) {
      expect(artifact.includes('const ' + part + ' = `')).toBe(true)
    }
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

  it('两个注入点仍在：上下文块接管 / 围栏块接管 / 兜底重扫', () => {
    const scanner = read('src/client/parts/scanner.ts')
    for (const marker of [
      'scanContextBlocks',
      'scanFenceBlocks',
      'scanMermaidBlocks',
      'installDomScanner',
      '[data-conversation-scroll]',
      'installRenderAssetReady',
    ]) {
      expect(scanner.includes(marker), `${marker} 必须保留`).toBe(true)
    }
  })

  it('流式门控与幂等签名仍在下游模块里（不得回退）', () => {
    const text = read('src/client/parts/block-render.ts')
    for (const marker of ['[data-streaming]', 'BLOCK_SIG_ATTR', 'MAX_TEXT_FENCE_CHARS', 'renderMarkdownInto']) {
      expect(text.includes(marker), `${marker} 必须保留`).toBe(true)
    }
    const context = read('src/client/parts/context-markdown.ts')
    for (const marker of [
      'MDR_CONTEXT_SIG_ATTR',
      'MAX_CONTEXT_CHARS',
      'renderMarkdownInto',
      'data-context-text="true"',
    ]) {
      expect(context.includes(marker), `${marker} 必须保留`).toBe(true)
    }
  })
})

describe('内容渲染完全用插件自己的实现（不依赖官方渲染组件）', () => {
  it('产物里没有旧的重复实现（表格渲染 / 代码分词 / 轨迹接管）', () => {
    const artifact = read('lib/client.js')
    for (const gone of [
      'parseMath',
      'tokenizeCode',
      'parseTable',
      'renderDomMarkdown',
      'applyTrajectoryMarkdown',
      'dsh-md-render-table',
    ]) {
      expect(artifact.includes(gone), `${gone} 应随自实现渲染一并下线`).toBe(false)
    }
  })

  it('产物**不再** require 官方 @deepseek-ai/dsh-client-ui-primitives（MarkdownText / CodeBlock）', () => {
    const artifact = read('lib/client.js')
    expect(artifact.includes('@deepseek-ai/dsh-client-ui-primitives')).toBe(false)
    // 自研渲染器两个部件必须在产物里（片段静默丢失是这类构建最典型的故障模式）。
    expect(artifact.includes('function markdownNodes(')).toBe(true)
    expect(artifact.includes('function MdrCodeBlock(')).toBe(true)
    expect(artifact.includes('function ensureRenderAsset(')).toBe(true)
  })

  it('产物内联共享图标片段（mermaid 卡片消费 icon 集）', () => {
    const artifact = read('lib/client.js')
    expect(artifact.includes(ICONS_PART), 'mermaid 卡片需要共享图标集').toBe(true)
    expect(countOf(artifact, 'ICON_STROKE')).toBe(2)
  })
})
