/**
 * 共享图标单一来源门禁（issue #186 P1）。
 *
 * 背景：dsh-shared/client-parts/icons.part.js（324 行、19 个 key、ICON_STROKE = 1.8）
 * 已被 10 个插件在构建期拼接共用，dsh-mermaid-render 是唯一漏接的——它在
 * src/client/index.ts 里内联复制了同一套图标（157 行）。本文件把「单一来源」
 * 钉成产物级不变量：
 *
 *  1. 源码不再内联图标实现（ICON_STROKE / iconSvg / icon 定义都清零）；
 *  2. 产物 lib/client.js 里恰好一份图标实现，且逐字节来自共享 part；
 *  3. 其它消费方（dsh-md-render）产物含同一份片段 → 卡片图标视觉一致；
 *  4. mermaid 卡片实际用到的 6 个图标结构冻结（取自 #186 归一前的实现，
 *     逐 key 比对无差异）——共享 part 被改动导致视觉漂移时本用例变红。
 *
 * 变异验证：把 icons.part.js 的任一图标 d 属性改掉 → 第 4 组变红；
 * 在 src/client/index.ts 恢复内联图标 → 第 1 组变红。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_PATH = join(ROOT, 'src/client/index.ts')
const ARTIFACT_PATH = join(ROOT, 'lib/client.js')
const SHARED_ICONS_PATH = join(ROOT, '..', 'dsh-shared', 'client-parts', 'icons.part.js')
/** 另一个共享图标消费方的产物（用于「与其它插件一致」的交叉断言）。 */
const PEER_ARTIFACT_PATH = join(ROOT, '..', 'dsh-md-render', 'lib/client.js')

/** 统计 haystack 中 needle 出现次数（split 计数：不受正则元字符影响）。 */
const countOf = (haystack, needle) => haystack.split(needle).length - 1

let cachedSource = null
const source = () => (cachedSource ??= readFileSync(SOURCE_PATH, 'utf8'))
let cachedArtifact = null
const artifact = () => (cachedArtifact ??= readFileSync(ARTIFACT_PATH, 'utf8'))
const sharedIcons = () => readFileSync(SHARED_ICONS_PATH, 'utf8')

/**
 * 在 mock 作用域里求值共享 icons part（它是纯声明片段，唯一自由变量是
 * createElement——注入 __ModuleLoader__ factory 后由 require('react') 提供）。
 */
function loadSharedIcons() {
  const createElement = (type, props, ...rest) => ({
    type,
    props: props ?? {},
    children: rest.length === 1 && Array.isArray(rest[0]) ? rest[0] : rest,
  })
  return new Function('createElement', `${sharedIcons()}\nreturn { icon, ICON_STROKE }`)(createElement)
}

/** 图标树 → 可比较规格：svg 容器属性 + 子元素 [type, props]（忽略 React key）。 */
function specOf(name, size = 16) {
  const node = loadSharedIcons().icon[name](size)
  return {
    box: node.props,
    children: node.children.map((c) => [
      c.type,
      Object.fromEntries(Object.entries(c.props).filter(([k]) => k !== 'key')),
    ]),
  }
}

