/**
 * client 产物冒烟（bundle 级）：apply 装配 + 两个注入点端到端。
 *
 * 判据：样式随 activation 注入（含 data-dsh-md-render 标记）、随 teardown 卸载；
 * 只装一个 MutationObserver（共享骨架）；扫描一次即把上下文注入块与围栏块都接上
 * **自研渲染器**（不再 require 官方 @deepseek-ai/dsh-client-ui-primitives）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  makeCodeBlock,
  makeContextPre,
  makeElement,
} from './support/fake-dom.mjs'

function setup() {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const row = makeElement('div')
  const pre = makeContextPre('## 上下文注入\n\n- 一')
  row.appendChild(pre)
  scroll.appendChild(row)
  scroll.appendChild(makeCodeBlock({ lang: 'text', code: '## text 围栏' }))
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const disposers = []
  const ctx = {
    effect: (fn2) => {
      const dispose = fn2()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
  }
  return { page, loaded, stack, scroll, row, pre, ctx, disposers }
}

test('apply 注入样式并装配共享扫描器（恰好一个 observer）', () => {
  const { loaded, page, ctx, disposers } = setup()
  loaded.exports.apply(ctx)
  const styleTags = page.document.head.querySelectorAll('style')
  assert.equal(styleTags.length, 2, '样式表已注入（卡片样式 + 设置页样式）')
  assert.equal(styleTags[0].getAttribute('data-dsh-md-render'), 'styles', '样式表标记')
  assert.ok(styleTags[0].textContent.includes('.tzx-md'), '样式内容包含自有 DOM 规则')
  assert.ok(styleTags[0].textContent.includes('.dsh-md-render-code'), '样式内容包含自研代码块规则')
  assert.equal(page.observers.length, 1, '只装一个 MutationObserver')
  for (const dispose of disposers) dispose()
  assert.equal(page.document.head.querySelectorAll('style').length, 0, 'teardown 卸载样式')
  assert.equal(page.observers[0].disconnected, true, 'teardown 断开观察器')
})

test('一次扫描同时接上上下文注入块与围栏块（都由自研渲染器产出）', () => {
  const { loaded, row, pre, scroll, ctx } = setup()
  loaded.exports.apply(ctx)
  const contextBody = row.querySelector('div.dsh-md-render-context-md')
  assert.ok(contextBody, '上下文块已接管')
  assert.equal(pre.hidden, true, '原文 pre 已隐藏')
  assert.equal(contextBody.querySelector('h2').textContent, '上下文注入', '自研渲染产出真实 h2')
  const textBody = scroll.querySelector('div.dsh-md-render-text-md')
  assert.ok(textBody, 'text 围栏块已接管')
  assert.equal(textBody.querySelector('h2').textContent, 'text 围栏', 'text 围栏内容由自研渲染器渲染')
})

test('产物依赖面：只 require 平台 seed 模块（react / react-dom/client），不碰官方渲染组件', () => {
  const { loaded, ctx } = setup()
  loaded.exports.apply(ctx) // react-dom/client 是惰性 require（首次渲染时解析）
  const specs = new Set(loaded.requireCalls)
  assert.deepEqual([...specs].sort(), ['react', 'react-dom/client'], '产物只依赖平台 seed 模块')
  const artifact = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
  assert.equal(
    artifact.includes('@deepseek-ai/dsh-client-ui-primitives'),
    false,
    '不再引用官方 MarkdownText / CodeBlock',
  )
  assert.ok(artifact.includes('installStyles(ctx,'), '样式注入走共享实现')
  assert.ok(artifact.includes('installDomScanner('), '扫描器走共享骨架')
})
