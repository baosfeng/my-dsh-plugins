/**
 * 渲染依赖的懒加载（render-assets.ts）：marked / highlight.js 走 assets 静态路由按需 fetch，
 * **不进 lib/client.js**（用户口径：只控启动速度）。
 *
 * 判据：
  · 首次真正需要时才请求（markdown 路径只要 marked；代码路径只要 hljs），请求 URL 来自单一真源；
  · 加载完成 → 就绪通知 → 重扫补渲染（先落在宿主官方形态的块自动接管）；
  · 页面里已有全局（别的插件先加载过 / 复跑）→ 零请求直接复用；
  · 加载失败 → 静默降级（不抛错、不再重试），块停在宿主官方形态。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createLangIndex } from '../lib/lang-index.js'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  installLangFetchStub,
  loadBundle,
  makeCodeBlock,
  makeElement,
} from './support/fake-dom.mjs'

const MD_BODY = 'div.dsh-md-render-text-md'
const CODE_HOST = 'div.dsh-md-render-code-host'
const MARKED_URL = '/md-render/assets/marked-18.1.0.umd.js'
/** 只取 assets 请求（config 拉取与本套件无关，别混进计数）。 */
const assetCalls = (stub) => stub.calls.filter((url) => url.includes('/assets/'))
const HLJS_URL = '/md-render/assets/highlightjs-11.12.0.min.js'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 装配：**不**预装渲染依赖（走真实懒加载路径）+ 静态资源 / 索引 fetch 桩。 */
function boot(blocks, { fail = false } = {}) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  for (const block of blocks) scroll.appendChild(block)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react, { assets: false })
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const stub = installLangFetchStub(createLangIndex(), { fail })
  const restore = () => {
    loaded.exports.teardownLangProbes()
    loaded.exports.teardownRenderAssets()
    stub.restore()
  }
  return { page, loaded, stub, scroll, restore }
}

test('markdown 路径：解析层按需 fetch（只要 marked），加载完成后自动补渲染', async () => {
  const block = makeCodeBlock({ lang: 'text', code: '## 懒加载' })
  const booted = boot([block])
  try {
    booted.loaded.exports.apply({ effect: (fn) => fn() })
    assert.equal(block.querySelector(MD_BODY), null, '解析层没就绪 → 保持宿主官方形态')
    assert.equal(block.getAttribute('data-dsh-md-render-text-view'), null, '不写半成品状态')
    assert.deepEqual(assetCalls(booted.stub), [MARKED_URL], '只请求解析层（代码路径才需要高亮层）')
    await settle()
    await settle()
    assert.ok(block.querySelector(MD_BODY), '就绪通知触发重扫 → 补渲染')
    assert.equal(block.querySelector('h2').textContent, '懒加载', '产出真实标签')
    assert.equal(assetCalls(booted.stub).length, 1, '同一个库只 fetch 一次')
  } finally {
    booted.restore()
  }
})

test('代码路径：高亮层按需 fetch（只要 hljs），就绪后由纯文本换成高亮', async () => {
  const block = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  const booted = boot([block])
  try {
    booted.loaded.exports.apply({ effect: (fn) => fn() })
    assert.equal(block.getAttribute('data-dsh-md-render-text-view'), 'code', '代码块不等高亮层：先按纯文本接管')
    assert.equal(block.querySelectorAll('span[class*=hljs-]').length, 0, '还没有高亮')
    assert.deepEqual(assetCalls(booted.stub), [HLJS_URL], '只请求高亮层')
    await settle()
    await settle()
    assert.ok(block.querySelectorAll('span[class*=hljs-]').length > 0, '就绪后重建为高亮态')
    assert.equal(block.querySelectorAll(CODE_HOST).length, 1, '重建不重复挂容器')
    assert.equal(block.querySelector('pre').textContent, 'const a = 1', '源码一字不少')
  } finally {
    booted.restore()
  }
})

test('懒加载失败：静默降级、不再重试', async () => {
  const text = makeCodeBlock({ lang: 'text', code: '## 失败' })
  const js = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  const booted = boot([text, js], { fail: true })
  try {
    booted.loaded.exports.apply({ effect: (fn) => fn() })
    await settle()
    await settle()
    assert.equal(text.querySelector(MD_BODY), null, '解析层加载失败 → markdown 块保持官方形态')
    assert.equal(js.getAttribute('data-dsh-md-render-text-view'), 'code', '代码块不依赖任何库，照常接管')
    const calls = assetCalls(booted.stub).length
    booted.loaded.exports.apply({ effect: (fn) => fn() })
    await settle()
    assert.equal(assetCalls(booted.stub).length, calls, '失败已缓存，后续扫描不再重复请求')
  } finally {
    booted.restore()
  }
})

test('window 上已有全局（别的插件先加载过）→ 零请求直接复用', () => {
  const block = makeCodeBlock({ lang: 'text', code: '## 复用' })
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  scroll.appendChild(block)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react) // 默认就装真实 marked / hljs
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const stub = installLangFetchStub(createLangIndex())
  try {
    loaded.exports.apply({ effect: (fn) => fn() })
    assert.ok(block.querySelector(MD_BODY), '直接复用全局，同步渲染')
    assert.equal(stub.calls.filter((url) => url.includes('/assets/')).length, 0, '零 assets 请求')
  } finally {
    loaded.exports.teardownLangProbes()
    stub.restore()
  }
})
