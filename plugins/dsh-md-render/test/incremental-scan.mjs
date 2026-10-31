/**
 * 增量渲染（端到端）：扫描只登记，块进入视口才渲染。
 *
 * 判据：
 *  · 有 IntersectionObserver 时，apply 之后**没有任何块**被渲染（全部只是登记）；
 *  · 视口内的块进入视口（intersection）后才产出卡片；
 *  · 未被看到的块保持宿主原生形态（内容不丢，只是没增强）；
 *  · 流式块（[data-streaming] 内）在视口内时仍然立即渲染，不因门控而落后。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createPage,
  createReactStub,
  createRenderStack,
  installGlobals,
  loadBundle,
  makeCodeBlock,
  makeElement,
} from './support/fake-dom.mjs'

const CODE_HOST = 'div.mdr-block'
const MD_BODY = 'div.mdr-md.mdr-block-body'

/** 假 IntersectionObserver（测试手动派发可见性）。 */
function installIoStub() {
  const instances = []
  globalThis.IntersectionObserver = class FakeIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback
      this.options = options
      this.targets = new Set()
      instances.push(this)
    }
    observe(target) {
      this.targets.add(target)
    }
    unobserve(target) {
      this.targets.delete(target)
    }
    disconnect() {
      this.targets.clear()
    }
    fire(entries) {
      this.callback(entries)
    }
    show(target) {
      this.callback([{ target, isIntersecting: true }])
    }
  }
  return instances
}

function setup() {
  const io = installIoStub()
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const a = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  const b = makeCodeBlock({ lang: 'text', code: '# 第二个块' })
  const c = makeCodeBlock({ lang: 'js', code: 'const c = 3' })
  for (const block of [a, b, c]) scroll.appendChild(block)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  return { io, loaded, blocks: [a, b, c], page }
}

test('① 首屏扫描只登记，不渲染任何块', () => {
  const { io, blocks } = setup()
  assert.equal(io.length, 1, '单例 observer')
  for (const [i, block] of blocks.entries()) {
    assert.equal(block.getAttribute('data-mdr-view'), null, '块 ' + i + ' 未进入视口前保持宿主原生形态')
    assert.equal(block.querySelector(CODE_HOST), null, '块 ' + i + ' 没有自研卡片')
    assert.equal(block.querySelector(MD_BODY), null, '块 ' + i + ' 没有 markdown 容器')
  }
})

test('② 进入视口的块才渲染，其余保持原生（内容仍在）', () => {
  const { io, blocks } = setup()
  const [a, b, c] = blocks
  assert.equal(a.querySelector('code').textContent, 'const a = 1', '原始内容一直在')

  io[0].show(a)
  assert.ok(a.querySelector(CODE_HOST), '第 1 块进入视口后渲染')
  assert.equal(a.getAttribute('data-mdr-view'), 'code')
  assert.equal(b.querySelector(CODE_HOST), null, '第 2 块仍未被增强')
  assert.equal(c.querySelector(CODE_HOST), null, '第 3 块仍未被增强')

  io[0].show(b)
  assert.ok(b.querySelector(MD_BODY), '第 2 块滚动到才按 markdown 渲染')
  assert.equal(c.querySelector(CODE_HOST), null, '第 3 块仍未被增强')
})

test('③ 可见块重复登记是幂等的（内容没变不重建卡片）', () => {
  const { io, blocks } = setup()
  const [, b] = blocks
  io[0].show(b)
  const card = b.querySelector(MD_BODY)
  assert.ok(card, '首屏可见的块立刻接管')
  // 流式期间每批 mutation 都会重新登记一次：可见态同步执行，但签名没变 → 必须复用同一个卡片
  io[0].show(b)
  assert.equal(b.querySelector(MD_BODY), card, '重复可见登记不重建卡片（避免渲染风暴）')
})

test('④ 长会话：200 个块首屏只登记，渲染数 = 视口内块数', () => {
  const io = installIoStub()
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const blocks = []
  for (let i = 0; i < 200; i += 1) {
    const block = makeCodeBlock({ lang: 'js', code: 'const v' + i + ' = ' + i })
    blocks.push(block)
    scroll.appendChild(block)
  }
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })

  const rendered = () => blocks.filter((b) => b.querySelector(CODE_HOST) !== null).length
  assert.equal(rendered(), 0, '200 个块首屏一个都不渲染（全部只登记）')
  assert.equal(io[0].targets.size, 200, '全部块已登记观察')

  // 视口内只露出 2 块
  io[0].show(blocks[0])
  io[0].show(blocks[1])
  assert.equal(rendered(), 2, '只渲染进入视口的 2 块（改造前是 200 块同步渲染）')
  assert.equal(blocks[199].querySelector(CODE_HOST), null, '末尾未看过的块保持原生')
})
