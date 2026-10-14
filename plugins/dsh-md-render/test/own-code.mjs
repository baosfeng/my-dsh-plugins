/**
 * 自研代码块渲染器（own-code.ts）：真实语言名 banner + 复制 + 自动换行 + highlight.js 高亮。
 *
 * 判据（真实 hljs 11.12.0 + 假 DOM）：
  · banner 语言名 = 围栏 info string 的真实 token（**不是**官方那个本地化标签「代码块」）；
  · 高亮走 hljs 的令牌树 → 自有 vdom span（class 口径与 hljs 的 scopeToCSSClass 逐字一致），
    **没有 innerHTML / dangerouslySetInnerHTML**（源码内容不会被当 HTML 执行）；
  · 语言不认识 / 超长 / hljs 没加载好 → 纯文本降级，内容一字不少；
  · 复制按钮复制**原文**。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  makeCodeBlock,
  makeElement,
} from './support/fake-dom.mjs'

const CODE_HOST = 'div.dsh-md-render-code-host'
const CODE_VIEW = 'div.dsh-md-render-code'
const CODE_LANG = 'span.dsh-md-render-code-lang'
const CODE_COPY = 'button.dsh-md-render-code-copy'
const CODE_PRE = 'pre.dsh-md-render-code-pre'

function boot(blocks, options = {}) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  for (const block of blocks) scroll.appendChild(block)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react, options)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  return { page, loaded, stack, scroll }
}

test('hljs scope → CSS class 的映射与 hljs 的 scopeToCSSClass 逐字一致', () => {
  const { loaded } = boot([])
  assert.equal(loaded.exports.hljsScopeClass('keyword'), 'hljs-keyword', '简单 scope')
  assert.equal(loaded.exports.hljsScopeClass('comment.line'), 'hljs-comment line_', '分级 scope')
  assert.equal(loaded.exports.hljsScopeClass('title.function'), 'hljs-title function_', '二级分级 scope')
  assert.equal(loaded.exports.hljsScopeClass('language:json'), 'language-json', '子语言')
  assert.equal(loaded.exports.hljsScopeClass(''), '', '空 scope 不产 class')
})

test('代码块 DOM：真实语言名 banner + 复制按钮 + 自动换行 pre + hljs 高亮 span', () => {
  const block = makeCodeBlock({ lang: 'js', code: 'const a = 1; // hi' })
  boot([block])
  const host = block.querySelector(CODE_HOST)
  assert.ok(host.querySelector(CODE_VIEW), '自研代码卡片')
  assert.equal(host.querySelector(CODE_LANG).textContent, 'js', 'banner 是真实语言名（不是「代码块」）')
  const copyBtn = host.querySelector(CODE_COPY)
  assert.equal(copyBtn.getAttribute('data-dsh-md-render-tip'), '复制', '复制按钮就位（文案在浮层）')
  assert.equal(copyBtn.textContent, '', '复制按钮只显示图标')
  assert.equal(host.querySelector(CODE_PRE).textContent, 'const a = 1; // hi', '源码一字不少')
  const spans = host.querySelectorAll('span[class*=hljs-]')
  assert.ok(spans.length > 0, '有高亮 span')
  assert.equal(spans[0].getAttribute('class'), 'hljs-keyword', 'const 关键字命中 hljs-keyword')
  assert.equal(spans[0].textContent, 'const', '关键字 span 文本')
})

test('复制按钮复制原文（走剪贴板 API）', async () => {
  const written = []
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      clipboard: {
        writeText: (text) => {
          written.push(text)
          return Promise.resolve()
        },
      },
    },
  })
  const block = makeCodeBlock({ lang: 'python', code: 'print(1)' })
  boot([block])
  block.querySelector(CODE_COPY).fire('click')
  await Promise.resolve()
  assert.deepEqual(written, ['print(1)'], '复制的是源码原文')
})

test('语言不认识 / 语言位为空 → 纯文本降级（不高亮，也不编造语言名）', () => {
  const unknown = makeCodeBlock({ lang: 'definitely-not-a-language', code: 'x = 1' })
  const untagged = makeCodeBlock({ lang: '', code: 'x = 1' })
  boot([unknown, untagged])
  for (const [name, block] of Object.entries({ unknown, untagged })) {
    assert.ok(block.querySelector(CODE_HOST), name + ' 块仍然接管（代码视图）')
    assert.equal(block.querySelectorAll('span[class*=hljs-]').length, 0, name + ' 块没有高亮 span')
    assert.equal(block.querySelector(CODE_PRE).textContent, 'x = 1', name + ' 块内容一字不少')
  }
  assert.equal(unknown.querySelector(CODE_LANG).textContent, 'definitely-not-a-language', 'hljs 不认识的标记仍照实显示')
  assert.equal(untagged.querySelector(CODE_LANG).textContent, '', '语言位为空时留空')
})

test('hljs 未加载 → 纯文本代码块（内容完整，绝不因为缺库丢内容）', () => {
  const block = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  boot([block], { assets: false })
  assert.equal(block.getAttribute('data-dsh-md-render-text-view'), 'code', '仍然接管')
  assert.equal(block.querySelector(CODE_LANG).textContent, 'js', '语言名来自 DOM 契约，不依赖 hljs')
  assert.equal(block.querySelectorAll('span[class*=hljs-]').length, 0, '没有高亮')
  assert.equal(block.querySelector(CODE_PRE).textContent, 'const a = 1', '源码完整')
})

test('超长代码块（> MAX_HIGHLIGHT_CHARS）跳过高亮但照常渲染', () => {
  const { loaded } = boot([])
  const max = loaded.exports.MAX_HIGHLIGHT_CHARS
  const block = makeCodeBlock({ lang: 'js', code: 'const a = 1;\n'.repeat(Math.ceil(max / 11) + 10) })
  boot([block])
  assert.ok(block.querySelector(CODE_HOST), '仍然接管')
  assert.equal(block.querySelectorAll('span[class*=hljs-]').length, 0, '超长块不做高亮')
  assert.ok(block.querySelector(CODE_PRE).textContent.length > max, '内容完整保留')
})