/** mermaid 卡片实际渲染的图标（src/client/index.ts 的 icon.* 调用点）。 */
const CARD_ICONS = {
  file: [
    ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
    ['path', { d: 'M14 2v6h6' }],
  ],
  download: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points: '7 10 12 15 17 10' }],
    ['line', { x1: 12, y1: 15, x2: 12, y2: 3 }],
  ],
  copy: [
    ['rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }],
    ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  ],
  code: [
    ['polyline', { points: '16 18 22 12 16 6' }],
    ['polyline', { points: '8 6 2 12 8 18' }],
  ],
  refresh: [
    ['path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }],
    ['polyline', { points: '21 3 21 9 15 9' }],
  ],
  alert: [
    ['path', { d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }],
    ['line', { x1: 12, y1: 9, x2: 12, y2: 13 }],
    ['line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }],
  ],
}

describe('源码不再内联图标实现（#186 P1）', () => {
  it('src/client/index.ts 不含 ICON_STROKE（issue 验收：grep -c = 0）', () => {
    expect(countOf(source(), 'ICON_STROKE')).toBe(0)
  })

  it('src/client/index.ts 不再定义 iconSvg / icon 对象（157 行复制已删除）', () => {
    expect(countOf(source(), 'const iconSvg')).toBe(0)
    expect(countOf(source(), 'const icon = {')).toBe(0)
  })

  it('文件类型徽标（FILE_BADGES / badgeIcon / fileIconByExt）也不再有内联副本', () => {
    // 共享 part 除图标外还提供 98 项 FILE_BADGES 映射与两个分发函数，
    // 归一前 mermaid 源里同样各复制了一份（合计 141 行）。
    expect(countOf(source(), 'const FILE_BADGES =')).toBe(0)
    expect(countOf(source(), 'const badgeIcon =')).toBe(0)
    expect(countOf(source(), 'const fileIconByExt =')).toBe(0)
  })
})

describe('产物里的徽标实现同样来自共享 part（#186 P1）', () => {
  it('产物内 FILE_BADGES 声明恰好一份', () => {
    expect(countOf(artifact(), 'const FILE_BADGES = {')).toBe(1)
  })

  it('产物内 badgeIcon / fileIconByExt 声明各恰好一份', () => {
    expect(countOf(artifact(), 'const badgeIcon =')).toBe(1)
    expect(countOf(artifact(), 'const fileIconByExt =')).toBe(1)
  })

  it('共享 part 提供归一前的全部 98 个扩展名映射', () => {
    const shared = sharedIcons()
    const start = shared.indexOf('const FILE_BADGES = {')
    // 括号配对取块（key 里可能有 c++ / c# 之类非标识符字符，不能用正则切块）
    let depth = 0
    let end = -1
    for (let i = start; i < shared.length; i++) {
      if (shared[i] === '{') depth++
      else if (shared[i] === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    const body = shared.slice(start, end + 1)
    expect([...body.matchAll(/^ {2}'?([^':\n]+)'?:/gm)].length).toBe(98)
  })

  it('fileIconByExt 契约不变（未知扩展名回退中性文件图标，默认 size 14）', () => {
    const { fileIconByExt } = new Function('createElement', `${sharedIcons()}\nreturn { fileIconByExt }`)(
      (type, props, ...rest) => ({ type, props: props ?? {}, children: rest }),
    )
    expect(typeof fileIconByExt).toBe('function')
    const unknown = fileIconByExt('nope')
    expect(unknown.type).toBe('svg')
    expect(unknown.props.width).toBe(14)
  })
})

describe('产物里的图标来自共享 part（#186 P1）', () => {
  it('lib/client.js 逐字节包含 dsh-shared/client-parts/icons.part.js 的片段', () => {
    expect(artifact().includes(sharedIcons().trim())).toBe(true)
  })

  it('产物内图标实现恰好一份（声明只出现一次，无内联副本残留）', () => {
    expect(countOf(artifact(), 'const ICON_STROKE = 1.8')).toBe(1)
    expect(countOf(artifact(), 'const icon = {')).toBe(1)
  })

  it('产物内没有残留的共享图标占位符', () => {
    expect(countOf(artifact(), '/*__PART_ICONS__*/')).toBe(0)
  })
})

describe('图标视觉与其它消费方一致（#186 P1）', () => {
  it('svg 容器属性为描边图标规范（stroke=currentColor / strokeWidth=1.8 / viewBox 24）', () => {
    expect(specOf('file').box).toMatchObject({
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    })
  })

  it('共享 part 提供 mermaid 的全部 19 个 key（含卡片用到的 6 个）', () => {
    const { icon, ICON_STROKE } = loadSharedIcons()
    expect(ICON_STROKE).toBe(1.8)
    expect(Object.keys(icon)).toHaveLength(19)
    for (const name of Object.keys(CARD_ICONS)) {
      expect(typeof icon[name], `icon.${name} 必须存在`).toBe('function')
    }
  })

  it('卡片用到的 6 个图标结构冻结（与 #186 归一前实现逐 key 一致）', () => {
    for (const [name, children] of Object.entries(CARD_ICONS)) {
      expect(specOf(name).children, `icon.${name} 结构漂移`).toEqual(children)
    }
  })

  it('图标 size 默认值不变（14 = chevron 系，15 = close/external，其余 16）', () => {
    // 调用点自带 size 实参（12/14/15），默认值在省略实参时生效；钉住契约不漂移。
    const { icon } = loadSharedIcons()
    expect(icon.chevronRight().props.width).toBe(14)
    expect(icon.chevronDown().props.width).toBe(14)
    expect(icon.close().props.width).toBe(15)
    expect(icon.external().props.width).toBe(15)
    expect(icon.file().props.width).toBe(16)
    expect(icon.alert().props.width).toBe(16)
  })

  it('同仓其它消费方（dsh-md-render）产物含同一份图标实现', () => {
    const peer = readFileSync(PEER_ARTIFACT_PATH, 'utf8')
    expect(peer.includes(sharedIcons().trim()), 'dsh-md-render 产物与 mermaid 共用同一份图标片段').toBe(true)
  })
})
