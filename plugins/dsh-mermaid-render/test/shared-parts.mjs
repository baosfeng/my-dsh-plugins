/**
 * 共享 client-parts 调用点门禁（issue #186 P2）——dsh-mermaid-render
 *
 * 归一范围：`src/client/index.ts` 的样式注入样板 → 共享 `installStyles`；
 * MutationObserver 骨架 → 共享 `installDomScanner`。
 * 不得削掉的行为：围栏闭合判定 / 离屏渲染 / 自愈卸载 / teardown 清理（经 onTeardown 注入）。
 *
 * 变异验证：把插件源码里的共享调用改回内联样板 → 第一组变红；删掉构建注入 →
 * 「产物含共享片段」变红。
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
/** createElement('style') 的两种引号形态（tsc 产物引号风格可能不同）。 */
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

  it('产物调用共享 installStyles（而非本地实现）', () => {
    const artifact = read('lib/client.js')
    expect(artifact.includes('installStyles(ctx,')).toBe(true)
  })
})

describe('DOM 扫描器走共享骨架（#186 P2）', () => {
  it('src/client/index.ts 不再自己 new MutationObserver', () => {
    expect(countOf(read('src/client/index.ts'), 'new MutationObserver')).toBe(0)
  })

  it('产物逐字节包含 dsh-shared/client-parts/dom-scanner.part.js', () => {
    expect(read('lib/client.js').includes(SCANNER_PART)).toBe(true)
  })

  it('产物里 MutationObserver 创建恰好一处（只在共享骨架内）', () => {
    expect(countOf(read('lib/client.js'), 'new MutationObserver')).toBe(1)
  })

  it('特有行为仍在：闭合判定 / 离屏渲染 / 自愈卸载 / teardown 清理', () => {
    const source = read('src/client/index.ts')
    for (const marker of ['settleStream', 'createOffscreenHost', 'unmountCard', 'clearStreamWatch']) {
      expect(source.includes(marker), `${marker} 必须保留`).toBe(true)
    }
    expect(source.includes('onTeardown'), 'teardown 清理经 onTeardown 注入共享骨架').toBe(true)
  })
})

describe('三处调用点走同一实现（#186 P2 交叉证据）', () => {
  it('md-render / mermaid / think 三个产物含同一份 style-tag 片段', () => {
    for (const artifact of ['dsh-md-render', 'dsh-think-zh-expand'].map((p) => read(`../${p}/lib/client.js`))) {
      expect(artifact.includes(STYLE_PART)).toBe(true)
    }
  })

  it('md-render 产物含同一份 dom-scanner 片段（与 mermaid 同源）', () => {
    expect(read('../dsh-md-render/lib/client.js').includes(SCANNER_PART)).toBe(true)
  })
})
