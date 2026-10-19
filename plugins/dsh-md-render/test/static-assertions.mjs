/**
 * 合并后的硬约束静态断言（issue #463 / md-render 重构 v2，机器可校验）。
 *
 * 用户硬约束（最高优先级）：「合并后**只做 markdown 内容的渲染**……其他一律保持
 * 官方默认样式」。本文件把可机器校验的部分钉死，防止后续改动悄悄越界：
 *
 *  1. **不注册任何 conversation.chat.node 节点级 seat**（尤其 assistant-step）；
 *  2. **不读 React fiber 私有属性**（__reactFiber$ / memoizedProps）；
 *  3. **不对官方元素写 style / class / aria**：DOM 注入只用自有 CSS + 自有 data-* 标记；
 *  4. **单 MutationObserver**（合并前 md-render 与 mermaid 各装一个）；
 *  5. 不出现自绘助手节点 / 自绘思考块（ThinkBlock / AssistantStepView）。
 *
 * 断言对象是**构建产物** lib/client.js：注释先剔除（避免「注释里写了禁令」被误判），
 * 剩余文本同时覆盖代码与字符串字面量 —— 本文件的断言正是靠字面量命中。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const RAW = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/** 剔除块注释与行注释后的产物文本。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

const CODE = stripComments(RAW)

test('client bundle：不注册任何 conversation.chat.node 节点级 seat', () => {
  assert.equal(CODE.includes('conversation.chat.node'), false, 'must not register node-level seats')
  assert.equal(CODE.includes('assistant-step'), false, 'must not shadow the assistant-step renderer')
  // slots 扩展点只允许这两个加法型 seat：
  //  · settings.plugins.tab（list / replaceRisk none，旧宿主与「设置 → 内置插件」）；
  //  · plugins.bundle.config（keyed / replaceRisk shadows-shipped-ui，仅 key = 本包名）。
  const injected = [...CODE.matchAll(/inject\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual([...injected].sort(), ['plugins.bundle.config', 'settings.plugins.tab'])
})

test('client bundle：不读 React fiber 私有属性', () => {
  assert.equal(CODE.includes('__reactFiber'), false, 'no React fiber private property reads')
  assert.equal(CODE.includes('memoizedProps'), false, 'no memoizedProps reads')
  assert.equal(CODE.includes('fiberKeys'), false, 'no fiber walking helpers')
})

test('client bundle：不对官方元素写 style / class / aria（状态只走 setAttribute）', () => {
  // v2：连插件自建节点也不写 el.style / cssText / classList（几何全部走样式表）。
  const styleWrites = [...CODE.matchAll(/\b([A-Za-z_$][\w$]*)\.style\./g)].map((m) => m[1])
  assert.deepEqual([...new Set(styleWrites)], [], 'no inline style writes at all')
  assert.equal(CODE.includes('cssText'), false, 'no cssText writes')
  assert.equal(/classList\.(add|remove|toggle)/.test(CODE), false, 'no classList mutation anywhere')
  // setAttribute 白名单：插件自有 data-mdr-* / aria-* / 降级引擎的 svg 几何属性 / 只读标记。
  const attrs = [...CODE.matchAll(/\.setAttribute\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  const allowed = new Set(['readonly', 'width', 'height'])
  for (const name of attrs) {
    const ok = allowed.has(name) || name.startsWith('data-mdr-') || name.startsWith('aria-') || name === 'role'
    assert.ok(ok, 'unexpected setAttribute target: ' + name)
  }
  // 官方 pre 的隐藏由自有 CSS 完成，不写 el.style.display。
  assert.equal(CODE.includes('style.display'), false, 'official <pre> is hidden by plugin CSS')
  // 接管态必须隐藏**官方全部直接子元素**，只留自有容器；且不得用直接子 <pre> 选择器。
  assert.ok(
    CODE.includes('div.md-code-block[data-mdr-view] > :not(.mdr-block){display:none !important}'),
    '接管态隐藏官方全部直接子元素（只留 .mdr-block）',
  )
  assert.equal(/\[data-mdr-view\]\s*>\s*pre/.test(CODE), false, 'must not target a direct-child <pre>')
  // 缩放锚点：变换层 flex 居中 + 程序性缩放后显式居中补偿（两个引擎的锚点都是变换层中心）。
  assert.ok(
    CODE.includes('.mdr-mm-canvas{display:flex;align-items:center;justify-content:center'),
    'the zoom transform layer centers the svg',
  )
  assert.ok(CODE.includes('function zoomCenterInFrame('), 'center compensation exists')
  assert.ok(CODE.includes('translateInScaledSpace'), 'compensation factor follows engine transform order')
  assert.equal(/data-mdr-mm-fs[^{]*\{[^}]*position:absolute/.test(CODE), false, 'transform layer stays in flow')
})

test('client bundle：单 MutationObserver（合并前两路观察收敛为一路）', () => {
  assert.equal((RAW.match(/new MutationObserver/g) ?? []).length, 1, 'exactly one MutationObserver')
  assert.equal((CODE.match(/function installDomScanner\(/g) ?? []).length, 1, 'exactly one scanner skeleton')
  assert.equal((CODE.match(/function installScanner\(/g) ?? []).length, 1, 'exactly one scanner assembly')
})

test('client bundle：不含自绘助手节点 / 自绘思考块 / 旧包名', () => {
  for (const banned of ['ThinkBlock', 'AssistantStepView', 'stripControlTags', 'renderBlocks', 'dsh-think-zh-expand']) {
    assert.equal(CODE.includes(banned), false, 'must not contain ' + banned)
  }
  assert.equal(CODE.includes('applyThinkExpand'), true, 'think expand is present')
  assert.ok(CODE.includes('.click'), 'think expand dispatches a real click')
  assert.equal(CODE.includes('applyThinkExpand(el)'), true, 'the scanner calls the think expander')
})

test('client bundle：不内联 mermaid 引擎（走 assets 静态路由）', () => {
  assert.equal(CODE.includes('/md-render/assets/mermaid-10.9.3.min.js'), true, 'engine served from the assets route')
})

test('client bundle：内容渲染完全用插件自己的实现（不碰官方 MarkdownText / CodeBlock）', () => {
  assert.equal(CODE.includes('@deepseek-ai/dsh-client-ui-primitives'), false, '官方 UI 组件库不再被 require')
  for (const needed of [
    'function markdownNodes(',
    'function MdrCodeBlock(',
    'function MdrMarkdown(',
    'function mountMdrBlock(',
    'function ensureRenderAsset(',
  ]) {
    assert.ok(CODE.includes(needed), needed + ' 必须在产物里（片段静默丢失是这类构建最典型的故障模式）')
  }
  for (const url of ['/md-render/assets/marked-18.1.0.umd.js', '/md-render/assets/highlightjs-11.12.0.min.js']) {
    assert.equal(CODE.includes(url), true, url + ' 走 assets 懒加载')
  }
})

test('自研 markdown / 代码渲染器不用 innerHTML（模型输出永不被当 HTML 执行）', () => {
  for (const part of ['own-markdown.ts', 'own-markdown-blocks.ts', 'own-code.ts']) {
    const src = stripComments(readFileSync(join(here, '..', 'src', 'client', 'parts', part), 'utf8'))
    assert.equal(src.includes('innerHTML'), false, part + ': 不得出现任何 innerHTML 路径（注释不算）')
  }
  // 产物里唯一允许的 HTML 字符串消费点是 mermaid 引擎产出的 SVG（两处：卡片 / 全屏体）。
  const consumers = [...CODE.matchAll(/dangerouslySetInnerHTML/g)].length
  assert.equal(consumers, 2, 'only the mermaid svg canvases (card + fullscreen)')
  assert.equal(CODE.includes('__html: props.svg'), true, 'the consumer is the mermaid svg card')
})
