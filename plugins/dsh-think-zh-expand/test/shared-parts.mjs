/**
 * 共享 client-parts 调用点门禁（issue #186 P2 / issue #299）——dsh-think-zh-expand
 *
 * 归一范围：`src/client/index.ts` 的样式注入样板 → 共享 `installStyles`；
 * `lib/client.src.js` 的三级渲染回退样板（#293）→ 共享 `installMarkdownViewFallback`
 * （#299，与 dsh-my-plugin-manager 单一来源，ADR-0002）。
 * issue #428 起本插件不再有界面中文化 MutationObserver（官方 zh locale 是文案真源），
 * 也不再有跨插件渲染内核取值——两者都在下方新增的用例里钉死。
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

  it('中文化 MutationObserver 已移除（官方 zh locale 是文案真源）', () => {
    expect(countOf(read('lib/client.js'), 'new MutationObserver')).toBe(0)
  })
})

/**
 * issue #428：跨插件 external 违规的防回归门禁。
 * 官方明令禁止特性插件 runtime-import 另一个特性插件的值，也禁止用
 * dsh.client.external 获取它们（packages/client/AGENTS.md；
 * 官方 scripts/verify-client-packages.ts 对此直接判违规）。
 */
describe('issue #428：跨插件 external 违规已消除', () => {
  it('package.json 不含 dsh.client.external / externalDegraded', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.dsh?.client?.external).toBeUndefined()
    expect(pkg.dsh?.client?.externalDegraded).toBeUndefined()
    expect(JSON.stringify(pkg.dsh ?? {})).not.toContain('dsh-md-render')
  })

  it('client 源码与依赖清单不再出现 dsh-md-render', () => {
    for (const rel of ['src/client/index.ts', 'src/client/settings.ts', 'lib/client.src.js', 'package.json']) {
      expect(countOf(read(rel), 'dsh-md-render'), rel).toBe(0)
    }
  })

  it('产物没有跨插件 require，external 内核级被旁路到平台 seed 模块', () => {
    const artifact = read('lib/client.js')
    expect(countOf(artifact, "require('dsh-md-render')")).toBe(0)
    expect(artifact.includes('external: PLATFORM_PRIMITIVES')).toBe(true)
    expect(artifact.includes("externalExport: 'externalRendererDisabled'")).toBe(true)
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
